import React, { useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronLeft, FolderOpen } from "lucide-react";
import { AttendanceRecord, Group, Student } from "../types";
import { calculateAttendanceWeight, getTodayStr } from "../types";
import { AcademicYear } from "../src/utils/academicYear";
import Historial from "./Historial";
import AttendanceDownloadButton from "./AttendanceDownloadButton";

interface GroupStats {
  studentsCount: number;
  /** Días lectivos pasados en los que nadie del grupo tiene participación. */
  suspiciousCount: number;
  /**
   * Participación media del grupo (0-100), con los mismos pesos que el
   * porcentaje de cada alumno. null si todavía no hay días con datos.
   */
  averageRate: number | null;
  /** Catecúmenos que acuden de media cada día lectivo. null si no hay datos. */
  averagePerDay: number | null;
}

const rateColor = (rate: number) =>
  rate > 80 ? "text-green-600" : rate > 50 ? "text-amber-600" : "text-red-600";

const rateBarColor = (rate: number) =>
  rate > 80 ? "bg-green-500" : rate > 50 ? "bg-amber-500" : "bg-red-500";

interface HistoricoGruposProps {
  groups: Group[];
  students: Student[];
  /** Días lectivos del curso seleccionado. */
  classDays: string[];
  /** Todos los días lectivos, de cualquier curso, para la descarga completa. */
  allClassDays: string[];
  academicYear: AcademicYear;
  availableAcademicYears: AcademicYear[];
  canEdit: boolean;
  onUpdate: (
    date: string,
    studentId: string,
    type: "catechism" | "mass",
    status: "present" | "absent" | "late"
  ) => void;
  isOnline: boolean;
}

