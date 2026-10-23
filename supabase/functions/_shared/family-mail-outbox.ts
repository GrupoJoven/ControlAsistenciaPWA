// supabase/functions/_shared/family-mail-outbox.ts
//
// Envío por SMTP con nodemailer de "Correo" (respuestas y correos nuevos) y de
// "Contactar familias", desde la cuenta del coordinador y siempre con la firma
// de protección de datos.
//
// Se usa nodemailer y no denomailer porque con adjuntos denomailer no sirve:
// escribe sin codificar el nombre de los archivos (se rompe con tildes o
// espacios), separa los destinatarios con ";" en vez de "," y manda los
// adjuntos en miles de escrituras de 75 caracteres, que gastan más CPU de la
// que permiten las edge functions (2 s por petición).
import nodemailer from "npm:nodemailer@10.0.14";
import tls from "node:tls";
import { Buffer } from "node:buffer";
import { buildFamilyEmailHtml, buildFamilyEmailText, type QuotedMessage } from "./family-email-signature.ts";
import { type FamilyMailAccount, getAppPassword } from "./family-mail-accounts.ts";
import { FamilyMailError } from "./family-mail-error.ts";

// Logo de la firma: bucket público de Storage (ver docs/contactar-familias.md).
// Si todavía no se ha subido, el correo sale igual pero sin imagen.
const LOGO_URL = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/email-assets/logo-grupo-joven.png`;

export const MAX_ATTACHMENTS = 10;
// Gmail admite unos 25 MB por correo contando la codificación de los adjuntos;
// con 20 MB de archivos queda margen, y codificarlos cabe en la CPU de la función.
export const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024;

export type OutgoingAttachment = { filename: string; content: Buffer; contentType?: string };

export type OutgoingMail = {
  /** Destinatarios visibles (Para). */
  to?: string[];
  /** Destinatarios ocultos (CCO): nadie ve a los demás. */
  bcc?: string[];
  subject: string;
  inReplyTo?: string;
  references?: string;
  quote?: QuotedMessage;
  attachments?: OutgoingAttachment[];
};

/**
 * Archivos subidos desde la app, comprobados y listos para nodemailer. Los
 * nombres llegan aparte (names, en el mismo orden): el parser de multipart de
 * Deno corta el nombre en el primer ";" ("foto; grupo.png" llega como '"foto').
 */
export async function readAttachments(files: File[], names: unknown): Promise<OutgoingAttachment[]> {
  if (files.length > MAX_ATTACHMENTS) {
    throw new FamilyMailError("too_many_attachments", 400, { max: MAX_ATTACHMENTS });
  }
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_ATTACHMENTS_BYTES) {
    throw new FamilyMailError("attachments_too_large", 413, { max_mb: MAX_ATTACHMENTS_BYTES / (1024 * 1024) });
  }

  const nameList = Array.isArray(names) ? names : [];

  return await Promise.all(
    files.map(async (f, i) => ({
      // El nombre acaba en una cabecera del correo: nada de caracteres de control.
      filename:
        String(typeof nameList[i] === "string" && nameList[i] ? nameList[i] : f.name)
          .replace(/[\u0000-\u001f\u007f]+/g, " ")
          .trim()
          .slice(0, 150) || "adjunto",
      content: Buffer.from(await f.arrayBuffer()),
      contentType: f.type || undefined,
    }))
  );
}

/**
 * Parámetros y archivos de la petición: JSON normal, o multipart/form-data
 * cuando hay adjuntos (parámetros en el campo "payload", archivos en
 * "attachments" y sus nombres en payload.attachment_names).
 */
export async function readMailRequest(req: Request): Promise<{ params: any; files: File[] }> {
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    let params: any = {};
    try {
      params = JSON.parse(String(form.get("payload") ?? "{}"));
    } catch {
      // payload mal formado: se queda sin acción y la función lo rechaza
    }
    const files = form.getAll("attachments").filter((f): f is File => f instanceof File);
    return { params, files };
  }
  return { params: await req.json().catch(() => ({})), files: [] };
}

/** URL del logo de la firma, o null si todavía no está subido. */
export async function getLogoUrl(): Promise<string | null> {
  try {
    const res = await fetch(LOGO_URL, { method: "HEAD" });
    return res.ok ? LOGO_URL : null;
  } catch {
    return null;
  }
}

function createTransport(account: FamilyMailAccount, password: string) {
  const host = Deno.env.get("SMTP_HOST") ?? "smtp.gmail.com";
  const port = Number(Deno.env.get("SMTP_PORT") ?? "465");

  return nodemailer.createTransport({
    host,
    port,
    secure: true,
    name: account.email.split("@")[1],
    auth: { user: account.email, pass: password },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
    // La conexión TLS se abre aquí con node:tls, igual que la de IMAP
    // (imapflow), en lugar de dejar que nodemailer resuelva el DNS por su cuenta.
    getSocket: (_options, callback) => {
      const socket = tls.connect({ host, port, servername: host });
      const onError = (e: Error) => callback(e);
      socket.once("error", onError);
      socket.once("secureConnect", () => {
        socket.removeListener("error", onError);
        callback(null, { connection: socket, secured: true });
      });
    },
  });
}

/**
 * Envía un único correo desde la cuenta. Gmail lo guarda en Enviados; los
 * destinatarios en CCO no aparecen en esa copia (la cabecera Bcc no se envía
 * nunca, para que no pueda llegar a nadie).
 */
export async function sendFamilyMail(account: FamilyMailAccount, mail: OutgoingMail, body: string) {
  const password = getAppPassword(account);
  if (!password) {
    throw new FamilyMailError("password_not_configured", 500, { secret: account.passwordSecret, from: account.email });
  }

  const logoUrl = await getLogoUrl();
  const transport = createTransport(account, password);

  try {
    const info = await transport.sendMail({
      from: { name: account.name, address: account.email },
      // Solo en CCO, el Para queda como "destinatarios no revelados".
      to: mail.to?.length ? mail.to : "undisclosed-recipients:;",
      bcc: mail.bcc,
      subject: mail.subject,
      text: buildFamilyEmailText(body, mail.quote),
      html: buildFamilyEmailHtml(body, logoUrl, mail.quote),
      inReplyTo: mail.inReplyTo || undefined,
      references: mail.references || undefined,
      attachments: mail.attachments,
    });

    const addresses = (list: unknown[]) =>
      list.map((a) => (typeof a === "string" ? a : (a as { address?: string }).address ?? "")).filter(Boolean);
    return { sent: addresses(info.accepted), failed: addresses(info.rejected) };
  } catch (e: any) {
    const details = String(e?.response ?? e?.message ?? e);
    console.log("SMTP send error", details);
    throw new FamilyMailError("smtp_send_failed", 502, { from: account.email, details });
  } finally {
    transport.close();
  }
}
