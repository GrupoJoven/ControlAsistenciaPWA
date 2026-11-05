-- ============================================================================
-- Monitores de comunión y de postcomunión
--
-- Hasta ahora había dos etapas (preconfirmación y confirmación), todas con
-- grupos, niños y catequistas con usuario de la app. Este script añade dos
-- etapas más, de MONITORES:
--
--   'communion'      monitores de comunión
--   'postcommunion'  monitores de postcomunión
--
-- Son distintas de las de catequesis en tres cosas:
--
--   1. Los monitores NO tienen usuario de la app: no pasan asistencia a los
--      niños, así que no hace falta cargarles la aplicación. Viven en la tabla
--      nueva public.monitors, no en profiles. Quien SÍ entra en la app es su
--      coordinador, que es un profiles.role = 'coordinator' con
--      profiles.stage = 'communion' o 'postcommunion'.
--   2. No tienen grupos ni cursos: un evento de estas etapas lleva siempre
--      grade = 0, y la etapa 'all' ("ambas etapas") NO les llega: su
--      calendario y sus reuniones son independientes de la catequesis.
--   3. Su asistencia se guarda en monitor_attendance(_events), con la misma
--      forma de contar que la de los catequistas:
--        - comunión: una sola casilla por actividad (catequesis, sin misa)
--        - postcomunión: misa + actividad, con los pesos de siempre
--        - reuniones: valen 1, como los eventos de la agenda
--      Los pesos están en src/utils/monitors.ts (calculateMonitorDayWeight).
--
-- La tabla monitors repite a propósito las columnas de profiles (name, email,
-- birth_date, photo_path, role, stage) y guarda profile_id. Así, el día que un
-- monitor necesite entrar en la app, basta crear el usuario de auth con esos
-- mismos datos en user_metadata (handle_new_user() rellena profiles) y apuntar
-- monitors.profile_id a la fila nueva: su historial de asistencia se queda
-- donde está y no hay que mover nada.
--
-- Reglas que deben coincidir con src/utils/stages.ts y src/utils/monitors.ts.
-- Si cambias una, cambia la otra.
--
-- Orden de ejecución:
--   1. stages.sql
--   2. event_grades.sql
--   3. event_invitees.sql
--   4. Este fichero.
--   5. Volver a desplegar las edge functions create-catechist,
--      send-push-notifications y family-inbox: las tres tienen que aceptar
--      ahora las etapas nuevas.
-- ============================================================================


-- ============================================================================
-- 1. Etapas nuevas en los checks
-- ============================================================================

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_stage_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_stage_check
  CHECK (stage IS NULL OR stage IN (
    'preconfirmation', 'confirmation', 'communion', 'postcommunion'
  ));

ALTER TABLE public.parish_events
  DROP CONSTRAINT IF EXISTS parish_events_stage_check;

ALTER TABLE public.parish_events
  ADD CONSTRAINT parish_events_stage_check
  CHECK (stage IN (
    'preconfirmation', 'confirmation', 'communion', 'postcommunion', 'all'
  ));

-- Las etapas de monitores no tienen cursos: sus reuniones son para todos.
-- (Sustituye al check de event_grades.sql, que solo excluía 'all'.)
ALTER TABLE public.parish_events
  DROP CONSTRAINT IF EXISTS parish_events_grade_check;

ALTER TABLE public.parish_events
  ADD CONSTRAINT parish_events_grade_check
  CHECK (
    grade IN (0, 1, 2)
    AND (stage IN ('preconfirmation', 'confirmation') OR grade = 0)
  );

-- monthly_reports no cambia: los informes con IA son de niños y de catequistas,
-- y las etapas de monitores no los generan.


-- ============================================================================
-- 2. Funciones de apoyo de las etapas
-- ============================================================================

-- Las dos etapas de catequesis, que son las que cubre un evento de 'all'.
CREATE OR REPLACE FUNCTION public.catechesis_stages()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY['preconfirmation', 'confirmation']::text[];
$$;

CREATE OR REPLACE FUNCTION public.monitor_stages()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT ARRAY['communion', 'postcommunion']::text[];
$$;

