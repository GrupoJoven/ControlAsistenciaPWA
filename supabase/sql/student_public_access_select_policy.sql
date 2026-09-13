-- ============================================================================
-- Lectura de student_public_access para catequistas
--
-- La app carga el ID público de cada alumno anidado en la consulta de
-- students (src/app/loaders.ts -> student_public_access(public_id)). Con RLS,
-- si el usuario no tiene ninguna política SELECT que le permita ver la fila de
-- student_public_access, PostgREST no da error: devuelve null en la relación
-- anidada y la ficha muestra "No asignado". Eso es lo que ven los catequistas
-- cuando solo los coordinadores tienen política de lectura.
--
-- La regla que se aplica aquí es: quien puede ver la fila de students puede
-- ver su ID público. Así hereda exactamente la misma visibilidad que ya tiene
-- students (catequista -> sus grupos, coordinador -> todo) sin duplicar la
-- lógica de group_catechist.
-- ============================================================================

-- 1. Antes de aplicar nada, mira qué políticas hay ahora mismo:
--
--    SELECT tablename, policyname, cmd, roles, qual, with_check
--    FROM pg_policies
--    WHERE schemaname = 'public'
--      AND tablename IN ('student_public_access', 'students')
--    ORDER BY tablename, policyname;
--
--    Y que el rol authenticated tiene permiso SELECT sobre la tabla (si no,
--    la consulta entera de students falla con "permission denied"):
--
--    SELECT grantee, privilege_type
--    FROM information_schema.role_table_grants
--    WHERE table_schema = 'public' AND table_name = 'student_public_access';

-- 2. Permiso de tabla (inofensivo si ya existe).
GRANT SELECT ON public.student_public_access TO authenticated;

-- 3. Política de lectura. Las políticas PERMISSIVE se combinan con OR, así que
--    no interfiere con la de coordinadores que ya exista.
ALTER TABLE public.student_public_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_public_access_select_visible_student"
  ON public.student_public_access;

CREATE POLICY "student_public_access_select_visible_student"
  ON public.student_public_access
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.students s
      WHERE s.id = student_public_access.student_id
    )
  );

-- 4. Comprobación: ejecuta esto en el SQL editor suplantando a un catequista
--    (cambia el uuid). Debe devolver sus alumnos con public_id relleno.
--
--    BEGIN;
--    SET LOCAL ROLE authenticated;
--    SELECT set_config('request.jwt.claims',
--      '{"sub":"<uuid-del-catequista>","role":"authenticated"}', true);
--    SELECT s.name, spa.public_id
--    FROM public.students s
--    LEFT JOIN public.student_public_access spa ON spa.student_id = s.id;
--    ROLLBACK;
