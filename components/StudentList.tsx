
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { supabase } from "../src/lib/supabaseClient";
import { 
  Plus, 
  ChevronRight,
  Filter,
  School,
  Cake,
  BookOpen,
  Church,
  Save,
  Trash2,
  X,
  UserPlus,
  Edit3,
  Camera,
  Image as ImageIcon,
  Clock,
  Mail
} from 'lucide-react';
import { Student, AttendanceRecord, calculateAttendanceWeight, Group, calculateStudentRate, getTodayStr, AttendanceStatus } from '../types';
import { AcademicYear, getAcademicYearCutoff, getAcademicYearState } from '../src/utils/academicYear';
import AttendanceDownloadButton from './AttendanceDownloadButton';

interface StudentListProps {
  students: Student[];
  onUpdateStudent: (updatedStudent: Student) => void;
  canEditCenso?: boolean;
  onAddStudent?: (s: Student) => void;
  onRemoveStudent?: (id: string) => Promise<void>;
  groups?: Group[];
  classDays: string[];
  academicYear: AcademicYear;
  availableAcademicYears: AcademicYear[];
  /** false en cursos ya cerrados cuando el usuario no es coordinator. */
  canEditAttendance: boolean;
  /** Etiqueta del conjunto mostrado, usada al descargar el histórico completo. */
  downloadScopeLabel: string;
  warningMessage?: string;
  warningType?: "no-group" | "no-students";
  enableMassServices?: boolean;
  schoolNames: { id: string; name: string }[];
  isOnline: boolean;
}

