
export type UserRole = 'catechist' | 'coordinator';

export type AttendanceStatus = 'present' | 'absent' | 'late';

export interface User {
  id: string;
  name: string;
  email: string;
  password?: string; // Added password field
  role: UserRole;
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
  catechistIds: string[]; // IDs of users assigned to this group
}

export interface ParishEvent {
  id: string;
  title: string;
  date: string;
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
 * Calculates attendance rate considering all class days in the current academic year (Sept-Aug)
 * that have already passed.
 */
export const calculateStudentRate = (student: Student, classDays: string[]): number => {
  const today = getTodayStr();
  const { start, end } = getAcademicYearRange(today);
  
  const relevantClassDays = classDays.filter(day => 
    day >= start && day <= end && day <= today
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
 * Calculates catechist attendance rate including class days and events.
 */
export const calculateCatechistRate = (catechist: User, classDays: string[], events: ParishEvent[]): number => {
  const today = getTodayStr();
  const { start, end } = getAcademicYearRange(today);
  
  const pastClassDays = classDays.filter(day => day >= start && day <= end && day <= today);
  const pastEvents = events.filter(e => e.date >= start && e.date <= end && e.date <= today);
  
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
