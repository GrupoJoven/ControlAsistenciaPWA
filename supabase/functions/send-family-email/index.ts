// supabase/functions/send-family-email/index.ts
//
// "Contactar familias": un coordinador escribe un correo y se envía a los
// parent_email de los niños de los grupos que elija.
//
// - action "preview": valida permisos y devuelve cuántas familias lo recibirán,
//   desde qué cuenta y el HTML final (con la firma de protección de datos).
// - action "send": envía UNA TANDA (desde `offset`, como mucho BATCH_SIZE
//   familias) en un solo correo con todas en copia oculta (CCO), así ninguna
//   familia ve las direcciones de las demás. El frontend va pidiendo tandas
//   hasta terminar.
//
// "send" admite adjuntos: llegan como multipart/form-data (ver
// readMailRequest en _shared/family-mail-outbox.ts) y el frontend los vuelve a
// subir en cada tanda.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildFamilyEmailHtml } from "../_shared/family-email-signature.ts";
import { FAMILY_MAIL_ACCOUNTS, type Stage } from "../_shared/family-mail-accounts.ts";
import { FamilyMailError } from "../_shared/family-mail-error.ts";
import { getLogoUrl, readAttachments, readMailRequest, sendFamilyMail } from "../_shared/family-mail-outbox.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Gmail admite como mucho 100 destinatarios por correo enviado por SMTP
// (https://support.google.com/a/answer/166852): cada tanda es un correo con
// hasta 90 familias en CCO, con margen.
const BATCH_SIZE = 90;
const MAX_GROUPS = 200;
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 20000;

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

const EMAIL_RE = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/;

/** Un parent_email puede traer varias direcciones ("a@x.es; b@y.es"). */
function splitEmails(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(/[;,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => EMAIL_RE.test(s));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  try {
    const authHeader =
      req.headers.get("authorization") ??
      req.headers.get("Authorization") ??
      "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return jsonResponse({ ok: false, error: "invalid_or_missing_jwt" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1) Quién llama (verificando el JWT de verdad, no solo decodificándolo)
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
    const sender = FAMILY_MAIL_ACCOUNTS[callerStage ?? "global"];

    // 2) Parámetros (y adjuntos, si los hay)
    const { params, files } = await readMailRequest(req);
    const { action, group_ids, subject, body, offset } = params ?? {};

    if (action !== "preview" && action !== "send") {
      return jsonResponse({ ok: false, error: "invalid_action" }, 400);
    }

    const groupIds: string[] = Array.isArray(group_ids)
      ? Array.from(new Set(group_ids.filter((g: unknown) => typeof g === "string" && g)))
      : [];
    if (groupIds.length === 0) return jsonResponse({ ok: false, error: "no_groups" }, 400);
    if (groupIds.length > MAX_GROUPS) return jsonResponse({ ok: false, error: "too_many_groups" }, 400);

    const cleanSubject = String(subject ?? "").replace(/[\r\n]+/g, " ").trim();
    const cleanBody = String(body ?? "").trim();
    if (!cleanSubject) return jsonResponse({ ok: false, error: "missing_subject" }, 400);
    if (!cleanBody) return jsonResponse({ ok: false, error: "missing_body" }, 400);
    if (cleanSubject.length > MAX_SUBJECT_LENGTH) return jsonResponse({ ok: false, error: "subject_too_long" }, 400);
    if (cleanBody.length > MAX_BODY_LENGTH) return jsonResponse({ ok: false, error: "body_too_long" }, 400);

    // 3) Grupos: tienen que existir y, si es coordinador de etapa, ser de su etapa
    const { data: groups, error: gErr } = await admin
      .from("groups")
      .select("id, stage")
      .in("id", groupIds);

    if (gErr) return jsonResponse({ ok: false, error: "groups_read_failed", details: gErr.message }, 500);
    if ((groups ?? []).length !== groupIds.length) {
      return jsonResponse({ ok: false, error: "unknown_group" }, 400);
    }
    if (callerStage && (groups ?? []).some((g: any) => g.stage !== callerStage)) {
      return jsonResponse({ ok: false, error: "group_not_allowed" }, 403);
    }

    // 4) Destinatarios: parent_email de los niños de esos grupos, sin repetidos
    //    (hermanos en varios grupos). Orden estable para que las tandas cuadren.
    let students: { parent_email: string | null }[] = [];
    let from = 0;
    const pageSize = 1000;

    while (true) {
      const { data, error } = await admin
        .from("students")
        .select("id, parent_email")
        .in("group_id", groupIds)
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) return jsonResponse({ ok: false, error: "students_read_failed", details: error.message }, 500);
      if (!data || data.length === 0) break;

      students = students.concat(data);
      if (data.length < pageSize) break;

      from += pageSize;
    }

    const recipientSet = new Set<string>();
    let studentsWithoutEmail = 0;
    for (const s of students) {
      const emails = splitEmails(s.parent_email);
      if (emails.length === 0) studentsWithoutEmail++;
      for (const e of emails) recipientSet.add(e);
    }
    const recipients = Array.from(recipientSet).sort();

    if (action === "preview") {
      const logoUrl = await getLogoUrl();
      return jsonResponse({
        ok: true,
        total: recipients.length,
        students: students.length,
        students_without_email: studentsWithoutEmail,
        from: sender.email,
        logo: Boolean(logoUrl),
        html: buildFamilyEmailHtml(cleanBody, logoUrl),
        batch_size: BATCH_SIZE,
        batches: Math.ceil(recipients.length / BATCH_SIZE),
      });
    }

    // 5) Enviar una tanda: un correo con sus familias en CCO
    const attachments = await readAttachments(files, params.attachment_names);
    const start = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    const batch = recipients.slice(start, start + BATCH_SIZE);
    const nextOffset = start + batch.length;

    let result = { sent: [] as string[], failed: [] as string[] };
    if (batch.length > 0) {
      try {
        result = await sendFamilyMail(sender, { bcc: batch, subject: cleanSubject, attachments }, cleanBody);
      } catch (e) {
        // Si Gmail rechaza la tanda, casi seguro es la cuenta (contraseña de
        // aplicación, límite diario...): se corta para no seguir con más tandas.
        if (e instanceof FamilyMailError) {
          return jsonResponse({ ok: false, error: e.code, ...e.extra, next_offset: start }, e.status);
        }
        throw e;
      }
    }

    return jsonResponse({
      ok: true,
      sent: result.sent.length,
      failed: result.failed,
      total: recipients.length,
      next_offset: nextOffset,
      done: nextOffset >= recipients.length,
    });
  } catch (e) {
    if (e instanceof FamilyMailError) {
      return jsonResponse({ ok: false, error: e.code, ...e.extra }, e.status);
    }
    console.log("Unhandled error:", e);
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
});
