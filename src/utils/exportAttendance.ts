import {
  AttendanceStatus,
  Group,
  Student,
  calculateAttendanceWeight,
  calculateStudentRate,
} from "../../types";
import {
  AcademicYear,
  getAcademicYearCutoff,
  filterDatesByAcademicYear,
} from "./academicYear";

/**
 * Exportación del histórico de asistencia a CSV.
 *
 * Se usa `;` como separador y coma decimal porque es lo que espera Excel en
 * español, y se antepone un BOM UTF-8 para que los acentos no salgan rotos.
 */

const DELIMITER = ";";
const BOM = String.fromCharCode(0xfeff);

/** Marcas diacríticas combinantes (U+0300–U+036F), las que deja `normalize("NFD")`. */
const COMBINING_MARKS = new RegExp(
  "[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]",
  "g"
);

const COLUMNS = [
  "Curso",
  "Grupo",
  "Alumno",
  "ID público",
  "DNI",
  "Fecha",
  "Día",
  "Catequesis",
  "Misa",
  "Con registro",
  "Puntuación",
  "% Asistencia curso",
] as const;

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: "Presente",
  absent: "Ausente",
  late: "Tarde",
};

const escapeCell = (value: string | number): string => {
  const text = String(value ?? "");

  if (text.includes(DELIMITER) || text.includes('"') || /[\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
};

const formatDecimal = (value: number): string => value.toFixed(2).replace(".", ",");

const formatWeekday = (dateStr: string): string =>
  new Date(`${dateStr}T12:00:00`).toLocaleDateString("es-ES", { weekday: "long" });

export interface AttendanceCsvOptions {
  students: Student[];
  classDays: string[];
  groups: Group[];
  /** Cursos a incluir. Uno solo para un curso concreto, varios para el histórico completo. */
  years: AcademicYear[];
}

/**
 * Construye el CSV con una fila por alumno y día lectivo ya transcurrido.
 * Los días sin registro se listan como ausencia, igual que en el cálculo del
 * porcentaje de asistencia, pero se marcan en la columna "Con registro" para
 * poder distinguir una falta anotada de un día sin pasar lista.
 */
export const buildAttendanceCsv = ({
  students,
  classDays,
  groups,
  years,
}: AttendanceCsvOptions): string => {
  const groupNameById = new Map(groups.map((group) => [group.id, group.name]));

  const sortedStudents = [...students].sort((a, b) =>
    a.name.localeCompare(b.name, "es", { sensitivity: "base" })
  );

  const sortedYears = [...years].sort((a, b) => a.startYear - b.startYear);

  const lines: string[] = [COLUMNS.join(DELIMITER)];

  for (const year of sortedYears) {
    const cutoff = getAcademicYearCutoff(year);

    const yearClassDays = filterDatesByAcademicYear(classDays, year)
      .filter((day) => day <= cutoff)
      .sort((a, b) => a.localeCompare(b));

    if (yearClassDays.length === 0) continue;

    for (const student of sortedStudents) {
      const rate = calculateStudentRate(student, classDays, year);
      const groupName = groupNameById.get(student.groupId) ?? "SIN GRUPO";

      for (const day of yearClassDays) {
        const record = student.attendanceHistory?.find((h) => h.date === day);

        const catechism: AttendanceStatus = record?.catechism ?? "absent";
        const mass: AttendanceStatus = record?.mass ?? "absent";

        lines.push(
          [
            year.label,
            groupName,
            student.name,
            student.publicId || "",
            student.dni || "",
            day,
            formatWeekday(day),
            STATUS_LABELS[catechism],
            STATUS_LABELS[mass],
            record ? "Sí" : "No",
            formatDecimal(calculateAttendanceWeight({ catechism, mass })),
            String(rate),
          ]
            .map(escapeCell)
            .join(DELIMITER)
        );
      }
    }
  }

  return lines.join("\r\n");
};

/** Deja el texto apto para un nombre de fichero en cualquier sistema. */
export const sanitizeFileName = (value: string): string =>
  value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "historico";

export const buildAttendanceFileName = (
  scopeLabel: string,
  year: AcademicYear | null
): string => {
  const scope = sanitizeFileName(scopeLabel);
  const suffix = year ? sanitizeFileName(year.label) : "historico_completo";

  return `asistencia_${scope}_${suffix}.csv`;
};

export const downloadCsv = (fileName: string, content: string): void => {
  const blob = new Blob([BOM + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
};
