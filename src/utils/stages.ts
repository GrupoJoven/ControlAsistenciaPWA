import type { Group, ParishEvent, User } from "../../types";
import type { GroupCatechistLink } from "../types/app";

/**
 * Etapas de la catequesis. Los grupos se llaman "1º PRECONFIRMACIÓN (A)",
 * "2º CONFIRMACIÓN (B)", etc., y la etapa sale del nombre.
 *
 * Estas reglas deben coincidir con las de stages.sql (group_stage() y
 * profile_stages()), event_grades.sql (group_grade() y
 * profile_stage_grades()), event_invitees.sql (profile_sees_event_row()) y
 * monitors.sql. Si cambias una, cambia la otra.
 */
export type CatechesisStage = "preconfirmation" | "confirmation";

/**
 * Etapas de monitores: comunión y postcomunión. No tienen grupos, ni niños en
 * la app, ni cursos; sus monitores viven en la tabla `monitors` y no tienen
 * usuario (ver src/utils/monitors.ts). Quien entra en la app es su
 * coordinador: un perfil con role 'coordinator' y esta etapa.
 */
export type MonitorStage = "communion" | "postcommunion";

export type Stage = CatechesisStage | MonitorStage;

/** Etapa de un evento: una concreta o las dos de catequesis. */
export type EventStage = Stage | "all";

/** Curso dentro de una etapa: primero o segundo. */
export type Grade = 1 | 2;

/** Curso al que va dirigido un evento. 0 = todos los de su etapa. */
export type EventGrade = 0 | Grade;

/** Etapa y curso concretos, como "preconfirmation:1". */
export type StageGrade = `${Stage}:${Grade}`;

/** Las etapas con grupos, niños y cursos: las que cubre un evento de 'all'. */
export const CATECHESIS_STAGES: CatechesisStage[] = ["preconfirmation", "confirmation"];

export const MONITOR_STAGES: MonitorStage[] = ["communion", "postcommunion"];

export const ALL_STAGES: Stage[] = [...CATECHESIS_STAGES, ...MONITOR_STAGES];

export const ALL_GRADES: Grade[] = [1, 2];

export const ALL_STAGE_GRADES: StageGrade[] = ALL_STAGES.flatMap((stage) =>
  ALL_GRADES.map((grade): StageGrade => `${stage}:${grade}`)
);

export const STAGE_LABELS: Record<EventStage, string> = {
  preconfirmation: "Preconfirmación",
  confirmation: "Confirmación",
  communion: "Comunión",
  postcommunion: "Postcomunión",
  all: "Ambas etapas",
};

/**
 * ¿Es una etapa de monitores (comunión o postcomunión)? Acepta cualquier
 * cadena porque también se usa con lo que viene de la base de datos.
 */
export const isMonitorStage = (
  stage: string | null | undefined
): stage is MonitorStage => stage === "communion" || stage === "postcommunion";

export const isCatechesisStage = (
  stage: string | null | undefined
): stage is CatechesisStage =>
  stage === "preconfirmation" || stage === "confirmation";

/**
 * Etapa de monitores de un usuario, si es de las suyas. Un coordinador de
 * comunión o de postcomunión no tiene grupos, así que basta con profiles.stage;
 * el coordinador general devuelve null porque las lleva las dos (y también las
 * de catequesis).
 */
export const getMonitorStage = (user: User | null | undefined): MonitorStage | null =>
  isMonitorStage(user?.stage) ? user!.stage : null;

/**
 * ¿Es este usuario de comunión o postcomunión? Si lo es, la app le deja solo
 * lo de monitores: no tiene grupos ni niños, así que "Mi Grupo" y la parte de
 * la coordinación que va de niños no le sirven de nada.
 */
export const isMonitorStageUser = (user: User | null | undefined): boolean =>
  getMonitorStage(user) !== null;

export const GRADE_LABELS: Record<EventGrade, string> = {
  0: "Todos los cursos",
  1: "1º",
  2: "2º",
};

/** Misma lógica que public.group_stage(): PRECONFIRMACI antes que CONFIRMACI. */
export const getGroupStage = (name: string | null | undefined): CatechesisStage | null => {
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

/**
 * parish_events.counts_for_attendance. Solo un false explícito deja un evento
 * fuera del porcentaje: una caché antigua sin la columna vale por "sí cuenta",
 * que es el valor por defecto en la BD.
 */
export const toCountsForAttendance = (value: unknown): boolean => value !== false;

/**
 * Lo que hace falta de un evento para saber a quién va dirigido: su etapa y
 * curso, o su lista de invitados si es un evento específico.
 */
export type EventAudience = Pick<
  ParishEvent,
  "stage" | "grade" | "inviteOnly" | "inviteeIds"
>;

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
  // hubiera cursos: el de 'ambas etapas' le llega a cualquiera de la
  // catequesis, incluso a quien todavía no tiene grupo. A los monitores de
  // comunión y postcomunión NO: su agenda es independiente, solo les llegan
  // los eventos de su propia etapa.
  if (!grade) {
    const stages = eventStage === "all" ? CATECHESIS_STAGES : [eventStage];
    return stages.some((stage) =>
      stageGrades.some((stageGrade) => stageGrade.startsWith(`${stage}:`))
    );
  }

  const stages = eventStage === "all" ? CATECHESIS_STAGES : [eventStage];

  return stages.some((stage) => stageGrades.includes(`${stage}:${grade}`));
};

