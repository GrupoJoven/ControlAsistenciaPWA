import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DriveTokenRow = {
  user_id: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  token_expiry: string | null;
};

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

async function decryptText(cipherText: string, secret: string): Promise<string> {
  const [ivPart, cipherPart] = cipherText.split(".");
  if (!ivPart || !cipherPart) {
    throw new Error("Formato de texto cifrado inválido");
  }

  const key = await importAesKey(secret);
  const iv = bytesFromBase64Url(ivPart);
  const cipherBytes = bytesFromBase64Url(cipherPart);

  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    cipherBytes
  );

  return new TextDecoder().decode(plainBuffer);
}

async function encryptText(plainText: string, secret: string): Promise<string> {
  const key = await importAesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plainText)
  );

  return `${base64UrlEncodeBytes(iv)}.${base64UrlEncodeBytes(new Uint8Array(cipher))}`;
}

async function refreshGoogleAccessToken(args: {
  refreshToken: string;
  googleClientId: string;
  googleClientSecret: string;
}) {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: args.googleClientId,
      client_secret: args.googleClientSecret,
      refresh_token: args.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!tokenRes.ok) {
    const txt = await tokenRes.text();
    throw new Error(`Error refrescando token de Google: ${txt}`);
  }

  return await tokenRes.json();
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
    const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const cryptoSecret = Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY");

    if (!supabaseUrl || !serviceRoleKey || !googleClientId || !googleClientSecret || !cryptoSecret) {
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

    const body = await req.json().catch(() => null);
    const fileId = typeof body?.fileId === "string" ? body.fileId.trim() : "";
    const newName = typeof body?.newName === "string" ? body.newName.trim() : "";

    if (!fileId) {
      return new Response(JSON.stringify({ error: "Falta fileId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!newName) {
      return new Response(JSON.stringify({ error: "El nuevo nombre no puede estar vacío" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: row, error: rowErr } = await admin
      .from("google_drive_connections")
      .select("user_id, encrypted_access_token, encrypted_refresh_token, token_expiry")
      .eq("user_id", userId)
      .maybeSingle();

    if (rowErr) {
      return new Response(JSON.stringify({ error: rowErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!row) {
      return new Response(JSON.stringify({ error: "No hay cuenta Google vinculada." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const connection = row as DriveTokenRow;

    let accessToken = await decryptText(connection.encrypted_access_token, cryptoSecret);
    const tokenExpiryMs = connection.token_expiry ? new Date(connection.token_expiry).getTime() : 0;

    if (tokenExpiryMs && tokenExpiryMs <= Date.now() + 60_000) {
      if (!connection.encrypted_refresh_token) {
        return new Response(
          JSON.stringify({ error: "No hay refresh token para renovar la sesión de Google." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const refreshToken = await decryptText(connection.encrypted_refresh_token, cryptoSecret);
      const refreshed = await refreshGoogleAccessToken({
        refreshToken,
        googleClientId,
        googleClientSecret,
      });

      if (!refreshed.access_token) {
        return new Response(JSON.stringify({ error: "No se pudo renovar el token de Google." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      accessToken = refreshed.access_token as string;
      const newEncryptedAccessToken = await encryptText(accessToken, cryptoSecret);
      const newTokenExpiry = refreshed.expires_in
        ? new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString()
        : null;

      await admin
        .from("google_drive_connections")
        .update({
          encrypted_access_token: newEncryptedAccessToken,
          token_expiry: newTokenExpiry,
          last_token_refresh_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
    }

    const driveRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,name,mimeType,modifiedTime,webViewLink,capabilities(canRename)`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: newName }),
      }
    );

    const driveJson = await driveRes.json().catch(() => null);

    if (!driveRes.ok) {
      return new Response(
        JSON.stringify({
          error: driveJson?.error?.message ?? "Google Drive rechazó el renombrado",
        }),
        {
          status: driveRes.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ item: driveJson }), {
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