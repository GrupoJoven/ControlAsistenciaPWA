import React, { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  BadgeCheck,
  Calendar,
  Camera,
  Check,
  ChevronRight,
  KeyRound,
  Mail,
  Phone,
  Save,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { ParishEvent } from "../types";
import { AcademicYear, getAcademicYearCutoff, isPastEvent } from "../src/utils/academicYear";
import { normalizeSearchText } from "../src/utils/text";
import { MONITOR_STAGES, MonitorStage, STAGE_LABELS } from "../src/utils/stages";
import {
  Monitor,
  calculateMonitorDayWeight,
  calculateMonitorRate,
  getMeetingsForStage,
  getMonitorStageConfig,
  sortMonitorsByName,
} from "../src/utils/monitors";

export interface NewMonitorInput {
  stage: MonitorStage;
  name: string;
  email: string;
  phone: string;
  birthDate: string;
  notes: string;
}

interface MonitorManagerProps {
  /** Etapa que se está gestionando. */
  stage: MonitorStage;
  /** Monitores de esa etapa, con su historial cargado. */
  monitors: Monitor[];
  /** Días de actividad de esa etapa, del curso seleccionado. */
  activityDays: string[];
  /** Eventos de la agenda del curso seleccionado (se filtran las reuniones). */
  events: ParishEvent[];
  academicYear: AcademicYear;
  searchQuery: string;
  /** Solo el coordinador general puede pasar un monitor a la otra etapa. */
  canMoveStage: boolean;
  isOnline: boolean;
  onAdd: (input: NewMonitorInput) => Promise<boolean>;
  onUpdate: (monitor: Monitor) => Promise<boolean>;
  onRemove: (monitorId: string) => Promise<boolean>;
  /** file null = quitar la foto. */
  onPhotoChange: (monitorId: string, file: File | null) => Promise<void>;
  /** Le crea el usuario de la app y lo vincula con su ficha. */
  onPromote: (monitorId: string, input: { email: string; password: string }) => Promise<boolean>;
  /** Cambia la contraseña de un monitor que ya tiene acceso. */
  onResetPassword: (profileId: string, password: string) => Promise<void>;
}

const rateColor = (rate: number): string => {
  if (rate >= 80) return "text-green-600 bg-green-50";
  if (rate >= 60) return "text-amber-600 bg-amber-50";
  return "text-red-600 bg-red-50";
};

const formatDay = (date: string) =>
  new Date(`${String(date).slice(0, 10)}T12:00:00`).toLocaleDateString("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

/**
 * Registro de monitores de comunión o de postcomunión: su ficha (nombre,
 * contacto, cumpleaños, foto, notas) y su porcentaje de asistencia.
 *
 * El histórico se muestra pero no se toca aquí: se pasa lista en "Asistencia
 * Monitores", que es donde está el calendario y las reuniones.
 *
 * Un monitor no tiene usuario de la app. Si alguno lo necesita, la ficha ya
 * guarda lo mismo que un perfil (ver supabase/sql/monitors.sql) y el
 * coordinador general le puede crear el usuario; cuando lo tenga, aquí se ve
 * la marca "con acceso a la app".
 */
const MonitorManager: React.FC<MonitorManagerProps> = ({
  stage,
  monitors,
  activityDays,
  events,
  academicYear,
  searchQuery,
  canMoveStage,
  isOnline,
  onAdd,
  onUpdate,
  onRemove,
  onPhotoChange,
  onPromote,
  onResetPassword,
}) => {
  const config = getMonitorStageConfig(stage);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [monitorToDelete, setMonitorToDelete] = useState<Monitor | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Acceso a la app: alta del usuario o cambio de contraseña.
  const [isAccessOpen, setIsAccessOpen] = useState(false);
  const [accessEmail, setAccessEmail] = useState("");
  const [accessPassword, setAccessPassword] = useState("");

  // Formulario, compartido por el alta y la edición.
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [notes, setNotes] = useState("");
  const [active, setActive] = useState(true);
  const [formStage, setFormStage] = useState<MonitorStage>(stage);

  const selected = monitors.find((m) => m.id === selectedId) ?? null;

  const meetings = useMemo(() => getMeetingsForStage(events, stage), [events, stage]);

  const visibleMonitors = useMemo(() => {
    const needle = normalizeSearchText(searchQuery);
    const filtered = needle
      ? monitors.filter((m) => normalizeSearchText(m.name).includes(needle))
      : monitors;

    return sortMonitorsByName(filtered);
  }, [monitors, searchQuery]);

  const rateOf = (monitor: Monitor) =>
    calculateMonitorRate(monitor, activityDays, events, academicYear);

  const resetForm = () => {
    setName("");
    setEmail("");
    setPhone("");
    setBirthDate("");
    setNotes("");
    setActive(true);
    setFormStage(stage);
  };

  const resetAccessForm = (monitor: Monitor | null) => {
    setIsAccessOpen(false);
    setAccessEmail(monitor?.email ?? "");
    setAccessPassword("");
  };

  const openDetail = (monitor: Monitor) => {
    setNotice(null);
    setIsAdding(false);
    resetAccessForm(monitor);
    setSelectedId(monitor.id);
    setName(monitor.name);
    setEmail(monitor.email);
    setPhone(monitor.phone);
    setBirthDate((monitor.birthDate || "").slice(0, 10));
    setNotes(monitor.notes);
    setActive(monitor.active);
    setFormStage(monitor.stage);
  };

  const closeDetail = () => {
    setSelectedId(null);
    setIsAdding(false);
    resetForm();
    resetAccessForm(null);
  };

  const openAdd = () => {
    setNotice(null);
    setSelectedId(null);
    resetForm();
    resetAccessForm(null);
    setIsAdding(true);
  };

  const canGrantAccess = !!accessEmail.trim() && accessPassword.length >= 6;

  const handleGrantAccess = async () => {
    if (!selected || !canGrantAccess || isSaving) return;

    setIsSaving(true);
    const ok = await onPromote(selected.id, {
      email: accessEmail.trim(),
      password: accessPassword,
    });
    setIsSaving(false);

    if (!ok) return;

    setNotice(`${selected.name} ya puede entrar en la app con ${accessEmail.trim()}.`);
    resetAccessForm({ ...selected, email: accessEmail.trim() });
  };

  const handleResetAccessPassword = async () => {
    if (!selected?.profileId || accessPassword.length < 6 || isSaving) return;

    setIsSaving(true);
    try {
      await onResetPassword(selected.profileId, accessPassword);
    } finally {
      setIsSaving(false);
    }

    setAccessPassword("");
    setIsAccessOpen(false);
  };

  const handleAdd = async () => {
    if (!name.trim() || isSaving) return;

    setIsSaving(true);
    const ok = await onAdd({
      stage: formStage,
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      birthDate,
      notes: notes.trim(),
    });
    setIsSaving(false);

    if (!ok) return;

    setNotice(`${name.trim()} añadido a ${STAGE_LABELS[formStage].toLowerCase()}.`);
    closeDetail();
  };

  const handleSave = async () => {
    if (!selected || !name.trim() || isSaving) return;

    setIsSaving(true);
    const ok = await onUpdate({
      ...selected,
      stage: formStage,
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      birthDate,
      notes: notes.trim(),
      active,
    });
    setIsSaving(false);

    if (!ok) return;

    setNotice(
      formStage === selected.stage
        ? `Ficha de ${name.trim()} guardada.`
        : `${name.trim()} pasa a ${STAGE_LABELS[formStage].toLowerCase()}.`
    );
    closeDetail();
  };

  const confirmDelete = async () => {
    if (!monitorToDelete || isSaving) return;

    setIsSaving(true);
    const ok = await onRemove(monitorToDelete.id);
    setIsSaving(false);

    if (!ok) return;

    setNotice(`${monitorToDelete.name} eliminado.`);
    setMonitorToDelete(null);
    closeDetail();
  };

  const handlePhotoPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selected) return;

    try {
      await onPhotoChange(selected.id, file);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /** Histórico del curso: días de actividad pasados y reuniones ya celebradas. */
  const history = useMemo(() => {
    if (!selected) return [] as { key: string; label: string; detail: string; weight: number }[];

    const rows: { key: string; label: string; detail: string; weight: number; sortDate: string }[] = [];
    const records = selected.attendanceHistory ?? [];

    // Hasta hoy (o hasta el final del curso si ya se cerró): un día que
    // todavía no ha llegado no es una falta.
    const cutoff = getAcademicYearCutoff(academicYear);

    for (const day of activityDays) {
      if (day > cutoff) continue;

      const record = records.find((h) => h.date === day && h.type === "activity");
      const weight = calculateMonitorDayWeight(selected.stage, record);

      const detail = config.slots
        .map((slot) => {
          const status = slot === "mass" ? record?.mass : record?.activity;
          const mark = status === "present" ? "sí" : status === "late" ? "tarde" : "no";
          return `${config.slotLabels[slot].long}: ${mark}`;
        })
        .join(" · ");

      rows.push({
        key: `day-${day}`,
        label: formatDay(day),
        detail,
        weight,
        sortDate: day,
      });
    }

    for (const meeting of meetings) {
      if (!isPastEvent(meeting.date, academicYear)) continue;

      const record = records.find((h) => h.type === "event" && h.refId === meeting.id);
      const status = record?.status ?? "absent";

      rows.push({
        key: `event-${meeting.id}`,
        label: formatDay(meeting.date),
        detail: `${meeting.title} · ${
          status === "present" ? "asistió" : status === "late" ? "tarde" : "no asistió"
        }${meeting.countsForAttendance === false ? " · no cuenta" : ""}`,
        weight: status === "present" ? 1 : 0,
        sortDate: String(meeting.date).slice(0, 10),
      });
    }

    return rows
      .sort((a, b) => b.sortDate.localeCompare(a.sortDate))
      .map(({ sortDate, ...row }) => row);
  }, [selected, activityDays, meetings, academicYear, config]);

  const isFormOpen = isAdding || !!selected;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {notice && (
        <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-green-800 text-sm flex items-center gap-2">
          <Check size={16} />
          {notice}
        </div>
      )}

      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-violet-50 text-violet-600 rounded-xl shrink-0">
            <Users size={24} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">{config.teamLabel}</h2>
            <p className="text-slate-500 text-xs sm:text-sm">
              {monitors.length} {monitors.length === 1 ? "monitor" : "monitores"} ·{" "}
              {activityDays.length} {config.dayLabelPlural} y {meetings.length}{" "}
              {meetings.length === 1 ? config.meetingLabel : config.meetingLabelPlural} en{" "}
              {academicYear.label.toLowerCase()}
            </p>
          </div>
        </div>

        <button
          onClick={openAdd}
          disabled={!isOnline}
          className="px-4 py-2.5 bg-violet-600 text-white rounded-xl text-sm font-bold hover:bg-violet-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <UserPlus size={18} />
          Añadir monitor
        </button>
      </div>

      {!isFormOpen && (
        <>
          {visibleMonitors.length === 0 ? (
            <div className="py-20 text-center text-slate-400 bg-white rounded-2xl border-2 border-dashed border-slate-100">
              <Users size={48} className="mx-auto mb-4 opacity-20" />
              <p className="font-bold">
                {monitors.length === 0
                  ? "Todavía no hay monitores en esta etapa"
                  : "Ningún monitor con ese nombre"}
              </p>
              {monitors.length === 0 && (
                <p className="text-xs sm:text-sm">Añádelos para poder pasarles lista.</p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleMonitors.map((monitor) => {
                const rate = rateOf(monitor);

                return (
                  <button
                    key={monitor.id}
                    onClick={() => openDetail(monitor)}
                    className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm hover:border-violet-300 hover:shadow-md transition-all text-left flex items-center gap-4"
                  >
                    <div className="w-12 h-12 rounded-xl bg-violet-50 flex items-center justify-center font-bold text-violet-700 overflow-hidden shrink-0">
                      {monitor.photo ? (
                        <img src={monitor.photo} alt="" className="w-full h-full object-cover" />
                      ) : (
                        monitor.name.charAt(0) || "?"
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-slate-800 text-sm truncate">{monitor.name}</p>
                      <p className="text-xs text-slate-400 truncate">
                        {monitor.email || "Sin correo"}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {monitor.role === "coordinator" && (
                          <span className="px-2 py-0.5 rounded-full bg-violet-50 text-[9px] font-bold uppercase tracking-wide text-violet-600">
                            Coordinador
                          </span>
                        )}
                        {monitor.profileId && (
                          <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-[9px] font-bold uppercase tracking-wide text-indigo-600 flex items-center gap-1">
                            <BadgeCheck size={10} />
                            Con acceso
                          </span>
                        )}
                        {!monitor.active && (
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                            Inactivo
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold ${rateColor(rate)}`}
                      >
                        {rate}%
                      </span>
                      <ChevronRight size={18} className="text-slate-300" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {isFormOpen && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 sm:p-6 border-b border-slate-100 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="relative">
                <div className="w-14 h-14 rounded-2xl bg-violet-50 flex items-center justify-center font-bold text-violet-700 text-xl overflow-hidden">
                  {selected?.photo ? (
                    <img src={selected.photo} alt="" className="w-full h-full object-cover" />
                  ) : (
                    name.charAt(0) || "?"
                  )}
                </div>

                {selected && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={!isOnline}
                    title="Cambiar foto"
                    className="absolute -bottom-1 -right-1 p-1.5 bg-white border border-slate-200 rounded-full text-slate-500 hover:text-violet-600 shadow-sm disabled:opacity-50"
                  >
                    <Camera size={12} />
                  </button>
                )}
              </div>

              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-900 truncate">
                  {isAdding ? "Nuevo monitor" : selected?.name}
                </h2>
                <p className="text-slate-500 text-xs">
                  {STAGE_LABELS[formStage]}
                  {selected && ` · ${rateOf(selected)}% de asistencia`}
                </p>
              </div>
            </div>

            <button
              onClick={closeDetail}
              className="p-2 text-slate-400 hover:text-slate-600 shrink-0"
              aria-label="Cerrar"
            >
              <X size={20} />
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoPick}
          />

          <div className="p-5 sm:p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                  Nombre
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-violet-500"
                  placeholder="Nombre y apellidos"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                  <Mail size={12} className="inline mr-1" />
                  Correo
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-violet-500"
                  placeholder="opcional"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                    <Phone size={12} className="inline mr-1" />
                    Teléfono
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-violet-500"
                    placeholder="opcional"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                    <Calendar size={12} className="inline mr-1" />
                    Cumpleaños
                  </label>
                  <input
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                  Etapa
                </label>
                {canMoveStage ? (
                  <select
                    value={formStage}
                    onChange={(e) => setFormStage(e.target.value as MonitorStage)}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    {MONITOR_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {STAGE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="px-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-sm text-slate-500 flex items-center gap-2">
                    <ArrowRightLeft size={14} className="text-slate-400 shrink-0" />
                    {STAGE_LABELS[formStage]} · el cambio de etapa lo hace el coordinador general
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">
                  Notas
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                  placeholder="opcional"
                />
              </div>

              {!isAdding && (
                <label className="flex items-center gap-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-violet-600"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                  />
                  <span className="text-sm text-slate-700">
                    Sigue en el equipo
                    <span className="block text-xs text-slate-400">
                      Al desmarcarlo se queda en el registro pero marcado como inactivo.
                    </span>
                  </span>
                </label>
              )}

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  onClick={isAdding ? handleAdd : handleSave}
                  disabled={!name.trim() || isSaving || !isOnline}
                  className="flex-1 py-3 px-4 bg-violet-600 text-white font-bold rounded-xl hover:bg-violet-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Save size={18} />
                  {isAdding ? "Añadir" : "Guardar"}
                </button>

                {selected && !selected.profileId && (
                  <button
                    onClick={() => setMonitorToDelete(selected)}
                    disabled={!isOnline}
                    className="py-3 px-4 bg-red-50 text-red-600 font-bold rounded-xl hover:bg-red-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <Trash2 size={18} />
                    Eliminar
                  </button>
                )}
              </div>

              {selected?.profileId && (
                <p className="text-xs text-slate-400 leading-relaxed">
                  Este monitor tiene usuario de la app, así que no se borra desde aquí: primero hay
                  que quitarle el acceso.
                </p>
              )}
            </div>

            {selected && (
              <div className="space-y-6">
                {/* Acceso a la app. Un monitor no lo necesita para que se le
                    pase lista: esto es para quien además tenga que entrar. Al
                    crearle el usuario se vincula con su ficha, así que no
                    pierde su historial. */}
                <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                        Acceso a la app
                      </h3>
                      <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                        {selected.profileId ? (
                          <>
                            Entra con{" "}
                            <span className="font-semibold text-slate-700">
                              {selected.email || "su correo"}
                            </span>
                            .
                          </>
                        ) : (
                          "Todavía no entra en la app. No le hace falta para que se le pase lista."
                        )}
                      </p>
                    </div>

                    {selected.profileId && (
                      <span className="shrink-0 px-2 py-0.5 rounded-full bg-indigo-50 text-[9px] font-bold uppercase tracking-wide text-indigo-600 flex items-center gap-1">
                        <BadgeCheck size={10} />
                        Con acceso
                      </span>
                    )}
                  </div>

                  {!isAccessOpen ? (
                    <button
                      type="button"
                      onClick={() => {
                        setNotice(null);
                        setAccessEmail(selected.email ?? "");
                        setAccessPassword("");
                        setIsAccessOpen(true);
                      }}
                      disabled={!isOnline}
                      className="w-full px-3 py-2 rounded-xl border border-dashed border-indigo-200 text-indigo-700 text-sm font-bold hover:bg-indigo-50 flex items-center justify-center gap-2 disabled:opacity-40"
                    >
                      <KeyRound size={16} />
                      {selected.profileId ? "Restablecer contraseña" : "Crear usuario de la app"}
                    </button>
                  ) : (
                    <div className="space-y-2">
                      {!selected.profileId && (
                        <input
                          type="email"
                          placeholder="Correo de acceso"
                          autoComplete="off"
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                          value={accessEmail}
                          onChange={(e) => setAccessEmail(e.target.value)}
                        />
                      )}

                      <input
                        type="text"
                        placeholder={
                          selected.profileId
                            ? "Contraseña nueva (mínimo 6)"
                            : "Contraseña inicial (mínimo 6)"
                        }
                        autoComplete="off"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm"
                        value={accessPassword}
                        onChange={(e) => setAccessPassword(e.target.value)}
                      />

                      <div className="flex flex-col-reverse sm:flex-row gap-2">
                        <button
                          type="button"
                          onClick={() => resetAccessForm(selected)}
                          disabled={isSaving}
                          className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50 disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void (selected.profileId
                              ? handleResetAccessPassword()
                              : handleGrantAccess())
                          }
                          disabled={
                            isSaving ||
                            !isOnline ||
                            (selected.profileId ? accessPassword.length < 6 : !canGrantAccess)
                          }
                          className="flex-1 px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-500"
                        >
                          {selected.profileId ? "Cambiar" : "Crear usuario"}
                        </button>
                      </div>

                      {!selected.profileId && (
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                          Se le crea un perfil de {STAGE_LABELS[selected.stage].toLowerCase()} con
                          el nombre y el cumpleaños de su ficha. Verá el resumen, el calendario de
                          actividades y las reuniones, pero no coordinará nada. Su asistencia se
                          queda donde está.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                    Histórico · {academicYear.label}
                  </h3>
                  <span className="text-[10px] text-slate-400">
                    Se edita en Asistencia Monitores
                  </span>
                </div>

                <div className="max-h-[28rem] overflow-y-auto rounded-xl border border-slate-100 divide-y divide-slate-50">
                  {history.length === 0 && (
                    <p className="px-4 py-8 text-xs text-slate-400 text-center">
                      Todavía no hay {config.dayLabelPlural} ni{" "}
                      {config.meetingLabelPlural} de este curso.
                    </p>
                  )}

                  {history.map((row) => (
                    <div
                      key={row.key}
                      className="px-4 py-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-700 capitalize">
                          {row.label}
                        </p>
                        <p className="text-xs text-slate-400 truncate">{row.detail}</p>
                      </div>

                      <span
                        className={`px-2 py-1 rounded-lg text-[10px] font-bold shrink-0 ${
                          row.weight >= 1
                            ? "bg-green-50 text-green-600"
                            : row.weight > 0
                              ? "bg-amber-50 text-amber-600"
                              : "bg-red-50 text-red-500"
                        }`}
                      >
                        {Math.round(row.weight * 100)}%
                      </span>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-xs text-slate-500 leading-relaxed">
                  {config.slots.length > 1 ? (
                    <>
                      Cada {config.dayLabel} vale 1:{" "}
                      {config.slots
                        .map(
                          (slot) =>
                            `${config.slotLabels[slot].long.toLowerCase()} ${config.weights[slot]
                              .toString()
                              .replace(".", ",")}`
                        )
                        .join(" + ")}
                      . Llegar tarde vale la mitad y cada {config.meetingLabel} vale 1.
                    </>
                  ) : (
                    <>
                      Cada {config.dayLabel} vale 1 (solo{" "}
                      {config.slotLabels.activity.long.toLowerCase()}, sin misa). Llegar tarde vale
                      la mitad y cada {config.meetingLabel} vale 1.
                    </>
                  )}
                </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {monitorToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl p-8 space-y-6">
            <div className="flex items-center gap-4 text-red-600">
              <div className="p-3 bg-red-50 rounded-2xl">
                <AlertTriangle size={32} />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Eliminar monitor</h3>
                <p className="text-sm text-slate-500 font-medium">{monitorToDelete.name}</p>
              </div>
            </div>

            <p className="text-slate-600 text-sm leading-relaxed">
              Se borra su ficha y todo su historial de asistencia. No se puede deshacer. Si solo ha
              dejado el equipo, es mejor desmarcar «Sigue en el equipo».
            </p>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => setMonitorToDelete(null)}
                className="order-2 sm:order-1 flex-1 py-3 px-4 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                disabled={isSaving}
                className="order-1 sm:order-2 flex-1 py-3 px-4 bg-red-600 text-white font-bold rounded-2xl hover:bg-red-700 transition-colors disabled:opacity-50"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MonitorManager;
