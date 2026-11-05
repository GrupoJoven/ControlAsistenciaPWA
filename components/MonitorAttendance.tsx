import React, { useMemo, useState } from "react";
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Church,
  Clock,
  Filter,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { AttendanceStatus, ParishEvent, getTodayStr } from "../types";
import type { MonitorStage } from "../src/utils/stages";
import {
  Monitor,
  MonitorSlot,
  getMonitorStageConfig,
  sortMonitorsByName,
} from "../src/utils/monitors";

interface MonitorAttendanceProps {
  stage: MonitorStage;
  /** Monitores de esa etapa, con su historial ya cargado. */
  monitors: Monitor[];
  /** Días de actividad de esa etapa, del curso seleccionado. */
  activityDays: string[];
  /** Reuniones de esa etapa, del curso seleccionado. */
  meetings: ParishEvent[];
  onUpdate: (
    monitorId: string,
    type: "activity" | "event",
    status: AttendanceStatus,
    refId?: string,
    slot?: MonitorSlot,
    date?: string
  ) => void;
}

/**
 * Pasar lista a los monitores de comunión o de postcomunión. Es la misma
 * pantalla que la de los catequistas, con dos diferencias: las casillas del
 * día las decide la etapa (comunión solo tiene catequesis; postcomunión, misa
 * y actividad, por ese orden) y los eventos son sus reuniones, que solo son
 * suyas.
 */
