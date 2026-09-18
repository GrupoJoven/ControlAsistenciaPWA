import type { Group, ParishEvent, User } from "../../types";
import type { GroupCatechistLink } from "../types/app";

/**
 * Etapas de la catequesis. Los grupos se llaman "1º PRECONFIRMACIÓN (A)",
 * "2º CONFIRMACIÓN (B)", etc., y la etapa sale del nombre.
 *
 * Estas reglas deben coincidir con las de stages.sql (group_stage() y
 * profile_stages()). Si cambias una, cambia la otra.
 */
export type Stage = "preconfirmation" | "confirmation";

/** Etapa de un evento: una concreta o las dos. */
export type EventStage = Stage | "all";

export const ALL_STAGES: Stage[] = ["preconfirmation", "confirmation"];

export const STAGE_LABELS: Record<EventStage, string> = {
  preconfirmation: "Preconfirmación",
  confirmation: "Confirmación",
  all: "Ambas etapas",
};

/** Misma lógica que public.group_stage(): PRECONFIRMACI antes que CONFIRMACI. */
export const getGroupStage = (name: string | null | undefined): Stage | null => {
  const upper = (name ?? "").toUpperCase();
  if (upper.includes("PRECONFIRMACI")) return "preconfirmation";
  if (upper.includes("CONFIRMACI")) return "confirmation";
  return null;
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

/** ¿Afecta este evento a alguien con estas etapas? Los de 'all', siempre. */
export const eventAppliesToStages = (event: ParishEvent, stages: Stage[]): boolean =>
  event.stage === "all" || stages.includes(event.stage);

export const getEventsForStages = (events: ParishEvent[], stages: Stage[]): ParishEvent[] =>
  events.filter((event) => eventAppliesToStages(event, stages));

/**
 * Eventos que cuentan para un usuario concreto (su tasa de asistencia, su
 * histórico...). Si no se le han calculado etapas se asume que ve los de 'all'.
 */
export const getEventsForUser = (events: ParishEvent[], user: User): ParishEvent[] =>
  getEventsForStages(events, user.stages ?? []);

/**
 * Qué eventos puede crear/borrar el usuario (misma regla que
 * can_manage_event_stage() en SQL): el global cualquiera; el de etapa solo los
 * de su etapa, nunca los de 'all'.
 */
export const canManageEventStage = (user: User | null | undefined, stage: EventStage): boolean => {
  if (isGlobalCoordinator(user)) return true;
  if (!isStageCoordinator(user)) return false;
  return stage !== "all" && stage === user!.stage;
};

/** Texto para la interfaz: "Coordinador · Confirmación", "Catequista", etc. */
export const getRoleLabel = (user: User): string => {
  if (user.role === "coordinator") {
    return user.stage ? `Coordinador · ${STAGE_LABELS[user.stage]}` : "Coordinador";
  }
  return "Catequista";
};
