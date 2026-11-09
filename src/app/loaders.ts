import { supabase } from "../lib/supabaseClient";
import { getOfflineData, saveOfflineData } from "../utils/offlineStorage";
import { SchoolName, GroupCatechistLink } from "../types/app";
import { Group, User, ParishEvent, Student, AttendanceRecord, AttendanceStatus } from "../../types";
import {
  CATECHESIS_STAGES,
  CatechesisStage,
  EventStage,
  MONITOR_STAGES,
  MonitorStage,
  Stage,
  getGroupStage,
  isCatechesisStage,
  isMonitorStage,
  toCountsForAttendance,
  toEventGrade,
} from "../utils/stages";
import type { Monitor, MonitorAttendanceRecord, MonitorRole } from "../utils/monitors";

export const signMediaUrl = async (path?: string | null): Promise<string> => {
  if (!path) return "";

  const { data, error } = await supabase.storage
    .from("media")
    .createSignedUrl(path, 60 * 60);

  if (error || !data?.signedUrl) return "";

  return data.signedUrl;
};

export const loadSchoolNames = async (): Promise<SchoolName[]> => {
  try {
    const { data, error } = await supabase
      .from("school_names")
      .select("id, name")
      .order("name", { ascending: true });

    if (error) throw error;

    const mapped: SchoolName[] = data ?? [];
    await saveOfflineData("schoolNames", mapped);

    return mapped;
  } catch (error) {
    console.warn(
      "No se pudieron cargar schoolNames desde Supabase, intentando offline",
      error
    );

    const cached = await getOfflineData<SchoolName[]>("schoolNames");
    return cached?.data ?? [];
  }
};

export const loadGroupsAndLinks = async (): Promise<{
  groups: Group[];
  links: GroupCatechistLink[];
}> => {
  let groupsMapped: Group[] = [];
  let links: GroupCatechistLink[] = [];

  try {
    const { data: groupsData, error: groupsErr } = await supabase
      .from("groups")
      .select("id, name, stage")
      .order("name", { ascending: true });

    if (groupsErr) throw groupsErr;

    const { data: linksData, error: linksErr } = await supabase
      .from("group_catechist")
      .select("group_id, profile_id");

    if (linksErr) throw linksErr;

    groupsMapped = (groupsData ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      // Columna generada en la BD; el fallback cubre cachés antiguas sin ella.
      stage: (group.stage as Stage | null) ?? getGroupStage(group.name),
      catechistIds: [],
    }));

    links = (linksData ?? []) as GroupCatechistLink[];

    await saveOfflineData("groups", groupsMapped);
    await saveOfflineData("groupCatechistLinks", links);
  } catch (error) {
    console.warn(
      "No se pudieron cargar groups/group_catechist desde Supabase, intentando offline",
      error
    );

    const cachedGroups = await getOfflineData<Group[]>("groups");
    const cachedLinks = await getOfflineData<GroupCatechistLink[]>("groupCatechistLinks");

    groupsMapped = (cachedGroups?.data ?? []).map((g) => ({
      ...g,
      stage: g.stage ?? getGroupStage(g.name),
    }));
    links = cachedLinks?.data ?? [];
  }

  return {
    groups: groupsMapped,
    links,
  };
};

export const loadProfiles = async (): Promise<User[]> => {
  let usersMapped: User[] = [];

  try {
    const { data: profData, error: profErr } = await supabase
      .from("profiles")
      .select("id, name, email, role, stage, birth_date, photo_path")
      .order("name", { ascending: true });

    if (profErr) throw profErr;

    usersMapped = await Promise.all(
      (profData ?? []).map(async (profile: any) => ({
        id: profile.id,
        name: profile.name ?? "",
        email: profile.email ?? "",
        role: profile.role,
        stage: (profile.stage as Stage | null) ?? null,
        birthDate: profile.birth_date ? String(profile.birth_date).slice(0, 10) : "",
        photo: await signMediaUrl(profile.photo_path),
        attendanceHistory: [],
      }))
    );
  } catch (error) {
    console.warn("No se pudieron cargar profiles desde Supabase, intentando offline", error);

    const cached = await getOfflineData<User[]>("users");
    usersMapped = cached?.data ?? [];
  }

  return usersMapped;
};


