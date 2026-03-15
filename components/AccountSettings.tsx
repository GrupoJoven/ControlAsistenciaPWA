import React, { useState } from "react";
import { Key } from "lucide-react";
import { supabase } from "../src/lib/supabaseClient";
import { User } from "../types";

interface AccountSettingsProps {
  isOnline: boolean;
}

const AccountSettings: React.FC<AccountSettingsProps> = ({ isOnline }) => {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleUpdatePassword = async () => {
    if (!isOnline) {
      alert("No hay conexión. No se puede actualizar la contraseña hasta que vuelva internet.");
      return;
    }
    if (!newPassword) {
      alert("Por favor introduce una nueva contraseña.");
      return;
    }
    if (newPassword !== confirmPassword) {
      alert("Las contraseñas no coinciden.");
      return;
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      alert("No se pudo actualizar la contraseña: " + error.message);
      return;
    }

    setNewPassword("");
    setConfirmPassword("");
    alert("Contraseña actualizada con éxito.");
  };

  return (
    <div className="max-w-md mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white p-6 lg:p-8 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-4 mb-8">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl">
            <Key size={24} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Seguridad</h2>
            <p className="text-slate-500 text-sm">Cambia tu contraseña de acceso.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">
              Nueva Contraseña
            </label>
            <input
              type="password"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1 ml-1">
              Confirmar Contraseña
            </label>
            <input
              type="password"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <button
            onClick={() => void handleUpdatePassword()}
            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl shadow-lg transition-all mt-4"
          >
            Actualizar Contraseña
          </button>
        </div>
      </div>
    </div>
  );
};

export default AccountSettings;