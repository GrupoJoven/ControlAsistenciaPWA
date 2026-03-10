// components/IncidentsManager.tsx
import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../src/lib/supabaseClient";
import { Plus, Trash2, Filter, X, AlertTriangle } from "lucide-react";
import { Group, Student, User } from "../types";
import { saveOfflineData, getOfflineData } from "../src/utils/offlineStorage";

type GroupCatechistLink = { group_id: string; profile_id: string };

type IncidentRow = {
  incident_id: string;
  registration_date: string; // date
  incident_date: string; // date
  description: string;
  student_id: string;
  profile_id: string;
  student?: { id: string; name: string; group_id: string | null } | null;
  reporter?: { id: string; name: string | null } | null;
};

type Props = {
  currentUser: User;
  groups: Group[];
  students: Student[];
  users: User[]; // "incidentUsers" que preparaste en App.tsx
  activeGroupId: string | null;
  groupCatechistLinks: GroupCatechistLink[];
  isOnline: boolean;
};

const normalizeDate = (d: string) => String(d).slice(0, 10);

const buildIncidentsCacheKey = (
  currentUserId: string,
  isCoordinator: boolean,
  effectiveGroupId: string,
  filterStudentId: string,
  filterProfileId: string
) =>
  [
    "incidents",
    currentUserId,
    isCoordinator ? "coordinator" : "catechist",
    effectiveGroupId || "all-groups",
    filterStudentId || "all-students",
    filterProfileId || "all-profiles",
  ].join("::");

