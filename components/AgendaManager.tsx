import React, { useEffect, useMemo, useState } from "react";
import { Calendar, Check, Lock, Pencil, Plus, Search, UserCheck, Users } from "lucide-react";
import { ParishEvent, User } from "../types";
import { normalizeSearchText } from "../src/utils/text";
import {
  ALL_GRADES,
  CATECHESIS_STAGES,
  EventGrade,
  EventStage,
  GRADE_LABELS,
  MONITOR_STAGES,
  STAGE_LABELS,
  canManageEventStage,
  getEventAudienceLabel,
  isCatechesisStage,
  isGlobalCoordinator,
  isMonitorStageUser,
  isTargetedEvent,
} from "../src/utils/stages";

interface AgendaManagerProps {
  currentUser: User;
  events: ParishEvent[];
  /** Perfiles a los que se puede invitar a un evento específico. */
  users: User[];
  /** Devuelve true si el evento se ha creado: solo entonces se limpia todo. */
  onAdd: (e: {
    title: string;
    date: string;
    stage: EventStage;
    grade: EventGrade;
    inviteOnly: boolean;
    countsForAttendance: boolean;
    inviteeIds: string[];
  }) => Promise<boolean>;
  /** Devuelve true si se ha guardado: solo entonces se cierra el diálogo. */
  onUpdate: (
    id: string,
    changes: {
      title: string;
      date: string;
      stage: EventStage;
      grade: EventGrade;
      countsForAttendance: boolean;
      inviteeIds: string[];
    }
  ) => Promise<boolean>;
  onRemove: (id: string) => void;
}

/**
 * Buscador con casillas para elegir invitados. Lo comparten el formulario de
 * creación y el de edición, que se manejan igual.
 */
const InviteePicker: React.FC<{
  candidates: User[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}> = ({ candidates, selectedIds, onChange }) => {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = normalizeSearchText(query);
    if (!needle) return candidates;
    return candidates.filter((u) => normalizeSearchText(u.name).includes(needle));
  }, [candidates, query]);

  const toggle = (id: string) =>
    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter((v) => v !== id)
        : [...selectedIds, id]
    );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">
          Invitados · {selectedIds.length}
        </span>
        {selectedIds.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs font-bold text-slate-500 hover:text-red-600"
          >
            Quitar todos
          </button>
        )}
      </div>

      <div className="relative">
        <Search
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          type="text"
          placeholder="Buscar por nombre..."
          className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="max-h-56 overflow-y-auto rounded-xl bg-white border border-slate-200 divide-y divide-slate-50">
        {filtered.map((u) => (
          <label
            key={u.id}
            className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50"
          >
            <input
              type="checkbox"
              className="w-4 h-4 accent-indigo-600 shrink-0"
              checked={selectedIds.includes(u.id)}
              onChange={() => toggle(u.id)}
            />
            <span className="text-sm text-slate-700 truncate">{u.name}</span>
          </label>
        ))}

        {filtered.length === 0 && (
          <p className="px-3 py-4 text-xs text-slate-400 text-center">
            Nadie con ese nombre.
          </p>
        )}
      </div>
    </div>
  );
};

/** parish_events.date llega como "2026-09-11T18:00:00" (o con espacio), y el
 *  input datetime-local quiere exactamente "2026-09-11T18:00". */
const toDateTimeInput = (date: string): string =>
  String(date).replace(" ", "T").slice(0, 16);

