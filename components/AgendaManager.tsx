import React, { useState } from "react";
import { Calendar, Plus } from "lucide-react";
import { ParishEvent } from "../types";

interface AgendaManagerProps {
  events: ParishEvent[];
  onAdd: (e: { title: string; date: string }) => void;
  onRemove: (id: string) => void;
}

const AgendaManager: React.FC<AgendaManagerProps> = ({ events, onAdd, onRemove }) => {
  const [newTitle, setNewTitle] = useState("");
  const [newDateTime, setNewDateTime] = useState("");
  const [eventToDelete, setEventToDelete] = useState<ParishEvent | null>(null);

  const handleAdd = () => {
    if (!newTitle || !newDateTime) return;

    onAdd({
      title: newTitle,
      date: newDateTime,
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

          <div className="flex flex-col sm:flex-row gap-4">
            <input
              type="text"
              placeholder="Título"
              className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />

            <input
              type="datetime-local"
              className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl w-full sm:w-auto max-w-full"
              value={newDateTime}
              onChange={(e) => setNewDateTime(e.target.value)}
            />

            <button
              onClick={handleAdd}
              className="w-full sm:w-auto p-2 bg-indigo-600 text-white rounded-xl flex items-center justify-center"
            >
              <Plus size={24} />
            </button>
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
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => setEventToDelete(event)}
                  className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                >
                  <Plus size={18} className="rotate-45" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

export default AgendaManager;