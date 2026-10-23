import React, { useCallback, useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  Paperclip,
  RefreshCw,
  Reply,
  Search,
  Send,
  ShieldCheck,
  SquarePen,
  X,
} from "lucide-react";
import { supabase } from "../src/lib/supabaseClient";
import { User } from "../types";
import { Stage, isGlobalCoordinator } from "../src/utils/stages";
import { FAMILY_EMAIL_SENDERS } from "./FamilyContact";
import AttachmentPicker, {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENTS_MB,
  formatFileSize,
  withAttachments,
} from "./AttachmentPicker";

const MAX_BODY_LENGTH = 20000;
const MAX_SUBJECT_LENGTH = 200;
const MAX_RECIPIENTS = 20;

const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/;

/** Misma regla que la edge function: direcciones separadas por comas, punto y coma o espacios. */
const parseRecipients = (raw: string) => {
  const unique = Array.from(
    new Set(
      raw
        .split(/[,;\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    )
  );
  return {
    valid: unique.filter((e) => EMAIL_RE.test(e)),
    invalid: unique.filter((e) => !EMAIL_RE.test(e)),
  };
};

/** Correo nuevo que otra pantalla deja preparado (p. ej. "Email Padres" en Todos los Niños). */
export type MailDraft = { to: string; subject?: string };

interface FamilyInboxProps {
  currentUser: User;
  isOnline: boolean;
  /** Si llega, Correo se abre directamente en Redactar con estos datos. */
  initialDraft?: MailDraft | null;
  /** Avisa de que el borrador ya se ha usado, para no volver a abrirlo. */
  onDraftUsed?: () => void;
}

type Folder = "inbox" | "sent";

type Address = { name: string; address: string };

type MessageSummary = {
  uid: number;
  subject: string;
  from: Address | null;
  to: Address[];
  date: string | null;
  seen: boolean;
  answered: boolean;
  has_attachments: boolean;
};

type ListResult = {
  total: number;
  page: number;
  page_size: number;
  unseen: number | null;
  messages: MessageSummary[];
};

type Attachment = { part: string; filename: string; mime_type: string; size: number };

type MessageDetail = MessageSummary & {
  folder: Folder;
  cc: Address[];
  html: string | null;
  text: string | null;
  attachments: Attachment[];
  reply_to: Address | null;
};

class InboxError extends Error {
  constructor(public code: string, public detail: any) {
    super(code);
  }
}

/** Llama a la edge function family-inbox, que decide qué buzón le toca a cada coordinador. */
const invokeInbox = async (payload: Record<string, unknown>, files: File[] = []) => {
  const { data, error } = await supabase.functions.invoke("family-inbox", { body: withAttachments(payload, files) });

  if (error) {
    // En errores HTTP, supabase-js deja la respuesta original en error.context.
    let detail: any = null;
    try {
      detail = await (error as any).context?.json?.();
    } catch {
      // respuesta sin JSON
    }
    throw new InboxError(detail?.error ?? error.message, detail);
  }

  // Los adjuntos llegan como Blob; el resto, como JSON con ok.
  if (data instanceof Blob) return data;
  if (!data?.ok) throw new InboxError(data?.error ?? "unknown_error", data);
  return data;
};

const describeError = (e: unknown): string => {
  if (!(e instanceof InboxError)) return (e as any)?.message ?? String(e);

  const d = e.detail ?? {};
  switch (e.code) {
    case "password_not_configured":
      return `Falta configurar la contraseña de aplicación de ${d.from ?? "la cuenta"} en Supabase (secret ${d.secret ?? "SMTP_PASS_..."}).`;
    case "imap_auth_failed":
      return `Gmail no acepta la contraseña de aplicación de ${d.from ?? "la cuenta"}. Puede que se haya revocado: crea una nueva y actualiza su secret en Supabase.`;
    case "imap_disabled":
      return `La cuenta ${d.from ?? ""} no tiene permitido el acceso IMAP. El administrador de Google Workspace tiene que activarlo para poder leer el correo desde la app.`;
    case "imap_failed":
      return `No se ha podido conectar con Gmail.${d.details ? `\n\nDetalle: ${d.details}` : ""}`;
    case "sent_folder_not_found":
      return "No se encuentra la carpeta Enviados de la cuenta.";
    case "smtp_send_failed":
      return `Gmail ha rechazado el envío desde ${d.from ?? "la cuenta"}. Revisa su contraseña de aplicación o si se ha alcanzado el límite diario de Gmail.${d.details ? `\n\nDetalle: ${d.details}` : ""}`;
    case "message_not_found":
      return "Ese correo ya no está en el buzón: puede que se haya borrado o movido desde Gmail.";
    case "attachment_not_found":
      return "No se encuentra ese adjunto en el correo.";
    case "attachment_too_large":
      return "El adjunto es demasiado grande para descargarlo desde la app. Ábrelo desde Gmail.";
    case "too_many_attachments":
      return `Como mucho ${d.max ?? MAX_ATTACHMENTS} archivos por correo.`;
    case "attachments_too_large":
      return `Los adjuntos no pueden pasar de ${d.max_mb ?? MAX_ATTACHMENTS_MB} MB en total.`;
    case "flag_update_failed":
      return "Gmail no ha dejado cambiar si este correo está leído. Inténtalo de nuevo o hazlo desde Gmail.";
    case "no_reply_recipient":
      return "Este correo no tiene una dirección a la que responder.";
    case "no_recipients":
      return "Escribe al menos una dirección en Para.";
    case "invalid_recipients":
      return `Revisa estas direcciones: ${(d.invalid ?? []).join(", ")}`;
    case "too_many_recipients":
      return `Como mucho ${d.max ?? MAX_RECIPIENTS} direcciones por correo. Para escribir a grupos enteros usa "Contactar familias".`;
    case "missing_subject":
      return "Escribe el asunto.";
    case "subject_too_long":
      return `El asunto no puede superar los ${MAX_SUBJECT_LENGTH} caracteres.`;
    case "missing_body":
      return "Escribe el mensaje.";
    case "body_too_long":
      return `El mensaje no puede superar los ${MAX_BODY_LENGTH} caracteres.`;
    case "forbidden":
      return "Solo los coordinadores pueden ver el correo.";
    case "invalid_or_missing_jwt":
      return "Tu sesión ha caducado. Cierra sesión y vuelve a entrar.";
    default:
      return `Error: ${e.code}${d.details ? ` (${d.details})` : ""}`;
  }
};

// ---------------------------------------------------------------------------
// HTML de los correos
// ---------------------------------------------------------------------------

// Todos los enlaces se abren fuera de la app.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

const REMOTE_IMAGE_RE = /<img[^>]+src\s*=\s*["']?\s*https?:|url\(\s*["']?\s*https?:|background\s*=\s*["']?\s*https?:/i;

/**
 * Documento que se pinta en el iframe. Además de limpiarlo con DOMPurify, el
 * iframe no puede ejecutar scripts ni enviar formularios, y su CSP impide cargar
 * nada de fuera (imágenes de seguimiento incluidas) salvo que se pida.
 */
const buildEmailDocument = (html: string, showRemoteImages: boolean) => {
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ["form", "input", "button", "textarea", "select", "option", "meta", "link", "base", "iframe", "object", "embed"],
  });

  const doc = new DOMParser().parseFromString(clean, "text/html");
  const imgSrc = showRemoteImages ? "data: https: http:" : "data:";

  const csp = doc.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data:`);

  const style = doc.createElement("style");
  style.textContent =
    "body{margin:0;padding:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222;overflow-wrap:anywhere}" +
    "img{max-width:100%;height:auto}table{max-width:100%}" +
    // Las imágenes bloqueadas ocupan su sitio pero sin el icono de imagen rota.
    (showRemoteImages ? "" : 'img[src^="http:"],img[src^="https:"]{visibility:hidden}');

  doc.head.prepend(csp, style);
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
};

const hasRemoteImages = (html: string | null) => !!html && REMOTE_IMAGE_RE.test(html);

/** iframe que crece con su contenido, para que no haya dos barras de scroll. */
const EmailFrame: React.FC<{ html: string }> = ({ html }) => {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(240);

  const resize = useCallback(() => {
    const frame = ref.current;
    const doc = frame?.contentDocument;
    if (!frame || !doc?.documentElement) return;
    // Se mide con el iframe a 0 de alto: si no, scrollHeight nunca baja de la
    // altura que ya tiene y queda un hueco en blanco debajo del correo.
    const borders = frame.offsetHeight - frame.clientHeight;
    const previous = frame.style.height;
    frame.style.height = "0px";
    const contentHeight = doc.documentElement.scrollHeight;
    frame.style.height = previous;
    setHeight(Math.max(120, contentHeight + borders));
  }, []);

  useEffect(() => {
    // Las imágenes cambian la altura después del load.
    const timers = [300, 1200, 3000].map((ms) => window.setTimeout(resize, ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [html, resize]);

  return (
    <iframe
      ref={ref}
      title="Contenido del correo"
      // Sin allow-scripts: el correo no puede ejecutar nada. allow-same-origin
      // solo sirve para medir la altura desde aquí.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={html}
      onLoad={resize}
      style={{ height }}
      className="w-full rounded-xl border border-slate-200 bg-white"
    />
  );
};

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------

const formatListDate = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
  }
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" });
};

const formatFullDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("es-ES", { dateStyle: "full", timeStyle: "short" })
    : "";

const addressLabel = (a: Address | null | undefined) => (a ? a.name || a.address : "");

const addressFull = (a: Address) => (a.name ? `${a.name} <${a.address}>` : a.address);

// ---------------------------------------------------------------------------

const FamilyInbox: React.FC<FamilyInboxProps> = ({ currentUser, isOnline, initialDraft, onDraftUsed }) => {
  const isGlobal = isGlobalCoordinator(currentUser);
  const ownStage: Stage | null = isGlobal ? null : (currentUser.stage ?? null);
  const accountEmail = FAMILY_EMAIL_SENDERS[ownStage ?? "global"];

  const topRef = useRef<HTMLDivElement>(null);

  const [folder, setFolder] = useState<Folder>("inbox");
  const [page, setPage] = useState(0);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  // Solo en Recibidos: en Enviados se ignora.
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [list, setList] = useState<ListResult | null>(null);
  const [inboxUnseen, setInboxUnseen] = useState<number | null>(null);
  const [isListLoading, setIsListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [openUid, setOpenUid] = useState<number | null>(null);
  const [message, setMessage] = useState<MessageDetail | null>(null);
  const [isMessageLoading, setIsMessageLoading] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [showImages, setShowImages] = useState(false);
  const [downloadingPart, setDownloadingPart] = useState<string | null>(null);
  const [isMarking, setIsMarking] = useState(false);

  const [isReplyOpen, setIsReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [isReplying, setIsReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replySentTo, setReplySentTo] = useState<string | null>(null);

  const [isComposing, setIsComposing] = useState(!!initialDraft);
  const [composeTo, setComposeTo] = useState(initialDraft?.to ?? "");
  const [isToFocused, setIsToFocused] = useState(false);
  const [composeSubject, setComposeSubject] = useState(initialDraft?.subject ?? "");
  const [composeBody, setComposeBody] = useState("");
  const [composeFiles, setComposeFiles] = useState<File[]>([]);
  // Con varias direcciones, por defecto en copia oculta.
  const [hideRecipients, setHideRecipients] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const [sentNotice, setSentNotice] = useState<string | null>(null);
  const composeToRef = useRef<HTMLInputElement>(null);

  // El borrador recibido ya está en el formulario: se avisa para que la
  // próxima vez que se entre en Correo no vuelva a abrirse.
  useEffect(() => {
    if (initialDraft) onDraftUsed?.();
    // Solo al montar: el borrador se copia en el estado inicial.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lista. El contador evita que una respuesta lenta pise a otra más nueva.
  const listRequest = useRef(0);
  useEffect(() => {
    if (!isOnline) return;
    const requestId = ++listRequest.current;

    setIsListLoading(true);
    setListError(null);

    invokeInbox({ action: "list", folder, page, query, unread: folder === "inbox" && unreadOnly })
      .then((data) => {
        if (requestId !== listRequest.current) return;
        setList(data as ListResult);
        if (folder === "inbox") setInboxUnseen((data as ListResult).unseen);
      })
      .catch((e) => {
        if (requestId !== listRequest.current) return;
        setList(null);
        setListError(describeError(e));
      })
      .finally(() => {
        if (requestId === listRequest.current) setIsListLoading(false);
      });
  }, [folder, page, query, unreadOnly, reloadKey, isOnline]);

  // Mensaje abierto
  const messageRequest = useRef(0);
  useEffect(() => {
    if (openUid === null || !isOnline) return;
    const requestId = ++messageRequest.current;

    setIsMessageLoading(true);
    setMessageError(null);
    setMessage(null);

    invokeInbox({ action: "get", folder, uid: openUid })
      .then((data) => {
        if (requestId === messageRequest.current) setMessage((data as any).message as MessageDetail);
      })
      .catch((e) => {
        if (requestId === messageRequest.current) setMessageError(describeError(e));
      })
      .finally(() => {
        if (requestId === messageRequest.current) setIsMessageLoading(false);
      });
  }, [openUid, folder, isOnline]);

  const changeFolder = (next: Folder) => {
    if (next === folder) return;
    setSentNotice(null);
    closeMessage();
    setFolder(next);
    setPage(0);
  };

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    closeMessage();
    setPage(0);
    setQuery(queryInput.trim());
  };

  const clearSearch = () => {
    setQueryInput("");
    setQuery("");
    setPage(0);
  };

  const openMessage = (uid: number) => {
    setOpenUid(uid);
    setShowImages(false);
    setIsReplyOpen(false);
    setReplyBody("");
    setReplyFiles([]);
    setReplyError(null);
    setReplySentTo(null);
    topRef.current?.scrollIntoView({ block: "start" });
  };

  const closeMessage = () => {
    if (isReplying) return;
    messageRequest.current++;
    setOpenUid(null);
    setMessage(null);
    setMessageError(null);
    setIsMessageLoading(false);
  };

  /** Abrir un correo no lo marca como leído: solo este botón cambia su estado en Gmail. */
  const handleToggleSeen = async () => {
    if (!message || isMarking) return;
    const { uid, folder: messageFolder } = message;

    setIsMarking(true);
    try {
      const data = (await invokeInbox({ action: "mark", folder: messageFolder, uid, seen: !message.seen })) as {
        seen: boolean;
        unseen: number | null;
      };

      setMessage((m) => (m && m.uid === uid ? { ...m, seen: data.seen } : m));
      setList((l) =>
        l
          ? {
              ...l,
              unseen: messageFolder === "inbox" ? data.unseen : l.unseen,
              messages: l.messages.map((x) => (x.uid === uid ? { ...x, seen: data.seen } : x)),
            }
          : l
      );
      if (data.unseen !== null) setInboxUnseen(data.unseen);
      // Con "Solo no leídos", la lista cambia: se recarga para cuando se vuelva a ella.
      if (unreadOnly && messageFolder === "inbox") setReloadKey((k) => k + 1);
    } catch (e) {
      alert(describeError(e));
    } finally {
      setIsMarking(false);
    }
  };

  const handleDownload = async (att: Attachment) => {
    if (!message || downloadingPart) return;
    setDownloadingPart(att.part);
    try {
      const blob = (await invokeInbox({
        action: "attachment",
        folder: message.folder,
        uid: message.uid,
        part: att.part,
      })) as Blob;

      const url = URL.createObjectURL(new Blob([blob], { type: att.mime_type || "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = att.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      alert(describeError(e));
    } finally {
      setDownloadingPart(null);
    }
  };

  const handleReply = async () => {
    if (!message || isReplying) return;
    if (!isOnline) {
      alert("No hay conexión. No se puede enviar la respuesta hasta que vuelva internet.");
      return;
    }
    if (!replyBody.trim()) {
      setReplyError("Escribe la respuesta.");
      return;
    }

    setIsReplying(true);
    setReplyError(null);
    try {
      const data = await invokeInbox({ action: "reply", uid: message.uid, body: replyBody }, replyFiles);
      setReplySentTo((data as any).to ?? message.reply_to?.address ?? "");
      setReplyBody("");
      setReplyFiles([]);
      setIsReplyOpen(false);
    } catch (e) {
      setReplyError(describeError(e));
    } finally {
      setIsReplying(false);
    }
  };

  const openCompose = () => {
    closeMessage();
    setIsComposing(true);
    setComposeError(null);
    setSentNotice(null);
    topRef.current?.scrollIntoView({ block: "start" });
  };

  const resetCompose = () => {
    setIsComposing(false);
    setComposeTo("");
    setComposeSubject("");
    setComposeBody("");
    setComposeFiles([]);
    setHideRecipients(true);
    setComposeError(null);
  };

  const discardCompose = () => {
    if (isSending) return;
    const hasDraft = composeTo.trim() || composeSubject.trim() || composeBody.trim() || composeFiles.length > 0;
    if (hasDraft && !window.confirm("¿Descartar este correo?")) return;
    resetCompose();
  };

  const recipients = parseRecipients(composeTo);
  // La dirección que se está escribiendo no se marca como mala hasta que se
  // pasa a la siguiente o se sale del campo. Se mira también activeElement
  // porque con autoFocus React no llama a onFocus.
  const toHasFocus = isToFocused || (!!composeToRef.current && document.activeElement === composeToRef.current);
  const typingToken =
    toHasFocus && !/[,;\s]$/.test(composeTo) ? composeTo.split(/[,;\s]+/).pop()?.trim().toLowerCase() : undefined;
  const shownInvalid = recipients.invalid.filter((e) => e !== typingToken);
  const canSend =
    isOnline &&
    !isSending &&
    recipients.valid.length > 0 &&
    recipients.invalid.length === 0 &&
    recipients.valid.length <= MAX_RECIPIENTS &&
    !!composeSubject.trim() &&
    !!composeBody.trim();

  const handleSend = async () => {
    if (isSending) return;
    if (!isOnline) {
      alert("No hay conexión. No se puede enviar el correo hasta que vuelva internet.");
      return;
    }

    setIsSending(true);
    setComposeError(null);
    try {
      const data = (await invokeInbox(
        {
          action: "send",
          to: recipients.valid,
          subject: composeSubject,
          body: composeBody,
          hide_recipients: hideRecipients,
        },
        composeFiles
      )) as { sent: string[]; failed: string[]; hidden: boolean };

      const sent = data.sent ?? [];
      const failed = data.failed ?? [];
      const sentLabel = sent.length === 1 ? sent[0] : `${sent.length} direcciones`;

      if (failed.length > 0) {
        // Se deja el borrador solo con las que fallaron, para reintentarlo.
        setComposeTo(failed.join(", "));
        setComposeError(
          `Enviado a ${sentLabel}, pero no se pudo enviar a: ${failed.join(", ")}. Se han dejado en Para para que lo reintentes.`
        );
        return;
      }

      resetCompose();
      // En CCO, Gmail no guarda en Enviados a quién se mandó: se dice aquí.
      setSentNotice(
        data.hidden
          ? `Correo enviado en copia oculta (CCO) a: ${sent.join(", ")}. En Enviados de Gmail no se verán estas direcciones.`
          : `Correo enviado a ${sentLabel}. Queda en Enviados de ${accountEmail}.`
      );
      // Se ve enseguida en Enviados.
      setFolder("sent");
      setPage(0);
      setQueryInput("");
      setQuery("");
      setReloadKey((k) => k + 1);
    } catch (e) {
      setComposeError(describeError(e));
    } finally {
      setIsSending(false);
    }
  };

  const total = list?.total ?? 0;
  const pageSize = list?.page_size ?? 25;
  const firstShown = total === 0 ? 0 : page * pageSize + 1;
  const lastShown = Math.min(total, (page + 1) * pageSize);
  const hasPrev = page > 0;
  const hasNext = lastShown < total;

  const emailDocument = message?.html ? buildEmailDocument(message.html, showImages) : null;

  return (
    <div ref={topRef} className="space-y-6 scroll-mt-24">
      {/* Cuenta */}
      <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
          <Inbox size={20} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Buzón de</p>
          <p className="font-bold text-slate-800 truncate">{accountEmail}</p>
          <p className="text-xs text-slate-500 mt-1">
            Abrir un correo aquí no lo marca como leído en Gmail: hazlo con el botón del propio correo. Desde la app
            no se borra ni se mueve nada.
          </p>
        </div>
      </div>

      {!isOnline && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-2">
          <AlertTriangle size={18} className="shrink-0" /> Sin conexión: el correo se lee directamente de Gmail y no
          está disponible hasta que vuelva internet.
        </p>
      )}

      {/* Carpeta y búsqueda */}
      {openUid === null && !isComposing && (
        <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-2">
              {(["inbox", "sent"] as Folder[]).map((f) => {
                const active = folder === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => changeFolder(f)}
                    aria-pressed={active}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all flex items-center gap-1.5 ${
                      active
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {f === "inbox" ? <Inbox size={14} /> : <Send size={14} />}
                    {f === "inbox" ? "Recibidos" : "Enviados"}
                    {f === "inbox" && !!inboxUnseen && (
                      <span
                        className={`ml-0.5 px-1.5 rounded-full text-[10px] ${
                          active ? "bg-white/20 text-white" : "bg-indigo-50 text-indigo-700"
                        }`}
                      >
                        {inboxUnseen}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                disabled={!isOnline || isListLoading}
                className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                aria-label="Actualizar"
                title="Actualizar"
              >
                <RefreshCw size={18} className={isListLoading ? "animate-spin" : ""} />
              </button>
              <button
                type="button"
                onClick={openCompose}
                disabled={!isOnline}
                className="p-2 sm:px-3 sm:py-1.5 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm flex items-center gap-1.5 disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
                aria-label="Redactar"
                title="Redactar un correo nuevo"
              >
                <SquarePen size={16} />
                <span className="hidden sm:inline">Redactar</span>
              </button>
            </div>
          </div>

          <form onSubmit={submitSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="w-full pl-9 pr-9 py-2 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
                value={queryInput}
                maxLength={200}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="Buscar (como en Gmail)"
                title="Admite lo mismo que el buscador de Gmail: palabras, from:correo, has:attachment…"
              />
              {(queryInput || query) && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:bg-slate-100"
                  aria-label="Quitar búsqueda"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={!isOnline}
              className="px-4 py-2 rounded-xl font-bold text-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-500"
            >
              Buscar
            </button>
          </form>

          {folder === "inbox" && (
            <button
              type="button"
              onClick={() => {
                setUnreadOnly((v) => !v);
                setPage(0);
              }}
              aria-pressed={unreadOnly}
              className={`w-fit px-3 py-1.5 rounded-full text-xs font-bold border transition-all flex items-center gap-1.5 ${
                unreadOnly
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              }`}
            >
              <Mail size={14} /> Solo no leídos
            </button>
          )}
        </div>
      )}

      {sentNotice && openUid === null && !isComposing && (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-2xl p-4 flex items-center gap-2">
          <CheckCircle2 size={18} className="shrink-0" />
          <span className="flex-1 break-words min-w-0">{sentNotice}</span>
          <button
            type="button"
            onClick={() => setSentNotice(null)}
            className="p-1 rounded-lg hover:bg-green-100"
            aria-label="Cerrar aviso"
          >
            <X size={14} />
          </button>
        </p>
      )}

      {/* Lista */}
      {openUid === null && !isComposing && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {listError && (
            <div className="m-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 space-y-1">
              <p className="font-bold flex items-center gap-2">
                <AlertTriangle size={16} /> No se ha podido abrir el buzón
              </p>
              <p className="whitespace-pre-line">{listError}</p>
            </div>
          )}

          {isListLoading && !list && (
            <p className="p-6 text-sm text-slate-500 flex items-center gap-2">
              <Loader2 size={16} className="animate-spin" /> Cargando correo…
            </p>
          )}

          {list && list.messages.length === 0 && !isListLoading && (
            <p className="p-6 text-sm text-slate-500">
              {query
                ? "Ningún correo coincide con la búsqueda."
                : folder === "inbox" && unreadOnly
                  ? "No hay correos sin leer."
                  : "No hay correos en esta carpeta."}
            </p>
          )}

          {list && list.messages.length > 0 && (
            <ul className={`divide-y divide-slate-100 ${isListLoading ? "opacity-60" : ""}`}>
              {list.messages.map((m) => {
                const who =
                  folder === "sent"
                    ? `Para: ${m.to.map(addressLabel).join(", ") || "destinatarios ocultos (CCO)"}`
                    : addressLabel(m.from) || "(sin remitente)";
                const unread = folder === "inbox" && !m.seen;

                return (
                  <li key={m.uid}>
                    <button
                      type="button"
                      onClick={() => openMessage(m.uid)}
                      className="w-full text-left px-4 sm:px-6 py-3 hover:bg-slate-50 transition-colors flex gap-3"
                    >
                      <span
                        className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${unread ? "bg-indigo-600" : "bg-transparent"}`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-3">
                          <span className={`truncate text-sm ${unread ? "font-bold text-slate-900" : "text-slate-700"}`}>
                            {who}
                          </span>
                          <span className={`shrink-0 text-xs ${unread ? "font-bold text-indigo-700" : "text-slate-400"}`}>
                            {formatListDate(m.date)}
                          </span>
                        </span>
                        <span className="flex items-center gap-1.5 mt-0.5">
                          {m.answered && <Reply size={12} className="text-slate-400 shrink-0" aria-label="Respondido" />}
                          <span className={`truncate text-sm ${unread ? "font-semibold text-slate-800" : "text-slate-500"}`}>
                            {m.subject || "(sin asunto)"}
                          </span>
                          {m.has_attachments && (
                            <Paperclip size={12} className="text-slate-400 shrink-0" aria-label="Con adjuntos" />
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {list && total > 0 && (
            <div className="px-4 sm:px-6 py-3 border-t border-slate-100 flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500">
                {firstShown}–{lastShown} de {total}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={!hasPrev || isListLoading}
                  className="p-2 rounded-xl text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                  aria-label="Más recientes"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasNext || isListLoading}
                  className="p-2 rounded-xl text-slate-600 hover:bg-slate-100 disabled:opacity-30"
                  aria-label="Más antiguos"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mensaje */}
      {openUid !== null && (
        <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={closeMessage}
              disabled={isReplying}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-50 text-slate-600 hover:bg-slate-100 transition-all flex items-center gap-1.5 disabled:opacity-40"
            >
              <ArrowLeft size={14} /> {folder === "inbox" ? "Recibidos" : "Enviados"}
            </button>

            {message?.folder === "inbox" && (
              <button
                type="button"
                onClick={() => void handleToggleSeen()}
                disabled={isMarking || !isOnline}
                className="px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-200 text-slate-700 hover:bg-slate-50 transition-all flex items-center gap-1.5 disabled:opacity-50"
              >
                {isMarking ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : message.seen ? (
                  <Mail size={14} />
                ) : (
                  <MailOpen size={14} />
                )}
                {message.seen ? "Marcar como no leído" : "Marcar como leído"}
              </button>
            )}
          </div>

          {isMessageLoading && (
            <p className="text-sm text-slate-500 flex items-center gap-2">
              <Loader2 size={16} className="animate-spin" /> Abriendo correo…
            </p>
          )}

          {messageError && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 space-y-1">
              <p className="font-bold flex items-center gap-2">
                <AlertTriangle size={16} /> No se ha podido abrir el correo
              </p>
              <p className="whitespace-pre-line">{messageError}</p>
            </div>
          )}

          {message && (
            <>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-slate-800 break-words">{message.subject || "(sin asunto)"}</h3>
                {message.from && (
                  <p className="text-sm text-slate-700 break-all">
                    <span className="font-bold">{message.from.name || message.from.address}</span>
                    {message.from.name && <span className="text-slate-500"> &lt;{message.from.address}&gt;</span>}
                  </p>
                )}
                <p className="text-xs text-slate-500 break-all">
                  Para: {message.to.map(addressFull).join(", ") || "destinatarios ocultos (CCO)"}
                  {message.cc.length > 0 && <> · Cc: {message.cc.map(addressFull).join(", ")}</>}
                </p>
                <p className="text-xs text-slate-400 first-letter:uppercase">{formatFullDate(message.date)}</p>
              </div>

              {message.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {message.attachments.map((att) => (
                    <button
                      key={att.part}
                      type="button"
                      onClick={() => void handleDownload(att)}
                      disabled={!!downloadingPart || !isOnline}
                      className="max-w-full px-3 py-1.5 rounded-xl text-xs font-bold border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 flex items-center gap-1.5 disabled:opacity-60"
                      title={`Descargar ${att.filename}`}
                    >
                      {downloadingPart === att.part ? (
                        <Loader2 size={14} className="animate-spin shrink-0" />
                      ) : (
                        <Paperclip size={14} className="shrink-0" />
                      )}
                      <span className="truncate">{att.filename}</span>
                      <span className="font-normal text-slate-400 shrink-0">{formatFileSize(att.size)}</span>
                    </button>
                  ))}
                </div>
              )}

              {emailDocument && hasRemoteImages(message.html) && !showImages && (
                <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <ImageIcon size={14} className="shrink-0" /> Las imágenes externas están ocultas para que el
                    remitente no sepa que has abierto el correo.
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowImages(true)}
                    className="shrink-0 font-bold text-indigo-600 hover:text-indigo-800"
                  >
                    Mostrar imágenes
                  </button>
                </div>
              )}

              {emailDocument ? (
                <EmailFrame html={emailDocument} />
              ) : (
                <div className="text-sm text-slate-800 whitespace-pre-wrap break-words rounded-xl border border-slate-200 p-4">
                  {message.text?.trim() || "(correo sin texto)"}
                </div>
              )}

              {/* Responder */}
              {message.folder === "inbox" && (
                <div className="pt-4 border-t border-slate-100 space-y-3">
                  {replySentTo && (
                    <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl p-3 flex items-center gap-2">
                      <CheckCircle2 size={18} className="shrink-0" /> Respuesta enviada a {replySentTo}. Queda en
                      Enviados de {accountEmail}.
                    </p>
                  )}

                  {!message.reply_to && (
                    <p className="text-xs text-slate-500">Este correo no tiene una dirección a la que responder.</p>
                  )}

                  {message.reply_to && !isReplyOpen && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsReplyOpen(true);
                        setReplySentTo(null);
                      }}
                      disabled={!isOnline}
                      className="px-4 py-2.5 rounded-xl font-bold text-sm bg-indigo-600 text-white hover:bg-indigo-700 shadow-md flex items-center gap-2 disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none"
                    >
                      <Reply size={16} /> Responder
                    </button>
                  )}

                  {message.reply_to && isReplyOpen && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        <div className="p-3 rounded-xl bg-slate-50 min-w-0">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Desde</p>
                          <p className="font-bold text-slate-800 truncate">{accountEmail}</p>
                        </div>
                        <div className="p-3 rounded-xl bg-slate-50 min-w-0">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Para</p>
                          <p className="font-bold text-slate-800 truncate" title={addressFull(message.reply_to)}>
                            {addressFull(message.reply_to)}
                          </p>
                        </div>
                      </div>

                      <textarea
                        className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm min-h-[180px] resize-y"
                        value={replyBody}
                        maxLength={MAX_BODY_LENGTH}
                        onChange={(e) => setReplyBody(e.target.value)}
                        placeholder="Escribe tu respuesta…"
                        autoFocus
                      />
                      <AttachmentPicker files={replyFiles} onChange={setReplyFiles} disabled={isReplying} />
                      <p className="text-xs text-slate-500 flex items-start gap-2">
                        <ShieldCheck size={14} className="text-indigo-600 shrink-0 mt-0.5" />
                        Se añade la firma de protección de datos y, debajo, el correo original citado. Gmail la
                        guarda en la misma conversación.
                      </p>

                      {replyError && (
                        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 whitespace-pre-line">
                          {replyError}
                        </p>
                      )}

                      <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            setIsReplyOpen(false);
                            setReplyError(null);
                          }}
                          disabled={isReplying}
                          className="px-4 py-2.5 rounded-xl font-bold text-sm bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleReply()}
                          disabled={isReplying || !replyBody.trim() || !isOnline}
                          className={`px-4 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 ${
                            !isReplying && replyBody.trim() && isOnline
                              ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-md"
                              : "bg-slate-200 text-slate-500 cursor-not-allowed"
                          }`}
                        >
                          {isReplying ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                          Enviar respuesta
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Correo nuevo */}
      {isComposing && (
        <div className="bg-white p-4 sm:p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <SquarePen size={18} className="text-indigo-600" /> Nuevo correo
            </h3>
            <button
              type="button"
              onClick={discardCompose}
              disabled={isSending}
              className="p-2 rounded-xl hover:bg-slate-100 disabled:opacity-40"
              aria-label="Descartar"
            >
              <X size={20} />
            </button>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 min-w-0 text-sm">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Desde</p>
            <p className="font-bold text-slate-800 truncate">{accountEmail}</p>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Para</label>
            <input
              type="text"
              inputMode="email"
              autoComplete="off"
              className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
              value={composeTo}
              onChange={(e) => setComposeTo(e.target.value)}
              ref={composeToRef}
              onFocus={() => setIsToFocused(true)}
              onBlur={() => setIsToFocused(false)}
              placeholder="familia@ejemplo.com, otra@ejemplo.com"
              // Si el Para ya viene relleno (borrador de otra pantalla), se empieza por el mensaje.
              autoFocus={!initialDraft}
            />
            {shownInvalid.length > 0 ? (
              <p className="text-xs text-amber-700 mt-1 ml-1 break-all">
                No parece una dirección válida: {shownInvalid.join(", ")}
              </p>
            ) : recipients.valid.length > MAX_RECIPIENTS ? (
              <p className="text-xs text-amber-700 mt-1 ml-1">
                Como mucho {MAX_RECIPIENTS} direcciones. Para escribir a grupos enteros usa "Contactar familias".
              </p>
            ) : (
              recipients.valid.length > 1 && (
                <div className="mt-2 ml-1 space-y-1">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer w-fit">
                    <input
                      type="checkbox"
                      checked={hideRecipients}
                      onChange={(e) => setHideRecipients(e.target.checked)}
                      className="w-4 h-4 accent-indigo-600"
                    />
                    Enviar en copia oculta (CCO)
                  </label>
                  <p className={`text-xs ${hideRecipients ? "text-slate-500" : "text-amber-700"}`}>
                    {hideRecipients
                      ? `Las ${recipients.valid.length} direcciones van ocultas: nadie ve las de los demás.`
                      : `Las ${recipients.valid.length} direcciones irán en Para y todos verán las de los demás.`}
                  </p>
                </div>
              )
            )}
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Asunto</label>
            <input
              className="w-full px-4 py-2 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm"
              value={composeSubject}
              maxLength={MAX_SUBJECT_LENGTH}
              onChange={(e) => setComposeSubject(e.target.value)}
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">Mensaje</label>
            <textarea
              className="w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm min-h-[220px] resize-y"
              value={composeBody}
              maxLength={MAX_BODY_LENGTH}
              onChange={(e) => setComposeBody(e.target.value)}
              autoFocus={!!initialDraft}
            />
          </div>

          <AttachmentPicker files={composeFiles} onChange={setComposeFiles} disabled={isSending} />

          <p className="text-xs text-slate-500 flex items-start gap-2">
            <ShieldCheck size={14} className="text-indigo-600 shrink-0 mt-0.5" />
            Al final del correo se añade automáticamente la firma de protección de datos con el logo del Grupo Joven.
          </p>

          {composeError && (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 whitespace-pre-line">
              {composeError}
            </p>
          )}

          <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
            <button
              type="button"
              onClick={discardCompose}
              disabled={isSending}
              className="px-4 py-2.5 rounded-xl font-bold text-sm bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50"
            >
              Descartar
            </button>
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!canSend}
              className={`px-4 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 ${
                canSend
                  ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-md"
                  : "bg-slate-200 text-slate-500 cursor-not-allowed"
              }`}
            >
              {isSending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              {recipients.valid.length > 1 ? `Enviar a ${recipients.valid.length}` : "Enviar"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FamilyInbox;
