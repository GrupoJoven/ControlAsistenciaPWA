// supabase/functions/family-inbox/index.ts
//
// "Correo": cada coordinador lee y responde el buzón de Gmail de su cuenta, la
// misma desde la que envía "Contactar familias" (ver _shared/family-mail-accounts.ts).
//
// - action "list": una página de Recibidos o Enviados, con búsqueda opcional
//   (admite lo mismo que el buscador de Gmail: palabras, from:, has:attachment...).
// - action "get": un mensaje con su texto, sus imágenes incrustadas y la lista
//   de adjuntos.
// - action "attachment": descarga un adjunto (respuesta binaria).
// - action "reply": responde a un mensaje de Recibidos desde la misma cuenta,
//   solo a su remitente y con la firma de protección de datos.
// - action "send": correo nuevo desde la misma cuenta, con la firma. Si hay
//   varias direcciones, cada una recibe su propio correo (nadie ve las demás).
//
// La lectura (IMAP, en solo lectura) está en mailbox.ts; aquí, quién llama, qué
// buzón le toca y el envío de las respuestas.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer/mod.ts";
import type { ImapFlow } from "npm:imapflow@2.2.5";
import { buildFamilyEmailHtml, buildFamilyEmailText } from "../_shared/family-email-signature.ts";
import {
  FAMILY_MAIL_ACCOUNTS,
  type FamilyMailAccount,
  type Stage,
  getAppPassword,
} from "../_shared/family-mail-accounts.ts";
import {
  type Folder,
  InboxError,
  type ReplyDraft,
  closeImap,
  downloadAttachment,
  getMessage,
  listMessages,
  openImap,
  prepareReply,
} from "./mailbox.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Mismo logo que "Contactar familias"; si no está subido, la respuesta sale sin imagen.
const LOGO_URL = `${SUPABASE_URL}/storage/v1/object/public/email-assets/logo-grupo-joven.png`;

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

async function logoIsAvailable(): Promise<boolean> {
  try {
    const res = await fetch(LOGO_URL, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

/** Un correo que sale de la cuenta: una respuesta (ReplyDraft) o uno nuevo. */
type OutgoingMail = Pick<ReplyDraft, "to" | "subject"> & Partial<Omit<ReplyDraft, "to" | "subject">>;

/**
 * Envía por SMTP desde la cuenta, un correo por destinatario y todos con el
 * mismo texto y la firma. Gmail los guarda en Enviados. Si no sale ninguno, es
 * casi seguro la cuenta (contraseña, límite diario) y se devuelve como error.
 */
async function sendMails(account: FamilyMailAccount, mails: OutgoingMail[], body: string) {
  const password = getAppPassword(account);
  if (!password) {
    throw new InboxError("password_not_configured", 500, { secret: account.passwordSecret, from: account.email });
  }

  const logoUrl = (await logoIsAvailable()) ? LOGO_URL : null;

  const smtp = new SMTPClient({
    connection: {
      hostname: Deno.env.get("SMTP_HOST") ?? "smtp.gmail.com",
      port: Number(Deno.env.get("SMTP_PORT") ?? "465"),
      tls: true,
      auth: { username: account.email, password },
    },
  });

  const sent: string[] = [];
  const failed: string[] = [];
  let lastError = "";

  try {
    for (const mail of mails) {
      try {
        await smtp.send({
          from: `${account.name} <${account.email}>`,
          to: mail.to,
          subject: mail.subject,
          content: buildFamilyEmailText(body, mail.quote),
          html: buildFamilyEmailHtml(body, logoUrl, mail.quote),
          // Va en headers y no en la opción inReplyTo de denomailer, que escribe
          // "InReplyTo:" (sin guiones) y los clientes de correo la ignoran.
          ...(mail.inReplyTo ? { headers: { "In-Reply-To": mail.inReplyTo } } : {}),
          ...(mail.references ? { references: mail.references } : {}),
        });
        sent.push(mail.to);
      } catch (e) {
        lastError = String(e);
        console.log("SMTP send error", lastError);
        failed.push(mail.to);
      }
    }
  } finally {
    // Si la conexión nunca llegó a abrirse, close() también falla: no debe
    // tapar el resultado del envío.
    try {
      await smtp.close();
    } catch {
      // nada
    }
  }

  if (mails.length > 0 && sent.length === 0) {
    throw new InboxError("smtp_send_failed", 502, { from: account.email, details: lastError });
  }
  return { sent, failed };
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

    // 1) Quién llama y qué buzón le toca (misma regla que send-family-email)
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
    const account = FAMILY_MAIL_ACCOUNTS[callerStage ?? "global"];

    // 2) Parámetros
    const params = await req.json().catch(() => ({} as any));
    const action = params?.action;
    if (!["list", "get", "attachment", "reply", "send"].includes(action)) {
      return jsonResponse({ ok: false, error: "invalid_action" }, 400);
    }

    const body = String(params.body ?? "").trim();
    if (action === "send" || action === "reply") {
      if (!body) return jsonResponse({ ok: false, error: "missing_body" }, 400);
      if (body.length > MAX_BODY_LENGTH) return jsonResponse({ ok: false, error: "body_too_long" }, 400);
    }

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

      const result = await sendMails(account, valid.map((to) => ({ to, subject })), body);
      return jsonResponse({ ok: true, from: account.email, subject, ...result });
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

      await sendMails(account, [draft], body);
      return jsonResponse({ ok: true, from: account.email, to: draft.to, subject: draft.subject });
    }

    client = await openImap(account);

    if (action === "list") {
      const page = Number.isInteger(params.page) && params.page >= 0 ? params.page : 0;
      const query = String(params.query ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
      const result = await listMessages(client, folder, page, query);
      return jsonResponse({ ok: true, account: account.email, folder, query, ...result });
    }

    if (action === "get") {
      const message = await getMessage(client, account, folder, uid);
      return jsonResponse({ ok: true, account: account.email, message });
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
