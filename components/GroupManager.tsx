

import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  ChevronRight,
  Edit2,
  User as UserIcon,
  Check,
  X,
  ArrowRightLeft,
  GraduationCap,
  UserPlus
} from 'lucide-react';
import { Group, Student, User } from '../types';
import { isPromotionMonth } from '../src/utils/coursePromotion';
import { ImportedStudent } from '../src/utils/studentImport';
import PromoteYearDialog from './PromoteYearDialog';
import ImportGroupDialog from './ImportGroupDialog';

interface GroupManagerProps {
  groups: Group[];
  students: Student[];
  users: User[];
  classDays: string[];
  isOnline: boolean;
  /** Fecha de la última promoción del curso en marcha, o null si no se ha hecho. */
  lastPromotionAt: string | null;
  onUpdateGroup: (g: Group) => void;
  onUpdateStudent: (s: Student) => void;
  onAssignCatechist: (
    catechistId: string,
    groupId: string | null,
    assign: boolean
  ) => void;
  onPromoteYear: () => Promise<void>;
  onCreateGroupWithStudents: (
    name: string,
    catechistIds: string[],
    students: ImportedStudent[]
  ) => Promise<void>;
}

const GroupManager: React.FC<GroupManagerProps> = ({
  groups,
  students,
  users,
  classDays,
  isOnline,
  lastPromotionAt,
  onUpdateGroup,
  onUpdateStudent,
  onAssignCatechist,
  onPromoteYear,
  onCreateGroupWithStudents
}) => {
  const [showPromoteDialog, setShowPromoteDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [movingStudent, setMovingStudent] = useState<Student | null>(null);
  const [targetGroupId, setTargetGroupId] = useState('');

  const selectedGroup = useMemo(
    () => groups.find(g => g.id === selectedGroupId) ?? null,
    [groups, selectedGroupId]
  );

  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [isEditingCatechists, setIsEditingCatechists] = useState(false);

  const catechists = users.filter(u => u.role === 'catechist' || u.role === 'coordinator');
  const groupStudents = students.filter(s => s.groupId === selectedGroup?.id);

  const assignedCatechists = selectedGroup
    ? catechists.filter(c => selectedGroup.catechistIds.includes(c.id))
    : [];

  // Reset editing states when group is deselected
  useEffect(() => {
    if (!selectedGroupId) {
      setIsEditingName(false);
      setIsEditingCatechists(false);
      cancelMoveStudent();
    }
  }, [selectedGroupId]);

  const handleUpdateName = async () => {
    if (!selectedGroup) return;
    try {
      await onUpdateGroup({ ...selectedGroup, name: newName });
      setIsEditingName(false);
    } catch (e) {
      console.error(e);
    }
  };

  const toggleCatechist = (userId: string) => {
    if (!selectedGroup) return;
    const isAssigned = selectedGroup.catechistIds.includes(userId);
    onAssignCatechist(userId, selectedGroup.id, !isAssigned);
  };

  const startMoveStudent = (student: Student) => {
    const firstAvailableGroup = groups.find(g => g.id !== student.groupId);

    setMovingStudent(student);
    setTargetGroupId(firstAvailableGroup?.id ?? '');
  };

  const cancelMoveStudent = () => {
    setMovingStudent(null);
    setTargetGroupId('');
  };

  const confirmMoveStudent = async () => {
    if (!movingStudent || !targetGroupId) return;

    try {
      await onUpdateStudent({
        ...movingStudent,
        groupId: targetGroupId,
      });

      cancelMoveStudent();
    } catch (e) {
      console.error(e);
    }
  };

  // El botón solo tiene sentido al principio del curso y una única vez.
  // Se comprueba contra el registro de promociones, no contra la existencia de
  // grupos de entrada: esa heurística se rearmaba en cuanto se creaba el grupo
  // de entrada del curso nuevo, permitiendo promocionar dos veces.
  const inPromotionWindow = isPromotionMonth();
  const alreadyPromoted = lastPromotionAt !== null;
  const canPromote = inPromotionWindow && !alreadyPromoted && isOnline;

  const promoteBlockedReason = !inPromotionWindow
    ? 'Solo se puede promocionar en agosto, septiembre u octubre.'
    : alreadyPromoted
    ? `Ya se promocionó el ${new Date(lastPromotionAt!).toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })}. No se puede repetir este curso.`
    : !isOnline
    ? 'Necesitas conexión para promocionar el curso.'
    : '';

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-extrabold text-slate-900 flex items-center gap-2">
            <GraduationCap size={20} className="text-indigo-600 shrink-0" />
            Cambio de curso
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            {canPromote
              ? 'Sube todos los grupos un nivel y da de baja a los que terminan la catequesis.'
              : promoteBlockedReason}
          </p>
        </div>

        <button
          type="button"
          disabled={!canPromote}
          onClick={() => setShowPromoteDialog(true)}
          title={canPromote ? undefined : promoteBlockedReason}
          className={`px-5 py-3 rounded-2xl font-extrabold text-sm shrink-0 transition-colors ${
            canPromote
              ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
          }`}
        >
          NUEVO CURSO
        </button>
      </div>

      {showImportDialog && (
        <ImportGroupDialog
          groups={groups}
          catechists={catechists}
          onClose={() => setShowImportDialog(false)}
          onCreate={async (name, catechistIds, importedStudents) => {
            await onCreateGroupWithStudents(name, catechistIds, importedStudents);
            setShowImportDialog(false);
          }}
        />
      )}

      {showPromoteDialog && (
        <PromoteYearDialog
          groups={groups}
          students={students}
          classDays={classDays}
          onClose={() => setShowPromoteDialog(false)}
          onConfirm={async () => {
            await onPromoteYear();
            setShowPromoteDialog(false);
          }}
        />
      )}

      <div className="flex items-center justify-between gap-4 pt-2">
        <h3 className="font-extrabold text-slate-900">
          Grupos
          <span className="ml-2 text-sm font-bold text-slate-400">{groups.length}</span>
        </h3>

        <button
          type="button"
          disabled={!isOnline}
          onClick={() => setShowImportDialog(true)}
          title={isOnline ? undefined : 'Necesitas conexión para crear un grupo.'}
          className={`px-5 py-3 rounded-2xl font-extrabold text-sm shrink-0 transition-colors flex items-center gap-2 ${
            isOnline
              ? 'bg-white text-indigo-700 border border-indigo-300 hover:bg-indigo-50'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200'
          }`}
        >
          <UserPlus size={18} />
          CREAR GRUPO NUEVO
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {groups.map(group => (
          <div 
            key={group.id}
            onClick={() => { setSelectedGroupId(group.id); setNewName(group.name); }}
            className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer group"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                <Users size={24} />
              </div>
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                {students.filter(s => s.groupId === group.id).length} Catecúmenos
              </span>
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">{group.name}</h3>
            <p className="text-xs text-slate-500">
              {group.catechistIds.length} Catequistas asignados
            </p>
          </div>
        ))}
      </div>

      {selectedGroup && (
        <>
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-end">
            <div className="bg-white w-full max-w-2xl h-full shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300 flex flex-col">
              <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50 sticky top-0 z-10">
                <button 
                  onClick={() => setSelectedGroupId(null)}  // This will close the group editor
                  className="p-2 hover:bg-slate-200 rounded-full text-slate-500 transition-colors"
                >
                  <ChevronRight className="rotate-180" size={24} />
                </button>
                <h2 className="text-xl font-bold text-slate-900">Configuración de Grupo</h2>
                <div className="w-10"></div>
              </div>

              <div className="p-8 space-y-8">
                {/* Group Name Section */}
                <section className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-bold text-slate-800 uppercase text-xs tracking-widest">Nombre del Grupo</h4>
                    {!isEditingName && (
                      <button onClick={() => setIsEditingName(true)} className="text-indigo-600 p-1 hover:bg-indigo-50 rounded-lg">
                        <Edit2 size={16} />
                      </button>
                    )}
                  </div>
                  {isEditingName ? (
                    <div className="flex gap-2">
                      <input 
                        className="flex-1 px-4 py-2 border rounded-xl" 
                        value={newName} 
                        onChange={e => setNewName(e.target.value)}
                      />
                      <button onClick={handleUpdateName} className="p-2 bg-green-600 text-white rounded-xl"><Check size={20} /></button>
                      <button onClick={() => setIsEditingName(false)} className="p-2 bg-red-100 text-red-600 rounded-xl"><X size={20} /></button>
                    </div>
                  ) : (
                    <p className="text-2xl font-bold text-slate-900">{selectedGroup.name}</p>
                  )}
                </section>

                {/* Catechists Section */}
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-bold text-slate-800 uppercase text-xs tracking-widest">
                      Catequistas Autorizados
                    </h4>
                    <button
                      onClick={() => setIsEditingCatechists(v => !v)}
                      className="text-indigo-600 px-3 py-1.5 rounded-xl hover:bg-indigo-50 text-xs font-bold"
                    >
                      {isEditingCatechists ? 'Cerrar' : 'Editar'}
                    </button>
                  </div>

                  {!isEditingCatechists ? (
                    <div className="grid grid-cols-2 gap-4">
                      {assignedCatechists.map(cat => (
                        <div
                          key={cat.id}
                          className="flex items-center gap-3 p-4 rounded-xl border border-slate-100 bg-white text-slate-700"
                        >
                          <UserIcon size={18} className="text-slate-400" />
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm truncate">{cat.name}</p>
                            <p className="text-[10px] text-slate-400 truncate">{cat.email}</p>
                          </div>
                        </div>
                      ))}

                      {assignedCatechists.length === 0 && (
                        <div className="col-span-2 p-6 bg-slate-50 rounded-2xl text-sm text-slate-500">
                          Este grupo no tiene catequistas autorizados.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      {catechists.map(cat => {
                        const isAssigned = selectedGroup.catechistIds.includes(cat.id);
                        return (
                          <button
                            key={cat.id}
                            onClick={() => toggleCatechist(cat.id)}
                            className={`flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-left ${
                              isAssigned
                                ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                                : 'border-slate-100 bg-white text-slate-500 hover:border-slate-200'
                            }`}
                          >
                            <UserIcon size={18} />
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-sm truncate">{cat.name}</p>
                              <p className="text-[10px] opacity-70 truncate">{cat.email}</p>
                            </div>
                            {isAssigned && <Check size={16} />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Participants Section */}
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="font-bold text-slate-800 uppercase text-xs tracking-widest">Niños Participantes</h4>
                    <span className="bg-slate-100 px-3 py-1 rounded-full text-xs font-bold text-slate-500">{groupStudents.length} Niños</span>
                  </div>
                  <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden divide-y divide-slate-50">
                    {groupStudents.map(student => (
                      <div key={student.id} className="p-4 flex items-center justify-between hover:bg-slate-50 group">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center font-bold text-slate-500 overflow-hidden">
                            {student.photo ? (
                              <img src={student.photo} alt={student.name} className="w-full h-full object-cover" />
                            ) : (
                              student.name[0]
                            )}
                          </div>
                          <div>
                            <p className="font-bold text-sm text-slate-800">{student.name}</p>
                            <p className="text-[10px] text-slate-400">{student.school}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => startMoveStudent(student)}
                          className="text-slate-400 hover:text-indigo-600 transition-colors p-2"
                          title="Cambiar de grupo"
                        >
                          <ArrowRightLeft size={16} />
                        </button>
                      </div>
                    ))}
                    {groupStudents.length === 0 && (
                      <div className="p-8 text-center text-slate-400 text-sm">No hay niños asignados a este grupo.</div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>
          {movingStudent && (
            <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-6 space-y-5">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Cambiar de grupo
                  </h3>
                  <p className="text-sm text-slate-500 mt-1">
                    Selecciona el nuevo grupo para {movingStudent.name}.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                    Nuevo grupo
                  </label>

                  <select
                    value={targetGroupId}
                    onChange={e => setTargetGroupId(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl bg-white text-slate-800"
                  >
                    {groups
                      .filter(group => group.id !== movingStudent.groupId)
                      .map(group => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                  </select>

                  {groups.filter(group => group.id !== movingStudent.groupId).length === 0 && (
                    <p className="text-sm text-red-500 mt-2">
                      No hay otros grupos disponibles.
                    </p>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={cancelMoveStudent}
                    className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-600 font-bold"
                  >
                    Cancelar
                  </button>

                  <button
                    onClick={confirmMoveStudent}
                    disabled={!targetGroupId}
                    className="flex-1 py-3 rounded-xl bg-indigo-600 text-white font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Cambiar
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default GroupManager;