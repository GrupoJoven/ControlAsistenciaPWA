// components/Reports.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  FileText,
  Download,
  RefreshCcw,
  Lightbulb,
  Users,
  Briefcase,
  Search,
} from "lucide-react";
import { supabase } from "../src/lib/supabaseClient";
import {
  Student,
  User,
  Group,
  calculateStudentRate,
  calculateCatechistRate,
  ParishEvent,
  getTodayStr,
  AttendanceStatus,
} from "../types";
import { AcademicYear, getAcademicYearCutoff } from "../src/utils/academicYear";

interface ReportsProps {
  students: Student[];
  currentUser: User;
  groups: Group[];
  classDays: string[];
  users: User[];
  events: ParishEvent[];
  academicYear: AcademicYear;
  activeGroupId: string | null; // viene desde App.tsx
  myGroups: Group[]; // viene desde App.tsx (solo grupos del usuario)
  isOnline: boolean;
}

type ReportType = "students" | "catechists";

type ReportTarget =
  | { scope: "group"; scopeId: string }
  | { scope: "all_students" }
  | { scope: "all_catechists" };

type MonthlyReportRow = {
  id: string;
  scope: "group" | "all_students" | "all_catechists";
  scope_id: string | null;
  month: string;
  report_type: ReportType;
  generated_by: string;
  generated_at: string;
  payload: any;
};

