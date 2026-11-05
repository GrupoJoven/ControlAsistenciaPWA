import type { AttendanceStatus, ParishEvent } from "../../types";
import {
  AcademicYear,
  getAcademicYearCutoff,
  getCurrentAcademicYear,
  isPastEvent,
} from "./academicYear";
import type { MonitorStage } from "./stages";

/**
 * Monitores de comunión y de postcomunión.
 *
 * No tienen usuario de la app: no pasan asistencia a los niños, así que
 * cargarles la aplicación sería recargarla sin motivo. Viven en la tabla
 * `monitors` (ver supabase/sql/monitors.sql), que repite las columnas de
 * `profiles` para que el día que alguno necesite entrar baste con crearle el
 * usuario y apuntar `profile_id` a su perfil.
 *
 * Quien sí entra en la app es su coordinador: un perfil con role
 * 'coordinator' y stage 'communion' o 'postcommunion'. Tiene además su propia
 * ficha de monitor (role 'coordinator', con profile_id), para que se le pase
 * lista como a los demás.
 */

/** Papel dentro de la etapa. El 'coordinator' es el que entra en la app. */
export type MonitorRole = "monitor" | "coordinator";

export interface Monitor {
  id: string;
  stage: MonitorStage;
  name: string;
  email: string;
  phone: string;
  birthDate: string;
  /** URL firmada de la foto, como en User.photo. */
  photo?: string;
  /** Ruta en el bucket "media", para poder reemplazarla o borrarla. */
  photoPath?: string | null;
  role: MonitorRole;
  active: boolean;
  /** Perfil de la app, si tiene acceso (su coordinador siempre lo tiene). */
  profileId: string | null;
  notes: string;
  attendanceHistory: MonitorAttendanceRecord[];
}

/**
 * Un registro de asistencia de un monitor. Mismo planteamiento que
 * CatechistAttendanceRecord: los días de actividad llevan sus casillas y las
 * reuniones, un estado único.
 */
export interface MonitorAttendanceRecord {
  date: string;
  type: "activity" | "event";
  /** La casilla principal: catequesis en comunión, actividad en postcomunión. */
  activity?: AttendanceStatus;
  /** Solo en postcomunión: comunión no tiene misa. */
  mass?: AttendanceStatus;
  /** Reuniones (type 'event'). */
  status?: AttendanceStatus;
  /** Id del evento, si type es 'event'. */
  refId?: string;
}

/** Las casillas de un día de actividad, en el orden en que se pasan. */
export type MonitorSlot = "mass" | "activity";

export interface MonitorStageConfig {
  /** Cómo se llama la etapa. */
  label: string;
  /** "Monitores de comunión". */
  teamLabel: string;
  /** Las casillas del día, por horario: en postcomunión la misa va primero. */
  slots: MonitorSlot[];
  /** Peso de cada casilla en el día. Los tres suman 1. */
  weights: Record<MonitorSlot, number>;
  /** Etiquetas de cada casilla, larga y corta (para la tabla). */
  slotLabels: Record<MonitorSlot, { long: string; short: string }>;
  /** Cómo se llama un día del calendario. */
  dayLabel: string;
  dayLabelPlural: string;
  /** Cómo se llaman los eventos de la agenda de esta etapa. */
  meetingLabel: string;
  meetingLabelPlural: string;
}

/**
 * Cómo se pasa lista en cada etapa:
 *
 *   - comunión: una sola casilla, la catequesis. No tienen misa, así que el
 *     día entero vale por ella.
 *   - postcomunión: misa y actividad, en ese orden porque la misa va antes.
 *     Los pesos son los de siempre (0,6 la principal y 0,4 la misa), igual
 *     que en catequesis y confirmación.
 *
 * En las dos, un "tarde" vale la mitad y una reunión vale 1.
 */
export const MONITOR_STAGE_CONFIG: Record<MonitorStage, MonitorStageConfig> = {
  communion: {
    label: "Comunión",
    teamLabel: "Monitores de comunión",
    slots: ["activity"],
    weights: { activity: 1, mass: 0 },
    slotLabels: {
      activity: { long: "Catequesis", short: "Cat." },
      mass: { long: "Misa", short: "Misa" },
    },
    dayLabel: "día de actividad",
    dayLabelPlural: "días de actividad",
    meetingLabel: "reunión",
    meetingLabelPlural: "reuniones",
  },
  postcommunion: {
    label: "Postcomunión",
    teamLabel: "Monitores de postcomunión",
    slots: ["mass", "activity"],
    weights: { mass: 0.4, activity: 0.6 },
    slotLabels: {
      mass: { long: "Misa", short: "Misa" },
      activity: { long: "Actividad", short: "Act." },
    },
    dayLabel: "día de actividad",
    dayLabelPlural: "días de actividad",
    meetingLabel: "reunión",
    meetingLabelPlural: "reuniones",
  },
};