const EVENT_COLUMNS = "id, title, date, stage, grade, invite_only, counts_for_attendance";

/** Columnas de antes de event_invitees.sql, para el reintento de loadEvents. */
const LEGACY_EVENT_COLUMNS = "id, title, date, stage, grade";

const mapEventRow = (e: any): ParishEvent => ({
  id: e.id,
  title: e.title,
  date: String(e.date),
  stage: ((e.stage as EventStage | null) ?? "all"),
  grade: toEventGrade(e.grade),
  inviteOnly: e.invite_only === true,
  countsForAttendance: toCountsForAttendance(e.counts_for_attendance),
  // De un evento específico, RLS devuelve las invitaciones que el usuario
  // puede leer: la suya, o todas si gestiona el evento.
  inviteeIds: Array.isArray(e.parish_event_invitees)
    ? e.parish_event_invitees.map((row: any) => String(row.profile_id))
    : [],
});

export const loadEvents = async (): Promise<ParishEvent[]> => {
  let eventsMapped: ParishEvent[] = [];

  try {
    // RLS ya devuelve solo los eventos dirigidos al usuario (su etapa y su
    // curso, los de 'all', los específicos a los que está invitado y los que
    // gestiona como coordinador).
    const withInvitees = await supabase
      .from("parish_events")
      .select(`${EVENT_COLUMNS}, parish_event_invitees(profile_id)`)
      .order("date", { ascending: true });

    let rows: any[];

    if (withInvitees.error) {
      // Mientras no se haya ejecutado event_invitees.sql no existen ni las
      // columnas nuevas ni la tabla de invitados. Se reintenta con lo de
      // siempre para no dejar la agenda vacía entre los dos despliegues.
      console.warn(
        "parish_events sin columnas de invitados, reintentando sin ellas",
        withInvitees.error
      );

      const legacy = await supabase
        .from("parish_events")
        .select(LEGACY_EVENT_COLUMNS)
        .order("date", { ascending: true });

      if (legacy.error) throw legacy.error;

      rows = legacy.data ?? [];
    } else {
      rows = withInvitees.data ?? [];
    }

    eventsMapped = rows.map(mapEventRow);

    await saveOfflineData("parishEvents", eventsMapped);
  } catch (error) {
    console.warn("No se pudieron cargar eventos desde Supabase, intentando offline", error);

    const cached = await getOfflineData<ParishEvent[]>("parishEvents");
    // Cachés antiguas no traen stage, grade ni invitados: eran eventos de
    // etapa para todos los cursos y todos contaban para la asistencia.
    eventsMapped = (cached?.data ?? []).map((e) => ({
      ...e,
      stage: e.stage ?? "all",
      grade: toEventGrade(e.grade),
      inviteOnly: e.inviteOnly === true,
      countsForAttendance: toCountsForAttendance(e.countsForAttendance),
      inviteeIds: e.inviteeIds ?? [],
    }));
  }

  return eventsMapped;
};

/** Lo que se guarda en la caché offline: una fila por etapa y día. */
type ClassDayRow = { stage: string; date: string };

/**
 * Días lectivos por etapa de catequesis. Cada etapa lleva el suyo desde
 * class_days_by_stage.sql; antes era un calendario único para las dos.
 */
export const loadClassDays = async (): Promise<Record<CatechesisStage, string[]>> => {
  const group = (rows: ClassDayRow[]): Record<CatechesisStage, string[]> => {
    const byStage: Record<CatechesisStage, string[]> = {
      preconfirmation: [],
      confirmation: [],
    };

    for (const row of rows) {
      if (!isCatechesisStage(row.stage)) continue;
      byStage[row.stage].push(String(row.date).slice(0, 10));
    }

    for (const stage of CATECHESIS_STAGES) byStage[stage].sort();

    return byStage;
  };

  try {
    const { data, error } = await supabase
      .from("class_days")
      .select("stage, date")
      .order("date", { ascending: true });

    if (error) throw error;

    const rows: ClassDayRow[] = (data ?? []).map((row: any) => ({
      stage: String(row.stage),
      date: String(row.date),
    }));

    await saveOfflineData("classDays", rows);

    return group(rows);
  } catch (error) {
    console.warn("No se pudieron cargar classDays desde Supabase, intentando offline", error);

    const cached = await getOfflineData<ClassDayRow[] | string[]>("classDays");
    const data = cached?.data ?? [];

    // Una caché de antes del cambio es una lista de fechas sueltas, que valían
    // para las dos etapas: es lo que significaban entonces.
    if (data.length > 0 && typeof data[0] === "string") {
      const days = (data as string[]).map((day) => String(day).slice(0, 10)).sort();
      return { preconfirmation: [...days], confirmation: [...days] };
    }

    return group(data as ClassDayRow[]);
  }
};

