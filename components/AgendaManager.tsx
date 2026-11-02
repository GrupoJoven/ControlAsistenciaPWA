import React, { useState } from "react";
import { Calendar, Lock, Plus } from "lucide-react";
import { ParishEvent, User } from "../types";
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
  onAdd: (e: { title: string; date: string; stage: EventStage; grade: EventGrade }) => void;
  onRemove: (id: string) => void;
}

const AgendaManager: React.FC<AgendaManagerProps> = ({ currentUser, events, onAdd, onRemove }) => {
  const isGlobal = isGlobalCoordinator(currentUser);

  // El coordinador global elige a quién afecta el evento; el de etapa solo
  // puede crear eventos de la suya (RLS lo impone igualmente).
  const fixedStage: EventStage | null = isGlobal ? null : (currentUser.stage ?? null);

  const [newTitle, setNewTitle] = useState("");
  const [newDateTime, setNewDateTime] = useState("");
  const [newStage, setNewStage] = useState<EventStage>(fixedStage ?? "all");
  const [newGrade, setNewGrade] = useState<EventGrade>(0);
  const [eventToDelete, setEventToDelete] = useState<ParishEvent | null>(null);

  const stage = fixedStage ?? newStage;

  // Un evento de un solo curso lo es de un curso de UNA etapa: no hay eventos
  // para los primeros de las dos a la vez, serían dos eventos distintos.
  const grade: EventGrade = stage === "all" ? 0 : newGrade;

  const handleAdd = () => {
    if (!newTitle || !newDateTime) return;

    onAdd({
      title: newTitle,
      date: newDateTime,
      stage,
      grade,
    });

    setNewTitle("");
    setNewDateTime("");
  };

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
              <span className="font-semibold">
                {" "}
                {new Date(eventToDelete.date).toLocaleString("es-ES", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
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

              {fixedStage ? (
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
              )}

              {/* Un evento de "ambas etapas" es para todo el mundo: elegir un
                  curso dentro de las dos no tendría sentido. */}
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

              <button
                onClick={handleAdd}
                className="w-full sm:w-auto p-2 bg-indigo-600 text-white rounded-xl flex items-center justify-center shrink-0"
              >
                <Plus size={24} />
              </button>
            </div>
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
                className="p-4 flex items-center justify-between hover:bg-slate-50"
              >
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                    <Calendar size={18} />
                  </div>

                  <div>
                    <p className="font-semibold text-slate-900">{event.title}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(event.date).toLocaleString("es-ES", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      <span
                        className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                          isTargetedEvent(event)
                            ? "bg-indigo-50 text-indigo-600"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {getEventAudienceLabel(event)}
                      </span>
                    </p>
                  </div>
                </div>

                {/* Un coordinador de etapa no borra los eventos de 'ambas etapas'. */}
                {canManageEventStage(currentUser, event.stage) ? (
                  <button
                    onClick={() => setEventToDelete(event)}
                    className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                  >
                    <Plus size={18} className="rotate-45" />
                  </button>
                ) : (
                  <span
                    className="p-2 text-slate-200"
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