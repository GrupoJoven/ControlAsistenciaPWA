-- ============================================================================
-- promote_academic_year()
--
-- Promociona todos los grupos un curso y da de baja a los que terminan.
-- Se ejecuta entera dentro de UNA transacción: si algo falla a mitad, no se
-- borra nada. La llama la edge function "promote-academic-year" con la clave
-- de servicio; no debe ser invocable desde el cliente.
--
-- Orden de operaciones (importante):
--   1. Se capturan los IDs de los grupos "2º CONFIRMACIÓN" ANTES de renombrar.
--      Si se renombrara primero, los grupos recién promocionados desde
--      "1º CONFIRMACIÓN" pasarían a llamarse "2º CONFIRMACIÓN" y se borrarían
--      por error.
--   2. Se borran los alumnos de esos grupos y todo lo que cuelga de ellos.
--   3. Se borran esos grupos, ya vacíos.
--   4. Y solo entonces se renombra la cadena de cursos.
-- ============================================================================

-- Registro de promociones ya realizadas.
--
-- Sustituye a la heurística anterior ("si no queda ningún grupo 1º
-- PRECONFIRMACIÓN es que ya se promocionó"), que se rearmaba sola: en cuanto se
-- daba de alta el grupo de entrada del curso nuevo, la condición volvía a
-- cumplirse y el botón permitía promocionar por segunda vez, borrando la
-- promoción recién hecha.
CREATE TABLE IF NOT EXISTS public.academic_year_promotions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Año de inicio del curso al que se promociona: 2026 para el CURSO 26-27.
  academic_year_start int NOT NULL UNIQUE,
  promoted_at         timestamptz NOT NULL DEFAULT now(),
  summary             jsonb
);

ALTER TABLE public.academic_year_promotions ENABLE ROW LEVEL SECURITY;

