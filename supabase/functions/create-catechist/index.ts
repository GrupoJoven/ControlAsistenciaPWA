// supabase/functions/create-catechist/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = {
  email: string;
  password: string;
  name: string;
  birth_date?: string | null;
  group_ids?: string[];
};

Deno.serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Faltan variables de entorno de Supabase" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }, });
    }

    // 1) Validar que quien llama está logueado y es coordinator
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "No autorizado (sin token)" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }, });
    }

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await caller.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "No autorizado (token inválido)" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" }, });
    }

    const callerId = userData.user.id;

    const { data: profile, error: profErr } = await caller
      .from("profiles")
      .select("role, stage")
      .eq("id", callerId)
      .single();

    if (profErr || !profile) {
      return new Response(JSON.stringify({ error: "No se pudo leer el perfil del caller" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }, });
    }

    if (profile.role !== "coordinator") {
      return new Response(JSON.stringify({ error: "Prohibido: solo coordinator" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }, });
    }

    // Un coordinador de etapa (profiles.stage no nulo) crea catequistas de su
    // etapa: se les marca la misma stage para que le aparezcan en el registro
    // aunque todavía no tengan grupo. El global no marca nada.
    const callerStage: string | null = profile.stage ?? null;

    // 2) Crear usuario con Admin API (service role)
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });


    const body = (await req.json()) as Body;

    if (!body?.email || !body?.password || !body?.name) {
      return new Response(JSON.stringify({ error: "Faltan email/password/name" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }, });
    }

    const groupIds = Array.isArray(body.group_ids) ? body.group_ids.filter(Boolean) : [];
    const uniqueGroupIds = Array.from(new Set(groupIds));

    // Los grupos se comprueban con el cliente del caller: RLS solo le deja ver
    // los de su etapa, así que cualquier id que no vuelva es de la otra (o no
    // existe). Se valida ANTES de crear el usuario para no dejarlo a medias.
    if (uniqueGroupIds.length > 0) {
      const { data: visibleGroups, error: groupsErr } = await caller
        .from("groups")
        .select("id, stage")
        .in("id", uniqueGroupIds);

      if (groupsErr) {
        return new Response(JSON.stringify({ error: "No se pudieron comprobar los grupos: " + groupsErr.message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }, });
      }

      const manageable = new Set(
        (visibleGroups ?? [])
          .filter((g: any) => callerStage === null || g.stage === callerStage)
          .map((g: any) => g.id)
      );
      const forbidden = uniqueGroupIds.filter((id) => !manageable.has(id));

      if (forbidden.length > 0) {
        return new Response(JSON.stringify({ error: "Alguno de los grupos no es de tu etapa o no existe." }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" }, });
      }
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
      user_metadata: { name: body.name, role: "catechist", stage: callerStage },
    });

    if (createErr || !created?.user) {
      return new Response(JSON.stringify({ error: createErr?.message ?? "No se pudo crear" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }, });
    }

    const newUserId = created.user.id;

    if (uniqueGroupIds.length > 0) {
      const rows = uniqueGroupIds.map(group_id => ({
        group_id,
        profile_id: newUserId,
      }));

      // Si tu tabla tiene PK (group_id, profile_id), evita errores si hay duplicados:
      const { error: linkErr } = await admin
        .from("group_catechist")
        .upsert(rows, { onConflict: "group_id,profile_id" });

      if (linkErr) {
        // Usuario creado, pero devolvemos warning
        return new Response(
          JSON.stringify({ ok: true, userId: newUserId, warn: "Grupo(s) no asignados: " + linkErr.message }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }


    // 3) Completar profiles (tu trigger probablemente ya creó la fila; esto la actualiza)
    // Ajusta los campos a tu esquema real. Si no tienes birth_date o email en profiles, quítalos.
    const updatePayload: Record<string, any> = {
      name: body.name,
      role: "catechist",
      stage: callerStage,
      email: body.email,
      birth_date: body.birth_date ?? null,
    };


    const { error: updErr } = await admin.from("profiles").update(updatePayload).eq("id", newUserId);
    if (updErr) {
      // El usuario ya existe en auth, devolvemos ok con warning
      return new Response(JSON.stringify({ ok: true, userId: newUserId, warn: updErr.message }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }, });
    }

    return new Response(JSON.stringify({ ok: true, userId: newUserId }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" }, });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" }, });
  }
});