const HistoricoGrupos: React.FC<HistoricoGruposProps> = ({
  groups,
  students,
  classDays,
  allClassDays,
  academicYear,
  availableAcademicYears,
  canEdit,
  onUpdate,
  isOnline,
}) => {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);

  const todayRaw = getTodayStr();
  const hasParticipation = (
    record: AttendanceRecord | undefined
  ): record is AttendanceRecord => {
    if (!record) return false;

    const catechismParticipated =
      record.catechism === "present" || record.catechism === "late";

    const massParticipated =
      record.mass === "present" || record.mass === "late";

    return catechismParticipated || massParticipated;
  };

  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) =>
      a.name.localeCompare(b.name, "es", { sensitivity: "base" })
    );
  }, [groups]);

  const studentsByGroup = useMemo(() => {
    const result = new Map<string, Student[]>();

    for (const student of students) {
      const list = result.get(student.groupId) ?? [];
      list.push(student);
      result.set(student.groupId, list);
    }

    return result;
  }, [students]);

  /**
   * Los días sospechosos no cuentan para las medias: casi siempre son días en
   * los que no se pasó lista, y contarlos como 0 hundiría la previsión.
   */
  const statsByGroup = useMemo(() => {
    const historicalDays = classDays.filter((day) => day < todayRaw);
    const result = new Map<string, GroupStats>();

    for (const group of sortedGroups) {
      const groupStudents = studentsByGroup.get(group.id) ?? [];
      const recordsByStudent = groupStudents.map(
        (student) =>
          new Map((student.attendanceHistory ?? []).map((record) => [record.date, record]))
      );

      let suspiciousCount = 0;
      let countedDays = 0;
      let totalWeight = 0;
      let totalAttendees = 0;

      if (groupStudents.length > 0) {
        for (const day of historicalDays) {
          let dayWeight = 0;
          let dayAttendees = 0;

          for (const records of recordsByStudent) {
            const record = records.get(day);
            if (!hasParticipation(record)) continue;

            dayAttendees += 1;
            dayWeight += calculateAttendanceWeight(record);
          }

          if (dayAttendees === 0) {
            suspiciousCount += 1;
            continue;
          }

          countedDays += 1;
          totalWeight += dayWeight;
          totalAttendees += dayAttendees;
        }
      }

      result.set(group.id, {
        studentsCount: groupStudents.length,
        suspiciousCount,
        averageRate:
          countedDays > 0
            ? Math.round((totalWeight / (groupStudents.length * countedDays)) * 100)
            : null,
        averagePerDay: countedDays > 0 ? totalAttendees / countedDays : null,
      });
    }

    return result;
  }, [studentsByGroup, classDays, todayRaw, sortedGroups]);

  const selectedGroup = useMemo(() => {
    return groups.find((group) => group.id === selectedGroupId) ?? null;
  }, [groups, selectedGroupId]);

  const selectedGroupStudents = useMemo(() => {
    if (!selectedGroupId) return [];

    return students
      .filter((student) => student.groupId === selectedGroupId)
      .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
  }, [students, selectedGroupId]);

  if (selectedGroup) {
    return (
      <Historial
        students={selectedGroupStudents}
        classDays={classDays}
        allClassDays={allClassDays}
        groups={groups}
        academicYear={academicYear}
        availableAcademicYears={availableAcademicYears}
        canEdit={canEdit}
        scopeLabel={selectedGroup.name}
        onUpdate={onUpdate}
        isOnline={isOnline}
        parentLabel={selectedGroup.name}
        parentBackLabel="Volver a grupos"
        onParentBack={() => setSelectedGroupId(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-amber-600 to-orange-500 rounded-2xl p-6 lg:p-8 text-white shadow-lg">
        <div className="flex items-start justify-between gap-4 flex-col sm:flex-row">
          <div>
            <h2 className="text-xl lg:text-2xl font-bold flex items-center gap-2">
              <CalendarDays size={24} className="shrink-0" />
              Histórico grupos
            </h2>
            <p className="text-amber-50/90 text-xs lg:text-sm mt-1">
              Accede al histórico de cualquier grupo, consulta su asistencia
              media y detecta los días sin participación registrada.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="px-3 py-2 rounded-xl bg-white/10 border border-white/20 text-xs font-bold">
              {sortedGroups.length} grupo{sortedGroups.length === 1 ? "" : "s"}
            </div>

            <AttendanceDownloadButton
              students={students}
              classDays={allClassDays}
              groups={groups}
              availableYears={availableAcademicYears}
              selectedYear={academicYear}
              scopeLabel="Todos los grupos"
              buttonLabel="Descargar todo"
              variant="onDark"
            />
          </div>
        </div>
      </div>

      {sortedGroups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="py-16 px-6 text-center">
            <h3 className="text-lg font-bold text-slate-900">
              No hay grupos para mostrar
            </h3>
            <p className="text-sm text-slate-500 mt-2">
              Todavía no hay grupos creados en la aplicación.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {sortedGroups.map((group) => {
            const {
              studentsCount: groupStudentsCount,
              suspiciousCount,
              averageRate,
              averagePerDay,
            } = statsByGroup.get(group.id) ?? {
              studentsCount: 0,
              suspiciousCount: 0,
              averageRate: null,
              averagePerDay: null,
            };

            const groupStudents = studentsByGroup.get(group.id) ?? [];

            return (
              <div
                key={group.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedGroupId(group.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelectedGroupId(group.id);
                  }
                }}
                className="text-left bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-amber-300 transition-all p-5 cursor-pointer"
              >
                <div className="min-w-0">
                  <p className="text-base font-bold text-slate-900 truncate">
                    {group.name}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {groupStudentsCount} catecúmeno
                    {groupStudentsCount === 1 ? "" : "s"}
                  </p>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  {/* El valor va anclado abajo para que los dos números queden
                      alineados aunque una etiqueta ocupe dos líneas. */}
                  <div className="flex flex-col rounded-xl bg-slate-50 px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-widest font-bold text-slate-400">
                      Asistencia media
                    </p>
                    <div className="mt-auto pt-1">
                      {averageRate === null ? (
                        <p className="text-2xl font-extrabold text-slate-300">—</p>
                      ) : (
                        <p className={`text-2xl font-extrabold ${rateColor(averageRate)}`}>
                          {averageRate}%
                        </p>
                      )}
                      <div className="mt-2 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        {averageRate !== null && (
                          <div
                            className={`h-full rounded-full ${rateBarColor(averageRate)}`}
                            style={{ width: `${averageRate}%` }}
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  <div
                    className="flex flex-col rounded-xl bg-slate-50 px-3 py-2.5"
                    title={
                      averagePerDay === null
                        ? undefined
                        : `${averagePerDay.toLocaleString("es-ES", {
                            maximumFractionDigits: 1,
                          })} catecúmenos de media por domingo`
                    }
                  >
                    <p className="text-[11px] uppercase tracking-widest font-bold text-slate-400">
                      Por domingo
                    </p>
                    <div className="mt-auto pt-1">
                      {averagePerDay === null ? (
                        <p className="text-2xl font-extrabold text-slate-300">—</p>
                      ) : (
                        <p className="text-2xl font-extrabold text-slate-900">
                          {Math.round(averagePerDay)}
                          <span className="text-xs font-bold text-slate-400 ml-1">
                            de {groupStudentsCount}
                          </span>
                        </p>
                      )}
                      <div className="mt-2 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        {averagePerDay !== null && (
                          <div
                            className="h-full rounded-full bg-slate-400"
                            style={{
                              width: `${(averagePerDay / groupStudentsCount) * 100}%`,
                            }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-widest font-bold text-slate-400">
                      Días sospechosos
                    </p>
                    <p className="text-2xl font-extrabold text-slate-900 mt-1">
                      {suspiciousCount}
                    </p>
                  </div>

                  {suspiciousCount > 0 ? (
                    <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-700">
                      <AlertTriangle size={12} />
                      Revisar
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-700">
                      Al día
                    </div>
                  )}
                </div>

                <div className="mt-4 pt-4 border-t border-slate-100">
                  <AttendanceDownloadButton
                    students={groupStudents}
                    classDays={allClassDays}
                    groups={groups}
                    availableYears={availableAcademicYears}
                    selectedYear={academicYear}
                    scopeLabel={group.name}
                    variant="subtle"
                    className="w-full justify-center"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default HistoricoGrupos;