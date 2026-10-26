// supabase/functions/family-inbox/index.ts
//
// "Correo": cada coordinador lee y responde el buzón de Gmail de su cuenta, la
// misma desde la que envía "Contactar familias" (ver _shared/family-mail-accounts.ts).
// En Supercoordinación, el coordinador general puede pedir además el buzón de
// una etapa con mailbox: "preconfirmation" | "confirmation" en cualquier acción.
//
// - action "list": una página de Recibidos o Enviados, con búsqueda opcional
//   (admite lo mismo que el buscador de Gmail: palabras, from:, has:attachment...)
//   y, en Recibidos, el filtro unread: true para ver solo los no leídos y
//   category ("primary", "social", "promotions", "updates") para una pestaña.
// - action "get": un mensaje con su texto, sus imágenes incrustadas y la lista
//   de adjuntos.
// - action "attachment": descarga un adjunto (respuesta binaria).
// - action "mark": marca un correo como leído o no leído (seen: true/false).
//   Abrirlo no lo marca: solo cambia cuando el coordinador lo pide.
// - action "reply": responde a un mensaje de Recibidos desde la misma cuenta,
//   solo a su remitente y con la firma de protección de datos.
// - action "send": correo nuevo desde la misma cuenta, con la firma. Con varias
//   direcciones va por defecto en copia oculta (CCO), salvo hide_recipients: false.
//
// "reply" y "send" admiten adjuntos: llegan como multipart/form-data, con los
// parámetros en el campo "payload" (JSON, con los nombres de los archivos en
// attachment_names) y los archivos en "attachments".
//
// La lectura por IMAP está en mailbox.ts y el envío en
// _shared/family-mail-outbox.ts (compartido con "Contactar familias"); aquí,
// quién llama, qué buzón le toca y qué se pide.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ImapFlow } from "npm:imapflow@2.2.5";
import { FAMILY_MAIL_ACCOUNTS, type Stage } from "../_shared/family-mail-accounts.ts";
import {
  type Folder,
  InboxError,
  closeImap,
  downloadAttachment,
  getMessage,
  isCategory,
  listMessages,
  openImap,
  prepareReply,
  setSeen,
} from "./mailbox.ts";
import { readAttachments, readMailRequest, sendFamilyMail } from "../_shared/family-mail-outbox.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAX_QUERY_LENGTH = 200;
const MAX_BODY_LENGTH = 20000;
const MAX_SUBJECT_LENGTH = 200;
// Para escribir a grupos enteros está "Contactar familias".
const MAX_RECIPIENTS = 20;

const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/;

