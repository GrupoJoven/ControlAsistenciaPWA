import React, { useEffect, useState } from "react";
import { supabase } from "../src/lib/supabaseClient";
import { Student } from "../types";

type ServiceType = "B" | "L" | "P";

type Props = {
  currentUser: { id: string; role: string; name?: string } | null;
  students: Student[];
  warningMessage?: string;
  warningType?: "no-group" | "no-students";
  isOnline: boolean;
};

type MassServiceRow = {
  student_id: string;
  service_type: ServiceType;
};

const SERVICES: { key: ServiceType; label: ServiceType; onClasses: string }[] = [
  { key: "B", label: "B", onClasses: "bg-amber-700 text-white border-amber-700" }, // marrón
  { key: "L", label: "L", onClasses: "bg-yellow-400 text-slate-900 border-yellow-500" }, // amarillo
  { key: "P", label: "P", onClasses: "bg-emerald-600 text-white border-emerald-600" }, // verde
];

function offClasses() {
  return "bg-slate-100 text-slate-400 border-slate-200";
}

const ServicesManagement: React.FC<Props> = ({ currentUser, students, warningMessage, warningType, isOnline }) => {

  // studentId -> Set("B"|"L"|"P")
  const [doneByStudent, setDoneByStudent] = useState<Map<string, Set<ServiceType>>>(new Map());
  const [expandedStudentId, setExpandedStudentId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [togglingKey, setTogglingKey] = useState<string | null>(null); // `${studentId}-${serviceType}`

  // Carga servicios (para HOY) de los students visibles
  useEffect(() => {
    const run = async () => {
      // Si no hay students (o hay warning), no hace falta pegar a supabase
      if (!students || students.length === 0) {
        setDoneByStudent(new Map());
        return;
      }

      if (!isOnline) {
        setDoneByStudent(new Map());
        return;
      }
      setLoading(true);
      try {
        const ids = students.map(s => s.id);

        const { data, error } = await supabase
          .from("mass_services")
          .select("student_id, service_type")
          .in("student_id", ids);

        if (error) throw error;

        const map = new Map<string, Set<ServiceType>>();
        for (const s of students) map.set(s.id, new Set<ServiceType>());

        for (const r of (data ?? []) as MassServiceRow[]) {
          const set = map.get(r.student_id) ?? new Set<ServiceType>();
          set.add(r.service_type);
          map.set(r.student_id, set);
        }

        setDoneByStudent(map);
      } catch (e: any) {
        console.error(e);
        alert(e?.message ?? "Error cargando servicios");
        setDoneByStudent(new Map());
      } finally {
        setLoading(false);
      }
    };

    void run();
  }, [students]);

  const isOn = (studentId: string, serviceType: ServiceType) => {
    const set = doneByStudent.get(studentId);
    return !!set?.has(serviceType);
  };

  const toggleService = async (studentId: string, serviceType: ServiceType) => {
    if (!isOnline) {
      alert("No hay conexión. No se pueden modificar los servicios hasta que vuelva internet.");
      return;
    }
    if (!currentUser) return;

    const key = `${studentId}-${serviceType}`;
    if (togglingKey) return; // evita dobles clicks
    setTogglingKey(key);

    const prev = new Map(doneByStudent);
    const prevSet = new Set(prev.get(studentId) ?? []);
    const nextSet = new Set(prevSet);

    const currentlyOn = nextSet.has(serviceType);

    // Optimista
    if (currentlyOn) nextSet.delete(serviceType);
    else nextSet.add(serviceType);

    const optimistic = new Map(prev);
    optimistic.set(studentId, nextSet);
    setDoneByStudent(optimistic);

    try {
      if (!currentlyOn) {
        const { error } = await supabase.from("mass_services").insert({
          student_id: studentId,
          service_type: serviceType,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("mass_services")
          .delete()
          .eq("student_id", studentId)
          .eq("service_type", serviceType);
        if (error) throw error;
      }
    } catch (e: any) {
      console.error(e);
      // Rollback
      setDoneByStudent(prev);
      alert(e?.message ?? "Error guardando servicio");
    } finally {
      setTogglingKey(null);
    }
  };

  const canInteract = (studentId: string) => expandedStudentId === studentId;

  const WarningBox = () => {
    if (!warningMessage) return null;

    const cls =
      warningType === "no-group"
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : warningType === "no-students"
        ? "border-indigo-200 bg-indigo-50 text-indigo-900"
        : "border-slate-200 bg-slate-50 text-slate-800";

    return (
      <div className={`p-4 rounded-2xl border ${cls} text-sm`}>
        <span className="font-bold">Aviso:</span> {warningMessage}
      </div>
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <WarningBox />
      {!isOnline && (
        <div className="p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-sm">
          <span className="font-bold">Modo sin conexión:</span> puedes consultar los alumnos, pero no modificar los servicios de misa hasta que vuelva internet.
        </div>
      )}
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Servicios de misa</h2>
            <p className="text-sm text-slate-500">
              Marca lo que ha hecho cada niño/a en la misa: Bandejas (B), Lecturas (L) o Peticiones (P).
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {students.length === 0 && !warningMessage && (
          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm text-slate-600">
            No hay catecúmenos para mostrar.
          </div>
        )}

        {students.map((st) => {
          const expanded = expandedStudentId === st.id;

          return (
            <div
              key={st.id}
              className={`bg-white rounded-3xl border border-slate-200 shadow-sm transition-all ${
                expanded ? "p-6" : "p-4 hover:bg-slate-50 cursor-pointer"
              }`}
              onClick={() => setExpandedStudentId(prev => (prev === st.id ? null : st.id))}
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden shrink-0">
                  {st.photo ? (
                    <img src={st.photo} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-slate-600 font-bold">{(st.name?.[0] ?? "?").toUpperCase()}</span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900 truncate">{st.name}</p>
                  <p className="text-xs text-slate-500">
                    {expanded ? "Pulsa los cuadrados para marcar o desmarcar" : "Pulsa para gestionar"}
                  </p>
                </div>

                {loading && (
                  <div className="text-xs text-slate-400 bg-slate-100 px-3 py-2 rounded-xl">
                    Cargando...
                  </div>
                )}
              </div>

              <div className={`mt-4 flex gap-3 ${expanded ? "" : ""}`}>
                {SERVICES.map((svc) => {
                  const on = isOn(st.id, svc.key);
                  const clickable = canInteract(st.id);
                  const busy = togglingKey === `${st.id}-${svc.key}`;

                  return (
                    <button
                      key={svc.key}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!clickable) return;
                        void toggleService(st.id, svc.key);
                      }}
                      disabled={!isOnline || !clickable || !!togglingKey}
                      className={[
                        "w-11 h-11 rounded-xl border font-bold flex items-center justify-center transition-all select-none",
                        on ? svc.onClasses : offClasses(),
                        isOnline && clickable ? "hover:scale-[1.02]" : "opacity-80 cursor-default",
                        !isOnline ? "opacity-60" : "",
                        busy ? "opacity-60" : "",
                      ].join(" ")}
                      title={
                        !isOnline
                          ? "Sin conexión"
                          : clickable
                            ? on
                              ? `Quitar ${svc.label}`
                              : `Marcar ${svc.label}`
                            : "Abre la tarjeta para editar"
                      }
                    >
                      {svc.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ServicesManagement;