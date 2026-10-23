// supabase/functions/family-inbox/mailbox.ts
//
// Lectura del buzón por IMAP para "Correo". Todo se hace con la carpeta abierta
// en solo lectura (EXAMINE): nada se borra ni se mueve, y abrir un correo aquí
// no lo marca como leído en Gmail. La única excepción es setSeen(), que marca un
// correo como leído o no leído cuando el coordinador lo pide.
import { Buffer } from "node:buffer";
import { ImapFlow } from "npm:imapflow@2.2.5";
import type {
  FetchMessageObject,
  FetchQueryObject,
  MessageAddressObject,
  MessageStructureObject,
} from "npm:imapflow@2.2.5";
import type { QuotedMessage } from "../_shared/family-email-signature.ts";
import { type FamilyMailAccount, getAppPassword } from "../_shared/family-mail-accounts.ts";
import { FamilyMailError as InboxError } from "../_shared/family-mail-error.ts";

export const PAGE_SIZE = 25;
const MAX_SUBJECT_LENGTH = 200;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
// Las imágenes incrustadas (cid:) viajan dentro del HTML; por encima de esto se
// dejan como adjuntos para no inflar la respuesta.
const MAX_INLINE_IMAGES_BYTES = 5 * 1024 * 1024;
// Tamaño codificado (base64) del adjunto más grande de Gmail, 25 MB.
const MAX_ATTACHMENT_BYTES = 35 * 1024 * 1024;
const MAX_QUOTE_LENGTH = 10000;

export type Folder = "inbox" | "sent";

/** Error con su código para el frontend; es el mismo que lanza el envío compartido. */
export { InboxError };

const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/;

type Address = { name: string; address: string };

const toAddress = (a: MessageAddressObject | undefined): Address | null =>
  a?.address ? { name: a.name ?? "", address: a.address.toLowerCase() } : null;

const toAddressList = (list: MessageAddressObject[] | undefined): Address[] =>
  (list ?? []).map(toAddress).filter((a): a is Address => a !== null);

