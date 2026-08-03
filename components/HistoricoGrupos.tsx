import React, { useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronLeft, FolderOpen } from "lucide-react";
import { Group, Student } from "../types";
import { getTodayStr } from "../types";
import { AcademicYear } from "../src/utils/academicYear";
import Historial from "./Historial";
import AttendanceDownloadButton from "./AttendanceDownloadButton";

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
  const hasParticipationOnDay = (student: Student, day: string) => {
    const record = student.attendanceHistory?.find((record) => record.date === day);

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

  const suspiciousCountByGroup = useMemo(() => {
    const historicalDays = classDays
      .filter((day) => day < todayRaw)
      .sort((a, b) => b.localeCompare(a));

    const result = new Map<string, number>();

    for (const group of sortedGroups) {
      const groupStudents = students.filter((student) => student.groupId === group.id);

      if (groupStudents.length === 0) {
        result.set(group.id, 0);
        continue;
      }

      let suspiciousCount = 0;

      for (const day of historicalDays) {
        const isSuspicious = groupStudents.every(
          (student) => !hasParticipationOnDay(student, day)
        );

        if (isSuspicious) suspiciousCount += 1;
      }

      result.set(group.id, suspiciousCount);
    }

    return result;
  }, [groups, students, classDays, todayRaw, sortedGroups]);

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
              Accede al histórico de cualquier grupo y detecta los días sin
              participación registrada.
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
            const suspiciousCount = suspiciousCountByGroup.get(group.id) ?? 0;
            const groupStudentsCount = students.filter(
              (student) => student.groupId === group.id
            ).length;

            const groupStudents = students.filter(
              (student) => student.groupId === group.id
            );

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