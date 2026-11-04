/**
 * Curso académico: del 1 de septiembre al 31 de agosto del año siguiente.
 *
 * En la práctica los registros suelen empezar en octubre y terminar en mayo,
 * pero la ventana se mantiene de septiembre a agosto para que cualquier
 * registro existente caiga siempre dentro de un único curso.
 *
 * Este módulo no importa nada de `types.ts` a propósito: `types.ts` sí importa
 * de aquí, y una dependencia circular rompería la inicialización de los módulos.
 */

export interface AcademicYear {
  /** Año de inicio en formato string, p. ej. "2025". */
  key: string;
  /** Etiqueta para la interfaz, p. ej. "CURSO 25-26". */
  label: string;
  startYear: number;
  /** Primer día del curso (YYYY-MM-DD). */
  start: string;
  /** Último día del curso (YYYY-MM-DD). */
  end: string;
}

const todayStr = (): string => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * Año de inicio del curso al que pertenece una fecha YYYY-MM-DD.
 * Se trabaja sobre el string para evitar los desplazamientos de zona horaria
 * que introduce `new Date("YYYY-MM-DD")`, que se interpreta como UTC.
 */
export const getAcademicYearStartYear = (dateStr: string): number => {
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7)); // 1-12

  return month >= 9 ? year : year - 1;
};

export const buildAcademicYear = (startYear: number): AcademicYear => ({
  key: String(startYear),
  label: `CURSO ${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`,
  startYear,
  start: `${startYear}-09-01`,
  end: `${startYear + 1}-08-31`,
});

export const getAcademicYearForDate = (dateStr: string): AcademicYear =>
  buildAcademicYear(getAcademicYearStartYear(dateStr));

export const getCurrentAcademicYear = (): AcademicYear =>
  getAcademicYearForDate(todayStr());

export const isInAcademicYear = (dateStr: string, year: AcademicYear): boolean =>
  dateStr >= year.start && dateStr <= year.end;

export type AcademicYearState = "past" | "current" | "future";

/**
 * Situación del curso respecto a hoy. Hace falta distinguir los tres casos:
 * un curso futuro no es un curso cerrado, aunque ninguno de los dos sea el actual.
 */
export const getAcademicYearState = (year: AcademicYear): AcademicYearState => {
  const today = todayStr();

  if (today > year.end) return "past";
  if (today < year.start) return "future";
  return "current";
};

export const filterDatesByAcademicYear = (
  dates: string[],
  year: AcademicYear
): string[] => dates.filter((date) => isInAcademicYear(date, year));

/**
 * Último día que se debe tener en cuenta al calcular porcentajes: hoy si el
 * curso está en marcha, o el final del curso si ya se cerró.
 */
export const getAcademicYearCutoff = (year: AcademicYear): string => {
  const today = todayStr();
  return today < year.end ? today : year.end;
};

/**
 * Instante de un evento de la agenda. parish_events.date es un "timestamp
 * without time zone", así que llega como "2026-09-11T18:00:00" y se
 * interpreta en hora local. El replace cubre la variante con espacio
 * ("2026-09-11 18:00:00"), que Safari no sabe parsear. NaN si no se entiende.
 */
export const getEventTimestamp = (date: string): number =>
  new Date(String(date).replace(" ", "T")).getTime();

/**
 * ¿Es un evento de este curso que ya ha pasado? Un evento cuenta para la
 * asistencia desde su fecha Y SU HORA: a las 18:00, de uno que empieza a las
 * 19:00 todavía no se puede haber pasado lista, así que no debe contar como
 * ausencia de nadie.
 *
 * El día se compara con la ventana del curso y la hora con el momento actual
 * en vez de usar getAcademicYearCutoff(), que es un día entero y dejaría los
 * eventos de hoy fuera hasta mañana.
 *
 * Esta regla tiene que coincidir con la de la edge function
 * generate-monthly-report, que acota la consulta de parish_events a la hora
 * local de Madrid. Si cambias una, cambia la otra.
 */
export const isPastEvent = (
  date: string,
  year: AcademicYear,
  now: number = Date.now()
): boolean => {
  const day = String(date).slice(0, 10);

  if (day < year.start || day > year.end) return false;

  const timestamp = getEventTimestamp(date);

  // Sin hora reconocible se compara solo el día, como cuando los eventos de
  // la agenda no tenían hora.
  return Number.isNaN(timestamp) ? day <= todayStr() : timestamp <= now;
};

/**
 * Cursos con datos, del más reciente al más antiguo. El curso actual se
 * incluye siempre aunque todavía no tenga ningún registro.
 */
export const listAcademicYears = (...dateLists: string[][]): AcademicYear[] => {
  const startYears = new Set<number>();

  for (const dates of dateLists) {
    for (const date of dates) {
      if (date) startYears.add(getAcademicYearStartYear(date));
    }
  }

  startYears.add(getCurrentAcademicYear().startYear);

  return Array.from(startYears)
    .sort((a, b) => b - a)
    .map(buildAcademicYear);
};

export const findAcademicYearByKey = (
  years: AcademicYear[],
  key: string | null
): AcademicYear | null => years.find((year) => year.key === key) ?? null;

/**
 * Curso que debe quedar seleccionado por defecto: el actual si aparece en la
 * lista y, si no, el más reciente con datos.
 */
export const getDefaultAcademicYear = (years: AcademicYear[]): AcademicYear => {
  const current = getCurrentAcademicYear();
  return findAcademicYearByKey(years, current.key) ?? years[0] ?? current;
};
