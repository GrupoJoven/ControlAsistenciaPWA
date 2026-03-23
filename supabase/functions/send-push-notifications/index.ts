import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type PushRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type RequestBody = {
  title: string;
  body: string;
  url?: string;
  userIds?: string[];
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");

if (!supabaseUrl) throw new Error("Falta SUPABASE_URL");
if (!serviceRoleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
if (!vapidPublicKey) throw new Error("Falta VAPID_PUBLIC_KEY");
if (!vapidPrivateKey) throw new Error("Falta VAPID_PRIVATE_KEY");

webpush.setVapidDetails(
  "mailto:no-reply@sanpas.es",
  vapidPublicKey,
  vapidPrivateKey
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const supabase = createClient(supabaseUrl, serviceRoleKey);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: corsHeaders }
    );
  }

  try {
    const body = (await req.json()) as RequestBody;

    if (!body?.title || !body?.body) {
      return new Response(
        JSON.stringify({ error: "Faltan title o body" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const targetUserIds = Array.isArray(body.userIds)
      ? [...new Set(body.userIds.filter((v) => typeof v === "string" && v.trim().length > 0))]
      : [];

    let subsQuery = supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth");

    if (targetUserIds.length > 0) {
      subsQuery = subsQuery.in("user_id", targetUserIds);
    }

    const { data: subscriptions, error: subsError } = await subsQuery;

    if (subsError) {
      throw new Error(`Error cargando suscripciones: ${subsError.message}`);
    }

    const rows = (subscriptions ?? []) as PushRow[];

    if (rows.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          sent: 0,
          removed: 0,
          total: 0,
          filtered_by_user_ids: targetUserIds.length > 0,
          requested_user_ids: targetUserIds,
        }),
        { status: 200, headers: corsHeaders }
      );
    }

    const payload = JSON.stringify({
      title: body.title,
      body: body.body,
      url: body.url ?? "/",
      icon: "/icons/icon-192.png",
    });

    const invalidSubscriptionIds: string[] = [];
    const successfulSubscriptionIds: string[] = [];
    let sent = 0;

    for (const row of rows) {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: {
              p256dh: row.p256dh,
              auth: row.auth,
            },
          },
          payload
        );

        sent += 1;
        successfulSubscriptionIds.push(row.id);
      } catch (err: any) {
        const statusCode = err?.statusCode ?? err?.status ?? null;

        console.error("Error enviando push:", {
          subscription_id: row.id,
          user_id: row.user_id,
          statusCode,
          message: err?.message ?? String(err),
        });

        if (statusCode === 404 || statusCode === 410) {
          invalidSubscriptionIds.push(row.id);
        }
      }
    }

    if (invalidSubscriptionIds.length > 0) {
      const { error: deleteError } = await supabase
        .from("push_subscriptions")
        .delete()
        .in("id", invalidSubscriptionIds);

      if (deleteError) {
        console.error("Error eliminando suscripciones inválidas:", deleteError);
      }
    }

    if (successfulSubscriptionIds.length > 0) {
      const { error: touchError } = await supabase
        .from("push_subscriptions")
        .update({ last_used_at: new Date().toISOString() })
        .in("id", successfulSubscriptionIds);

      if (touchError) {
        console.error("Error actualizando last_used_at:", touchError);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        sent,
        removed: invalidSubscriptionIds.length,
        total: rows.length,
        filtered_by_user_ids: targetUserIds.length > 0,
        requested_user_ids: targetUserIds,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (error: any) {
    console.error("send-push-notifications fatal error:", {
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
    });

    return new Response(
      JSON.stringify({
        error: error?.message ?? "Error interno",
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});