import type { Group, ParishEvent, User } from "../../types";
import type { GroupCatechistLink } from "../types/app";

/**
 * Etapas de la catequesis. Los grupos se llaman "1º PRECONFIRMACIÓN (A)",
 * "2º CONFIRMACIÓN (B)", etc., y la etapa sale del nombre.
 *
 * Estas reglas deben coincidir con las de stages.sql (group_stage() y
 * profile_stages()) y event_grades.sql (group_grade() y
 * profile_stage_grades()). Si cambias una, cambia la otra.
 */
export type Stage = "preconfirmation" | "confirmation";

/** Etapa de un evento: una concreta o las dos. */
export type EventStage = Stage | "all";

/** Curso dentro de una etapa: primero o segundo. */
export type Grade = 1 | 2;

/** Curso al que va dirigido un evento. 0 = todos los de su etapa. */
export type EventGrade = 0 | Grade;

/** Etapa y curso concretos, como "preconfirmation:1". */
export type StageGrade = `${Stage}:${Grade}`;

export const ALL_STAGES: Stage[] = ["preconfirmation", "confirmation"];

export const ALL_GRADES: Grade[] = [1, 2];

export const ALL_STAGE_GRADES: StageGrade[] = ALL_STAGES.flatMap((stage) =>
  ALL_GRADES.map((grade): StageGrade => `${stage}:${grade}`)
);

export const STAGE_LABELS: Record<EventStage, string> = {
  preconfirmation: "Preconfirmación",
  confirmation: "Confirmación",
  all: "Ambas etapas",
};

export const GRADE_LABELS: Record<EventGrade, string> = {
  0: "Todos los cursos",
  1: "1º",
  2: "2º",
};

/** Misma lógica que public.group_stage(): PRECONFIRMACI antes que CONFIRMACI. */
export const getGroupStage = (name: string | null | undefined): Stage | null => {
  const upper = (name ?? "").toUpperCase();
  if (upper.includes("PRECONFIRMACI")) return "preconfirmation";
  if (upper.includes("CONFIRMACI")) return "confirmation";
  return null;
};

/**
 * Curso de un grupo a partir de su nombre: todos empiezan por el número de
 * curso ("1º PRECONFIRMACIÓN (A)"). Misma lógica que public.group_grade().
 */
export const getGroupGrade = (name: string | null | undefined): Grade | null => {
  const first = (name ?? "").trim().charAt(0);
  if (first === "1") return 1;
  if (first === "2") return 2;
  return null;
};

/**
 * parish_events.grade es int2 y puede llegar como número, como texto (cachés
 * antiguas) o sin valor: cualquier cosa que no sea 1 o 2 significa "todos".
 */
export const toEventGrade = (value: unknown): EventGrade => {
  const n = Number(value);
  return n === 1 || n === 2 ? (n as Grade) : 0;
};

/** Coordinator sin etapa: lo ve todo. */
export const isGlobalCoordinator = (user: User | null | undefined): boolean =>
  !!user && user.role === "coordinator" && !user.stage;

/** Coordinator de una etapa concreta. */
export const isStageCoordinator = (user: User | null | undefined): boolean =>
  !!user && user.role === "coordinator" && !!user.stage;

/**
 * Etapas efectivas de un usuario (misma regla que profile_stages() en SQL):
 * el coordinador global tiene las dos; el resto, su profiles.stage más las de
 * sus grupos.
 */
export const getUserStages = (
  user: User,
  groups: Group[],
  links: GroupCatechistLink[]
): Stage[] => {
  if (isGlobalCoordinator(user)) return [...ALL_STAGES];

  const stages = new Set<Stage>();
  if (user.stage) stages.add(user.stage);

  const groupStageById = new Map(groups.map((g) => [g.id, g.stage ?? getGroupStage(g.name)]));
  for (const link of links) {
    if (link.profile_id !== user.id) continue;
    const stage = groupStageById.get(link.group_id);
    if (stage) stages.add(stage);
  }

  return ALL_STAGES.filter((s) => stages.has(s));
};

/**
 * Etapas y cursos efectivos de un usuario (misma regla que
 * profile_stage_grades() en SQL). Dentro de cada una de sus etapas:
 *
 *   - el coordinador global y el de esa etapa llevan los dos cursos, aunque
 *     tengan grupos de uno solo: son quienes gestionan sus eventos;
 *   - el resto, los cursos de sus grupos de esa etapa;
 *   - quien llega a la etapa sin grupos (solo por profiles.stage), los dos:
 *     sin grupo no hay curso con el que afinar.
 */
