
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DriveTokenRow = {
  user_id: string;
  google_email: string | null;
  google_sub: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  token_expiry: string | null;
  scope: string | null;
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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const cryptoSecret = Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY");
    const rootFolderId = Deno.env.get("GOOGLE_DRIVE_ROOT_FOLDER_ID");

    if (
      !supabaseUrl ||
      !anonKey ||
      !serviceRoleKey ||
      !googleClientId ||
      !googleClientSecret ||
      !cryptoSecret ||
      !rootFolderId
    ) {
      return new Response(JSON.stringify({ error: "Faltan variables de entorno" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { data: row, error: rowErr } = await admin
      .from("google_drive_connections")
      .select(
        "user_id, google_email, google_sub, encrypted_access_token, encrypted_refresh_token, token_expiry, scope"
      )
      .eq("user_id", userData.user.id)
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
    let tokenExpiryMs = connection.token_expiry ? new Date(connection.token_expiry).getTime() : 0;
    const now = Date.now();

    if (tokenExpiryMs && tokenExpiryMs <= now + 60_000) {
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

      const { error: updateErr } = await admin
        .from("google_drive_connections")
        .update({
          encrypted_access_token: newEncryptedAccessToken,
          token_expiry: newTokenExpiry,
          last_token_refresh_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userData.user.id);

      if (updateErr) {
        console.error("No se pudo guardar el access token renovado:", updateErr.message);
      }
    }

    const body = await req.json().catch(() => ({}));
    const folderId = typeof body?.folderId === "string" && body.folderId.trim()
      ? body.folderId.trim()
      : rootFolderId;

    const q = `'${folderId}' in parents and trashed = false`;

    const driveUrl = new URL("https://www.googleapis.com/drive/v3/files");
    driveUrl.searchParams.set("q", q);
    driveUrl.searchParams.set(
      "fields",
      "files(id,name,mimeType,modifiedTime,iconLink,thumbnailLink,webViewLink,size,owners(displayName,emailAddress),capabilities(canEdit,canRename,canTrash,canDownload,canAddChildren)),nextPageToken"
    );
    driveUrl.searchParams.set("orderBy", "folder,name_natural");
    driveUrl.searchParams.set("pageSize", "100");
    driveUrl.searchParams.set("includeItemsFromAllDrives", "true");
    driveUrl.searchParams.set("supportsAllDrives", "true");

    const driveRes = await fetch(driveUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!driveRes.ok) {
      const txt = await driveRes.text();
      return new Response(JSON.stringify({ error: `Google Drive API: ${txt}` }), {
        status: driveRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const driveJson = await driveRes.json();

    return new Response(
      JSON.stringify({
        files: driveJson.files ?? [],
        nextPageToken: driveJson.nextPageToken ?? null,
        folderId,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e) {
    console.error("google-drive-list-files error:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});