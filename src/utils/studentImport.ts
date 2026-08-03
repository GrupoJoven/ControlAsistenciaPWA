// La subruta /browser es obligatoria: el paquete no expone raíz, solo subrutas
// (browser, node, universal, web-worker).
import readXlsxFile from "read-excel-file/browser";

/**
 * Lectura y validación de ficheros de alta de alumnos (CSV o XLSX).
 *
 * Las columnas son las de `students` menos las tres que no puede traer el
 * fichero: `id` y `group_id` se generan al importar, y `photo_path` está vacío
 * porque los alumnos nuevos todavía no tienen foto.
 *
 * La validación es estricta a propósito: fechas solo en AAAA-MM-DD y género
 * solo male/female. Adivinar formatos en datos de menores es peor que obligar
 * a corregir el fichero.
 */

export const REQUIRED_COLUMNS = [
  "name",
  "dni",
  "gender",
  "email",
  "parent_email",
  "school",
  "birth_date",
] as const;

export type StudentColumn = (typeof REQUIRED_COLUMNS)[number];

export type ImportedStudent = Record<StudentColumn, string>;

export interface ImportIssue {
  /** Fila del fichero tal y como la ve el usuario (1 = cabecera). */
  row: number;
  column?: string;
  message: string;
}

export interface ImportResult {
  students: ImportedStudent[];
  issues: ImportIssue[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_GENDERS = ["male", "female"];

const DNI_RE = /^[0-9]{8}[A-Z]$/;
const NIE_RE = /^[XYZ][0-9]{7}[A-Z]$/;
const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const NIE_PREFIX: Record<string, string> = { X: "0", Y: "1", Z: "2" };

/**
 * Valida la letra de control de un DNI o NIE español.
 *
 * Réplica exacta de la función de base de datos is_valid_spanish_dni_nie(),
 * que además está aplicada como CHECK sobre students.dni. Aquí sirve para
 * poder decir qué fila del fichero falla; la base de datos es la garantía.
 *
 * Vacío y solo espacios se consideran válidos: el DNI es opcional.
 */
export const isValidSpanishDniNie = (value: string | null | undefined): boolean => {
  if (value === null || value === undefined || value.trim() === "") return true;

  const clean = value.trim().toUpperCase();

  let digits: string;

  if (DNI_RE.test(clean)) {
    digits = clean.slice(0, 8);
  } else if (NIE_RE.test(clean)) {
    digits = NIE_PREFIX[clean[0]] + clean.slice(1, 8);
  } else {
    return false;
  }

  // SUBSTRING de SQL empieza en 1, de ahí el "+ 1" del original; aquí el
  // índice ya empieza en 0.
  return clean[clean.length - 1] === DNI_LETTERS[Number(digits) % 23];
};

/** Columnas que pueden ir vacías, según la nulabilidad de `students`. */
const OPTIONAL_COLUMNS: StudentColumn[] = ["dni", "gender", "email", "school", "birth_date"];

// --------------------------------------------------------------------- CSV

/**
 * Parte una línea CSV respetando las comillas dobles, con "" como comilla
 * escapada. No vale un split por el separador: un colegio llamado
 * "San José; Fundación" rompería la fila.
 */
const splitCsvLine = (line: string, delimiter: string): string[] => {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
};

/** Excel en español exporta con ';' y en inglés con ','. Se detecta por la cabecera. */
const detectDelimiter = (headerLine: string): string =>
  (headerLine.match(/;/g)?.length ?? 0) >= (headerLine.match(/,/g)?.length ?? 0) ? ";" : ",";

const parseCsv = (text: string): string[][] => {
  // Se quita el BOM que añade Excel al guardar en UTF-8.
  const clean = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const lines = clean
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim() !== "");

  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines[0]);
  return lines.map((line) => splitCsvLine(line, delimiter).map((cell) => cell.trim()));
};

// -------------------------------------------------------------------- XLSX

/** read-excel-file devuelve Date en celdas con formato fecha; el resto llega como texto o número. */
const cellToString = (value: unknown): string => {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) {
    // Se usa la fecha local, no toISOString(), que desplazaría un día en UTC+2.
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return String(value).trim();
};

// -------------------------------------------------------------- validación

const normalizeHeader = (header: string): string =>
  header.trim().toLowerCase().replace(/\s+/g, "_");

export const validateHeaders = (headers: string[]): string[] => {
  const normalized = headers.map(normalizeHeader).filter((h) => h !== "");
  const issues: string[] = [];

  const missing = REQUIRED_COLUMNS.filter((col) => !normalized.includes(col));
  const extra = normalized.filter((h) => !REQUIRED_COLUMNS.includes(h as StudentColumn));

  if (missing.length > 0) {
    issues.push(`Faltan columnas: ${missing.join(", ")}.`);
  }

  if (extra.length > 0) {
    issues.push(`Sobran columnas: ${extra.join(", ")}.`);
  }

  const duplicated = normalized.filter((h, i) => normalized.indexOf(h) !== i);
  if (duplicated.length > 0) {
    issues.push(`Columnas repetidas: ${Array.from(new Set(duplicated)).join(", ")}.`);
  }

  return issues;
};

