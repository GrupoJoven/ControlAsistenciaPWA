/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// --------------------
// Types
// --------------------
type ReportType = "students" | "catechists";
type Scope = "group" | "all_students" | "all_catechists";
type Stage = "preconfirmation" | "confirmation";
type ReportStage = Stage | "all";

type ReqBody = {
  reportType: ReportType;
  scope: Scope;
  scopeId: string | null;
};

type MonthlyReportRow = {
  id: string;
  scope: Scope;
  scope_id: string | null;
  stage: ReportStage;
  month: string;
  report_type: ReportType;
  generated_by: string;
  generated_at: string;
  payload: any;
};

const STAGE_LABELS: Record<ReportStage, string> = {
  preconfirmation: "Preconfirmación",
  confirmation: "Confirmación",
  all: "Ambas etapas",
};

/**
 * Etapas efectivas de un perfil: la de profiles.stage más las de sus grupos
 * (misma regla que profile_stages() en la BD). Un coordinador global tiene
 * las dos. Sirve para no contar como ausencia un evento de la otra etapa.
 */
function getProfileStages(
  profile: { id: string; role: string; stage: string | null },
  links: { profile_id: string; group_id: string }[],
  groupStageById: Map<string, string | null>
): Stage[] {
  if (profile.role === "coordinator" && !profile.stage) return ["preconfirmation", "confirmation"];

  const stages = new Set<Stage>();
  if (profile.stage === "preconfirmation" || profile.stage === "confirmation") stages.add(profile.stage);

  for (const link of links) {
    if (link.profile_id !== profile.id) continue;
    const stage = groupStageById.get(link.group_id);
    if (stage === "preconfirmation" || stage === "confirmation") stages.add(stage);
  }

  return [...stages];
}

// --------------------
// Helpers
// --------------------
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function badRequest(message: string, extra?: any) {
  return json({ error: message, ...extra }, 400);
}

function forbidden(message: string) {
  return json({ error: message }, 403);
}

function serverError(message: string, extra?: any) {
  return json({ error: message, ...extra }, 500);
}