const Reports: React.FC<ReportsProps> = ({
  students,
  currentUser,
  groups,
  classDays,
  users,
  events,
  academicYear,
  activeGroupId,
  myGroups,
  isOnline,
}) => {
  const [reportType, setReportType] = useState<ReportType>("students");

  // Informe "visible" (payload) y la fila completa por si quieres mostrar metadatos
  const [reportRow, setReportRow] = useState<MonthlyReportRow | null>(null);
  const [report, setReport] = useState<any>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isLocked, setIsLocked] = useState(false); // ya hay informe este mes para el target+tipo
  const [loadingExisting, setLoadingExisting] = useState(false);

  const today = getTodayStr(); // YYYY-MM-DD
  const month = today.slice(0, 7); // YYYY-MM

  // --- Target inicial ---
  const initialTarget: ReportTarget =
    currentUser.role === "coordinator"
      ? { scope: "all_students" }
      : activeGroupId
      ? { scope: "group", scopeId: activeGroupId }
      : { scope: "group", scopeId: "" };

  const [target, setTarget] = useState<ReportTarget>(initialTarget);

  // Sincroniza target con activeGroupId para catequistas (o cualquiera que no sea coordinator)
  useEffect(() => {
    if (currentUser.role !== "coordinator") {
      if (activeGroupId) setTarget({ scope: "group", scopeId: activeGroupId });
    }
  }, [activeGroupId, currentUser.role]);

  // Si el coordinador cambia a pestaña "Equipo", fijamos target all_catechists
  useEffect(() => {
    if (currentUser.role === "coordinator" && reportType === "catechists") {
      setTarget({ scope: "all_catechists" });
      setReportRow(null);
      setReport(null);
      setIsLocked(false);
    }
  }, [reportType, currentUser.role]);

  const start = academicYear.start;
  const end = getAcademicYearCutoff(academicYear);

  // Fechas pasadas del curso (para CSV)
  const pastClassDays = useMemo(
    () => classDays.filter((d) => d >= start && d <= end).sort(),
    [classDays, start, end]
  );

  const pastEvents = useMemo(
    () =>
      events
        .filter((e) => e.date >= start && e.date <= end)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [events, start, end]
  );

  // --- Helpers CSV ---
  const sanitize = (str: string) => {
    if (!str) return "";
    return str
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/,/g, ";")
      .trim();
  };

  const getStatusLabel = (status?: AttendanceStatus) => {
    if (status === "present") return "P";
    if (status === "late") return "T";
    return "A";
  };

  // --- Datos filtrados (solo para CSV, el informe IA ya viene guardado) ---
  const filteredStudents = useMemo(() => {
    if (target.scope === "all_students") return students;
    if (target.scope === "group") return students.filter((s) => s.groupId === target.scopeId);
    return [];
  }, [students, target]);

  const filteredCatechists = useMemo(() => {
    return users.filter((u) => u.role === "catechist");
  }, [users]);

  const targetLabel = useMemo(() => {
    if (target.scope === "all_students") return "Todos los niños";
    if (target.scope === "all_catechists") return "Equipo de catequistas";
    const gname = groups.find((g) => g.id === target.scopeId)?.name;
    return gname ? `Grupo ${gname}` : "Grupo";
  }, [target, groups]);

  // --- Cargar informe existente del mes (si existe, bloquear generación) ---
  const loadExisting = async () => {
    setLoadingExisting(true);
    if (!isOnline) {
      setReportRow(null);
      setReport(null);
      setIsLocked(false);
      setLoadingExisting(false);
      return;
    }
    try {
      const scope = target.scope;
      const scopeId = target.scope === "group" ? target.scopeId : null;

      let q = supabase
        .from("monthly_reports")
        .select("*")
        .eq("month", month)
        .eq("scope", scope)
        .eq("report_type", reportType);

      if (scopeId) q = q.eq("scope_id", scopeId);
      else q = q.is("scope_id", null);

      const { data, error } = await q.maybeSingle();

      if (error) {
        console.error(error);
        // no hacemos alert: puede ser RLS (catequista intentando scope no permitido)
        setReportRow(null);
        setReport(null);
        setIsLocked(false);
        return;
      }

      if (data) {
        const row = data as MonthlyReportRow;
        setReportRow(row);
        setReport(row.payload);
        setIsLocked(true);
      } else {
        setReportRow(null);
        setReport(null);
        setIsLocked(false);
      }
    } finally {
      setLoadingExisting(false);
    }
  };

  useEffect(() => {
    if (target.scope === "group" && !target.scopeId) {
      setReportRow(null);
      setReport(null);
      setIsLocked(false);
      return;
    }

    if (!isOnline) {
      setReportRow(null);
      setReport(null);
      setIsLocked(false);
      return;
    }

    void loadExisting();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reportType, month, isOnline]);

  const handleDownloadCSV = () => {
    let headers = "";
    let rows = "";
    const filename =
      reportType === "students"
        ? `asistencia_catecumenos_${today}.csv`
        : `asistencia_catequistas_${today}.csv`;

    if (reportType === "students") {
      const dateHeaders = pastClassDays
        .map((d) => `${sanitize(d)} (Cat),${sanitize(d)} (Misa)`)
        .join(",");
      headers = `Nombre,Grupo,Colegio,Asistencia Real %,${dateHeaders}\n`;

      rows = filteredStudents
        .map((s) => {
          const rate = calculateStudentRate(s, classDays, academicYear);
          const groupName = groups.find((g) => g.id === s.groupId)?.name || "Sin Grupo";

          const dateValues = pastClassDays
            .map((d) => {
              const record = s.attendanceHistory.find((h) => h.date === d);
              return `${getStatusLabel(record?.catechism)},${getStatusLabel(record?.mass)}`;
            })
            .join(",");

          return `${sanitize(s.name)},${sanitize(groupName)},${sanitize(
            s.school
          )},${rate}%,${dateValues}`;
        })
        .join("\n");
    } else {
      const classDateHeaders = pastClassDays
        .map((d) => `${sanitize(d)} (Cat),${sanitize(d)} (Misa)`)
        .join(",");
      const eventDateHeaders = pastEvents
        .map((e) => `${sanitize(e.date)} (${sanitize(e.title)})`)
        .join(",");

      headers = `Nombre,Grupo,Asistencia Total %,Email,${classDateHeaders}${
        eventDateHeaders ? "," + eventDateHeaders : ""
      }\n`;

      rows = filteredCatechists
        .map((c) => {
          const rate = calculateCatechistRate(c, classDays, events, academicYear);

          // En tu modelo actual, un catequista puede estar en varios grupos.
          // Para CSV mostramos "Varios" si no hay forma directa de inferir un único grupo.
          // Si quieres listar todos sus grupos, habría que pasar groupCatechistLinks.
          const groupName = "Varios";

          const classDateValues = pastClassDays
            .map((d) => {
              const record = c.attendanceHistory?.find(
                (h: any) => h.date === d && h.type === "class"
              );
              return `${getStatusLabel(record?.catechism)},${getStatusLabel(record?.mass)}`;
            })
            .join(",");

          const eventDateValues = pastEvents
            .map((e) => {
              const record = c.attendanceHistory?.find(
                (h: any) => h.refId === e.id && h.type === "event"
              );
              return getStatusLabel(record?.status);
            })
            .join(",");

          return `${sanitize(c.name)},${sanitize(groupName)},${rate}%,${sanitize(
            c.email
          )},${classDateValues}${eventDateValues ? "," + eventDateValues : ""}`;
        })
        .join("\n");
    }

    const csvContent = headers + rows;
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleGenerateReport = async () => {
    if (!isOnline) {
      alert("No hay conexión. No se puede generar el informe hasta que vuelva internet.");
      return;
    }
    // Guardrail básico: si target group sin id (posible en arranque)
    if (target.scope === "group" && !target.scopeId) {
      alert("No hay grupo activo seleccionado.");
      return;
    }

    setIsGenerating(true);
    try {
      const body = {
        reportType,
        scope: target.scope,
        scopeId: target.scope === "group" ? target.scopeId : null,
      };

      const res = await supabase.functions.invoke("generate-monthly-report", { body });

      if (res.error) {
        alert("No se pudo generar el informe: " + res.error.message);
        // refresca por si realmente se generó pero el cliente no lo sabe
        await loadExisting();
        return;
      }

      // La Edge Function debería devolver { payload, ... } o directamente payload
      const payload = (res.data as any)?.payload ?? res.data;
      setReport(payload);

      // Refresca desde BD para bloquear botón y mostrar metadatos
      await loadExisting();
    } catch (e: any) {
      console.error(e);
      alert("Error al generar el informe.");
    } finally {
      setIsGenerating(false);
    }
  };

  // --- UI: selector de grupos solo para coordinator en modo students ---
  const canSelectGroup = currentUser.role === "coordinator" && reportType === "students";

  // Para coordinator, muestra grupos en selector (todos), no solo myGroups
  const groupOptions = useMemo(() => {
    const sorted = [...groups].sort((a, b) =>
      a.name.localeCompare(b.name, "es", { sensitivity: "base" })
    );
    return sorted;
  }, [groups]);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex gap-4 items-center">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            {reportType === "students" ? <Users size={24} /> : <Briefcase size={24} />}
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Analítica Parroquial</h2>

            <div className="text-xs text-slate-500 mt-1">
              Informe mensual · <span className="font-semibold">{month}</span> ·{" "}
              <span className="font-semibold">{targetLabel}</span>
            </div>

            <div className="flex gap-2 mt-2">
              <button
                onClick={() => {
                  setReportType("students");
                  // si coordinator, por defecto mostramos all_students
                  if (currentUser.role === "coordinator") setTarget({ scope: "all_students" });
                  // si catequista, el target lo sincroniza useEffect con activeGroupId
                  setReportRow(null);
                  setReport(null);
                  setIsLocked(false);
                }}
                className={`text-xs font-bold px-3 py-1 rounded-full transition-all ${
                  reportType === "students"
                    ? "bg-indigo-600 text-white shadow-md"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                Catecúmenos
              </button>

              {currentUser.role === "coordinator" && (
                <button
                  onClick={() => {
                    setReportType("catechists");
                    setTarget({ scope: "all_catechists" });
                    setReportRow(null);
                    setReport(null);
                    setIsLocked(false);
                  }}
                  className={`text-xs font-bold px-3 py-1 rounded-full transition-all ${
                    reportType === "catechists"
                      ? "bg-indigo-600 text-white shadow-md"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}
                >
                  Equipo
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-end">
          {canSelectGroup && (
            <div className="relative">
              <select
                className="appearance-none pl-4 pr-10 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                value={
                  target.scope === "all_students"
                    ? "all_students"
                    : target.scope === "group"
                    ? target.scopeId
                    : "all_students"
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "all_students") setTarget({ scope: "all_students" });
                  else setTarget({ scope: "group", scopeId: v });
                  setReportRow(null);
                  setReport(null);
                  setIsLocked(false);
                }}
              >
                <option value="all_students">Todos los Niños</option>
                {groupOptions.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                <Search size={14} />
              </div>
            </div>
          )}

          <button
            onClick={handleDownloadCSV}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-indigo-200 text-indigo-600 hover:bg-indigo-50 font-bold rounded-xl transition-all text-sm shadow-sm"
          >
            <Download size={18} />
            Descargar CSV
          </button>

          <button
            onClick={handleGenerateReport}
            disabled={
              !isOnline ||
              isGenerating ||
              loadingExisting ||
              isLocked ||
              (target.scope === "group" && !target.scopeId)
            }
            className="flex items-center gap-2 px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-100 disabled:opacity-50 text-sm"
            title={
              !isOnline
                ? "No hay conexión."
                : isLocked
                ? "Ya existe un informe para este mes y este grupo."
                : loadingExisting
                ? "Cargando informe existente..."
                : undefined
            }
          >
            {isGenerating || loadingExisting ? (
              <RefreshCcw size={18} className="animate-spin" />
            ) : (
              <Sparkles size={18} />
            )}
            {isLocked ? "Informe ya generado" : isGenerating ? "Analizando..." : "Generar Informe IA"}
          </button>
        </div>
      </div>
      {!isOnline && (
        <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-sm">
          <span className="font-bold">Modo sin conexión:</span> puedes seguir descargando el CSV con los datos ya cargados, pero no consultar informes guardados ni generar nuevos informes IA hasta que vuelva internet.
        </div>
      )}
      {report ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <FileText size={120} />
              </div>

              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-2 border-b pb-4 relative z-10">
                <FileText className="text-indigo-600" size={20} />
                Evaluación Pastoral {reportType === "students" ? "de Catecúmenos" : "del Equipo"}
              </h3>

              <div className="text-xs text-slate-500 mb-6 relative z-10">
                <span className="font-semibold">Periodo:</span> {month} ·{" "}
                <span className="font-semibold">Ámbito:</span> {targetLabel}
                {reportRow?.generated_at ? (
                  <>
                    {" "}
                    · <span className="font-semibold">Generado:</span>{" "}
                    {new Date(reportRow.generated_at).toLocaleString("es-ES")}
                  </>
                ) : null}
              </div>

              <p className="text-slate-600 leading-relaxed whitespace-pre-wrap relative z-10">
                {report.summary}
              </p>
            </div>

            <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-6">
                <Lightbulb className="text-amber-500" size={20} />
                Recomendaciones Estratégicas
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(report.recommendations ?? []).map((rec: string, i: number) => (
                  <div
                    key={i}
                    className="p-4 bg-slate-50 border border-slate-100 rounded-xl flex items-start gap-4 hover:border-indigo-100 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-sm">
                      {i + 1}
                    </div>
                    <p className="text-sm text-slate-700 leading-snug">{rec}</p>
                  </div>
                ))}
              </div>

              {isLocked && (
                <div className="mt-6 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm">
                  <span className="font-bold">Nota:</span> Este informe ya está generado para el mes{" "}
                  <span className="font-semibold">{month}</span>. Hasta el próximo mes no se puede
                  regenerar.
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-indigo-700 p-6 rounded-2xl text-white shadow-xl">
              <h4 className="font-bold text-lg mb-2">Sobre este informe</h4>
              <p className="text-indigo-100 text-sm leading-relaxed mb-4">
                Este análisis se guarda en la plataforma para que puedas consultarlo durante todo el
                mes sin volver a consumir cuota de IA.
              </p>

              <div className="bg-white/10 p-3 rounded-xl border border-white/20">
                <p className="text-xs italic">
                  "Formar personas libres, cristianas y con criterios responsables."
                </p>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <div className="text-sm text-slate-700">
                <div className="font-bold mb-2">Estado</div>
                <ul className="space-y-1">
                  <li>
                    <span className="font-semibold">Mes:</span> {month}
                  </li>
                  <li>
                    <span className="font-semibold">Ámbito:</span> {targetLabel}
                  </li>
                  <li>
                    <span className="font-semibold">Generación:</span>{" "}
                    {isLocked ? "Bloqueada (ya existe)" : "Permitida"}
                  </li>
                </ul>
              </div>

              {!isLocked && (
                <div className="mt-4 text-xs text-slate-500">
                  Si necesitas regenerarlo dentro del mismo mes, la regla de negocio lo impide a
                  propósito (para controlar costes y mantener consistencia).
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-slate-100 rounded-3xl border-2 border-dashed border-slate-200 py-32 flex flex-col items-center text-center">
          <div className="w-20 h-20 bg-indigo-50 text-indigo-200 rounded-full flex items-center justify-center mb-6">
            <Sparkles size={40} />
          </div>

          <h3 className="text-xl font-bold text-slate-800">Informes mensuales con IA</h3>

          <p className="text-slate-500 mt-2 max-w-md">
            {loadingExisting
              ? "Buscando si ya existe un informe para este mes..."
              : isLocked
              ? "Ya existe un informe para este mes, pero no se pudo cargar (posible restricción de permisos)."
              : "Pulsa el botón para generar el informe del mes y quedará guardado para consultarlo después."}
          </p>

          {target.scope === "group" && !target.scopeId && currentUser.role !== "coordinator" && (
            <div className="mt-6 p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-sm max-w-lg">
              <span className="font-bold">Aviso:</span> No tienes un grupo activo seleccionado. Si
              tienes varios grupos, selecciona uno desde el desplegable superior de la app.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Reports;