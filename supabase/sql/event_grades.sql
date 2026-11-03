-- ============================================================================
-- Eventos por curso dentro de la etapa
--
-- Hasta ahora un evento de la agenda iba dirigido a una etapa entera
-- (parish_events.stage) o a las dos ('all'). Este script añade el CURSO:
--
--   parish_events.grade  0 (por defecto) -> todos los cursos de su etapa
--                        1 -> solo el primer curso de esa etapa
--                        2 -> solo el segundo curso de esa etapa
--
-- Un evento de un curso lo es de un curso de UNA etapa: no hay eventos para
-- los primeros de las dos a la vez, serían dos eventos distintos. Por eso un
-- evento de stage 'all' siempre lleva grade 0.
--
-- El curso de un grupo sale de su nombre, igual que la etapa: los grupos se
-- llaman "1º PRECONFIRMACIÓN (A)", "2º CONFIRMACIÓN (B)"..., así que el curso
-- es el número con el que empiezan. No hace falta columna en groups: con el
-- nombre basta, y así la promoción de curso (que renombra los grupos) no tiene
-- que mantener nada más.
--
-- Los cursos EFECTIVOS de un usuario en cada una de sus etapas
-- (profile_stage_grades) son:
--   coordinador global                    -> los dos cursos de las dos etapas
--   coordinador de esa etapa              -> los dos cursos de su etapa
--                                            (gestiona sus eventos, aunque
--                                            tenga grupos de un solo curso)
--   con grupos en esa etapa               -> los cursos de esos grupos
--   en la etapa sin grupos (profiles.stage) -> los dos: sin grupo no hay curso
--                                            con el que afinar
--
-- Estas reglas deben coincidir con las de src/utils/stages.ts
-- (getGroupGrade() y getUserStageGrades()). Si cambias una, cambia la otra.
--
-- Orden de ejecución:
--   1. stages.sql (este fichero usa sus funciones: profile_stages(),
--      is_global_profile(), groups.stage...).
--   2. Este fichero.
--   3. Volver a desplegar las edge functions send-push-notifications y
--      generate-monthly-report: la primera llama a profile_ids_for_stage(),
--      que aquí cambia de firma (ahora recibe también el curso).
--   4. event_invitees.sql, que añade los eventos específicos (por lista de
--      invitados) y vuelve a sustituir la política de lectura de
--      parish_events y can_see_event().
-- ============================================================================


-- ============================================================================
-- 1. Columna
-- ============================================================================

ALTER TABLE public.parish_events
  ADD COLUMN IF NOT EXISTS grade smallint NOT NULL DEFAULT 0;

ALTER TABLE public.parish_events
  DROP CONSTRAINT IF EXISTS parish_events_grade_check;

-- Un evento de las dos etapas es para todo el mundo: no puede ir a un curso.
ALTER TABLE public.parish_events
  ADD CONSTRAINT parish_events_grade_check
  CHECK (grade IN (0, 1, 2) AND (stage <> 'all' OR grade = 0));


-- ============================================================================
-- 2. Funciones de apoyo
-- ============================================================================

-- Curso de un grupo a partir de su nombre. Se corta en el primer carácter para
-- no depender del "º" ni de la configuración regional.
CREATE OR REPLACE FUNCTION public.group_grade(p_name text)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE left(btrim(coalesce(p_name, '')), 1)
    WHEN '1' THEN 1::smallint
    WHEN '2' THEN 2::smallint
    ELSE NULL
  END;
$$;

-- Etapa del coordinador que sea este perfil. NULL si es global o si no es
-- coordinator. Es coordinator_stage() pero para un perfil cualquiera.
CREATE OR REPLACE FUNCTION public.profile_coordinator_stage(_profile_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.stage
  FROM public.profiles p
  WHERE p.id = _profile_id
    AND p.role = 'coordinator';
$$;

-- Etapas y cursos efectivos de un perfil, como 'preconfirmation:1'. Nunca
-- devuelve NULL: '{}' si no tiene ninguno.
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
        'confirmation:1',    'confirmation:2'
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
          -- sin ningún grupo del que sacar el curso.
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

-- ¿Va un evento de esta etapa y curso dirigido a este perfil?
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
    -- Para todos los cursos: basta pertenecer a la etapa, como antes.
    WHEN coalesce(_grade, 0) NOT IN (1, 2) THEN
      _stage = 'all' OR _stage = ANY (public.profile_stages(_profile_id))
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

-- Sustituye a can_see_event_stage(text): ahora también mira el curso.
-- OJO: la sustituye can_see_event(_event_id, _stage, _grade, _invite_only) en
-- event_invitees.sql, que además mira los invitados.
CREATE OR REPLACE FUNCTION public.can_see_event(_stage text, _grade smallint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.profile_sees_event(auth.uid(), _stage, _grade);
$$;


-- ============================================================================
-- 3. Política RLS de parish_events
--
-- La de gestión (parish_events_coordinator_manage) no cambia: quién puede
-- crear o borrar un evento sigue dependiendo solo de la etapa. Como es
-- PERMISSIVE y FOR ALL, un coordinador de etapa ve los eventos de su etapa sea
-- del curso que sea, igual que los gestiona.
-- ============================================================================

DROP POLICY IF EXISTS "parish_events_select_visible" ON public.parish_events;

-- La sustituye la de event_invitees.sql, que además mira los invitados.
CREATE POLICY "parish_events_select_visible"
  ON public.parish_events
  FOR SELECT
  TO authenticated
  USING (public.can_see_event(stage, grade));

-- Ya no la usa ninguna política (hay que borrarla DESPUÉS de recrearla).
DROP FUNCTION IF EXISTS public.can_see_event_stage(text);


-- ============================================================================
-- 4. Destinatarios de las notificaciones push
--
-- Cambia de firma: la edge function send-push-notifications tiene que pasar
-- ahora el curso, así que hay que volver a desplegarla.
-- ============================================================================

DROP FUNCTION IF EXISTS public.profile_ids_for_stage(text);

CREATE OR REPLACE FUNCTION public.profile_ids_for_stage(p_stage text, p_grade smallint)
RETURNS TABLE(profile_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id AS profile_id
  FROM public.profiles p
  WHERE (p.role = 'coordinator' AND p.stage IS NULL)
     OR public.profile_sees_event(p.id, p_stage, p_grade);
$$;

REVOKE ALL ON FUNCTION public.profile_ids_for_stage(text, smallint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profile_ids_for_stage(text, smallint) TO service_role;