function getMonthMadridISO(now = new Date()): string {
  // YYYY-MM en zona Europe/Madrid (evita problemas UTC en cambio de mes)
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${year}-${month}`;
}

function getAcademicYearRange(todayISO: string): { start: string; end: string } {
  // Asume todayISO = "YYYY-MM-DD"
  const y = Number(todayISO.slice(0, 4));
  const m = Number(todayISO.slice(5, 7));
  // Curso típico: 1 Sep -> 31 Ago
  const startYear = m >= 9 ? y : y - 1;
  const endYear = startYear + 1;
  return { start: `${startYear}-09-01`, end: `${endYear}-08-31` };
}

function clampText(s: string, max = 12000) {
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max) + "\n[...recortado...]";
}

// --------------------
// Gemini (REST) helper
// Endpoint oficial: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key=...
// Docs: ai.google.dev (Generate content)
// --------------------
async function geminiGenerateJSON(args: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  userText: string;
  temperature?: number;
}): Promise<{ summary: string; recommendations: string[] }> {
  const { apiKey, model, systemInstruction, userText, temperature = 0.7 } = args;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [
      {
        role: "user",
        parts: [{ text: userText }],
      },
    ],
    generationConfig: {
      temperature,
      responseMimeType: "application/json",
      // Nota: en REST, responseSchema también existe en la API,
      // pero para evitar incompatibilidades, forzamos JSON mode y validamos al parsear.
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const raw = await resp.text();
  if (!resp.ok) {
    // 1500 caracteres: con 400 se cortaba justo antes del límite de cuota, que es
    // el dato que dice si el modelo se ha quedado sin cupo gratuito.
    return {
      summary:
        `Error Gemini (${resp.status}) con el modelo "${model}". ` +
        (raw?.slice(0, 1500) ?? "Sin detalle"),
      recommendations:
        resp.status === 429
          ? [
              `Comprueba si "${model}" conserva cuota gratuita (si el límite es 0, hay que cambiar de modelo).`,
              "Cambia el modelo con: supabase secrets set GEMINI_MODEL=<modelo>",
              "Revisa el consumo en ai.dev/rate-limit",
            ]
          : ["Intenta de nuevo más tarde", "Revisa la configuración de la IA"],
    };
  }

  // La respuesta de Gemini suele venir en candidates[0].content.parts[0].text
  let textOut = "";
  try {
    const j = JSON.parse(raw);
    textOut =
      j?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ??
      "";
  } catch {
    textOut = raw;
  }

  // JSON mode: debería ser JSON en texto
  try {
    const parsed = JSON.parse(textOut);
    return {
      summary: String(parsed?.summary ?? ""),
      recommendations: Array.isArray(parsed?.recommendations)
        ? parsed.recommendations.map((x: any) => String(x))
        : [],
    };
  } catch {
    // fallback
    return {
      summary: textOut || "No se pudo parsear la respuesta de Gemini.",
      recommendations: [],
    };
  }
}

// --------------------
// Main
// --------------------
serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? Deno.env.get("GEMINI_API_KEY".toLowerCase()) ?? "";

  // Configurable por secret: Google retira los modelos antiguos por dos vías,
  // dejándolos sin cuota gratuita (gemini-2.0-flash, 429 con limit 0) o cerrándolos
  // a claves nuevas (gemini-2.5-flash, 404). Por eso el defecto es el alias móvil,
  // que Google mantiene apuntando al flash vigente.
  const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-flash-latest";

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return serverError("Faltan variables de entorno de Supabase (URL/ANON/SERVICE_ROLE).");
  }
  if (!GEMINI_API_KEY) {
    return serverError("Falta GEMINI_API_KEY en variables de entorno (secrets).");
  }

  // Cliente "user" para validar JWT
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: authData, error: authErr } = await userClient.auth.getUser();
  if (authErr || !authData?.user) {
    return forbidden("No autorizado (token inválido o expirado).");
  }
  const userId = authData.user.id;

  // Cliente admin para leer/escribir sin RLS (solo server-side)
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Parse body
  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return badRequest("Body inválido (JSON requerido).");
  }

  const reportType = body?.reportType;
  const scope = body?.scope;
  const scopeId = body?.scopeId ?? null;

  const validReportType = reportType === "students" || reportType === "catechists";
  const validScope = scope === "group" || scope === "all_students" || scope === "all_catechists";
  if (!validReportType) return badRequest("reportType inválido.");
  if (!validScope) return badRequest("scope inválido.");

  if (scope === "group" && (!scopeId || typeof scopeId !== "string")) {
    return badRequest("scopeId es obligatorio cuando scope='group'.");
  }
  if (scope !== "group" && scopeId !== null) {
    // Para evitar llamadas raras desde el cliente
    return badRequest("scopeId debe ser null cuando scope != 'group'.");
  }

  // Carga rol del usuario
  const { data: prof, error: profErr } = await admin
    .from("profiles")
    .select("id, role, stage, name")
    .eq("id", userId)
    .maybeSingle();

  if (profErr || !prof) return forbidden("No se pudo cargar el perfil del usuario.");
  const role = String(prof.role ?? "");

  const isCoordinator = role === "coordinator";
  const isCatechist = role === "catechist";

  // Coordinador de etapa: profiles.stage no nulo. Sus informes "todos los
  // niños / equipo" son solo de su etapa y se guardan con esa stage. Los de
  // grupo llevan 'all' porque el grupo ya es de una etapa concreta. Tiene que
  // coincidir con lo que consulta Reports.tsx.
  const callerStage: Stage | null =
    isCoordinator && (prof.stage === "preconfirmation" || prof.stage === "confirmation")
      ? prof.stage
      : null;
  const reportStage: ReportStage = scope === "group" ? "all" : (callerStage ?? "all");

  // Permisos por scope:
  // - catechists report: solo coordinator (scope all_catechists)
  // - all_students: solo coordinator
  // - group: coordinator si el grupo es de su etapa (el global, cualquiera);
  //   catechist solo si está vinculado en group_catechist
  if (reportType === "catechists") {
    if (!isCoordinator || scope !== "all_catechists") {
      return forbidden("Solo el coordinador puede generar/ver el informe del equipo.");
    }
  }

  if (scope === "all_students" || scope === "all_catechists") {
    if (!isCoordinator) {
      return forbidden("Solo el coordinador puede acceder a este tipo de informe.");
    }
  }

  if (scope === "group" && isCatechist && !isCoordinator) {
    // verificar vínculo group_catechist
    const { data: link, error: linkErr } = await admin
      .from("group_catechist")
      .select("group_id")
      .eq("profile_id", userId)
      .eq("group_id", scopeId!)
      .maybeSingle();

    if (linkErr || !link) return forbidden("No tienes permiso para generar/ver informes de ese grupo.");
  }

  if (scope === "group" && isCoordinator && callerStage) {
    const { data: grp, error: grpErr } = await admin
      .from("groups")
      .select("id, stage")
      .eq("id", scopeId!)
      .maybeSingle();

    if (grpErr || !grp || grp.stage !== callerStage) {
      return forbidden("Ese grupo no es de tu etapa.");
    }
  }

  // Month lock
  const month = getMonthMadridISO(new Date());

  // ¿Existe ya el informe de este mes?
  let existingQ = admin
    .from("monthly_reports")
    .select("*")
    .eq("month", month)
    .eq("scope", scope)
    .eq("stage", reportStage)
    .eq("report_type", reportType);

  if (scope === "group") existingQ = existingQ.eq("scope_id", scopeId);
  else existingQ = existingQ.is("scope_id", null);

  const { data: existing, error: existingErr } = await existingQ.maybeSingle();
  if (existingErr) {
    return serverError("Error consultando informes existentes.", { detail: existingErr.message });
  }
  if (existing) {
    // Devuelve el existente (el cliente ya lo trata como bloqueado)
    const row = existing as MonthlyReportRow;
    return json({ existing: true, ...row }, 200);
  }

  // ----------------------------------------------------------------------
  // Construir dataset (resumen) para Gemini
  // ----------------------------------------------------------------------
  const todayISO = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // "YYYY-MM-DD" en formato en-CA

  const { start, end } = getAcademicYearRange(todayISO);

  let payload: any = null;

  if (reportType === "students") {
    // Determinar alumnos target. Para un coordinador de etapa, "todos" son
    // los de los grupos de su etapa (groups.stage sale del nombre del grupo).
    let studQuery = admin
      .from("students")
      .select("id, name, school, group_id, groups!inner(stage)");

    if (scope === "group") studQuery = studQuery.eq("group_id", scopeId!);
    else if (callerStage) studQuery = studQuery.eq("groups.stage", callerStage);

    const { data: studs, error: studsErr } = await studQuery;
    if (studsErr) return serverError("Error cargando alumnos.", { detail: studsErr.message });

    const studentIds = (studs ?? []).map((s: any) => s.id);
    if (studentIds.length === 0) {
      payload = {
        summary: "No hay alumnos en este ámbito, no se puede generar un informe útil.",
        recommendations: ["Asigna alumnos a un grupo antes de generar informes."],
      };
    } else {
      // Attendance del curso para esos alumnos
      const { data: att, error: attErr } = await admin
        .from("student_attendance")
        .select("student_id, date, catechism, mass")
        .in("student_id", studentIds)
        .gte("date", start)
        .lte("date", todayISO);

      if (attErr) return serverError("Error cargando asistencia de alumnos.", { detail: attErr.message });

      // Agregar
      const byId = new Map<string, { total: number; catP: number; massP: number }>();
      for (const r of att ?? []) {
        const sid = String((r as any).student_id);
        const obj = byId.get(sid) ?? { total: 0, catP: 0, massP: 0 };
        obj.total += 1;
        if ((r as any).catechism === "present") obj.catP += 1;
        if ((r as any).mass === "present") obj.massP += 1;
        byId.set(sid, obj);
      }

      const rows = (studs ?? []).map((s: any) => {
        const a = byId.get(String(s.id)) ?? { total: 0, catP: 0, massP: 0 };
        const total = a.total;
        const catRate = total > 0 ? Math.round((a.catP / total) * 100) : 0;
        const massRate = total > 0 ? Math.round((a.massP / total) * 100) : 0;
        const avgRate = total > 0 ? Math.round(((a.catP + a.massP) / (2 * total)) * 100) : 0;

        return {
          id: s.id,
          name: s.name,
          school: s.school ?? "",
          total_days: total,
          cat_present: a.catP,
          mass_present: a.massP,
          cat_rate: catRate,
          mass_rate: massRate,
          avg_rate: avgRate,
        };
      });

      // Reducir tokens: top/bottom
      const withEnough = rows.filter((r) => r.total_days >= 3);
      const sorted = [...withEnough].sort((a, b) => a.avg_rate - b.avg_rate);
      const worst = sorted.slice(0, 12);
      const best = sorted.slice(-8).reverse();

      const scopeTitle =
        scope === "all_students"
          ? callerStage
            ? `Todos los niños de ${STAGE_LABELS[callerStage]}`
            : "Todos los niños (parroquia)"
          : "Grupo específico";

      const userText = clampText(
        [
          `ÁMBITO: ${scopeTitle}`,
          `PERIODO DE DATOS: ${start} a ${todayISO}`,
          ``,
          `NIÑOS CON MENOR COMPROMISO (ordenados por media):`,
          ...worst.map(
            (r) =>
              `- ${r.name} (${r.school}): días=${r.total_days}, catequesis=${r.cat_rate}%, misa=${r.mass_rate}%, media=${r.avg_rate}%`
          ),
          ``,
          `NIÑOS CON MAYOR COMPROMISO:`,
          ...best.map(
            (r) =>
              `- ${r.name} (${r.school}): días=${r.total_days}, catequesis=${r.cat_rate}%, misa=${r.mass_rate}%, media=${r.avg_rate}%`
          ),
          ``,
          `INSTRUCCIONES:`,
          `- Menciona nombres propios y patrones concretos.`,
          `- Evita consejos genéricos.`,
          `- Si faltan datos, dilo explícitamente.`,
          `- Devuelve JSON con { "summary": string, "recommendations": string[] }`,
        ].join("\n"),
        14000
      );

      const systemInstruction =
        "Eres el Coordinador de Catequesis de la Parroquia San Pascual Baylón. " +
        "Redacta un informe pastoral profesional, concreto y útil para tomar decisiones.";

      // Modelo (ajusta si quieres)
      const model = GEMINI_MODEL;

      payload = await geminiGenerateJSON({
        apiKey: GEMINI_API_KEY,
        model,
        systemInstruction,
        userText,
        temperature: 0.7,
      });
    }
  } else {
    // reportType === "catechists" (solo coordinator y scope all_catechists)
    // Cargar catequistas con sus etapas (grupos + profiles.stage). Para un
    // coordinador de etapa solo entran los de la suya.
    const { data: allCats, error: catsErr } = await admin
      .from("profiles")
      .select("id, name, role, stage")
      .eq("role", "catechist")
      .order("name", { ascending: true });

    if (catsErr) return serverError("Error cargando catequistas.", { detail: catsErr.message });

    const { data: groupRows, error: groupsErr } = await admin.from("groups").select("id, stage");
    if (groupsErr) return serverError("Error cargando grupos.", { detail: groupsErr.message });

    const { data: linkRows, error: linksErr } = await admin
      .from("group_catechist")
      .select("profile_id, group_id");
    if (linksErr) return serverError("Error cargando group_catechist.", { detail: linksErr.message });

    const groupStageById = new Map<string, string | null>(
      (groupRows ?? []).map((g: any) => [String(g.id), g.stage ?? null])
    );
    const links = (linkRows ?? []) as { profile_id: string; group_id: string }[];

    const stagesById = new Map<string, Stage[]>();
    for (const c of allCats ?? []) {
      stagesById.set(String(c.id), getProfileStages(c as any, links, groupStageById));
    }

    const cats = (allCats ?? []).filter(
      (c: any) => !callerStage || (stagesById.get(String(c.id)) ?? []).includes(callerStage)
    );

    // class days y events del curso. De los eventos, un coordinador de etapa
    // solo ve los suyos y los de 'all'; y a cada catequista solo se le exigen
    // los de sus etapas.
    const { data: classDays, error: cdErr } = await admin
      .from("class_days")
      .select("date")
      .gte("date", start)
      .lte("date", todayISO);

    if (cdErr) return serverError("Error cargando class_days.", { detail: cdErr.message });

    let evQuery = admin
      .from("parish_events")
      .select("id, title, date, stage")
      .gte("date", start)
      .lte("date", todayISO);

    if (callerStage) evQuery = evQuery.in("stage", ["all", callerStage]);

    const { data: evs, error: evErr } = await evQuery;

    if (evErr) return serverError("Error cargando parish_events.", { detail: evErr.message });

    const nClass = (classDays ?? []).length;
    const nEvents = (evs ?? []).length;

    const eventsForStages = (stages: Stage[]) =>
      (evs ?? []).filter((e: any) => e.stage === "all" || stages.includes(e.stage));

    // attendance catequistas: días lectivos (catechist_attendance) y eventos
    // (catechist_attendance_events) van en tablas distintas.
    const catechistIds = (cats ?? []).map((c: any) => c.id);

    const { data: ca, error: caErr } = await admin
      .from("catechist_attendance")
      .select("profile_id, date, catechism, mass")
      .in("profile_id", catechistIds)
      .gte("date", start)
      .lte("date", todayISO);

    if (caErr) return serverError("Error cargando catechist_attendance.", { detail: caErr.message });

    const { data: cae, error: caeErr } = await admin
      .from("catechist_attendance_events")
      .select("profile_id, event_id, status")
      .in("profile_id", catechistIds)
      .gte("date", start)
      .lte("date", todayISO);

    if (caeErr) return serverError("Error cargando catechist_attendance_events.", { detail: caeErr.message });

    // Agregación simple: contamos asistencias "present"/"late" como asistencia.
    const byP = new Map<string, { classAttend: number; classPossible: number; eventAttend: number; eventPossible: number; eventIds: Set<string> }>();
    for (const pid of catechistIds) {
      const applicable = eventsForStages(stagesById.get(String(pid)) ?? []);
      byP.set(pid, {
        classAttend: 0,
        classPossible: nClass * 2,
        eventAttend: 0,
        eventPossible: applicable.length,
        eventIds: new Set(applicable.map((e: any) => String(e.id))),
      });
    }

    // contamos registros reales (si faltan registros, se consideran ausencias implícitas por el posible total)
    for (const r of ca ?? []) {
      const pid = String((r as any).profile_id);
      const obj = byP.get(pid);
      if (!obj) continue;

      // catechism + mass pueden estar presentes/late/absent
      const c = (r as any).catechism;
      const m = (r as any).mass;
      if (c === "present" || c === "late") obj.classAttend += 1;
      if (m === "present" || m === "late") obj.classAttend += 1;
    }

    for (const r of cae ?? []) {
      const pid = String((r as any).profile_id);
      const obj = byP.get(pid);
      if (!obj) continue;
      // Un evento de la otra etapa no cuenta ni a favor ni en contra.
      if (!obj.eventIds.has(String((r as any).event_id))) continue;

      const st = (r as any).status;
      if (st === "present" || st === "late") obj.eventAttend += 1;
    }

    const rows = (cats ?? []).map((c: any) => {
      const a = byP.get(String(c.id))!;
      const possible = a.classPossible + a.eventPossible;
      const attended = a.classAttend + a.eventAttend;
      const rate = possible > 0 ? Math.round((attended / possible) * 100) : 0;
      return {
        name: c.name,
        rate,
        attended,
        possible,
      };
    });

    const sorted = [...rows].sort((a, b) => a.rate - b.rate);
    const low = sorted.slice(0, 10);
    const high = sorted.slice(-8).reverse();

    const userText = clampText(
      [
        `ÁMBITO: Equipo de catequistas${callerStage ? ` de ${STAGE_LABELS[callerStage]}` : ""}`,
        `PERIODO: ${start} a ${todayISO}`,
        `DÍAS LECTIVOS: ${nClass} (cada uno cuenta catequesis+misa)`,
        `EVENTOS: ${nEvents} (a cada catequista solo se le cuentan los de su etapa)`,
        ``,
        `PARTICIPACIÓN MÁS BAJA:`,
        ...low.map((r) => `- ${r.name}: ${r.rate}% (asistencias=${r.attended}/${r.possible})`),
        ``,
        `PARTICIPACIÓN MÁS ALTA:`,
        ...high.map((r) => `- ${r.name}: ${r.rate}% (asistencias=${r.attended}/${r.possible})`),
        ``,
        `INSTRUCCIONES:`,
        `- Valora el compromiso del equipo con tono pastoral.`,
        `- Menciona nombres concretos.`,
        `- Propón acciones específicas para apoyar a quienes tienen menor participación.`,
        `- Devuelve JSON con { "summary": string, "recommendations": string[] }`,
      ].join("\n"),
      14000
    );

    const systemInstruction =
      "Eres el Coordinador de Catequesis de la Parroquia San Pascual Baylón. " +
      "Redacta un informe pastoral profesional, concreto y respetuoso.";

    const model = GEMINI_MODEL;

    payload = await geminiGenerateJSON({
      apiKey: GEMINI_API_KEY,
      model,
      systemInstruction,
      userText,
      temperature: 0.7,
    });
  }

  // Guardar en monthly_reports (service role, bypass RLS)
  const insertRow = {
    scope,
    scope_id: scope === "group" ? scopeId : null,
    stage: reportStage,
    month,
    report_type: reportType,
    generated_by: userId,
    payload,
  };

  const { data: inserted, error: insErr } = await admin
    .from("monthly_reports")
    .insert(insertRow)
    .select("*")
    .single();

  if (insErr) {
    // Si hay carrera (dos clicks), el unique index puede disparar.
    // En ese caso, devolvemos el existente.
    if (String(insErr.message || "").toLowerCase().includes("duplicate")) {
      const { data: ex2 } = await existingQ.maybeSingle();
      if (ex2) return json({ existing: true, ...ex2 }, 200);
    }
    return serverError("Error guardando el informe.", { detail: insErr.message });
  }

  return json({ existing: false, ...(inserted as MonthlyReportRow) }, 200);
});