const toIsoDate = (d: Date | string | undefined): string | null => {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

// ---------------------------------------------------------------------------
// Estructura MIME
// ---------------------------------------------------------------------------

type Leaf = MessageStructureObject & { part: string };

/**
 * Partes finales del mensaje. Un mensaje reenviado como adjunto
 * (message/rfc822) cuenta como una sola parte. En un mensaje de una sola parte
 * el cuerpo es la parte "1".
 */
function leaves(node: MessageStructureObject): Leaf[] {
  if (node.childNodes?.length && node.type !== "message/rfc822") {
    return node.childNodes.flatMap(leaves);
  }
  return [{ ...node, part: node.part ?? "1" }];
}

const fileNameOf = (n: MessageStructureObject): string | null =>
  n.dispositionParameters?.filename ?? n.parameters?.name ?? null;

const contentIdOf = (n: MessageStructureObject): string =>
  (n.id ?? "").trim().replace(/^<|>$/g, "");

const isInlineImage = (n: MessageStructureObject) =>
  n.type.startsWith("image/") && !!contentIdOf(n) && n.disposition !== "attachment";

const isBodyText = (n: MessageStructureObject, type: "text/html" | "text/plain") =>
  n.type === type && n.disposition !== "attachment";

/** Para la lista: hay algo que se vería como adjunto. */
const hasAttachments = (structure: MessageStructureObject | undefined) =>
  !!structure &&
  leaves(structure).some(
    (n) => n.disposition === "attachment" || (!!fileNameOf(n) && !isInlineImage(n) && !n.type.startsWith("text/"))
  );

/** Tamaño aproximado ya decodificado (BODYSTRUCTURE da el tamaño en base64). */
const decodedSize = (n: MessageStructureObject) =>
  n.encoding === "base64" ? Math.round((n.size ?? 0) * 0.74) : n.size ?? 0;

/** Texto aproximado de un HTML, para citarlo en una respuesta. */
const htmlToText = (html: string) =>
  html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------
// Conexión
// ---------------------------------------------------------------------------

export async function openImap(account: FamilyMailAccount): Promise<ImapFlow> {
  const pass = getAppPassword(account);
  if (!pass) {
    throw new InboxError("password_not_configured", 500, { secret: account.passwordSecret, from: account.email });
  }

  const client = new ImapFlow({
    host: Deno.env.get("IMAP_HOST") ?? "imap.gmail.com",
    port: Number(Deno.env.get("IMAP_PORT") ?? "993"),
    secure: true,
    auth: { user: account.email, pass },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
  });
  // Sin este listener, un error de socket posterior (p. ej. un timeout) sería
  // una excepción no capturada que tumba la función.
  client.on("error", (e: unknown) => console.log("IMAP error event", String(e)));

  try {
    await client.connect();
  } catch (e: any) {
    client.close();
    const details = String(e?.responseText ?? e?.message ?? e);
    console.log("IMAP connect error", details);
    if (/not enabled for IMAP/i.test(details)) {
      throw new InboxError("imap_disabled", 502, { from: account.email, details });
    }
    if (e?.authenticationFailed) {
      throw new InboxError("imap_auth_failed", 502, { from: account.email, details });
    }
    throw new InboxError("imap_failed", 502, { from: account.email, details });
  }

  return client;
}

/** Se puede llamar más de una vez: si ya está cerrada, no hace nada. */
export async function closeImap(client: ImapFlow) {
  if (!client.usable) {
    client.close();
    return;
  }
  try {
    await client.logout();
  } catch {
    client.close();
  }
}

async function folderPath(client: ImapFlow, folder: Folder): Promise<string> {
  if (folder === "inbox") return "INBOX";

  // El nombre de Enviados depende del idioma de la cuenta ("[Gmail]/Enviados",
  // "[Gmail]/Sent Mail"...): se busca por su marca especial.
  const boxes = await client.list();
  const sent = boxes.find((b) => b.specialUse === "\\Sent");
  if (!sent) throw new InboxError("sent_folder_not_found", 502);
  return sent.path;
}

/**
 * Abre la carpeta, ejecuta fn y la suelta. Por defecto en solo lectura
 * (EXAMINE); con readOnly: false (SELECT), solo para setSeen().
 */
async function withFolder<T>(
  client: ImapFlow,
  folder: Folder,
  fn: () => Promise<T>,
  { readOnly = true }: { readOnly?: boolean } = {}
): Promise<T> {
  const path = await folderPath(client, folder);
  const lock = await client.getMailboxLock(path, { readOnly });
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

async function readStream(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** Texto de una parte, ya decodificado y en UTF-8. */
async function downloadText(client: ImapFlow, uid: number, part: string): Promise<string> {
  const { content } = await client.download(String(uid), part, { uid: true, maxBytes: MAX_TEXT_BYTES });
  if (!content) return "";
  return (await readStream(content)).toString("utf8");
}

const LIST_QUERY: FetchQueryObject = {
  uid: true,
  flags: true,
  envelope: true,
  internalDate: true,
  bodyStructure: true,
};

const summarize = (m: FetchMessageObject) => ({
  uid: m.uid,
  subject: m.envelope?.subject ?? "",
  from: toAddress(m.envelope?.from?.[0]),
  to: toAddressList(m.envelope?.to),
  // Fecha de llegada al buzón, como la muestra Gmail.
  date: toIsoDate(m.internalDate) ?? toIsoDate(m.envelope?.date),
  seen: m.flags?.has("\\Seen") ?? false,
  answered: m.flags?.has("\\Answered") ?? false,
  has_attachments: hasAttachments(m.bodyStructure),
});

async function fetchMessage(client: ImapFlow, uid: number): Promise<FetchMessageObject> {
  const msg = await client.fetchOne(
    String(uid),
    { ...LIST_QUERY, headers: ["references"] },
    { uid: true }
  );
  if (!msg) throw new InboxError("message_not_found", 404);
  return msg;
}

/** A quién va una respuesta: Reply-To si lo hay; si no, el remitente. */
function replyRecipient(msg: FetchMessageObject, account: FamilyMailAccount): Address | null {
  const candidate = toAddress(msg.envelope?.replyTo?.[0]) ?? toAddress(msg.envelope?.from?.[0]);
  if (!candidate || !EMAIL_RE.test(candidate.address)) return null;
  if (candidate.address === account.email) return null;
  return candidate;
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

export async function listMessages(client: ImapFlow, folder: Folder, page: number, query: string) {
  // El contador de no leídos se pide antes de abrir la carpeta.
  const status = folder === "inbox" ? await client.status("INBOX", { unseen: true }) : false;

  return await withFolder(client, folder, async () => {
    let total = 0;
    let messages: FetchMessageObject[] = [];

    if (query) {
      const uids = ((await client.search({ gmraw: query }, { uid: true })) || []) as number[];
      uids.sort((a, b) => b - a);
      total = uids.length;
      const pageUids = uids.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      if (pageUids.length) messages = await client.fetchAll(pageUids, LIST_QUERY, { uid: true });
    } else {
      // Sin búsqueda, los números de secuencia ya van por orden de llegada:
      // la página 0 son los PAGE_SIZE últimos.
      total = client.mailbox ? client.mailbox.exists : 0;
      const end = total - page * PAGE_SIZE;
      const start = Math.max(1, end - PAGE_SIZE + 1);
      if (end >= 1) messages = await client.fetchAll(`${start}:${end}`, LIST_QUERY);
    }

    messages.sort((a, b) => b.uid - a.uid);

    return {
      total,
      page,
      page_size: PAGE_SIZE,
      unseen: status ? status.unseen ?? null : null,
      messages: messages.map(summarize),
    };
  });
}

export async function getMessage(client: ImapFlow, account: FamilyMailAccount, folder: Folder, uid: number) {
  return await withFolder(client, folder, async () => {
    const msg = await fetchMessage(client, uid);
    const parts = msg.bodyStructure ? leaves(msg.bodyStructure) : [];

    const htmlPart = parts.find((n) => isBodyText(n, "text/html"));
    const textPart = parts.find((n) => isBodyText(n, "text/plain"));

    let html = htmlPart ? await downloadText(client, uid, htmlPart.part) : null;
    const text = !html && textPart ? await downloadText(client, uid, textPart.part) : null;

    // Imágenes incrustadas que usa el HTML: se meten como data: para que el
    // navegador no tenga que pedir nada a ningún servidor.
    const inlined = new Set<string>();
    if (html) {
      const lowerHtml = html.toLowerCase();
      const wanted: Leaf[] = [];
      let budget = MAX_INLINE_IMAGES_BYTES;
      for (const n of parts) {
        if (!isInlineImage(n)) continue;
        if (!lowerHtml.includes(`cid:${contentIdOf(n).toLowerCase()}`)) continue;
        if ((n.size ?? 0) > budget) continue;
        budget -= n.size ?? 0;
        wanted.push(n);
      }

      if (wanted.length) {
        const downloaded = await client.downloadMany(String(uid), wanted.map((n) => n.part), { uid: true });
        for (const n of wanted) {
          const content = downloaded[n.part]?.content;
          if (!content) continue;
          const dataUrl = `data:${n.type};base64,${Buffer.from(content).toString("base64")}`;
          html = html.replace(new RegExp(`cid:${escapeRegExp(contentIdOf(n))}`, "gi"), dataUrl);
          inlined.add(n.part);
        }
      }
    }

    const attachments = parts
      .filter((n) => n !== htmlPart && n !== textPart && !inlined.has(n.part))
      // Una parte de texto sin nombre es una versión alternativa del cuerpo, no un adjunto.
      .filter((n) => !(n.type.startsWith("text/") && !fileNameOf(n) && n.disposition !== "attachment"))
      .map((n) => ({
        part: n.part,
        filename: fileNameOf(n) ?? (n.type === "message/rfc822" ? "mensaje.eml" : "adjunto"),
        mime_type: n.type,
        size: decodedSize(n),
      }));

    const recipient = folder === "inbox" ? replyRecipient(msg, account) : null;

    return {
      ...summarize(msg),
      folder,
      cc: toAddressList(msg.envelope?.cc),
      html,
      text,
      attachments,
      reply_to: recipient,
    };
  });
}

/**
 * Marca un correo como leído o no leído en Gmail. Es lo único de "Correo" que
 * cambia algo en el buzón, y solo cuando el coordinador pulsa el botón.
 * Devuelve los no leídos que quedan en Recibidos, para el contador.
 */
export async function setSeen(client: ImapFlow, folder: Folder, uid: number, seen: boolean) {
  await withFolder(
    client,
    folder,
    async () => {
      const msg = await client.fetchOne(String(uid), { uid: true }, { uid: true });
      if (!msg) throw new InboxError("message_not_found", 404);

      const ok = seen
        ? await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true })
        : await client.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true });
      if (!ok) throw new InboxError("flag_update_failed", 502);
    },
    { readOnly: false }
  );

  const status = await client.status("INBOX", { unseen: true });
  return { seen, unseen: status ? status.unseen ?? null : null };
}

