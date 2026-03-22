import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FOLDER_MIME = "application/vnd.google-apps.folder";

type DriveTokenRow = {
  user_id: string;
  google_sub: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  token_expiry: string | null;
};

type DriveSyncStateRow = {
  user_id: string;
  google_sub: string;
  root_folder_id: string;
  start_page_token: string | null;
  last_processed_page_token: string | null;
  sync_status: "idle" | "indexing" | "syncing" | "error";
  last_error: string | null;
};

type DriveItem = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string | null;
  iconLink?: string | null;
  thumbnailLink?: string | null;
  webViewLink?: string | null;
  size?: string | null;
  driveId?: string | null;
  trashed?: boolean;
  parents?: string[];
  owners?: Array<{
    displayName?: string;
    emailAddress?: string;
  }>;
  capabilities?: {
    canEdit?: boolean;
    canRename?: boolean;
    canTrash?: boolean;
    canDownload?: boolean;
    canAddChildren?: boolean;
  };
};

type DriveChange = {
  fileId: string;
  removed?: boolean;
  file?: DriveItem;
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

function normalizeName(input: string): string {
  return input.trim().toLowerCase();
}

function toNullableTimestamp(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toNullableBigInt(value?: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function fetchDriveFile(accessToken: string, fileId: string): Promise<DriveItem | null> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set(
    "fields",
    "id,name,mimeType,modifiedTime,iconLink,thumbnailLink,webViewLink,size,driveId,trashed,parents,owners(displayName,emailAddress),capabilities(canEdit,canRename,canTrash,canDownload,canAddChildren)"
  );
  url.searchParams.set("supportsAllDrives", "true");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 404 || res.status === 403) {
    return null;
  }

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(json?.error?.message ?? "No se pudo leer el archivo en Google Drive.");
  }

  return json as DriveItem;
}

