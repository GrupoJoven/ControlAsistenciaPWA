import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

function getUserIdFromJwt(authHeader: string): string {
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("No autorizado (sin token)");
  }

  const token = authHeader.slice("Bearer ".length);
  const parts = token.split(".");

  if (parts.length !== 3) {
    throw new Error("JWT inválido");
  }

  const payload = JSON.parse(base64UrlDecode(parts[1]));
  const userId = payload?.sub;

  if (!userId || typeof userId !== "string") {
    throw new Error("JWT sin subject válido");
  }

  return userId;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Método no permitido" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: "Faltan variables de entorno" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader =
      req.headers.get("authorization") ??
      req.headers.get("Authorization") ??
      "";

    let userId: string;
    try {
      userId = getUserIdFromJwt(authHeader);
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err?.message ?? "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const query = typeof body?.query === "string" ? body.query.trim().toLowerCase() : "";
    const onlyFolders = !!body?.onlyFolders;
    const limitRaw = Number(body?.limit ?? 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

    if (!query) {
      return new Response(JSON.stringify({ error: "La búsqueda no puede estar vacía." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    let dbQuery = admin
      .from("drive_index_items")
      .select(`
        file_id,
        parent_id,
        name,
        mime_type,
        path,
        web_view_link,
        icon_link,
        thumbnail_link,
        modified_time,
        is_folder,
        owner_display_name,
        owner_email,
        can_rename,
        can_download,
        can_trash,
        can_edit
      `)
      .eq("user_id", userId)
      .eq("trashed", false)
      .or(`name_normalized.ilike.%${query}%,path.ilike.%${query}%`)
      .order("is_folder", { ascending: false })
      .order("name", { ascending: true })
      .limit(limit);

    if (onlyFolders) {
      dbQuery = dbQuery.eq("is_folder", true);
    }

    const { data, error } = await dbQuery;

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        results: data ?? [],
        count: data?.length ?? 0,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});