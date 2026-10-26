import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Crown,
  Loader2,
  Mail,
  User as UserIcon,
  UserCog,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { Group, User } from "../types";
import { ALL_STAGES, STAGE_LABELS, Stage, isGlobalCoordinator } from "../src/utils/stages";
import { FAMILY_EMAIL_SENDERS } from "./FamilyContact";

interface StageCoordinatorsManagerProps {
  /** Todos los perfiles, con sus etapas calculadas (usersWithStages). */
  users: User[];
  groups: Group[];
  getUserGroupIds: (userId: string) => string[];
  isOnline: boolean;
  /** Hace (assign) o deja de hacer a un perfil coordinador de la etapa. Devuelve si se ha guardado. */
  onSetCoordinator: (userId: string, stage: Stage, assign: boolean) => Promise<boolean>;
}

type PendingChange = { user: User; stage: Stage; assign: boolean };

const otherStage = (stage: Stage): Stage => (stage === "preconfirmation" ? "confirmation" : "preconfirmation");

const isCoordinatorOf = (user: User, stage: Stage) => user.role === "coordinator" && user.stage === stage;

const byName = (a: User, b: User) => a.name.localeCompare(b.name, "es", { sensitivity: "base" });

const Avatar: React.FC<{ user: User }> = ({ user }) => (
  <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center overflow-hidden shrink-0">
    {user.photo ? <img src={user.photo} alt="" className="w-full h-full object-cover" /> : <UserIcon size={18} />}
  </div>
);

/**
 * Supercoordinación → Coordinadores: el coordinador general elige quién
 * coordina cada etapa entre los perfiles que ya existen.
 *
 * Ser coordinador de una etapa es profiles.role = 'coordinator' con
 * profiles.stage = esa etapa. Al quitarlo pasa a catequista y conserva la
 * etapa, para que la siga viendo. Los coordinadores generales (sin etapa) no se
 * tocan desde aquí.
 */
