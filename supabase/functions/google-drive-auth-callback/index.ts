import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

function bytesFromBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

type StatePayload = {
  sub: string;
  exp: number;
  iat: number;
};

async function verifyState(state: string, secret: string): Promise<StatePayload> {
  const [payloadB64, signatureB64] = state.split(".");
  if (!payloadB64 || !signatureB64) {
    throw new Error("state inválido");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );

  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    bytesFromBase64Url(signatureB64),
    new TextEncoder().encode(payloadB64)
  );

  if (!ok) {
    throw new Error("Firma de state inválida");
  }

  const payload = JSON.parse(base64UrlDecode(payloadB64)) as StatePayload;

  if (!payload.sub || !payload.exp) {
    throw new Error("Payload state inválido");
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new Error("state expirado");
  }

  return payload;
}

async function importAesKey(secret: string): Promise<CryptoKey> {
  const secretBytes = new TextEncoder().encode(secret.padEnd(32, "0").slice(0, 32));
  return await crypto.subtle.importKey(
    "raw",
    secretBytes,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptText(plainText: string, secret: string): Promise<string> {
  const key = await importAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plainText)
  );

  const ivPart = base64UrlEncodeBytes(iv);
  const cipherPart = base64UrlEncodeBytes(new Uint8Array(cipher));
  return `${ivPart}.${cipherPart}`;
}

function redirectTo(appSiteUrl: string, status: string, email?: string): Response {
  const url = new URL(appSiteUrl);
  url.searchParams.set("google_drive", status);
  if (email) {
    url.searchParams.set("google_email", email);
  }
  return Response.redirect(url.toString(), 302);
}

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const googleRedirectUri = Deno.env.get("GOOGLE_REDIRECT_URI");
    const appSiteUrl = Deno.env.get("APP_SITE_URL");
    const cryptoSecret = Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY");

    if (
      !supabaseUrl ||
      !serviceRoleKey ||
      !googleClientId ||
      !googleClientSecret ||
      !googleRedirectUri ||
      !appSiteUrl ||
      !cryptoSecret
    ) {
      return new Response("Faltan variables de entorno", { status: 500 });
    }

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return redirectTo(appSiteUrl, "error");
    }

    if (!code || !state) {
      return redirectTo(appSiteUrl, "error");
    }

    const statePayload = await verifyState(state, cryptoSecret);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: googleClientId,
        client_secret: googleClientSecret,
        redirect_uri: googleRedirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const txt = await tokenRes.text();
      console.error("Error token exchange:", txt);
      return redirectTo(appSiteUrl, "error");
    }

    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token as string | undefined;
    const refreshToken = tokenJson.refresh_token as string | undefined;
    const expiresIn = tokenJson.expires_in as number | undefined;
    const scope = tokenJson.scope as string | undefined;

    if (!accessToken) {
      return redirectTo(appSiteUrl, "error");
    }

    const userInfoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!userInfoRes.ok) {
      const txt = await userInfoRes.text();
      console.error("Error userinfo:", txt);
      return redirectTo(appSiteUrl, "error");
    }

    const userInfo = await userInfoRes.json();
    const googleEmail = userInfo.email as string | undefined;
    const googleSub = userInfo.sub as string | undefined;

    if (!googleSub) {
      return redirectTo(appSiteUrl, "error");
    }

    const encryptedAccessToken = await encryptText(accessToken, cryptoSecret);
    const encryptedRefreshToken = refreshToken
      ? await encryptText(refreshToken, cryptoSecret)
      : null;

    const tokenExpiry = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null;

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { error: upsertErr } = await admin
      .from("google_drive_connections")
      .upsert(
        {
          user_id: statePayload.sub,
          google_email: googleEmail ?? null,
          google_sub: googleSub,
          encrypted_access_token: encryptedAccessToken,
          encrypted_refresh_token: encryptedRefreshToken,
          token_expiry: tokenExpiry,
          scope: scope ?? null,
          connected_at: new Date().toISOString(),
          last_token_refresh_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (upsertErr) {
      console.error("Error guardando conexión:", upsertErr.message);
      return redirectTo(appSiteUrl, "error");
    }

    return redirectTo(appSiteUrl, "connected", googleEmail);
  } catch (e) {
    console.error("google-drive-auth-callback error:", e);
    const appSiteUrl = Deno.env.get("APP_SITE_URL") ?? "http://localhost:5173";
    return Response.redirect(`${appSiteUrl}?google_drive=error`, 302);
  }
});