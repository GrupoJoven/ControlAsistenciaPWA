
import { supabase } from "./src/lib/supabaseClient";
import { saveOfflineData, getOfflineData } from "./src/utils/offlineStorage";
import { useOnlineStatus } from "./src/hooks/useOnlineStatus";
import { subscribeToPush, unsubscribeFromPush } from "./src/pwa/push";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Users, 
  Calendar, 
  BarChart3, 
  LogOut, 
  Mail, 
  Plus, 
  Search,
  CheckCircle2,
  User as UserIcon,
  Church,
  ShieldCheck,
  Settings,
  CalendarDays,
  Briefcase,
  Key,
  Menu,
  ClipboardList,
  TriangleAlert,
  Bell,
  BellOff,
  X
} from 'lucide-react';
import { Student, AttendanceRecord, User, Group, ParishEvent, getTodayStr, AttendanceStatus, CatechistAttendanceRecord } from './types';
import Dashboard from './components/Dashboard';
import AttendanceTracker from './components/AttendanceTracker';
import StudentList from './components/StudentList';
import Reports from './components/Reports';
import Login from './components/Login';
import GroupManager from './components/GroupManager';
import ClassDayManager from './components/ClassDayManager';
import CatechistManager from './components/CatechistManager';
import CatechistAttendance from './components/CatechistAttendance';
import ServicesManagement from './components/ServicesManagement';
import SchoolCalendar from "./components/SchoolCalendar";
import BirthdayPopup from './components/BirthdayPopup';
import StudentBirthdayPopup from './components/StudentBirthdayPopup';
import IncidentsManager from './components/IncidentsManager';

type View = 'dashboard' | 'school-calendar' | 'attendance' | 'students' | 'services' | 'incidents' | 'coordinator-groups' | 'coordinator-edit-groups' | 'agenda' | 'reports' | 'class-days' | 'catechists' | 'catechist-attendance' | 'account' | 'my-account';