export const getUserStageGrades = (
  user: User,
  groups: Group[],
  links: GroupCatechistLink[]
): StageGrade[] => {
  if (isGlobalCoordinator(user)) return [...ALL_STAGE_GRADES];

  const groupById = new Map(groups.map((g) => [g.id, g]));
  const gradesByStage = new Map<Stage, Set<Grade>>();

  for (const link of links) {
    if (link.profile_id !== user.id) continue;

    const group = groupById.get(link.group_id);
    if (!group) continue;

    const stage = group.stage ?? getGroupStage(group.name);
    const grade = getGroupGrade(group.name);
    if (!stage || !grade) continue;

    const grades = gradesByStage.get(stage) ?? new Set<Grade>();
    grades.add(grade);
    gradesByStage.set(stage, grades);
  }

  const stageGrades: StageGrade[] = [];

  for (const stage of getUserStages(user, groups, links)) {
    const own = gradesByStage.get(stage);
    const coordinatesStage = isStageCoordinator(user) && user.stage === stage;
    const grades =
      own?.size && !coordinatesStage ? ALL_GRADES.filter((g) => own.has(g)) : ALL_GRADES;

    for (const grade of grades) stageGrades.push(`${stage}:${grade}`);
  }

  return stageGrades;
};

/**
 * ¿Afecta este evento a alguien con estas etapas y cursos? Misma regla que
 * profile_sees_event() en SQL.
 */
export const eventAppliesToStageGrades = (
  event: Pick<ParishEvent, "stage" | "grade">,
  stageGrades: StageGrade[]
): boolean => {
  const { stage: eventStage, grade } = event;

  // Un evento para todos los cursos solo mira la etapa, como antes de que
  // hubiera cursos: el de 'ambas etapas' le llega a cualquiera, incluso a
  // quien todavía no tiene grupo.
  if (!grade) {
    return (
      eventStage === "all" ||
      stageGrades.some((stageGrade) => stageGrade.startsWith(`${eventStage}:`))
    );
  }

  const stages = eventStage === "all" ? ALL_STAGES : [eventStage];

  return stages.some((stage) => stageGrades.includes(`${stage}:${grade}`));
};

/** ¿Va este evento dirigido a este usuario? */
export const eventAppliesToUser = (
  event: Pick<ParishEvent, "stage" | "grade">,
  user: User
): boolean => eventAppliesToStageGrades(event, user.stageGrades ?? []);

export const getEventsForStageGrades = (
  events: ParishEvent[],
  stageGrades: StageGrade[]
): ParishEvent[] => events.filter((event) => eventAppliesToStageGrades(event, stageGrades));

/**
 * Eventos que cuentan para un usuario concreto (su tasa de asistencia, su
 * histórico...). Si no se le han calculado etapas no le afecta ninguno de
 * etapa o curso concretos.
 */
export const getEventsForUser = (events: ParishEvent[], user: User): ParishEvent[] =>
  getEventsForStageGrades(events, user.stageGrades ?? []);

/**
 * Qué eventos puede crear/borrar el usuario (misma regla que
 * can_manage_event_stage() en SQL): el global cualquiera; el de etapa solo los
 * de su etapa, nunca los de 'all'. El curso no cambia quién los gestiona.
 */
export const canManageEventStage = (user: User | null | undefined, stage: EventStage): boolean => {
  if (isGlobalCoordinator(user)) return true;
  if (!isStageCoordinator(user)) return false;
  return stage !== "all" && stage === user!.stage;
};

/** A quién va dirigido un evento: "Confirmación", "1º Preconfirmación"... */
export const getEventAudienceLabel = (event: Pick<ParishEvent, "stage" | "grade">): string => {
  if (!event.grade) return STAGE_LABELS[event.stage];
  if (event.stage === "all") return `${GRADE_LABELS[event.grade]} · ambas etapas`;
  return `${GRADE_LABELS[event.grade]} ${STAGE_LABELS[event.stage]}`;
};

/** ¿Hay que etiquetar el evento? Los de todas las etapas y cursos no. */
export const isTargetedEvent = (event: Pick<ParishEvent, "stage" | "grade">): boolean =>
  event.stage !== "all" || !!event.grade;

/** Texto para la interfaz: "Coordinador · Confirmación", "Catequista", etc. */
export const getRoleLabel = (user: User): string => {
  if (user.role === "coordinator") {
    return user.stage ? `Coordinador · ${STAGE_LABELS[user.stage]}` : "Coordinador";
  }
  return "Catequista";
};
