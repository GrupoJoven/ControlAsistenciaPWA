import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = { userId: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Faltan variables de entorno" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Validar caller y rol coordinator
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "No autorizado (sin token)" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await caller.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "No autorizado (token inválido)" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerId = userData.user.id;

    const { data: profile, error: profErr } = await caller
      .from("profiles")
      .select("role")
      .eq("id", callerId)
      .single();

    if (profErr || !profile) {
      return new Response(JSON.stringify({ error: "No se pudo leer el perfil del caller" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (profile.role !== "coordinator") {
      return new Response(JSON.stringify({ error: "Prohibido: solo coordinator" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Leer body
    const body = (await req.json()) as Body;
    if (!body?.userId) {
      return new Response(JSON.stringify({ error: "Falta userId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.userId === callerId) {
      return new Response(JSON.stringify({ error: "No puedes eliminar tu propio usuario" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // El global puede borrar a cualquiera; un coordinador de etapa solo a los
    // catequistas de su etapa. La regla vive en la BD (can_manage_profile) y
    // se evalúa con el token del caller.
    const { data: canManage, error: canManageErr } = await caller.rpc("can_manage_profile", {
      _profile_id: body.userId,
    });

    if (canManageErr || canManage !== true) {
      return new Response(JSON.stringify({ error: "Prohibido: ese usuario no es un catequista de tu etapa" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    // 3) Limpieza explícita de dependencias (no dependas de cascadas)
    // 3.1) group_catechist
    {
      const { error } = await admin
        .from("group_catechist")
        .delete()
        .eq("profile_id", body.userId);

      if (error) {
        return new Response(JSON.stringify({ error: "Error borrando group_catechist: " + error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 3.2) catechist_attendance
    {
      const { error } = await admin
        .from("catechist_attendance")
        .delete()
        .eq("profile_id", body.userId);

      if (error) {
        return new Response(JSON.stringify({ error: "Error borrando catechist_attendance: " + error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 3.3) (Opcional) borrar avatar en storage si guardas photo_path en profiles
    // Si no quieres tocar storage, elimina este bloque.
    {
      const { data: p, error: pErr } = await admin
        .from("profiles")
        .select("photo_path")
        .eq("id", body.userId)
        .single();

      // si no existe o no hay photo_path, seguimos
      if (!pErr && p?.photo_path) {
        // remove acepta array de paths
        await admin.storage.from("media").remove([p.photo_path]);
      }
    }

    // 3.4) borrar profile (si tu trigger ya lo borra, este delete puede devolver 0 filas y da igual)
    {
      const { error } = await admin.from("profiles").delete().eq("id", body.userId);
      if (error) {
        // si tu esquema impide borrar profiles directamente, aquí te enteras con un error claro
        return new Response(JSON.stringify({ error: "Error borrando profile: " + error.message }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 4) Borrado auth.users
    const { error: delErr } = await admin.auth.admin.deleteUser(body.userId);
    if (delErr) {
      return new Response(JSON.stringify({ error: delErr.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