const normalizeSearchText = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [students, setStudents] = useState<Student[]>([]);
  const [events, setEvents] = useState<ParishEvent[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [classDays, setClassDays] = useState<string[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [incidentUsers, setIncidentUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  type GroupCatechistLink = { group_id: string; profile_id: string };

  const [groupCatechistLinks, setGroupCatechistLinks] = useState<GroupCatechistLink[]>([]);
  type SchoolName = { id: string; name: string };

  const [schoolNames, setSchoolNames] = useState<SchoolName[]>([]);

  // Para catequistas con varios grupos: cuál está “activo” en la UI
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  type BirthdayInfo = { id: string; name: string; age: number };

  const [baseDataLoaded, setBaseDataLoaded] = useState(false);
  const [todayBirthdays, setTodayBirthdays] = useState<BirthdayInfo[]>([]);
  const [showBirthdayPopup, setShowBirthdayPopup] = useState(false);
  type StudentBirthdayInfo = { student_id: string; student_name: string; age: number; group_id: string };

  const [todayStudentBirthdays, setTodayStudentBirthdays] = useState<StudentBirthdayInfo[]>([]);
  const [showStudentBirthdayPopup, setShowStudentBirthdayPopup] = useState(false);
  const isOnline = useOnlineStatus();
  const wasOnlineRef = useRef(isOnline);
  const lastRefreshRef = useRef(0);
  const blockIfOffline = (actionLabel = "realizar esta acción") => {
    if (isOnline) return false;

    alert(`No hay conexión. No se puede ${actionLabel} hasta que vuelva internet.`);
    return true;
  };

  const refreshBaseData = async () => {
    if (!currentUser) return;
    if (!isOnline) return;

    const now = Date.now();
    if (now - lastRefreshRef.current < 3000) return;

    lastRefreshRef.current = now;

    try {
      await loadSchoolNames();
      await loadBaseData(currentUser);
    } catch (error) {
      console.error("Error refrescando datos base:", error);
    }
  };
  useEffect(() => {
    const boot = async () => {
      const { data } = await supabase.auth.getSession();
      const sessionUser = data.session?.user;
      if (!sessionUser) return;

      let appUser: User | null = null;

      try {
        const { data: profile, error } = await supabase
          .from("profiles")
          .select("id, name, role, birth_date")
          .eq("id", sessionUser.id)
          .single();

        if (error || !profile) {
          throw error ?? new Error("Perfil no encontrado");
        }

        appUser = {
          id: profile.id,
          name: profile.name ?? "",
          email: sessionUser.email ?? "",
          role: profile.role,
          birthDate: profile.birth_date ? String(profile.birth_date) : "",
        };

        await saveOfflineData("currentUser", appUser);

      } catch (error) {
        console.warn("No se pudo cargar el perfil desde Supabase, intentando usar currentUser offline");

        const cachedUser = await getOfflineData<User>("currentUser");

        if (!cachedUser?.data) return;

        if (cachedUser.data.id !== sessionUser.id) return;

        appUser = {
          ...cachedUser.data,
          email: sessionUser.email ?? cachedUser.data.email ?? "",
        };
      }

      if (!appUser) return;

      setCurrentUser(appUser);
      await loadSchoolNames();
      await loadBaseData(appUser);
    };

    void boot();
  }, []);

  useEffect(() => {
    const run = async () => {
      if (!currentUser) return;
      if (!baseDataLoaded) return;

      const today = getTodayStr(); // ya lo tienes importado de ./types
      const seenKey = `birthday_popup_seen_${today}`;

      // si ya se ha mostrado hoy en este navegador, no repetir
      if (localStorage.getItem(seenKey) === "1") return;

      const { data, error } = await supabase.rpc("get_today_birthdays");

      if (error) {
        console.error("Error cargando cumpleaños de hoy:", error.message);
        return;
      }

      const list = (data ?? []) as { id: string; name: string; age: number }[];

      setTodayBirthdays(list);

      if (list.length > 0) {
        setShowBirthdayPopup(true);
      } else {
        // si no hay cumpleañeros, marcamos como visto para no reintentar en cada render
        localStorage.setItem(seenKey, "1");
      }
    };

    void run();
  }, [currentUser, baseDataLoaded]);

  useEffect(() => {
    const run = async () => {
      if (!currentUser) return;
      if (!baseDataLoaded) return;

      const today = getTodayStr();
      const seenKey = `student_birthday_popup_seen_${today}_${currentUser.id}`;

      if (localStorage.getItem(seenKey) === "1") return;

      const { data, error } = await supabase.rpc("get_today_student_birthdays_for_user");

      if (error) {
        console.error("Error cargando cumpleaños de niños de hoy:", error.message);
        return;
      }

      const list = (data ?? []) as { student_id: string; student_name: string; age: number; group_id: string }[];

      setTodayStudentBirthdays(list);

      if (list.length > 0) {
        setShowStudentBirthdayPopup(true);
      } else {
        localStorage.setItem(seenKey, "1");
      }
    };

    void run();
  }, [currentUser, baseDataLoaded]);

  useEffect(() => {
    const cameBackOnline = !wasOnlineRef.current && isOnline;

    if (cameBackOnline) {
      void refreshBaseData();
    }

    wasOnlineRef.current = isOnline;
  }, [isOnline, currentUser]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshBaseData();
      }
    };

    const handleWindowFocus = () => {
      void refreshBaseData();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [currentUser, isOnline]);


  const loadSchoolNames = async () => {
    try {
      const { data, error } = await supabase
        .from("school_names")
        .select("id, name")
        .order("name", { ascending: true });

      if (error) throw error;

      const mapped = data ?? [];
      await saveOfflineData("schoolNames", mapped);
      setSchoolNames(mapped);
    } catch (error) {
      console.warn("No se pudieron cargar schoolNames desde Supabase, intentando offline", error);

      const cached = await getOfflineData<SchoolName[]>("schoolNames");
      setSchoolNames(cached?.data ?? []);
    }
  };

  const handleLogin = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
  
    if (error) {
      alert(error.message);
      return;
    }
  
    const userId = data.user?.id;
    if (!userId) {
      alert("Login correcto, pero no se pudo obtener el id del usuario.");
      return;
    }
  
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, name, role, birth_date")
      .eq("id", userId)
      .single();
  
    if (profileError) {
      alert(
        "Login correcto, pero no se pudo cargar el perfil: " +
          profileError.message
      );
      return;
    }
  
    const appUser: User = {
      id: profile.id,
      name: profile.name ?? "",
      email: data.user?.email ?? email,
      role: profile.role,
      birthDate: profile.birth_date ? String(profile.birth_date) : "",
    };
  
    try {
      await saveOfflineData("currentUser", appUser);
      setCurrentUser(appUser);
      await loadSchoolNames();
      await loadBaseData(appUser);
      setCurrentView("dashboard");
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Error cargando datos");
      setCurrentUser(null);
    }
  };


  const getUserGroupIds = (userId: string) =>
    groupCatechistLinks
      .filter(l => l.profile_id === userId)
      .map(l => l.group_id);


  const loadBaseData = async (user: User) => {
    setBaseDataLoaded(false);
    const signMediaUrl = async (path?: string | null) => {
      if (!path) return "";
      const { data, error } = await supabase.storage
        .from("media")
        .createSignedUrl(path, 60 * 60); // 1 hora
      if (error || !data?.signedUrl) return "";
      return data.signedUrl;
    };
    // --- groups + group_catechist ---
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

      groupsMapped = (groupsData ?? []).map(g => ({
        id: g.id,
        name: g.name,
        catechistIds: [],
      }));

      links = (linksData ?? []) as GroupCatechistLink[];

      await saveOfflineData("groups", groupsMapped);
      await saveOfflineData("groupCatechistLinks", links);

    } catch (error) {
      console.warn("No se pudieron cargar groups/group_catechist desde Supabase, intentando offline", error);

      const cachedGroups = await getOfflineData<Group[]>("groups");
      const cachedLinks = await getOfflineData<GroupCatechistLink[]>("groupCatechistLinks");

      groupsMapped = cachedGroups?.data ?? [];
      links = cachedLinks?.data ?? [];
    }

    setGroupCatechistLinks(links);
    setGroups(groupsMapped);

    const myGroupIds = links
      .filter(l => l.profile_id === user.id)
      .map(l => l.group_id);

    setActiveGroupId(prev => (prev && myGroupIds.includes(prev) ? prev : (myGroupIds[0] ?? null)));
    // --- profiles (users base) ---
    let usersMapped: User[] = [];

    try {
      const { data: profData, error: profErr } = await supabase
        .from("profiles")
        .select("id, name, email, role, birth_date, photo_path")
        .order("name", { ascending: true });

      if (profErr) throw profErr;

      usersMapped = await Promise.all((profData ?? []).map(async (p: any) => ({
        id: p.id,
        name: p.name ?? "",
        email: p.email ?? "",
        role: p.role,
        birthDate: p.birth_date ? String(p.birth_date).slice(0, 10) : "",
        photo: await signMediaUrl(p.photo_path),
        attendanceHistory: [],
      })));

    } catch (error) {
      console.warn("No se pudieron cargar profiles desde Supabase, intentando offline", error);

      const cached = await getOfflineData<User[]>("users");
      usersMapped = cached?.data ?? [];
    }


    // --- lista mínima de usuarios para filtros de incidencias ---
    // coordinator: puede filtrar por cualquiera
    // catechist: solo por catequistas/coordinadores vinculados a SUS grupos (luego el gestor ya limitará por activeGroupId)
    const myGroupIdsForUser = links
      .filter(l => l.profile_id === user.id)
      .map(l => l.group_id);

    const allowedProfileIdsForIncidents =
      user.role === "coordinator"
        ? new Set(usersMapped.map(u => u.id))
        : new Set(
            links
              .filter(l => myGroupIdsForUser.includes(l.group_id))
              .map(l => l.profile_id)
          );

    // Si quieres incluir coordinadores aunque no estén en group_catechist:
    for (const u of usersMapped) {
      if (u.role === "coordinator") allowedProfileIdsForIncidents.add(u.id);
    }

    // Lista final (puedes dejar email vacío para catequistas, por privacidad)
    const incidentUsersList =
      user.role === "coordinator"
        ? usersMapped
        : usersMapped
            .filter(u => allowedProfileIdsForIncidents.has(u.id))
            .map(u => ({ ...u, email: "" })); // opcional

    setIncidentUsers(incidentUsersList);


    // Si NO eres coordinator, quédate solo con tu perfil (evita exponer datos innecesarios)
    const usersScoped = user.role === "coordinator"
      ? usersMapped
      : usersMapped.filter(u => u.id === user.id);

    // --- students + student_attendance ---
    let studentsMapped: Student[] = [];

    try {
      const { data: studentsData, error: studentsErr } = await supabase
        .from("students")
        .select("id, name, email, parent_email, school, birth_date, group_id, photo_path");

      if (studentsErr) throw studentsErr;

      let all: any[] = [];
      let from = 0;
      const pageSize = 1000;

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

      const attendanceByStudent = new Map<string, AttendanceRecord[]>();

      for (const r of all ?? []) {
        const rec: AttendanceRecord = {
          date: String(r.date),
          catechism: r.catechism as any,
          mass: r.mass as any,
        };

        const arr = attendanceByStudent.get(r.student_id) ?? [];
        arr.push(rec);
        attendanceByStudent.set(r.student_id, arr);
      }

      studentsMapped = await Promise.all(
        (studentsData ?? []).map(async (s: any) => ({
          id: s.id,
          name: s.name,
          email: s.email ?? "",
          parentEmail: s.parent_email ?? "",
          school: s.school ?? null,
          birthDate: s.birth_date ? String(s.birth_date).slice(0, 10) : "",
          groupId: s.group_id ?? "",
          photo: await signMediaUrl(s.photo_path),
          attendanceHistory: attendanceByStudent.get(s.id) ?? [],
        }))
      );

      await saveOfflineData("students", studentsMapped);

    } catch (error) {
      console.warn("No se pudieron cargar students/student_attendance desde Supabase, intentando offline", error);

      const cached = await getOfflineData<Student[]>("students");
      studentsMapped = cached?.data ?? [];
    }

    setStudents(studentsMapped);

    // --- parish_events ---
    let eventsMapped: ParishEvent[] = [];

    try {
      const { data: eventsData, error: eventsErr } = await supabase
        .from("parish_events")
        .select("id, title, date")
        .order("date", { ascending: true });

      if (eventsErr) throw eventsErr;

      eventsMapped = (eventsData ?? []).map(e => ({
        id: e.id,
        title: e.title,
        date: String(e.date),
      }));

      // guardar copia offline
      await saveOfflineData("parishEvents", eventsMapped);

    } catch (error) {
      console.warn("No se pudieron cargar eventos desde Supabase, intentando offline");

      const cached = await getOfflineData<ParishEvent[]>("parishEvents");

      if (cached?.data) {
        eventsMapped = cached.data;
      } else {
        eventsMapped = [];
      }
    }

    setEvents(eventsMapped);

    // --- class_days ---
    let classDaysMapped: string[] = [];

    try {
      const { data: classDaysData, error: classDaysErr } = await supabase
        .from("class_days")
        .select("date")
        .order("date", { ascending: true });

      if (classDaysErr) throw classDaysErr;

      classDaysMapped = (classDaysData ?? []).map(d => String(d.date));
      await saveOfflineData("classDays", classDaysMapped);

    } catch (error) {
      console.warn("No se pudieron cargar classDays desde Supabase, intentando offline", error);

      const cached = await getOfflineData<string[]>("classDays");
      classDaysMapped = cached?.data ?? [];
    }

    setClassDays(classDaysMapped);

    // --- catechist_attendance + users final ---
    const today = getTodayStr();
    let usersWithAttendance: User[] = [];

    try {
      const { data: catClassData, error: catClassErr } = await supabase
        .from("v_catechist_attendance_norm")
        .select("profile_id, date, catechism, mass");

      if (catClassErr) throw catClassErr;

      const { data: catEventData, error: catEventErr } = await supabase
        .from("catechist_attendance_events")
        .select("profile_id, event_id, date, status")
        .eq("date", today);

      if (catEventErr) throw catEventErr;

      const catAttendanceByProfile = new Map<string, CatechistAttendanceRecord[]>();

      for (const r of catClassData ?? []) {
        const rec: CatechistAttendanceRecord = {
          type: "class" as any,
          date: String(r.date),
          catechism: (r.catechism ?? "absent") as any,
          mass: (r.mass ?? "absent") as any,
        };
        const arr = catAttendanceByProfile.get(r.profile_id) ?? [];
        arr.push(rec);
        catAttendanceByProfile.set(r.profile_id, arr);
      }

      for (const r of catEventData ?? []) {
        const rec: CatechistAttendanceRecord = {
          type: "event" as any,
          refId: r.event_id,
          date: String(r.date),
          status: (r.status ?? "absent") as any,
        };
        const arr = catAttendanceByProfile.get(r.profile_id) ?? [];
        arr.push(rec);
        catAttendanceByProfile.set(r.profile_id, arr);
      }

      usersWithAttendance = usersScoped.map(u => ({
        ...u,
        attendanceHistory: catAttendanceByProfile.get(u.id) ?? [],
      }));

      await saveOfflineData("users", usersWithAttendance);

    } catch (error) {
      console.warn("No se pudo cargar la asistencia de catequistas desde Supabase, intentando offline", error);

      const cachedUsers = await getOfflineData<User[]>("users");

      if (cachedUsers?.data?.length) {
        usersWithAttendance = cachedUsers.data;
      } else {
        usersWithAttendance = usersScoped;
      }
    }

    setUsers(usersWithAttendance);
    setBaseDataLoaded(true);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setStudents([]);
    setGroups([]);
    setUsers([]);
    setIncidentUsers([]);
    setEvents([]);
    setClassDays([]);
    setBaseDataLoaded(false);
    setTodayBirthdays([]);
    setShowBirthdayPopup(false);
    setTodayStudentBirthdays([]);
    setShowStudentBirthdayPopup(false);
  };


  const navigateTo = (view: View) => {
    setCurrentView(view);
    setIsSidebarOpen(false);
    setSearchQuery(''); // Reset search when switching views
  };

  const isSearchView = ['students', 'coordinator-groups', 'catechists'].includes(currentView);
  const updateStudentAttendance = async (
    studentId: string,
    type: "catechism" | "mass",
    status: AttendanceStatus
  ) => {
    if (blockIfOffline("guardar la asistencia")) return;
    const today = getTodayStr();
  
    // 1) Lee desde Supabase el registro actual (fuente de verdad)
    const { data: current, error: readErr } = await supabase
      .from("student_attendance")
      .select("catechism, mass")
      .eq("student_id", studentId)
      .eq("date", today)
      .maybeSingle();
  
    if (readErr) {
      alert("Error leyendo asistencia actual: " + readErr.message);
      return;
    }
  
    const next = {
      student_id: studentId,
      date: today,
      catechism: type === "catechism" ? status : (current?.catechism ?? "absent"),
      mass: type === "mass" ? status : (current?.mass ?? "absent"),
    };
  
    const { error } = await supabase
      .from("student_attendance")
      .upsert(next, { onConflict: "student_id,date" });
  
    if (error) {
      alert("Error guardando asistencia: " + error.message);
      return;
    }

    // 2) actualiza estado local (optimista)
    setStudents(prev =>
      prev.map(st => {
        if (st.id !== studentId) return st;
        const history = [...(st.attendanceHistory ?? [])];
        const idx = history.findIndex(h => h.date === today);
        if (idx >= 0) history[idx] = { date: today, catechism: next.catechism as any, mass: next.mass as any };
        else history.push({ date: today, catechism: next.catechism as any, mass: next.mass as any });
        return { ...st, attendanceHistory: history };
      })
    );
  };


  const normalizeTeamStatus = (s: AttendanceStatus): AttendanceStatus => s;

  const updateCatechistAttendance = async (
    profileId: string,
    type: "class" | "event",
    status: AttendanceStatus,
    refId?: string,
    subType?: "catechism" | "mass"
  ) => {
    if (blockIfOffline("guardar la asistencia del catequista")) return;
    const today = getTodayStr();
    const safeStatus = normalizeTeamStatus(status);

    try {
      if (type === "class") {
        if (!subType) return;

        // IMPORTANTE: no pisar el otro campo.
        // Busca el “estado actual” local del catequista para HOY.
        // Ajusta 'users' y el shape de attendanceHistory a tu modelo real.
        const u = users.find((x: any) => x.id === profileId);
        const { data: current, error: readErr } = await supabase
          .from("catechist_attendance")
          .select("catechism, mass")
          .eq("profile_id", profileId)
          .eq("date", today)
          .maybeSingle();

        if (readErr) throw readErr;

        const next = {
          profile_id: profileId,
          date: today,
          catechism: subType === "catechism" ? safeStatus : (current?.catechism ?? "absent"),
          mass:      subType === "mass"     ? safeStatus : (current?.mass      ?? "absent"),
        };

        const { error } = await supabase
          .from("catechist_attendance")
          .upsert(next, { onConflict: "profile_id,date" });

        if (error) throw error;

        // Actualización optimista local (sin recargar todo)
        setUsers((prev: any[]) =>
          prev.map((x: any) => {
            if (x.id !== profileId) return x;
            const hist = Array.isArray(x.attendanceHistory) ? [...x.attendanceHistory] : [];

            // elimina el registro "class de hoy" anterior (si existía)
            const filtered = hist.filter((h: any) => !(h.type === "class" && h.date === today));

            filtered.push({
              type: "class",
              date: today,
              catechism: next.catechism,
              mass: next.mass,
            });

            return { ...x, attendanceHistory: filtered };
          })
        );

        return;
      }

      // type === "event"
      if (!refId) return;

      // La fecha para event: yo recomiendo usar SIEMPRE la del evento (no "hoy")
      // porque en BD tienes date también en catechist_attendance_events.
      const eventDate = events.find((e: any) => e.id === refId)?.date ?? today;

      const payload = {
        profile_id: profileId,
        event_id: refId,
        date: eventDate,
        status: safeStatus,
      };

      const { error } = await supabase
        .from("catechist_attendance_events")
        .upsert(payload, { onConflict: "profile_id,event_id,date" });

      if (error) throw error;

      setUsers((prev: any[]) =>
        prev.map((x: any) => {
          if (x.id !== profileId) return x;
          const hist = Array.isArray(x.attendanceHistory) ? [...x.attendanceHistory] : [];

          // elimina registro anterior de ese evento
          const filtered = hist.filter(
            (h: any) => !(h.type === "event" && h.refId === refId)
          );

          filtered.push({
            type: "event",
            refId,
            date: eventDate,
            status: safeStatus,
          });

          return { ...x, attendanceHistory: filtered };
        })
      );
    } catch (e: any) {
      alert("Error guardando asistencia catequista: " + (e?.message ?? String(e)));
    }
  };


  const setUserGroups = async (userId: string, groupIds: string[]) => {
    if (blockIfOffline("actualizar los grupos del catequista")) return;
    const current = getUserGroupIds(userId);
    const next = Array.from(new Set(groupIds)); // dedup

    const toAdd = next.filter(gid => !current.includes(gid));
    const toRemove = current.filter(gid => !next.includes(gid));

    // 1) borrar
    if (toRemove.length > 0) {
      const { error } = await supabase
        .from("group_catechist")
        .delete()
        .eq("profile_id", userId)
        .in("group_id", toRemove);

      if (error) {
        alert("Error actualizando grupos (delete): " + error.message);
        return;
      }
    }

    // 2) insertar
    if (toAdd.length > 0) {
      const rows = toAdd.map(gid => ({ profile_id: userId, group_id: gid }));
      const { error } = await supabase
        .from("group_catechist")
        .insert(rows);

      if (error) {
        alert("Error actualizando grupos (insert): " + error.message);
        return;
      }
    }

    // 3) estado local (instantáneo)
    setGroupCatechistLinks(prev => {
      const kept = prev.filter(l => !(l.profile_id === userId && toRemove.includes(l.group_id)));
      const added = toAdd.map(gid => ({ profile_id: userId, group_id: gid }));
      return [...kept, ...added];
    });

    // 4) si el usuario editado es el currentUser y su activeGroupId ya no está, ajusta
    if (currentUser?.id === userId) {
      setActiveGroupId(prev => (prev && next.includes(prev) ? prev : (next[0] ?? null)));
    }
  };


  const updateStudent = async (updatedStudent: Student) => {
    if (blockIfOffline("actualizar el catecúmeno")) return;
    // 1) actualizar datos del alumno (students)
    const schoolNormalized =
      (updatedStudent.school ?? "").trim() || null;
    const payload = {
      name: updatedStudent.name,
      email: updatedStudent.email || null,
      parent_email: updatedStudent.parentEmail || null,
      school: schoolNormalized,
      birth_date: updatedStudent.birthDate || null,
      group_id: updatedStudent.groupId || null,
      // ojo: photo si lo guardas en tabla; si NO tienes columna, no lo envíes
      // photo: updatedStudent.photo || null,
    };

    const { data: sData, error: sErr } = await supabase
      .from("students")
      .update(payload)
      .eq("id", updatedStudent.id)
      .select("id, name, email, parent_email, school, birth_date, group_id")
      .single();

    if (sErr) {
      alert("Error al actualizar catecúmeno: " + sErr.message);
      return;
    }

    // 2) persistir asistencia (student_attendance)
    //    pk compuesta (student_id, date) -> upsert ideal
    const rows = (updatedStudent.attendanceHistory ?? []).map(r => ({
      student_id: updatedStudent.id,
      date: r.date,
      catechism: r.catechism,
      mass: r.mass,
    }));

    if (rows.length > 0) {
      const { error: aErr } = await supabase
        .from("student_attendance")
        .upsert(rows, { onConflict: "student_id,date" });

      if (aErr) {
        alert("Alumno actualizado, pero error guardando asistencia: " + aErr.message);
        // seguimos, porque el alumno ya está actualizado
      }
    }

    // 3) reflejar en estado local (incluyendo tempHistory)
    setStudents(prev =>
      prev.map(s =>
        s.id === updatedStudent.id
          ? {
              ...s,
              name: sData.name,
              email: sData.email ?? "",
              parentEmail: sData.parent_email ?? "",
              school: sData.school ?? "",
              birthDate: sData.birth_date ? String(sData.birth_date) : "",
              groupId: sData.group_id ?? "",
              attendanceHistory: updatedStudent.attendanceHistory ?? [],
              photo: updatedStudent.photo, // solo si lo usas local; si lo migras, lo cambiamos
            }
          : s
      )
    );
  };


  const addStudent = async (newStudent: Student) => {
    if (blockIfOffline("crear el catecúmeno")) return;
    const schoolNormalized =
      (newStudent.school ?? "").trim() || null;
    const payload = {
      name: newStudent.name,
      email: newStudent.email || null,
      parent_email: newStudent.parentEmail || null,
      school: schoolNormalized,
      birth_date: newStudent.birthDate || null,
      group_id: newStudent.groupId || null,
    };

    const { data, error } = await supabase
      .from("students")
      .insert(payload)
      .select("id, name, email, parent_email, school, birth_date, group_id")
      .single();

    if (error) {
      alert("Error al crear catecúmeno: " + error.message);
      return;
    }

    const created: Student = {
      id: data.id,
      name: data.name,
      email: data.email ?? "",
      parentEmail: data.parent_email ?? "",
      school: data.school ?? "",
      photo: undefined,
      birthDate: data.birth_date ? String(data.birth_date) : "",
      groupId: data.group_id ?? "",
      attendanceHistory: [], // historial vive en student_attendance
    };

    setStudents(prev => [...prev, created]);
  };

  const removeStudent = async (id: string) => {
    if (blockIfOffline("eliminar el catecúmeno")) return;
    const { error } = await supabase.from("students").delete().eq("id", id);

    if (error) {
      alert("Error al eliminar catecúmeno: " + error.message);
      return;
    }

    setStudents(prev => prev.filter(s => s.id !== id));
  };

  const updateUser = async (updatedUser: User) => {
    if (blockIfOffline("actualizar el perfil")) return;
    const birth = updatedUser.birthDate?.slice(0, 10) || null;

    const payload = {
      name: updatedUser.name,
      birth_date: birth,
    };

    const { data, error } = await supabase
      .from("profiles")
      .update(payload)
      .eq("id", updatedUser.id)
      .select("id, birth_date");

    console.log("error", error);
    console.log("data", data);

    if (error) {
      alert("Error actualizando perfil: " + error.message);
      return;
    }

    console.log("update ok, retorno:", data); // puede ser null si RLS impide el select

    await loadBaseData(currentUser!);
  };


  const addUser = async (input: { name: string; email: string; password: string; birthDate?: string; groupIds: string[] }) => {
    if (blockIfOffline("crear el catequista")) return;
    const payload = {
      email: input.email,
      password: input.password,
      name: input.name,
      birth_date: input.birthDate ?? null,
      group_ids: input.groupIds ?? [],   // <-- CLAVE
    };

    const res = await supabase.functions.invoke("create-catechist", { body: payload });

    if (res.error) {
      let extra = "";
      const anyErr: any = res.error;

      if (anyErr?.context instanceof Response) {
        try {
          const txt = await anyErr.context.text();
          extra = txt ? ` | body: ${txt}` : "";
        } catch (e) {
          extra = ` | (no pude leer body: ${String(e)})`;
        }
      }

      alert(`Error creando catequista: ${res.error.name} - ${res.error.message}${extra}`);
      return;
    }

    const newUserId = (res.data as any)?.userId || (res.data as any)?.id;
    if (!newUserId) {
      alert("Usuario creado, pero no recibí su id desde create-catechist.");
      await loadBaseData(currentUser!);
      return;
    }

    // Ya no insertamos en group_catechist aquí: lo hace la Edge Function
    // Si la Edge devuelve warn, lo mostramos:
    const warn = (res.data as any)?.warn;
    if (warn) alert("Usuario creado con aviso: " + warn);

    await loadBaseData(currentUser!);
  };




  const removeUser = async (id: string) => {
    if (blockIfOffline("eliminar el catequista")) return;
    const { data, error } = await supabase.functions.invoke("delete-user", {
      body: { userId: id },
    });

    if (error) {
      alert("Error eliminando catequista: " + (error.message ?? "unknown"));
      return;
    }

    await loadBaseData(currentUser!);
  };

  const updateGroup = async (updatedGroup: Group) => {
    if (blockIfOffline("actualizar el grupo")) return;
    const { data, error } = await supabase
      .from("groups")
      .update({ name: updatedGroup.name })
      .eq("id", updatedGroup.id)
      .select("id, name")
      .single();

    if (error) {
      alert("Error actualizando grupo: " + error.message);
      return;
    }

    setGroups(prev => prev.map(g => (g.id === data.id ? { ...g, name: data.name } : g)));
  };

  const addGroup = async (name: string) => {
    if (blockIfOffline("crear el grupo")) return;
    const { data, error } = await supabase
      .from("groups")
      .insert({ name })
      .select("id, name")
      .single();

    if (error) {
      alert("Error creando grupo: " + error.message);
      return;
    }

    setGroups(prev => [...prev, { id: data.id, name: data.name, catechistIds: [] }]);
  };


  const resetPassword = async (userId: string, newPassword: string) => {
    if (blockIfOffline("resetear la contraseña")) return;
    const { error } = await supabase.functions.invoke("reset-password", {
      body: { userId, newPassword },
    });

    if (error) {
      alert("Error reseteando contraseña: " + (error.message ?? "unknown"));
      return;
    }

    alert("Contraseña reseteada correctamente.");
  };


  const removeGroup = async (groupId: string) => {
    if (blockIfOffline("eliminar el grupo")) return;
    const { count, error: countErr } = await supabase
      .from("students")
      .select("*", { count: "exact", head: true })
      .eq("group_id", groupId);

    if (countErr) {
      alert("Error comprobando alumnos del grupo: " + countErr.message);
      return;
    }

    if ((count ?? 0) > 0) {
      alert("No puedes eliminar este grupo porque tiene alumnos asignados. Muévelos antes a otro grupo.");
      return;
    }

    // borrar links
    const { error: linkErr } = await supabase
      .from("group_catechist")
      .delete()
      .eq("group_id", groupId);

    if (linkErr) {
      alert("Error desasignando catequistas del grupo: " + linkErr.message);
      return;
    }

    const { error } = await supabase.from("groups").delete().eq("id", groupId);
    if (error) {
      alert("Error eliminando grupo: " + error.message);
      return;
    }

    setGroups(prev => prev.filter(g => g.id !== groupId));
    setGroupCatechistLinks(prev => prev.filter(l => l.group_id !== groupId));
    setActiveGroupId(prev => (prev === groupId ? null : prev));
  };

  const myGroups = useMemo(() => {
    if (!currentUser) return [];
    const myIds = new Set(
      groupCatechistLinks
        .filter(l => l.profile_id === currentUser.id)
        .map(l => l.group_id)
    );
    return groups
      .filter(g => myIds.has(g.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  }, [currentUser, groups, groupCatechistLinks]);

  const groupsWithCatechists = useMemo(() => {
    const byGroup = new Map<string, string[]>();

    for (const l of groupCatechistLinks) {
      const arr = byGroup.get(l.group_id) ?? [];
      arr.push(l.profile_id);
      byGroup.set(l.group_id, arr);
    }

    return groups.map(g => ({
      ...g,
      catechistIds: byGroup.get(g.id) ?? [],
    }));
  }, [groups, groupCatechistLinks]);


  const addEvent = async (event: { title: string; date: string }) => {
    const { data, error } = await supabase
      .from("parish_events")
      .insert({ title: event.title, date: event.date })
      .select("id, title, date")
      .single();

    if (error) {
      alert("Error al añadir evento: " + error.message);
      return;
    }

    const createdEvent = {
      id: data.id,
      title: data.title,
      date: String(data.date),
    };

    setEvents(prev => [...prev, createdEvent]);

    try {
      const formattedDate = new Date(createdEvent.date).toLocaleDateString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });

      const res = await supabase.functions.invoke("send-push-notifications", {
        body: {
          title: "Nuevo evento en la agenda",
          body: `${createdEvent.title} · ${formattedDate}`,
          url: "/",
        },
      });

      if (res.error) {
        console.error("Error enviando notificación push:", res.error);
      }
    } catch (e) {
      console.error("Error inesperado enviando push:", e);
    }
  };

  const setCatechistInGroup = async (profileId: string, groupId: string, assign: boolean) => {
    if (blockIfOffline(assign ? "asignar el catequista al grupo" : "desasignar el catequista del grupo")) return;
    if (assign) {
      const { error } = await supabase
        .from("group_catechist")
        .insert({ profile_id: profileId, group_id: groupId });

      if (error) {
        alert("Error asignando catequista: " + error.message);
        return;
      }
    } else {
      const { error } = await supabase
        .from("group_catechist")
        .delete()
        .eq("profile_id", profileId)
        .eq("group_id", groupId);

      if (error) {
        alert("Error desasignando catequista: " + error.message);
        return;
      }
    }

    await loadBaseData(currentUser!);
  };

  const removeEvent = async (id: string) => {
    if (blockIfOffline("eliminar el evento")) return;
    const { error } = await supabase
      .from("parish_events")
      .delete()
      .eq("id", id);

    if (error) {
      alert("Error al eliminar evento: " + error.message);
      return;
    }

    setEvents(prev => prev.filter(e => e.id !== id));
  };

  const toggleClassDay = async (date: string) => {
    if (blockIfOffline("modificar el calendario lectivo")) return;
    const exists = classDays.includes(date);

    if (!exists) {
      const { error } = await supabase
        .from("class_days")
        .insert({ date });

      if (error) {
        alert("Error al añadir día lectivo: " + error.message);
        return;
      }

      setClassDays(prev => [...prev, date].sort());
      return;
    }

    const { error } = await supabase
      .from("class_days")
      .delete()
      .eq("date", date);

    if (error) {
      alert("Error al quitar día lectivo: " + error.message);
      return;
    }

    setClassDays(prev => prev.filter(d => d !== date));
  };


  const myCatecumenos = useMemo(() => {
    if (!currentUser) return [];
    if (!activeGroupId) return [];

    return students
      .filter(s =>
        s.groupId === activeGroupId &&
        normalizeSearchText(s.name).includes(normalizeSearchText(searchQuery))
      )
      .sort((a, b) =>
        a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
      );
  }, [students, currentUser, activeGroupId, searchQuery]);


  const filteredUsers = useMemo(() => {
    if (!searchQuery) return users;
    return users.filter(u =>
      normalizeSearchText(u.name).includes(normalizeSearchText(searchQuery))
      )
      .sort((a, b) =>
        a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })
      );
  }, [users, searchQuery]);


  const currentGroupName = useMemo(
    () => groups.find(g => g.id === activeGroupId)?.name || '',
    [activeGroupId, groups]
  );


  const hasAnyGroupAssigned = useMemo(() => {
    if (!currentUser) return false;
    return groupCatechistLinks.some(l => l.profile_id === currentUser.id);
  }, [currentUser, groupCatechistLinks]);

  const myGroupIds = useMemo(() => {
    if (!currentUser) return [];
    return groupCatechistLinks
      .filter(l => l.profile_id === currentUser.id)
      .map(l => l.group_id);
  }, [currentUser, groupCatechistLinks]);

  const activeGroupStudents = useMemo(() => {
    if (!activeGroupId) return [];
    return students.filter(s => s.groupId === activeGroupId);
  }, [students, activeGroupId]);

  const showNoGroupWarning = !!currentUser && !hasAnyGroupAssigned;
  const showNoStudentsWarning = !!currentUser && hasAnyGroupAssigned && !!activeGroupId && activeGroupStudents.length === 0;

  const warningMessage = useMemo(() => {
    if (showNoGroupWarning) {
      return "No tienes ningún grupo asignado. Contacta con el coordinador si crees que se trata de un error.";
    }
    if (showNoStudentsWarning) {
      const name = currentGroupName || "tu grupo";
      return `En tu grupo [${name}] no hay ningún niño/a asignado. Contacta con el coordinador si crees que se trata de un error.`;
    }
    return "";
  }, [showNoGroupWarning, showNoStudentsWarning, currentGroupName]);




  if (!currentUser) return <Login onLogin={handleLogin} />;

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden relative">
      {showBirthdayPopup && (
        <BirthdayPopup
          currentUser={currentUser}
          birthdays={todayBirthdays}
          onClose={() => {
            const today = getTodayStr();
            localStorage.setItem(`birthday_popup_seen_${today}`, "1");
            setShowBirthdayPopup(false);
          }}
        />
      )}
      {showStudentBirthdayPopup && (
        <StudentBirthdayPopup
          currentUser={currentUser}
          birthdays={todayStudentBirthdays}
          onClose={() => {
            const today = getTodayStr();
            localStorage.setItem(`student_birthday_popup_seen_${today}_${currentUser.id}`, "1");
            setShowStudentBirthdayPopup(false);
          }}
        />
      )}

      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside className={`
        fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-slate-200 flex flex-col transition-transform duration-300 transform
        lg:translate-x-0 lg:static lg:inset-auto
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3 text-indigo-700 font-bold text-xl leading-tight">
            <div className="p-2 bg-indigo-100 rounded-lg"><Church size={24} /></div>
            <div><p>San Pascual Baylón</p><p className="text-sm font-medium text-slate-400">Valencia</p></div>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2 text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto pb-6">
          <div className="px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">General</div>

          <button
            onClick={() => navigateTo('dashboard')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
              currentView === 'dashboard' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <BarChart3 size={20} />
            <span className="font-medium text-sm">Resumen</span>
          </button>

          <button
            onClick={() => navigateTo('school-calendar')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
              currentView === 'school-calendar' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <CalendarDays size={20} />
            <span className="font-medium text-sm">Calendario escolar</span>
          </button>
          
          <div className="mt-4 px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Mi Grupo</div>
          <button onClick={() => navigateTo('attendance')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${currentView === 'attendance' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}><CheckCircle2 size={20} /><span className="font-medium text-sm">Pasar Lista</span></button>
          <button onClick={() => navigateTo('students')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${currentView === 'students' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}><Users size={20} /><span className="font-medium text-sm">Mis Catecúmenos</span></button>
          <button
            onClick={() => navigateTo('services')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
              currentView === 'services'
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <ClipboardList size={20} />
            <span className="font-medium text-sm">Servicios</span>
          </button>
          <button
            onClick={() => navigateTo('incidents')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
              currentView === 'incidents' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <TriangleAlert size={20} />
            <span className="font-medium text-sm">Incidencias</span>
          </button>

          {currentUser.role === 'coordinator' && (
            <>
              <div className="mt-4 px-4 py-2 text-[10px] font-bold text-amber-600 uppercase tracking-widest">Coordinación</div>
              <button onClick={() => navigateTo('coordinator-groups')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${currentView === 'coordinator-groups' ? 'bg-amber-50 text-amber-700' : 'text-slate-600 hover:bg-slate-50'}`}><ShieldCheck size={20} /><span className="font-medium text-sm">Todos los Niños</span></button>
              <button onClick={() => navigateTo('catechists')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${currentView === 'catechists' ? 'bg-amber-50 text-amber-700' : 'text-slate-600 hover:bg-slate-50'}`}><Briefcase size={20} /><span className="font-medium text-sm">Registro Catequistas</span></button>
              <button onClick={() => navigateTo('catechist-attendance')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${currentView === 'catechist-attendance' ? 'bg-amber-50 text-amber-700' : 'text-slate-600 hover:bg-slate-50'}`}><CheckCircle2 size={20} /><span className="font-medium text-sm">Asistencia Equipo</span></button>
              <button onClick={() => navigateTo('coordinator-edit-groups')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${currentView === 'coordinator-edit-groups' ? 'bg-amber-50 text-amber-700' : 'text-slate-600 hover:bg-slate-50'}`}><Settings size={20} /><span className="font-medium text-sm">Editar Grupos</span></button>
              <button onClick={() => navigateTo('class-days')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${currentView === 'class-days' ? 'bg-amber-50 text-amber-700' : 'text-slate-600 hover:bg-slate-50'}`}><CalendarDays size={20} /><span className="font-medium text-sm">Gestión de calendario</span></button>
              <button onClick={() => navigateTo('agenda')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${currentView === 'agenda' ? 'bg-amber-50 text-amber-700' : 'text-slate-600 hover:bg-slate-50'}`}><Calendar size={20} /><span className="font-medium text-sm">Gestión Agenda</span></button>
            </>
          )}

          <div className="mt-4 px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Análisis</div>
          <button onClick={() => navigateTo('reports')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${currentView === 'reports' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}><Mail size={20} /><span className="font-medium text-sm">Informes IA</span></button>
          
          <div className="mt-4 px-4 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cuenta y Seguridad</div>
          <button onClick={() => navigateTo('account')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${currentView === 'account' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}><Key size={20} /><span className="font-medium text-sm">Seguridad</span></button>
          <button
            onClick={() => navigateTo('my-account')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
              currentView === 'my-account'
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <UserIcon size={20} />
            <span className="font-medium text-sm">Cuenta</span>
          </button>
        </nav>

        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 overflow-hidden">
              {currentUser.photo ? <img src={currentUser.photo} className="w-full h-full object-cover" /> : <UserIcon size={18} />}
            </div>
            <div className="flex-1 min-w-0"><p className="text-sm font-medium text-slate-900 truncate">{currentUser.name}</p><p className="text-xs text-slate-500 truncate capitalize">{currentUser.role}</p></div>
            {/* Fix: removed invalid handleLogout attribute and moved onClick to the button */}
            <button onClick={handleLogout} className="text-slate-400 hover:text-red-500 transition-colors"><LogOut size={18} /></button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto w-full">
        <header className="bg-white border-b border-slate-200 sticky top-0 z-30 px-4 lg:px-8 py-3 lg:py-4 flex items-center justify-between min-h-[64px]">
          <div className="flex items-center gap-3 lg:gap-4 flex-1 min-w-0">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-2 bg-slate-100 rounded-lg text-slate-600 hover:bg-slate-200 transition-colors shrink-0"
            >
              <Menu size={20} />
            </button>
            <h1 className="text-[15px] sm:text-lg lg:text-xl font-semibold text-slate-800 leading-tight line-clamp-2 max-h-[3rem]">
              {currentView === 'dashboard' && 'Dashboard Parroquial'}
              {currentView === 'school-calendar' && 'Calendario escolar'}
              {currentView === 'attendance' && 'Control de Asistencia'}
              {currentView === 'students' && (currentGroupName || 'Mis Catecúmenos')}
              {currentView === 'services' && 'Servicios'}
              {currentView === 'incidents' && 'Gestión de incidencias'}
              {currentView === 'reports' && 'Informes pastorales con IA'}
              {currentView === 'coordinator-groups' && 'Gestión Integral de Niños'}
              {currentView === 'catechists' && 'Registro de Catequistas'}
              {currentView === 'catechist-attendance' && 'Asistencia del Equipo'}
              {currentView === 'coordinator-edit-groups' && 'Administración de Grupos'}
              {currentView === 'agenda' && 'Planificador de Eventos'}
              {currentView === 'class-days' && 'Calendario de Días Lectivos'}
              {currentView === 'account' && 'Seguridad de la Cuenta'}
              {currentView === 'my-account' && 'Mi Cuenta'}
            </h1>
            <div>
              {myGroups.length > 1 && (
                <select
                  className="px-3 py-2 bg-slate-100 rounded-xl text-sm"
                  value={activeGroupId ?? ""}
                  onChange={(e) => setActiveGroupId(e.target.value || null)}
                >
                  {myGroups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
          
          <div className="hidden sm:flex items-center gap-4 ml-4">
            {isSearchView && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input type="text" placeholder="Buscar..." className="pl-10 pr-4 py-2 bg-slate-100 border-none rounded-full text-sm focus:ring-2 focus:ring-indigo-500 w-48 lg:w-64 transition-all" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
              </div>
            )}
          </div>
        </header>

        {!isOnline && (
          <div className="mx-4 mt-4 lg:mx-8 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm">
            <div className="flex items-start gap-3">
              <TriangleAlert size={18} className="mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-semibold">Modo sin conexión</p>
                <p>
                  Estás viendo los últimos datos guardados en este dispositivo. Algunos cambios no podrán guardarse hasta que vuelva la conexión.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="p-4 lg:p-8">
          {isSearchView && (
            <div className="sm:hidden mb-6 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input type="text" placeholder="Buscar..." className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
          )}

          {currentView === 'dashboard' && <Dashboard students={students} events={events} onManageAgenda={currentUser.role === 'coordinator' ? () => setCurrentView('agenda') : undefined} classDays={classDays} />}
          {currentView === 'attendance' && (
            <AttendanceTracker
              students={myCatecumenos}
              onUpdate={updateStudentAttendance}
              classDays={classDays}
              warningMessage={warningMessage}
              warningType={showNoGroupWarning ? "no-group" : showNoStudentsWarning ? "no-students" : undefined}
              isOnline={isOnline}
            />
          )}
          {currentView === 'school-calendar' && (
            <SchoolCalendar classDays={classDays} />
          )}

          {currentView === 'incidents' && (
            <IncidentsManager
              currentUser={currentUser}
              groups={groups}
              students={students}
              users={incidentUsers}
              activeGroupId={activeGroupId}
              groupCatechistLinks={groupCatechistLinks}
              isOnline={isOnline}
            />
          )}

          {currentView === 'students' && (
            <StudentList
              students={myCatecumenos}
              onUpdateStudent={(s) => void updateStudent(s)}
              groups={groups}
              canEditCenso={false}
              classDays={classDays}
              warningMessage={warningMessage}
              warningType={showNoGroupWarning ? "no-group" : showNoStudentsWarning ? "no-students" : undefined}
              schoolNames={schoolNames}
              isOnline={isOnline}
            />
          )}
          {currentView === 'services' && (
            <ServicesManagement
              currentUser={currentUser}
              students={myCatecumenos}
              warningMessage={warningMessage}
              warningType={showNoGroupWarning ? "no-group" : showNoStudentsWarning ? "no-students" : undefined}
              isOnline={isOnline}
            />
          )}

          {currentView === 'coordinator-groups' && (
            <StudentList
              students={students.filter(s => normalizeSearchText(s.name).includes(normalizeSearchText(searchQuery)))}
              onUpdateStudent={(s) => void updateStudent(s)}
              canEditCenso={true}
              onAddStudent={(s) => void addStudent(s)}
              onRemoveStudent={(id) => void removeStudent(id)}
              groups={groups}
              classDays={classDays}
              enableMassServices={true}
              schoolNames={schoolNames}
              isOnline={isOnline}
            />
          )}

          {currentView === 'catechists' && currentUser.role === 'coordinator' && (
            <CatechistManager
              users={users}
              filteredUsers={filteredUsers}
              onAddUser={(u) => addUser(u)}
              onRemoveUser={(id) => { void removeUser(id); }}
              onUpdateUser={updateUser}
              onSetUserGroups={(uid, gids) => setUserGroups(uid, gids)}
              getUserGroupIds={(uid) => getUserGroupIds(uid)}
              groups={groups}
              classDays={classDays}
              events={events}
              onResetPassword={(uid, pw) => resetPassword(uid, pw)}
              isOnline={isOnline}
            />
          )}

          {currentView === 'catechist-attendance' && currentUser.role === 'coordinator' && <CatechistAttendance users={users.filter(u => u.role === 'catechist' || u.role === 'coordinator')} events={events} classDays={classDays} onUpdate={updateCatechistAttendance} />}
          {currentView === 'coordinator-edit-groups' && (
            <GroupManager
              groups={groupsWithCatechists}
              students={students}
              users={users}
              onUpdateGroup={(g) => void updateGroup(g)}
              onUpdateStudent={(s) => void updateStudent(s)}
              onAssignCatechist={(uid, gid, assign) => void setCatechistInGroup(uid, gid, assign)}
            />
          )}

          {currentView === 'class-days' && currentUser.role === 'coordinator' && (
            <ClassDayManager
              classDays={classDays}
              onToggle={(d) => void toggleClassDay(d)}
            />
          )}
          {currentView === 'agenda' && currentUser.role === 'coordinator' && (
            <AgendaManager
              events={events}
              onAdd={(e) => void addEvent(e)}
              onRemove={(id) => void removeEvent(id)}
            />
          )}
          {currentView === 'reports' && (
            <Reports
              students={students}
              currentUser={currentUser}
              groups={groups}
              classDays={classDays}
              users={users}
              events={events}
              activeGroupId={activeGroupId}
              myGroups={myGroups}
              isOnline={isOnline}
            />
          )}
          {currentView === 'account' && (
            <AccountSettings
              user={currentUser}
              onUpdate={updateUser}
              isOnline={isOnline}
            />
          )}
          {currentView === 'my-account' && (
            <MyAccount
              user={currentUser}
              groups={groups}
              activeGroupId={activeGroupId}
              isOnline={isOnline}
            />
          )}
        </div>
      </main>
    </div>
  );
};

const AccountSettings: React.FC<{ user: User, onUpdate: (u: User) => void, isOnline: boolean }> = ({ user, onUpdate, isOnline }) => {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const handleUpdatePassword = async () => {
    if (!isOnline) {
      alert("No hay conexión. No se puede actualizar la contraseña hasta que vuelva internet.");
      return;
    }
    if (!newPassword) {
      alert("Por favor introduce una nueva contraseña.");
      return;
    }
    if (newPassword !== confirmPassword) {
      alert("Las contraseñas no coinciden.");
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      alert("No se pudo actualizar la contraseña: " + error.message);
      return;
    }

    setNewPassword("");
    setConfirmPassword("");
    alert("Contraseña actualizada con éxito.");
  };


  return (
    <div className="max-w-md mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white p-6 lg:p-8 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-4 mb-8">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <Key size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Seguridad</h2>
            <p className="text-slate-500 text-sm">Cambia tu contraseña de acceso.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">Nueva Contraseña</label>
            <input 
              type="password"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">Confirmar Contraseña</label>
            <input 
              type="password"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
            />
          </div>
          <button
            onClick={() => void handleUpdatePassword()}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl shadow-lg transition-all mt-4"
          >
            Actualizar Contraseña
          </button>

        </div>
      </div>
    </div>
  );
};

const MyAccount: React.FC<{ user: User; groups: Group[]; activeGroupId: string | null; isOnline: boolean }> = ({ user, groups, activeGroupId, isOnline }) => {
  const groupName =
    groups.find(g => g.id === activeGroupId)?.name ||
    (user.role === 'coordinator' ? 'Coordinación' : 'Sin grupo');

  const birth = user.birthDate ? String(user.birthDate).slice(0, 10) : '';
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  useEffect(() => {
    const checkPushStatus = async () => {
      if (!("serviceWorker" in navigator)) return;

      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setPushEnabled(!!subscription);
      } catch (error) {
        console.error("Error comprobando estado de notificaciones push:", error);
        setPushEnabled(false);
      }
    };

    void checkPushStatus();
  }, []);

  const handleEnablePush = async () => {
    if (!isOnline) {
      alert("No hay conexión. No se pueden activar las notificaciones hasta que vuelva internet.");
      return;
    }

    setPushLoading(true);
    try {
      const subscription = await subscribeToPush(user.id);

      if (!subscription) {
        alert("No se concedió permiso para las notificaciones.");
        setPushEnabled(false);
        return;
      }

      setPushEnabled(true);
      alert("Notificaciones activadas correctamente.");
    } catch (error: any) {
      console.error(error);
      alert(error?.message ?? "No se pudieron activar las notificaciones.");
      setPushEnabled(false);
    } finally {
      setPushLoading(false);
    }
  };

  const handleDisablePush = async () => {
    if (!isOnline) {
      alert("No hay conexión. No se pueden desactivar las notificaciones hasta que vuelva internet.");
      return;
    }

    setPushLoading(true);
    try {
      await unsubscribeFromPush();
      setPushEnabled(false);
      alert("Notificaciones desactivadas correctamente.");
    } catch (error: any) {
      console.error(error);
      alert(error?.message ?? "No se pudieron desactivar las notificaciones.");
    } finally {
      setPushLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white p-6 lg:p-8 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-4 mb-6">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <UserIcon size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Cuenta</h2>
            <p className="text-slate-500 text-sm">Información de tu perfil.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">
              Nombre
            </label>
            <div className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm text-slate-800">
              {user.name || '-'}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">
              Grupo asignado
            </label>
            <div className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm text-slate-800">
              {groupName}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">
              Correo
            </label>
            <div className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm text-slate-800">
              {user.email || '-'}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">
              Fecha de nacimiento
            </label>
            <div className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm text-slate-800">
              {birth || 'No registrada'}
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">
              Notificaciones
            </label>

            <div className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    {pushEnabled ? <Bell size={16} /> : <BellOff size={16} />}
                    {pushEnabled ? "Activadas" : "Desactivadas"}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Recibe avisos cuando haya novedades relevantes en la aplicación, como eventos nuevos.
                  </p>
                  {!isOnline && (
                    <p className="text-xs text-amber-700 mt-2 font-medium">
                      Sin conexión. No puedes cambiar esta opción ahora mismo.
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  disabled={pushLoading || !isOnline}
                  onClick={() => {
                    if (pushEnabled) {
                      void handleDisablePush();
                    } else {
                      void handleEnablePush();
                    }
                  }}
                  className={`shrink-0 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                    pushLoading || !isOnline
                      ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                      : pushEnabled
                        ? "bg-red-50 text-red-600 hover:bg-red-100"
                        : "bg-indigo-600 text-white hover:bg-indigo-700"
                  }`}
                >
                  {pushLoading
                    ? "Procesando..."
                    : pushEnabled
                      ? "Desactivar"
                      : "Activar"}
                </button>
              </div>
            </div>
          </div>
          <div className="mt-6 p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-sm">
            <span className="font-bold">Aviso:</span> Para cualquier cambio, por favor ponte en contacto con el coordinador de tu nivel.
          </div>
        </div>
      </div>
    </div>
  );
};


const AgendaManager: React.FC<{ events: ParishEvent[], onAdd: (e: ParishEvent) => void, onRemove: (id: string) => void }> = ({ events, onAdd, onRemove }) => {
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const handleAdd = () => {
    if (!newTitle || !newDate) return;
    onAdd({ title: newTitle, date: newDate } as any);
    setNewTitle('');
    setNewDate('');
  };
  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="text-lg font-bold text-slate-800 mb-4">Añadir Nuevo Evento</h3>
        <div className="flex flex-col sm:flex-row gap-4">
          <input type="text" placeholder="Título" className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          <input type="date" className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
          <button onClick={handleAdd} className="w-full sm:w-auto p-2 bg-indigo-600 text-white rounded-xl flex items-center justify-center"><Plus size={24} /></button>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden"><div className="p-6 border-b border-slate-100"><h3 className="font-bold text-slate-800">Eventos Activos</h3></div><div className="divide-y divide-slate-100">{events.map(event => (<div key={event.id} className="p-4 flex items-center justify-between hover:bg-slate-50"><div className="flex items-center gap-4"><div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg"><Calendar size={18} /></div><div><p className="font-semibold text-slate-900">{event.title}</p><p className="text-xs text-slate-500">{new Date(event.date).toLocaleDateString()}</p></div></div><button onClick={() => onRemove(event.id)} className="p-2 text-slate-300 hover:text-red-500 transition-colors"><Plus size={18} className="rotate-45" /></button></div>))}</div></div>
    </div>
  );
};

export default App;
