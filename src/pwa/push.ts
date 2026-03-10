import { supabase } from "../lib/supabaseClient";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) {
    throw new Error("Este navegador no soporta notificaciones.");
  }

  return Notification.requestPermission();
}

export async function subscribeToPush(userId: string): Promise<PushSubscription | null> {
  if (!window.isSecureContext) {
    throw new Error("La app debe abrirse en un contexto seguro (HTTPS).");
  }

  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    (navigator as any).standalone === true;

  if (!("serviceWorker" in navigator)) {
    throw new Error("Este contexto no expone service workers.");
  }

  if (!("PushManager" in window)) {
    throw new Error("Este dispositivo o esta instalación no soporta push web.");
  }

  if (!isStandalone && /iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    throw new Error("En iPhone/iPad debes abrir la app desde el icono instalado en la pantalla de inicio.");
  }

  const permission = await requestNotificationPermission();
  if (permission !== "granted") {
    return null;
  }

  const registration = await navigator.serviceWorker.ready;

  const existingSubscription = await registration.pushManager.getSubscription();
  if (existingSubscription) {
    await saveSubscriptionToSupabase(userId, existingSubscription);
    return existingSubscription;
  }

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    throw new Error("Falta VITE_VAPID_PUBLIC_KEY en el frontend.");
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  await saveSubscriptionToSupabase(userId, subscription);
  return subscription;
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();

  if (!subscription) return;

  const endpoint = subscription.endpoint;

  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint);

  if (error) {
    throw error;
  }

  await subscription.unsubscribe();
}

async function saveSubscriptionToSupabase(
  userId: string,
  subscription: PushSubscription
): Promise<void> {
  const json = subscription.toJSON();

  const endpoint = subscription.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;

  if (!endpoint || !p256dh || !auth) {
    throw new Error("La suscripción push no contiene las claves necesarias.");
  }

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        user_id: userId,
        endpoint,
        p256dh,
        auth,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" }
    );

  if (error) {
    throw error;
  }
}