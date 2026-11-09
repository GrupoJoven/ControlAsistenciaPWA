import type { Group, Student, User } from "../../types";
import { CATECHESIS_STAGES, Stage } from "./stages";

/**
 * Los días de cada etapa: los lectivos de preconfirmación y confirmación
 * (tabla class_days) y los de actividad de comunión y postcomunión (tabla
 * monitor_activity_days). Cada etapa lleva el suyo y los cuatro son
 * independientes.
 *
 * Hasta ahora class_days era un calendario único para las dos etapas de
 * catequesis, así que a un catequista de preconfirmación se le pedían también
 * los días de confirmación. Ver supabase/sql/class_days_by_stage.sql.
 */
export type StageCalendars = Record<Stage, string[]>;

export const EMPTY_STAGE_CALENDARS: StageCalendars = {
  preconfirmation: [],
  confirmation: [],
  communion: [],
  postcommunion: [],
};

/** Qué etapas le toca mirar a algo que puede no tener ninguna. */
export type StageSelection = Stage | Stage[] | null | undefined;

/**
 * Los días de una o varias etapas, sin repetidos y en orden.
 *
 * Sin etapa se devuelven los de las dos de catequesis, que es exactamente lo
 * que valía cuando el calendario era uno solo. Pasa con un grupo cuyo nombre
 * no sigue el patrón ("1º PRECONFIRMACIÓN (A)"), así que group_stage() no
 * reconoce su etapa: su gente se sigue midiendo con todo, que es el lado
 * prudente. Devolver una lista vacía les regalaría un 100% sin días.
 */
export const classDaysForStages = (
  calendars: StageCalendars,
  stages: StageSelection
): string[] => {
  const list =
    stages === null || stages === undefined
      ? [...CATECHESIS_STAGES]
      : Array.isArray(stages)
        ? stages
        : [stages];

  const wanted = list.length > 0 ? list : [...CATECHESIS_STAGES];

  // Una sola etapa es el caso normal: se devuelve su lista tal cual, que ya
  // viene ordenada del cargador, sin construir un Set por cada tarjeta.
  if (wanted.length === 1) return calendars[wanted[0]] ?? [];

  const days = new Set<string>();
  for (const stage of wanted) {
    for (const day of calendars[stage] ?? []) days.add(day);
  }

  return Array.from(days).sort();
};

/** Los días del grupo: los de su etapa. */
export const classDaysForGroup = (
  calendars: StageCalendars,
  group: Group | null | undefined
): string[] => classDaysForStages(calendars, group?.stage ?? null);

/** Los días del alumno: los del grupo en el que está. */
export const classDaysForStudent = (
  calendars: StageCalendars,
  groups: Group[],
  student: Student
): string[] =>
  classDaysForGroup(
    calendars,
    groups.find((group) => group.id === student.groupId)
  );

/**
 * Los días de un catequista: los de TODAS sus etapas. Uno con grupos en las
 * dos tiene clase los días de cualquiera de ellas, así que se le piden los dos
 * calendarios.
 *
 * `stages` lo calcula App (usersWithStages); si no estuviera, se usa la etapa
 * del perfil, y si tampoco, las dos de catequesis.
 */
export const classDaysForUser = (calendars: StageCalendars, user: User): string[] => {
  const stages = user.stages?.length ? user.stages : user.stage ? [user.stage] : null;
  return classDaysForStages(calendars, stages);
};

/** ¿Es este un día de clase de este catequista? */
export const isClassDayForUser = (
  calendars: StageCalendars,
  user: User,
  date: string
): boolean => classDaysForUser(calendars, user).includes(date);
