-- ============================================================================
-- Eventos específicos: invitados y asistencia opcional
--
-- Hasta ahora un evento de la agenda iba dirigido a una etapa
-- (parish_events.stage) y, desde event_grades.sql, a un curso de esa etapa
-- (parish_events.grade). Este script añade los eventos ESPECÍFICOS: en vez de
-- a una etapa, van dirigidos a una lista de invitados.
--
--   parish_events.invite_only            false (por defecto) -> evento de
--                                        etapa y curso, como hasta ahora
--                                        true -> solo lo ven los invitados
--   parish_events.counts_for_attendance  true (por defecto) -> cuenta para el
--                                        porcentaje de asistencia
--                                        false -> informativo: no suma ni resta
--   parish_event_invitees(event_id, profile_id)  los invitados
--
-- En un evento específico, stage y grade ya NO dicen a quién va dirigido: solo
-- quién lo GESTIONA, que es lo que mira can_manage_event_stage(). El
-- coordinador global los crea con stage 'all' y el de etapa con la suya, así
-- que quien lo crea lo ve, lo puede borrar y puede pasar lista aunque no esté
-- invitado (la política de gestión es PERMISSIVE y FOR ALL). Lo que no hace es
-- salirle en su agenda ni contarle para la asistencia: eso va por invitación.
--
-- Reglas de visibilidad (las mismas que src/utils/stages.ts):
--   invite_only -> lo ve quien esté en parish_event_invitees
--   si no       -> la regla de etapa y curso de event_grades.sql
--
-- La asistencia de un evento que no va dirigido a alguien no se cuenta ni a
-- favor ni en contra: lo filtran el cliente (calculateCatechistRate) y la edge
-- function generate-monthly-report, igual que con las etapas y los cursos.
--
-- Orden de ejecución:
--   1. stages.sql
--   2. event_grades.sql (este fichero usa su regla de etapa y curso)
--   3. Este fichero.
--   4. Volver a desplegar las edge functions send-push-notifications y
--      generate-monthly-report.
-- ============================================================================


-- ============================================================================
-- 1. Columnas
-- ============================================================================

ALTER TABLE public.parish_events
  ADD COLUMN IF NOT EXISTS invite_only boolean NOT NULL DEFAULT false;

ALTER TABLE public.parish_events
  ADD COLUMN IF NOT EXISTS counts_for_attendance boolean NOT NULL DEFAULT true;

ALTER TABLE public.parish_events
  DROP CONSTRAINT IF EXISTS parish_events_invite_only_check;

-- En un evento específico no hay curso al que afinar: van los invitados.
ALTER TABLE public.parish_events
  ADD CONSTRAINT parish_events_invite_only_check
  CHECK (NOT invite_only OR grade = 0);


-- ============================================================================
-- 2. Tabla de invitados
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.parish_event_invitees (
  event_id   uuid NOT NULL REFERENCES public.parish_events(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id)      ON DELETE CASCADE,
  PRIMARY KEY (event_id, profile_id)
);

-- Para la pregunta que más se hace: "¿estoy invitado a este evento?".
CREATE INDEX IF NOT EXISTS parish_event_invitees_profile_idx
  ON public.parish_event_invitees (profile_id);

ALTER TABLE public.parish_event_invitees ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.parish_event_invitees TO authenticated;


-- ============================================================================
-- 3. Funciones de apoyo
-- ============================================================================

CREATE OR REPLACE FUNCTION public.profile_is_invited(_profile_id uuid, _event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.parish_event_invitees i
    WHERE i.event_id = _event_id
      AND i.profile_id = _profile_id
  );
$$;

-- ¿Va este evento dirigido a este perfil? Si es específico manda la lista de
-- invitados; si no, la regla de etapa y curso de event_grades.sql.
CREATE OR REPLACE FUNCTION public.profile_sees_event_row(
  _profile_id  uuid,
  _event_id    uuid,
  _stage       text,
  _grade       smallint,
  _invite_only boolean
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN coalesce(_invite_only, false)
      THEN public.profile_is_invited(_profile_id, _event_id)
    ELSE public.profile_sees_event(_profile_id, _stage, _grade)
  END;
$$;

-- Sustituye a can_see_event(_stage, _grade): ahora también mira los invitados.
CREATE OR REPLACE FUNCTION public.can_see_event(
  _event_id    uuid,
  _stage       text,
  _grade       smallint,
  _invite_only boolean
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.profile_sees_event_row(auth.uid(), _event_id, _stage, _grade, _invite_only);
$$;

-- ¿Puede el usuario actual gestionar este evento? Es can_manage_event_stage()
-- pero partiendo del id, para las políticas de parish_event_invitees. Lee
-- parish_events como SECURITY DEFINER para no depender de su propia política.
CREATE OR REPLACE FUNCTION public.can_manage_event(_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_manage_event_stage((
    SELECT e.stage FROM public.parish_events e WHERE e.id = _event_id
  ));
$$;


-- ============================================================================
-- 4. Políticas RLS
--
-- La de gestión de parish_events (parish_events_coordinator_manage, en
-- stages.sql) no cambia: quién puede crear o borrar un evento sigue dependiendo
-- solo de la etapa.
-- ============================================================================

DROP POLICY IF EXISTS "parish_events_select_visible" ON public.parish_events;

CREATE POLICY "parish_events_select_visible"
  ON public.parish_events
  FOR SELECT
  TO authenticated
  USING (public.can_see_event(id, stage, grade, invite_only));

-- Ya no la usa ninguna política (hay que borrarla DESPUÉS de recrearla).
DROP FUNCTION IF EXISTS public.can_see_event(text, smallint);

-- Cada uno ve su invitación; el coordinador que gestiona el evento ve la lista
-- entera, que necesita para pasar lista y para calcular los porcentajes.
DROP POLICY IF EXISTS "parish_event_invitees_select_visible" ON public.parish_event_invitees;

CREATE POLICY "parish_event_invitees_select_visible"
  ON public.parish_event_invitees
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid() OR public.can_manage_event(event_id));

DROP POLICY IF EXISTS "parish_event_invitees_manage" ON public.parish_event_invitees;

CREATE POLICY "parish_event_invitees_manage"
  ON public.parish_event_invitees
  FOR ALL
  TO authenticated
  USING (public.can_manage_event(event_id))
  WITH CHECK (public.can_manage_event(event_id));


-- ============================================================================
-- 5. Comprobación
--
-- Qué eventos ve cada perfil, para repasarlo de un vistazo:
--
--   SELECT p.name,
--          e.title,
--          e.stage,
--          e.grade,
--          e.invite_only,
--          e.counts_for_attendance,
--          public.profile_sees_event_row(p.id, e.id, e.stage, e.grade, e.invite_only) AS lo_ve
--   FROM public.profiles p
--   CROSS JOIN public.parish_events e
--   ORDER BY e.date, p.name;
-- ============================================================================