const StageCoordinatorsManager: React.FC<StageCoordinatorsManagerProps> = ({
  users,
  groups,
  getUserGroupIds,
  isOnline,
  onSetCoordinator,
}) => {
  const [selectedIds, setSelectedIds] = useState<Record<Stage, string>>({ preconfirmation: "", confirmation: "" });
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const groupNameById = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups]);

  const globalCoordinators = useMemo(() => users.filter(isGlobalCoordinator).sort(byName), [users]);

  const coordinatorsByStage = useMemo(() => {
    const result = {} as Record<Stage, User[]>;
    for (const stage of ALL_STAGES) result[stage] = users.filter((u) => isCoordinatorOf(u, stage)).sort(byName);
    return result;
  }, [users]);

  /** Quién puede pasar a coordinar la etapa: primero los catequistas que ya están en ella. */
  const candidatesByStage = useMemo(() => {
    const result = {} as Record<Stage, { label: string; users: User[] }[]>;
    for (const stage of ALL_STAGES) {
      const catechists = users.filter((u) => u.role === "catechist");
      const inStage = catechists.filter((u) => (u.stages ?? []).includes(stage) || u.stage === stage);
      const inStageIds = new Set(inStage.map((u) => u.id));

      result[stage] = [
        { label: `Catequistas de ${STAGE_LABELS[stage].toLowerCase()}`, users: inStage.sort(byName) },
        { label: "Otros catequistas", users: catechists.filter((u) => !inStageIds.has(u.id)).sort(byName) },
        {
          label: `Coordinadores de ${STAGE_LABELS[otherStage(stage)].toLowerCase()}`,
          users: users.filter((u) => isCoordinatorOf(u, otherStage(stage))).sort(byName),
        },
      ].filter((section) => section.users.length > 0);
    }
    return result;
  }, [users]);

  const groupNamesOf = (user: User) =>
    getUserGroupIds(user.id)
      .map((id) => groupNameById.get(id))
      .filter(Boolean) as string[];

  const askAssign = (stage: Stage) => {
    const user = users.find((u) => u.id === selectedIds[stage]);
    if (!user) return;
    setNotice(null);
    setPending({ user, stage, assign: true });
  };

  const askRemove = (user: User, stage: Stage) => {
    setNotice(null);
    setPending({ user, stage, assign: false });
  };

  const confirmPending = async () => {
    if (!pending || isSaving) return;
    const { user, stage, assign } = pending;

    setIsSaving(true);
    try {
      const ok = await onSetCoordinator(user.id, stage, assign);
      if (!ok) return;

      const label = STAGE_LABELS[stage].toLowerCase();
      setNotice(
        assign
          ? `${user.name} ya es coordinador de ${label}.`
          : `${user.name} ya no es coordinador de ${label}: sigue como catequista de ${label}.`
      );
      if (assign) setSelectedIds((prev) => ({ ...prev, [stage]: "" }));
      setPending(null);
    } finally {
      setIsSaving(false);
    }
  };

  const renderConfirm = () => {
    if (!pending) return null;
    const { user, stage, assign } = pending;
    const label = STAGE_LABELS[stage].toLowerCase();
    const movingFrom = assign && user.role === "coordinator" && user.stage ? user.stage : null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
          <h3 className="text-lg font-semibold text-slate-800">
            {assign ? "Asignar coordinador" : "Quitar coordinador"}
          </h3>

          {assign ? (
            <div className="text-slate-600 space-y-3 text-sm">
              <p>
                <span className="font-semibold text-slate-800">{user.name}</span> pasará a ser coordinador de {label}.
                Podrá gestionar los grupos, niños y catequistas de {label} y usar el correo{" "}
                <span className="font-semibold">{FAMILY_EMAIL_SENDERS[stage]}</span>.
              </p>
              {movingFrom && (
                <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <span>
                    Ahora coordina {STAGE_LABELS[movingFrom].toLowerCase()}: dejará de hacerlo, porque cada
                    coordinador lleva una sola etapa.
                  </span>
                </p>
              )}
            </div>
          ) : (
            <p className="text-slate-600 text-sm">
              <span className="font-semibold text-slate-800">{user.name}</span> dejará de ser coordinador de {label}.
              Seguirá en la app como catequista de {label}, con los grupos que tenga asignados.
            </p>
          )}

          <p className="text-xs text-slate-500">Si tiene la app abierta, verá el cambio al volver a abrirla.</p>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-3">
            <button
              type="button"
              onClick={() => setPending(null)}
              disabled={isSaving}
              className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void confirmPending()}
              disabled={isSaving || !isOnline}
              className={`px-4 py-2 rounded-lg text-white flex items-center justify-center gap-2 disabled:opacity-60 ${
                assign ? "bg-indigo-600 hover:bg-indigo-700" : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {isSaving && <Loader2 size={16} className="animate-spin" />}
              {assign ? "Asignar" : "Quitar"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {renderConfirm()}

      <div className="space-y-6">
        <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
            <UserCog size={20} />
          </div>
          <div className="min-w-0 text-sm text-slate-600 space-y-1">
            <p className="font-bold text-slate-800">Quién coordina cada etapa</p>
            <p>
              Un coordinador de etapa ve y gestiona solo lo de su etapa y usa su correo. Elige entre los perfiles que
              ya existen; para dar de alta a alguien nuevo, hazlo antes en Registro Catequistas.
            </p>
          </div>
        </div>

        {!isOnline && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-2">
            <AlertTriangle size={18} className="shrink-0" /> Sin conexión: los coordinadores no se pueden cambiar
            hasta que vuelva internet.
          </p>
        )}

        {notice && (
          <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-2xl p-4 flex items-center gap-2">
            <CheckCircle2 size={18} className="shrink-0" />
            <span className="flex-1 min-w-0 break-words">{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="p-1 rounded-lg hover:bg-green-100"
              aria-label="Cerrar aviso"
            >
              <X size={14} />
            </button>
          </p>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {ALL_STAGES.map((stage) => {
            const coordinators = coordinatorsByStage[stage];
            const candidateSections = candidatesByStage[stage];
            const selectedId = selectedIds[stage];

            return (
              <section
                key={stage}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col"
              >
                <div className="p-4 sm:p-6 border-b border-slate-100 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-800">{STAGE_LABELS[stage]}</h3>
                    <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-1 min-w-0">
                      <Mail size={12} className="shrink-0" />
                      <span className="truncate">{FAMILY_EMAIL_SENDERS[stage]}</span>
                    </p>
                  </div>
                  <span className="shrink-0 px-2.5 py-1 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700">
                    {coordinators.length} {coordinators.length === 1 ? "coordinador" : "coordinadores"}
                  </span>
                </div>

                {coordinators.length === 0 ? (
                  <p className="p-4 sm:p-6 text-sm text-slate-500">
                    Todavía no hay coordinadores de {STAGE_LABELS[stage].toLowerCase()}.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {coordinators.map((user) => {
                      const groupNames = groupNamesOf(user);
                      return (
                        <li key={user.id} className="px-4 sm:px-6 py-3 flex items-center gap-3">
                          <Avatar user={user} />
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-slate-800 truncate">{user.name || user.email}</p>
                            <p className="text-xs text-slate-500 truncate">{user.email}</p>
                            {groupNames.length > 0 && (
                              <p className="text-[11px] text-slate-400 truncate" title={groupNames.join(", ")}>
                                {groupNames.join(" · ")}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => askRemove(user, stage)}
                            disabled={!isOnline || isSaving}
                            className="shrink-0 p-2 sm:px-3 sm:py-1.5 rounded-xl text-xs font-bold border border-slate-200 text-slate-600 hover:text-red-600 hover:border-red-200 hover:bg-red-50 flex items-center gap-1.5 disabled:opacity-40"
                            aria-label={`Quitar a ${user.name} como coordinador`}
                            title="Quitar como coordinador"
                          >
                            <UserMinus size={16} />
                            <span className="hidden sm:inline">Quitar</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="mt-auto p-4 sm:p-6 border-t border-slate-100 bg-slate-50/60 space-y-2">
                  <label
                    htmlFor={`add-coordinator-${stage}`}
                    className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1"
                  >
                    Añadir coordinador
                  </label>
                  {candidateSections.length === 0 ? (
                    <p className="text-sm text-slate-500">No hay más perfiles que se puedan asignar.</p>
                  ) : (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <select
                        id={`add-coordinator-${stage}`}
                        className="flex-1 min-w-0 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm"
                        value={selectedId}
                        onChange={(e) => setSelectedIds((prev) => ({ ...prev, [stage]: e.target.value }))}
                        disabled={!isOnline || isSaving}
                      >
                        <option value="">Elige un perfil…</option>
                        {candidateSections.map((section) => (
                          <optgroup key={section.label} label={section.label}>
                            {section.users.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name || u.email}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => askAssign(stage)}
                        disabled={!selectedId || !isOnline || isSaving}
                        className="px-4 py-2 rounded-xl font-bold text-sm bg-indigo-600 text-white hover:bg-indigo-700 flex items-center justify-center gap-2 disabled:bg-slate-200 disabled:text-slate-500"
                      >
                        <UserPlus size={16} /> Asignar
                      </button>
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>

        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 sm:p-6 border-b border-slate-100">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <Crown size={16} className="text-violet-600" /> Coordinadores generales
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Ven y gestionan todo, también esta sección. No se cambian desde aquí.
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {globalCoordinators.map((user) => (
              <li key={user.id} className="px-4 sm:px-6 py-3 flex items-center gap-3">
                <Avatar user={user} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800 truncate">{user.name || user.email}</p>
                  <p className="text-xs text-slate-500 truncate">{user.email}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
};

export default StageCoordinatorsManager;