// Cargar estudiantes
export const loadStudents = async (): Promise<Student[]> => {
  let studentsMapped: Student[] = [];

  try {
    const { data: studentsData, error: studentsErr } = await supabase
      .from("students")
      .select(`
        id,
        name,
        gender,
        dni,
        email,
        parent_email,
        school,
        birth_date,
        group_id,
        photo_path,
        student_public_access(public_id)
      `);

    if (studentsErr) throw studentsErr;

    studentsMapped = await Promise.all(
      (studentsData ?? []).map(async (student: any) => {
        const publicAccess = Array.isArray(student.student_public_access)
          ? student.student_public_access[0]
          : student.student_public_access;

        return {
          id: student.id,
          name: student.name,
          gender: student.gender,
          dni: student.dni ?? "",
          email: student.email ?? "",
          parentEmail: student.parent_email ?? "",
          school: student.school ?? null,
          birthDate: student.birth_date ? String(student.birth_date).slice(0, 10) : "",
          groupId: student.group_id ?? "",
          publicId: publicAccess?.public_id ?? "",
          photo: await signMediaUrl(student.photo_path),
          attendanceHistory: [],
        };
      })
    );

    await saveOfflineData("students", studentsMapped);
  } catch (error) {
    console.warn("No se pudieron cargar students desde Supabase, intentando offline", error);

    const cached = await getOfflineData<Student[]>("students");
    studentsMapped = cached?.data ?? [];
  }

  return studentsMapped;
};