const AgendaManager: React.FC<AgendaManagerProps> = ({
  currentUser,
  events,
  users,
  onAdd,
  onUpdate,
  onRemove,
}) => {
  const isGlobal = isGlobalCoordinator(currentUser);

  /**
   * Un coordinador de comunión o de postcomunión no gestiona eventos de la
   * catequesis: gestiona las REUNIONES de sus monitores. No tienen cursos ni
   * invitados (sus monitores no tienen usuario de la app), así que la pantalla
   * se queda solo con título, fecha y si cuenta para la asistencia.
   */
  const isMonitorAgenda = isMonitorStageUser(currentUser);

  const words = isMonitorAgenda
    ? { one: "reunión", add: "Añadir nueva reunión", list: "Reuniones programadas", remove: "Eliminar reunión", edit: "Editar reunión", created: "Reunión" }
    : { one: "evento", add: "Añadir Nuevo Evento", list: "Eventos Activos", remove: "Eliminar evento", edit: "Editar evento", created: "Evento" };


  // El coordinador global elige a quién afecta el evento; el de etapa solo
  // puede crear eventos de la suya (RLS lo impone igualmente).
  const fixedStage: EventStage | null = isGlobal ? null : (currentUser.stage ?? null);

  const [newTitle, setNewTitle] = useState("");
  const [newDateTime, setNewDateTime] = useState("");
  const [newStage, setNewStage] = useState<EventStage>(fixedStage ?? "all");
  const [newGrade, setNewGrade] = useState<EventGrade>(0);
  const [inviteOnly, setInviteOnly] = useState(false);
  const [countsForAttendance, setCountsForAttendance] = useState(true);
  const [inviteeIds, setInviteeIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ action: string; detail: string } | null>(null);
  const [eventToDelete, setEventToDelete] = useState<ParishEvent | null>(null);

  // Evento que se está editando, con sus campos aparte: así se puede cancelar
  // sin tocar nada y el diálogo no depende de que la lista se recargue.
  const [editing, setEditing] = useState<ParishEvent | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDateTime, setEditDateTime] = useState("");
  const [editStage, setEditStage] = useState<EventStage>("all");
  const [editGrade, setEditGrade] = useState<EventGrade>(0);
  const [editCounts, setEditCounts] = useState(true);
  const [editInviteeIds, setEditInviteeIds] = useState<string[]>([]);

  // El aviso se va solo: si se quedara fijo, al rato ya no se sabría a qué
  // evento se refiere.
  useEffect(() => {
    if (!notice) return;

    const timer = window.setTimeout(() => setNotice(null), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // En un evento específico la etapa solo decide quién lo gestiona (y RLS la
  // comprueba), no a quién va dirigido: eso lo dice la lista de invitados.
  const stage = inviteOnly ? (fixedStage ?? "all") : (fixedStage ?? newStage);

  // Un evento de un solo curso lo es de un curso de UNA etapa: no hay eventos
  // para los primeros de las dos a la vez, serían dos eventos distintos.
  const grade: EventGrade = inviteOnly || stage === "all" ? 0 : newGrade;

  const candidates = useMemo(
    () =>
      users
        .filter((u) => u.role === "catechist" || u.role === "coordinator")
        .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" })),
    [users]
  );

  const nameById = useMemo(
    () => new Map(users.map((u) => [u.id, u.name])),
    [users]
  );

  const canAdd = !!newTitle && !!newDateTime && (!inviteOnly || inviteeIds.length > 0);

  const formatDateTime = (value: string) =>
    new Date(value).toLocaleString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  /** Vuelve a dejar el formulario como al entrar. */
  const resetForm = () => {
    setNewTitle("");
    setNewDateTime("");
    setNewStage(fixedStage ?? "all");
    setNewGrade(0);
    setInviteOnly(false);
    setCountsForAttendance(true);
    setInviteeIds([]);
  };

  const handleAdd = async () => {
    if (!canAdd || isSaving) return;

    // El formulario se limpia DESPUÉS de saber que el evento está creado: si
    // falla, el coordinador no tiene que volver a escribirlo todo.
    const titleCreated = newTitle;
    const dateCreated = newDateTime;

    setIsSaving(true);
    setNotice(null);

    const ok = await onAdd({
      title: newTitle,
      date: newDateTime,
      stage,
      grade,
      inviteOnly,
      countsForAttendance: inviteOnly || isMonitorAgenda ? countsForAttendance : true,
      inviteeIds: inviteOnly ? inviteeIds : [],
    });

    setIsSaving(false);

    if (!ok) return;

    resetForm();
    setNotice({
      action: "creado",
      detail: `${titleCreated} · ${formatDateTime(dateCreated)}`,
    });
  };

  const openEdit = (event: ParishEvent) => {
    setEditing(event);
    setEditTitle(event.title);
    setEditDateTime(toDateTimeInput(event.date));
    setEditStage(event.stage);
    setEditGrade(event.grade);
    setEditCounts(event.countsForAttendance);
    setEditInviteeIds([...event.inviteeIds]);
  };

  // Mismas reglas que al crear: un coordinador de etapa no se lleva el evento
  // a otra, y un evento de 'ambas etapas' o específico no tiene curso.
  const editingStage: EventStage = editing?.inviteOnly
    ? editing.stage
    : (fixedStage ?? editStage);

  const editingGrade: EventGrade =
    editing?.inviteOnly || editingStage === "all" ? 0 : editGrade;

  const canSaveEdit =
    !!editTitle &&
    !!editDateTime &&
    (!editing?.inviteOnly || editInviteeIds.length > 0);

  const handleSaveEdit = async () => {
    if (!editing || !canSaveEdit || isSaving) return;

    setIsSaving(true);
    setNotice(null);

    const ok = await onUpdate(editing.id, {
      title: editTitle,
      date: editDateTime,
      stage: editingStage,
      grade: editingGrade,
      countsForAttendance: editing.inviteOnly || isMonitorAgenda ? editCounts : true,
      inviteeIds: editing.inviteOnly ? editInviteeIds : [],
    });

    setIsSaving(false);

    // Si falla, el diálogo se queda abierto con lo escrito para reintentarlo.
    if (!ok) return;

    setEditing(null);
    setNotice({
      action: "actualizado",
      detail: `${editTitle} · ${formatDateTime(editDateTime)}`,
    });
  };

  /** Invitados de un evento, con los nombres que este usuario pueda leer. */
  const inviteeLabel = (event: ParishEvent): string =>
    event.inviteeIds
      .map((id) => nameById.get(id) ?? "¿?")
      .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }))
      .join(", ");

  const stageSelect = (
    value: EventStage,
    onChange: (next: EventStage) => void
  ) =>
    fixedStage ? (
      <div
        className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-xl text-sm text-slate-600 flex items-center gap-2 w-full sm:w-auto sm:flex-1 sm:min-w-[150px]"
        title="Solo puedes gestionar eventos de tu etapa"
      >
        <Lock size={14} className="text-slate-400 shrink-0" />
        {STAGE_LABELS[fixedStage]}
      </div>
    ) : (
      <select
        className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm w-full sm:w-auto sm:flex-1 sm:min-w-[150px]"
        value={value}
        onChange={(e) => onChange(e.target.value as EventStage)}
        title="¿A qué etapa afecta el evento?"
      >
        <option value="all">{STAGE_LABELS.all}</option>
        {CATECHESIS_STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s]}
          </option>
        ))}
        {/* Las etapas de monitores: sus reuniones solo les llegan a ellos. */}
        {MONITOR_STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABELS[s]}
          </option>
        ))}
      </select>
    );

  /* Un evento de "ambas etapas" es para todo el mundo: elegir un curso dentro
     de las dos no tendría sentido. */
  const gradeSelect = (
    currentStage: EventStage,
    value: EventGrade,
    onChange: (next: EventGrade) => void
  ) => (
    <select
      className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm w-full sm:w-auto sm:flex-1 sm:min-w-[150px] disabled:bg-slate-100 disabled:text-slate-400"
      value={value}
      disabled={currentStage === "all"}
      onChange={(e) => onChange(Number(e.target.value) as EventGrade)}
      title={
        currentStage === "all"
          ? "Un evento de ambas etapas es para todos los cursos"
          : "¿A qué curso de la etapa afecta el evento?"
      }
    >
      <option value={0}>{GRADE_LABELS[0]}</option>
      {ALL_GRADES.map((g) => (
        <option key={g} value={g}>
          Solo {GRADE_LABELS[g]} curso
        </option>
      ))}
    </select>
  );

  return (
    <>
      {eventToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-3">
              {words.remove}
            </h3>

            <p className="text-slate-600 mb-6">
              ¿Seguro que quieres eliminar {isMonitorAgenda ? "la reunión" : "el evento"}
              <span className="font-semibold"> "{eventToDelete.title}"</span> del día
              <span className="font-semibold"> {formatDateTime(eventToDelete.date)}</span>
              ?
            </p>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setEventToDelete(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>

              <button
                onClick={() => {
                  onRemove(eventToDelete.id);
                  setEventToDelete(null);
                }}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4 my-auto">
            <h3 className="text-lg font-semibold text-slate-800">{words.edit}</h3>

            <input
              type="text"
              placeholder="Título"
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
            />

            <input
              type="datetime-local"
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              value={editDateTime}
              onChange={(e) => setEditDateTime(e.target.value)}
            />

            {/* La clase de evento no se cambia: de etapa a solo invitados (o al
                revés) cambiaría a quién le cuenta la asistencia ya pasada. */}
            {editing.inviteOnly ? (
              <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-600 uppercase tracking-wide">
                  <UserCheck size={14} className="text-indigo-500" />
                  Evento solo para invitados
                </div>

                <InviteePicker
                  candidates={candidates}
                  selectedIds={editInviteeIds}
                  onChange={setEditInviteeIds}
                />

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-indigo-600 shrink-0"
                    checked={editCounts}
                    onChange={(e) => setEditCounts(e.target.checked)}
                  />
                  <span className="text-sm text-slate-700">
                    Cuenta para el porcentaje de asistencia
                  </span>
                </label>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-3">
                  {stageSelect(editStage, setEditStage)}
                  {isCatechesisStage(editingStage) &&
                    gradeSelect(editingStage, editingGrade, setEditGrade)}
                </div>

                {isMonitorAgenda && (
                  <label className="flex items-center gap-3 cursor-pointer rounded-xl border border-violet-100 bg-violet-50/40 px-4 py-3">
                    <input
                      type="checkbox"
                      className="w-4 h-4 accent-violet-600 shrink-0"
                      checked={editCounts}
                      onChange={(e) => setEditCounts(e.target.checked)}
                    />
                    <span className="text-sm text-slate-700">
                      Cuenta para el porcentaje de asistencia
                    </span>
                  </label>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setEditing(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>

              <button
                onClick={() => void handleSaveEdit()}
                disabled={!canSaveEdit || isSaving}
                title={
                  editing.inviteOnly && editInviteeIds.length === 0
                    ? "Un evento específico necesita al menos un invitado"
                    : "Guardar los cambios"
                }
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6 max-w-2xl mx-auto">
        {notice && (
          <div className="flex items-start gap-2 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
            <Check size={16} className="mt-0.5 shrink-0" />
            <span>
              {words.created} {notice.action}: <span className="font-bold">{notice.detail}</span>
            </span>
          </div>
        )}

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-4">{words.add}</h3>

          {/* Dos clases de evento: el de siempre, dirigido a una etapa y un
              curso, y el específico, que solo les llega a los invitados. Un
              coordinador de monitores solo tiene reuniones de su etapa: sus
              monitores no tienen usuario al que invitar. */}
          <div className={isMonitorAgenda ? "hidden" : "flex gap-2 mb-4"}>
            <button
              type="button"
              onClick={() => setInviteOnly(false)}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                !inviteOnly
                  ? "bg-indigo-600 text-white shadow-md"
                  : "bg-slate-50 text-slate-500 hover:bg-slate-100"
              }`}
            >
              <Users size={14} /> Por etapa y curso
            </button>
            <button
              type="button"
              onClick={() => setInviteOnly(true)}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                inviteOnly
                  ? "bg-indigo-600 text-white shadow-md"
                  : "bg-slate-50 text-slate-500 hover:bg-slate-100"
              }`}
            >
              <UserCheck size={14} /> Solo invitados
            </button>
          </div>

          {/* Varias filas: con los selectores de etapa y curso, título + fecha +
              etapa + curso + botón no caben en una sola dentro de max-w-2xl y
              el botón se salía. */}
          <div className="flex flex-col gap-4">
            <input
              type="text"
              placeholder="Título"
              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />

            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-4">
              <input
                type="datetime-local"
                className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl w-full sm:w-auto max-w-[300px] sm:max-w-full"
                value={newDateTime}
                onChange={(e) => setNewDateTime(e.target.value)}
              />

              {!inviteOnly && stageSelect(newStage, setNewStage)}
              {!inviteOnly && isCatechesisStage(stage) && gradeSelect(stage, grade, setNewGrade)}

              <button
                onClick={() => void handleAdd()}
                disabled={!canAdd || isSaving}
                title={
                  inviteOnly && inviteeIds.length === 0
                    ? "Selecciona al menos un invitado"
                    : "Añadir evento"
                }
                className="w-full sm:w-auto p-2 bg-indigo-600 text-white rounded-xl flex items-center justify-center shrink-0 disabled:bg-slate-200 disabled:text-slate-400"
              >
                <Plus size={24} />
              </button>
            </div>

            {/* Las reuniones de monitores son el único evento de su etapa, así
                que aquí sí se puede dejar una fuera del porcentaje (una
                informativa, por ejemplo). */}
            {isMonitorAgenda && !inviteOnly && (
              <label className="flex items-center gap-3 cursor-pointer rounded-xl border border-violet-100 bg-violet-50/40 px-4 py-3">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-violet-600 shrink-0"
                  checked={countsForAttendance}
                  onChange={(e) => setCountsForAttendance(e.target.checked)}
                />
                <span className="text-sm text-slate-700">
                  Cuenta para el porcentaje de asistencia
                </span>
              </label>
            )}

            {inviteOnly && (
              <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
                <InviteePicker
                  candidates={candidates}
                  selectedIds={inviteeIds}
                  onChange={setInviteeIds}
                />

                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-indigo-600 shrink-0"
                    checked={countsForAttendance}
                    onChange={(e) => setCountsForAttendance(e.target.checked)}
                  />
                  <span className="text-sm text-slate-700">
                    Cuenta para el porcentaje de asistencia
                  </span>
                </label>

                <p className="text-xs text-slate-500">
                  Solo los invitados verán el evento en su agenda y recibirán el aviso.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <h3 className="font-bold text-slate-800">{words.list}</h3>
          </div>

          <div className="divide-y divide-slate-100">
            {events.map((event) => (
              <div
                key={event.id}
                className="p-4 flex items-center justify-between gap-3 hover:bg-slate-50"
              >
                <div className="flex items-center gap-4 min-w-0">
                  <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg shrink-0">
                    <Calendar size={18} />
                  </div>

                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{event.title}</p>
                    <p className="text-xs text-slate-500">
                      {formatDateTime(event.date)}
                      <span
                        className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                          isTargetedEvent(event)
                            ? "bg-indigo-50 text-indigo-600"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {event.inviteOnly
                          ? `${event.inviteeIds.length} invitado${
                              event.inviteeIds.length === 1 ? "" : "s"
                            }`
                          : getEventAudienceLabel(event)}
                      </span>
                      {!event.countsForAttendance && (
                        <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-amber-50 text-amber-700">
                          No cuenta
                        </span>
                      )}
                    </p>

                    {event.inviteOnly && event.inviteeIds.length > 0 && (
                      <p
                        className="text-[11px] text-slate-400 truncate"
                        title={inviteeLabel(event)}
                      >
                        {inviteeLabel(event)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Un coordinador de etapa no toca los eventos de 'ambas etapas'. */}
                {canManageEventStage(currentUser, event.stage) ? (
                  <div className="flex items-center shrink-0">
                    <button
                      onClick={() => openEdit(event)}
                      title="Editar evento"
                      className="p-2 text-slate-300 hover:text-indigo-600 transition-colors"
                    >
                      <Pencil size={16} />
                    </button>

                    <button
                      onClick={() => setEventToDelete(event)}
                      title="Eliminar evento"
                      className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                    >
                      <Plus size={18} className="rotate-45" />
                    </button>
                  </div>
                ) : (
                  <span
                    className="p-2 text-slate-200 shrink-0"
                    title="Este evento lo gestiona el coordinador global"
                  >
                    <Lock size={16} />
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

export default AgendaManager;
