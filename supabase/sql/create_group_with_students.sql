-- ============================================================================
-- create_group_with_students()
--
-- Crea un grupo, le asigna catequistas y da de alta a sus alumnos, todo en una
-- única transacción: si una sola fila del fichero falla, no se crea ni el grupo.
-- Así nunca queda un grupo vacío huérfano de una importación a medias.
--
-- La llama el cliente directamente (RPC). Es SECURITY DEFINER, así que
-- comprueba por su cuenta que quien la invoca es coordinator.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_group_with_students(
  p_name          text,
  p_catechist_ids uuid[],
  p_students      jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role          text;
  v_name          text;
  v_group_id      uuid;
  v_count         int;
  v_dupes         text[];
  v_bad_catechist int;
BEGIN
  -- --------------------------------------------------------------- permisos
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();

  IF v_role IS DISTINCT FROM 'coordinator' THEN
    RAISE EXCEPTION 'Solo un coordinador puede crear grupos.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ----------------------------------------------------- nombre del grupo
  v_name := btrim(coalesce(p_name, ''));

  IF v_name = '' THEN
    RAISE EXCEPTION 'El nombre del grupo es obligatorio.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (
       v_name LIKE '1º PRECONFIRMACIÓN%'
    OR v_name LIKE '2º PRECONFIRMACIÓN%'
    OR v_name LIKE '1º CONFIRMACIÓN%'
    OR v_name LIKE '2º CONFIRMACIÓN%'
  ) THEN
    RAISE EXCEPTION 'El nombre debe empezar por "1º PRECONFIRMACIÓN", "2º PRECONFIRMACIÓN", "1º CONFIRMACIÓN" o "2º CONFIRMACIÓN". Recibido: "%".', v_name
      USING ERRCODE = 'check_violation';
  END IF;

  -- Comparación sin distinguir mayúsculas para no acabar con "(A)" y "(a)".
  IF EXISTS (SELECT 1 FROM public.groups WHERE upper(btrim(name)) = upper(v_name)) THEN
    RAISE EXCEPTION 'Ya existe un grupo llamado "%".', v_name
      USING ERRCODE = 'unique_violation';
  END IF;

  -- ------------------------------------------------------------- alumnos
  SELECT count(*) INTO v_count FROM jsonb_array_elements(coalesce(p_students, '[]'::jsonb));

  IF v_count = 0 THEN
    RAISE EXCEPTION 'El fichero no contiene ningún alumno.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- DNIs repetidos dentro del propio fichero.
  SELECT array_agg(dni) INTO v_dupes
  FROM (
    SELECT s->>'dni' AS dni
    FROM jsonb_array_elements(p_students) s
    WHERE nullif(btrim(coalesce(s->>'dni', '')), '') IS NOT NULL
    GROUP BY s->>'dni'
    HAVING count(*) > 1
  ) d;

  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION 'El fichero tiene DNIs repetidos: %.', array_to_string(v_dupes, ', ')
      USING ERRCODE = 'unique_violation';
  END IF;

  -- DNIs con letra de control incorrecta. El CHECK students_dni_valid ya lo
  -- impediría, pero abortaría con un mensaje genérico sin decir cuáles fallan.
  SELECT array_agg(dni) INTO v_dupes
  FROM (
    SELECT btrim(s->>'dni') AS dni
    FROM jsonb_array_elements(p_students) s
    WHERE nullif(btrim(coalesce(s->>'dni', '')), '') IS NOT NULL
      AND NOT public.is_valid_spanish_dni_nie(btrim(s->>'dni'))
  ) d;

  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION 'Estos DNI/NIE no son válidos: %. No se ha importado nada.', array_to_string(v_dupes, ', ')
      USING ERRCODE = 'check_violation';
  END IF;

  -- DNIs que ya existen en la base de datos. Se aborta todo, no se importa a medias.
  SELECT array_agg(DISTINCT st.dni) INTO v_dupes
  FROM public.students st
  WHERE st.dni IS NOT NULL
    AND st.dni IN (
      SELECT btrim(s->>'dni')
      FROM jsonb_array_elements(p_students) s
      WHERE nullif(btrim(coalesce(s->>'dni', '')), '') IS NOT NULL
    );

  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION 'Estos DNI ya existen en la base de datos: %. No se ha importado nada.', array_to_string(v_dupes, ', ')
      USING ERRCODE = 'unique_violation';
  END IF;

  -- --------------------------------------------------------- catequistas
  IF p_catechist_ids IS NULL OR array_length(p_catechist_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Debes asignar al menos un catequista al grupo.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_bad_catechist
  FROM unnest(p_catechist_ids) AS cid
  WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = cid);

  IF v_bad_catechist > 0 THEN
    RAISE EXCEPTION 'Alguno de los catequistas seleccionados no existe.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- ------------------------------------------------------------- creación
  INSERT INTO public.groups (name) VALUES (v_name) RETURNING id INTO v_group_id;

  INSERT INTO public.group_catechist (group_id, profile_id)
  SELECT v_group_id, cid FROM unnest(p_catechist_ids) AS cid;

  INSERT INTO public.students (name, dni, gender, email, parent_email, school, birth_date, group_id)
  SELECT
    btrim(s->>'name'),
    nullif(btrim(coalesce(s->>'dni', '')), ''),
    nullif(btrim(coalesce(s->>'gender', '')), ''),
    nullif(btrim(coalesce(s->>'email', '')), ''),
    nullif(btrim(coalesce(s->>'parent_email', '')), ''),
    nullif(btrim(coalesce(s->>'school', '')), ''),
    nullif(btrim(coalesce(s->>'birth_date', '')), '')::date,
    v_group_id
  FROM jsonb_array_elements(p_students) s;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'group_id', v_group_id,
    'group_name', v_name,
    'alumnos_creados', v_count,
    'catequistas_asignados', array_length(p_catechist_ids, 1)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_group_with_students(text, uuid[], jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_group_with_students(text, uuid[], jsonb) TO authenticated;
