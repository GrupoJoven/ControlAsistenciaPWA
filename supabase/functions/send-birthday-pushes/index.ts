import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

type BirthdayTarget = {
  notification_day: string;
  recipient_id: string;
  recipient_role: "catechist" | "coordinator";
  notification_kind:
    | "student_birthdays_my_groups"
    | "student_birthdays_other_groups"
    | "team_birthdays";
  priority: number;
  birthday_count: number;
};

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
const cronSecret = Deno.env.get("CRON_SECRET") ?? "";

if (!supabaseUrl) throw new Error("Falta SUPABASE_URL");
if (!serviceRoleKey) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY");
if (!vapidPublicKey) throw new Error("Falta VAPID_PUBLIC_KEY");
if (!vapidPrivateKey) throw new Error("Falta VAPID_PRIVATE_KEY");

webpush.setVapidDetails(
  "mailto:no-reply@sanpas.es",
  vapidPublicKey,
  vapidPrivateKey
);


const supabase = createClient(supabaseUrl, serviceRoleKey);

function buildNotification(
  kind: BirthdayTarget["notification_kind"],
  count: number,
) {
  if (kind === "student_birthdays_my_groups") {
    return {
      title: "Cumpleaños de hoy",
      body:
        count === 1
          ? "Hoy cumple años 1 niño/a de tu grupo. Accede para saber quién."
          : `Hoy cumplen años ${count} niños/as de tus grupos. Accede para saber quiénes.`,
      url: "/",
    };
  }

  if (kind === "student_birthdays_other_groups") {
    return {
      title: "Cumpleaños de hoy",
      body:
        count === 1
          ? "Hoy cumple años 1 niño/a en otros grupos. Accede para saber quién."
          : `Hoy cumplen años ${count} niños/as en otros grupos. Accede para saber quiénes.`,
      url: "/",
    };
  }

  return {
    title: "Cumpleaños del equipo",
    body:
      count === 1
        ? "Hoy cumple años 1 CATEQUSITA. Accede para saber quién."
        : `Hoy cumplen años ${count} CATEQUISTAS. Accede para saber quiénes.`,
    url: "/",
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { "Content-Type": "application/json" } },
      );
    }

    if (cronSecret) {
      const receivedSecret = req.headers.get("x-cron-secret") ?? "";
      if (receivedSecret !== cronSecret) {
        return new Response(
          JSON.stringify({ error: "Unauthorized" }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    let requestedDay: string | null = null;

    try {
      const body = await req.json();
      requestedDay = body?.day ?? null;
    } catch {
      requestedDay = null;
    }

    const rpcArgs = requestedDay ? { p_day: requestedDay } : {};

    const { data: targets, error: targetsError } = await supabase.rpc(
      "get_birthday_push_targets",
      rpcArgs,
    );

    if (targetsError) {
      throw new Error(
        `Error obteniendo targets: ${targetsError.message}`,
      );
    }

    const rows = (targets ?? []) as BirthdayTarget[];

    let processedTargets = 0;
    let sentTargets = 0;
    let skippedAlreadyLogged = 0;
    let skippedNoSubscriptions = 0;
    let failedTargets = 0;
    let totalNotificationsSent = 0;

    for (const target of rows) {
      processedTargets++;

      const {
        notification_day,
        recipient_id,
        notification_kind,
        birthday_count,
      } = target;

      const { data: alreadyLogged, error: logCheckError } = await supabase
        .from("birthday_push_log")
        .select("id")
        .eq("notification_day", notification_day)
        .eq("recipient_id", recipient_id)
        .eq("notification_kind", notification_kind)
        .maybeSingle();

      if (logCheckError) {
        failedTargets++;
        console.error("Error comprobando log:", logCheckError);
        continue;
      }

      if (alreadyLogged) {
        skippedAlreadyLogged++;
        continue;
      }

      const { data: subscriptions, error: subsError } = await supabase
        .from("push_subscriptions")
        .select("id, user_id, endpoint, p256dh, auth")
        .eq("user_id", recipient_id);

      if (subsError) {
        failedTargets++;
        console.error("Error cargando suscripciones:", subsError);
        continue;
      }

      const subs = (subscriptions ?? []) as PushSubscriptionRow[];

      if (subs.length === 0) {
        skippedNoSubscriptions++;
        continue;
      }

      const payload = JSON.stringify(
        buildNotification(notification_kind, birthday_count),
      );

      const invalidSubscriptionIds: string[] = [];
      const successfulSubscriptionIds: string[] = [];
      let successCount = 0;

      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            payload,
          );

          successCount++;
          totalNotificationsSent++;
          successfulSubscriptionIds.push(sub.id);
        } catch (err: any) {
          const statusCode = err?.statusCode ?? err?.status ?? null;

          console.error("Error enviando push:", {
            recipient_id,
            notification_kind,
            subscription_id: sub.id,
            statusCode,
            message: err?.message ?? String(err),
          });

          if (statusCode === 404 || statusCode === 410) {
            invalidSubscriptionIds.push(sub.id);
          }
        }
      }

      if (invalidSubscriptionIds.length > 0) {
        const { error: deleteInvalidError } = await supabase
          .from("push_subscriptions")
          .delete()
          .in("id", invalidSubscriptionIds);

        if (deleteInvalidError) {
          console.error(
            "Error eliminando suscripciones inválidas:",
            deleteInvalidError,
          );
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

      if (successCount === 0) {
        failedTargets++;
        continue;
      }

      const { error: insertLogError } = await supabase
        .from("birthday_push_log")
        .upsert(
          {
            notification_day,
            recipient_id,
            notification_kind,
            birthday_count,
          },
          {
            onConflict: "notification_day,recipient_id,notification_kind",
            ignoreDuplicates: true,
          },
        );

      if (insertLogError) {
        failedTargets++;
        console.error("Error insertando log:", insertLogError);
        continue;
      }

      sentTargets++;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        requested_day: requestedDay,
        processed_targets: processedTargets,
        sent_targets: sentTargets,
        skipped_already_logged: skippedAlreadyLogged,
        skipped_no_subscriptions: skippedNoSubscriptions,
        failed_targets: failedTargets,
        total_notifications_sent: totalNotificationsSent,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err: any) {
    console.error("Fatal error:", err);

    return new Response(
      JSON.stringify({
        ok: false,
        error: err?.message ?? String(err),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});