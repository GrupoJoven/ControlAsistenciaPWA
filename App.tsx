
import { supabase } from "./src/lib/supabaseClient";
import { saveOfflineData, getOfflineData } from "./src/utils/offlineStorage";
import { useOnlineStatus } from "./src/hooks/useOnlineStatus";
import { subscribeToPush, unsubscribeFromPush } from "./src/pwa/push";
import { normalizeSearchText } from "./src/utils/text";
import {
  getActiveGroupStudents,
  getCurrentGroupName,
  getFilteredUsers,
  getGroupsWithCatechists,
  getHasAnyGroupAssigned,
  getMyCatecumenos,
  getMyGroups,
  getUserGroupIdsFromLinks,
  getWarningFlags,
  getWarningMessage,
} from "./src/app/selectors";

import {
  loadGroupsAndLinks,
  loadProfiles,
  loadSchoolNames,
  signMediaUrl,
  loadEvents,
  loadClassDays,
  loadStudents,
  loadAttendance,

} from "./src/app/loaders";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Plus, 
  TriangleAlert,
  Bell,
  BellOff,
  Search,
  X
} from 'lucide-react';
import { Student, AttendanceRecord, User, Group, ParishEvent, getTodayStr, AttendanceStatus, CatechistAttendanceRecord } from './types';
import Dashboard from './components/Dashboard';
import AttendanceTracker from './components/AttendanceTracker';
import Historial from './components/Historial';
import HistoricoGrupos from './components/HistoricoGrupos';
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
import AccountSettings from './components/AccountSettings';
import MyAccount from './components/MyAccount';
import Drive from './components/Drive';
import AgendaManager from './components/AgendaManager';
import AppSidebar from "./components/layout/AppSidebar";
import AppHeader from "./components/layout/AppHeader";


import {
  View,
  GroupCatechistLink,
  SchoolName,
  BirthdayInfo,
  StudentBirthdayInfo,
} from "./src/types/app";

import { ImportedStudent } from "./src/utils/studentImport";