const MonitorAttendance: React.FC<MonitorAttendanceProps> = ({
  stage,
  monitors,
  activityDays,
  meetings,
  onUpdate,
}) => {
  const config = getMonitorStageConfig(stage);

  const [mode, setMode] = useState<"activity" | "event">("activity");
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const today = getTodayStr();

  // Solo se pasa lista en días que ya han llegado: son los únicos que cuentan.
  const pastDays = useMemo(
    () => activityDays.filter((d) => d <= today).sort((a, b) => b.localeCompare(a)),
    [activityDays, today]
  );

  const activeDate =
    selectedDate && pastDays.includes(selectedDate) ? selectedDate : pastDays[0] ?? null;
  const activeIndex = activeDate ? pastDays.indexOf(activeDate) : -1;
  const olderDate = activeIndex >= 0 ? pastDays[activeIndex + 1] ?? null : null;
  const newerDate = activeIndex > 0 ? pastDays[activeIndex - 1] : null;

  const sortedMonitors = useMemo(() => sortMonitorsByName(monitors), [monitors]);

  const sortedMeetings = useMemo(
    () => [...meetings].sort((a, b) => String(a.date).localeCompare(String(b.date))),
    [meetings]
  );

  const selectedMeeting = sortedMeetings.find((e) => e.id === selectedEventId) ?? null;

  const formatDate = (dateStr: string, style: "short" | "long") =>
    new Date(`${dateStr}T12:00:00`).toLocaleDateString(
      "es-ES",
      style === "long"
        ? { weekday: "long", year: "numeric", month: "long", day: "numeric" }
        : { weekday: "short", year: "numeric", month: "short", day: "numeric" }
    );

  const cycleStatus = (current: AttendanceStatus): AttendanceStatus => {
    if (current === "absent") return "present";
    if (current === "present") return "late";
    return "absent";
  };

  /** Lo marcado en cada casilla del día activo, por monitor. */
  const dayByMonitor = useMemo(() => {
    const map = new Map<string, Record<MonitorSlot, AttendanceStatus>>();

    for (const monitor of sortedMonitors) {
      const record = (monitor.attendanceHistory ?? []).find(
        (h) => h.date === activeDate && h.type === "activity"
      );

      map.set(monitor.id, {
        activity: (record?.activity ?? "absent") as AttendanceStatus,
        mass: (record?.mass ?? "absent") as AttendanceStatus,
      });
    }

    return map;
  }, [sortedMonitors, activeDate]);

  const meetingByMonitor = useMemo(() => {
    const map = new Map<string, AttendanceStatus>(); // clave: monitorId|eventId

    for (const monitor of sortedMonitors) {
      for (const record of monitor.attendanceHistory ?? []) {
        if (record.type !== "event" || !record.refId) continue;
        map.set(`${monitor.id}|${record.refId}`, (record.status ?? "absent") as AttendanceStatus);
      }
    }

    return map;
  }, [sortedMonitors]);

  const slotStyle = (status: AttendanceStatus, activeColor: string) => {
    if (status === "present") return `${activeColor} text-white shadow-md`;
    if (status === "late") return "bg-amber-100 text-amber-700 border-2 border-amber-400";
    return "bg-slate-100 text-slate-400 hover:bg-slate-200";
  };

  const slotColor: Record<MonitorSlot, string> = {
    activity: "bg-indigo-600",
    mass: "bg-amber-500",
  };

  const SlotIcon: React.FC<{ slot: MonitorSlot; status: AttendanceStatus }> = ({ slot, status }) => {
    if (status === "late") return <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />;
    if (slot === "mass") return <Church className="w-3.5 h-3.5 sm:w-4 sm:h-4" />;
    return <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4" />;
  };

  const canShowTable =
    (mode === "activity" && activeDate) || (mode === "event" && selectedEventId);

  const MonitorCell: React.FC<{ monitor: Monitor }> = ({ monitor }) => (
    <td className="px-3 sm:px-6 py-4">
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-indigo-50 flex items-center justify-center font-bold text-indigo-700 overflow-hidden shrink-0 text-[10px] sm:text-base">
          {monitor.photo ? (
            <img src={monitor.photo} alt="" className="w-full h-full object-cover" />
          ) : (
            monitor.name.charAt(0) || "?"
          )}
        </div>
        <div className="min-w-0">
          <span className="block font-bold text-slate-800 text-[11px] sm:text-sm truncate">
            {monitor.name}
          </span>
          {monitor.role === "coordinator" && (
            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wide text-violet-600">
              Coordinador
            </span>
          )}
        </div>
      </div>
    </td>
  );

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-500">
      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="flex gap-2 sm:gap-4">
          <button
            onClick={() => setMode("activity")}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all capitalize ${
              mode === "activity"
                ? "bg-indigo-600 text-white shadow-md"
                : "bg-slate-50 text-slate-500 hover:bg-slate-100"
            }`}
          >
            {config.dayLabelPlural}
          </button>
          <button
            onClick={() => setMode("event")}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all capitalize ${
              mode === "event"
                ? "bg-indigo-600 text-white shadow-md"
                : "bg-slate-50 text-slate-500 hover:bg-slate-100"
            }`}
          >
            {config.meetingLabelPlural}
          </button>
        </div>

        {mode === "activity" && activeDate && (
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={() => olderDate && setSelectedDate(olderDate)}
              disabled={!olderDate}
              title={`${config.dayLabel} anterior`}
              aria-label={`${config.dayLabel} anterior`}
              className="p-2 rounded-xl bg-slate-50 text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
            >
              <ChevronLeft size={18} />
            </button>
            <select
              className="flex-1 sm:flex-none min-w-0 px-4 py-2 border rounded-xl text-sm outline-none bg-slate-50 focus:ring-2 focus:ring-indigo-500"
              value={activeDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              aria-label={config.dayLabel}
            >
              {pastDays.map((d) => (
                <option key={d} value={d}>
                  {formatDate(d, "short")}
                  {d === today ? " (hoy)" : ""}
                </option>
              ))}
            </select>
            <button
              onClick={() => newerDate && setSelectedDate(newerDate)}
              disabled={!newerDate}
              title={`${config.dayLabel} siguiente`}
              aria-label={`${config.dayLabel} siguiente`}
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
            <option value="">Selecciona {config.meetingLabel}...</option>
            {sortedMeetings.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} ({String(e.date).slice(0, 10)})
              </option>
            ))}
          </select>
        )}
      </div>

      {sortedMonitors.length === 0 && (
        <div className="py-20 text-center text-slate-400 bg-white rounded-2xl border-2 border-dashed border-slate-100">
          <Users size={48} className="mx-auto mb-4 opacity-20" />
          <p className="font-bold">Todavía no hay monitores</p>
          <p className="text-xs sm:text-sm">
            Añádelos desde el registro de monitores para poder pasar lista.
          </p>
        </div>
      )}

      {sortedMonitors.length > 0 && mode === "activity" && !activeDate && (
        <div className="py-20 text-center text-slate-400 bg-white rounded-2xl border-2 border-dashed border-slate-100">
          <Calendar size={48} className="mx-auto mb-4 opacity-20" />
          <p className="font-bold">No hay {config.dayLabelPlural} para pasar lista</p>
          <p className="text-xs sm:text-sm">
            Márcalos en el calendario de actividades de este curso.
          </p>
        </div>
      )}

      {mode === "activity" && activeDate && activeDate !== today && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 text-sm">
          Estás editando la asistencia del{" "}
          <span className="font-bold">{formatDate(activeDate, "long")}</span>
          {pastDays.includes(today) ? ", no la de hoy" : ""}. Los cambios se guardan en cuanto
          pulsas.
        </div>
      )}

      {mode === "event" && selectedMeeting && !selectedMeeting.countsForAttendance && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 text-sm">
          Esta {config.meetingLabel} <span className="font-bold">no cuenta</span> para el
          porcentaje de asistencia. Puedes pasar lista igualmente para dejar constancia.
        </div>
      )}

      {mode === "event" && !selectedEventId && sortedMonitors.length > 0 && (
        <div className="py-20 text-center text-slate-400 bg-white rounded-2xl border-2 border-dashed border-slate-100">
          <Filter size={48} className="mx-auto mb-4 opacity-20" />
          <p className="font-bold">
            Selecciona una {config.meetingLabel} para pasar lista
          </p>
          {sortedMeetings.length === 0 && (
            <p className="text-xs sm:text-sm">
              Todavía no hay {config.meetingLabelPlural} en la agenda de este curso.
            </p>
          )}
        </div>
      )}

      {canShowTable && sortedMonitors.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left table-fixed">
            <thead>
              <tr className="bg-slate-50 border-b">
                <th className="px-3 sm:px-6 py-4 text-[9px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest w-[40%] sm:w-[35%]">
                  Monitor
                </th>
                {mode === "activity" ? (
                  config.slots.map((slot) => (
                    <th
                      key={slot}
                      className="px-1 sm:px-6 py-4 text-[9px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest text-center"
                    >
                      {config.slotLabels[slot].short}
                    </th>
                  ))
                ) : (
                  <th className="px-2 sm:px-6 py-4 text-[9px] sm:text-xs font-bold text-slate-400 uppercase tracking-widest text-center">
                    Asistencia
                  </th>
                )}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-50">
              {sortedMonitors.map((monitor) => {
                if (mode === "activity") {
                  const row = dayByMonitor.get(monitor.id) ?? {
                    activity: "absent" as AttendanceStatus,
                    mass: "absent" as AttendanceStatus,
                  };

                  return (
                    <tr key={monitor.id} className="hover:bg-slate-50 transition-colors">
                      <MonitorCell monitor={monitor} />

                      {config.slots.map((slot) => {
                        const status = row[slot];

                        return (
                          <td key={slot} className="px-1 sm:px-6 py-4">
                            <div className="flex justify-center">
                              <button
                                onClick={() =>
                                  onUpdate(
                                    monitor.id,
                                    "activity",
                                    cycleStatus(status),
                                    undefined,
                                    slot,
                                    activeDate ?? undefined
                                  )
                                }
                                title={config.slotLabels[slot].long}
                                className={`p-1.5 sm:p-3 rounded-lg sm:rounded-xl transition-all flex flex-col items-center gap-0.5 sm:gap-1 w-12 sm:w-24 ${slotStyle(
                                  status,
                                  slotColor[slot]
                                )}`}
                              >
                                <SlotIcon slot={slot} status={status} />
                                <span className="text-[7px] sm:text-[8px] font-bold uppercase">
                                  {status === "present" ? "SÍ" : status === "late" ? "T" : "NO"}
                                </span>
                              </button>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                }

                const status = meetingByMonitor.get(`${monitor.id}|${selectedEventId}`) ?? "absent";

                return (
                  <tr key={monitor.id} className="hover:bg-slate-50 transition-colors">
                    <MonitorCell monitor={monitor} />

                    <td className="px-2 sm:px-6 py-4">
                      <div className="flex justify-center">
                        <button
                          onClick={() =>
                            onUpdate(monitor.id, "event", cycleStatus(status), selectedEventId)
                          }
                          className={`px-3 sm:px-6 py-1.5 sm:py-2 rounded-xl text-[10px] sm:text-xs font-bold flex items-center gap-1.5 sm:gap-2 transition-all ${
                            status === "present"
                              ? "bg-green-600 text-white shadow-md"
                              : status === "late"
                                ? "bg-amber-100 text-amber-700 border-2 border-amber-400"
                                : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                          }`}
                        >
                          {status === "present" ? (
                            <Check size={14} />
                          ) : status === "late" ? (
                            <Clock size={14} />
                          ) : (
                            <X size={14} />
                          )}
                          {status === "present" ? (
                            "ASISTIÓ"
                          ) : status === "late" ? (
                            "TARDE"
                          ) : (
                            <span className="hidden sm:inline">NO ASISTIÓ</span>
                          )}
                          {status === "absent" && <span className="sm:hidden">NO</span>}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default MonitorAttendance;
