import { supabase } from "./supabaseClient";

export type GoogleDriveConnection = {
  user_id: string;
  google_email: string | null;
  google_sub: string;
  connected_at: string;
  updated_at: string;
};

export type DriveItem = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  iconLink?: string | null;
  thumbnailLink?: string | null;
  webViewLink?: string | null;
  size?: string | null;
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

export async function getGoogleDriveConnection() {
  const { data, error } = await supabase
    .from("google_drive_connections")
    .select("user_id, google_email, google_sub, connected_at, updated_at")
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as GoogleDriveConnection | null;
}

export async function startGoogleDriveOAuth() {
  const { data, error } = await supabase.functions.invoke("google-drive-auth-start", {
    body: {},
  });

  if (error) {
    throw new Error(error.message || "No se pudo iniciar la vinculación con Google Drive.");
  }

  if (!data?.url) {
    throw new Error("La función no devolvió una URL de autorización.");
  }

  return data.url as string;
}

export async function listGoogleDriveFiles(folderId?: string) {
  const { data, error } = await supabase.functions.invoke("google-drive-list-files", {
    body: { folderId },
  });

  if (error) {
    throw new Error(error.message || "No se pudo listar el contenido de Google Drive.");
  }

  return {
    files: (data?.files ?? []) as DriveItem[],
    folderId: data?.folderId as string,
    nextPageToken: (data?.nextPageToken ?? null) as string | null,
  };
}

export async function renameGoogleDriveItem(fileId: string, newName: string) {
  const { data, error } = await supabase.functions.invoke("google-drive-rename-item", {
    body: { fileId, newName },
  });

  if (error) {
    throw new Error(error.message || "No se pudo renombrar el elemento.");
  }

  return data?.item as Partial<DriveItem> | undefined;
}

export async function uploadGoogleDriveFile(file: File, folderId?: string | null) {
  const formData = new FormData();
  formData.append("file", file);

  if (folderId) {
    formData.append("folderId", folderId);
  }

  const { data, error } = await supabase.functions.invoke("google-drive-upload-file", {
    body: formData,
  });

  if (error) {
    throw new Error(error.message || "No se pudo subir el archivo.");
  }

  return data?.item as Partial<DriveItem> | undefined;
}

export async function createGoogleDriveFolder(name: string, folderId?: string | null) {
  const { data, error } = await supabase.functions.invoke("google-drive-create-folder", {
    body: { name, folderId },
  });

  if (error) {
    throw new Error(error.message || "No se pudo crear la carpeta.");
  }

  return data?.item as Partial<DriveItem> | undefined;
}

export type RecursiveDriveSearchResult = DriveItem & {
  path: string;
  parentFolderId: string;
};

export async function searchGoogleDriveRecursive(search: string, folderId?: string | null) {
  const { data, error } = await supabase.functions.invoke("google-drive-search-recursive", {
    body: { search, folderId },
  });

  if (error) {
    throw new Error(error.message || "No se pudo realizar la búsqueda en Google Drive.");
  }

  return {
    results: (data?.results ?? []) as RecursiveDriveSearchResult[],
    startFolderId: data?.startFolderId as string,
  };
}

export async function runGoogleDriveInitialIndex(reset = false) {
  const { data, error } = await supabase.functions.invoke("google-drive-initial-index", {
    body: { reset },
  });

  if (error) {
    throw new Error(error.message || "No se pudo ejecutar la indexación inicial.");
  }

  return data as {
    ok: boolean;
    done: boolean;
    indexedCount: number;
    remainingFolders: number;
    processedFoldersThisRun: number;
    startPageToken?: string;
  };
}

export type IndexedDriveSearchResult = {
  file_id: string;
  parent_id: string | null;
  name: string;
  mime_type: string;
  path: string;
  web_view_link?: string | null;
  icon_link?: string | null;
  thumbnail_link?: string | null;
  modified_time?: string | null;
  is_folder: boolean;
  owner_display_name?: string | null;
  owner_email?: string | null;
  can_rename?: boolean | null;
  can_download?: boolean | null;
  can_trash?: boolean | null;
  can_edit?: boolean | null;
};

export async function searchDriveIndex(query: string, onlyFolders = false, limit = 100) {
  const { data, error } = await supabase.functions.invoke("drive-index-search", {
    body: { query, onlyFolders, limit },
  });

  if (error) {
    throw new Error(error.message || "No se pudo buscar en el índice de Drive.");
  }

  return {
    results: (data?.results ?? []) as IndexedDriveSearchResult[],
    count: (data?.count ?? 0) as number,
  };
}

export async function syncGoogleDriveChanges() {
  const { data, error } = await supabase.functions.invoke("google-drive-sync-changes", {
    body: {},
  });

  if (error) {
    throw new Error(error.message || "No se pudo sincronizar Google Drive.");
  }

  return data as {
    ok: boolean;
    totalChanges: number;
    appliedChanges: number;
    newToken: string;
  };
}