import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Download,
  FileSpreadsheet,
  Loader2,
  Upload,
  UserPlus,
  X,
} from "lucide-react";
import { Group, User } from "../types";
import {
  ImportIssue,
  ImportedStudent,
  REQUIRED_COLUMNS,
  buildTemplateCsv,
  parseStudentFile,
} from "../src/utils/studentImport";
import { downloadCsv } from "../src/utils/exportAttendance";

/** Prefijos admitidos. Deben coincidir con los de create_group_with_students(). */
const VALID_PREFIXES = [
  "1º PRECONFIRMACIÓN",
  "2º PRECONFIRMACIÓN",
  "1º CONFIRMACIÓN",
  "2º CONFIRMACIÓN",
];

interface ImportGroupDialogProps {
  groups: Group[];
  catechists: User[];
  onClose: () => void;
  onCreate: (
    name: string,
    catechistIds: string[],
    students: ImportedStudent[]
  ) => Promise<void>;
}

const ImportGroupDialog: React.FC<ImportGroupDialogProps> = ({
  groups,
  catechists,
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState("");
  const [selectedCatechistIds, setSelectedCatechistIds] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [students, setStudents] = useState<ImportedStudent[]>([]);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();

  const nameError = useMemo(() => {
    if (trimmedName === "") return null; // Todavía no ha escrito nada: no se regaña.

    if (!VALID_PREFIXES.some((prefix) => trimmedName.startsWith(prefix))) {
      return `Debe empezar por ${VALID_PREFIXES.join(", ")}.`;
    }

    const exists = groups.some(
      (group) => group.name.trim().toUpperCase() === trimmedName.toUpperCase()
    );
    if (exists) return "Ya existe un grupo con ese nombre.";

    return null;
  }, [trimmedName, groups]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;

    setIsParsing(true);
    setError(null);
    setFileName(file.name);

    try {
      const result = await parseStudentFile(file);
      setStudents(result.students);
      setIssues(result.issues);
    } catch (e: any) {
      setStudents([]);
      setIssues([{ row: 1, message: e?.message ?? "No se pudo leer el fichero." }]);
    } finally {
      setIsParsing(false);
    }
  };

  const toggleCatechist = (id: string) => {
    setSelectedCatechistIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const canCreate =
    trimmedName !== "" &&
    !nameError &&
    selectedCatechistIds.length > 0 &&
    students.length > 0 &&
    issues.length === 0 &&
    !isParsing &&
    !isCreating;

  const handleCreate = async () => {
    setIsCreating(true);
    setError(null);

    try {
      await onCreate(trimmedName, selectedCatechistIds, students);
    } catch (e: any) {
      setError(e?.message ?? "No se pudo crear el grupo.");
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-6 py-5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-4 shrink-0">
          <h3 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
            <UserPlus size={22} className="text-indigo-600" />
            Crear grupo nuevo
          </h3>

          <button
            type="button"
            onClick={onClose}
            disabled={isCreating}
            className="p-2 rounded-full hover:bg-slate-200 text-slate-500 disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-6 space-y-6 overflow-y-auto">
          {/* --- Nombre --- */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
              Nombre del grupo
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="1º PRECONFIRMACIÓN (A)"
              className={`mt-2 w-full px-4 py-3 border rounded-2xl text-sm font-semibold outline-none focus:ring-2 ${
                nameError
                  ? "border-red-300 focus:ring-red-400"
                  : "border-slate-200 focus:ring-indigo-500"
              }`}
            />
            {nameError ? (
              <p className="text-xs text-red-600 mt-2 font-semibold">{nameError}</p>
            ) : (
              <p className="text-xs text-slate-500 mt-2">
                Los espacios sobrantes al principio y al final se quitan solos.
              </p>
            )}
          </div>

          {/* --- Catequistas --- */}
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
              Catequistas asignados ({selectedCatechistIds.length})
            </label>

            <div className="mt-2 border border-slate-200 rounded-2xl max-h-44 overflow-y-auto divide-y divide-slate-100">
              {catechists.length === 0 && (
                <p className="px-4 py-3 text-sm text-slate-500">No hay catequistas disponibles.</p>
              )}

              {catechists.map((catechist) => {
                const selected = selectedCatechistIds.includes(catechist.id);

                return (
                  <button
                    key={catechist.id}
                    type="button"
                    onClick={() => toggleCatechist(catechist.id)}
                    className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-slate-50 text-left"
                  >
                    <span className="text-sm font-semibold text-slate-800 truncate">
                      {catechist.name || catechist.email}
                    </span>

                    <span
                      className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 border ${
                        selected
                          ? "bg-indigo-600 border-indigo-600 text-white"
                          : "border-slate-300"
                      }`}
                    >
                      {selected && <Check size={14} />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* --- Fichero --- */}
          <div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">
                Fichero de alumnos
              </label>

              <button
                type="button"
                onClick={() => downloadCsv("plantilla_alumnos.csv", buildTemplateCsv())}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
              >
                <Download size={14} />
                Descargar plantilla
              </button>
            </div>

            <label className="mt-2 flex flex-col items-center justify-center gap-2 px-4 py-8 border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/40 transition-colors">
              <input
                type="file"
                accept=".csv,.xlsx"
                className="hidden"
                onChange={(e) => void handleFile(e.target.files?.[0])}
              />

              {isParsing ? (
                <Loader2 size={28} className="text-indigo-500 animate-spin" />
              ) : fileName ? (
                <FileSpreadsheet size={28} className="text-indigo-600" />
              ) : (
                <Upload size={28} className="text-slate-400" />
              )}

              <span className="text-sm font-semibold text-slate-700">
                {fileName ?? "Selecciona un fichero .csv o .xlsx"}
              </span>

              <span className="text-xs text-slate-500 text-center">
                Columnas: {REQUIRED_COLUMNS.join(", ")}
              </span>
            </label>
          </div>

          {/* --- Resultado del análisis --- */}
          {issues.length > 0 && (
            <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-4">
              <p className="font-extrabold text-red-800 flex items-center gap-2 text-sm">
                <AlertTriangle size={16} />
                {issues.length} problema{issues.length === 1 ? "" : "s"} en el fichero. No se
                importará nada hasta corregirlo.
              </p>

              <ul className="mt-3 space-y-1 max-h-48 overflow-y-auto text-sm text-red-900">
                {issues.slice(0, 50).map((issue, i) => (
                  <li key={i}>
                    <span className="font-bold">Fila {issue.row}</span>
                    {issue.column ? ` · ${issue.column}` : ""} — {issue.message}
                  </li>
                ))}
                {issues.length > 50 && (
                  <li className="font-bold">…y {issues.length - 50} más.</li>
                )}
              </ul>
            </div>
          )}

          {students.length > 0 && issues.length === 0 && (
            <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-4">
              <p className="font-extrabold text-emerald-800 text-sm flex items-center gap-2">
                <Check size={16} />
                {students.length} alumno{students.length === 1 ? "" : "s"} listos para importar
              </p>

              <div className="mt-3 max-h-40 overflow-y-auto text-sm text-emerald-900 space-y-1">
                {students.slice(0, 10).map((student, i) => (
                  <div key={i} className="truncate">
                    {student.name}
                    {student.dni ? ` · ${student.dni}` : ""}
                  </div>
                ))}
                {students.length > 10 && (
                  <div className="font-bold">…y {students.length - 10} más.</div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-2xl border-2 border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
              <span className="font-bold">No se ha creado nada.</span> {error}
            </div>
          )}
        </div>

        <div className="px-6 py-5 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row gap-3 sm:justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isCreating}
            className="px-5 py-3 rounded-2xl border border-slate-200 bg-white text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-50"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={!canCreate}
            className={`px-6 py-3 rounded-2xl font-extrabold flex items-center justify-center gap-2 ${
              canCreate
                ? "bg-indigo-600 text-white hover:bg-indigo-700"
                : "bg-slate-200 text-slate-500 cursor-not-allowed"
            }`}
          >
            {isCreating && <Loader2 size={16} className="animate-spin" />}
            {isCreating ? "Creando..." : "CREAR"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportGroupDialog;
