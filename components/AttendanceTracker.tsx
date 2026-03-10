
import React, { useState } from 'react';
import { 
  Check, 
  X, 
  Mail, 
  Send,
  MoreVertical,
  Church,
  BookOpen,
  AlertTriangle,
  Clock
} from 'lucide-react';
import { Student, getTodayStr, AttendanceStatus } from '../types';
import { supabase } from "../src/lib/supabaseClient";

interface AttendanceTrackerProps {
  students: Student[];
  onUpdate: (id: string, type: 'catechism' | 'mass', status: AttendanceStatus) => void;
  classDays: string[];
  warningMessage?: string;
  warningType?: "no-group" | "no-students";
  isOnline: boolean;
}

const AttendanceTracker: React.FC<AttendanceTrackerProps> = ({ students, onUpdate, classDays, warningMessage, warningType, isOnline }) => {
  const todayRaw = getTodayStr();
  const todayPretty = new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const isClassDay = classDays.includes(todayRaw);

  const [confirmOne, setConfirmOne] = useState<{
    student: Student;
    absenceLabel: string;
  } | null>(null);

  const [confirmAll, setConfirmAll] = useState<{
    totalTargets: number;
  } | null>(null);

  const [isSendingOne, setIsSendingOne] = useState(false);
  const [isSendingAll, setIsSendingAll] = useState(false);

  const getAbsenceLabel = (cat: AttendanceStatus, mass: AttendanceStatus) => {
    const catAbsent = cat === "absent";
    const massAbsent = mass === "absent";
    if (catAbsent && massAbsent) return "ni a catequesis ni a misa";
    if (catAbsent) return "catequesis";
    return "misa";
  };

  const cycleStatus = (current: AttendanceStatus): AttendanceStatus => {
    if (current === 'absent') return 'present';
    if (current === 'present') return 'late';
    return 'absent';
  };

  const getStatusStyle = (status: AttendanceStatus, activeColor: string) => {
    if (status === 'present') return `${activeColor} text-white shadow-md`;
    if (status === 'late') return `bg-amber-100 text-amber-700 border-2 border-amber-400`;
    return 'bg-slate-100 text-slate-400 hover:bg-slate-200';
  };

  const sendStandardEmailOne = async () => {
    if (!isOnline) {
      alert("No hay conexión. No se puede enviar el email hasta que vuelva internet.");
      return;
    }
    if (!confirmOne) return;

    const st: any = confirmOne.student;
    const parentEmail = st.parent_email || st.parentEmail;
    if (!parentEmail) {
      alert("Este alumno no tiene email de padres (parent_email).");
      setConfirmOne(null);
      return;
    }

    setIsSendingOne(true);
    console.log("SUPABASE URL", import.meta.env.VITE_SUPABASE_URL);
    console.log("SUPABASE ANON KEY exists?", Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY));
    try {
      const { data: { session }, error: sErr } = await supabase.auth.getSession();
      if (sErr || !session?.access_token) {
        alert("No hay sesión válida. Cierra sesión y vuelve a entrar.");
        setIsSendingOne(false);
        return;
      }

      const { error } = await supabase.functions.invoke("send-absence-email", {
        body: {
          student_id: confirmOne.student.id,
          date: todayRaw,
          absence_label: confirmOne.absenceLabel,
        },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) {
        console.log("invoke error", error);
        // supabase-js suele meter details en error.context o error.message; si no, lo vemos por logs
        throw error;
      }

      alert("Email enviado correctamente.");
      setConfirmOne(null);
    } catch (e: any) {
      alert("Error enviando email: " + (e?.message ?? String(e)));
    } finally {
      setIsSendingOne(false);
    }
  };

  const sendStandardEmailAll = async () => {
    if (!isOnline) {
      alert("No hay conexión. No se pueden enviar los emails hasta que vuelva internet.");
      return;
    }
    setIsSendingAll(true);
    try {
      const student_ids = students.map(s => s.id);
      const { data, error } = await supabase.functions.invoke("send-absence-emails-bulk", {
        body: { date: todayRaw, student_ids }
      });
      if (error) throw error;

      // data puede traer resumen: sent, skipped_no_email, errors
      alert(`Proceso terminado. Enviados: ${data?.sent ?? "?"}, sin email: ${data?.skipped_no_email ?? "?"}, errores: ${data?.errors ?? 0}`);
      setConfirmAll(null);
    } catch (e: any) {
      alert("Error en envío masivo: " + (e?.message ?? String(e)));
    } finally {
      setIsSendingAll(false);
    }
  };

  if (!isClassDay) {
    return (
      <div className="flex flex-col items-center justify-center py-20 px-6 text-center animate-in fade-in duration-500">
        <div className="w-16 h-16 lg:w-20 lg:h-20 bg-amber-100 text-amber-600 rounded-2xl lg:rounded-3xl flex items-center justify-center mb-6 shadow-sm">
          <AlertTriangle size={32} />
        </div>
        <h2 className="text-xl lg:text-2xl font-bold text-slate-900">Hoy no es día de clase</h2>
        <p className="text-sm text-slate-500 mt-2 max-w-md">El registro de asistencia solo está disponible en días lectivos. Tan solo el coordinador/a puede modificar qué días son lectivos.</p>
        <p className="text-indigo-600 font-semibold mt-4 text-sm lg:text-base capitalize">{todayPretty}</p>
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
      <div className="bg-gradient-to-r from-indigo-700 to-blue-600 rounded-2xl p-6 lg:p-8 text-white flex items-center justify-between shadow-lg">
        <div>
          <h2 className="text-xl lg:text-2xl font-bold flex items-center gap-2">
            <Church size={24} className="shrink-0" />
            Control Diario
          </h2>
          <p className="text-indigo-100 opacity-90 text-xs lg:text-sm mt-1 capitalize">
            {todayPretty}
          </p>
        </div>
      
        {(() => {
          const targets = students.filter(st => {
            const r = st.attendanceHistory.find(h => h.date === todayRaw);
            const cat = r?.catechism || "absent";
            const ms  = r?.mass || "absent";
            const faltadoAlgo = (cat === "absent" || ms === "absent");
            const hasEmail = Boolean(
              (st as any).parent_email || (st as any).parentEmail
            );
            return faltadoAlgo && hasEmail;
          });

          if (targets.length === 0) return null;

          return (
            <button
              disabled={!isOnline}
              onClick={() => {
                setConfirmAll({ totalTargets: targets.length });
              }}
              className={`font-bold text-[10px] sm:text-xs px-3 py-2 rounded-xl transition-colors border ${
                isOnline
                  ? "bg-white/15 hover:bg-white/25 border-white/20 text-white"
                  : "bg-white/10 border-white/10 text-white/50 cursor-not-allowed"
              }`}
            >
              INFORMAR A TODOS LOS PADRES ({targets.length})
            </button>
          );
        })()}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="w-full overflow-x-hidden">
          <table className="w-full text-left table-fixed">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 lg:px-6 py-4 text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-widest w-[40%] sm:w-[35%]">Alumno</th>
                <th className="px-1 lg:px-6 py-4 text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Cat.</th>
                <th className="px-1 lg:px-6 py-4 text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">Misa</th>
                <th className="px-2 lg:px-6 py-4 text-[9px] sm:text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right w-10 sm:w-auto"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {students.map(student => {
                const record = student.attendanceHistory.find(h => h.date === todayRaw);
                const statusCat = record?.catechism || 'absent';
                const statusMass = record?.mass || 'absent';
                
                const showAviso = statusCat === 'absent' || statusMass === 'absent';
                
                return (
                  <tr key={student.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-3 lg:px-6 py-4">
                      <div className="flex items-center gap-2 lg:gap-3">
                        <div className="w-7 h-7 sm:w-10 sm:h-10 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold overflow-hidden shrink-0 text-[10px] sm:text-sm">
                          {student.photo ? <img src={student.photo} className="w-full h-full object-cover" /> : student.name[0]}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 text-[11px] sm:text-sm truncate">{student.name}</p>
                          <p className="hidden sm:block text-[10px] text-slate-500 truncate">{student.school}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-1 lg:px-6 py-4">
                      <div className="flex justify-center">
                        <button 
                          onClick={() => onUpdate(student.id, 'catechism', cycleStatus(statusCat))}
                          className={`p-1.5 sm:p-3 rounded-lg sm:rounded-xl transition-all flex flex-col items-center gap-0.5 sm:gap-1 w-12 sm:w-24 ${getStatusStyle(statusCat, 'bg-indigo-600')}`}
                        >
                          {statusCat === 'late' ? <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <BookOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                          <span className="text-[7px] sm:text-[8px] font-bold uppercase">{statusCat === 'absent' ? 'NO' : statusCat === 'present' ? 'SÍ' : 'T'}</span>
                        </button>
                      </div>
                    </td>
                    <td className="px-1 lg:px-6 py-4">
                      <div className="flex justify-center">
                        <button 
                          onClick={() => onUpdate(student.id, 'mass', cycleStatus(statusMass))}
                          className={`p-1.5 sm:p-3 rounded-lg sm:rounded-xl transition-all flex flex-col items-center gap-0.5 sm:gap-1 w-12 sm:w-24 ${getStatusStyle(statusMass, 'bg-amber-500')}`}
                        >
                          {statusMass === 'late' ? <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" /> : <Church className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                          <span className="text-[7px] sm:text-[8px] font-bold uppercase">{statusMass === 'absent' ? 'NO' : statusMass === 'present' ? 'SÍ' : 'T'}</span>
                        </button>
                      </div>
                    </td>
                    <td className="px-2 lg:px-6 py-4 text-right">
                      {showAviso && (
                        <button
                          disabled={!isOnline}
                          onClick={() => {
                            const record = student.attendanceHistory.find(h => h.date === todayRaw);
                            const statusCat = record?.catechism || "absent";
                            const statusMass = record?.mass || "absent";
                            const absenceLabel = getAbsenceLabel(statusCat, statusMass);
                            setConfirmOne({ student, absenceLabel });
                          }}
                          className={`p-1.5 rounded-lg transition-colors inline-flex items-center ${
                            isOnline
                              ? "text-indigo-600 hover:bg-indigo-50"
                              : "text-slate-300 cursor-not-allowed"
                          }`}
                          title={isOnline ? "Enviar aviso a los padres" : "Sin conexión"}
                        >
                          <Mail size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {confirmOne && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Confirmar envío</h3>
              <button onClick={() => setConfirmOne(null)} className="text-slate-400 hover:text-slate-600 p-1"><X size={24} /></button>
            </div>

            <div className="p-6 text-sm text-slate-700 space-y-2">
              <p>
                ¿Seguro que quieres enviar un correo a los padres de <span className="font-bold">{confirmOne.student.name}</span>
                {" "}informando de que hoy no ha asistido a <span className="font-bold">{confirmOne.absenceLabel}</span>?
              </p>
              <p className="text-xs text-slate-500">
                Se enviará desde no-reply@sanpas.es (si la configuración del servidor está correcta).
              </p>
            </div>

            <div className="p-6 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setConfirmOne(null)} className="px-6 py-2 rounded-xl text-slate-600 font-bold text-sm">Cancelar</button>
              <button
                onClick={() => void sendStandardEmailOne()}
                disabled={isSendingOne || !isOnline}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold rounded-xl text-sm"
              >
                {isSendingOne ? "Enviando..." : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmAll && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Confirmar envío masivo</h3>
              <button onClick={() => setConfirmAll(null)} className="text-slate-400 hover:text-slate-600 p-1"><X size={24} /></button>
            </div>

            <div className="p-6 text-sm text-slate-700 space-y-2">
              <p>
                ¿Seguro que quieres enviar correos personalizados a todos los padres de los niños que hoy han faltado a algo?
              </p>
              <p className="text-xs text-slate-500">
                Se enviarán <span className="font-bold">{confirmAll.totalTargets}</span> correos personalizados
                (solo a alumnos que hoy han faltado a algo y tienen email de padres registrado).
              </p>
            </div>

            <div className="p-6 bg-slate-50 border-t border-slate-200 flex justify-end gap-3">
              <button onClick={() => setConfirmAll(null)} className="px-6 py-2 rounded-xl text-slate-600 font-bold text-sm">Cancelar</button>
              <button
                onClick={() => void sendStandardEmailAll()}
                disabled={isSendingAll || confirmAll.totalTargets === 0 || !isOnline}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-bold rounded-xl text-sm"
              >
                {isSendingAll ? "Enviando..." : "Enviar a todos"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AttendanceTracker;
