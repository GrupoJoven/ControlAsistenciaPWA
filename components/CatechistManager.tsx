
import React, { useState, useRef, useMemo } from 'react';
import { supabase } from "../src/lib/supabaseClient";
import { 
  Users, 
  UserPlus, 
  Trash2, 
  Search, 
  Edit3, 
  Mail, 
  Cake, 
  Camera, 
  X, 
  Save, 
  ChevronRight,
  Briefcase,
  Clock,
  Check,
  Calendar,
  BookOpen,
  Church,
  Key
} from 'lucide-react';
import { User, Group, CatechistAttendanceRecord, AttendanceStatus, getTodayStr, getAcademicYearRange, ParishEvent, calculateCatechistRate } from '../types';

interface CatechistManagerProps {
  users: User[];
  filteredUsers?: User[];
  groups: Group[];
  classDays: string[];
  events: ParishEvent[];
  onResetPassword: (userId: string, newPassword: string) => Promise<void>;

  // Alta: permite 0..N grupos
  onAddUser: (u: { name: string; email: string; password: string; birthDate?: string; groupIds: string[] }) => Promise<void>;

  // Edición de perfil (solo profiles)
  onUpdateUser: (u: User) => void;

  // Edición de grupos (solo tabla puente)
  onSetUserGroups: (userId: string, groupIds: string[]) => Promise<void>;

  onRemoveUser: (id: string) => void;

  // Para pintar tarjetas y abrir detalle con grupos actuales:
  getUserGroupIds: (userId: string) => string[];  // lo construyes en App con groupCatechistLinks
  isOnline: boolean;
}