const IncidentsManager: React.FC<Props> = ({
  currentUser,
  groups,
  students,
  users,
  activeGroupId,
  groupCatechistLinks,
  isOnline,
}) => {
  const isCoordinator = currentUser.role === "coordinator";

  // -----------------------------
  // Filtros UI
  // -----------------------------
  const [filterGroupId, setFilterGroupId] = useState<string>(""); // solo coordinator
  const [filterStudentId, setFilterStudentId] = useState<string>("");
  const [filterProfileId, setFilterProfileId] = useState<string>("");

  // -----------------------------
  // Data / estado
  // -----------------------------
  const [rows, setRows] = useState<IncidentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Modal alta
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newStudentId, setNewStudentId] = useState<string>("");
  const [newIncidentDate, setNewIncidentDate] = useState<string>(normalizeDate(new Date().toISOString()));
  const [newDescription, setNewDescription] = useState<string>("");

  // -----------------------------
  // Derivados
  // -----------------------------
  const groupsById = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) m.set(g.id, g.name);
    return m;
  }, [groups]);

  const effectiveGroupId = useMemo(() => {
    // catechist: siempre limitado al grupo activo
    if (!isCoordinator) return activeGroupId ?? "";
    // coordinator: filtro opcional
    return filterGroupId;
  }, [isCoordinator, activeGroupId, filterGroupId]);

  const studentsById = useMemo(() => {
    const m = new Map<string, Student>();
    for (const s of students) m.set(s.id, s);
    return m;
  }, [students]);

  const allowedStudentIdsForCreate = useMemo(() => {
    // Para el modal de alta: limitar alumnos según rol/grupo
    const gid = effectiveGroupId;
    if (!gid) {
      // coordinator sin grupo seleccionado: permite todos
      return new Set(students.map(s => s.id));
    }
    return new Set(students.filter(s => s.groupId === gid).map(s => s.id));
  }, [students, effectiveGroupId]);

  const studentOptionsForFilters = useMemo(() => {
    const gid = effectiveGroupId;
    const list = gid ? students.filter(s => s.groupId === gid) : students;
    return [...list].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
  }, [students, effectiveGroupId]);

  const profileOptionsForFilters = useMemo(() => {
    // Coordinator: todos los incidentUsers
    if (isCoordinator) {
      return [...users].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
    }

    // Catechist: solo catequistas vinculados al activeGroupId + coordinadores
    if (!activeGroupId) return [];

    const allowed = new Set<string>();
    for (const link of groupCatechistLinks) {
      if (link.group_id === activeGroupId) allowed.add(link.profile_id);
    }
    for (const u of users) {
      if (u.role === "coordinator") allowed.add(u.id);
    }

    return users
      .filter(u => allowed.has(u.id))
      .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
  }, [isCoordinator, users, groupCatechistLinks, activeGroupId]);

  // Si catechist cambia de grupo activo, reseteamos filtros que podrían quedar inconsistentes
  useEffect(() => {
    if (!isCoordinator) {
      setFilterStudentId("");
      setFilterProfileId("");
      // filterGroupId no aplica
    }
  }, [isCoordinator, activeGroupId]);

  // -----------------------------
  // Query
  // -----------------------------
  const buildQuery = () => {
    // Importante: alias claros para poder filtrar por student.group_id
    // (PostgREST suele permitir filtros sobre recursos embebidos con el alias)
    return supabase
      .from("incidents")
      .select(
        `
        incident_id,
        registration_date,
        incident_date,
        description,
        student_id,
        profile_id,
        student:students ( id, name, group_id ),
        reporter:profiles ( id, name )
      `
      );
  };

  const fetchIncidents = async () => {
    setLoading(true);
    setErrorMsg("");

    const cacheKey = buildIncidentsCacheKey(
      currentUser.id,
      isCoordinator,
      effectiveGroupId,
      filterStudentId,
      filterProfileId
    );

    try {
      if (!isCoordinator && !activeGroupId) {
        setRows([]);
        setErrorMsg("No tienes un grupo activo seleccionado o asignado.");
        return;
      }

      const gid = effectiveGroupId;
      const sid = filterStudentId;
      const pid = filterProfileId;

      let q = buildQuery();

      if (sid) q = q.eq("student_id", sid);
      if (pid) q = q.eq("profile_id", pid);

      if (gid && !sid) {
        const ids = students.filter(s => s.groupId === gid).map(s => s.id);
        if (ids.length === 0) {
          setRows([]);
          await saveOfflineData(cacheKey, []);
          return;
        }
        q = q.in("student_id", ids);
      }

      q = q
        .order("incident_date", { ascending: false })
        .order("registration_date", { ascending: false });

      const { data, error } = await q.limit(500);
      if (error) throw error;

      const resultRows = (data ?? []) as IncidentRow[];
      setRows(resultRows);
      await saveOfflineData(cacheKey, resultRows);

    } catch (e: any) {
      console.warn("No se pudieron cargar las incidencias desde Supabase", e);

      const cached = await getOfflineData<IncidentRow[]>(cacheKey);
      const cachedRows = cached?.data ?? [];

      if (cachedRows.length > 0) {
        setRows(cachedRows);
        setErrorMsg("No hay conexión. Mostrando las últimas incidencias guardadas para estos filtros.");
      } else {
        const message =
          typeof navigator !== "undefined" && !navigator.onLine
            ? "No hay conexión y no hay incidencias guardadas para estos filtros."
            : (e?.message ?? "No se pudieron cargar las incidencias.");

        setRows([]);
        setErrorMsg(message);
      }
    } finally {
      setLoading(false);
    }
  };
  // Debounce ligero al cambiar filtros
  useEffect(() => {
    const t = setTimeout(() => void fetchIncidents(), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveGroupId, filterStudentId, filterProfileId]);

  // -----------------------------
  // Crear incidencia
  // -----------------------------
  const canOpenCreate = useMemo(() => {
    if (isCoordinator) return true;
    return !!activeGroupId; // catechist necesita grupo activo
  }, [isCoordinator, activeGroupId]);

  const openCreate = () => {
    if (!canOpenCreate) return;
    setNewIncidentDate(normalizeDate(new Date().toISOString()));
    setNewDescription("");
    setNewStudentId("");

    // si solo hay un alumno, lo preselecciona
    const opts = Array.from(allowedStudentIdsForCreate);
    if (opts.length === 1) setNewStudentId(opts[0]);

    setIsCreateOpen(true);
  };

  const createIncident = async () => {
    if (!isOnline) {
      setErrorMsg("No hay conexión. No se pueden crear incidencias hasta que vuelva internet.");
      return;
    }
    setErrorMsg("");

    const sid = newStudentId.trim();
    const d = newIncidentDate.trim();
    const desc = newDescription.trim();

    if (!sid) {
      setErrorMsg("Selecciona un alumno.");
      return;
    }
    if (!allowedStudentIdsForCreate.has(sid)) {
      setErrorMsg("No tienes permiso para registrar incidencias para ese alumno.");
      return;
    }
    if (!d) {
      setErrorMsg("Selecciona la fecha de la incidencia.");
      return;
    }
    if (!desc) {
      setErrorMsg("Escribe una descripción.");
      return;
    }

    const payload: any = {
      student_id: sid,
      incident_date: d,
      description: desc,
      // Si tienes trigger/with check, esto puede omitirse, pero lo envío para compatibilidad:
      profile_id: currentUser.id,
    };

    setLoading(true);
    try {
      const { error } = await supabase.from("incidents").insert(payload);
      if (error) throw error;

      setIsCreateOpen(false);
      await fetchIncidents();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Error creando incidencia.");
    } finally {
      setLoading(false);
    }
  };

  // -----------------------------
  // Borrar incidencia
  // -----------------------------
  const canDelete = (r: IncidentRow) => {
    // Si quieres que catequista pueda borrar cualquiera del grupo, no limites aquí.
    // Yo lo limito a coordinator o autor, porque es lo más seguro (y suele evitar “líos”).
    return isCoordinator || r.profile_id === currentUser.id;
  };

  const deleteIncident = async (id: string) => {
    if (!isOnline) {
      setErrorMsg("No hay conexión. No se pueden eliminar incidencias hasta que vuelva internet.");
      return;
    }
    if (!confirm("¿Eliminar esta incidencia?")) return;

    setLoading(true);
    setErrorMsg("");
    try {
      const { error } = await supabase.from("incidents").delete().eq("incident_id", id);
      if (error) throw error;
      await fetchIncidents();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Error eliminando incidencia.");
    } finally {
      setLoading(false);
    }
  };

  // -----------------------------
  // UI
  // -----------------------------
  const headerSubtitle = useMemo(() => {
    if (isCoordinator) return "Filtra por grupo, alumno y/o catequista.";
    const gname = activeGroupId ? groupsById.get(activeGroupId) : "";
    return gname ? `Mostrando incidencias del grupo activo: ${gname}` : "Mostrando incidencias del grupo activo.";
  }, [isCoordinator, activeGroupId, groupsById]);

  const clearFilters = () => {
    if (isCoordinator) setFilterGroupId("");
    setFilterStudentId("");
    setFilterProfileId("");
  };

  const groupFilterDisabled = !isCoordinator;

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
              <Filter size={20} />
            </div>
            <h2 className="text-xl font-bold text-slate-900">Incidencias</h2>
          </div>
          <p className="text-sm text-slate-500 mt-1">{headerSubtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={clearFilters}
            className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50"
          >
            Limpiar filtros
          </button>

          <button
            onClick={openCreate}
            disabled={!canOpenCreate || !isOnline}
            className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 ${
              canOpenCreate && isOnline
                ? "bg-indigo-600 text-white hover:bg-indigo-700"
                : "bg-slate-200 text-slate-500 cursor-not-allowed"
            }`}
          >
            <Plus size={18} />
            Nueva incidencia
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-4 lg:p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Grupo (solo coordinator) */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">
              Grupo
            </label>
            <select
              className={`w-full px-4 py-3 rounded-2xl border text-sm ${
                groupFilterDisabled
                  ? "bg-slate-100 border-slate-200 text-slate-500 cursor-not-allowed"
                  : "bg-white border-slate-200"
              }`}
              value={isCoordinator ? filterGroupId : (activeGroupId ?? "")}
              onChange={(e) => setFilterGroupId(e.target.value)}
              disabled={groupFilterDisabled}
            >
              {isCoordinator && <option value="">Todos</option>}
              {(isCoordinator ? groups : groups.filter(g => g.id === activeGroupId)).map(g => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          {/* Alumno */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">
              Alumno
            </label>
            <select
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm"
              value={filterStudentId}
              onChange={(e) => setFilterStudentId(e.target.value)}
            >
              <option value="">Todos</option>
              {studentOptionsForFilters.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Catequista */}
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">
              Catequista
            </label>
            <select
              className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm"
              value={filterProfileId}
              onChange={(e) => setFilterProfileId(e.target.value)}
            >
              <option value="">Todos</option>
              {profileOptionsForFilters.map(u => (
                <option key={u.id} value={u.id}>
                  {u.name} {u.role === "coordinator" ? "(Coord.)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {errorMsg && (
          <div className="mt-4 p-4 rounded-2xl border border-red-200 bg-red-50 text-red-800 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="mt-0.5" />
              <div>{errorMsg}</div>
            </div>
          </div>
        )}
      </div>

      {/* Lista */}
      <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="text-sm font-bold text-slate-800">
            {loading ? "Cargando..." : `Resultados: ${rows.length}`}
          </div>
          <div className="text-xs text-slate-500">
            Orden: más recientes a más antiguas
          </div>
        </div>

        {rows.length === 0 && !loading ? (
          <div className="p-8 text-center text-slate-500 text-sm">
            No hay incidencias con los filtros actuales.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {rows.map((r) => {
              const studentName =
                r.student?.name ??
                studentsById.get(r.student_id)?.name ??
                "Alumno desconocido";

              const studentGroupId =
                r.student?.group_id ??
                studentsById.get(r.student_id)?.groupId ??
                "";

              const groupName = studentGroupId ? (groupsById.get(studentGroupId) ?? "") : "";

              const reporterName = r.reporter?.name ?? "—";

              return (
                <div key={r.incident_id} className="p-5 hover:bg-slate-50">
                  <div className="flex flex-col lg:flex-row lg:items-start gap-4 justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">{studentName}</span>
                        {groupName && (
                          <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-700">
                            {groupName}
                          </span>
                        )}
                        <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-indigo-50 text-indigo-700">
                          {normalizeDate(r.incident_date)}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-500">
                          Registrado: {normalizeDate(r.registration_date)}
                        </span>
                      </div>

                      <div className="text-xs text-slate-500">
                        Registrado por: <span className="font-semibold text-slate-700">{reporterName}</span>
                      </div>

                      <div className="mt-2 text-sm text-slate-800 whitespace-pre-wrap">
                        {r.description}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {canDelete(r) && (
                        <button
                          onClick={() => void deleteIncident(r.incident_id)}
                          className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50 flex items-center gap-2"
                        >
                          <Trash2 size={16} />
                          Eliminar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal Crear */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
            onClick={() => setIsCreateOpen(false)}
          />
          <div className="absolute inset-x-0 top-10 mx-auto max-w-xl px-4">
            <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <div className="text-lg font-bold text-slate-900">Nueva incidencia</div>
                  <div className="text-xs text-slate-500">
                    {isCoordinator ? "Puedes registrar para cualquier alumno (según filtros/permiso)." : "Registrando en tu grupo activo."}
                  </div>
                </div>
                <button
                  onClick={() => setIsCreateOpen(false)}
                  className="p-2 rounded-xl hover:bg-slate-100 text-slate-500"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">
                    Alumno
                  </label>
                  <select
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm"
                    value={newStudentId}
                    onChange={(e) => setNewStudentId(e.target.value)}
                  >
                    <option value="">Selecciona...</option>
                    {studentOptionsForFilters
                      .filter(s => allowedStudentIdsForCreate.has(s.id))
                      .map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">
                    Fecha de la incidencia
                  </label>
                  <input
                    type="date"
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm"
                    value={newIncidentDate}
                    onChange={(e) => setNewIncidentDate(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">
                    Descripción
                  </label>
                  <textarea
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm min-h-[120px]"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="Describe brevemente la incidencia..."
                  />
                </div>

                {errorMsg && (
                  <div className="p-4 rounded-2xl border border-red-200 bg-red-50 text-red-800 text-sm">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={18} className="mt-0.5" />
                      <div>{errorMsg}</div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => setIsCreateOpen(false)}
                    className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-semibold hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => void createIncident()}
                    disabled={loading}
                    className={`px-4 py-2 rounded-xl text-sm font-bold ${
                      loading ? "bg-slate-200 text-slate-500 cursor-not-allowed" : "bg-indigo-600 text-white hover:bg-indigo-700"
                    }`}
                  >
                    Guardar
                  </button>
                </div>
              </div>
            </div>

            {!isCoordinator && !activeGroupId && (
              <div className="mt-4 p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-sm">
                No tienes grupo activo. Selecciona uno arriba (si tienes varios) o contacta con el coordinador.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default IncidentsManager;