export const getMonitorStageConfig = (stage: MonitorStage): MonitorStageConfig =>
  MONITOR_STAGE_CONFIG[stage];

/** El estado de una casilla concreta de un registro. */
export const getMonitorSlotStatus = (
  record: Pick<MonitorAttendanceRecord, "activity" | "mass"> | null | undefined,
  slot: MonitorSlot
): AttendanceStatus =>
  ((slot === "mass" ? record?.mass : record?.activity) ?? "absent") as AttendanceStatus;

/**
 * Lo que suma un día de actividad, de 0 a 1. Es el equivalente de
 * calculateAttendanceWeight() para monitores: cada casilla aporta su peso si
 * se asistió y la mitad si se llegó tarde.
 */
export const calculateMonitorDayWeight = (
  stage: MonitorStage,
  record: Pick<MonitorAttendanceRecord, "activity" | "mass"> | null | undefined
): number => {
  const config = MONITOR_STAGE_CONFIG[stage];
  let score = 0;

  for (const slot of config.slots) {
    const status = slot === "mass" ? record?.mass : record?.activity;
    const weight = config.weights[slot];

    if (status === "present") score += weight;
    else if (status === "late") score += weight / 2;
  }

  return score;
};

/**
 * ¿Va esta reunión dirigida a los monitores de esta etapa? Las reuniones son
 * eventos de parish_events con la etapa de la etapa de monitores. Los eventos
 * específicos (por lista de invitados) quedan fuera: los invitados son
 * perfiles de la app y un monitor no tiene ninguno.
 */
export const meetingAppliesToStage = (
  event: Pick<ParishEvent, "stage" | "inviteOnly">,
  stage: MonitorStage
): boolean => !event.inviteOnly && event.stage === stage;

/** Las reuniones de una etapa, de la agenda que se tenga cargada. */
export const getMeetingsForStage = (
  events: ParishEvent[],
  stage: MonitorStage
): ParishEvent[] => events.filter((event) => meetingAppliesToStage(event, stage));

/** Las que además cuentan para el porcentaje de asistencia. */
export const getMeetingsCountingForStage = (
  events: ParishEvent[],
  stage: MonitorStage
): ParishEvent[] =>
  getMeetingsForStage(events, stage).filter((event) => event.countsForAttendance !== false);

/**
 * Porcentaje de asistencia de un monitor, con la misma cuenta que
 * calculateCatechistRate(): los días de actividad del curso que ya han pasado
 * más las reuniones que ya han empezado, cada día valiendo 1 (repartido entre
 * sus casillas) y cada reunión valiendo 1.
 *
 * `activityDays` son los días de actividad de SU etapa: comunión y
 * postcomunión tienen calendarios independientes.
 */
export const calculateMonitorRate = (
  monitor: Monitor,
  activityDays: string[],
  events: ParishEvent[],
  academicYear?: AcademicYear
): number => {
  const year = academicYear ?? getCurrentAcademicYear();
  const cutoff = getAcademicYearCutoff(year);

  const pastDays = activityDays.filter((day) => day >= year.start && day <= cutoff);
  const pastMeetings = getMeetingsCountingForStage(events, monitor.stage).filter((event) =>
    isPastEvent(event.date, year)
  );

  const totalOccurrences = pastDays.length + pastMeetings.length;
  if (totalOccurrences === 0) return 100;

  const history = monitor.attendanceHistory ?? [];
  let earnedPoints = 0;

  for (const day of pastDays) {
    const record = history.find((h) => h.date === day && h.type === "activity");
    earnedPoints += calculateMonitorDayWeight(monitor.stage, record);
  }

  // Las reuniones son binarias, igual que los eventos de los catequistas en
  // calculateCatechistRate(): solo suma el "asistió".
  for (const meeting of pastMeetings) {
    const record = history.find((h) => h.type === "event" && h.refId === meeting.id);
    if (record?.status === "present") earnedPoints += 1;
  }

  return Math.round((earnedPoints / totalOccurrences) * 100);
};

/**
 * Cómo se guarda el nombre de un monitor: en mayúsculas y sin espacios en los
 * extremos. La regla la impone además un trigger de la base de datos
 * (supabase/sql/monitors_name_upper.sql), que es lo que la garantiza para
 * cualquier camino de escritura; esto es para que el estado local y la
 * pantalla digan ya lo mismo que la tabla, sin esperar a recargar.
 *
 * Para el campo mientras se escribe NO sirve: recortar los espacios a cada
 * tecla impediría separar las palabras. Allí basta con toUpperCase().
 */
export const toMonitorName = (name: string): string => name.trim().toUpperCase();

export const sortMonitorsByName = (monitors: Monitor[]): Monitor[] =>
  [...monitors].sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