const StudentList: React.FC<StudentListProps> = ({
  students,
  onUpdateStudent,
  canEditCenso,
  onAddStudent,
  onRemoveStudent,
  groups = [],
  classDays,
  academicYear,
  availableAcademicYears,
  canEditAttendance,
  downloadScopeLabel,
  warningMessage,
  warningType,
  enableMassServices = false,
  schoolNames,
  isOnline
}) => {
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [tempName, setTempName] = useState('');
  const [tempSchool, setTempSchool] = useState('');
  const [tempEmail, setTempEmail] = useState('');
  const [tempParentEmail, setTempParentEmail] = useState('');
  const [tempBirthDate, setTempBirthDate] = useState('');
  const [tempGender, setTempGender] = useState('');
  const [tempPhoto, setTempPhoto] = useState<string | undefined>(undefined);
  const [tempHistory, setTempHistory] = useState<AttendanceRecord[]>([]);

  const [isAddingNew, setIsAddingNew] = useState(false);
  const [filterGroupId, setFilterGroupId] = useState<string>('all');

  const [newName, setNewName] = useState('');
  const [newSchool, setNewSchool] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newDni, setNewDni] = useState('');
  const [newGender, setNewGender] = useState('');
  const [newParentEmail, setNewParentEmail] = useState('');

  const [newBirthDate, setNewBirthDate] = useState('2015-01-01');
  const [newGroup, setNewGroup] = useState(groups[0]?.id || '');
  const [confirmDeleteStudent, setConfirmDeleteStudent] = useState<Student | null>(null);

  type ServiceType = "B" | "L" | "P";

  const SERVICES: { key: ServiceType; label: ServiceType; onClasses: string }[] = [
    { key: "B", label: "B", onClasses: "bg-amber-700 text-white border-amber-700" },
    { key: "L", label: "L", onClasses: "bg-yellow-400 text-slate-900 border-yellow-500" },
    { key: "P", label: "P", onClasses: "bg-emerald-600 text-white border-emerald-600" },
  ];

  const offClasses = "bg-slate-100 text-slate-400 border-slate-200";

  const [servicesToday, setServicesToday] = useState<Set<ServiceType>>(new Set());
  const [servicesLoading, setServicesLoading] = useState(false);
  const [servicesToggling, setServicesToggling] = useState<ServiceType | null>(null);


  const filteredStudents = useMemo(() => {
    if (filterGroupId === 'all') return students.sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
    return students
      .filter(s => s.groupId === filterGroupId)
      .sort((a, b) => a.name.localeCompare(b.name, "es", { sensitivity: "base" }));
  }, [students, filterGroupId]);

  const getFullHistory = (student: Student) => {
    const cutoff = getAcademicYearCutoff(academicYear);
    const relevantClassDays = classDays.filter(day => day >= academicYear.start && day <= cutoff);

    const fullHistory = relevantClassDays.map(day => {
      const existing = student.attendanceHistory.find(h => h.date === day);
      if (existing) return { ...existing };
      return { date: day, catechism: 'absent' as AttendanceStatus, mass: 'absent' as AttendanceStatus };
    });

    return fullHistory.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  };

  const loadStudentServicesToday = async (studentId: string) => {
    if (!isOnline) {
      setServicesToday(new Set());
      return;
    }
    const today = getTodayStr();
    setServicesLoading(true);
    try {
      const { data, error } = await supabase
        .from("mass_services")
        .select("service_type")
        .eq("student_id", studentId)

      if (error) throw error;

      const set = new Set<ServiceType>();
      for (const r of (data ?? []) as any[]) set.add(r.service_type as ServiceType);
      setServicesToday(set);
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Error cargando servicios");
      setServicesToday(new Set());
    } finally {
      setServicesLoading(false);
    }
  };

  // Al cambiar de curso académico con la ficha abierta, se recarga el detalle
  // para que no siga mostrando los días del curso anterior.
  useEffect(() => {
    if (!selectedStudent) return;

    setTempHistory(getFullHistory(selectedStudent));
    setIsEditing(false);
  }, [academicYear.key]);

  const handleOpenDetail = (student: Student) => {
    setSelectedStudent(student);
    setTempName(student.name);
    setTempSchool(student.school ?? '');
    setTempEmail(student.email ?? '');
    setTempParentEmail(student.parentEmail ?? '');
    setTempBirthDate(student.birthDate);
    setTempGender(student.gender ?? '');
    setTempPhoto(student.photo);
    setTempHistory(getFullHistory(student));
    setIsEditing(false);
    if (enableMassServices && isOnline) {
      void loadStudentServicesToday(student.id);
    } else {
      setServicesToday(new Set());
    }
  };

  const handleContact = (student: Student) => {
    const subject = encodeURIComponent(`Parroquia San Pascual Baylón - Información sobre ${student.name}`);
    const to = (isEditing ? tempParentEmail : student.parentEmail) || student.parentEmail;
    if (!to) {
      alert("No hay email de padres para este alumno.");
      return;
    }
    window.location.href = `mailto:${to}?subject=${subject}`;
  };

  const signStudentPhoto = async (path: string) => {
    const { data, error } = await supabase.storage
      .from("media")
      .createSignedUrl(path, 60 * 60);
    if (error || !data?.signedUrl) return "";
    return data.signedUrl;
  };

  const deleteStorageFolder = async (prefix: string) => {
    // En Supabase Storage no existen "carpetas" reales.
    // Para borrar una subcarpeta, listamos los objetos bajo el prefijo y los eliminamos.
    const bucket = supabase.storage.from("media");

    let offset = 0;
    const limit = 100;
    while (true) {
      const { data, error } = await bucket.list(prefix, {
        limit,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw error;

      const items = data ?? [];
      if (items.length === 0) break;

      const paths = items
        .filter((it: any) => !!it?.name)
        .map((it: any) => `${prefix}/${it.name}`);

      if (paths.length > 0) {
        const { error: rmErr } = await bucket.remove(paths);
        if (rmErr) throw rmErr;
      }

      if (items.length < limit) break;
      offset += limit;
    }
  };

  const handlePhotoDelete = async () => {
    if (!isOnline) {
      alert("No hay conexión. No se puede eliminar la foto hasta que vuelva internet.");
      return;
    }
    if (!selectedStudent?.id) return;

    if (!tempPhoto) {
      alert("Este alumno no tiene foto de perfil.");
      return;
    }

    const ok = window.confirm(
      "¿Eliminar la foto de perfil? Se borrará del Storage y se quitará del alumno."
    );
    if (!ok) return;

    try {
      const prefix = `students/${selectedStudent.id}`;

      // 1) borrar subcarpeta completa (todos los objetos bajo students/<id>/)
      await deleteStorageFolder(prefix);

      // 2) limpiar photo_path en BD
      const { error: dbErr } = await supabase
        .from("students")
        .update({ photo_path: null })
        .eq("id", selectedStudent.id);

      if (dbErr) {
        alert("Foto borrada del Storage, pero no se pudo actualizar el alumno: " + dbErr.message);
      }

      // 3) reflejo en UI
      setTempPhoto(undefined);
      const updated: Student = { ...selectedStudent, photo: undefined };
      onUpdateStudent(updated);
      setSelectedStudent(updated);
    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Error eliminando foto");
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isOnline) {
      alert("No hay conexión. No se puede subir la foto hasta que vuelva internet.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    try {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!selectedStudent?.id) {
        alert("Primero guarda/crea el alumno y después podrás subir la foto.");
        return;
      }

      if (!file.type.startsWith("image/")) {
        alert("El archivo debe ser una imagen.");
        return;
      }

      if (file.size > 2 * 1024 * 1024) {
        alert("La imagen no puede superar 2MB.");
        return;
      }

      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `students/${selectedStudent.id}/photo.${ext}`;

      // 1) subir a storage
      const { error: upErr } = await supabase.storage
        .from("media")
        .upload(path, file, { upsert: true, contentType: file.type });

      if (upErr) {
        alert("Error subiendo imagen: " + upErr.message);
        return;
      }

      // 2) guardar ruta en BD
      const { error: dbErr } = await supabase
        .from("students")
        .update({ photo_path: path })
        .eq("id", selectedStudent.id);

      if (dbErr) {
        alert("Imagen subida, pero no se pudo guardar en alumno: " + dbErr.message);
        return;
      }

      // 3) preview inmediata
      const signedUrl = await signStudentPhoto(path);
      setTempPhoto(signedUrl || URL.createObjectURL(file));

      if (selectedStudent) {
        const updated: Student = {
          ...selectedStudent,
          photo: signedUrl || selectedStudent.photo,
        };
        // esto actualiza la lista en App.tsx porque updateStudent ya hace setStudents
        onUpdateStudent(updated);
        setSelectedStudent(updated);
      }
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const toggleServiceToday = async (serviceType: ServiceType) => {
    if (!isOnline) {
      alert("No hay conexión. No se pueden modificar los servicios hasta que vuelva internet.");
      return;
    }
    if (!selectedStudent) return;

    // Solo editable en modo edición
    if (!isEditing) return;

    if (servicesToggling) return;
    setServicesToggling(serviceType);

    const today = getTodayStr();

    // optimista
    const prev = new Set(servicesToday);
    const next = new Set(prev);
    const isOn = next.has(serviceType);
    if (isOn) next.delete(serviceType);
    else next.add(serviceType);
    setServicesToday(next);

    try {
      if (!isOn) {
        const { error } = await supabase.from("mass_services").insert({
          student_id: selectedStudent.id,
          service_type: serviceType,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("mass_services")
          .delete()
          .eq("student_id", selectedStudent.id)
          .eq("service_type", serviceType);
        if (error) throw error;
      }
    } catch (e: any) {
      console.error(e);
      // rollback
      setServicesToday(prev);
      alert(e?.message ?? "Error guardando servicio");
    } finally {
      setServicesToggling(null);
    }
  };
  const handleSave = () => {
    if (!isOnline) {
      alert("No hay conexión. No se pueden guardar cambios hasta que vuelva internet.");
      return;
    }
    if (!selectedStudent) return;

    if (!tempEmail.trim()) {
      alert("El email del niño es obligatorio.");
      return;
    }
    if (!tempGender.trim()) {
      alert("Debes seleccionar el género.");
      return;
    }

    // tempHistory solo contiene el curso que se está viendo. Se conservan los
    // registros del resto de cursos para no vaciarlos en la vista al guardar.
    const otherYearsHistory = (selectedStudent.attendanceHistory ?? []).filter(
      record => record.date < academicYear.start || record.date > academicYear.end
    );

    const updated: Student = {
      ...selectedStudent,
      name: tempName,
      gender: tempGender.trim(),
      school: tempSchool.trim() ? tempSchool.trim() : null,
      birthDate: tempBirthDate,
      photo: tempPhoto,
      email: tempEmail.trim(),
      parentEmail: tempParentEmail.trim(),
      attendanceHistory: [...otherYearsHistory, ...tempHistory],
    };

    onUpdateStudent(updated);
    setSelectedStudent(updated);
    setIsEditing(false);
  };


  const cycleStatus = (current: AttendanceStatus): AttendanceStatus => {
    if (current === 'absent') return 'present';
    if (current === 'present') return 'late';
    return 'absent';
  };

  const handleAddNew = () => {
    if (!isOnline) {
      alert("No hay conexión. No se puede crear el alumno hasta que vuelva internet.");
      return;
    }

    if (!onAddStudent || !newName.trim()) {
      alert("Debes introducir el nombre completo.");
      return;
    }

    if (!newDni.trim()) {
      alert("Debes introducir el DNI.");
      return;
    }

    if (!newGender.trim()) {
      alert("Debes seleccionar el género.");
      return;
    }

    if (!newEmail.trim()) {
      alert("Debes introducir el email del niño.");
      return;
    }

    if (!newParentEmail.trim()) {
      alert("Debes introducir el email de los padres.");
      return;
    }

    const s: Student = {
      id: "",
      publicId: "",
      name: newName.trim(),
      dni: newDni.trim(),
      gender: newGender.trim(),
      school: newSchool.trim() ? newSchool.trim() : null,
      email: newEmail.trim(),
      parentEmail: newParentEmail.trim(),
      birthDate: newBirthDate,
      groupId: newGroup,
      attendanceHistory: [],
    };

    onAddStudent(s);
    setIsAddingNew(false);
    setNewName('');
    setNewSchool('');
    setNewEmail('');
    setNewParentEmail('');
    setNewDni('');
    setNewGender('');
  };

  return (
    <div className="space-y-6">
      {warningMessage && (
        <div className="mb-4 p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-sm">
          <span className="font-bold">Aviso:</span> {warningMessage}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          {canEditCenso && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-600 text-sm font-medium">
              <Filter size={16} />
              <select className="bg-transparent outline-none cursor-pointer" value={filterGroupId} onChange={(e) => setFilterGroupId(e.target.value)}>
                <option value="all">Todos los grupos</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <AttendanceDownloadButton
            students={filteredStudents}
            classDays={classDays}
            groups={groups}
            availableYears={availableAcademicYears}
            selectedYear={academicYear}
            scopeLabel={
              filterGroupId === 'all'
                ? downloadScopeLabel
                : groups.find(g => g.id === filterGroupId)?.name ?? downloadScopeLabel
            }
            variant="subtle"
          />

        {canEditCenso && (
          <button
            disabled={!isOnline}
            onClick={() => setIsAddingNew(true)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold shadow-sm ${
              isOnline
                ? "bg-indigo-600 text-white hover:bg-indigo-700"
                : "bg-slate-200 text-slate-500 cursor-not-allowed"
            }`}
          >
            <UserPlus size={18} /> Nuevo Niño
          </button>
        )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredStudents.map(student => {
          const rate = calculateStudentRate(student, classDays, academicYear);
          const groupName = groups.find(g => g.id === student.groupId)?.name || 'SIN GRUPO';

          return (
            <div key={student.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow p-6 group cursor-pointer border-l-4 border-l-indigo-600 relative" onClick={() => handleOpenDetail(student)}>
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center font-bold text-indigo-700 overflow-hidden shrink-0">
                  {student.photo ? <img src={student.photo} className="w-full h-full object-cover" /> : student.name[0]}
                </div>
                {canEditCenso && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteStudent(student);
                    }}
                    className="p-2 text-slate-200 hover:text-red-500 transition-colors"
                    title="Eliminar alumno"
                  >
                    <Trash2 size={18} />
                  </button>
                )}

              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-1 truncate">{student.name}</h3>
              <p className="text-[10px] font-bold text-indigo-500 uppercase mb-2">{groupName}</p>
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-slate-400 uppercase mb-1.5"><span>Asistencia Real</span><span>{rate}%</span></div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full rounded-full transition-all duration-1000 ${rate > 80 ? 'bg-green-500' : rate > 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${rate}%` }} /></div>
              </div>
            </div>
          );
        })}
      </div>

      {isAddingNew && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-8 space-y-6">
            <h3 className="text-xl font-bold text-slate-900">Nuevo Catecúmeno</h3>
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Nombre completo"
                className="w-full px-4 py-2 border rounded-xl"
                value={newName}
                onChange={e => setNewName(e.target.value)}
              />

              <input
                type="text"
                placeholder="DNI"
                className="w-full px-4 py-2 border rounded-xl"
                value={newDni}
                onChange={e => setNewDni(e.target.value)}
              />

              <select
                className="w-full px-4 py-2 border rounded-xl"
                value={newGender}
                onChange={e => setNewGender(e.target.value)}
              >
                <option value="">Selecciona género</option>
                <option value="male">Masculino</option>
                <option value="female">Femenino</option>
              </select>

              <select
                className="w-full px-4 py-2 border rounded-xl"
                value={newSchool ?? ""}
                onChange={(e) => setNewSchool(e.target.value)}
              >
                <option value="">(Sin colegio)</option>
                {schoolNames.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>

              <input
                type="date"
                className="w-full px-4 py-2 border rounded-xl"
                value={newBirthDate}
                onChange={e => setNewBirthDate(e.target.value)}
              />

              <input
                type="email"
                placeholder="Email del niño (si tiene)"
                className="w-full px-4 py-2 border rounded-xl"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
              />

              <input
                type="email"
                placeholder="Email de los padres"
                className="w-full px-4 py-2 border rounded-xl"
                value={newParentEmail}
                onChange={e => setNewParentEmail(e.target.value)}
              />

              <select
                className="w-full px-4 py-2 border rounded-xl"
                value={newGroup}
                onChange={e => setNewGroup(e.target.value)}
              >
                {groups.map(g => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-4"><button onClick={() => setIsAddingNew(false)} className="flex-1 py-2 text-slate-500 font-bold">Cancelar</button><button onClick={handleAddNew} className="flex-1 py-2 bg-indigo-600 text-white font-bold rounded-xl">Inscribir</button></div>
          </div>
        </div>
      )}

      {selectedStudent && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-end">
          <div className="bg-white w-full max-w-xl h-full shadow-2xl overflow-y-auto flex flex-col">
            <div className="p-8 border-b flex items-center justify-between bg-slate-50 sticky top-0 z-10">
              <button onClick={() => setSelectedStudent(null)} className="p-2 hover:bg-slate-200 rounded-full"><ChevronRight className="rotate-180" size={24} /></button>
              <div className="flex gap-2">
                <button 
                  onClick={() => setIsEditing(!isEditing)} 
                  className={`px-4 py-2 border rounded-lg text-sm font-medium transition-colors ${isEditing ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}
                >
                  {isEditing ? <X size={16} className="inline mr-1" /> : <Edit3 size={16} className="inline mr-1" />}
                  {isEditing ? 'Cancelar' : 'Editar'}
                </button>
                {!isEditing && (
                  <button 
                    onClick={() => handleContact(selectedStudent)} 
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors flex items-center gap-2"
                  >
                    <Mail size={16} />
                    Email Padres
                  </button>
                )}
              </div>
            </div>
            <div className="p-8 space-y-8 flex-1">
              <div className="flex items-center gap-6">
                <div className="relative group/photo shrink-0 w-24 h-24">
                  <div className="w-full h-full rounded-3xl bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-3xl shadow-inner overflow-hidden">
                    {tempPhoto ? <img src={tempPhoto} className="w-full h-full object-cover" /> : selectedStudent.name[0]}
                  </div>
                  {isEditing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-3xl opacity-0 group-hover/photo:opacity-100 transition-opacity">
                      <div className="flex items-center gap-2">
                        <button onClick={() => fileInputRef.current?.click()} className="p-2 bg-white text-indigo-600 rounded-full"><Camera size={20} /></button>
                        {tempPhoto && (
                          <button
                            type="button"
                            onClick={() => void handlePhotoDelete()}
                            className="p-2 bg-white text-red-600 rounded-full"
                            title="Eliminar foto"
                          >
                            <Trash2 size={20} />
                          </button>
                        )}
                      </div>
                      <input type="file" ref={fileInputRef} onChange={handlePhotoUpload} accept="image/*" className="hidden" />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        className="w-full px-3 py-2 border rounded-xl text-lg font-bold"
                        value={tempName}
                        onChange={e => setTempName(e.target.value)}
                      />

                      <p className="text-sm text-slate-500">
                        ID público: <span className="font-semibold text-slate-700">{selectedStudent.publicId || "No asignado"}</span>
                      </p>

                      <p className="text-sm text-slate-500">
                        DNI: <span className="font-semibold text-slate-700">{selectedStudent.dni || "No consta"}</span>
                      </p>

                      <select
                        className="w-full px-3 py-2 border rounded-xl"
                        value={tempGender}
                        onChange={e => setTempGender(e.target.value)}
                      >
                        <option value="">Selecciona género</option>
                        <option value="male">Masculino</option>
                        <option value="female">Femenino</option>
                      </select>

                      <select
                        className="w-full px-3 py-2 border rounded-xl"
                        value={tempSchool ?? ""}
                        onChange={(e) => setTempSchool(e.target.value)}
                      >
                        <option value="">(Sin colegio)</option>
                        {schoolNames.map((s) => (
                          <option key={s.id} value={s.name}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="email"
                        className="w-full px-3 py-2 border rounded-xl"
                        value={tempEmail}
                        onChange={e => setTempEmail(e.target.value)}
                        placeholder="Email del niño"
                      />

                      <input
                        type="email"
                        className="w-full px-3 py-2 border rounded-xl"
                        value={tempParentEmail}
                        onChange={e => setTempParentEmail(e.target.value)}
                        placeholder="Email de padres"
                      />

                    </div>
                  ) : (
                    <>
                      <h2 className="text-2xl font-bold text-slate-900">{selectedStudent.name}</h2>

                      <p className="text-sm text-slate-500">
                        ID público: <span className="font-semibold text-slate-700">{selectedStudent.publicId || "No asignado"}</span>
                      </p>

                      <p className="text-sm text-slate-500">
                        DNI: <span className="font-semibold text-slate-700">{selectedStudent.dni || "No consta"}</span>
                      </p>

                      <p className="text-sm text-slate-500">
                        Género:{" "}
                        <span className="font-semibold text-slate-700">
                          {selectedStudent.gender === "male"
                            ? "Masculino"
                            : selectedStudent.gender === "female"
                            ? "Femenino"
                            : "No consta"}
                        </span>
                      </p>

                      <p className="text-slate-500">{selectedStudent.school || "SIN COLEGIO REGISTRADO"}</p>
                      <p className="text-slate-500 text-sm">{selectedStudent.email}</p>
                      {selectedStudent.parentEmail && (
                        <p className="text-slate-500 text-sm">Padres: {selectedStudent.parentEmail}</p>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div>

              {enableMassServices && (
                <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-extrabold text-slate-700 uppercase tracking-widest">
                      Servicios
                    </h4>
                    {servicesLoading && (
                      <span className="text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-lg">
                        Cargando...
                      </span>
                    )}
                  </div>
                    <div className="flex gap-3">
                      {SERVICES.map((svc) => {
                        const on = servicesToday.has(svc.key);
                        const disabled = !isEditing || !!servicesToggling;
                        return (
                          <button
                            key={svc.key}
                            type="button"
                            disabled={disabled}
                            onClick={() => void toggleServiceToday(svc.key)}
                            className={[
                              "w-11 h-11 rounded-xl border font-bold flex items-center justify-center transition-all select-none",
                              on ? svc.onClasses : offClasses,
                              disabled ? "opacity-80 cursor-default" : "hover:scale-[1.02]",
                              servicesToggling === svc.key ? "opacity-60" : "",
                            ].join(" ")}
                            title={
                              isEditing
                                ? on ? `Quitar ${svc.label}` : `Marcar ${svc.label}`
                                : "Pulsa Editar para modificar"
                            }
                          >
                            {svc.label}
                          </button>
                        );
                      })}
                    </div>
                    {!isEditing && (
                    <p className="mt-3 text-xs text-slate-500">
                      Para cambiar servicios, pulsa <span className="font-bold">Editar</span>.
                    </p>
                  )}
                </div>
              )}
                <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h4 className="text-lg font-bold">Asistencia {academicYear.label}</h4>
                    {!canEditAttendance && (
                      <p className="text-xs text-amber-700 mt-0.5">
                        {getAcademicYearState(academicYear) === 'future'
                          ? 'Este curso todavía no ha comenzado.'
                          : 'Curso cerrado: la asistencia es solo de consulta.'}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <AttendanceDownloadButton
                      students={[selectedStudent]}
                      classDays={classDays}
                      groups={groups}
                      availableYears={availableAcademicYears}
                      selectedYear={academicYear}
                      scopeLabel={selectedStudent.name}
                      buttonLabel="Descargar"
                      variant="subtle"
                    />

                  {isEditing && <button
                    onClick={handleSave}
                    disabled={!isOnline}
                    className={`text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1 ${
                      isOnline
                        ? "text-green-600 bg-green-50"
                        : "text-slate-400 bg-slate-100 cursor-not-allowed"
                    }`}
                  ><Save size={14} />Guardar</button>}
                  </div>
                </div>
                <div className="space-y-3">
                  {tempHistory.map((record, i) => (
                    <div key={i} className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-2xl">
                      <span className="font-semibold text-slate-700 text-sm">{new Date(record.date).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col items-center">
                          <span className="text-[9px] font-bold text-slate-400 mb-1">CAT</span>
                          <button
                            disabled={!isEditing || !canEditAttendance}
                            onClick={() => { const h = [...tempHistory]; h[i].catechism = cycleStatus(h[i].catechism); setTempHistory(h); }}
                            className={`p-2 rounded-lg ${record.catechism === 'present' ? 'bg-indigo-600 text-white' : record.catechism === 'late' ? 'bg-amber-100 text-amber-700 border border-amber-400' : 'bg-slate-50 text-slate-300'}`}
                          >
                            {record.catechism === 'late' ? <Clock size={16} /> : <BookOpen size={16} />}
                          </button>
                        </div>
                        <div className="flex flex-col items-center">
                          <span className="text-[9px] font-bold text-slate-400 mb-1">MISA</span>
                          <button
                            disabled={!isEditing || !canEditAttendance}
                            onClick={() => { const h = [...tempHistory]; h[i].mass = cycleStatus(h[i].mass); setTempHistory(h); }}
                            className={`p-2 rounded-lg ${record.mass === 'present' ? 'bg-amber-500 text-white' : record.mass === 'late' ? 'bg-amber-100 text-amber-700 border border-amber-400' : 'bg-slate-50 text-slate-300'}`}
                          >
                            {record.mass === 'late' ? <Clock size={16} /> : <Church size={16} />}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteStudent && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-slate-900/60"
            onClick={() => setConfirmDeleteStudent(null)}
          />

          <div className="relative w-full max-w-xl mx-4 bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-6 sm:p-8 border-b border-slate-100 bg-red-50">
              <h3 className="text-lg sm:text-xl font-extrabold text-red-700">
                Acción irreversible
              </h3>
              <p className="mt-2 text-sm sm:text-base text-red-900">
                Vas a eliminar a{" "}
                <span className="font-bold">{confirmDeleteStudent.name}</span>.
                Esto borrará también{" "}
                <span className="font-bold">todos sus registros de asistencia</span> y no se puede deshacer.
              </p>
            </div>

            <div className="p-6 sm:p-8 flex flex-col sm:flex-row gap-3 sm:justify-end">
              <button
                onClick={() => setConfirmDeleteStudent(null)}
                className="px-5 py-3 rounded-2xl border border-slate-200 bg-white text-slate-700 font-bold hover:bg-slate-50"
              >
                Cancelar
              </button>

              <button
                disabled={!isOnline}
                onClick={async () => {
                  const id = confirmDeleteStudent.id;
                  setConfirmDeleteStudent(null);

                  try {
                    await onRemoveStudent?.(id);
                  } catch (e: any) {
                    alert(e?.message ?? "Error eliminando alumno.");
                  }
                }}
                className={`px-5 py-3 rounded-2xl font-extrabold ${
                  isOnline
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : "bg-slate-200 text-slate-500 cursor-not-allowed"
                }`}
              >
                Eliminar definitivamente
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentList;
