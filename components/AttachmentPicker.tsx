import React, { useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";

// Mismos límites que supabase/functions/_shared/family-mail-outbox.ts.
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENTS_MB = 20;
const MAX_ATTACHMENTS_BYTES = MAX_ATTACHMENTS_MB * 1024 * 1024;

export const formatFileSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Cuerpo para supabase.functions.invoke: el JSON tal cual o, con adjuntos,
 * multipart/form-data. Los nombres de los archivos viajan también en el JSON
 * porque el parser de multipart de Deno los corta en el primer ";".
 */
export const withAttachments = (payload: Record<string, unknown>, files: File[]) => {
  if (files.length === 0) return payload;
  const form = new FormData();
  form.append("payload", JSON.stringify({ ...payload, attachment_names: files.map((f) => f.name) }));
  files.forEach((f) => form.append("attachments", f));
  return form;
};

/** Botón "Adjuntar archivos" y los archivos elegidos, con los límites de las edge functions. */
const AttachmentPicker: React.FC<{ files: File[]; onChange: (files: File[]) => void; disabled?: boolean }> = ({
  files,
  onChange,
  disabled,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const total = files.reduce((sum, f) => sum + f.size, 0);

  const add = (list: FileList | null) => {
    if (list?.length) {
      const next = [...files, ...Array.from(list)];
      if (next.length > MAX_ATTACHMENTS) {
        setError(`Como mucho ${MAX_ATTACHMENTS} archivos por correo.`);
      } else if (next.reduce((sum, f) => sum + f.size, 0) > MAX_ATTACHMENTS_BYTES) {
        setError(`Los adjuntos no pueden pasar de ${MAX_ATTACHMENTS_MB} MB en total.`);
      } else {
        setError(null);
        onChange(next);
      }
    }
    // Para poder volver a elegir el mismo archivo después de quitarlo.
    if (inputRef.current) inputRef.current.value = "";
  };

  const remove = (index: number) => {
    setError(null);
    onChange(files.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 transition-all flex items-center gap-1.5 disabled:opacity-50"
        >
          <Paperclip size={14} /> Adjuntar archivos
        </button>
        {files.length > 0 && (
          <span className="text-xs text-slate-400">
            {formatFileSize(total)} de {MAX_ATTACHMENTS_MB} MB
          </span>
        )}
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => add(e.target.files)} />
      </div>

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((f, i) => (
            <span
              key={`${f.name}-${f.size}-${i}`}
              className="max-w-full pl-3 pr-1 py-1 rounded-xl text-xs font-bold border border-slate-200 bg-slate-50 text-slate-700 flex items-center gap-1.5"
            >
              <Paperclip size={12} className="shrink-0" />
              <span className="truncate">{f.name}</span>
              <span className="font-normal text-slate-400 shrink-0">{formatFileSize(f.size)}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                disabled={disabled}
                className="p-1 rounded-lg hover:bg-slate-200 disabled:opacity-50"
                aria-label={`Quitar ${f.name}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-amber-700">{error}</p>}
    </div>
  );
};

export default AttachmentPicker;