const validateRow = (
  student: ImportedStudent,
  rowNumber: number,
  issues: ImportIssue[]
): void => {
  for (const column of REQUIRED_COLUMNS) {
    const value = student[column];

    if (value === "" && !OPTIONAL_COLUMNS.includes(column)) {
      issues.push({ row: rowNumber, column, message: "Es obligatorio y está vacío." });
    }
  }

  if (student.birth_date !== "" && !DATE_RE.test(student.birth_date)) {
    issues.push({
      row: rowNumber,
      column: "birth_date",
      message: `"${student.birth_date}" no tiene formato AAAA-MM-DD.`,
    });
  } else if (student.birth_date !== "") {
    // Descarta fechas con formato correcto pero imposibles, como 2015-02-31.
    const [y, m, d] = student.birth_date.split("-").map(Number);
    const parsed = new Date(y, m - 1, d);
    if (parsed.getFullYear() !== y || parsed.getMonth() !== m - 1 || parsed.getDate() !== d) {
      issues.push({
        row: rowNumber,
        column: "birth_date",
        message: `"${student.birth_date}" no es una fecha real.`,
      });
    }
  }

  if (student.dni !== "" && !isValidSpanishDniNie(student.dni)) {
    issues.push({
      row: rowNumber,
      column: "dni",
      message: `"${student.dni}" no es un DNI o NIE válido (letra de control incorrecta o formato erróneo).`,
    });
  }

  if (student.gender !== "" && !VALID_GENDERS.includes(student.gender)) {
    issues.push({
      row: rowNumber,
      column: "gender",
      message: `"${student.gender}" no es válido. Debe ser male o female.`,
    });
  }

  for (const column of ["email", "parent_email"] as const) {
    const value = student[column];
    if (value !== "" && !EMAIL_RE.test(value)) {
      issues.push({ row: rowNumber, column, message: `"${value}" no es un email válido.` });
    }
  }
};

const rowsToStudents = (rows: string[][]): ImportResult => {
  const issues: ImportIssue[] = [];

  if (rows.length === 0) {
    return { students: [], issues: [{ row: 1, message: "El fichero está vacío." }] };
  }

  const headerIssues = validateHeaders(rows[0]);
  if (headerIssues.length > 0) {
    return {
      students: [],
      issues: headerIssues.map((message) => ({ row: 1, message })),
    };
  }

  const headers = rows[0].map(normalizeHeader);
  const indexOf = (column: StudentColumn) => headers.indexOf(column);

  const students: ImportedStudent[] = [];
  const seenDni = new Map<string, number>();

  rows.slice(1).forEach((cells, i) => {
    const rowNumber = i + 2; // +1 por la cabecera, +1 porque el usuario cuenta desde 1

    const student = REQUIRED_COLUMNS.reduce((acc, column) => {
      acc[column] = (cells[indexOf(column)] ?? "").trim();
      return acc;
    }, {} as ImportedStudent);

    // Fila completamente vacía: se ignora en silencio, es habitual al final del fichero.
    if (REQUIRED_COLUMNS.every((column) => student[column] === "")) return;

    validateRow(student, rowNumber, issues);

    if (student.dni !== "") {
      const previous = seenDni.get(student.dni.toUpperCase());
      if (previous !== undefined) {
        issues.push({
          row: rowNumber,
          column: "dni",
          message: `DNI repetido, ya aparece en la fila ${previous}.`,
        });
      } else {
        seenDni.set(student.dni.toUpperCase(), rowNumber);
      }
    }

    students.push(student);
  });

  if (students.length === 0 && issues.length === 0) {
    issues.push({ row: 1, message: "El fichero no contiene ninguna fila de datos." });
  }

  return { students, issues };
};

export const parseStudentFile = async (file: File): Promise<ImportResult> => {
  const isExcel = /\.xlsx$/i.test(file.name);

  if (isExcel) {
    // En read-excel-file v9 la llamada devuelve todas las hojas como
    // { sheet, data }, no las filas sueltas. Se usa la primera.
    const sheets = await readXlsxFile(file);

    if (sheets.length === 0) {
      return {
        students: [],
        issues: [{ row: 1, message: "El fichero Excel no tiene ninguna hoja." }],
      };
    }

    const rows = sheets[0].data.map((row) => row.map(cellToString));
    const result = rowsToStudents(rows);

    if (sheets.length > 1) {
      result.issues.unshift({
        row: 1,
        message: `El fichero tiene ${sheets.length} hojas; solo se ha leído "${sheets[0].sheet}".`,
      });
    }

    return result;
  }

  if (!/\.csv$/i.test(file.name)) {
    return {
      students: [],
      issues: [{ row: 1, message: "Formato no admitido. Sube un fichero .csv o .xlsx." }],
    };
  }

  return rowsToStudents(parseCsv(await file.text()));
};

/** Fichero de ejemplo con las columnas correctas, para que el usuario parta de algo válido. */
export const buildTemplateCsv = (): string =>
  [
    REQUIRED_COLUMNS.join(";"),
    ["Nombre Apellido1 Apellido2", "12345678Z", "male", "nino@ejemplo.com", "padres@ejemplo.com", "Colegio Ejemplo", "2015-03-24"].join(";"),
  ].join("\r\n");
