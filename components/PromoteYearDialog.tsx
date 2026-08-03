import React, { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Download, Loader2, Trash2, X } from "lucide-react";
import { Group, Student } from "../types";
import { buildPromotionPreview } from "../src/utils/coursePromotion";
import { listAcademicYears } from "../src/utils/academicYear";
import {
  buildAttendanceCsv,
  buildAttendanceFileName,
  downloadCsv,
} from "../src/utils/exportAttendance";

interface PromoteYearDialogProps {
  groups: Group[];
  students: Student[];
  classDays: string[];
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

const PromoteYearDialog: React.FC<PromoteYearDialogProps> = ({
  groups,
  students,
  classDays,
  onClose,
  onConfirm,
}) => {
  const [hasDownloaded, setHasDownloaded] = useState(false);
  const [hasVerifiedBackup, setHasVerifiedBackup] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(
    () => buildPromotionPreview(groups, students),
    [groups, students]
  );

  const academicYears = useMemo(() => {
    const attendanceDates = students.flatMap((student) =>
      (student.attendanceHistory ?? []).map((h) => h.date)
    );
    return listAcademicYears(classDays, attendanceDates);
  }, [classDays, students]);

  const hasGraduating = preview.graduatingStudents.length > 0;

  // Sin alumnos que dar de baja no hay copia que hacer, así que no se exige.
  const backupReady = !hasGraduating || (hasDownloaded && hasVerifiedBackup);

  const handleDownload = () => {
    const csv = buildAttendanceCsv({
      students: preview.graduatingStudents,
      classDays,
      groups,
      years: academicYears,
    });

    downloadCsv(buildAttendanceFileName("bajas_2_confirmacion", null), csv);
    setHasDownloaded(true);
  };

  const handleConfirm = async () => {
    setIsRunning(true);
    setError(null);

    try {
      await onConfirm();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo completar la promoción de curso.");
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border-2 border-red-300 overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 bg-red-600 text-white flex items-start justify-between gap-4 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <AlertTriangle size={28} className="shrink-0 mt-0.5" />
            <div>
              <h3 className="text-xl font-extrabold">Vas a promocionar el curso</h3>
              <p className="text-red-50 text-sm mt-1">
                Esta operación borra datos de forma permanente y no se puede deshacer.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isRunning}
            className="p-2 rounded-full hover:bg-white/20 shrink-0 disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-6 space-y-6 overflow-y-auto">
          {/* --- Bajas permanentes --- */}
          <section className="rounded-2xl border-2 border-red-200 bg-red-50 p-5">
            <h4 className="font-extrabold text-red-800 flex items-center gap-2">
              <Trash2 size={18} />
              Se eliminarán de forma permanente
            </h4>

            {hasGraduating ? (
              <>
                <p className="text-sm text-red-900 mt-3">
                  Los <span className="font-bold">{preview.graduatingStudents.length} alumnos</span>{" "}
                  de {preview.graduatingGroups.length} grupo
                  {preview.graduatingGroups.length === 1 ? "" : "s"} de 2º CONFIRMACIÓN
                  terminan la catequesis. Se borrarán ellos y{" "}
                  <span className="font-bold">todos</span> sus datos asociados:
                </p>

                <ul className="text-sm text-red-900 mt-3 space-y-1 list-disc list-inside">
                  <li>
                    <span className="font-bold">{preview.attendanceRecords}</span> registros de
                    asistencia
                  </li>
                  <li>Incidencias, servicios de misa y accesos públicos</li>
                  <li>Fotos de perfil almacenadas</li>
                  <li>
                    Los propios grupos, ya vacíos, y sus catequistas asignados
                  </li>
                </ul>

                <div className="mt-4 flex flex-wrap gap-2">
                  {preview.graduatingGroups.map((group) => (
                    <span
                      key={group.id}
                      className="px-3 py-1.5 rounded-xl bg-white border border-red-300 text-red-800 text-xs font-bold"
                    >
                      {group.name}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-red-900 mt-3">
                No hay ningún grupo de 2º CONFIRMACIÓN, así que no se dará de baja a ningún
                alumno.
              </p>
            )}
          </section>

          {/* --- Renombrados --- */}
          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <h4 className="font-extrabold text-slate-800">
              Los demás grupos suben de nivel ({preview.renames.length})
            </h4>

            <div className="mt-3 space-y-1.5 max-h-48 overflow-y-auto">
              {preview.renames.map(({ group, nextName }) => (
                <div
                  key={group.id}
                  className="flex items-center gap-2 text-sm bg-white rounded-xl border border-slate-200 px-3 py-2"
                >
                  <span className="text-slate-500 truncate">{group.name}</span>
                  <ArrowRight size={14} className="text-slate-400 shrink-0" />
                  <span className="font-bold text-slate-900 truncate">{nextName}</span>
                </div>
              ))}
            </div>
          </section>

          {/* --- Copia de seguridad --- */}
          {hasGraduating && (
            <section className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-5">
              <h4 className="font-extrabold text-amber-900">
                Antes de continuar, guarda el histórico
              </h4>
              <p className="text-sm text-amber-900 mt-2">
                Una vez borrados, estos datos no se pueden recuperar. Descarga el histórico
                completo de asistencia de los alumnos que se dan de baja.
              </p>

              <button
                type="button"
                onClick={handleDownload}
                disabled={isRunning}
                className={`mt-4 w-full px-5 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 transition-colors ${
                  hasDownloaded
                    ? "bg-white text-amber-800 border-2 border-amber-400"
                    : "bg-amber-500 text-white hover:bg-amber-600"
                }`}
              >
                <Download size={18} />
                {hasDownloaded ? "Descargar de nuevo" : "Descargar histórico (CSV)"}
              </button>

              <label
                className={`mt-4 flex items-start gap-3 text-sm ${
                  hasDownloaded ? "text-amber-900 cursor-pointer" : "text-amber-900/50"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-0.5 w-5 h-5 shrink-0 accent-red-600"
                  checked={hasVerifiedBackup}
                  disabled={!hasDownloaded || isRunning}
                  onChange={(e) => setHasVerifiedBackup(e.target.checked)}
                />
                <span>
                  He abierto el fichero descargado y he comprobado que contiene los datos
                  correctamente.
                </span>
              </label>
            </section>
          )}

          {error && (
            <div className="rounded-2xl border-2 border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
              <span className="font-bold">No se ha promocionado nada.</span> {error}
            </div>
          )}
        </div>

        {/* --- Acciones: cancelar a la derecha y destacado --- */}
        <div className="px-6 py-5 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row gap-3 sm:items-center shrink-0">
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={!backupReady || isRunning}
            className={`order-2 sm:order-1 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors flex items-center justify-center gap-2 ${
              backupReady && !isRunning
                ? "bg-white text-red-700 border-red-300 hover:bg-red-50"
                : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
            }`}
          >
            {isRunning && <Loader2 size={16} className="animate-spin" />}
            {isRunning ? "Promocionando..." : "Sí, promocionar y borrar"}
          </button>

          <div className="order-1 sm:order-2 flex-1" />

          <button
            type="button"
            onClick={onClose}
            disabled={isRunning}
            autoFocus
            className="order-3 px-8 py-4 rounded-2xl bg-slate-800 text-white font-extrabold text-base hover:bg-slate-900 shadow-lg disabled:opacity-50 sm:min-w-[200px]"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromoteYearDialog;
