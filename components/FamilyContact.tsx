import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mail,
  Send,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { supabase } from "../src/lib/supabaseClient";
import { Group, Student, User } from "../types";
import { ALL_STAGES, STAGE_LABELS, Stage, isGlobalCoordinator } from "../src/utils/stages";

/**
 * Cuenta desde la que escribe cada coordinador. Debe coincidir con SENDERS en
 * supabase/functions/send-family-email/index.ts, que es quien decide de verdad.
 */
export const FAMILY_EMAIL_SENDERS: Record<Stage | "global", string> = {
  preconfirmation: "preconfirmacion@sanpas.es",
  confirmation: "confirmacion@sanpas.es",
  global: "grupojoven@sanpas.es",
};

const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 20000;

interface FamilyContactProps {
  currentUser: User;
  groups: Group[];
  students: Student[];
  isOnline: boolean;
}

type Preview = {
  total: number;
  students: number;
  students_without_email: number;
  from: string;
  logo: boolean;
  html: string;
};

type Progress = {
  sent: number;
  failed: string[];
  total: number;
  done: boolean;
  error?: string;
};

const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/;

/** Misma regla que la edge function: un parent_email puede traer varias direcciones. */
const splitEmails = (raw: string | null | undefined): string[] =>
  String(raw ?? "")
    .split(/[;,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => EMAIL_RE.test(s));

class FamilyEmailError extends Error {
  constructor(public code: string, public detail: any) {
    super(code);
  }
}

const invokeFamilyEmail = async (payload: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke("send-family-email", { body: payload });

  if (error) {
    // En errores HTTP, supabase-js deja la respuesta original en error.context.
    let detail: any = null;
    try {
      detail = await (error as any).context?.json?.();
    } catch {
      // respuesta sin JSON
    }
    throw new FamilyEmailError(detail?.error ?? error.message, detail);
  }

  if (!data?.ok) throw new FamilyEmailError(data?.error ?? "unknown_error", data);
  return data;
};

const describeError = (e: unknown): string => {
  if (!(e instanceof FamilyEmailError)) return (e as any)?.message ?? String(e);

  const d = e.detail ?? {};
  switch (e.code) {
    case "smtp_not_configured":
      return `Falta configurar la contraseña de aplicación de ${d.from ?? "la cuenta de envío"} en Supabase (secret ${d.secret ?? "SMTP_PASS_..."}).`;
    case "smtp_send_failed":
      return `Gmail ha rechazado el envío desde ${d.from ?? "la cuenta"}. Revisa su contraseña de aplicación o si se ha alcanzado el límite diario de Gmail.${d.details ? `\n\nDetalle: ${d.details}` : ""}`;
    case "group_not_allowed":
      return "Solo puedes escribir a los grupos de tu etapa.";
    case "forbidden":
      return "Solo los coordinadores pueden contactar con las familias.";
    case "invalid_or_missing_jwt":
      return "Tu sesión ha caducado. Cierra sesión y vuelve a entrar.";
    case "no_groups":
      return "Selecciona al menos un grupo.";
    case "missing_subject":
      return "Escribe el asunto del correo.";
    case "missing_body":
      return "Escribe el mensaje.";
    case "subject_too_long":
      return `El asunto no puede superar los ${MAX_SUBJECT_LENGTH} caracteres.`;
    case "body_too_long":
      return `El mensaje no puede superar los ${MAX_BODY_LENGTH} caracteres.`;
    case "unknown_group":
      return "Alguno de los grupos ya no existe. Recarga la app e inténtalo de nuevo.";
    default:
      return `Error: ${e.code}${d.details ? ` (${d.details})` : ""}`;
  }
};

const FamilyContact: React.FC<FamilyContactProps> = ({ currentUser, groups, students, isOnline }) => {
  const isGlobal = isGlobalCoordinator(currentUser);
  const ownStage: Stage | null = isGlobal ? null : (currentUser.stage ?? null);
  const senderEmail = FAMILY_EMAIL_SENDERS[ownStage ?? "global"];

  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  // El coordinador general ve todos los grupos; el de etapa, solo los suyos.
  // La edge function vuelve a comprobarlo: esto es solo para la pantalla.
  const allowedGroups = useMemo(
    () => (isGlobal ? groups : groups.filter((g) => ownStage && g.stage === ownStage)),
    [groups, isGlobal, ownStage]
  );

  const sections = useMemo(() => {
    const keys: (Stage | null)[] = [...ALL_STAGES, null];
    return keys
      .map((stage) => ({
        stage,
        label: stage ? STAGE_LABELS[stage] : "Sin etapa",
        groups: allowedGroups.filter((g) => (g.stage ?? null) === stage),
      }))
      .filter((s) => s.groups.length > 0);
  }, [allowedGroups]);

  const allowedIds = useMemo(() => new Set(allowedGroups.map((g) => g.id)), [allowedGroups]);
  const effectiveSelected = useMemo(
    () => selectedGroupIds.filter((id) => allowedIds.has(id)),
    [selectedGroupIds, allowedIds]
  );

  // Estimación en vivo con los datos ya cargados; el número definitivo lo da
  // la edge function en la vista previa.
  const estimate = useMemo(() => {
    const selected = new Set(effectiveSelected);
    const emails = new Set<string>();
    let count = 0;
    let withoutEmail = 0;

    for (const s of students) {
      if (!selected.has(s.groupId)) continue;
      count++;
      const list = splitEmails(s.parentEmail);
      if (list.length === 0) withoutEmail++;
      list.forEach((e) => emails.add(e));
    }

    return { families: emails.size, students: count, withoutEmail };
  }, [students, effectiveSelected]);

  const allSelected = allowedGroups.length > 0 && effectiveSelected.length === allowedGroups.length;

  const toggleGroup = (id: string) => {
    setSelectedGroupIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const setSection = (ids: string[], select: boolean) => {
    setSelectedGroupIds((prev) => {
      const rest = prev.filter((id) => !ids.includes(id));
      return select ? [...rest, ...ids] : rest;
    });
  };

  const handleReview = async () => {
    if (!isOnline) {
      alert("No hay conexión. No se pueden enviar correos hasta que vuelva internet.");
      return;
    }
    if (effectiveSelected.length === 0) {
      alert("Selecciona al menos un grupo.");
      return;
    }
    if (!subject.trim() || !body.trim()) {
      alert("Escribe el asunto y el mensaje.");
      return;
    }

    setIsPreviewLoading(true);
    try {
      const data = await invokeFamilyEmail({
        action: "preview",
        group_ids: effectiveSelected,
        subject,
        body,
      });
      setProgress(null);
      setPreview(data as Preview);
    } catch (e) {
      alert(describeError(e));
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleSend = async () => {
    if (!preview || isSending) return;
    if (!isOnline) {
      alert("No hay conexión. No se pueden enviar correos hasta que vuelva internet.");
      return;
    }

    setIsSending(true);

    let offset = 0;
    let sent = 0;
    let total = preview.total;
    const failed: string[] = [];
    setProgress({ sent, failed: [], total, done: false });

    try {
      // Una llamada por tanda: la edge function envía como mucho 20 por vez.
      while (offset < total) {
        const data = await invokeFamilyEmail({
          action: "send",
          group_ids: effectiveSelected,
          subject,
          body,
          offset,
        });

        sent += data.sent ?? 0;
        failed.push(...(data.failed ?? []));
        total = data.total ?? total;

        const next = Number(data.next_offset ?? offset);
        setProgress({ sent, failed: [...failed], total, done: false });

        if (data.done || next <= offset) break;
        offset = next;
      }

      setProgress({ sent, failed: [...failed], total, done: true });

      // Formulario limpio tras un envío completo, para no mandarlo dos veces.
      if (failed.length === 0) {
        setSubject("");
        setBody("");
        setSelectedGroupIds([]);
      }
    } catch (e) {
      setProgress({ sent, failed: [...failed], total, done: true, error: describeError(e) });
    } finally {
      setIsSending(false);
    }
  };

  const closeModal = () => {
    if (isSending) return;
    setPreview(null);
    setProgress(null);
  };

  const progressPct = progress && progress.total > 0
    ? Math.round(((progress.sent + progress.failed.length) / progress.total) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Remitente */}
      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
          <Mail size={20} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Se enviará desde</p>
          <p className="font-bold text-slate-800 truncate">{senderEmail}</p>
          <p className="text-xs text-slate-500 mt-1">
            Cada familia recibe su propio correo: nadie ve las direcciones de las demás.
          </p>
        </div>
      </div>

      {/* Grupos */}
      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-bold text-slate-800 flex items-center gap-2">
            <Users size={18} className="text-indigo-600" /> Destinatarios
          </h3>
          {allowedGroups.length > 0 && (
            <button
              type="button"
              onClick={() => setSection(allowedGroups.map((g) => g.id), !allSelected)}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-50 text-slate-600 hover:bg-slate-100 transition-all"
            >
              {allSelected ? "Quitar todos" : "Todos los grupos"}
            </button>
          )}
        </div>

        {sections.length === 0 && (
          <p className="text-sm text-slate-500">No hay grupos a los que puedas escribir.</p>
        )}

        {sections.map((section) => {
          const ids = section.groups.map((g) => g.id);
          const sectionAll = ids.every((id) => effectiveSelected.includes(id));

          return (
            <div key={section.stage ?? "none"} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {section.label}
                </span>
                {sections.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setSection(ids, !sectionAll)}
                    className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800"
                  >
                    {sectionAll ? "Quitar" : "Seleccionar todos"}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {section.groups.map((g) => {
                  const active = effectiveSelected.includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => toggleGroup(g.id)}
                      aria-pressed={active}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                        active
                          ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {g.name}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        {effectiveSelected.length > 0 && (
          <p className="text-xs text-slate-500 pt-2 border-t border-slate-100">
            <span className="font-bold text-slate-700">{estimate.families}</span>{" "}
            {estimate.families === 1 ? "familia" : "familias"} con correo
            {" · "}
            {estimate.students} {estimate.students === 1 ? "niño" : "niños"}
            {estimate.withoutEmail > 0 && (
              <span className="text-amber-600">
                {" · "}
                {estimate.withoutEmail} sin correo de padres
              </span>
            )}
          </p>
        )}
      </div>

      {/* Mensaje */}
      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Asunto</label>
          <input
            className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
            value={subject}
            maxLength={MAX_SUBJECT_LENGTH}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Ej: Convivencia de preconfirmación"
          />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Mensaje</label>
          <textarea
            className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm min-h-[220px] resize-y"
            value={body}
            maxLength={MAX_BODY_LENGTH}
            onChange={(e) => setBody(e.target.value)}
            placeholder={"Estimadas familias:\n\n..."}
          />
        </div>
        <p className="text-xs text-slate-500 flex items-start gap-2">
          <ShieldCheck size={14} className="text-indigo-600 shrink-0 mt-0.5" />
          Al final del correo se añade automáticamente la firma de protección de datos con el logo del Grupo Joven.
        </p>

        <button
          type="button"
          onClick={() => void handleReview()}
          disabled={!isOnline || isPreviewLoading || effectiveSelected.length === 0}
          className={`w-full py-3 font-bold rounded-2xl flex items-center justify-center gap-2 text-sm transition-all ${
            isOnline && effectiveSelected.length > 0 && !isPreviewLoading
              ? "bg-indigo-600 text-white shadow-lg hover:bg-indigo-700"
              : "bg-slate-200 text-slate-500 cursor-not-allowed"
          }`}
        >
          {isPreviewLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          Revisar y enviar
        </button>
      </div>

      {/* Vista previa, envío y resultado */}
      {preview && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 p-4 sm:p-6 border-b">
              <h3 className="text-lg font-bold text-slate-800">
                {progress ? (progress.done ? "Envío terminado" : "Enviando…") : "Revisa el correo"}
              </h3>
              {!isSending && (
                <button onClick={closeModal} className="p-2 rounded-xl hover:bg-slate-100" aria-label="Cerrar">
                  <X size={20} />
                </button>
              )}
            </div>

            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto">
              {!progress && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div className="p-3 rounded-xl bg-slate-50">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Desde</p>
                      <p className="font-bold text-slate-800 truncate">{preview.from}</p>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Para</p>
                      <p className="font-bold text-slate-800">
                        {preview.total} {preview.total === 1 ? "familia" : "familias"}
                      </p>
                    </div>
                  </div>

                  {preview.students_without_email > 0 && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                      {preview.students_without_email}{" "}
                      {preview.students_without_email === 1 ? "niño no tiene" : "niños no tienen"} correo de padres
                      válido y no recibirán el mensaje.
                    </p>
                  )}

                  {!preview.logo && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
                      El logo de la firma aún no está subido a Supabase (bucket público "email-assets"), así que el
                      correo saldría sin imagen.
                    </p>
                  )}

                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                      Asunto: <span className="normal-case text-slate-700">{subject}</span>
                    </p>
                    <iframe
                      title="Vista previa del correo"
                      sandbox=""
                      srcDoc={preview.html}
                      className="w-full h-[45vh] rounded-xl border border-slate-200 bg-white"
                    />
                  </div>
                </>
              )}

              {progress && (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between text-xs font-bold text-slate-500 mb-1">
                      <span>
                        {progress.sent} de {progress.total} enviados
                      </span>
                      <span>{progressPct}%</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          progress.error ? "bg-red-500" : "bg-indigo-600"
                        }`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>

                  {!progress.done && (
                    <p className="text-sm text-slate-500 flex items-center gap-2">
                      <Loader2 size={16} className="animate-spin" /> No cierres esta pantalla hasta que termine.
                    </p>
                  )}

                  {progress.done && !progress.error && progress.failed.length === 0 && (
                    <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2">
                      <CheckCircle2 size={18} /> Correo enviado a {progress.sent}{" "}
                      {progress.sent === 1 ? "familia" : "familias"}.
                    </p>
                  )}

                  {progress.error && (
                    <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 space-y-1">
                      <p className="font-bold flex items-center gap-2">
                        <AlertTriangle size={16} /> El envío se ha detenido
                      </p>
                      <p className="whitespace-pre-line">{progress.error}</p>
                      <p>
                        Ya se había enviado a {progress.sent} {progress.sent === 1 ? "familia" : "familias"}. Si lo
                        reintentas, esas familias lo recibirán otra vez.
                      </p>
                    </div>
                  )}

                  {progress.failed.length > 0 && (
                    <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
                      <p className="font-bold">No se pudo enviar a {progress.failed.length}:</p>
                      <ul className="text-xs list-disc pl-5 break-all">
                        {progress.failed.map((email) => (
                          <li key={email}>{email}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="p-4 sm:p-6 border-t flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
              {!progress && (
                <>
                  <button
                    onClick={closeModal}
                    className="px-4 py-2.5 rounded-xl font-bold text-sm bg-slate-100 text-slate-700 hover:bg-slate-200"
                  >
                    Volver a editar
                  </button>
                  <button
                    onClick={() => void handleSend()}
                    disabled={preview.total === 0}
                    className={`px-4 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 ${
                      preview.total > 0
                        ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-md"
                        : "bg-slate-200 text-slate-500 cursor-not-allowed"
                    }`}
                  >
                    <Send size={16} />
                    {preview.total > 0
                      ? `Enviar a ${preview.total} ${preview.total === 1 ? "familia" : "familias"}`
                      : "Nadie con correo"}
                  </button>
                </>
              )}
              {progress?.done && (
                <button
                  onClick={closeModal}
                  className="px-4 py-2.5 rounded-xl font-bold text-sm bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  Cerrar
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FamilyContact;
