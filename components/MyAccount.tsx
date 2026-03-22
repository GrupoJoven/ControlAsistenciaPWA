import React, { useEffect, useMemo, useState } from "react";
import { User as UserIcon, Bell, BellOff, Link as LinkIcon, HardDrive, CheckCircle2 } from "lucide-react";
import { subscribeToPush, unsubscribeFromPush } from "../src/pwa/push";
import { getGoogleDriveConnection, startGoogleDriveOAuth, GoogleDriveConnection } from "../src/lib/googleDrive";
import { User, Group } from "../types";

interface MyAccountProps {
  user: User;
  groups: Group[];
  activeGroupId: string | null;
  isOnline: boolean;
  pushEnabled: boolean;
  setPushEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  onUpdateUser: (u: User) => void;
}

const MyAccount: React.FC<MyAccountProps> = ({
  user,
  groups,
  activeGroupId,
  isOnline,
  pushEnabled,
  setPushEnabled,
  onUpdateUser,
}) => {
  const groupName =
    groups.find((g) => g.id === activeGroupId)?.name ||
    (user.role === "coordinator" ? "Coordinación" : "Sin grupo");

  const birth = user.birthDate ? String(user.birthDate).slice(0, 10) : "";
  const [pushLoading, setPushLoading] = useState(false);

  const [driveConnection, setDriveConnection] = useState<GoogleDriveConnection | null>(null);
  const [driveLoading, setDriveLoading] = useState(true);
  const [driveLinking, setDriveLinking] = useState(false);
  const [driveMessage, setDriveMessage] = useState<string | null>(null);
  const [driveError, setDriveError] = useState<string | null>(null);

  const isDriveConnected = useMemo(() => !!driveConnection?.google_sub, [driveConnection]);
  const loadDriveConnection = async () => {
    setDriveLoading(true);
    setDriveError(null);
    try {
      const connection = await getGoogleDriveConnection();
      setDriveConnection(connection);
    } catch (error: any) {
      console.error("Error cargando conexión de Google Drive:", error);
      setDriveError(error?.message ?? "No se pudo comprobar la conexión con Google Drive.");
    } finally {
      setDriveLoading(false);
    }
  };


  useEffect(() => {
    void loadDriveConnection();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("google_drive");
    const email = params.get("google_email");
    if (!status) return;
    if (status === "connected") {
      setDriveMessage(
        email
          ? `Cuenta Google vinculada correctamente: ${email}`
          : "Cuenta Google vinculada correctamente."
      );
      setDriveError(null);
      void loadDriveConnection();
    } else if (status === "error") {
      setDriveMessage(null);
      setDriveError("No se pudo completar la vinculación con Google Drive.");
    }
    params.delete("google_drive");
    params.delete("google_email");
    const newQuery = params.toString();
    const newUrl = `${window.location.pathname}${newQuery ? `?${newQuery}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", newUrl);
  }, []);


  const handleProfilePhotoChange = (newPhoto: string) => {
    onUpdateUser({ ...user, photo: newPhoto });
  };


  const handleEnablePush = async () => {
    if (!isOnline) {
      alert("No hay conexión. No se pueden activar las notificaciones hasta que vuelva internet.");
      return;
    }

    setPushLoading(true);
    try {
      const subscription = await subscribeToPush(user.id);

      if (!subscription) {
        alert("No se concedió permiso para las notificaciones.");
        setPushEnabled(false);
        return;
      }

      setPushEnabled(true);
      alert("Notificaciones activadas correctamente.");
    } catch (error: any) {
      console.error(error);
      alert(error?.message ?? "No se pudieron activar las notificaciones.");
      setPushEnabled(false);
    } finally {
      setPushLoading(false);
    }
  };

  const handleDisablePush = async () => {
    if (!isOnline) {
      alert("No hay conexión. No se pueden desactivar las notificaciones hasta que vuelva internet.");
      return;
    }

    setPushLoading(true);
    try {
      await unsubscribeFromPush();
      setPushEnabled(false);
      alert("Notificaciones desactivadas correctamente.");
    } catch (error: any) {
      console.error(error);
      alert(error?.message ?? "No se pudieron desactivar las notificaciones.");
    } finally {
      setPushLoading(false);
    }
  };

  const handleLinkGoogleDrive = async () => {
    if (!isOnline) {
      alert("No hay conexión. No se puede vincular Google Drive hasta que vuelva internet.");
      return;
    }
    setDriveLinking(true);
    setDriveError(null);
    setDriveMessage(null);
    try {
      const url = await startGoogleDriveOAuth();
      window.location.href = url;
    } catch (error: any) {
      console.error("Error iniciando OAuth de Google Drive:", error);
      setDriveError(error?.message ?? "No se pudo iniciar la vinculación con Google Drive.");
      setDriveLinking(false);
    }
  };

  return (
    <div className="max-w-md mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white p-6 lg:p-8 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-4 mb-6">
          <div className="p-1 bg-indigo-50 text-indigo-600 rounded-xl w-[48px] h-[48px] flex items-center justify-center overflow-hidden">
            {user.photo ? (
              <img
                src={user.photo}
                alt={user.name}
                className="w-full h-full object-cover rounded-lg"
              />
            ) : (
              <UserIcon size={24} />
            )}
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900">Cuenta</h2>
            <p className="text-slate-500 text-sm">Información de tu perfil.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">
              Nombre
            </label>
            <div className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm text-slate-800">
              {user.name || "-"}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">
              Grupo asignado
            </label>
            <div className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm text-slate-800">
              {groupName}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">
              Correo
            </label>
            <div className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm text-slate-800">
              {user.email || "-"}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">
              Fecha de nacimiento
            </label>
            <div className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm text-slate-800">
              {birth || "No registrada"}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">
              Google Drive
            </label>
            <div className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <HardDrive size={16} />
                    {driveLoading
                      ? "Comprobando conexión..."
                      : isDriveConnected
                        ? "Cuenta Google vinculada"
                        : "Sin cuenta Google vinculada"}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Vincula una cuenta de Google para usar el futuro menú Drive de la aplicación.
                  </p>
                  {!driveLoading && isDriveConnected && (
                    <div className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                      <CheckCircle2 size={14} />
                      {driveConnection?.google_email || "Cuenta vinculada"}
                    </div>
                  )}
                  {driveMessage && (
                    <p className="text-xs text-emerald-700 mt-2 font-medium">
                      {driveMessage}
                    </p>
                  )}
                  {driveError && (
                    <p className="text-xs text-red-700 mt-2 font-medium">
                      {driveError}
                    </p>
                  )}
                  {!isOnline && (
                    <p className="text-xs text-amber-700 mt-2 font-medium">
                      Sin conexión. No puedes vincular Google Drive ahora mismo.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={driveLoading || driveLinking || !isOnline}
                  onClick={() => void handleLinkGoogleDrive()}
                  className={`shrink-0 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                    driveLoading || driveLinking || !isOnline
                      ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                      : "bg-indigo-600 text-white hover:bg-indigo-700"
                  }`}
                >
                  {driveLinking
                    ? "Abriendo..."
                    : isDriveConnected
                      ? "Volver a vincular"
                      : "Vincular"}
                </button>
              </div>
            </div>
          </div>


          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">
              Notificaciones
            </label>

            <div className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    {pushEnabled ? <Bell size={16} /> : <BellOff size={16} />}
                    {pushEnabled ? "Activadas" : "Desactivadas"}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Recibe avisos cuando haya novedades relevantes en la aplicación, como eventos nuevos.
                  </p>
                  {!isOnline && (
                    <p className="text-xs text-amber-700 mt-2 font-medium">
                      Sin conexión. No puedes cambiar esta opción ahora mismo.
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  disabled={pushLoading || !isOnline}
                  onClick={() => {
                    if (pushEnabled) {
                      void handleDisablePush();
                    } else {
                      void handleEnablePush();
                    }
                  }}
                  className={`shrink-0 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                    pushLoading || !isOnline
                      ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                      : pushEnabled
                        ? "bg-red-50 text-red-600 hover:bg-red-100"
                        : "bg-indigo-600 text-white hover:bg-indigo-700"
                  }`}
                >
                  {pushLoading ? "Procesando..." : pushEnabled ? "Desactivar" : "Activar"}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-6 p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-sm">
            <span className="font-bold">Aviso:</span> Para cualquier cambio, por favor ponte en contacto con el coordinador de tu nivel.
          </div>
        </div>
      </div>
    </div>
  );
};

export default MyAccount;
