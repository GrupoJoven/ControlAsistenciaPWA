import React, { useMemo } from "react";
import {
  AlertCircle,
  Award,
  Calendar,
  CalendarDays,
  ChevronRight,
  Church,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ParishEvent, getTodayStr } from "../types";
import {
  AcademicYear,
  getAcademicYearCutoff,
  getEventTimestamp,
} from "../src/utils/academicYear";
import type { MonitorStage } from "../src/utils/stages";
import {
  Monitor,
  MonitorSlot,
  calculateMonitorDayWeight,
  calculateMonitorRate,
  getMeetingsForStage,
  getMonitorStageConfig,
} from "../src/utils/monitors";

interface MonitorDashboardProps {
  stage: MonitorStage;
  monitors: Monitor[];
  /** Días de actividad de la etapa, del curso seleccionado. */
  activityDays: string[];
  /**
   * Todos los eventos de la agenda dirigidos al usuario, sin filtrar por curso:
   * "Próximas reuniones" debe mostrar lo que aún no ha pasado, como en el
   * Resumen de la catequesis.
   */
  events: ParishEvent[];
  academicYear: AcademicYear;
  onManageAgenda?: () => void;
  /**
   * Un monitor con usuario de la app, que no coordina: solo ve lo suyo (RLS le
   * devuelve su ficha y nada más), así que el panel habla de él y no del
   * equipo.
   */
  personal?: boolean;
}

const MONTH_NAMES = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

const SLOT_STYLES: Record<MonitorSlot, { tile: string; icon: string; accent: string }> = {
  mass: { tile: "border-b-amber-500", icon: "bg-amber-50 text-amber-600", accent: "amber" },
  activity: { tile: "border-b-blue-500", icon: "bg-blue-50 text-blue-600", accent: "blue" },
};

/**
 * Resumen de un coordinador de comunión o de postcomunión. Es el Resumen de la
 * catequesis adaptado: no tiene niños ni grupos, así que mide su equipo de
 * monitores sobre su calendario de actividades y sus reuniones.
 */