async function fetchFolderPath(admin: ReturnType<typeof createClient>, userId: string, parentId: string | null) {
  if (!parentId) {
    return { path: "", pathIds: [] as string[] };
  }

  const { data, error } = await admin
    .from("drive_index_items")
    .select("path, path_ids")
    .eq("user_id", userId)
    .eq("file_id", parentId)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo resolver la ruta del padre: ${error.message}`);
  }

  return {
    path: data?.path ?? "",
    pathIds: (data?.path_ids ?? []) as string[],
  };
}

async function listChanges(accessToken: string, pageToken: string) {
  const url = new URL("https://www.googleapis.com/drive/v3/changes");
  url.searchParams.set("pageToken", pageToken);
  url.searchParams.set("pageSize", "100");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeRemoved", "true");
  url.searchParams.set(
    "fields",
    "changes(fileId,removed,file(id,name,mimeType,modifiedTime,iconLink,thumbnailLink,webViewLink,size,driveId,trashed,parents,owners(displayName,emailAddress),capabilities(canEdit,canRename,canTrash,canDownload,canAddChildren))),nextPageToken,newStartPageToken"
  );

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(json?.error?.message ?? "No se pudieron listar los cambios de Google Drive.");
  }

  return {
    changes: (json?.changes ?? []) as DriveChange[],
    nextPageToken: (json?.nextPageToken ?? null) as string | null,
    newStartPageToken: (json?.newStartPageToken ?? null) as string | null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let userIdForErrorUpdate: string | null = null;
  let adminForErrorUpdate: ReturnType<typeof createClient> | null = null;

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
      userIdForErrorUpdate = userId;
    } catch (err: any) {
      return new Response(JSON.stringify({ error: err?.message ?? "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    adminForErrorUpdate = admin;

    const { data: connectionRow, error: connectionErr } = await admin
      .from("google_drive_connections")
      .select("user_id, google_sub, encrypted_access_token, encrypted_refresh_token, token_expiry")
      .eq("user_id", userId)
      .maybeSingle();

    if (connectionErr) {
      throw new Error(connectionErr.message);
    }

    if (!connectionRow) {
      return new Response(JSON.stringify({ error: "No hay cuenta Google vinculada." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const connection = connectionRow as DriveTokenRow;

    const { data: stateRow, error: stateErr } = await admin
      .from("drive_sync_state")
      .select("user_id, google_sub, root_folder_id, start_page_token, last_processed_page_token, sync_status, last_error")
      .eq("user_id", userId)
      .maybeSingle();

    if (stateErr) {
      throw new Error(`No se pudo leer drive_sync_state: ${stateErr.message}`);
    }

    if (!stateRow || !stateRow.last_processed_page_token) {
      return new Response(JSON.stringify({ error: "No hay estado de sincronización inicializado. Ejecuta primero la indexación inicial." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const syncState = stateRow as DriveSyncStateRow;

    await admin
      .from("drive_sync_state")
      .update({
        sync_status: "syncing",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    let accessToken = await decryptText(connection.encrypted_access_token, cryptoSecret);
    const tokenExpiryMs = connection.token_expiry ? new Date(connection.token_expiry).getTime() : 0;

    if (tokenExpiryMs && tokenExpiryMs <= Date.now() + 60_000) {
      if (!connection.encrypted_refresh_token) {
        throw new Error("No hay refresh token para renovar la sesión de Google.");
      }

      const refreshToken = await decryptText(connection.encrypted_refresh_token, cryptoSecret);
      const refreshed = await refreshGoogleAccessToken({
        refreshToken,
        googleClientId,
        googleClientSecret,
      });

      if (!refreshed.access_token) {
        throw new Error("No se pudo renovar el token de Google.");
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

    let pageToken = syncState.last_processed_page_token!;
    let totalChanges = 0;
    let appliedChanges = 0;
    let nextPageToken: string | null = null;
    let newStartPageToken: string | null = null;

    do {
      const page = await listChanges(accessToken, pageToken);
      totalChanges += page.changes.length;

      for (const change of page.changes) {
        const fileId = change.fileId;
        if (!fileId) continue;

        if (change.removed) {
          await admin
            .from("drive_index_items")
            .update({
              trashed: true,
              indexed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId)
            .eq("file_id", fileId);

          appliedChanges += 1;
          continue;
        }

        let file = change.file ?? null;

        if (!file) {
          file = await fetchDriveFile(accessToken, fileId);
        }

        if (!file) {
          await admin
            .from("drive_index_items")
            .update({
              trashed: true,
              indexed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("user_id", userId)
            .eq("file_id", fileId);

          appliedChanges += 1;
          continue;
        }

        const parentId = file.parents?.[0] ?? null;
        const parentPathInfo = await fetchFolderPath(admin, userId, parentId);
        const fullPath = parentPathInfo.path ? `${parentPathInfo.path} / ${file.name}` : file.name;
        const fullPathIds = [...parentPathInfo.pathIds, file.id];
        const isFolder = file.mimeType === FOLDER_MIME;

        const row = {
          user_id: userId,
          google_sub: connection.google_sub,
          file_id: file.id,
          parent_id: parentId,
          root_folder_id: syncState.root_folder_id,
          name: file.name ?? "(sin nombre)",
          name_normalized: normalizeName(file.name ?? "(sin nombre)"),
          mime_type: file.mimeType,
          path: fullPath,
          path_ids: fullPathIds,
          web_view_link: file.webViewLink ?? null,
          icon_link: file.iconLink ?? null,
          thumbnail_link: file.thumbnailLink ?? null,
          size_bytes: toNullableBigInt(file.size ?? null),
          modified_time: toNullableTimestamp(file.modifiedTime ?? null),
          trashed: !!file.trashed,
          is_folder: isFolder,
          owner_display_name: file.owners?.[0]?.displayName ?? null,
          owner_email: file.owners?.[0]?.emailAddress ?? null,
          can_edit: file.capabilities?.canEdit ?? null,
          can_rename: file.capabilities?.canRename ?? null,
          can_trash: file.capabilities?.canTrash ?? null,
          can_download: file.capabilities?.canDownload ?? null,
          can_add_children: file.capabilities?.canAddChildren ?? null,
          drive_id: file.driveId ?? null,
          source_updated_at: toNullableTimestamp(file.modifiedTime ?? null),
          indexed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { error: upsertErr } = await admin
          .from("drive_index_items")
          .upsert(row, { onConflict: "user_id,file_id" });

        if (upsertErr) {
          throw new Error(`No se pudo aplicar cambio al índice: ${upsertErr.message}`);
        }

        appliedChanges += 1;
      }

      nextPageToken = page.nextPageToken;
      newStartPageToken = page.newStartPageToken;

      if (nextPageToken) {
        pageToken = nextPageToken;
      }
    } while (nextPageToken);

    const finalToken = newStartPageToken ?? pageToken;

    await admin
      .from("drive_sync_state")
      .update({
        last_processed_page_token: finalToken,
        last_incremental_sync_at: new Date().toISOString(),
        sync_status: "idle",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);

    return new Response(
      JSON.stringify({
        ok: true,
        totalChanges,
        appliedChanges,
        newToken: finalToken,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e: any) {
    try {
      if (adminForErrorUpdate && userIdForErrorUpdate) {
        await adminForErrorUpdate
          .from("drive_sync_state")
          .update({
            sync_status: "error",
            last_error: String(e),
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userIdForErrorUpdate);
      }
    } catch {
      // no-op
    }

    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});