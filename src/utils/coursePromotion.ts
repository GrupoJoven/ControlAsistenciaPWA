import { Group, Student } from "../../types";

/**
 * Promoción de curso: cada nivel sube al siguiente y el último causa baja.
 *
 * Estas reglas deben coincidir con las de la función de Postgres
 * promote_academic_year(). Si cambias una, cambia la otra.
 */

/** Grupos cuyos alumnos terminan la catequesis y se dan de baja. */
export const GRADUATING_PREFIX = "2º CONFIRMACIÓN";

/** Prefijo que debe existir para que la promoción tenga sentido. */
export const ENTRY_PREFIX = "1º PRECONFIRMACIÓN";

/** Meses en los que se permite promocionar (1-12): agosto, septiembre y octubre. */
export const PROMOTION_MONTHS = [8, 9, 10];

/**
 * El orden importa al evaluar: los prefijos son mutuamente excluyentes, pero se
 * listan de mayor a menor nivel para que se lea igual que la cadena de ascensos.
 */
export const PROMOTION_RULES: { from: string; to: string }[] = [
  { from: "1º CONFIRMACIÓN", to: "2º CONFIRMACIÓN" },
  { from: "2º PRECONFIRMACIÓN", to: "1º CONFIRMACIÓN" },
  { from: "1º PRECONFIRMACIÓN", to: "2º PRECONFIRMACIÓN" },
];

/** Nombre que tendrá el grupo tras promocionar, o null si no le afecta. */
export const getPromotedName = (name: string): string | null => {
  for (const rule of PROMOTION_RULES) {
    if (name.startsWith(rule.from)) {
      return rule.to + name.slice(rule.from.length);
    }
  }
  return null;
};

export const isGraduatingGroup = (group: Group): boolean =>
  group.name.startsWith(GRADUATING_PREFIX);

export const hasEntryLevelGroups = (groups: Group[]): boolean =>
  groups.some((group) => group.name.startsWith(ENTRY_PREFIX));

export const isPromotionMonth = (date = new Date()): boolean =>
  PROMOTION_MONTHS.includes(date.getMonth() + 1);

export interface PromotionPreview {
  /** Grupos que se renombran, con su nombre actual y el futuro. */
  renames: { group: Group; nextName: string }[];
  /** Grupos que se eliminan por haber terminado sus alumnos. */
  graduatingGroups: Group[];
  /** Alumnos que se dan de baja de forma permanente. */
  graduatingStudents: Student[];
  /** Registros de asistencia que se perderán. */
  attendanceRecords: number;
}

/**
 * Calcula lo que hará la promoción, para poder enseñárselo al coordinador
 * antes de que confirme.
 *
 * Los grupos que se gradúan se determinan por su nombre ACTUAL, antes de
 * aplicar ningún renombrado. Es el mismo motivo por el que la función de
 * Postgres captura los IDs antes de renombrar: si se hiciera al revés, los
 * grupos recién ascendidos desde "1º CONFIRMACIÓN" pasarían a llamarse
 * "2º CONFIRMACIÓN" y se borrarían por error.
 */
export const buildPromotionPreview = (
  groups: Group[],
  students: Student[]
): PromotionPreview => {
  const graduatingGroups = groups.filter(isGraduatingGroup);
  const graduatingIds = new Set(graduatingGroups.map((group) => group.id));

  const graduatingStudents = students.filter((student) =>
    graduatingIds.has(student.groupId)
  );

  const attendanceRecords = graduatingStudents.reduce(
    (total, student) => total + (student.attendanceHistory?.length ?? 0),
    0
  );

  const renames = groups
    .map((group) => ({ group, nextName: getPromotedName(group.name) }))
    .filter((entry): entry is { group: Group; nextName: string } => entry.nextName !== null)
    .sort((a, b) => a.group.name.localeCompare(b.group.name, "es", { sensitivity: "base" }));

  return {
    renames,
    graduatingGroups: [...graduatingGroups].sort((a, b) =>
      a.name.localeCompare(b.name, "es", { sensitivity: "base" })
    ),
    graduatingStudents,
    attendanceRecords,
  };
};