const MonitorDashboard: React.FC<MonitorDashboardProps> = ({
  stage,
  monitors,
  activityDays,
  events,
  academicYear,
  onManageAgenda,
  personal = false,
}) => {
  const config = getMonitorStageConfig(stage);
  const today = getTodayStr();
  const cutoff = getAcademicYearCutoff(academicYear);

  const me = personal ? monitors[0] ?? null : null;
  const myRate = me ? calculateMonitorRate(me, activityDays, events, academicYear) : 0;

  // Días de actividad del curso que ya han llegado: el último es el que se
  // resume arriba (hoy, si hoy toca).
  const pastDays = useMemo(
    () => activityDays.filter((d) => d <= today).sort(),
    [activityDays, today]
  );

  const lastDay = pastDays[pastDays.length - 1] ?? null;

  const presentBySlot = useMemo(() => {
    const counts: Record<MonitorSlot, number> = { activity: 0, mass: 0 };
    if (!lastDay) return counts;

    for (const monitor of monitors) {
      const record = (monitor.attendanceHistory ?? []).find(
        (h) => h.date === lastDay && h.type === "activity"
      );

      for (const slot of config.slots) {
        const status = slot === "mass" ? record?.mass : record?.activity;
        if (status === "present" || status === "late") counts[slot] += 1;
      }
    }

    return counts;
  }, [monitors, lastDay, config]);

  const atRisk = useMemo(
    () =>
      monitors.filter(
        (monitor) => calculateMonitorRate(monitor, activityDays, events, academicYear) < 60
      ).length,
    [monitors, activityDays, events, academicYear]
  );

  const upcomingMeetings = useMemo(() => {
    const nowTs = Date.now();

    return getMeetingsForStage(events, stage)
      .filter((event) => {
        const ts = getEventTimestamp(event.date);
        return Number.isFinite(ts) && ts >= nowTs;
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [events, stage]);

  /** Participación media del equipo, mes a mes, sobre los días de actividad. */
  const chartData = useMemo(() => {
    const cutoffMonthIdx = Number(cutoff.slice(5, 7)) - 1;

    if (monitors.length === 0) {
      return [
        { name: "Sep", participación: 0 },
        { name: MONTH_NAMES[cutoffMonthIdx], participación: 0 },
      ];
    }

    const relevantDays = activityDays.filter((d) => d >= academicYear.start && d <= cutoff);
    const monthTotals: Record<string, { totalWeight: number; nDays: number }> = {};

    for (const day of relevantDays) {
      let dayWeight = 0;

      for (const monitor of monitors) {
        const record = (monitor.attendanceHistory ?? []).find(
          (h) => h.date === day && h.type === "activity"
        );
        dayWeight += calculateMonitorDayWeight(stage, record);
      }

      const monthKey = MONTH_NAMES[Number(day.slice(5, 7)) - 1];

      if (!monthTotals[monthKey]) monthTotals[monthKey] = { totalWeight: 0, nDays: 0 };
      monthTotals[monthKey].totalWeight += dayWeight;
      monthTotals[monthKey].nDays += 1;
    }

    const yearSequence = [8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7]; // Sep..Ago
    const data: { name: string; participación: number }[] = [];

    for (const monthIdx of yearSequence) {
      const monthName = MONTH_NAMES[monthIdx];
      const totals = monthTotals[monthName];

      if (totals && totals.nDays > 0) {
        const avg = (totals.totalWeight / (monitors.length * totals.nDays)) * 100;
        data.push({ name: monthName, participación: Math.round(avg) });
      }

      if (monthIdx === cutoffMonthIdx) break;
    }

    return data.length > 0
      ? data
      : [
          { name: "Sep", participación: 0 },
          { name: MONTH_NAMES[cutoffMonthIdx], participación: 0 },
        ];
  }, [monitors, activityDays, academicYear, cutoff, stage]);

  const lastDayLabel = lastDay
    ? lastDay === today
      ? "hoy"
      : new Date(`${lastDay}T12:00:00`).toLocaleDateString("es-ES", {
          day: "numeric",
          month: "short",
        })
    : "—";

  return (
    <div className="space-y-6 lg:space-y-8">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        <div className="bg-white p-4 lg:p-6 rounded-2xl border border-slate-200 shadow-sm border-b-4 border-b-violet-500">
          <div className="flex items-center justify-between mb-3 lg:mb-4">
            <div className="p-1.5 lg:p-2 bg-violet-50 text-violet-600 rounded-lg">
              <Users size={20} />
            </div>
          </div>
          <p className="text-slate-500 text-[10px] lg:text-xs font-bold uppercase tracking-wider">
            {personal ? "Tu asistencia" : config.teamLabel}
          </p>
          <h3 className="text-xl lg:text-3xl font-bold text-slate-900 mt-1">
            {personal ? (me ? `${myRate}%` : "—") : monitors.length}
          </h3>
        </div>

        {config.slots.map((slot) => (
          <div
            key={slot}
            className={`bg-white p-4 lg:p-6 rounded-2xl border border-slate-200 shadow-sm border-b-4 ${SLOT_STYLES[slot].tile}`}
          >
            <div className="flex items-center justify-between mb-3 lg:mb-4">
              <div className={`p-1.5 lg:p-2 rounded-lg ${SLOT_STYLES[slot].icon}`}>
                {slot === "mass" ? <Church size={20} /> : <Sparkles size={20} />}
              </div>
            </div>
            <p className="text-slate-500 text-[10px] lg:text-xs font-bold uppercase tracking-wider">
              {config.slotLabels[slot].long} · {lastDayLabel}
            </p>
            <h3 className="text-xl lg:text-3xl font-bold text-slate-900 mt-1">
              {personal ? (
                lastDay ? (presentBySlot[slot] > 0 ? "Sí" : "No") : "—"
              ) : (
                <>
                  {presentBySlot[slot]}
                  <span className="text-sm lg:text-base font-semibold text-slate-400">
                    /{monitors.length}
                  </span>
                </>
              )}
            </h3>
          </div>
        ))}

        {!personal && (
          <div className="bg-white p-4 lg:p-6 rounded-2xl border border-slate-200 shadow-sm border-b-4 border-b-red-500">
            <div className="flex items-center justify-between mb-3 lg:mb-4">
              <div className="p-1.5 lg:p-2 bg-red-50 text-red-600 rounded-lg">
                <AlertCircle size={20} />
              </div>
            </div>
            <p className="text-slate-500 text-[10px] lg:text-xs font-bold uppercase tracking-wider">
              Baja Asistencia
            </p>
            <h3 className="text-xl lg:text-3xl font-bold text-slate-900 mt-1">{atRisk}</h3>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        <div className="lg:col-span-2 bg-white p-5 lg:p-8 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 lg:mb-8 gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-800">
                {personal ? "Tu participación" : "Participación Media"}
              </h3>
              <p className="text-slate-500 text-xs lg:text-sm">
                Curso {new Date(academicYear.start).getFullYear()} -{" "}
                {new Date(academicYear.end).getFullYear()}
              </p>
            </div>
            <div className="flex items-center gap-2 self-start text-[10px] font-bold text-violet-600 bg-violet-50 px-3 py-1.5 rounded-full capitalize">
              <TrendingUp size={14} />
              {config.dayLabelPlural}
            </div>
          </div>
          <div className="h-48 lg:h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorMonitorPart" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748b", fontSize: 10 }}
                  dy={10}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748b", fontSize: 10 }}
                  unit="%"
                  domain={[0, 100]}
                  width={30}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: "16px",
                    border: "none",
                    boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                  }}
                  formatter={(value: number) => [`${value}%`, "Participación"]}
                />
                <Area
                  type="monotone"
                  dataKey="participación"
                  stroke="#7c3aed"
                  strokeWidth={3}
                  fill="url(#colorMonitorPart)"
                  connectNulls
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 lg:p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
          <h3 className="text-lg font-bold text-slate-800 mb-6 capitalize">
            Próximas {config.meetingLabelPlural}
          </h3>
          <div className="space-y-4 flex-1">
            {upcomingMeetings.length > 0 ? (
              upcomingMeetings.map((meeting) => (
                <div
                  key={meeting.id}
                  className="p-4 bg-violet-50 rounded-xl border border-violet-100 flex items-start gap-3"
                >
                  <div className="p-2 bg-white text-violet-600 rounded-lg shadow-sm shrink-0">
                    <Award size={20} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-semibold text-violet-900 text-sm truncate">
                      {meeting.title}
                    </h4>
                    <p className="text-violet-700 text-xs mt-0.5">
                      {new Date(String(meeting.date).replace(" ", "T")).toLocaleString("es-ES", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {meeting.countsForAttendance === false && (
                        <span className="ml-2 px-2 py-0.5 rounded-full bg-white text-[10px] font-bold uppercase tracking-wide text-violet-600">
                          No cuenta
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Calendar className="text-slate-200 mb-3" size={32} />
                <p className="text-slate-400 text-xs italic">
                  No hay {config.meetingLabelPlural} programadas
                </p>
              </div>
            )}
          </div>

          <div className="mt-6 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-xs text-slate-500 flex items-start gap-2">
            <CalendarDays size={14} className="shrink-0 mt-0.5" />
            <span>
              {activityDays.length} {config.dayLabelPlural} marcados en{" "}
              {academicYear.label.toLowerCase()}.
            </span>
          </div>

          {onManageAgenda && (
            <button
              onClick={onManageAgenda}
              className="w-full mt-4 py-3 px-4 bg-violet-700 text-white rounded-xl text-xs lg:text-sm font-bold hover:bg-violet-800 transition-all flex items-center justify-center gap-2 shadow-lg shadow-violet-100 capitalize"
            >
              Gestionar {config.meetingLabelPlural}
              <ChevronRight size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default MonitorDashboard;