/** Direcciones separadas por comas, punto y coma o espacios, sin repetir. */
function parseRecipients(raw: unknown): { valid: string[]; invalid: string[] } {
  const parts = (Array.isArray(raw) ? raw.join(",") : String(raw ?? ""))
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const unique = Array.from(new Set(parts));
  return {
    valid: unique.filter((e) => EMAIL_RE.test(e)),
    invalid: unique.filter((e) => !EMAIL_RE.test(e)),
  };
}

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, Authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  let client: ImapFlow | null = null;

  try {
    const authHeader =
      req.headers.get("authorization") ??
      req.headers.get("Authorization") ??
      "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return jsonResponse({ ok: false, error: "invalid_or_missing_jwt" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1) Quién llama (misma regla que send-family-email)
    const { data: authData, error: authErr } = await admin.auth.getUser(token);
    const callerId = authData?.user?.id;
    if (authErr || !callerId) return jsonResponse({ ok: false, error: "invalid_or_missing_jwt" }, 401);

    const { data: profile, error: pErr } = await admin
      .from("profiles")
      .select("role, stage")
      .eq("id", callerId)
      .single();

    if (pErr || !profile) {
      return jsonResponse({ ok: false, error: "profile_not_found", details: pErr?.message ?? null }, 403);
    }
    if (profile.role !== "coordinator") return jsonResponse({ ok: false, error: "forbidden" }, 403);

    const callerStage: Stage | null =
      profile.stage === "preconfirmation" || profile.stage === "confirmation" ? profile.stage : null;
    if (profile.stage && !callerStage) {
      return jsonResponse({ ok: false, error: "unknown_stage", stage: profile.stage }, 403);
    }

    // 2) Parámetros
    const { params, files } = await readMailRequest(req);

    // Qué buzón: el suyo o, si es el coordinador general, el de la etapa que pida.
    // Un coordinador de etapa no puede abrir el de la otra.
    const mailbox = params?.mailbox ?? null;
    if (mailbox !== null && mailbox !== "preconfirmation" && mailbox !== "confirmation") {
      return jsonResponse({ ok: false, error: "invalid_mailbox" }, 400);
    }
    if (mailbox && callerStage && mailbox !== callerStage) {
      return jsonResponse({ ok: false, error: "mailbox_not_allowed" }, 403);
    }
    const account = FAMILY_MAIL_ACCOUNTS[(mailbox as Stage | null) ?? callerStage ?? "global"];

    const action = params?.action;
    if (!["list", "get", "attachment", "mark", "reply", "send"].includes(action)) {
      return jsonResponse({ ok: false, error: "invalid_action" }, 400);
    }

    const body = String(params.body ?? "").trim();
    if (action === "send" || action === "reply") {
      if (!body) return jsonResponse({ ok: false, error: "missing_body" }, 400);
      if (body.length > MAX_BODY_LENGTH) return jsonResponse({ ok: false, error: "body_too_long" }, 400);
    }
    const attachments =
      action === "send" || action === "reply" ? await readAttachments(files, params.attachment_names) : [];

    if (action === "send") {
      const { valid, invalid } = parseRecipients(params.to);
      if (invalid.length) return jsonResponse({ ok: false, error: "invalid_recipients", invalid }, 400);
      if (!valid.length) return jsonResponse({ ok: false, error: "no_recipients" }, 400);
      if (valid.length > MAX_RECIPIENTS) {
        return jsonResponse({ ok: false, error: "too_many_recipients", max: MAX_RECIPIENTS }, 400);
      }

      const subject = String(params.subject ?? "").replace(/[\r\n]+/g, " ").trim();
      if (!subject) return jsonResponse({ ok: false, error: "missing_subject" }, 400);
      if (subject.length > MAX_SUBJECT_LENGTH) return jsonResponse({ ok: false, error: "subject_too_long" }, 400);

      // Con varias direcciones, CCO salvo que se pida lo contrario.
      const hidden = valid.length > 1 && params.hide_recipients !== false;
      const result = await sendFamilyMail(
        account,
        { ...(hidden ? { bcc: valid } : { to: valid }), subject, attachments },
        body
      );
      return jsonResponse({ ok: true, from: account.email, subject, hidden, ...result });
    }

    const folder: Folder = params.folder === "sent" ? "sent" : "inbox";
    const uid = Number(params.uid);
    if (action !== "list" && !(Number.isInteger(uid) && uid > 0)) {
      return jsonResponse({ ok: false, error: "invalid_uid" }, 400);
    }

    if (action === "reply") {
      client = await openImap(account);
      const draft = await prepareReply(client, account, uid);
      // IMAP ya no hace falta: se cierra antes de abrir la conexión SMTP.
      await closeImap(client);

      await sendFamilyMail(account, { ...draft, to: [draft.to], attachments }, body);
      return jsonResponse({ ok: true, from: account.email, to: draft.to, subject: draft.subject });
    }

    client = await openImap(account);

    if (action === "list") {
      const page = Number.isInteger(params.page) && params.page >= 0 ? params.page : 0;
      const query = String(params.query ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
      // "Solo no leídos" y las pestañas tienen sentido en Recibidos; en Enviados
      // se ignoran. Al buscar se busca en todas las pestañas, como en Gmail.
      const unread = params.unread === true && folder === "inbox";
      const category = folder === "inbox" && !query && isCategory(params.category) ? params.category : null;
      const result = await listMessages(client, folder, page, query, unread, category);
      return jsonResponse({ ok: true, account: account.email, folder, query, unread, category, ...result });
    }

    if (action === "get") {
      const message = await getMessage(client, account, folder, uid);
      return jsonResponse({ ok: true, account: account.email, message });
    }

    if (action === "mark") {
      if (typeof params.seen !== "boolean") return jsonResponse({ ok: false, error: "invalid_seen" }, 400);
      const result = await setSeen(client, folder, uid, params.seen);
      return jsonResponse({ ok: true, uid, ...result });
    }

    // action === "attachment"
    const part = String(params.part ?? "");
    if (!/^\d+(\.\d+)*$/.test(part)) return jsonResponse({ ok: false, error: "invalid_part" }, 400);
    const content = await downloadAttachment(client, folder, uid, part);
    return new Response(new Uint8Array(content), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/octet-stream" },
    });
  } catch (e) {
    if (e instanceof InboxError) {
      return jsonResponse({ ok: false, error: e.code, ...e.extra }, e.status);
    }
    console.log("Unhandled error:", e);
    return jsonResponse({ ok: false, error: String(e) }, 500);
  } finally {
    if (client) await closeImap(client);
  }
});
