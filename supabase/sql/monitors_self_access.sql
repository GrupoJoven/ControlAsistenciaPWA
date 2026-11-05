-- ============================================================================
-- Un monitor con usuario de la app ve lo suyo
--
-- monitors.sql dejó todo lo de monitores en manos de los coordinadores: la
-- tabla monitors, el calendario de actividades y la asistencia solo los lee
-- quien coordina la etapa. Eso basta mientras los monitores no entran en la
-- app, que es lo normal.
--
-- Pero desde el registro de monitores se le puede crear el usuario a uno
-- (Acceso a la app → Crear usuario de la app): se le da un perfil de
-- 'catechist' con su etapa de monitores y se apunta monitors.profile_id. Sin
-- este script, ese monitor entraría y se encontraría el resumen a cero y el
-- calendario vacío, porque no puede leer ni su propia ficha.
--
-- Aquí se le añade lo mínimo, SOLO de lectura y SOLO lo suyo:
--
--   * su ficha de monitor,
--   * su asistencia (días de actividad y reuniones),
--   * el calendario de actividades de su etapa, que es lo que la app le pinta.
--
-- Lo de los demás monitores sigue siendo cosa de los coordinadores: estas
-- políticas son PERMISSIVE y se suman a las de monitors.sql, no las sustituyen.
--
-- Orden de ejecución: después de monitors.sql. No hace falta volver a
-- desplegar ninguna edge function.
-- ============================================================================


-- La ficha de monitor del usuario actual, si tiene una. SECURITY DEFINER para
-- que no dependa de las políticas de monitors (que es justo lo que define).
CREATE OR REPLACE FUNCTION public.my_monitor_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id
  FROM public.monitors m
  WHERE m.profile_id = auth.uid()
  LIMIT 1;
$$;


-- ---------------------------------------------------------------- monitors
DROP POLICY IF EXISTS "monitors_select_self" ON public.monitors;

CREATE POLICY "monitors_select_self"
  ON public.monitors
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());


-- ------------------------------------------------------- monitor_attendance
DROP POLICY IF EXISTS "monitor_attendance_select_self" ON public.monitor_attendance;

CREATE POLICY "monitor_attendance_select_self"
  ON public.monitor_attendance
  FOR SELECT
  TO authenticated
  USING (monitor_id = public.my_monitor_id());

DROP POLICY IF EXISTS "monitor_attendance_events_select_self" ON public.monitor_attendance_events;

CREATE POLICY "monitor_attendance_events_select_self"
  ON public.monitor_attendance_events
  FOR SELECT
  TO authenticated
  USING (monitor_id = public.my_monitor_id());


-- -------------------------------------------------- monitor_activity_days
-- El calendario de su etapa. current_user_stages() ya devuelve 'communion' o
-- 'postcommunion' para quien tenga esa etapa en su perfil, así que a un
-- catequista de la catequesis no le cuadra ninguna fila.
DROP POLICY IF EXISTS "monitor_activity_days_select_own_stage" ON public.monitor_activity_days;

CREATE POLICY "monitor_activity_days_select_own_stage"
  ON public.monitor_activity_days
  FOR SELECT
  TO authenticated
  USING (stage = ANY (public.current_user_stages()));


-- ============================================================================
-- Comprobación (opcional)
--
--   -- Qué ve un monitor con usuario, puesto en su sesión:
--   SELECT name, stage, role FROM public.monitors;          -- solo su ficha
--   SELECT * FROM public.monitor_activity_days;             -- solo su etapa
--   SELECT * FROM public.monitor_attendance;                -- solo la suya
-- ============================================================================
