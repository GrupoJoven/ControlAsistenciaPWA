import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push";

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
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;

webpush.setVapidDetails(
  "mailto:no-reply@sanpas.es",
  vapidPublicKey,
  vapidPrivateKey
);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: corsHeaders,
      }
    );
  }

  try {
    const body = (await req.json()) as RequestBody;

    if (!body?.title || !body?.body) {
      return new Response(
        JSON.stringify({ error: "Faltan title o body" }),
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: subscriptions, error } = await supabase
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth");

    if (error) throw error;

    const rows = (subscriptions ?? []) as PushRow[];

    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, removed: 0, total: 0 }),
        {
          status: 200,
          headers: corsHeaders,
        }
      );
    }

    const payload = JSON.stringify({
      title: body.title,
      body: body.body,
      url: body.url ?? "/",
      icon: "/icons/icon-192.png",
    });

    let sent = 0;
    let removed = 0;

    for (const row of rows) {
      const subscription = {
        endpoint: row.endpoint,
        keys: {
          p256dh: row.p256dh,
          auth: row.auth,
        },
      };

      try {
        await webpush.sendNotification(subscription, payload);
        sent += 1;

        await supabase
          .from("push_subscriptions")
          .update({ last_used_at: new Date().toISOString() })
          .eq("id", row.id);
      } catch (err: any) {
        const statusCode = err?.statusCode;

        if (statusCode === 404 || statusCode === 410) {
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("id", row.id);
          removed += 1;
        } else {
          console.error("Error enviando push a", row.id, err);
        }
      }
    }

    return new Response(
      JSON.stringify({
        sent,
        removed,
        total: rows.length,
      }),
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error: any) {
    console.error(error);

    return new Response(
      JSON.stringify({
        error: error?.message ?? "Error interno",
      }),
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
});