export async function downloadAttachment(client: ImapFlow, folder: Folder, uid: number, part: string) {
  return await withFolder(client, folder, async () => {
    const msg = await client.fetchOne(String(uid), { uid: true, bodyStructure: true }, { uid: true });
    if (!msg || !msg.bodyStructure) throw new InboxError("message_not_found", 404);

    const leaf = leaves(msg.bodyStructure).find((n) => n.part === part);
    if (!leaf) throw new InboxError("attachment_not_found", 404);
    if ((leaf.size ?? 0) > MAX_ATTACHMENT_BYTES) throw new InboxError("attachment_too_large", 413);

    const { content } = await client.download(String(uid), part, { uid: true });
    if (!content) throw new InboxError("attachment_not_found", 404);
    return await readStream(content);
  });
}

export type ReplyDraft = {
  to: string;
  subject: string;
  inReplyTo: string;
  references: string;
  quote?: QuotedMessage;
};

/**
 * Lo que hace falta para responder a un mensaje de Recibidos: destinatario,
 * asunto "Re: ...", cabeceras para que Gmail (y el resto) lo agrupe en la
 * misma conversación y la cita del original.
 */
export async function prepareReply(client: ImapFlow, account: FamilyMailAccount, uid: number): Promise<ReplyDraft> {
  const { msg, recipient, originalText } = await withFolder(client, "inbox", async () => {
    const msg = await fetchMessage(client, uid);
    const recipient = replyRecipient(msg, account);
    if (!recipient) throw new InboxError("no_reply_recipient", 400);

    const parts = msg.bodyStructure ? leaves(msg.bodyStructure) : [];
    const textPart = parts.find((n) => isBodyText(n, "text/plain"));
    const htmlPart = parts.find((n) => isBodyText(n, "text/html"));
    let originalText = textPart ? await downloadText(client, uid, textPart.part) : "";
    if (!originalText.trim() && htmlPart) originalText = htmlToText(await downloadText(client, uid, htmlPart.part));

    return { msg, recipient, originalText };
  });

  const subjectRaw = String(msg.envelope?.subject ?? "").replace(/[\r\n]+/g, " ").trim();
  const subject = (/^\s*(re|rv|aw)\s*:/i.test(subjectRaw) ? subjectRaw : `Re: ${subjectRaw}`).slice(0, MAX_SUBJECT_LENGTH);

  // Solo identificadores <...>: nada de lo que venga en el original puede
  // colar saltos de línea en las cabeceras.
  const inReplyTo = (String(msg.envelope?.messageId ?? "").match(/<[^<>\s]+>/) ?? [])[0] ?? "";
  const previousRefs = (msg.headers?.toString("utf8") ?? "")
    .replace(/\r?\n[ \t]+/g, " ")
    .match(/^references:(.*)$/im)?.[1] ?? "";
  const references = Array.from(new Set([...(previousRefs.match(/<[^<>\s]+>/g) ?? []), inReplyTo].filter(Boolean)))
    .slice(-20)
    .join(" ");

  // Cita del original, como la pone Gmail.
  const originalDate = msg.internalDate ? new Date(msg.internalDate) : null;
  let dateLabel = "";
  try {
    dateLabel = originalDate
      ? new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Madrid" }).format(originalDate)
      : "";
  } catch {
    dateLabel = originalDate?.toISOString() ?? "";
  }
  const sender = toAddress(msg.envelope?.from?.[0]) ?? recipient;
  const senderLabel = sender.name ? `${sender.name} <${sender.address}>` : sender.address;
  const quoteText = originalText.length > MAX_QUOTE_LENGTH
    ? `${originalText.slice(0, MAX_QUOTE_LENGTH)}\n[…]`
    : originalText;

  return {
    to: recipient.address,
    subject,
    inReplyTo,
    references,
    quote: quoteText.trim()
      ? { intro: `${dateLabel ? `El ${dateLabel}, ` : ""}${senderLabel} escribió:`, text: quoteText }
      : undefined,
  };
}