// Cargar asistencia de estudiantes
export const loadAttendance = async (): Promise<Map<string, AttendanceRecord[]>> => {
  let attendanceByStudent: Map<string, AttendanceRecord[]> = new Map();

  try {
    let all: any[] = [];
    let from = 0;
    const pageSize = 1000;

    // Hacer paginación de los registros de asistencia
    while (true) {
      const { data, error } = await supabase
        .from("student_attendance")
        .select("student_id, date, catechism, mass")
        .order("student_id", { ascending: true })
        .order("date", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      all = all.concat(data);
      if (data.length < pageSize) break;

      from += pageSize;
    }

    for (const record of all ?? []) {
      const attendanceRecord: AttendanceRecord = {
        date: String(record.date),
        catechism: record.catechism as any,
        mass: record.mass as any,
      };

      const currentRecords = attendanceByStudent.get(record.student_id) ?? [];
      currentRecords.push(attendanceRecord);
      attendanceByStudent.set(record.student_id, currentRecords);
    }

    await saveOfflineData("attendance", Array.from(attendanceByStudent.entries()));
  } catch (error) {
    console.warn("No se pudo cargar la asistencia de estudiantes desde Supabase, intentando offline", error);

    const cached = await getOfflineData<Map<string, AttendanceRecord[]>>("attendance");
    attendanceByStudent = new Map(cached?.data ?? []);
  }

  return attendanceByStudent;
};
// ---------------------------------------------------------------------------
// Monitores de comunión y postcomunión
//
// RLS ya filtra por etapa: un coordinador de comunión solo recibe lo de
// comunión y el general, las dos. Un catequista no recibe nada, así que estas
// cargas devuelven listas vacías y no estorban.
// ---------------------------------------------------------------------------

const MONITOR_COLUMNS =
  "id, stage, name, email, phone, birth_date, photo_path, role, active, profile_id, notes";

export const loadMonitors = async (): Promise<Monitor[]> => {
  let monitors: Monitor[] = [];

  try {
    const { data, error } = await supabase
      .from("monitors")
      .select(MONITOR_COLUMNS)
      .order("name", { ascending: true });

    if (error) throw error;

    monitors = await Promise.all(
      (data ?? []).map(async (row: any): Promise<Monitor> => ({
        id: row.id,
        stage: row.stage as MonitorStage,
        name: row.name ?? "",
        email: row.email ?? "",
        phone: row.phone ?? "",
        birthDate: row.birth_date ? String(row.birth_date).slice(0, 10) : "",
        photoPath: row.photo_path ?? null,
        photo: await signMediaUrl(row.photo_path),
        role: (row.role as MonitorRole) ?? "monitor",
        active: row.active !== false,
        profileId: row.profile_id ?? null,
        notes: row.notes ?? "",
        attendanceHistory: [],
      }))
    );

    // La foto firmada caduca, así que la caché guarda la ruta y no la URL.
    await saveOfflineData(
      "monitors",
      monitors.map((monitor) => ({ ...monitor, photo: "" }))
    );
  } catch (error) {
    console.warn("No se pudieron cargar los monitores desde Supabase, intentando offline", error);

    const cached = await getOfflineData<Monitor[]>("monitors");

    monitors = (cached?.data ?? []).filter((monitor) => isMonitorStage(monitor.stage));
  }

  return monitors;
};

/** Días de actividad por etapa. Comunión y postcomunión son independientes. */
export const loadMonitorActivityDays = async (): Promise<Record<MonitorStage, string[]>> => {
  const empty = (): Record<MonitorStage, string[]> => ({ communion: [], postcommunion: [] });

  const group = (rows: { stage: string; date: string }[]): Record<MonitorStage, string[]> => {
    const byStage = empty();

    for (const row of rows) {
      if (!isMonitorStage(row.stage)) continue;
      byStage[row.stage].push(String(row.date).slice(0, 10));
    }

    for (const stage of MONITOR_STAGES) byStage[stage].sort();

    return byStage;
  };

  try {
    const { data, error } = await supabase
      .from("monitor_activity_days")
      .select("stage, date")
      .order("date", { ascending: true });

    if (error) throw error;

    const rows = (data ?? []).map((row: any) => ({ stage: String(row.stage), date: String(row.date) }));

    await saveOfflineData("monitorActivityDays", rows);

    return group(rows);
  } catch (error) {
    console.warn(
      "No se pudieron cargar los días de actividad desde Supabase, intentando offline",
      error
    );

    const cached = await getOfflineData<{ stage: string; date: string }[]>("monitorActivityDays");
    return group(cached?.data ?? []);
  }
};

/**
 * Asistencia de los monitores, por monitor. Se trae entera (no solo la de
 * hoy) porque el pase de lista de cualquier día y los porcentajes la necesitan,
 * igual que con los catequistas.
 */
export const loadMonitorAttendance = async (): Promise<Map<string, MonitorAttendanceRecord[]>> => {
  const byMonitor = new Map<string, MonitorAttendanceRecord[]>();

  const push = (monitorId: string, record: MonitorAttendanceRecord) => {
    const records = byMonitor.get(monitorId) ?? [];
    records.push(record);
    byMonitor.set(monitorId, records);
  };

  const { data: dayRows, error: dayError } = await supabase
    .from("monitor_attendance")
    .select("monitor_id, date, activity, mass");

  if (dayError) throw dayError;

  for (const row of dayRows ?? []) {
    push(String(row.monitor_id), {
      type: "activity",
      date: String(row.date).slice(0, 10),
      activity: ((row.activity ?? "absent") as AttendanceStatus),
      mass: ((row.mass ?? "absent") as AttendanceStatus),
    });
  }

  const { data: eventRows, error: eventError } = await supabase
    .from("monitor_attendance_events")
    .select("monitor_id, event_id, date, status");

  if (eventError) throw eventError;

  for (const row of eventRows ?? []) {
    push(String(row.monitor_id), {
      type: "event",
      date: String(row.date).slice(0, 10),
      refId: String(row.event_id),
      status: ((row.status ?? "absent") as AttendanceStatus),
    });
  }

  return byMonitor;
};