-- Lectura para cualquier usuario identificado: la app necesita saber si ya se
-- promocionó para bloquear el botón. No hay política de escritura a propósito;
-- solo la clave de servicio (la edge function) puede insertar.
DROP POLICY IF EXISTS "promotions_select_authenticated" ON public.academic_year_promotions;
CREATE POLICY "promotions_select_authenticated"
  ON public.academic_year_promotions
  FOR SELECT
  TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.promote_academic_year(p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_month              int;
  v_target_year        int;
  v_already            timestamptz;
  v_graduating_groups  uuid[];
  v_graduating_students uuid[];

  v_deleted_attendance int := 0;
  v_deleted_incidents  int := 0;
  v_deleted_services   int := 0;
  v_deleted_tokens     int := 0;
  v_cleared_verif      int := 0;
  v_deleted_access     int := 0;
  v_deleted_students   int := 0;
  v_deleted_links      int := 0;
  v_deleted_groups     int := 0;
  v_renamed            int := 0;
BEGIN
  -- ---------------------------------------------------------------- guardas
  v_month := EXTRACT(MONTH FROM (now() AT TIME ZONE 'Europe/Madrid'))::int;

  IF v_month NOT IN (8, 9, 10) THEN
    RAISE EXCEPTION 'Fuera de plazo: la promoción solo puede hacerse en agosto, septiembre u octubre (mes actual: %).', v_month
      USING ERRCODE = 'check_violation';
  END IF;

  -- En los tres meses permitidos, el curso de destino es siempre el que empieza
  -- este mismo año natural: en agosto de 2026 se promociona al CURSO 26-27.
  v_target_year := EXTRACT(YEAR FROM (now() AT TIME ZONE 'Europe/Madrid'))::int;

  SELECT promoted_at INTO v_already
  FROM public.academic_year_promotions
  WHERE academic_year_start = v_target_year;

  IF v_already IS NOT NULL THEN
    RAISE EXCEPTION 'El curso %-% ya se promocionó el %. No se puede repetir.',
      v_target_year, v_target_year + 1, to_char(v_already AT TIME ZONE 'Europe/Madrid', 'DD/MM/YYYY HH24:MI')
      USING ERRCODE = 'check_violation';
  END IF;

  -- -------------------------------------------------- 1. snapshot (pre-rename)
  SELECT coalesce(array_agg(id), '{}') INTO v_graduating_groups
  FROM public.groups
  WHERE name LIKE '2º CONFIRMACIÓN%';

  SELECT coalesce(array_agg(id), '{}') INTO v_graduating_students
  FROM public.students
  WHERE group_id = ANY (v_graduating_groups);

  -- ------------------------------------------------------- 2. bajas de alumnos
  -- Se borra de hijos a padres para no depender de que existan ON DELETE CASCADE.
  IF array_length(v_graduating_students, 1) > 0 THEN

    -- parent_email_verifications no se borra: la verificación pertenece al email
    -- del padre/madre, que puede seguir teniendo otros hijos en catequesis.
    -- Solo se desvincula del alumno que se da de baja.
    UPDATE public.parent_email_verifications
       SET last_student_id = NULL
     WHERE last_student_id = ANY (v_graduating_students);
    GET DIAGNOSTICS v_cleared_verif = ROW_COUNT;

    DELETE FROM public.parent_email_verification_tokens
     WHERE student_id = ANY (v_graduating_students);
    GET DIAGNOSTICS v_deleted_tokens = ROW_COUNT;

    DELETE FROM public.mass_services
     WHERE student_id = ANY (v_graduating_students);
    GET DIAGNOSTICS v_deleted_services = ROW_COUNT;

    DELETE FROM public.incidents
     WHERE student_id = ANY (v_graduating_students);
    GET DIAGNOSTICS v_deleted_incidents = ROW_COUNT;

    DELETE FROM public.student_attendance
     WHERE student_id = ANY (v_graduating_students);
    GET DIAGNOSTICS v_deleted_attendance = ROW_COUNT;

    DELETE FROM public.student_public_access
     WHERE student_id = ANY (v_graduating_students);
    GET DIAGNOSTICS v_deleted_access = ROW_COUNT;

    DELETE FROM public.students
     WHERE id = ANY (v_graduating_students);
    GET DIAGNOSTICS v_deleted_students = ROW_COUNT;
  END IF;

  -- --------------------------------------------------- 3. grupos ya vaciados
  IF array_length(v_graduating_groups, 1) > 0 THEN
    DELETE FROM public.group_catechist
     WHERE group_id = ANY (v_graduating_groups);
    GET DIAGNOSTICS v_deleted_links = ROW_COUNT;

    DELETE FROM public.groups
     WHERE id = ANY (v_graduating_groups);
    GET DIAGNOSTICS v_deleted_groups = ROW_COUNT;
  END IF;

  -- ------------------------------------------------------ 4. cadena de nombres
  -- Un único UPDATE con CASE: todas las condiciones se evalúan contra el valor
  -- antiguo, así que no hay efecto cascada entre niveles.
  UPDATE public.groups
     SET name = CASE
                  WHEN name LIKE '1º CONFIRMACIÓN%'
                    THEN '2º CONFIRMACIÓN'    || substring(name from length('1º CONFIRMACIÓN') + 1)
                  WHEN name LIKE '2º PRECONFIRMACIÓN%'
                    THEN '1º CONFIRMACIÓN'    || substring(name from length('2º PRECONFIRMACIÓN') + 1)
                  WHEN name LIKE '1º PRECONFIRMACIÓN%'
                    THEN '2º PRECONFIRMACIÓN' || substring(name from length('1º PRECONFIRMACIÓN') + 1)
                END
   WHERE name LIKE '1º CONFIRMACIÓN%'
      OR name LIKE '2º PRECONFIRMACIÓN%'
      OR name LIKE '1º PRECONFIRMACIÓN%';
  GET DIAGNOSTICS v_renamed = ROW_COUNT;

  -- ------------------------------------------------------- 5. dejar constancia
  -- Dentro de la misma transacción: si la promoción se deshace, el registro
  -- también, y el botón vuelve a estar disponible.
  INSERT INTO public.academic_year_promotions (academic_year_start, summary)
  VALUES (
    v_target_year,
    jsonb_build_object(
      'alumnos_baja',       coalesce(array_length(v_graduating_students, 1), 0),
      'grupos_eliminados',  v_deleted_groups,
      'grupos_renombrados', v_renamed
    )
  );

  -- p_dry_run permite ensayar la operación completa y descartarla: se calcula
  -- todo de verdad y se deshace al lanzar la excepción, que aborta la transacción.
  IF p_dry_run THEN
    RAISE EXCEPTION 'DRY_RUN_OK %', jsonb_build_object(
      'grupos_graduados',   coalesce(array_length(v_graduating_groups, 1), 0),
      'alumnos_baja',       coalesce(array_length(v_graduating_students, 1), 0),
      'asistencias',        v_deleted_attendance,
      'incidencias',        v_deleted_incidents,
      'servicios',          v_deleted_services,
      'grupos_renombrados', v_renamed
    )::text
      USING ERRCODE = 'no_data';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'alumnos_dados_de_baja',   coalesce(array_length(v_graduating_students, 1), 0),
    'ids_alumnos',             to_jsonb(v_graduating_students),
    'grupos_eliminados',       v_deleted_groups,
    'grupos_renombrados',      v_renamed,
    'filas_borradas', jsonb_build_object(
      'student_attendance',                v_deleted_attendance,
      'incidents',                         v_deleted_incidents,
      'mass_services',                     v_deleted_services,
      'parent_email_verification_tokens',  v_deleted_tokens,
      'student_public_access',             v_deleted_access,
      'students',                          v_deleted_students,
      'group_catechist',                   v_deleted_links
    ),
    'parent_email_verifications_desvinculadas', v_cleared_verif
  );
END;
$$;

-- Solo la clave de servicio (edge function). Nunca desde el navegador.
REVOKE ALL ON FUNCTION public.promote_academic_year(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.promote_academic_year(boolean) FROM anon;
REVOKE ALL ON FUNCTION public.promote_academic_year(boolean) FROM authenticated;
