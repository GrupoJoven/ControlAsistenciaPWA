-- ============================================================================
-- Etapas: preconfirmación y confirmación
--
-- Hasta ahora había dos roles: catechist y coordinator, y el coordinator lo
-- veía todo. Este script añade la noción de ETAPA para que pueda haber
-- coordinadores de preconfirmación y de confirmación que solo lleguen a lo
-- suyo, y para que los catequistas no vean los eventos de la otra etapa.
--
--   profiles.stage       'preconfirmation' | 'confirmation' | NULL
--                        En un coordinator, NULL significa GLOBAL (lo ve todo).
--                        En un catechist es opcional: sus etapas salen de sus
--                        grupos; se rellena al crearlo un coordinador de etapa
--                        para que le aparezca antes de asignarle grupo.
--   groups.stage         Columna generada a partir del nombre: los grupos se
--                        llaman "1º PRECONFIRMACIÓN (A)", "2º CONFIRMACIÓN (B)",
--                        etc. Se recalcula sola cuando la promoción renombra.
--   parish_events.stage  'preconfirmation' | 'confirmation' | 'all'
--   monthly_reports.stage idem: los informes "todos los niños / todo el equipo"
--                        de un coordinador de etapa son solo de su etapa.
--
-- Las etapas EFECTIVAS de un usuario (profile_stages) son:
--   coordinator con stage NULL  -> las dos
--   cualquier otro              -> su profiles.stage (si tiene) + las de sus grupos
--
-- Todas las funciones de apoyo son SECURITY DEFINER: se usan dentro de
-- políticas RLS y, si consultaran las tablas con RLS activo, Postgres
-- detectaría recursión (una política de profiles que lee profiles).
--
-- Orden de ejecución:
--   1. Este fichero.
--   2. create_group_with_students.sql (se ha modificado para comprobar la
--      etapa; hay que volver a crearlo).
--   3. Marcar a mano los coordinadores de etapa:
--        UPDATE public.profiles SET stage = 'confirmation' WHERE id = '...';
-- ============================================================================


-- ============================================================================
-- 1. Columnas
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stage text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_stage_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_stage_check
  CHECK (stage IS NULL OR stage IN ('preconfirmation', 'confirmation'));

-- Etapa de un grupo a partir de su nombre. Se busca PRECONFIRMACI antes que
-- CONFIRMACI porque la segunda cadena está contenida en la primera. Se corta
-- antes de la Ó para no depender de acentos ni de la configuración regional.
CREATE OR REPLACE FUNCTION public.group_stage(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN upper(coalesce(p_name, '')) LIKE '%PRECONFIRMACI%' THEN 'preconfirmation'
    WHEN upper(coalesce(p_name, '')) LIKE '%CONFIRMACI%'    THEN 'confirmation'
    ELSE NULL
  END;
$$;

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS stage text
  GENERATED ALWAYS AS (public.group_stage(name)) STORED;

ALTER TABLE public.parish_events
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'all';

ALTER TABLE public.parish_events
  DROP CONSTRAINT IF EXISTS parish_events_stage_check;

ALTER TABLE public.parish_events
  ADD CONSTRAINT parish_events_stage_check
  CHECK (stage IN ('preconfirmation', 'confirmation', 'all'));

ALTER TABLE public.monthly_reports
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'all';

ALTER TABLE public.monthly_reports
  DROP CONSTRAINT IF EXISTS monthly_reports_stage_check;

ALTER TABLE public.monthly_reports
  ADD CONSTRAINT monthly_reports_stage_check
  CHECK (stage IN ('preconfirmation', 'confirmation', 'all'));

-- El unique anterior era (scope, scope_id, month), creado como índice suelto,
-- no como constraint. Como scope_id es NULL en los informes globales, en la
-- práctica nunca se aplicaba a ellos: con NULLS NOT DISTINCT (Postgres 15+)
-- sí. Por eso antes se quitan los duplicados que hayan podido colarse,
-- conservando el más reciente de cada mes.
DROP INDEX IF EXISTS public.monthly_reports_unique;

ALTER TABLE public.monthly_reports
  DROP CONSTRAINT IF EXISTS monthly_reports_unique;

DELETE FROM public.monthly_reports older
USING public.monthly_reports newer
WHERE older.scope = newer.scope
  AND older.scope_id IS NOT DISTINCT FROM newer.scope_id
  AND older.stage = newer.stage
  AND older.month = newer.month
  AND (newer.generated_at, newer.id) > (older.generated_at, older.id);

ALTER TABLE public.monthly_reports
  ADD CONSTRAINT monthly_reports_unique
  UNIQUE NULLS NOT DISTINCT (scope, scope_id, stage, month);


-- ============================================================================
-- 2. Funciones de apoyo
-- ============================================================================

-- Coordinator sin etapa: lo ve y lo gestiona todo.
CREATE OR REPLACE FUNCTION public.is_global_coordinator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'coordinator'
      AND p.stage IS NULL
  );