CREATE OR REPLACE FUNCTION public.is_monitor_stage(_stage text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT _stage = ANY (public.monitor_stages());
$$;

-- El coordinador general las lleva todas, también las de monitores.
CREATE OR REPLACE FUNCTION public.profile_stages(_profile_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT CASE
      WHEN p.role = 'coordinator' AND p.stage IS NULL
        THEN public.catechesis_stages() || public.monitor_stages()
      ELSE
        -- Puede repetir una etapa si está en profiles.stage y en un grupo;
        -- da igual, solo se usa con = ANY y &&.
        (
          SELECT coalesce(array_agg(DISTINCT g.stage), '{}'::text[])
          FROM public.group_catechist gc
          JOIN public.groups g ON g.id = gc.group_id
          WHERE gc.profile_id = p.id
            AND g.stage IS NOT NULL
        )
        || CASE WHEN p.stage IS NOT NULL THEN ARRAY[p.stage] ELSE '{}'::text[] END
    END
    FROM public.profiles p
    WHERE p.id = _profile_id
  ), '{}'::text[]);
$$;

-- Igual que antes, más los cursos "de relleno" de las etapas de monitores:
-- no tienen cursos de verdad, pero el coordinador general tiene que verlas
-- enteras, como el de cada etapa (que ya los recibe por la rama general:
-- coordina la etapa y no tiene grupos de los que sacar el curso).
CREATE OR REPLACE FUNCTION public.profile_stage_grades(_profile_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_global_profile(_profile_id) THEN
      ARRAY[
        'preconfirmation:1', 'preconfirmation:2',
        'confirmation:1',    'confirmation:2',
        'communion:1',       'communion:2',
        'postcommunion:1',   'postcommunion:2'
      ]::text[]
    ELSE
      coalesce((
        SELECT array_agg(DISTINCT s.stage || ':' || gr.grade)
        FROM unnest(public.profile_stages(_profile_id)) AS s(stage)
        CROSS JOIN LATERAL (
          -- Los cursos de sus grupos de esa etapa.
          SELECT public.group_grade(g.name) AS grade
          FROM public.group_catechist gc
          JOIN public.groups g ON g.id = gc.group_id
          WHERE gc.profile_id = _profile_id
            AND g.stage = s.stage
            AND public.group_grade(g.name) IS NOT NULL

          UNION

          -- O los dos, si lleva la etapa entera: la coordina, o está en ella
          -- sin ningún grupo del que sacar el curso (que es siempre el caso
          -- en comunión y postcomunión, donde no hay grupos).
          SELECT v.grade
          FROM (VALUES (1::smallint), (2::smallint)) AS v(grade)
          WHERE s.stage = public.profile_coordinator_stage(_profile_id)
             OR NOT EXISTS (
                  SELECT 1
                  FROM public.group_catechist gc2
                  JOIN public.groups g2 ON g2.id = gc2.group_id
                  WHERE gc2.profile_id = _profile_id
                    AND g2.stage = s.stage
                    AND public.group_grade(g2.name) IS NOT NULL
                )
        ) AS gr(grade)
      ), '{}'::text[])
  END;
$$;

-- Un evento de 'all' es de "ambas etapas" DE CATEQUESIS: no le llega a los
-- monitores, cuyo calendario y reuniones son independientes.
CREATE OR REPLACE FUNCTION public.profile_sees_event(
  _profile_id uuid,
  _stage text,
  _grade smallint
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    -- Para todos los cursos: basta pertenecer a la etapa.
    WHEN coalesce(_grade, 0) NOT IN (1, 2) THEN
      CASE
        WHEN _stage = 'all'
          THEN public.profile_stages(_profile_id) && public.catechesis_stages()
        ELSE _stage = ANY (public.profile_stages(_profile_id))
      END
    -- De un curso concreto: hay que llevar ese curso en esa etapa.
    WHEN _stage = 'all' THEN
      public.profile_stage_grades(_profile_id) && ARRAY[
        'preconfirmation:' || _grade,
        'confirmation:'    || _grade
      ]
    ELSE
      (_stage || ':' || _grade) = ANY (public.profile_stage_grades(_profile_id))
  END;
$$;


-- ============================================================================
-- 3. Tabla de monitores
--
-- Las columnas name, email, birth_date, photo_path, role y stage son las
-- mismas que en profiles, para que ascender a un monitor a usuario de la app
-- sea copiar la fila (ver la cabecera del fichero).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.monitors (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage      text NOT NULL,
  name       text NOT NULL,
  email      text,
  phone      text,
  birth_date date,
  photo_path text,
  -- Dentro de la etapa: 'monitor' o el 'coordinator' que la lleva en la app.
  role       text NOT NULL DEFAULT 'monitor',
  active     boolean NOT NULL DEFAULT true,
  -- Perfil de la app, si lo tiene. Es lo que hace de puente con profiles: su
  -- coordinador lo tiene desde el principio y un monitor el día que se le dé
  -- acceso. ON DELETE SET NULL: borrar el usuario no borra su historial.
  profile_id uuid UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.monitors
  DROP CONSTRAINT IF EXISTS monitors_stage_check;

ALTER TABLE public.monitors
  ADD CONSTRAINT monitors_stage_check
  CHECK (stage IN ('communion', 'postcommunion'));

ALTER TABLE public.monitors
  DROP CONSTRAINT IF EXISTS monitors_role_check;

ALTER TABLE public.monitors
  ADD CONSTRAINT monitors_role_check
  CHECK (role IN ('monitor', 'coordinator'));

CREATE INDEX IF NOT EXISTS monitors_stage_idx ON public.monitors (stage);
CREATE INDEX IF NOT EXISTS monitors_profile_idx ON public.monitors (profile_id);

CREATE OR REPLACE FUNCTION public.touch_monitor_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_monitors_touch ON public.monitors;

CREATE TRIGGER trg_monitors_touch
  BEFORE UPDATE ON public.monitors
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_monitor_updated_at();


-- ============================================================================
-- 4. Calendario de actividades
--
-- El equivalente de class_days, pero uno por etapa de monitores: comunión y
-- postcomunión lo fijan cada una por su cuenta. class_days se queda como
-- está, para la catequesis.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.monitor_activity_days (
  stage text NOT NULL,
  date  date NOT NULL,
  PRIMARY KEY (stage, date)
);

ALTER TABLE public.monitor_activity_days
  DROP CONSTRAINT IF EXISTS monitor_activity_days_stage_check;

ALTER TABLE public.monitor_activity_days
  ADD CONSTRAINT monitor_activity_days_stage_check
  CHECK (stage IN ('communion', 'postcommunion'));

CREATE INDEX IF NOT EXISTS monitor_activity_days_date_idx
  ON public.monitor_activity_days (date);


-- ============================================================================
-- 5. Asistencia
--
--   activity  la casilla principal: "catequesis" en comunión, "actividad" en
--             postcomunión.
--   mass      solo en postcomunión (va antes que la actividad por horario).
--             En comunión se queda a NULL: no tienen misa.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.monitor_attendance (
  monitor_id uuid NOT NULL REFERENCES public.monitors(id) ON DELETE CASCADE,
  date       date NOT NULL,
  activity   text,
  mass       text,
  PRIMARY KEY (monitor_id, date)
);

ALTER TABLE public.monitor_attendance
  DROP CONSTRAINT IF EXISTS monitor_attendance_activity_check;

ALTER TABLE public.monitor_attendance
  ADD CONSTRAINT monitor_attendance_activity_check
  CHECK (activity IS NULL OR activity IN ('present', 'absent', 'late'));

ALTER TABLE public.monitor_attendance
  DROP CONSTRAINT IF EXISTS monitor_attendance_mass_check;

ALTER TABLE public.monitor_attendance
  ADD CONSTRAINT monitor_attendance_mass_check
  CHECK (mass IS NULL OR mass IN ('present', 'absent', 'late'));

CREATE INDEX IF NOT EXISTS monitor_attendance_date_idx
  ON public.monitor_attendance (date);

CREATE TABLE IF NOT EXISTS public.monitor_attendance_events (
  monitor_id uuid NOT NULL REFERENCES public.monitors(id) ON DELETE CASCADE,
  event_id   uuid NOT NULL REFERENCES public.parish_events(id) ON DELETE CASCADE,
  date       date NOT NULL,
  status     text,
  PRIMARY KEY (monitor_id, event_id, date)
);

ALTER TABLE public.monitor_attendance_events
  DROP CONSTRAINT IF EXISTS monitor_attendance_events_status_check;

ALTER TABLE public.monitor_attendance_events
  ADD CONSTRAINT monitor_attendance_events_status_check
  CHECK (status IS NULL OR status IN ('present', 'absent', 'late'));

CREATE INDEX IF NOT EXISTS monitor_att_events_event_idx
  ON public.monitor_attendance_events (event_id);

CREATE INDEX IF NOT EXISTS monitor_att_events_date_idx
  ON public.monitor_attendance_events (date);


-- ============================================================================
-- 6. Quién gestiona qué
--
-- can_access_stage() ya hace lo que hace falta: el coordinador general llega a
-- las dos etapas de monitores y el de cada una, solo a la suya. Por eso mover
-- un monitor de comunión a postcomunión solo lo puede hacer el general: al
-- coordinador de etapa le falla el WITH CHECK de la etapa de destino.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.can_manage_monitor(_monitor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_access_stage((
    SELECT m.stage FROM public.monitors m WHERE m.id = _monitor_id
  ));
$$;


-- ============================================================================
-- 7. Políticas RLS
--
-- Todo lo de monitores es cosa de coordinadores: nadie más lo ve. Un monitor
-- con perfil de la app (profile_id) tampoco, mientras no coordine la etapa.
-- ============================================================================

ALTER TABLE public.monitors                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitor_activity_days     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitor_attendance        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitor_attendance_events ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.monitors                  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monitor_activity_days     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monitor_attendance        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monitor_attendance_events TO authenticated;

DROP POLICY IF EXISTS "monitors_manage" ON public.monitors;

CREATE POLICY "monitors_manage"
  ON public.monitors
  FOR ALL
  TO authenticated
  USING (public.can_access_stage(stage))
  WITH CHECK (public.can_access_stage(stage));

DROP POLICY IF EXISTS "monitor_activity_days_manage" ON public.monitor_activity_days;

CREATE POLICY "monitor_activity_days_manage"
  ON public.monitor_activity_days
  FOR ALL
  TO authenticated
  USING (public.can_access_stage(stage))
  WITH CHECK (public.can_access_stage(stage));

DROP POLICY IF EXISTS "monitor_attendance_manage" ON public.monitor_attendance;

CREATE POLICY "monitor_attendance_manage"
  ON public.monitor_attendance
  FOR ALL
  TO authenticated
  USING (public.can_manage_monitor(monitor_id))
  WITH CHECK (public.can_manage_monitor(monitor_id));

DROP POLICY IF EXISTS "monitor_attendance_events_manage" ON public.monitor_attendance_events;

CREATE POLICY "monitor_attendance_events_manage"
  ON public.monitor_attendance_events
  FOR ALL
  TO authenticated
  USING (public.can_manage_monitor(monitor_id))
  WITH CHECK (public.can_manage_monitor(monitor_id));


-- ============================================================================
-- 8. Comprobación rápida (opcional)
--
--    -- Qué etapas lleva cada perfil:
--    SELECT p.name, p.role, p.stage, public.profile_stages(p.id)
--    FROM public.profiles p ORDER BY p.role, p.name;
--
--    -- Un evento de 'all' no debe llegarle al coordinador de comunión:
--    SELECT p.name, public.profile_sees_event(p.id, 'all', 0::smallint)
--    FROM public.profiles p WHERE p.stage IN ('communion', 'postcommunion');
--
--    -- Monitores por etapa:
--    SELECT stage, role, name, (profile_id IS NOT NULL) AS tiene_usuario
--    FROM public.monitors ORDER BY stage, role, name;
-- ============================================================================