/**
 * ¿Va este evento dirigido a este perfil? Misma regla que
 * profile_sees_event_row() en SQL: en un evento específico manda la lista de
 * invitados y la etapa y el curso solo dicen quién lo gestiona.
 *
 * inviteeIds es lo que RLS nos haya dejado leer: un catequista solo conoce su
 * propia invitación, así que de los demás saldrá "no invitado". Se equivoca
 * siempre hacia el lado seguro (no contar el evento), nunca hacia la falta.
 */
export const eventAppliesTo = (
  event: EventAudience,
  profileId: string,
  stageGrades: StageGrade[]
): boolean =>
  event.inviteOnly
    ? (event.inviteeIds ?? []).includes(profileId)
    : eventAppliesToStageGrades(event, stageGrades);

/** ¿Va este evento dirigido a este usuario? */
export const eventAppliesToUser = (event: EventAudience, user: User): boolean =>
  eventAppliesTo(event, user.id, user.stageGrades ?? []);

/**
 * Eventos dirigidos a un usuario concreto (su agenda, su histórico...). Si no
 * se le han calculado etapas no le afecta ninguno de etapa o curso concretos.
 */
export const getEventsForUser = (events: ParishEvent[], user: User): ParishEvent[] =>
  events.filter((event) => eventAppliesToUser(event, user));

/**
 * ¿Cuenta este evento para el porcentaje de asistencia del usuario? Además de
 * irle dirigido, el evento tiene que contar para la asistencia: un evento
 * específico puede crearse como informativo y entonces no suma ni resta.
 */
export const eventCountsForUser = (event: ParishEvent, user: User): boolean =>
  event.countsForAttendance !== false && eventAppliesToUser(event, user);

export const getEventsCountingForUser = (events: ParishEvent[], user: User): ParishEvent[] =>
  events.filter((event) => eventCountsForUser(event, user));

/**
 * ¿Puede el usuario VER el evento? Los dirigidos a él, más los que gestiona
 * como coordinador: el que crea un evento específico tiene que poder borrarlo
 * y pasar lista aunque él no esté invitado. Misma regla que las dos políticas
 * de parish_events (select_visible y coordinator_manage, que es FOR ALL).
 */
export const isEventVisibleTo = (event: ParishEvent, user: User): boolean =>
  eventAppliesToUser(event, user) || canManageEventStage(user, event.stage);

export const getVisibleEvents = (events: ParishEvent[], user: User): ParishEvent[] =>
  events.filter((event) => isEventVisibleTo(event, user));

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

/**
 * A quién va dirigido un evento: "Confirmación", "1º Preconfirmación"...
 * En uno específico no se dice cuántos invitados hay porque cada usuario solo
 * conoce su propia invitación; el número se muestra donde sí se sabe (la
 * pantalla de agenda del coordinador).
 */
export const getEventAudienceLabel = (event: EventAudience): string => {
  if (event.inviteOnly) return "Solo invitados";
  if (!event.grade) return STAGE_LABELS[event.stage];
  if (event.stage === "all") return `${GRADE_LABELS[event.grade]} · ambas etapas`;
  return `${GRADE_LABELS[event.grade]} ${STAGE_LABELS[event.stage]}`;
};

/** ¿Hay que etiquetar el evento? Los de todas las etapas y cursos no. */
export const isTargetedEvent = (event: EventAudience): boolean =>
  event.inviteOnly || event.stage !== "all" || !!event.grade;

/** Texto para la interfaz: "Coordinador · Confirmación", "Catequista", etc. */
export const getRoleLabel = (user: User): string => {
  if (user.role === "coordinator") {
    return user.stage ? `Coordinador · ${STAGE_LABELS[user.stage]}` : "Coordinador";
  }
  // Un perfil de comunión o postcomunión que ya no coordina la etapa: no es
  // catequista de nada, es un monitor con acceso a la app.
  return isMonitorStageUser(user) ? `Monitor · ${STAGE_LABELS[user.stage!]}` : "Catequista";
};