const CatechistManager: React.FC<CatechistManagerProps> = ({
  users,
  filteredUsers,
  groups,
  classDays,
  events,
  onResetPassword,
  onAddUser,
  onUpdateUser,
  onSetUserGroups,
  onRemoveUser,
  getUserGroupIds,
  isOnline,
}) => {
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form states
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState(''); // Will be used for NEW password only
  const [birthDate, setBirthDate] = useState('');
  const [photo, setPhoto] = useState<string | undefined>(undefined);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [tempHistory, setTempHistory] = useState<CatechistAttendanceRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const cycleStatusValue = (current: AttendanceStatus): AttendanceStatus => {
    if (current === "absent") return "present";
    if (current === "present") return "late";
    return "absent";
  };

  const loadFullHistoryFromDB = async (userId: string) => {
    const today = getTodayStr();
    const range = getAcademicYearRange(today);
    const end = today < range.end ? today : range.end;

    // Días lectivos y eventos relevantes (solo pasado)
    const relevantClassDays = classDays.filter(d => d >= range.start && d <= end);
    const relevantEvents = events.filter(e => e.date >= range.start && e.date <= end);

    // 1) Clases (catechist_attendance)
    const { data: classRows, error: classErr } = await supabase
      .from("catechist_attendance")
      .select("date, catechism, mass")
      .eq("profile_id", userId)
      .gte("date", range.start)
      .lte("date", end);

    if (classErr) throw classErr;

    const classByDate = new Map<string, { catechism: AttendanceStatus; mass: AttendanceStatus }>();
    for (const r of classRows ?? []) {
      classByDate.set(String(r.date), {
        catechism: ((r.catechism ?? "absent") as AttendanceStatus),
        mass: ((r.mass ?? "absent") as AttendanceStatus),
      });
    }

    // 2) Eventos (catechist_attendance_events)
    const { data: eventRows, error: eventErr } = await supabase
      .from("catechist_attendance_events")
      .select("event_id, date, status")
      .eq("profile_id", userId)
      .gte("date", range.start)
      .lte("date", end);

    if (eventErr) throw eventErr;

    const eventById = new Map<string, AttendanceStatus>();
    for (const r of eventRows ?? []) {
      if (!r.event_id) continue;
      eventById.set(String(r.event_id), ((r.status ?? "absent") as AttendanceStatus));
    }

    // 3) Construir histórico completo (rellenando ausencias)
    const history: CatechistAttendanceRecord[] = [];

    for (const day of relevantClassDays) {
      const v = classByDate.get(day);
      history.push({
        type: "class",
        date: day,
        catechism: v?.catechism ?? "absent",
        mass: v?.mass ?? "absent",
      });
    }

    for (const ev of relevantEvents) {
      const st = eventById.get(ev.id) ?? "absent";
      history.push({
        type: "event",
        date: ev.date,
        status: st,
        refId: ev.id,
      });
    }

    // Sort desc
    history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return history;
  };

  // Use filtered list if available, otherwise filter by role
  const catechistsToDisplay = filteredUsers || users;


  const resetForm = () => {
    setName(''); setEmail(''); setPassword(''); setBirthDate(''); setPhoto(undefined); setSelectedGroupIds([]); setTempHistory([]);
    setIsAdding(false);
    setSelectedUser(null);
    setIsEditing(false);
  };

  const handleOpenDetail = async (user: User) => {
    setSelectedUser(user);
    setName(user.name);
    setEmail(user.email);
    setPassword("");
    setBirthDate((user.birthDate || "").slice(0, 10));
    setPhoto(user.photo);
    setSelectedGroupIds(getUserGroupIds(user.id));
    setIsEditing(false);

    // Cargar histórico desde BD
    if (!isOnline) {
      setTempHistory(user.attendanceHistory ?? []);
      return;
    }

    setIsLoadingHistory(true);
    try {
      const full = await loadFullHistoryFromDB(user.id);
      setTempHistory(full);
    } catch (e: any) {
      alert("Error cargando histórico: " + (e?.message ?? String(e)));
      setTempHistory(user.attendanceHistory ?? []);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleSave = async () => {
  if (!isOnline) {
    alert("No hay conexión. No se pueden guardar cambios del catequista hasta que vuelva internet.");
    return;
  }
    if (isAdding) {
      if (!email.trim()) { alert("Email obligatorio."); return; }
      if (!password || password.length < 8) { alert("La contraseña debe tener al menos 8 caracteres."); return; }

      await onAddUser({
        name,
        email: email.trim(),
        password,
        birthDate: birthDate || undefined,
        groupIds: selectedGroupIds,
      });

      resetForm();
      return;
    }

    if (selectedUser) {
      const updated: User = {
        ...selectedUser,
        name,
        birthDate,
        photo,
        attendanceHistory: tempHistory,
      };

      onUpdateUser(updated);
      await onSetUserGroups(selectedUser.id, selectedGroupIds);
      // 1) Persistir histórico en BD (tablas nuevas)
      const classUpserts = tempHistory
        .filter(r => r.type === "class")
        .map(r => ({
          profile_id: selectedUser.id,
          date: r.date,
          catechism: r.catechism ?? "absent",
          mass: r.mass ?? "absent",
        }));

      if (classUpserts.length > 0) {
        const { error } = await supabase
          .from("catechist_attendance")
          .upsert(classUpserts, { onConflict: "profile_id,date" });
        if (error) {
          alert("Error guardando histórico de clases: " + error.message);
          return;
        }
      }

      const eventUpserts = tempHistory
        .filter(r => r.type === "event" && r.refId)
        .map(r => ({
          profile_id: selectedUser.id,
          event_id: r.refId!,
          date: r.date,
          status: r.status ?? "absent",
        }));

      if (eventUpserts.length > 0) {
        const { error } = await supabase
          .from("catechist_attendance_events")
          .upsert(eventUpserts, { onConflict: "profile_id,event_id,date" });
        if (error) {
          alert("Error guardando histórico de eventos: " + error.message);
          return;
        }
      }

      resetForm();
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

      // Necesitamos un user target: si estás creando (isAdding), aún no hay id
      if (!selectedUser?.id) {
        alert("Primero crea el usuario y después podrás subir la foto.");
        return;
      }

      if (!file.type.startsWith("image/")) {
        alert("El archivo debe ser una imagen.");
        return;
      }

      // (opcional) límite de tamaño
      if (file.size > 2 * 1024 * 1024) {
        alert("La imagen no puede superar 2MB.");
        return;
      }

      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `profiles/${selectedUser.id}/avatar.${ext}`;

      // 1) Subir a storage (upsert para reemplazar)
      const { error: upErr } = await supabase.storage
        .from("media")
        .upload(path, file, { upsert: true, contentType: file.type });

      if (upErr) {
        alert("Error subiendo imagen: " + upErr.message);
        return;
      }

      // 2) Guardar ruta en BD
      const { error: dbErr } = await supabase
        .from("profiles")
        .update({ photo_path: path })
        .eq("id", selectedUser.id);

      if (dbErr) {
        alert("Imagen subida, pero no se pudo guardar en perfil: " + dbErr.message);
        return;
      }

      // 3) Preview local inmediata (sin base64)
      setPhoto(URL.createObjectURL(file));

      // 4) Refrescar datos globales
      // Actualizamos la foto de perfil globalmente
      onUpdateUser({
        ...selectedUser,
        photo: URL.createObjectURL(file), // Actualizamos el `photo` en el perfil global
      });

    } finally {
      // Permitir re-subir el mismo fichero
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
    if (!selectedUser?.id) return;

    if (!photo) {
      alert("Este catequista no tiene foto de perfil.");
      return;
    }

    const ok = window.confirm(
      "¿Eliminar la foto de perfil? Se borrará del Storage y se quitará del perfil."
    );
    if (!ok) return;

    try {
      const prefix = `profiles/${selectedUser.id}`;

      // 1) Borrar subcarpeta completa (todos los objetos bajo profiles/<id>/)
      await deleteStorageFolder(prefix);

      // 2) Limpiar photo_path en la base de datos
      const { error: dbErr } = await supabase
        .from("profiles")
        .update({ photo_path: null })
        .eq("id", selectedUser.id);

      if (dbErr) {
        alert("Foto borrada del Storage, pero no se pudo actualizar el perfil: " + dbErr.message);
      }

      // 3) Reflejo en UI y actualización global
      setPhoto(undefined);  // Actualiza el estado local para que la foto se elimine de la UI.
      onUpdateUser({ ...selectedUser, photo: undefined, name, birthDate });  // Actualiza el estado global

    } catch (e: any) {
      console.error(e);
      alert(e?.message ?? "Error eliminando foto");
    }
  };

  const cycleStatus = (index: number, subType?: "catechism" | "mass") => {
    if (!isEditing) return;

    const h = [...tempHistory];
    const rec = { ...h[index] };

    if (rec.type === "class") {
      const current = (rec as any)[subType!] as AttendanceStatus;
      (rec as any)[subType!] = cycleStatusValue(current);
    } else {
      const current = rec.status ?? "absent";
      rec.status = cycleStatusValue(current);
    }

    h[index] = rec;
    setTempHistory(h);
  };


  const selectedGroupNames = useMemo(() => {
    const names = selectedGroupIds
      .map(id => groups.find(g => g.id === id)?.name)
      .filter(Boolean) as string[];
    return names;
  }, [selectedGroupIds, groups]);

  const toggleGroup = (groupId: string) => {
    if (!isEditing) return;
    setSelectedGroupIds(prev =>
      prev.includes(groupId) ? prev.filter(x => x !== groupId) : [...prev, groupId]
    );
  };

  const GroupChipsReadOnly: React.FC = () => {
    if (selectedGroupNames.length === 0) {
      return <div className="text-sm text-slate-500">Sin grupo</div>;
    }
    return (
      <div className="flex flex-wrap gap-2">
        {selectedGroupNames.map(name => (
          <span
            key={name}
            className="px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200"
          >
            {name}
          </span>
        ))}
      </div>
    );
  };

  const GroupChipsEditable: React.FC = () => {
    if (groups.length === 0) {
      return <div className="text-sm text-slate-500">No hay grupos creados.</div>;
    }

    return (
      <div className="flex flex-wrap gap-2">
        {groups.map(g => {
          const active = selectedGroupIds.includes(g.id);
          return (
            <button
              key={g.id}
              type="button"
              disabled={!isEditing}
              onClick={() => toggleGroup(g.id)}
              className={[
                "px-3 py-1 rounded-full text-xs font-bold border transition-all",
                active
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
                !isEditing ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
              ].join(" ")}
              aria-pressed={active}
            >
              {g.name}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <button 
          disabled={!isOnline}
          onClick={() => {
            setIsAdding(true);
            setIsEditing(true);
            setName(''); setEmail(''); setPassword(''); setBirthDate('');
            setPhoto(undefined); setSelectedGroupIds([]); setTempHistory([]);
          }}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold shadow-sm ${
            isOnline
              ? "bg-indigo-600 text-white"
              : "bg-slate-200 text-slate-500 cursor-not-allowed"
          }`}
        >
          <UserPlus size={18} /> <span className="hidden sm:inline">Añadir Catequista</span><span className="sm:hidden">Nuevo</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {catechistsToDisplay.map(cat => {
          const ids = getUserGroupIds(cat.id);
          const names = ids
            .map(id => groups.find(g => g.id === id)?.name)
            .filter(Boolean) as string[];

          const catGroupLabel = names.length ? names.join(", ") : "Sin grupo";
          const rate = calculateCatechistRate(cat, classDays, events);
          
          return (
            <div 
              key={cat.id} 
              onClick={() => { void handleOpenDetail(cat); }}
              className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer flex flex-col items-center text-center group"
            >
              <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center font-bold text-indigo-700 text-xl overflow-hidden mb-4 shrink-0 group-hover:scale-105 transition-transform">
                {cat.photo ? <img src={cat.photo} className="w-full h-full object-cover" /> : cat.name[0]}
              </div>
              <h3 className="font-bold text-slate-900 truncate w-full">{cat.name}</h3>
              <p className="text-xs text-indigo-600 font-bold uppercase mt-1">{catGroupLabel}</p>
              
              <div className="w-full mt-3 px-2">
                <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase mb-1">
                  <span>Asistencia Media</span>
                  <span className={rate > 80 ? 'text-green-600' : rate > 50 ? 'text-amber-600' : 'text-red-600'}>{rate}%</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${rate > 80 ? 'bg-green-500' : rate > 50 ? 'bg-amber-500' : 'bg-red-500'}`} 
                    style={{ width: `${rate}%` }} 
                  />
                </div>
              </div>

              <div className="mt-4 w-full pt-4 border-t border-slate-50 space-y-1">
                <div className="flex items-center justify-center gap-2 text-xs text-slate-500 truncate"><Mail size={12}/> {cat.email}</div>
                <div className="flex items-center justify-center gap-2 text-xs text-slate-500"><Cake size={12}/> {cat.birthDate || 'No registrada'}</div>
              </div>
            </div>
          );
        })}
        {catechistsToDisplay.length === 0 && (
          <div className="col-span-full py-12 text-center text-slate-400">
            No se encontraron catequistas con ese nombre.
          </div>
        )}
      </div>

      {(isAdding || selectedUser) && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-end">
          <div className="bg-white w-full max-w-lg h-full shadow-2xl overflow-y-auto flex flex-col p-6 lg:p-8 space-y-8">
            <div className="flex items-center justify-between border-b pb-4 sticky top-0 bg-white z-10">
              <button onClick={resetForm} className="p-2"><ChevronRight className="rotate-180" size={24} /></button>
              <h2 className="text-lg lg:text-xl font-bold truncate">{isAdding ? 'Nuevo Catequista' : 'Ficha'}</h2>
              {!isAdding && (
                <button onClick={() => setIsEditing(!isEditing)} className="px-3 ...">
                  {isEditing ? 'Cancelar' : 'Editar'}
                </button>
              )}

            </div>

            <div className="flex flex-col items-center gap-4">
              <div className="relative group">
                <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-3xl bg-indigo-50 flex items-center justify-center text-2xl sm:text-3xl font-bold text-indigo-700 overflow-hidden shadow-inner">
                  {photo ? <img src={photo} className="w-full h-full object-cover" /> : name[0] || '?'}
                </div>
                {isEditing && (
                  <>
                    <div className="absolute bottom-[-4px] right-[-4px] flex items-center gap-2">
                      <button onClick={() => fileInputRef.current?.click()} className="p-2 bg-indigo-600 text-white rounded-xl shadow-lg hover:bg-indigo-700 transition-colors"><Camera size={16} /></button>
                      {photo && (
                        <button
                          type="button"
                          onClick={() => void handlePhotoDelete()}
                          className="p-2 bg-white text-red-600 rounded-xl shadow-lg hover:bg-slate-50 transition-colors"
                          title="Eliminar foto"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                    <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handlePhotoUpload} />
                  </>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Nombre Completo</label><input disabled={!isEditing} className="w-full px-4 py-2 border rounded-xl disabled:bg-slate-50 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm" value={name} onChange={e => setName(e.target.value)} /></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Email</label>
                  <input
                    type="email"
                    disabled={!isAdding}
                    className="w-full px-4 py-2 border rounded-xl disabled:bg-slate-50 text-sm"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ej: catequista@parroquia.es"
                  />
                  {!isAdding && (
                    <p className="mt-1 text-[11px] text-slate-400">
                      El email no se puede cambiar desde aquí.
                    </p>
                  )}
                </div>

                {!isAdding && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                      Nueva Contraseña
                    </label>
                    <input
                      type="password"
                      disabled={!isEditing}
                      className="w-full px-4 py-2 border rounded-xl disabled:bg-slate-50 focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono text-sm"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Escribe una nueva..."
                    />
                    {isEditing && (
                      <button
                        type="button"
                        disabled={!isOnline}
                        onClick={async () => {
                          if (!selectedUser) return;
                          if (!password || password.length < 8) {
                            alert("La contraseña debe tener al menos 8 caracteres.");
                            return;
                          }
                          await onResetPassword(selectedUser.id, password);
                          setPassword("");
                        }}
                        className={`mt-2 w-full py-2 font-bold rounded-xl ${
                          isOnline
                            ? "bg-slate-900 text-white"
                            : "bg-slate-200 text-slate-500 cursor-not-allowed"
                        }`}
                      >
                        Resetear contraseña
                      </button>
                    )}
                  </div>
                )}


                {isAdding && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                      Contraseña Inicial
                    </label>
                    <input
                      type="password"
                      disabled={!isEditing}
                      className="w-full px-4 py-2 border rounded-xl disabled:bg-slate-50 focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono text-sm"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Contraseña..."
                    />
                  </div>
                )}

              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Fecha Nacimiento</label><input type="date" disabled={!isEditing} className="w-full px-4 py-2 border rounded-xl disabled:bg-slate-50 focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm" value={birthDate} onChange={e => setBirthDate(e.target.value)} /></div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                    Grupos asignados
                  </label>
                  <div className="mt-2 rounded-xl border border-slate-200 p-3 bg-white">
                    {!isEditing ? <GroupChipsReadOnly /> : <GroupChipsEditable />}
                  </div>
                </div>
              </div>
            </div>

            {!isAdding && selectedUser && (
              <div className="space-y-4 pt-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-lg font-bold text-slate-800">Historial</h4>
                  {isEditing && <span className="text-[9px] font-bold text-amber-600 uppercase bg-amber-50 px-2 py-1 rounded">Edición</span>}
                </div>
                <div className="space-y-3">
                  {tempHistory.map((record, i) => {
                    const eventTitle = record.type === 'event' ? events.find(e => e.id === record.refId)?.title : 'Día Lectivo';
                    return (
                      <div key={i} className={`flex items-center justify-between p-3 sm:p-4 bg-white border border-slate-100 rounded-2xl ${record.type === 'event' ? 'border-l-4 border-l-amber-400' : 'border-l-4 border-l-indigo-400'}`}>
                        <div className="flex flex-col min-w-0">
                          <span className="font-semibold text-slate-700 text-xs sm:text-sm capitalize truncate">
                            {new Date(record.date).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}
                          </span>
                          <span className="text-[9px] sm:text-[10px] text-slate-400 flex items-center gap-1 truncate">
                            {record.type === 'event' ? <Calendar size={10}/> : <BookOpen size={10}/>}
                            {eventTitle}
                          </span>
                        </div>
                        
                        <div className="flex gap-1 sm:gap-2 shrink-0">
                          {record.type === 'class' ? (
                            <>
                              <div className="flex flex-col items-center">
                                <span className="text-[7px] font-bold text-slate-400 uppercase">Cat</span>
                                <button 
                                  disabled={!isEditing}
                                  onClick={() => cycleStatus(i, 'catechism')}
                                  className={`p-1.5 sm:p-2 rounded-lg text-[10px] font-bold transition-all ${record.catechism === 'present' ? 'bg-indigo-600 text-white shadow-md' : record.catechism === 'late' ? 'bg-amber-100 text-amber-700 border-2 border-amber-400' : 'bg-slate-100 text-slate-400'}`}
                                >
                                  {record.catechism === 'late' ? <Clock size={12}/> : <BookOpen size={12}/>}
                                </button>
                              </div>
                              <div className="flex flex-col items-center">
                                <span className="text-[7px] font-bold text-slate-400 uppercase">Misa</span>
                                <button 
                                  disabled={!isEditing}
                                  onClick={() => cycleStatus(i, 'mass')}
                                  className={`p-1.5 sm:p-2 rounded-lg text-[10px] font-bold transition-all ${record.mass === 'present' ? 'bg-amber-500 text-white shadow-md' : record.mass === 'late' ? 'bg-amber-100 text-amber-700 border-2 border-amber-400' : 'bg-slate-100 text-slate-400'}`}
                                >
                                  {record.mass === 'late' ? <Clock size={12}/> : <Church size={12}/>}
                                </button>
                              </div>
                            </>
                          ) : (
                            <button 
                              disabled={!isEditing}
                              onClick={() => cycleStatus(i)}
                              className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-[10px] font-bold flex items-center gap-1.5 transition-all ${
                                record.status === "present"
                                  ? "bg-green-600 text-white shadow-md"
                                  : record.status === "late"
                                    ? "bg-amber-100 text-amber-700 border-2 border-amber-400"
                                    : "bg-slate-100 text-slate-400"
                              }`}
                            >
                              {record.status === "present" ? <Check size={12}/> : record.status === "late" ? <Clock size={12}/> : <X size={12}/>}
                              {record.status === "present" ? "SI" : record.status === "late" ? "TARDE" : "NO"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {tempHistory.length === 0 && <p className="text-center py-8 text-slate-400 italic text-xs">Sin actividad registrada</p>}
                </div>
              </div>
            )}

            <div className="pt-6 border-t flex flex-col gap-3 pb-8">
              {(isEditing || isAdding) && (
                <button
                  onClick={handleSave}
                  disabled={!isOnline}
                  className={`w-full py-3 font-bold rounded-2xl flex items-center justify-center gap-2 text-sm ${
                    isOnline
                      ? "bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 transition-all"
                      : "bg-slate-200 text-slate-500 cursor-not-allowed"
                  }`}
                ><Save size={18} /> {isAdding ? 'Inscribir' : 'Guardar'}
                </button>
              )}
              {!isAdding && selectedUser && isEditing && (
                <button
                  disabled={!isOnline}
                  onClick={() => {
                    if (confirm('¿Deseas eliminar a este catequista?')) {
                      onRemoveUser(selectedUser.id);
                      resetForm();
                    }
                  }}
                  className={`w-full py-3 font-bold rounded-2xl border flex items-center justify-center gap-2 text-sm ${
                    isOnline
                      ? "bg-red-50 text-red-600 border-red-100 hover:bg-red-100 transition-all"
                      : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                  }`}
                ><Trash2 size={18} /> Eliminar</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CatechistManager;
