import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  Church,
  Clock,
  Filter,
} from "lucide-react";
import { AttendanceStatus, Group, Student, getTodayStr } from "../types";
import { AcademicYear } from "../src/utils/academicYear";
import AttendanceDownloadButton from "./AttendanceDownloadButton";

interface HistorialProps {
  /** Días lectivos del curso seleccionado. */
  students: Student[];
  classDays: string[];
  /** Todos los días lectivos, de cualquier curso, para la descarga completa. */
  allClassDays: string[];
  groups: Group[];
  academicYear: AcademicYear;
  availableAcademicYears: AcademicYear[];
  /** false en cursos ya cerrados cuando el usuario no es coordinator. */
  canEdit: boolean;
  /** Nombre del grupo, usado en el fichero descargado. */
  scopeLabel: string;
  onUpdate: (
    date: string,
    studentId: string,
    type: "catechism" | "mass",
    status: AttendanceStatus
  ) => void;
  warningMessage?: string;
  warningType?: "no-group" | "no-students";
  isOnline: boolean;
  parentLabel?: string;
  parentBackLabel?: string;
  onParentBack?: () => void;
}

const Historial: React.FC<HistorialProps> = ({
  students,
  classDays,
  allClassDays,
  groups,
  academicYear,
  availableAcademicYears,
  canEdit,
  scopeLabel,
  onUpdate,
  warningMessage,
  warningType,
  isOnline,
  parentLabel,
  parentBackLabel,
  onParentBack,
}) => {
  const todayRaw = getTodayStr();
  const hasNoGroupAssigned = warningType === "no-group";

  const [showOnlySuspicious, setShowOnlySuspicious] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const formatPrettyDate = (dateStr: string) => {
    return new Date(`${dateStr}T12:00:00`).toLocaleDateString("es-ES", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const cycleStatus = (current: AttendanceStatus): AttendanceStatus => {
    if (current === "absent") return "present";
    if (current === "present") return "late";
    return "absent";
  };

  const getStatusStyle = (status: AttendanceStatus, activeColor: string) => {
    if (status === "present") return `${activeColor} text-white shadow-md`;
    if (status === "late")
      return `bg-amber-100 text-amber-700 border-2 border-amber-400`;
    return "bg-slate-100 text-slate-400 hover:bg-slate-200";
  };

  const hasParticipationOnDay = (student: Student, day: string) => {
    const record = student.attendanceHistory?.find((record) => record.date === day);

    if (!record) return false;

    const catechismParticipated =
      record.catechism === "present" || record.catechism === "late";

    const massParticipated =
      record.mass === "present" || record.mass === "late";

    return catechismParticipated || massParticipated;
  };

  const historicalDays = useMemo(() => {
    return [...classDays]
      .filter((day) => day <= todayRaw)
      .sort((a, b) => b.localeCompare(a));
  }, [classDays, todayRaw]);

  const suspiciousDays = useMemo(() => {
    if (students.length === 0) return new Set<string>();

    const result = historicalDays.filter((day) => {
      if (day >= todayRaw) return false;

      return students.every((student) => !hasParticipationOnDay(student, day));
    });

    return new Set(result);
  }, [historicalDays, students, todayRaw]);

  const visibleDays = useMemo(() => {
    if (hasNoGroupAssigned) return [];

    if (showOnlySuspicious) {
      return historicalDays.filter((day) => suspiciousDays.has(day));
    }

    return historicalDays;
  }, [historicalDays, showOnlySuspicious, suspiciousDays, hasNoGroupAssigned]);

  const selectedDatePretty = selectedDate ? formatPrettyDate(selectedDate) : "";

  const handleOpenDay = (date: string) => {
    setSelectedDate(date);
    setIsEditing(false);
  };

  const handleBackToList = () => {
    setSelectedDate(null);
    setIsEditing(false);
  };

  if (!selectedDate) {
    return (
      <div className="space-y-6">
        {warningMessage && (
          <div className="mb-4 p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-sm">
            <span className="font-bold">Aviso:</span> {warningMessage}
          </div>
        )}

        <div className="bg-gradient-to-r from-indigo-700 to-blue-600 rounded-2xl p-6 lg:p-8 text-white shadow-lg">
          <div className="flex items-start justify-between gap-4 flex-col sm:flex-row">
            <div>
              {onParentBack && (
                <button
                  onClick={onParentBack}
                  className="mb-4 inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl border border-white/20 bg-white/10 hover:bg-white/20 transition-colors"
                >
                  <ChevronLeft size={16} />
                  {parentBackLabel ?? "Volver"}
                </button>
              )}

              <h2 className="text-xl lg:text-2xl font-bold flex items-center gap-2">
                <CalendarDays size={24} className="shrink-0" />
                Histórico de asistencia
              </h2>

              <p className="text-indigo-100 opacity-90 text-xs lg:text-sm mt-1">
                Aquí puedes revisar días lectivos anteriores y reabrir su
                asistencia.
              </p>

              {parentLabel && (
                <p className="text-white text-xs lg:text-sm font-bold mt-3">
                  Grupo: {parentLabel}
                </p>
              )}
            </div>
            {!hasNoGroupAssigned && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setShowOnlySuspicious((prev) => !prev)}
                  className={`font-bold text-[11px] sm:text-xs px-4 py-2 rounded-xl transition-colors border flex items-center gap-2 ${
                    showOnlySuspicious
                      ? "bg-white text-indigo-700 border-white"
                      : "bg-white/15 hover:bg-white/25 border-white/20 text-white"
                  }`}
                >
                  <Filter size={16} />
                  {showOnlySuspicious
                    ? "Mostrando sospechosos"
                    : "Filtrar por días sospechosos"}
                </button>

                <AttendanceDownloadButton
                  students={students}
                  classDays={allClassDays}
                  groups={groups}
                  availableYears={availableAcademicYears}
                  selectedYear={academicYear}
                  scopeLabel={parentLabel ?? scopeLabel}
                  variant="onDark"
                />
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 lg:px-6 py-4 border-b border-slate-200 bg-slate-50">
            <p className="text-sm text-slate-600">
              Un día se considera sospechoso cuando es lectivo, ya ha pasado y
              ningún catecúmeno tiene registrada participación en esa fecha.
              Tener solo ausencias también cuenta como día sospechoso.
            </p>
          </div>

          {visibleDays.length === 0 ? (
            <div className="py-16 px-6 text-center">
              <div className="w-16 h-16 mx-auto bg-slate-100 text-slate-500 rounded-2xl flex items-center justify-center mb-4">
                <CalendarDays size={28} />
              </div>
              <h3 className="text-lg font-bold text-slate-900">
                No hay días para mostrar
              </h3>
              <p className="text-sm text-slate-500 mt-2">
                {hasNoGroupAssigned
                  ? "No se muestran días porque no tienes ningún grupo asignado."
                  : showOnlySuspicious
                  ? "No hay días sospechosos con los criterios actuales."
                  : "Todavía no hay días lectivos pasados en el histórico."}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {visibleDays.map((day) => {
                const isSuspicious = suspiciousDays.has(day);
                const isToday = day === todayRaw;

                return (
                  <button
                    key={day}
                    onClick={() => handleOpenDay(day)}
                    className="w-full text-left px-4 lg:px-6 py-4 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 capitalize">
                          {formatPrettyDate(day)}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">{day}</p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isToday && (
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-100 text-blue-700">
                            Hoy
                          </span>
                        )}

                        {isSuspicious && (
                          <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700 flex items-center gap-1">
                            <AlertTriangle size={12} />
                            Sospechoso
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {warningMessage && (
        <div className="mb-4 p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-sm">
          <span className="font-bold">Aviso:</span> {warningMessage}
        </div>
      )}

      <div className="bg-gradient-to-r from-indigo-700 to-blue-600 rounded-2xl p-6 lg:p-8 text-white flex items-center justify-between gap-4 shadow-lg flex-col sm:flex-row">
        <div className="w-full sm:w-auto">
          <button
            onClick={handleBackToList}
            className="mb-4 inline-flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-xl border border-white/20 bg-white/10 hover:bg-white/20 transition-colors"
          >
            <ChevronLeft size={16} />
            Volver al listado
          </button>

          <h2 className="text-xl lg:text-2xl font-bold flex items-center gap-2">
            <Church size={24} className="shrink-0" />
            Revisión de asistencia
          </h2>

          <p className="text-indigo-100 opacity-90 text-xs lg:text-sm mt-1 capitalize">
            {selectedDatePretty}
          </p>
        </div>

        <div className="w-full sm:w-auto flex justify-end">
          {!isEditing ? (
            <button
              disabled={!isOnline || !canEdit}
              onClick={() => setIsEditing(true)}
              title={
                !canEdit
                  ? `El ${academicYear.label} está cerrado: solo lo puede corregir un coordinador.`
                  : undefined
              }
              className={`font-bold text-[11px] sm:text-xs px-4 py-2 rounded-xl transition-colors border ${
                isOnline && canEdit
                  ? "bg-white text-indigo-700 border-white hover:bg-indigo-50"
                  : "bg-white/10 border-white/10 text-white/50 cursor-not-allowed"
              }`}
            >
              Editar asistencia
            </button>
          ) : (
            <div className="px-4 py-2 rounded-xl border border-white/20 bg-white/15 text-[11px] sm:text-xs font-bold">
              Modo edición activo
            </div>
          )}
        </div>
      </div>

      {isEditing && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800 text-sm">
          <span className="font-bold">Edición activada.</span> Los cambios se
          guardan automáticamente en cuanto marcas o desmarcas asistencia.
        </div>
      )}

      {!isEditing && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-700 text-sm">
          {canEdit ? (
            <>
              Pulsa <span className="font-bold">Editar asistencia</span> para
              desbloquear la revisión de este día.
            </>
          ) : (
            <>
              El <span className="font-bold">{academicYear.label}</span> ya está
              cerrado, así que este día es solo de consulta. Si hay que corregir
              algo, contacta con el coordinador.
            </>
          )}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="w-full overflow-x-hidden">
          <table className="w-full text-left table-fixed">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 lg:px-6 py-4 text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-widest w-[50%] sm:w-[45%]">
                  Alumno
                </th>
                <th className="px-1 lg:px-6 py-4 text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">
                  Cat.
                </th>
                <th className="px-1 lg:px-6 py-4 text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">
                  Misa
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {students.map((student) => {
                const record = student.attendanceHistory.find(
                  (h) => h.date === selectedDate
                );

                const statusCat = record?.catechism || "absent";
                const statusMass = record?.mass || "absent";

                return (
                  <tr
                    key={student.id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-3 lg:px-6 py-4">
                      <div className="flex items-center gap-2 lg:gap-3">
                        <div className="w-7 h-7 sm:w-10 sm:h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold overflow-hidden shrink-0 text-[10px] sm:text-sm">
                          {student.photo ? (
                            <img
                              src={student.photo}
                              alt={student.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            student.name[0]
                          )}
                        </div>

                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 text-[11px] sm:text-sm truncate">
                            {student.name}
                          </p>
                          <p className="hidden sm:block text-[10px] text-slate-500 truncate">
                            {student.school ?? ""}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-1 lg:px-6 py-4">
                      <div className="flex justify-center">
                        <button
                          disabled={!isEditing || !isOnline}
                          onClick={() =>
                            onUpdate(
                              selectedDate,
                              student.id,
                              "catechism",
                              cycleStatus(statusCat)
                            )
                          }
                          className={`p-1.5 sm:p-3 rounded-lg sm:rounded-xl transition-all flex flex-col items-center gap-0.5 sm:gap-1 w-12 sm:w-24 ${
                            !isEditing || !isOnline ? "opacity-50 cursor-not-allowed " : ""
                          }${getStatusStyle(statusCat, "bg-indigo-600")}`}
                        >
                          {statusCat === "late" ? (
                            <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                          ) : (
                            <BookOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                          )}
                          <span className="text-[7px] sm:text-[8px] font-bold uppercase">
                            {statusCat === "absent"
                              ? "NO"
                              : statusCat === "present"
                              ? "SÍ"
                              : "T"}
                          </span>
                        </button>
                      </div>
                    </td>

                    <td className="px-1 lg:px-6 py-4">
                      <div className="flex justify-center">
                        <button
                          disabled={!isEditing || !isOnline}
                          onClick={() =>
                            onUpdate(
                              selectedDate,
                              student.id,
                              "mass",
                              cycleStatus(statusMass)
                            )
                          }
                          className={`p-1.5 sm:p-3 rounded-lg sm:rounded-xl transition-all flex flex-col items-center gap-0.5 sm:gap-1 w-12 sm:w-24 ${
                            !isEditing || !isOnline ? "opacity-50 cursor-not-allowed " : ""
                          }${getStatusStyle(statusMass, "bg-amber-500")}`}
                        >
                          {statusMass === "late" ? (
                            <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                          ) : (
                            <Church className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                          )}
                          <span className="text-[7px] sm:text-[8px] font-bold uppercase">
                            {statusMass === "absent"
                              ? "NO"
                              : statusMass === "present"
                              ? "SÍ"
                              : "T"}
                          </span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {isEditing && (
        <div className="flex justify-end">
          <button
            onClick={() => setIsEditing(false)}
            className="px-5 py-3 rounded-2xl bg-indigo-600 text-white font-bold shadow-sm hover:bg-indigo-700 transition-colors"
          >
            Finalizar revisión
          </button>
        </div>
      )}
    </div>
  );
};

export default Historial;