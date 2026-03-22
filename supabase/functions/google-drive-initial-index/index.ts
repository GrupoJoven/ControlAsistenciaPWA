import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const FOLDER_MIME = "application/vnd.google-apps.folder";
const FOLDERS_PER_RUN = 20;
const UPSERT_BATCH_SIZE = 200;

type DriveTokenRow = {
  user_id: string;
  google_sub: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  token_expiry: string | null;
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

type QueueNode = {
  folderId: string;
  path: string;
  pathIds: string[];
};

type DriveSyncStateRow = {
  user_id: string;
  google_sub: string;
  root_folder_id: string;
  start_page_token: string | null;
  last_processed_page_token: string | null;
  last_full_index_at: string | null;
  last_incremental_sync_at: string | null;
  sync_status: "idle" | "indexing" | "syncing" | "error";
  last_error: string | null;
  pending_queue: QueueNode[] | null;
  visited_folder_ids: string[] | null;
  indexed_count: number | null;
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

async function getStartPageToken(accessToken: string): Promise<string> {
  const url = new URL("https://www.googleapis.com/drive/v3/changes/startPageToken");
  url.searchParams.set("supportsAllDrives", "true");

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const json = await res.json().catch(() => null);

  if (!res.ok || !json?.startPageToken) {
    throw new Error(json?.error?.message ?? "No se pudo obtener startPageToken de Google Drive.");
  }

  return json.startPageToken as string;
}

async function listFolderChildren(accessToken: string, folderId: string): Promise<DriveItem[]> {
  const q = `'${folderId}' in parents and trashed = false`;
  let pageToken: string | null = null;
  const allFiles: DriveItem[] = [];

  do {
    const driveUrl = new URL("https://www.googleapis.com/drive/v3/files");
    driveUrl.searchParams.set("q", q);
    driveUrl.searchParams.set(
      "fields",
      "files(id,name,mimeType,modifiedTime,iconLink,thumbnailLink,webViewLink,size,driveId,trashed,owners(displayName,emailAddress),capabilities(canEdit,canRename,canTrash,canDownload,canAddChildren)),nextPageToken"
    );
    driveUrl.searchParams.set("orderBy", "folder,name_natural");
    driveUrl.searchParams.set("pageSize", "100");
    driveUrl.searchParams.set("includeItemsFromAllDrives", "true");
    driveUrl.searchParams.set("supportsAllDrives", "true");

    if (pageToken) {
      driveUrl.searchParams.set("pageToken", pageToken);
    }

    const res = await fetch(driveUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      throw new Error(json?.error?.message ?? "Error listando hijos de carpeta en Google Drive.");
    }

    allFiles.push(...((json?.files ?? []) as DriveItem[]));
    pageToken = (json?.nextPageToken ?? null) as string | null;
  } while (pageToken);

  return allFiles;
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

async function upsertBatch(admin: ReturnType<typeof createClient>, rows: any[]) {
  if (rows.length === 0) return;

  const { error } = await admin
    .from("drive_index_items")
    .upsert(rows, { onConflict: "user_id,file_id" });

  if (error) {
    throw new Error(`Error haciendo upsert del índice: ${error.message}`);
  }
}

function safeQueue(value: QueueNode[] | null | undefined, rootFolderId: string): QueueNode[] {
  if (Array.isArray(value) && value.length > 0) return value;
  return [{ folderId: rootFolderId, path: "", pathIds: [rootFolderId] }];
}

function safeVisited(value: string[] | null | undefined): string[] {
  return Array.isArray(value) ? value : [];
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
    const rootFolderId = Deno.env.get("GOOGLE_DRIVE_ROOT_FOLDER_ID");

    if (!supabaseUrl || !serviceRoleKey || !googleClientId || !googleClientSecret || !cryptoSecret || !rootFolderId) {
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

    const body = await req.json().catch(() => ({}));
    const reset = !!body?.reset;

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
      return new Response(JSON.stringify({ error: connectionErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!connectionRow) {
      return new Response(JSON.stringify({ error: "No hay cuenta Google vinculada." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const connection = connectionRow as DriveTokenRow;

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

    const { data: existingStateRow, error: stateReadErr } = await admin
      .from("drive_sync_state")
      .select(`
        user_id,
        google_sub,
        root_folder_id,
        start_page_token,
        last_processed_page_token,
        last_full_index_at,
        last_incremental_sync_at,
        sync_status,
        last_error,
        pending_queue,
        visited_folder_ids,
        indexed_count
      `)
      .eq("user_id", userId)
      .maybeSingle();

    if (stateReadErr) {
      throw new Error(`No se pudo leer drive_sync_state: ${stateReadErr.message}`);
    }

    let state = existingStateRow as DriveSyncStateRow | null;

    const shouldInitialize =
      reset ||
      !state ||
      !Array.isArray(state.pending_queue) ||
      state.sync_status === "error";

    if (shouldInitialize) {
      const { error: deleteErr } = await admin
        .from("drive_index_items")
        .delete()
        .eq("user_id", userId)
        .eq("root_folder_id", rootFolderId);

      if (deleteErr) {
        throw new Error(`No se pudo limpiar el índice previo: ${deleteErr.message}`);
      }

      const initializedState = {
        user_id: userId,
        google_sub: connection.google_sub,
        root_folder_id: rootFolderId,
        start_page_token: null,
        last_processed_page_token: null,
        last_full_index_at: null,
        last_incremental_sync_at: null,
        sync_status: "indexing",
        last_error: null,
        pending_queue: [{ folderId: rootFolderId, path: "", pathIds: [rootFolderId] }],
        visited_folder_ids: [] as string[],
        indexed_count: 0,
        updated_at: new Date().toISOString(),
      };

      const { error: initErr } = await admin
        .from("drive_sync_state")
        .upsert(initializedState, { onConflict: "user_id" });

      if (initErr) {
        throw new Error(`No se pudo inicializar drive_sync_state: ${initErr.message}`);
      }

      state = {
        ...initializedState,
        created_at: new Date().toISOString(),
      } as unknown as DriveSyncStateRow;
    }

    let pendingQueue = safeQueue(state?.pending_queue, rootFolderId);
    const visitedSet = new Set<string>(safeVisited(state?.visited_folder_ids));
    let indexedCount = state?.indexed_count ?? 0;

    const foldersThisRun = pendingQueue.splice(0, FOLDERS_PER_RUN);
    const rowsBuffer: any[] = [];

    for (const current of foldersThisRun) {
      if (visitedSet.has(current.folderId)) {
        continue;
      }

      visitedSet.add(current.folderId);

      const children = await listFolderChildren(accessToken, current.folderId);

      for (const item of children) {
        const isFolder = item.mimeType === FOLDER_MIME;
        const itemPath = current.path ? `${current.path} / ${item.name}` : item.name;
        const itemPathIds = [...current.pathIds, item.id];

        rowsBuffer.push({
          user_id: userId,
          google_sub: connection.google_sub,
          file_id: item.id,
          parent_id: current.folderId,
          root_folder_id: rootFolderId,
          name: item.name ?? "(sin nombre)",
          name_normalized: normalizeName(item.name ?? "(sin nombre)"),
          mime_type: item.mimeType,
          path: itemPath,
          path_ids: itemPathIds,
          web_view_link: item.webViewLink ?? null,
          icon_link: item.iconLink ?? null,
          thumbnail_link: item.thumbnailLink ?? null,
          size_bytes: toNullableBigInt(item.size ?? null),
          modified_time: toNullableTimestamp(item.modifiedTime ?? null),
          trashed: !!item.trashed,
          is_folder: isFolder,
          owner_display_name: item.owners?.[0]?.displayName ?? null,
          owner_email: item.owners?.[0]?.emailAddress ?? null,
          can_edit: item.capabilities?.canEdit ?? null,
          can_rename: item.capabilities?.canRename ?? null,
          can_trash: item.capabilities?.canTrash ?? null,
          can_download: item.capabilities?.canDownload ?? null,
          can_add_children: item.capabilities?.canAddChildren ?? null,
          drive_id: item.driveId ?? null,
          source_updated_at: toNullableTimestamp(item.modifiedTime ?? null),
          indexed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        indexedCount += 1;

        if (rowsBuffer.length >= UPSERT_BATCH_SIZE) {
          await upsertBatch(admin, rowsBuffer.splice(0, rowsBuffer.length));
        }

        if (isFolder && !visitedSet.has(item.id)) {
          pendingQueue.push({
            folderId: item.id,
            path: itemPath,
            pathIds: itemPathIds,
          });
        }
      }
    }

    if (rowsBuffer.length > 0) {
      await upsertBatch(admin, rowsBuffer);
    }

    const isFinished = pendingQueue.length === 0;

    if (isFinished) {
      const startPageToken = await getStartPageToken(accessToken);

      const { error: finishErr } = await admin
        .from("drive_sync_state")
        .upsert(
          {
            user_id: userId,
            google_sub: connection.google_sub,
            root_folder_id: rootFolderId,
            start_page_token: startPageToken,
            last_processed_page_token: startPageToken,
            last_full_index_at: new Date().toISOString(),
            last_incremental_sync_at: null,
            sync_status: "idle",
            last_error: null,
            pending_queue: [],
            visited_folder_ids: Array.from(visitedSet),
            indexed_count: indexedCount,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

      if (finishErr) {
        throw new Error(`No se pudo cerrar drive_sync_state: ${finishErr.message}`);
      }

      return new Response(
        JSON.stringify({
          ok: true,
          done: true,
          indexedCount,
          remainingFolders: 0,
          processedFoldersThisRun: foldersThisRun.length,
          startPageToken,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { error: progressErr } = await admin
      .from("drive_sync_state")
      .upsert(
        {
          user_id: userId,
          google_sub: connection.google_sub,
          root_folder_id: rootFolderId,
          sync_status: "indexing",
          last_error: null,
          pending_queue: pendingQueue,
          visited_folder_ids: Array.from(visitedSet),
          indexed_count: indexedCount,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (progressErr) {
      throw new Error(`No se pudo guardar el progreso de indexación: ${progressErr.message}`);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        done: false,
        indexedCount,
        remainingFolders: pendingQueue.length,
        processedFoldersThisRun: foldersThisRun.length,
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