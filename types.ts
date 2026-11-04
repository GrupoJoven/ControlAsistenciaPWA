import { AcademicYear, getAcademicYearCutoff, getCurrentAcademicYear, isPastEvent } from './src/utils/academicYear';
import { getEventsCountingForUser } from './src/utils/stages';
import type { EventGrade, EventStage, Stage, StageGrade } from './src/utils/stages';

export type UserRole = 'catechist' | 'coordinator';

export type AttendanceStatus = 'present' | 'absent' | 'late';

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string; // Added password field
  role: UserRole;
  /**
   * Etapa del perfil (profiles.stage). En un coordinator, null = global.
   * En un catequista es opcional: sus etapas reales salen de sus grupos.
   */
  stage?: Stage | null;
  /** Etapas efectivas (ver getUserStages). Lo calcula App, no viene de la BD. */
  stages?: Stage[];
  /** Etapas y cursos efectivos (ver getUserStageGrades). Lo calcula App. */
  stageGrades?: StageGrade[];
  assignedGroupId?: string; // Main group for catechist view
  birthDate?: string;
  photo?: string;
  attendanceHistory?: CatechistAttendanceRecord[];
}

export interface CatechistAttendanceRecord {
  date: string;
  type: 'class' | 'event';
  status?: AttendanceStatus; // Used for events (present/absent)
  catechism?: AttendanceStatus; // Used for class days
  mass?: AttendanceStatus; // Used for class days
  refId?: string; // event id if type is 'event'
}

export interface Group {
  id: string;
  name: string;
  /** Etapa derivada del nombre (groups.stage, columna generada). */
  stage: Stage | null;
  catechistIds: string[]; // IDs of users assigned to this group
}

export interface ParishEvent {
  id: string;
  title: string;
  date: string;
  /**
   * A quién afecta: una etapa o las dos. En un evento específico
   * (inviteOnly) solo dice quién lo gestiona, no a quién va dirigido.
   */
  stage: EventStage;
  /** Curso de esa etapa al que va dirigido. 0 = todos los cursos. */
  grade: EventGrade;
  /** Evento específico: solo lo ven (y les cuenta) los invitados. */
  inviteOnly: boolean;
  /** Si no cuenta, no entra en el porcentaje de asistencia de nadie. */
  countsForAttendance: boolean;
  /**
   * Invitados, solo en eventos específicos. Es lo que RLS deja leer: un
   * catequista solo ve su propia invitación, un coordinador las de los
   * eventos que gestiona.
   */
  inviteeIds: string[];
  description?: string;
}

export interface Student {
  id: string;
  publicId: string,
  name: string;
  gender: string,
  dni: string,
  email: string;
  parentEmail: string;
  school: string;
  birthDate: string;
  groupId: string;
  attendanceHistory: AttendanceRecord[];
  photo?: string; // Base64 or URL of the student's photo
}

export interface AttendanceRecord {
  date: string;
  catechism: AttendanceStatus;
  mass: AttendanceStatus;
  note?: string;
}

/**
 * Formats a Date object to YYYY-MM-DD using local time to avoid UTC shifts.
 */
export const formatDateLocal = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Returns today's date string in YYYY-MM-DD format (local time).
 */
export const getTodayStr = (): string => formatDateLocal(new Date());

/**
 * Returns the academic year start and end dates for a given date.
 * Academic year starts Sept 1st and ends Aug 31st.
 */
export const getAcademicYearRange = (targetDate: string) => {
  const d = new Date(targetDate);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-indexed, Sept is 8
  
  const startYear = month >= 8 ? year : year - 1;
  const endYear = startYear + 1;
  
  return {
    start: `${startYear}-09-01`,
    end: `${endYear}-08-31`
  };
};

export const calculateAttendanceWeight = (record: { catechism?: AttendanceStatus, mass?: AttendanceStatus }): number => {
  let score = 0;
  // Catechism (0.6): Present = 0.6, Late = 0.3, Absent = 0
  if (record.catechism === 'present') score += 0.6;
  else if (record.catechism === 'late') score += 0.3;

  // Mass (0.4): Present = 0.4, Late = 0.2, Absent = 0
  if (record.mass === 'present') score += 0.4;
  else if (record.mass === 'late') score += 0.2;
  
  return score;
};

/**
 * Calculates attendance rate considering all class days in the given academic year
 * (Sept-Aug) that have already passed. Defaults to the current academic year.
 */
export const calculateStudentRate = (
  student: Student,
  classDays: string[],
  academicYear?: AcademicYear
): number => {
  const year = academicYear ?? getCurrentAcademicYear();
  const cutoff = getAcademicYearCutoff(year);

  const relevantClassDays = classDays.filter(day =>
    day >= year.start && day <= cutoff
  );

  if (relevantClassDays.length === 0) return 100;

  let totalPointsEarned = 0;
  relevantClassDays.forEach(day => {
    const record = student.attendanceHistory.find(h => h.date === day);
    if (record) {
      totalPointsEarned += calculateAttendanceWeight(record);
    }
  });

  const rate = Math.round((totalPointsEarned / relevantClassDays.length) * 100);
  return Math.min(100, Math.max(0, rate));
};

/**
 * Calculates catechist attendance rate including class days and events, scoped to
 * the given academic year. Defaults to the current academic year.
 *
 * Solo cuentan los eventos dirigidos al catequista: a uno de preconfirmación
 * no se le descuenta un evento de confirmación, ni a uno de 1º uno de 2º, ni
 * un evento específico al que no estaba invitado. Los eventos marcados como
 * que no cuentan para la asistencia quedan fuera para todo el mundo.
 */
export const calculateCatechistRate = (
  catechist: User,
  classDays: string[],
  events: ParishEvent[],
  academicYear?: AcademicYear
): number => {
  const year = academicYear ?? getCurrentAcademicYear();
  const cutoff = getAcademicYearCutoff(year);

  // Sin etapas calculadas solo le cuentan los eventos para todo el mundo: el
  // lado seguro es no exigirle un evento que quizá no era para él.
  const applicableEvents = getEventsCountingForUser(events, catechist);

  // Un día lectivo cuenta desde que empieza el día; un evento, desde su hora.
  const pastClassDays = classDays.filter(day => day >= year.start && day <= cutoff);
  const pastEvents = applicableEvents.filter(e => isPastEvent(e.date, year));

  const totalOccurrences = pastClassDays.length + pastEvents.length;
  if (totalOccurrences === 0) return 100;

  let earnedPoints = 0;
  const history = catechist.attendanceHistory || [];

  // Each class day for catechist: weight sum of catechism + mass
  pastClassDays.forEach(day => {
    const record = history.find(h => h.date === day && h.type === 'class');
    if (record) {
      earnedPoints += calculateAttendanceWeight(record);
    }
  });

  // Events are binary: present = 1, absent = 0
  pastEvents.forEach(event => {
    const record = history.find(h => h.refId === event.id && h.type === 'event');
    if (record && record.status === 'present') earnedPoints += 1;
  });

  return Math.round((earnedPoints / totalOccurrences) * 100);
};
