import React, { useMemo, useState } from "react";
import {
  Calendar,
  Filter,
  X,
  Check,
  Church,
  BookOpen,
  Clock,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { User, ParishEvent, AttendanceStatus, getTodayStr } from "../types";
import { STAGE_LABELS, eventAppliesToStages } from "../src/utils/stages";

interface CatechistAttendanceProps {
  users: User[];
  events: ParishEvent[];
  classDays: string[];
  onUpdate: (
    userId: string,
    type: "class" | "event",
    status: AttendanceStatus,
    refId?: string,
    subType?: "catechism" | "mass",
    date?: string
  ) => void;
}

type ClassDayRow = { catechism: AttendanceStatus; mass: AttendanceStatus };
type EventRow = { status: AttendanceStatus };

const CatechistAttendance: React.FC<CatechistAttendanceProps> = ({
  users,
  events,
  classDays,
  onUpdate,
}) => {
  const [mode, setMode] = useState<"class" | "event">("class");
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const today = getTodayStr();

  // Días lectivos del curso que ya han llegado, del más reciente al más
  // antiguo. Solo se pasa lista en días lectivos porque son los únicos que
  // cuentan para el % de asistencia del catequista.
  const pastClassDays = useMemo(
    () => classDays.filter((d) => d <= today).sort((a, b) => b.localeCompare(a)),
    [classDays, today]
  );

  // Por defecto, hoy si es lectivo o, si no, el último día lectivo. Si se cambia
  // de curso y el día elegido ya no está en la lista, se vuelve al por defecto.
  const activeDate =
    selectedDate && pastClassDays.includes(selectedDate)
      ? selectedDate
      : pastClassDays[0] ?? null;
  const activeIndex = activeDate ? pastClassDays.indexOf(activeDate) : -1;
  const olderDate = activeIndex >= 0 ? pastClassDays[activeIndex + 1] ?? null : null;
  const newerDate = activeIndex > 0 ? pastClassDays[activeIndex - 1] : null;

  const formatDate = (dateStr: string, style: "short" | "long") =>
    new Date(`${dateStr}T12:00:00`).toLocaleDateString(
      "es-ES",
      style === "long"
        ? { weekday: "long", year: "numeric", month: "long", day: "numeric" }
        : { weekday: "short", year: "numeric", month: "short", day: "numeric" }
    );

  /**
   * IMPORTANTE:
   * Para catequistas NO permitimos 'late', porque tu tabla nueva no lo acepta.
   * Alternamos absent <-> present.
   */
  const cycleStatus = (current: AttendanceStatus): AttendanceStatus => {
    if (current === "absent") return "present";
    if (current === "present") return "late";
    return "absent"; // late -> absent (y por si llega algo raro)
  };

  // ---- Índices en memoria para evitar find() por cada fila en render ----
  const classByUser = useMemo(() => {
    const m = new Map<string, ClassDayRow>();

    for (const u of users) {
      // Recoge SOLO el registro tipo class del día seleccionado
      const h = u.attendanceHistory?.find(
        (x: any) => x.date === activeDate && x.type === "class"
      );

      // Si no hay registro, tratamos como absent
      m.set(u.id, {
        catechism: (h?.catechism ?? "absent") as AttendanceStatus,
        mass: (h?.mass ?? "absent") as AttendanceStatus,
      });
    }

    return m;
  }, [users, activeDate]);

  const eventByUserAndEvent = useMemo(() => {
    const m = new Map<string, AttendanceStatus>(); // key: userId|eventId

    for (const u of users) {
      const hist = u.attendanceHistory ?? [];
      for (const h of hist as any[]) {
        if (h.type !== "event") continue;
        if (!h.refId) continue;
        // status absent si null/undefined
        const st = (h.status ?? "absent") as AttendanceStatus;
        m.set(`${u.id}|${h.refId}`, st);
      }
    }

    return m;
  }, [users]);

  const getStatusStyle = (status: AttendanceStatus, activeColor: string) => {
    if (status === "present") return `${activeColor} text-white shadow-md`;
    if (status === "late") return `bg-amber-100 text-amber-700 border-2 border-amber-400`;
    return "bg-slate-100 text-slate-400 hover:bg-slate-200";
  };

  const canShowTable =
    (mode === "class" && activeDate) || (mode === "event" && selectedEventId);

  // En un evento de una sola etapa solo se pasa lista a la gente de esa etapa:
  // a un catequista de preconfirmación no se le apunta falta en un evento de
  // confirmación. En días lectivos y eventos de 'all' salen todos.
  const selectedEvent = events.find((e) => e.id === selectedEventId) ?? null;
  const visibleUsers =
    mode === "event" && selectedEvent
      ? users.filter((u) => eventAppliesToStages(selectedEvent, u.stages ?? []))
      : users;

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-500">
      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="flex gap-2 sm:gap-4">
          <button
            onClick={() => setMode("class")}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              mode === "class"
                ? "bg-indigo-600 text-white shadow-md"
                : "bg-slate-50 text-slate-500 hover:bg-slate-100"
            }`}
          >
            Días Lectivos
          </button>
          <button
            onClick={() => setMode("event")}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
              mode === "event"
                ? "bg-indigo-600 text-white shadow-md"
                : "bg-slate-50 text-slate-500 hover:bg-slate-100"
            }`}
          >
            Eventos Agenda
          </button>
        </div>

        {mode === "class" && activeDate && (
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => olderDate && setSelectedDate(olderDate)}
              disabled={!olderDate}
              title="Día lectivo anterior"
              aria-label="Día lectivo anterior"
              className="p-2 rounded-xl bg-slate-50 text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <ChevronLeft size={18} />
            </button>
            <select
              className="flex-1 sm:flex-none min-w-0 px-4 py-2 border rounded-xl text-sm outline-none bg-slate-50 focus:ring-2 focus:ring-indigo-500"
              value={activeDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              aria-label="Día lectivo"
            >
              {pastClassDays.map((d) => (
                <option key={d} value={d}>
                  {formatDate(d, "short")}
                  {d === today ? " (hoy)" : ""}
                </option>
              ))}
            </select>
            <button
              onClick={() => newerDate && setSelectedDate(newerDate)}
              disabled={!newerDate}
              title="Día lectivo siguiente"
              aria-label="Día lectivo siguiente"
              className="p-2 rounded-xl bg-slate-50 text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        )}

        {mode === "event" && (
          <select
            className="w-full sm:w-auto px-4 py-2 border rounded-xl text-sm outline-none bg-slate-50 focus:ring-2 focus:ring-indigo-500"
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
          >
            <option value="">Selecciona evento...</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} ({e.date}){e.stage !== "all" ? ` · ${STAGE_LABELS[e.stage]}` : ""}
              </option>
            ))}
          </select>
        )}
      </div>

      {mode === "class" && !activeDate && (
        <div className="py-20 text-center text-slate-400 bg-white rounded-2xl border-2 border-dashed border-slate-100">
          <Calendar size={48} className="mx-auto mb-4 opacity-20" />
          <p className="font-bold">No hay días lectivos para pasar lista</p>
          <p className="text-xs sm:text-sm">
            Todavía no ha llegado ningún día lectivo de este curso.
          </p>
        </div>
      )}

      {mode === "class" && activeDate && activeDate !== today && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 text-sm">
          Estás editando la asistencia del{" "}
          <span className="font-bold">{formatDate(activeDate, "long")}</span>
          {pastClassDays.includes(today) ? ", no la de hoy" : ""}. Los cambios
          se guardan en cuanto pulsas.
        </div>
      )}

      {canShowTable ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left table-fixed">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="px-3 sm:px-6 py-4 text-[9px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest w-[40%] sm:w-[35%]">
                  Catequista
                </th>
                {mode === "class" ? (
                  <>
                    <th className="px-1 sm:px-6 py-4 text-[9px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest text-center">
                      Cat.
                    </th>
                    <th className="px-1 sm:px-6 py-4 text-[9px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest text-center">
                      Misa
                    </th>
                  </>
                ) : (
                  <th className="px-2 sm:px-6 py-4 text-[9px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest text-center">
                    Asistencia
                  </th>
                )}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-50">
              {visibleUsers.map((user) => {
                if (mode === "class") {
                  const row = classByUser.get(user.id) ?? {
                    catechism: "absent",
                    mass: "absent",
                  };

                  return (
                    <tr
                      key={user.id}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-3 sm:px-6 py-4">
                        <div className="flex items-center gap-2 sm:gap-3">
                          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-indigo-50 flex items-center justify-center font-bold text-indigo-700 overflow-hidden shrink-0 text-[10px] sm:text-base">
                            {user.photo ? (
                              <img
                                src={user.photo}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              user.name[0]
                            )}
                          </div>
                          <span className="font-bold text-slate-800 text-[11px] sm:text-sm truncate">
                            {user.name}
                          </span>
                        </div>
                      </td>

                      <td className="px-1 sm:px-6 py-4">
                        <div className="flex justify-center">
                          <button
                            onClick={() =>
                              onUpdate(
                                user.id,
                                "class",
                                cycleStatus(row.catechism),
                                undefined,
                                "catechism",
                                activeDate ?? undefined
                              )
                            }
                            className={`p-1.5 sm:p-3 rounded-lg sm:rounded-xl transition-all flex flex-col items-center gap-0.5 sm:gap-1 w-12 sm:w-24 ${getStatusStyle(
                              row.catechism,
                              "bg-indigo-600"
                            )}`}
                          >
                            {row.catechism === "late" ? (
                              <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            ) : (
                              <BookOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            )}
                            <span className="text-[7px] sm:text-[8px] font-bold uppercase">
                              {row.catechism === "present" ? "SÍ" : row.catechism === "late" ? "T" : "NO"}
                            </span>
                          </button>
                        </div>
                      </td>

                      <td className="px-1 sm:px-6 py-4">
                        <div className="flex justify-center">
                          <button
                            onClick={() =>
                              onUpdate(
                                user.id,
                                "class",
                                cycleStatus(row.mass),
                                undefined,
                                "mass",
                                activeDate ?? undefined
                              )
                            }
                            className={`p-1.5 sm:p-3 rounded-lg sm:rounded-xl transition-all flex flex-col items-center gap-0.5 sm:gap-1 w-12 sm:w-24 ${getStatusStyle(
                              row.mass,
                              "bg-amber-500"
                            )}`}
                          >
                            {row.mass === "late" ? (
                              <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            ) : (
                              <Church className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                            )}
                            <span className="text-[7px] sm:text-[8px] font-bold uppercase">
                              {row.mass === "present" ? "SÍ" : row.mass === "late" ? "T" : "NO"}
                            </span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                // mode === "event"
                const key = `${user.id}|${selectedEventId}`;
                const st = eventByUserAndEvent.get(key) ?? "absent";

                return (
                  <tr
                    key={user.id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="px-3 sm:px-6 py-4">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-indigo-50 flex items-center justify-center font-bold text-indigo-700 overflow-hidden shrink-0 text-[10px] sm:text-base">
                          {user.photo ? (
                            <img
                              src={user.photo}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            user.name[0]
                          )}
                        </div>
                        <span className="font-bold text-slate-800 text-[11px] sm:text-sm truncate">
                          {user.name}
                        </span>
                      </div>
                    </td>

                    <td className="px-2 sm:px-6 py-4">
                      <div className="flex justify-center">
                        <button
                          onClick={() =>
                            onUpdate(
                              user.id,
                              "event",
                              cycleStatus(st),
                              selectedEventId
                            )
                          }
                          className={`px-3 sm:px-6 py-1.5 sm:py-2 rounded-xl text-[10px] sm:text-xs font-bold flex items-center gap-1.5 sm:gap-2 transition-all ${
                            st === "present"
                              ? "bg-green-600 text-white shadow-md"
                              : st === "late"
                                ? "bg-amber-100 text-amber-700 border-2 border-amber-400"
                                : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                          }`}
                        >
                          {st === "present" ? (
                            <Check size={14} />
                          ) : st === "late" ? (
                            <Clock size={14} />
                          ) : (
                            <X size={14} />
                          )}
                          {st === "present"
                            ? "ASISTIÓ"
                            : st === "late"
                              ? "TARDE"
                              : <span className="hidden sm:inline">NO ASISTIÓ</span>
                          }
                          {st === "absent" && <span className="sm:hidden">NO</span>}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        mode === "event" &&
        !selectedEventId && (
          <div className="py-20 text-center text-slate-400 bg-white rounded-2xl border-2 border-dashed border-slate-100">
            <Filter size={48} className="mx-auto mb-4 opacity-20" />
            <p className="font-bold">Selecciona un evento para pasar lista</p>
          </div>
        )
      )}
    </div>
  );
};

export default CatechistAttendance;