import { supabase } from "../lib/supabaseClient";
import { getOfflineData, saveOfflineData } from "../utils/offlineStorage";
import { SchoolName, GroupCatechistLink } from "../types/app";
import { Group, User, ParishEvent, Student, AttendanceRecord } from "../../types";

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
      .select("id, name")
      .order("name", { ascending: true });

    if (groupsErr) throw groupsErr;

    const { data: linksData, error: linksErr } = await supabase
      .from("group_catechist")
      .select("group_id, profile_id");

    if (linksErr) throw linksErr;

    groupsMapped = (groupsData ?? []).map((group) => ({
      id: group.id,
      name: group.name,
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

    groupsMapped = cachedGroups?.data ?? [];
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
      .select("id, name, email, role, birth_date, photo_path")
      .order("name", { ascending: true });

    if (profErr) throw profErr;

    usersMapped = await Promise.all(
      (profData ?? []).map(async (profile: any) => ({
        id: profile.id,
        name: profile.name ?? "",
        email: profile.email ?? "",
        role: profile.role,
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


export const loadEvents = async (): Promise<ParishEvent[]> => {
  let eventsMapped: ParishEvent[] = [];

  try {
    const { data: eventsData, error: eventsErr } = await supabase
      .from("parish_events")
      .select("id, title, date")
      .order("date", { ascending: true });

    if (eventsErr) throw eventsErr;

    eventsMapped = (eventsData ?? []).map((e) => ({
      id: e.id,
      title: e.title,
      date: String(e.date),
    }));

    await saveOfflineData("parishEvents", eventsMapped);
  } catch (error) {
    console.warn("No se pudieron cargar eventos desde Supabase, intentando offline", error);

    const cached = await getOfflineData<ParishEvent[]>("parishEvents");
    eventsMapped = cached?.data ?? [];
  }

  return eventsMapped;
};

export const loadClassDays = async (): Promise<string[]> => {
  let classDaysMapped: string[] = [];

  try {
    const { data: classDaysData, error: classDaysErr } = await supabase
      .from("class_days")
      .select("date")
      .order("date", { ascending: true });

    if (classDaysErr) throw classDaysErr;

    classDaysMapped = (classDaysData ?? []).map((d) => String(d.date));
    await saveOfflineData("classDays", classDaysMapped);
  } catch (error) {
    console.warn("No se pudieron cargar classDays desde Supabase, intentando offline", error);

    const cached = await getOfflineData<string[]>("classDays");
    classDaysMapped = cached?.data ?? [];
  }

  return classDaysMapped;
};

// Cargar estudiantes
export const loadStudents = async (): Promise<Student[]> => {
  let studentsMapped: Student[] = [];

  try {
    const { data: studentsData, error: studentsErr } = await supabase
      .from("students")
      .select("id, name, email, parent_email, school, birth_date, group_id, photo_path");

    if (studentsErr) throw studentsErr;

    // Usar Promise.all() para manejar las fotos de forma concurrente
    studentsMapped = await Promise.all(
      (studentsData ?? []).map(async (student: any) => ({
        id: student.id,
        name: student.name,
        email: student.email ?? "",
        parentEmail: student.parent_email ?? "",
        school: student.school ?? null,
        birthDate: student.birth_date ? String(student.birth_date).slice(0, 10) : "",
        groupId: student.group_id ?? "",
        photo: await signMediaUrl(student.photo_path), // Ahora en un `await` dentro de `Promise.all()`
        attendanceHistory: [], // Lo dejamos vacío aquí, lo llenaremos después
      }))
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