$$;

-- Etapa del coordinador actual. NULL si es global o si no es coordinator.
CREATE OR REPLACE FUNCTION public.coordinator_stage()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.stage
  FROM public.profiles p
  WHERE p.id = auth.uid()
    AND p.role = 'coordinator';
$$;

CREATE OR REPLACE FUNCTION public.is_global_profile(_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = _profile_id
      AND p.role = 'coordinator'
      AND p.stage IS NULL
  );
$$;

-- Etapas efectivas de un perfil. Nunca devuelve NULL: '{}' si no tiene ninguna.
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
        THEN ARRAY['preconfirmation', 'confirmation']::text[]
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

CREATE OR REPLACE FUNCTION public.current_user_stages()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.profile_stages(auth.uid());
$$;

-- ¿Puede el usuario actual GESTIONAR (como coordinador) cosas de esta etapa?
-- Un grupo sin etapa reconocible (stage NULL) solo lo gestiona el global.
CREATE OR REPLACE FUNCTION public.can_access_stage(_stage text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_global_coordinator()
      OR (_stage IS NOT NULL AND _stage = public.coordinator_stage());
$$;

CREATE OR REPLACE FUNCTION public.can_manage_group(_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_access_stage((
    SELECT g.stage FROM public.groups g WHERE g.id = _group_id
  ));
$$;

-- Ver un grupo: el global todos; los demás los de sus etapas y, en todo
-- caso, aquellos a los que están asignados aunque el nombre no siga el patrón.
CREATE OR REPLACE FUNCTION public.can_see_group(_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_global_coordinator()
      OR EXISTS (
        SELECT 1
        FROM public.group_catechist gc
        WHERE gc.group_id = _group_id
          AND gc.profile_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.groups g
        WHERE g.id = _group_id
          AND g.stage = ANY (public.current_user_stages())
      );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_student(_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_manage_group((
    SELECT s.group_id FROM public.students s WHERE s.id = _student_id
  ));
$$;

-- Ya existía (la usan las políticas de incidents). Antes: coordinator o
-- catequista del grupo. Ahora el coordinador tiene que ser de la etapa.
CREATE OR REPLACE FUNCTION public.can_access_student(_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.can_manage_student(_student_id)
      OR EXISTS (
        SELECT 1
        FROM public.students s
        JOIN public.group_catechist gc ON gc.group_id = s.group_id
        WHERE s.id = _student_id
          AND gc.profile_id = auth.uid()
      );
$$;

-- Ver un perfil: uno mismo, los coordinadores globales (todo el mundo debe
-- poder avisarles) y cualquiera con el que se comparta etapa.
CREATE OR REPLACE FUNCTION public.can_see_profile(_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _profile_id = auth.uid()
      OR public.is_global_coordinator()
      OR public.is_global_profile(_profile_id)
      OR public.profile_stages(_profile_id) && public.current_user_stages();
$$;

-- Editar / borrar / resetear contraseña de un perfil: el global a cualquiera;
-- un coordinador de etapa solo a CATEQUISTAS de su etapa (nunca a otro
-- coordinador).
CREATE OR REPLACE FUNCTION public.can_manage_profile(_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_global_coordinator()
      OR (
        public.coordinator_stage() IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.profiles p
          WHERE p.id = _profile_id AND p.role = 'catechist'
        )
        AND public.profile_stages(_profile_id) && public.current_user_stages()
      );
$$;

-- Asistencia del equipo: la propia, o la de la gente de tu etapa si eres
-- coordinador. Un coordinador de etapa no toca la de los globales.
CREATE OR REPLACE FUNCTION public.can_manage_attendance_of(_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _profile_id = auth.uid()
      OR public.is_global_coordinator()
      OR (
        public.coordinator_stage() IS NOT NULL
        AND NOT public.is_global_profile(_profile_id)
        AND public.profile_stages(_profile_id) && public.current_user_stages()
      );
$$;

CREATE OR REPLACE FUNCTION public.can_see_event_stage(_stage text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _stage = 'all' OR _stage = ANY (public.current_user_stages());
$$;

-- Crear/editar/borrar eventos: el global cualquiera; el de etapa solo los de
-- su etapa (los de 'all' no, porque afectan a la otra).
CREATE OR REPLACE FUNCTION public.can_manage_event_stage(_stage text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_global_coordinator()
      OR (_stage <> 'all' AND public.can_access_stage(_stage));
$$;

-- Destinatarios de una notificación push por etapa. La usa la edge function
-- send-push-notifications con la clave de servicio; no se expone al cliente.
CREATE OR REPLACE FUNCTION public.profile_ids_for_stage(p_stage text)
RETURNS TABLE(profile_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id AS profile_id
  FROM public.profiles p
  WHERE p_stage = 'all'
     OR (p.role = 'coordinator' AND p.stage IS NULL)
     OR p_stage = ANY (public.profile_stages(p.id));
$$;

REVOKE ALL ON FUNCTION public.profile_ids_for_stage(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.profile_ids_for_stage(text) TO service_role;


-- ============================================================================
-- 3. Políticas RLS
--
-- Solo se tocan las políticas de coordinador (y las de lectura abierta que
-- ahora dependen de la etapa). Las de catequista se quedan como estaban.
-- Todas son PERMISSIVE, así que se combinan con OR.
-- ============================================================================

-- ---------------------------------------------------------------- profiles
DROP POLICY IF EXISTS "profiles_read_all_authenticated" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_visible"         ON public.profiles;

CREATE POLICY "profiles_select_visible"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.can_see_profile(id));

DROP POLICY IF EXISTS "coordinator can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles_coordinator_update"        ON public.profiles;

CREATE POLICY "profiles_coordinator_update"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (public.can_manage_profile(id))
  WITH CHECK (public.can_manage_profile(id));

-- RLS no distingue columnas: cualquiera que pueda actualizar un perfil (incluido
-- el propio, por profiles_self_update_limited) podría cambiarse el rol. Este
-- trigger reserva role y stage al coordinador global y a la clave de servicio
-- (auth.uid() es NULL con service_role y desde el SQL editor).
CREATE OR REPLACE FUNCTION public.guard_profile_role_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.stage IS DISTINCT FROM OLD.stage)
     AND auth.uid() IS NOT NULL
     AND NOT public.is_global_coordinator()
  THEN
    RAISE EXCEPTION 'Solo un coordinador global puede cambiar el rol o la etapa de un perfil.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_role_stage ON public.profiles;

CREATE TRIGGER trg_guard_profile_role_stage
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_role_stage();

-- ------------------------------------------------------------------ groups
DROP POLICY IF EXISTS "groups_select_all_authenticated" ON public.groups;
DROP POLICY IF EXISTS "groups_coordinator_full_access"  ON public.groups;
DROP POLICY IF EXISTS "groups_select_visible"           ON public.groups;
DROP POLICY IF EXISTS "groups_coordinator_manage"       ON public.groups;

CREATE POLICY "groups_select_visible"
  ON public.groups
  FOR SELECT
  TO authenticated
  USING (public.can_see_group(id));

-- Se evalúa sobre el nombre y no sobre la columna generada para que WITH CHECK
-- funcione igual en INSERT (antes de que exista la fila) que en UPDATE.
-- Renombrar un grupo a la otra etapa falla el WITH CHECK, que es lo deseado.
CREATE POLICY "groups_coordinator_manage"
  ON public.groups
  FOR ALL
  TO authenticated
  USING (public.can_access_stage(public.group_stage(name)))
  WITH CHECK (public.can_access_stage(public.group_stage(name)));

-- --------------------------------------------------------- group_catechist
DROP POLICY IF EXISTS "group_catechist_coordinator_full_access" ON public.group_catechist;
DROP POLICY IF EXISTS "group_catechist_coordinator_manage"      ON public.group_catechist;

CREATE POLICY "group_catechist_coordinator_manage"
  ON public.group_catechist
  FOR ALL
  TO authenticated
  USING (public.can_manage_group(group_id))
  WITH CHECK (public.can_manage_group(group_id));

-- ---------------------------------------------------------------- students
DROP POLICY IF EXISTS "students_coordinator_full_access" ON public.students;
DROP POLICY IF EXISTS "students_coordinator_manage"      ON public.students;
-- Duplicada de students_catechist_group_select (mismo USING).
DROP POLICY IF EXISTS "students_select_my_groups"        ON public.students;

CREATE POLICY "students_coordinator_manage"
  ON public.students
  FOR ALL
  TO authenticated
  USING (public.can_manage_group(group_id))
  WITH CHECK (public.can_manage_group(group_id));

-- ------------------------------------------------------ student_attendance
DROP POLICY IF EXISTS "student_attendance_coordinator_full_access" ON public.student_attendance;
DROP POLICY IF EXISTS "student_attendance_coordinator_manage"      ON public.student_attendance;

CREATE POLICY "student_attendance_coordinator_manage"
  ON public.student_attendance
  FOR ALL
  TO authenticated
  USING (public.can_manage_student(student_id))
  WITH CHECK (public.can_manage_student(student_id));

-- ---------------------------------------------------- student_public_access
-- La lectura ya la cubre student_public_access_select_visible_student (quien
-- ve al alumno ve su ID). Las de escritura pasan de is_coordinator() a la
-- etapa del alumno.
DROP POLICY IF EXISTS "student_public_access_select_admin" ON public.student_public_access;
DROP POLICY IF EXISTS "student_public_access_insert_admin" ON public.student_public_access;
DROP POLICY IF EXISTS "student_public_access_update_admin" ON public.student_public_access;
DROP POLICY IF EXISTS "student_public_access_delete_admin" ON public.student_public_access;

CREATE POLICY "student_public_access_insert_admin"
  ON public.student_public_access
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_manage_student(student_id));

CREATE POLICY "student_public_access_update_admin"
  ON public.student_public_access
  FOR UPDATE
  TO authenticated
  USING (public.can_manage_student(student_id))
  WITH CHECK (public.can_manage_student(student_id));

CREATE POLICY "student_public_access_delete_admin"
  ON public.student_public_access
  FOR DELETE
  TO authenticated
  USING (public.can_manage_student(student_id));

-- ----------------------------------------------------------- mass_services
DROP POLICY IF EXISTS "mass_services_modify_own_or_coordinator" ON public.mass_services;

CREATE POLICY "mass_services_modify_own_or_coordinator"
  ON public.mass_services
  FOR ALL
  TO authenticated
  USING (public.can_access_student(student_id))
  WITH CHECK (public.can_access_student(student_id));

-- ---------------------------------------------------- catechist_attendance
DROP POLICY IF EXISTS "catechist_attendance_coordinator_full_access" ON public.catechist_attendance;
DROP POLICY IF EXISTS "catechist_attendance_select"                  ON public.catechist_attendance;
DROP POLICY IF EXISTS "catechist_attendance_self_select"             ON public.catechist_attendance;
DROP POLICY IF EXISTS "catechist_attendance_write"                   ON public.catechist_attendance;
DROP POLICY IF EXISTS "catechist_attendance_manage"                  ON public.catechist_attendance;

CREATE POLICY "catechist_attendance_manage"
  ON public.catechist_attendance
  FOR ALL
  TO authenticated
  USING (public.can_manage_attendance_of(profile_id))
  WITH CHECK (public.can_manage_attendance_of(profile_id));

-- --------------------------------------------- catechist_attendance_events
DROP POLICY IF EXISTS "catechist_att_events_select" ON public.catechist_attendance_events;
DROP POLICY IF EXISTS "catechist_att_events_write"  ON public.catechist_attendance_events;
DROP POLICY IF EXISTS "catechist_att_events_manage" ON public.catechist_attendance_events;

CREATE POLICY "catechist_att_events_manage"
  ON public.catechist_attendance_events
  FOR ALL
  TO authenticated
  USING (public.can_manage_attendance_of(profile_id))
  WITH CHECK (public.can_manage_attendance_of(profile_id));

-- ----------------------------------------------------------- parish_events
DROP POLICY IF EXISTS "parish_events_auth_read"               ON public.parish_events;
DROP POLICY IF EXISTS "parish_events_coordinator_full_access" ON public.parish_events;
DROP POLICY IF EXISTS "parish_events_select_visible"          ON public.parish_events;
DROP POLICY IF EXISTS "parish_events_coordinator_manage"      ON public.parish_events;

CREATE POLICY "parish_events_select_visible"
  ON public.parish_events
  FOR SELECT
  TO authenticated
  USING (public.can_see_event_stage(stage));

CREATE POLICY "parish_events_coordinator_manage"
  ON public.parish_events
  FOR ALL
  TO authenticated
  USING (public.can_manage_event_stage(stage))
  WITH CHECK (public.can_manage_event_stage(stage));

-- --------------------------------------------------------- monthly_reports
DROP POLICY IF EXISTS "coordinator_can_read_all_reports" ON public.monthly_reports;

CREATE POLICY "coordinator_can_read_all_reports"
  ON public.monthly_reports
  FOR SELECT
  TO authenticated
  USING (
    public.is_global_coordinator()
    OR (
      public.coordinator_stage() IS NOT NULL
      AND (
        (scope = 'group'::report_scope AND public.can_manage_group(scope_id))
        OR (scope <> 'group'::report_scope AND stage = public.coordinator_stage())
      )
    )
  );

-- class_days, school_names, registration_forms*, incidents (usa
-- can_access_student, ya adaptada) y las políticas de catequista no cambian.

-- Las vistas de asistencia del equipo se ejecutan, por defecto, con los
-- permisos de su dueño (postgres), que se salta RLS: cualquier usuario podía
-- leer la asistencia de todos a través de ellas. Con security_invoker se
-- aplican las políticas de catechist_attendance(_events) a quien consulta.
ALTER VIEW public.v_catechist_attendance_norm        SET (security_invoker = true);
ALTER VIEW public.v_catechist_attendance_events_norm SET (security_invoker = true);


-- ============================================================================
-- 4. Alta de usuarios: copiar la etapa desde los metadatos
--
-- create-catechist crea el usuario con user_metadata { name, role, stage }.
-- Si no viene stage se respeta la que ya tuviera el perfil.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  bd date;
  st text;
begin
  bd := nullif(new.raw_user_meta_data->>'birth_date', '')::date;
  st := nullif(new.raw_user_meta_data->>'stage', '');

  insert into public.profiles (id, email, name, role, birth_date, stage)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'catechist'),
    bd,
    st
  )
  on conflict (id) do update
    set email      = excluded.email,
        name       = excluded.name,
        role       = excluded.role,
        birth_date = excluded.birth_date,
        stage      = coalesce(excluded.stage, profiles.stage);

  return new;
end;
$$;


-- ============================================================================
-- 5. Cumpleaños: que cada uno vea solo los de su etapa
-- ============================================================================

-- Popup "cumpleaños del equipo".
CREATE OR REPLACE FUNCTION public.get_today_birthdays()
RETURNS TABLE(id uuid, name text, age integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  with today as (
    select (now() at time zone 'Europe/Madrid')::date as d
  )
  select
    p.id,
    coalesce(p.name, '') as name,
    extract(year from age(t.d, p.birth_date::date))::int as age
  from public.profiles p
  cross join today t
  where p.role in ('catechist', 'coordinator')
    and p.birth_date is not null
    and public.is_birthday_on_day(p.birth_date::date, t.d)
    and public.can_see_profile(p.id)
  order by p.name asc
$$;

-- Popup "cumpleaños de niños". Antes: coordinator veía todos. Ahora pasa por
-- can_access_student, que ya tiene en cuenta la etapa del coordinador.
CREATE OR REPLACE FUNCTION public.get_today_student_birthdays_for_user()
RETURNS TABLE(student_id uuid, student_name text, age integer, group_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  with today as (
    select (now() at time zone 'Europe/Madrid')::date as d
  )
  select
    s.id as student_id,
    coalesce(s.name, '') as student_name,
    extract(year from age(t.d, s.birth_date::date))::int as age,
    s.group_id
  from public.students s
  cross join today t
  where s.birth_date is not null
    and public.is_birthday_on_day(s.birth_date::date, t.d)
    and public.can_access_student(s.id)
  order by s.name asc
$$;

-- Pushes de cumpleaños (cron, sin usuario autenticado: la etapa se evalúa
-- destinatario a destinatario).
--   * "niños de otros grupos": solo para coordinadores, y solo grupos de su
--     etapa (el global, todos).
--   * "equipo": solo cumpleañeros que el destinatario pueda ver.
CREATE OR REPLACE FUNCTION public.get_birthday_push_targets(p_day date DEFAULT NULL::date)
RETURNS TABLE(notification_day date, recipient_id uuid, recipient_role text, notification_kind text, priority integer, birthday_count integer)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  with day_ref as (
    select coalesce(p_day, (now() at time zone 'Europe/Madrid')::date) as d
  ),

  recipients as (
    select
      p.id as recipient_id,
      p.role as recipient_role,
      p.stage as recipient_stage,
      (p.role = 'coordinator' and p.stage is null) as is_global,
      public.profile_stages(p.id) as stages
    from public.profiles p
    where p.role in ('catechist', 'coordinator')
  ),

  recipient_groups as (
    select distinct
      gc.profile_id as recipient_id,
      gc.group_id
    from public.group_catechist gc
    join recipients r
      on r.recipient_id = gc.profile_id
  ),

  today_students as (
    select
      s.id as student_id,
      s.group_id,
      g.stage as group_stage
    from public.students s
    join public.groups g on g.id = s.group_id
    cross join day_ref d
    where s.birth_date is not null
      and public.is_birthday_on_day(s.birth_date::date, d.d)
  ),

  today_team as (
    select
      p.id as profile_id,
      (p.role = 'coordinator' and p.stage is null) as is_global,
      public.profile_stages(p.id) as stages
    from public.profiles p
    cross join day_ref d
    where p.role in ('catechist', 'coordinator')
      and p.birth_date is not null
      and public.is_birthday_on_day(p.birth_date::date, d.d)
  ),

  catechist_student_counts as (
    select
      r.recipient_id,
      r.recipient_role,
      'student_birthdays_my_groups'::text as notification_kind,
      1 as priority,
      count(distinct ts.student_id)::int as birthday_count
    from recipients r
    join recipient_groups rg
      on rg.recipient_id = r.recipient_id
    join today_students ts
      on ts.group_id = rg.group_id
    where r.recipient_role = 'catechist'
    group by r.recipient_id, r.recipient_role
  ),

  coordinator_my_group_counts as (
    select
      r.recipient_id,
      r.recipient_role,
      'student_birthdays_my_groups'::text as notification_kind,
      1 as priority,
      count(distinct ts.student_id)::int as birthday_count
    from recipients r
    join recipient_groups rg
      on rg.recipient_id = r.recipient_id
    join today_students ts
      on ts.group_id = rg.group_id
    where r.recipient_role = 'coordinator'
    group by r.recipient_id, r.recipient_role
  ),

  coordinator_other_group_counts as (
    select
      r.recipient_id,
      r.recipient_role,
      'student_birthdays_other_groups'::text as notification_kind,
      2 as priority,
      count(distinct ts.student_id)::int as birthday_count
    from recipients r
    join today_students ts
      on r.is_global
      or (ts.group_stage is not null and ts.group_stage = r.recipient_stage)
    where r.recipient_role = 'coordinator'
      and not exists (
        select 1
        from recipient_groups rg
        where rg.recipient_id = r.recipient_id
          and rg.group_id = ts.group_id
      )
    group by r.recipient_id, r.recipient_role
  ),

  team_counts as (
    select
      r.recipient_id,
      r.recipient_role,
      'team_birthdays'::text as notification_kind,
      3 as priority,
      count(distinct tt.profile_id)::int as birthday_count
    from recipients r
    join today_team tt
      on r.is_global
      or tt.is_global
      or tt.profile_id = r.recipient_id
      or tt.stages && r.stages
    group by r.recipient_id, r.recipient_role
  ),

  unioned as (
    select * from catechist_student_counts
    union all
    select * from coordinator_my_group_counts
    union all
    select * from coordinator_other_group_counts
    union all
    select * from team_counts
  )

  select
    d.d as notification_day,
    u.recipient_id,
    u.recipient_role,
    u.notification_kind,
    u.priority,
    u.birthday_count
  from unioned u
  cross join day_ref d
  where u.birthday_count > 0
  order by u.recipient_id, u.priority;
$$;


-- ============================================================================
-- 6. Comprobación rápida (opcional)
--
--    SELECT p.name, p.role, p.stage, public.profile_stages(p.id)
--    FROM public.profiles p ORDER BY p.role, p.name;
--
--    SELECT name, stage FROM public.groups ORDER BY name;
-- ============================================================================