import {
  filterDatesByAcademicYear,
  findAcademicYearByKey,
  getAcademicYearState,
  getDefaultAcademicYear,
  listAcademicYears,
} from "./src/utils/academicYear";

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

  const [groupCatechistLinks, setGroupCatechistLinks] = useState<GroupCatechistLink[]>([]);

  const [schoolNames, setSchoolNames] = useState<SchoolName[]>([]);

  // Para catequistas con varios grupos: cuál está “activo” en la UI
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [selectedAcademicYearKey, setSelectedAcademicYearKey] = useState<string | null>(null);
  const [lastPromotionAt, setLastPromotionAt] = useState<string | null>(null);

  const [baseDataLoaded, setBaseDataLoaded] = useState(false);
  const [todayBirthdays, setTodayBirthdays] = useState<BirthdayInfo[]>([]);
  const [showBirthdayPopup, setShowBirthdayPopup] = useState(false);

  const [todayStudentBirthdays, setTodayStudentBirthdays] = useState<StudentBirthdayInfo[]>([]);
  const [showStudentBirthdayPopup, setShowStudentBirthdayPopup] = useState(false);
  const isOnline = useOnlineStatus();
  const wasOnlineRef = useRef(isOnline);
  const lastRefreshRef = useRef(0);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushStatusChecked, setPushStatusChecked] = useState(false);
  const [dismissedPushBanner, setDismissedPushBanner] = useState(false);



  
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
      setSchoolNames(await loadSchoolNames());
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
          .select("id, name, role, birth_date, photo_path")
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
          photo: await signMediaUrl(profile.photo_path),
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
      setSchoolNames(await loadSchoolNames());
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

  useEffect(() => {
    const checkPushStatus = async () => {
      if (!currentUser) {
        setPushSupported(false);
        setPushEnabled(false);
        setPushStatusChecked(false);
        return;
      }

      const supported =
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window;

      setPushSupported(supported);

      if (!supported) {
        setPushEnabled(false);
        setPushStatusChecked(true);
        return;
      }

      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setPushEnabled(!!subscription);
      } catch (error) {
        console.error("Error comprobando estado global de notificaciones push:", error);
        setPushEnabled(false);
      } finally {
        setPushStatusChecked(true);
      }
    };

    void checkPushStatus();
  }, [currentUser]);

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
      .select("id, name, role, birth_date, photo_path")
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
      photo: await signMediaUrl(profile.photo_path),
    };
  
    try {
      await saveOfflineData("currentUser", appUser);
      setCurrentUser(appUser);
      setSchoolNames(await loadSchoolNames());
      await loadBaseData(appUser);
      setCurrentView("dashboard");
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Error cargando datos");
      setCurrentUser(null);
    }
  };


  const loadBaseData = async (user: User) => {
    setBaseDataLoaded(false);
    const { groups: groupsMapped, links } = await loadGroupsAndLinks();

    setGroupCatechistLinks(links);
    setGroups(groupsMapped);

    const myGroupIds = links
      .filter(l => l.profile_id === user.id)
      .map(l => l.group_id);

    setActiveGroupId(prev => (prev && myGroupIds.includes(prev) ? prev : (myGroupIds[0] ?? null)));
    const usersMapped = await loadProfiles();


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
    const studentsMapped = await loadStudents();
    const attendanceByStudent = await loadAttendance();

    // Combinar asistencia con estudiantes
    const studentsWithAttendance = studentsMapped.map((student) => ({
      ...student,
      attendanceHistory: attendanceByStudent.get(student.id) ?? [],
    }));

    setStudents(studentsWithAttendance);

    // --- promoción de curso ya realizada ---
    // En agosto, septiembre y octubre el curso de destino es el que empieza este
    // mismo año natural, igual que calcula promote_academic_year().
    try {
      const { data: promotionData } = await supabase
        .from("academic_year_promotions")
        .select("promoted_at")
        .eq("academic_year_start", new Date().getFullYear())
        .maybeSingle();

      setLastPromotionAt(promotionData?.promoted_at ?? null);
    } catch {
      // Si no se puede leer, se deja bloqueado el botón: es el lado seguro.
      setLastPromotionAt(new Date().toISOString());
    }

    // --- parish_events ---
    const eventsMapped = await loadEvents();

    setEvents(eventsMapped);

    // --- class_days ---
    const classDaysMapped = await loadClassDays();

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
    setPushEnabled(false);
    setPushSupported(false);
    setPushStatusChecked(false);
    setDismissedPushBanner(false);
  };


  const navigateTo = (view: View) => {
    setCurrentView(view);
    setIsSidebarOpen(false);
    setSearchQuery(''); // Reset search when switching views
  };

  const isSearchView = ['students', 'coordinator-groups', 'catechists'].includes(currentView);

  // --- Curso académico -------------------------------------------------------
  // El curso va del 1 de septiembre al 31 de agosto. Se ofrecen en el selector
  // los cursos que tengan algún registro, más el actual aunque esté vacío.
  const attendanceDates = useMemo(
    () => students.flatMap((student) => (student.attendanceHistory ?? []).map((h) => h.date)),
    [students]
  );

  // Solo cuentan días lectivos y asistencia. Los eventos de la agenda quedan
  // fuera a propósito: una entrada con fecha lejana haría aparecer un curso
  // entero en el selector sin que exista un solo registro de asistencia.
  const availableAcademicYears = useMemo(
    () => listAcademicYears(classDays, attendanceDates),
    [classDays, attendanceDates]
  );

  const selectedAcademicYear = useMemo(
    () =>
      findAcademicYearByKey(availableAcademicYears, selectedAcademicYearKey) ??
      getDefaultAcademicYear(availableAcademicYears),
    [availableAcademicYears, selectedAcademicYearKey]
  );

  const academicYearState = getAcademicYearState(selectedAcademicYear);
  const isCurrentAcademicYear = academicYearState === 'current';

  // Un curso cerrado solo lo corrige el coordinator. En uno que todavía no ha
  // empezado no hay nada que editar, así que no se habilita para nadie.
  const canEditSelectedYear =
    academicYearState === 'current' ||
    (academicYearState === 'past' && currentUser?.role === 'coordinator');

  const academicYearClassDays = useMemo(
    () => filterDatesByAcademicYear(classDays, selectedAcademicYear),
    [classDays, selectedAcademicYear]
  );

  const academicYearEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          event.date >= selectedAcademicYear.start && event.date <= selectedAcademicYear.end
      ),
    [events, selectedAcademicYear]
  );
  const persistStudentAttendance = async (
    date: string,
    studentId: string,
    type: "catechism" | "mass",
    status: AttendanceStatus
  ) => {
    if (blockIfOffline("guardar la asistencia")) return;

    const { data: current, error: readErr } = await supabase
      .from("student_attendance")
      .select("catechism, mass")
      .eq("student_id", studentId)
      .eq("date", date)
      .maybeSingle();

    if (readErr) {
      alert("Error leyendo asistencia actual: " + readErr.message);
      return;
    }

    const next = {
      student_id: studentId,
      date,
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

    setStudents(prev =>
      prev.map(st => {
        if (st.id !== studentId) return st;

        const history = [...(st.attendanceHistory ?? [])];
        const idx = history.findIndex(h => h.date === date);

        if (idx >= 0) {
          history[idx] = {
            date,
            catechism: next.catechism as AttendanceStatus,
            mass: next.mass as AttendanceStatus,
          };
        } else {
          history.push({
            date,
            catechism: next.catechism as AttendanceStatus,
            mass: next.mass as AttendanceStatus,
          });
        }

        return { ...st, attendanceHistory: history };
      })
    );
  };

  const updateStudentAttendance = async (
    studentId: string,
    type: "catechism" | "mass",
    status: AttendanceStatus
  ) => {
    await persistStudentAttendance(getTodayStr(), studentId, type, status);
  };

  const updateHistoricalStudentAttendance = async (
    date: string,
    studentId: string,
    type: "catechism" | "mass",
    status: AttendanceStatus
  ) => {
    await persistStudentAttendance(date, studentId, type, status);
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
    const current = getUserGroupIdsFromLinks(userId, groupCatechistLinks);
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
      gender: updatedStudent.gender || null,
      email: updatedStudent.email || null,
      parent_email: updatedStudent.parentEmail || null,
      school: schoolNormalized,
      birth_date: updatedStudent.birthDate || null,
      group_id: updatedStudent.groupId || null,
    };

    const { data: sData, error: sErr } = await supabase
      .from("students")
      .update(payload)
      .eq("id", updatedStudent.id)
      .select("id, name, gender, dni, email, parent_email, school, birth_date, group_id")
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
              gender: sData.gender ?? "",
              dni: sData.dni ?? s.dni ?? "",
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
      dni: newStudent.dni || null,
      gender: newStudent.gender || null,
      email: newStudent.email || null,
      parent_email: newStudent.parentEmail || null,
      school: schoolNormalized,
      birth_date: newStudent.birthDate || null,
      group_id: newStudent.groupId || null,
    };

    const { data, error } = await supabase
      .from("students")
      .insert(payload)
      .select("id, name, gender, dni, email, parent_email, school, birth_date, group_id")
      .single();

    if (error) {
      alert("Error al crear catecúmeno: " + error.message);
      return;
    }

    const created: Student = {
      id: data.id,
      publicId: "",
      name: data.name,
      gender: data.gender ?? "",
      dni: data.dni ?? "",
      email: data.email ?? "",
      parentEmail: data.parent_email ?? "",
      school: data.school ?? "",
      photo: undefined,
      birthDate: data.birth_date ? String(data.birth_date) : "",
      groupId: data.group_id ?? "",
      attendanceHistory: [],
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

  const myGroups = useMemo(
    () => getMyGroups(currentUser, groups, groupCatechistLinks),
    [currentUser, groups, groupCatechistLinks]
  );

  const groupsWithCatechists = useMemo(
    () => getGroupsWithCatechists(groups, groupCatechistLinks),
    [groups, groupCatechistLinks]
  );


  const addEvent = async (event: { title: string; date: string }) => {
  if (blockIfOffline("añadir evento a la agenda")) return;
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

    setEvents(prev =>
      [...prev, createdEvent].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      )
    );

    try {
      const formattedDateTime = new Date(createdEvent.date).toLocaleString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      const res = await supabase.functions.invoke("send-push-notifications", {
        body: {
          title: "Nuevo evento en la agenda",
          body: `${createdEvent.title} · ${formattedDateTime}`,
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

    const { data: removedEvent, error: fetchError } = await supabase
      .from("parish_events")
      .select("title, date")
      .eq("id", id)
      .single();

    if (fetchError) {
      alert("Error al obtener el evento: " + fetchError.message);
      return;
    }

    if (!removedEvent) {
      alert("No se ha encontrado el evento.");
      return;
    }

    const { error: deleteError } = await supabase
      .from("parish_events")
      .delete()
      .eq("id", id);

    if (deleteError) {
      alert("Error al eliminar evento: " + deleteError.message);
      return;
    }

    setEvents(prev => prev.filter(e => e.id !== id));

    try {
      const parsed = new Date(removedEvent.date);

      const formattedDateTime = parsed.toLocaleString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

      const res = await supabase.functions.invoke("send-push-notifications", {
        body: {
          title: "Evento eliminado de la agenda",
          body: `${removedEvent.title} · ${formattedDateTime}`,
          url: "/",
        },
      });

      if (res.error) {
        console.error("Error enviando notificación push:", res.error);

        const anyErr: any = res.error;
        if (anyErr?.context instanceof Response) {
          try {
            const txt = await anyErr.context.text();
            console.error("[removeEvent] Body error edge function:", txt);
          } catch (e) {
            console.error("[removeEvent] No pude leer el body del error:", e);
          }
        }
      }
    } catch (e) {
      console.error("Error inesperado enviando push:", e);
    }
  };

  /**
   * Promoción de curso. Todo el trabajo se hace en la edge function, que a su
   * vez delega en una función de Postgres transaccional: el cliente no borra
   * nada por su cuenta. Al terminar se recargan los datos porque han cambiado
   * grupos, alumnos y asistencia a la vez.
   */
  const promoteAcademicYear = async () => {
    if (!currentUser) throw new Error("Sesión no válida.");
    if (blockIfOffline("promocionar el curso")) {
      throw new Error("Sin conexión.");
    }

    const { data, error } = await supabase.functions.invoke("promote-academic-year", {
      body: {},
    });

    if (error) throw new Error(error.message ?? "Error al promocionar el curso.");
    if (data?.error) throw new Error(data.error);

    await loadBaseData(currentUser);

    const bajas = data?.alumnos_dados_de_baja ?? 0;
    const renombrados = data?.grupos_renombrados ?? 0;

    alert(
      `Curso promocionado.\n\n` +
        `Grupos renombrados: ${renombrados}\n` +
        `Alumnos dados de baja: ${bajas}\n` +
        `Grupos eliminados: ${data?.grupos_eliminados ?? 0}`
    );
  };

  /**
   * Alta de un grupo completo desde un fichero. La RPC valida nombre, columnas
   * y DNIs, y crea grupo, asignaciones y alumnos en una sola transacción: si
   * una fila falla no queda un grupo vacío a medio poblar.
   */
  const createGroupWithStudents = async (
    name: string,
    catechistIds: string[],
    importedStudents: ImportedStudent[]
  ) => {
    if (!currentUser) throw new Error("Sesión no válida.");
    if (blockIfOffline("crear el grupo")) throw new Error("Sin conexión.");

    const { data, error } = await supabase.rpc("create_group_with_students", {
      p_name: name,
      p_catechist_ids: catechistIds,
      p_students: importedStudents,
    });

    if (error) throw new Error(error.message ?? "No se pudo crear el grupo.");

    await loadBaseData(currentUser);

    alert(
      `Grupo "${data?.group_name ?? name}" creado.\n\n` +
        `Alumnos dados de alta: ${data?.alumnos_creados ?? 0}\n` +
        `Catequistas asignados: ${data?.catequistas_asignados ?? 0}`
    );
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


  const myCatecumenos = useMemo(
    () => getMyCatecumenos(students, activeGroupId, searchQuery).sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })),
    [students, activeGroupId, searchQuery]
  );


  const filteredUsers = useMemo(
    () => getFilteredUsers(users, searchQuery),
    [users, searchQuery]
  );


  const currentGroupName = useMemo(
    () => getCurrentGroupName(groups, activeGroupId),
    [groups, activeGroupId]
  );


  const hasAnyGroupAssigned = useMemo(
    () => getHasAnyGroupAssigned(currentUser, groupCatechistLinks),
    [currentUser, groupCatechistLinks]
  );


  const activeGroupStudents = useMemo(
    () => getActiveGroupStudents(students, activeGroupId),
    [students, activeGroupId]
  );

  const { showNoGroupWarning, showNoStudentsWarning } = useMemo(
    () =>
      getWarningFlags({
        currentUser,
        hasAnyGroupAssigned,
        activeGroupId,
        activeGroupStudents,
      }),
    [currentUser, hasAnyGroupAssigned, activeGroupId, activeGroupStudents]
  );

  const warningMessage = useMemo(
    () =>
      getWarningMessage({
        showNoGroupWarning,
        showNoStudentsWarning,
        currentGroupName,
      }),
    [showNoGroupWarning, showNoStudentsWarning, currentGroupName]
  );


  const handleEnablePushFromBanner = async () => {
    if (!currentUser) return;

    if (!isOnline) {
      alert("No hay conexión. No se pueden activar las notificaciones hasta que vuelva internet.");
      return;
    }

    try {
      const subscription = await subscribeToPush(currentUser.id);

      if (!subscription) {
        alert("No se concedió permiso para las notificaciones.");
        setPushEnabled(false);
        return;
      }

      setPushEnabled(true);
      setDismissedPushBanner(true);
      alert("Notificaciones activadas correctamente.");
    } catch (error: any) {
      console.error(error);
      alert(error?.message ?? "No se pudieron activar las notificaciones.");
      setPushEnabled(false);
    }
  };

  if (!currentUser) return <Login onLogin={handleLogin} />;

  const showPushBanner =
    !!currentUser &&
    isOnline &&
    pushSupported &&
    pushStatusChecked &&
    !pushEnabled &&
    !dismissedPushBanner;

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
      <AppSidebar
        currentUser={currentUser}
        currentView={currentView}
        isSidebarOpen={isSidebarOpen}
        onCloseSidebar={() => setIsSidebarOpen(false)}
        onNavigate={navigateTo}
        onLogout={() => {
          void handleLogout();
        }}
        onUpdateUser={updateUser}
      />
      <main className="flex-1 overflow-y-auto w-full">
        <AppHeader
          currentView={currentView}
          currentGroupName={currentGroupName}
          myGroups={myGroups}
          activeGroupId={activeGroupId}
          onChangeActiveGroup={setActiveGroupId}
          onOpenSidebar={() => setIsSidebarOpen(true)}
          isSearchView={isSearchView}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          academicYears={availableAcademicYears}
          selectedAcademicYear={selectedAcademicYear}
          onChangeAcademicYear={setSelectedAcademicYearKey}
          isCurrentAcademicYear={isCurrentAcademicYear}
        />
        {showPushBanner && (
          <div className="mx-4 mt-4 lg:mx-8 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-indigo-900 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <BellOff size={18} className="mt-0.5 shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold">Activa las notificaciones</p>
                  <p>
                    Ahora mismo están desactivadas. Actívalas para recibir avisos cuando haya novedades relevantes, como nuevos eventos en la agenda.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    void handleEnablePushFromBanner();
                  }}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition-colors"
                >
                  Activar
                </button>

                <button
                  type="button"
                  onClick={() => setDismissedPushBanner(true)}
                  className="p-2 rounded-xl text-indigo-500 hover:bg-indigo-100 transition-colors"
                  aria-label="Cerrar aviso de notificaciones"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          </div>
        )}


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

        {!isCurrentAcademicYear && (
          <div className="mx-4 mt-4 lg:mx-8 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm">
            <div className="flex items-start gap-3">
              <TriangleAlert size={18} className="mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-semibold">
                  Estás viendo el {selectedAcademicYear.label}
                </p>
                <p>
                  {academicYearState === 'future'
                    ? 'Es un curso que todavía no ha comenzado, así que aún no hay asistencia que mostrar. Empezará el 1 de septiembre.'
                    : canEditSelectedYear
                    ? 'Es un curso ya cerrado. Como coordinador puedes corregir su asistencia, pero hazlo con cuidado.'
                    : 'Es un curso ya cerrado, por lo que solo se puede consultar. Vuelve al curso actual para pasar lista o editar.'}
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

          {currentView === 'dashboard' && <Dashboard students={students} events={academicYearEvents} onManageAgenda={currentUser.role === 'coordinator' ? () => setCurrentView('agenda') : undefined} classDays={classDays} academicYear={selectedAcademicYear} />}
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
          {currentView === 'history' && (
            <Historial
              students={myCatecumenos}
              onUpdate={updateHistoricalStudentAttendance}
              classDays={academicYearClassDays}
              allClassDays={classDays}
              groups={groups}
              academicYear={selectedAcademicYear}
              availableAcademicYears={availableAcademicYears}
              canEdit={canEditSelectedYear}
              scopeLabel={currentGroupName || 'Mi grupo'}
              warningMessage={warningMessage}
              warningType={showNoGroupWarning ? "no-group" : showNoStudentsWarning ? "no-students" : undefined}
              isOnline={isOnline}
            />
          )}
          {currentView === 'group-history' && currentUser.role === 'coordinator' && (
            <HistoricoGrupos
              groups={groups}
              students={students}
              classDays={academicYearClassDays}
              allClassDays={classDays}
              academicYear={selectedAcademicYear}
              availableAcademicYears={availableAcademicYears}
              canEdit={canEditSelectedYear}
              onUpdate={updateHistoricalStudentAttendance}
              isOnline={isOnline}
            />
          )}
          {currentView === 'school-calendar' && (
            <SchoolCalendar classDays={classDays} />
          )}
          {currentView === 'drive' && (
            <Drive
              isOnline={isOnline}
            />
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
              students={myCatecumenos.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }))}
              onUpdateStudent={(s) => void updateStudent(s)}
              groups={groups}
              canEditCenso={false}
              classDays={classDays}
              academicYear={selectedAcademicYear}
              availableAcademicYears={availableAcademicYears}
              canEditAttendance={canEditSelectedYear}
              downloadScopeLabel={currentGroupName || 'Mi grupo'}
              warningMessage={warningMessage}
              warningType={showNoGroupWarning ? "no-group" : showNoStudentsWarning ? "no-students" : undefined}
              schoolNames={schoolNames}
              isOnline={isOnline}
            />
          )}
          {currentView === 'services' && (
            <ServicesManagement
              currentUser={currentUser}
              students={myCatecumenos.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }))}
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
              academicYear={selectedAcademicYear}
              availableAcademicYears={availableAcademicYears}
              canEditAttendance={canEditSelectedYear}
              downloadScopeLabel="Todos los niños"
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
              getUserGroupIds={(uid) => getUserGroupIdsFromLinks(uid, groupCatechistLinks)}
              groups={groups}
              classDays={classDays}
              events={events}
              academicYear={selectedAcademicYear}
              onResetPassword={(uid, pw) => resetPassword(uid, pw)}
              isOnline={isOnline}
            />
          )}

          {currentView === 'catechist-attendance' && currentUser.role === 'coordinator' && <CatechistAttendance users={users.filter(u => u.role === 'catechist' || u.role === 'coordinator')} events={academicYearEvents} classDays={academicYearClassDays} onUpdate={updateCatechistAttendance} />}
          {currentView === 'coordinator-edit-groups' && (
            <GroupManager
              groups={groupsWithCatechists}
              students={students}
              users={users}
              classDays={classDays}
              isOnline={isOnline}
              lastPromotionAt={lastPromotionAt}
              onUpdateGroup={(g) => void updateGroup(g)}
              onUpdateStudent={(s) => void updateStudent(s)}
              onAssignCatechist={(uid, gid, assign) => void setCatechistInGroup(uid, gid, assign)}
              onPromoteYear={promoteAcademicYear}
              onCreateGroupWithStudents={createGroupWithStudents}
            />
          )}

          {currentView === 'class-days' && currentUser.role === 'coordinator' && (
            <ClassDayManager
              classDays={classDays}
              academicYear={selectedAcademicYear}
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
              academicYear={selectedAcademicYear}
              activeGroupId={activeGroupId}
              myGroups={myGroups}
              isOnline={isOnline}
            />
          )}
          {currentView === 'account' && (
            <AccountSettings
              isOnline={isOnline}
            />
          )}
          {currentView === 'my-account' && (
            <MyAccount
              user={currentUser}
              groups={groups}
              activeGroupId={activeGroupId}
              isOnline={isOnline}
              pushEnabled={pushEnabled}
              setPushEnabled={setPushEnabled}
              onUpdateUser={updateUser}
            />
          )}
        </div>
      </main>
    </div>
  );
};


export default App;
