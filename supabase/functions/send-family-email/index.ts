// supabase/functions/send-family-email/index.ts
//
// "Contactar familias": un coordinador escribe un correo y se envía a los
// parent_email de los niños de los grupos que elija.
//
// - action "preview": valida permisos y devuelve cuántas familias lo recibirán,
//   desde qué cuenta y el HTML final (con la firma de protección de datos).
// - action "send": envía UNA TANDA (desde `offset`, como mucho BATCH_SIZE
//   familias). El frontend va pidiendo tandas hasta terminar, así ninguna
//   llamada se acerca al límite de tiempo de las edge functions.
//
// Se envía un correo por familia (nunca todas las direcciones juntas en To/Cc)
// para que ninguna familia vea el correo de las demás.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer/mod.ts";
import { buildFamilyEmailHtml, buildFamilyEmailText } from "./signature.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Logo de la firma: bucket público de Storage (ver docs/contactar-familias.md).
// Si todavía no se ha subido, el correo sale igual pero sin imagen.
const LOGO_URL = `${SUPABASE_URL}/storage/v1/object/public/email-assets/logo-grupo-joven.png`;

const BATCH_SIZE = 20;
const MAX_GROUPS = 200;
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 20000;

type Stage = "preconfirmation" | "confirmation";

/**
 * Cuenta desde la que escribe cada coordinador. Debe coincidir con
 * FAMILY_EMAIL_SENDERS en components/FamilyContact.tsx.
 * La contraseña de aplicación de Gmail de cada cuenta va en su secret.
 */
const SENDERS: Record<Stage | "global", { email: string; name: string; passwordSecret: string }> = {
  preconfirmation: {
    email: "preconfirmacion@sanpas.es",
    name: "Preconfirmación San Pascual Baylón",
    passwordSecret: "SMTP_PASS_PRECONFIRMACION",
  },
  confirmation: {
    email: "confirmacion@sanpas.es",
    name: "Confirmación San Pascual Baylón",
    passwordSecret: "SMTP_PASS_CONFIRMACION",
  },
  global: {
    email: "grupojoven@sanpas.es",
    name: "Grupo Joven San Pascual Baylón",
    passwordSecret: "SMTP_PASS_GRUPOJOVEN",
  },
};

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

async function logoIsAvailable(): Promise<boolean> {
  try {
    const res = await fetch(LOGO_URL, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
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
    const sender = SENDERS[callerStage ?? "global"];

    // 2) Parámetros
    const { action, group_ids, subject, body, offset } = await req.json().catch(() => ({} as any));

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

    const logoUrl = (await logoIsAvailable()) ? LOGO_URL : null;
    const html = buildFamilyEmailHtml(cleanBody, logoUrl);

    if (action === "preview") {
      return jsonResponse({
        ok: true,
        total: recipients.length,
        students: students.length,
        students_without_email: studentsWithoutEmail,
        from: sender.email,
        logo: Boolean(logoUrl),
        html,
      });
    }

    // 5) Enviar una tanda
    const start = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    const batch = recipients.slice(start, start + BATCH_SIZE);

    // Google muestra la contraseña de aplicación en bloques ("abcd efgh ijkl
    // mnop"), pero los espacios no forman parte de ella: así da igual cómo se pegue.
    const smtpPass = (Deno.env.get(sender.passwordSecret) ?? "").replace(/\s+/g, "");
    if (!smtpPass) {
      return jsonResponse({ ok: false, error: "smtp_not_configured", secret: sender.passwordSecret, from: sender.email }, 500);
    }

    const smtp = new SMTPClient({
      connection: {
        hostname: Deno.env.get("SMTP_HOST") ?? "smtp.gmail.com",
        port: Number(Deno.env.get("SMTP_PORT") ?? "465"),
        tls: true,
        auth: { username: sender.email, password: smtpPass },
      },
    });

    const text = buildFamilyEmailText(cleanBody);
    const failed: string[] = [];
    let sent = 0;
    let lastError = "";

    try {
      for (const to of batch) {
        try {
          await smtp.send({
            from: `${sender.name} <${sender.email}>`,
            to,
            subject: cleanSubject,
            content: text,
            html,
          });
          sent++;
        } catch (e) {
          lastError = String(e);
          console.log("SMTP send error", lastError);
          failed.push(to);
        }
      }
    } finally {
      // Si la conexión nunca llegó a abrirse (p. ej. contraseña mal), close()
      // también falla: no debe tapar el resultado de la tanda.
      try {
        await smtp.close();
      } catch {
        // nada
      }
    }

    const nextOffset = start + batch.length;

    // Si no ha salido ni uno, casi seguro es la cuenta (contraseña de aplicación
    // incorrecta, límite diario de Gmail...): se corta para no seguir con tandas.
    if (batch.length > 0 && sent === 0) {
      return jsonResponse(
        { ok: false, error: "smtp_send_failed", details: lastError, from: sender.email, next_offset: start },
        502
      );
    }

    return jsonResponse({
      ok: true,
      sent,
      failed,
      total: recipients.length,
      next_offset: nextOffset,
      done: nextOffset >= recipients.length,
    });
  } catch (e) {
    console.log("Unhandled error:", e);
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
});
