import React, { useEffect, useMemo, useState } from "react";
import { Calendar, Check, Lock, Plus, Search, UserCheck, Users } from "lucide-react";
import { ParishEvent, User } from "../types";
import { normalizeSearchText } from "../src/utils/text";
import {
  ALL_GRADES,
  EventGrade,
  EventStage,
  GRADE_LABELS,
  STAGE_LABELS,
  canManageEventStage,
  getEventAudienceLabel,
  isGlobalCoordinator,
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
  onRemove: (id: string) => void;
}

const AgendaManager: React.FC<AgendaManagerProps> = ({
  currentUser,
  events,
  users,
  onAdd,
  onRemove,
}) => {
  const isGlobal = isGlobalCoordinator(currentUser);

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
  const [inviteeQuery, setInviteeQuery] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [eventToDelete, setEventToDelete] = useState<ParishEvent | null>(null);

  // El aviso de "evento creado" se va solo: si se quedara fijo, al rato ya no
  // se sabría a qué evento se refiere.
  useEffect(() => {
    if (!created) return;

    const timer = window.setTimeout(() => setCreated(null), 8000);
    return () => window.clearTimeout(timer);
  }, [created]);

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

  const filteredCandidates = useMemo(() => {
    const query = normalizeSearchText(inviteeQuery);
    if (!query) return candidates;
    return candidates.filter((u) => normalizeSearchText(u.name).includes(query));
  }, [candidates, inviteeQuery]);

  const nameById = useMemo(
    () => new Map(users.map((u) => [u.id, u.name])),
    [users]
  );

  const toggleInvitee = (id: string) =>
    setInviteeIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
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
    setInviteeQuery("");
  };

  const handleAdd = async () => {
    if (!canAdd || isSaving) return;

    // El formulario se limpia DESPUÉS de saber que el evento está creado: si
    // falla, el coordinador no tiene que volver a escribirlo todo.
    const titleCreated = newTitle;
    const dateCreated = newDateTime;

    setIsSaving(true);
    setCreated(null);

    const ok = await onAdd({
      title: newTitle,
      date: newDateTime,
      stage,
      grade,
      inviteOnly,
      countsForAttendance: inviteOnly ? countsForAttendance : true,
      inviteeIds: inviteOnly ? inviteeIds : [],
    });

    setIsSaving(false);

    if (!ok) return;

    resetForm();
    setCreated(`${titleCreated} · ${formatDateTime(dateCreated)}`);
  };

  /** Invitados de un evento, con los nombres que este usuario pueda leer. */
  const inviteeLabel = (event: ParishEvent): string =>
    event.inviteeIds
      .map((id) => nameById.get(id) ?? "¿?")
      .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }))
      .join(", ");

  return (
    <>
      {eventToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-slate-800 mb-3">
              Eliminar evento
            </h3>

            <p className="text-slate-600 mb-6">
              ¿Seguro que quieres eliminar el evento
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

      <div className="space-y-6 max-w-2xl mx-auto">
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-bold text-slate-800 mb-4">Añadir Nuevo Evento</h3>

          {created && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              <Check size={16} className="mt-0.5 shrink-0" />
              <span>
                Evento creado: <span className="font-bold">{created}</span>
              </span>
            </div>
          )}

          {/* Dos clases de evento: el de siempre, dirigido a una etapa y un
              curso, y el específico, que solo les llega a los invitados. */}
          <div className="flex gap-2 mb-4">
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

              {!inviteOnly &&
                (fixedStage ? (
                  <div
                    className="px-4 py-2 bg-slate-100 border border-slate-200 rounded-xl text-sm text-slate-600 flex items-center gap-2 w-full sm:w-auto sm:flex-1 sm:min-w-[150px]"
                    title="Solo puedes crear eventos de tu etapa"
                  >
                    <Lock size={14} className="text-slate-400 shrink-0" />
                    {STAGE_LABELS[fixedStage]}
                  </div>
                ) : (
                  <select
                    className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm w-full sm:w-auto sm:flex-1 sm:min-w-[150px]"
                    value={newStage}
                    onChange={(e) => setNewStage(e.target.value as EventStage)}
                    title="¿A qué etapa afecta el evento?"
                  >
                    <option value="all">{STAGE_LABELS.all}</option>
                    <option value="preconfirmation">{STAGE_LABELS.preconfirmation}</option>
                    <option value="confirmation">{STAGE_LABELS.confirmation}</option>
                  </select>
                ))}

              {/* Un evento de "ambas etapas" es para todo el mundo: elegir un
                  curso dentro de las dos no tendría sentido. */}
              {!inviteOnly && (
                <select
                  className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm w-full sm:w-auto sm:flex-1 sm:min-w-[150px] disabled:bg-slate-100 disabled:text-slate-400"
                  value={grade}
                  disabled={stage === "all"}
                  onChange={(e) => setNewGrade(Number(e.target.value) as EventGrade)}
                  title={
                    stage === "all"
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
              )}

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

            {inviteOnly && (
              <div className="space-y-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">
                    Invitados · {inviteeIds.length}
                  </span>
                  {inviteeIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setInviteeIds([])}
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
                    value={inviteeQuery}
                    onChange={(e) => setInviteeQuery(e.target.value)}
                  />
                </div>

                <div className="max-h-56 overflow-y-auto rounded-xl bg-white border border-slate-200 divide-y divide-slate-50">
                  {filteredCandidates.map((u) => {
                    const checked = inviteeIds.includes(u.id);

                    return (
                      <label
                        key={u.id}
                        className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-indigo-600 shrink-0"
                          checked={checked}
                          onChange={() => toggleInvitee(u.id)}
                        />
                        <span className="text-sm text-slate-700 truncate">{u.name}</span>
                      </label>
                    );
                  })}

                  {filteredCandidates.length === 0 && (
                    <p className="px-3 py-4 text-xs text-slate-400 text-center">
                      Nadie con ese nombre.
                    </p>
                  )}
                </div>

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
            <h3 className="font-bold text-slate-800">Eventos Activos</h3>
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

                {/* Un coordinador de etapa no borra los eventos de 'ambas etapas'. */}
                {canManageEventStage(currentUser, event.stage) ? (
                  <button
                    onClick={() => setEventToDelete(event)}
                    className="p-2 text-slate-300 hover:text-red-500 transition-colors shrink-0"
                  >
                    <Plus size={18} className="rotate-45" />
                  </button>
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
