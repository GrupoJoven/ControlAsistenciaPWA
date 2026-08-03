import React, { useMemo, useState } from "react";
import { Download, X } from "lucide-react";
import { Group, Student } from "../types";
import { AcademicYear } from "../src/utils/academicYear";
import {
  buildAttendanceCsv,
  buildAttendanceFileName,
  downloadCsv,
} from "../src/utils/exportAttendance";

type Variant = "primary" | "onDark" | "subtle";

interface AttendanceDownloadButtonProps {
  /** Alumnos incluidos en la descarga. El llamante ya los filtra según el rol. */
  students: Student[];
  classDays: string[];
  groups: Group[];
  availableYears: AcademicYear[];
  /** Curso preseleccionado en el diálogo. */
  selectedYear: AcademicYear;
  /** Nombre del grupo o del alumno, usado en el nombre del fichero. */
  scopeLabel: string;
  buttonLabel?: string;
  variant?: Variant;
  className?: string;
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-indigo-600 text-white hover:bg-indigo-700 border border-indigo-600",
  onDark:
    "bg-white/15 hover:bg-white/25 border border-white/20 text-white",
  subtle:
    "bg-white text-slate-700 border border-slate-200 hover:bg-slate-50",
};

const ALL_YEARS = "all";

const AttendanceDownloadButton: React.FC<AttendanceDownloadButtonProps> = ({
  students,
  classDays,
  groups,
  availableYears,
  selectedYear,
  scopeLabel,
  buttonLabel = "Descargar histórico",
  variant = "subtle",
  className = "",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [choice, setChoice] = useState<string>(selectedYear.key);

  const handleOpen = (event: React.MouseEvent) => {
    event.stopPropagation();
    setChoice(selectedYear.key);
    setIsOpen(true);
  };

  const yearsToExport = useMemo(() => {
    if (choice === ALL_YEARS) return availableYears;

    const found = availableYears.find((year) => year.key === choice);
    return found ? [found] : [selectedYear];
  }, [choice, availableYears, selectedYear]);

  /** Días lectivos que caerán en el fichero, para avisar si no hay nada que descargar. */
  const classDayCount = useMemo(() => {
    return yearsToExport.reduce((total, year) => {
      return (
        total +
        classDays.filter((day) => day >= year.start && day <= year.end).length
      );
    }, 0);
  }, [yearsToExport, classDays]);

  const hasData = students.length > 0 && classDayCount > 0;

  const handleDownload = () => {
    const csv = buildAttendanceCsv({
      students,
      classDays,
      groups,
      years: yearsToExport,
    });

    const fileName = buildAttendanceFileName(
      scopeLabel,
      choice === ALL_YEARS ? null : yearsToExport[0]
    );

    downloadCsv(fileName, csv);
    setIsOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={`font-bold text-[11px] sm:text-xs px-4 py-2 rounded-xl transition-colors flex items-center gap-2 ${VARIANT_CLASSES[variant]} ${className}`}
        title="Descargar el histórico de asistencia en CSV"
      >
        <Download size={16} />
        {buttonLabel}
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setIsOpen(false)}
          />

          <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 bg-slate-50 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-lg font-extrabold text-slate-900">
                  Descargar histórico
                </h3>
                <p className="text-sm text-slate-500 mt-1 truncate">
                  {scopeLabel}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-2 rounded-full hover:bg-slate-200 text-slate-500 shrink-0"
              >
                <X size={18} />
              </button>
            </div>

            <div className="px-6 py-6 space-y-4">
              <label className="block">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                  Periodo
                </span>

                <select
                  className="mt-2 w-full px-4 py-3 border border-slate-200 rounded-2xl bg-white text-sm font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={choice}
                  onChange={(event) => setChoice(event.target.value)}
                >
                  {availableYears.map((year) => (
                    <option key={year.key} value={year.key}>
                      {year.label}
                    </option>
                  ))}
                  <option value={ALL_YEARS}>Todo el histórico</option>
                </select>
              </label>

              <p className="text-xs text-slate-500">
                Se descarga un CSV con una fila por alumno y día lectivo, listo
                para abrir en Excel. Los días sin lista pasada aparecen como
                ausencia y se marcan en la columna{" "}
                <span className="font-semibold">Con registro</span>.
              </p>

              <div className="rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-700">
                <span className="font-bold">{students.length}</span> alumno
                {students.length === 1 ? "" : "s"} ·{" "}
                <span className="font-bold">{classDayCount}</span> día
                {classDayCount === 1 ? "" : "s"} lectivo
                {classDayCount === 1 ? "" : "s"}
              </div>

              {!hasData && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  No hay datos para el periodo seleccionado.
                </div>
              )}
            </div>

            <div className="px-6 py-5 border-t border-slate-100 flex flex-col sm:flex-row gap-3 sm:justify-end">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-5 py-3 rounded-2xl border border-slate-200 bg-white text-slate-700 font-bold hover:bg-slate-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                disabled={!hasData}
                onClick={handleDownload}
                className={`px-5 py-3 rounded-2xl font-extrabold flex items-center justify-center gap-2 ${
                  hasData
                    ? "bg-indigo-600 text-white hover:bg-indigo-700"
                    : "bg-slate-200 text-slate-500 cursor-not-allowed"
                }`}
              >
                <Download size={18} />
                Descargar CSV
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AttendanceDownloadButton;
