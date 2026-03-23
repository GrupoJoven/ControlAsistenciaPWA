import React, { useEffect, useMemo, useState } from "react";
import {
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Folder,
  FileText,
  RefreshCw,
  Pencil,
  Upload,
  FolderPlus,
  Search,
  X,
  FileSpreadsheet,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileCode,
  FileJson,
  FileSymlink,
  File,
} from "lucide-react";
import {
  getGoogleDriveConnection,
  GoogleDriveConnection,
  startGoogleDriveOAuth,
  listGoogleDriveFiles,
  renameGoogleDriveItem,
  uploadGoogleDriveFile,
  createGoogleDriveFolder,
  searchDriveIndex,
  IndexedDriveSearchResult,
  DriveItem,
  runGoogleDriveInitialIndex,
  syncGoogleDriveChanges,
} from "../src/lib/googleDrive";

interface DriveProps {
  isOnline: boolean;
}

const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("es-ES");
}

function getFileIcon(item: DriveItem | IndexedDriveSearchResult) {
  const mimeType = "mimeType" in item ? item.mimeType : item.mime_type;

  if (mimeType === GOOGLE_FOLDER_MIME) {
    return <Folder size={18} className="text-amber-500 shrink-0" />;
  }

  if (mimeType === "application/pdf") {
    return <FileText size={18} className="text-red-500 shrink-0" />;
  }

  if (
    mimeType === "application/vnd.google-apps.document" ||
    mimeType === "application/msword" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "text/plain"
  ) {
    return <FileText size={18} className="text-blue-500 shrink-0" />;
  }

  if (
    mimeType === "application/vnd.google-apps.spreadsheet" ||
    mimeType === "application/vnd.ms-excel" ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "text/csv"
  ) {
    return <FileSpreadsheet size={18} className="text-emerald-600 shrink-0" />;
  }

  if (
    mimeType === "application/vnd.google-apps.presentation" ||
    mimeType === "application/vnd.ms-powerpoint" ||
    mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return <FileSymlink size={18} className="text-orange-500 shrink-0" />;
  }

  if (mimeType.startsWith("image/")) {
    return <FileImage size={18} className="text-pink-500 shrink-0" />;
  }

  if (mimeType.startsWith("video/")) {
    return <FileVideo size={18} className="text-violet-500 shrink-0" />;
  }

  if (mimeType.startsWith("audio/")) {
    return <FileAudio size={18} className="text-cyan-500 shrink-0" />;
  }

  if (
    mimeType === "application/zip" ||
    mimeType === "application/x-zip-compressed" ||
    mimeType === "application/x-rar-compressed" ||
    mimeType === "application/x-7z-compressed"
  ) {
    return <FileArchive size={18} className="text-yellow-600 shrink-0" />;
  }

  if (
    mimeType === "application/json" ||
    mimeType === "text/json"
  ) {
    return <FileJson size={18} className="text-slate-600 shrink-0" />;
  }

  if (
    mimeType.includes("javascript") ||
    mimeType.includes("typescript") ||
    mimeType.includes("python") ||
    mimeType.includes("html") ||
    mimeType.includes("css") ||
    mimeType.includes("xml")
  ) {
    return <FileCode size={18} className="text-indigo-500 shrink-0" />;
  }

  return <File size={18} className="text-slate-500 shrink-0" />;
}

const Drive: React.FC<DriveProps> = ({ isOnline }) => {
  const [indexingDrive, setIndexingDrive] = useState(false);

  const [connection, setConnection] = useState<GoogleDriveConnection | null>(null);
  const [loadingConnection, setLoadingConnection] = useState(true);
  const [linking, setLinking] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const [items, setItems] = useState<DriveItem[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderStack, setFolderStack] = useState<Array<{ id: string; name: string }>>([]);

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [showCreateFolderInput, setShowCreateFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const [searchText, setSearchText] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<IndexedDriveSearchResult[]>([]);
  const [searchMode, setSearchMode] = useState(false);

  const [autoSyncDone, setAutoSyncDone] = useState(false);

  const [syncingDrive, setSyncingDrive] = useState(false);

  const isConnected = useMemo(() => !!connection?.google_sub, [connection]);

  const loadConnection = async () => {
    setLoadingConnection(true);
    setConnectionError(null);

    try {
      const data = await getGoogleDriveConnection();
      setConnection(data);
    } catch (err: any) {
      console.error("Error cargando conexión de Google Drive:", err);
      setConnectionError(err?.message ?? "No se pudo comprobar la conexión con Google Drive.");
    } finally {
      setLoadingConnection(false);
    }
  };

  const loadFiles = async (folderId?: string | null) => {
    setLoadingFiles(true);
    setFilesError(null);

    try {
      const data = await listGoogleDriveFiles(folderId ?? undefined);
      setItems(data.files ?? []);
      setCurrentFolderId(data.folderId ?? null);
    } catch (err: any) {
      console.error("Error listando archivos de Google Drive:", err);
      setFilesError(err?.message ?? "No se pudo cargar el contenido de Google Drive.");
    } finally {
      setLoadingFiles(false);
    }
  };

  useEffect(() => {
    if (!isOnline) return;
    void loadConnection();
  }, [isOnline]);

  useEffect(() => {
    if (!isOnline) {
      setItems([]);
      setCurrentFolderId(null);
      setFolderStack([]);
      return;
    }
    if (isConnected) {
      setFolderStack([]);
      void loadFiles(null);
    } else {
      setItems([]);
      setCurrentFolderId(null);
      setFolderStack([]);
    }
  }, [isConnected, isOnline]);

  const handleLink = async () => {
    if (!isOnline) {
      alert("No hay conexión. No se puede vincular Google Drive ahora mismo.");
      return;
    }

    setLinking(true);
    setConnectionError(null);

    try {
      const url = await startGoogleDriveOAuth();
      window.location.href = url;
    } catch (err: any) {
      console.error("Error iniciando OAuth de Google Drive:", err);
      setConnectionError(err?.message ?? "No se pudo iniciar la vinculación con Google Drive.");
      setLinking(false);
    }
  };

  useEffect(() => {
    if (!loadingConnection && isConnected && !autoSyncDone && isOnline) {
      void handleAutoSyncDriveChanges();
    }
  }, [loadingConnection, isConnected, autoSyncDone, isOnline]);

  useEffect(() => {
    if (!isOnline) {
      setLoadingFiles(false);
      setSearching(false);
      setUploading(false);
      setCreatingFolder(false);
      setRenaming(false);
      setSyncingDrive(false);
      setIndexingDrive(false);
      setFilesError(null);
      setConnectionError(null);
    }
  }, [isOnline]);

  const handleOpenFolder = async (item: DriveItem) => {
    setFolderStack((prev) => [...prev, { id: item.id, name: item.name || "Carpeta" }]);
    await loadFiles(item.id);
  };

  const handleGoToRoot = async () => {
    setFolderStack([]);
    await loadFiles(null);
  };

  const handleGoBackOneLevel = async () => {
    if (folderStack.length === 0) {
      await loadFiles(null);
      return;
    }

    const newStack = folderStack.slice(0, -1);
    setFolderStack(newStack);

    const parent = newStack[newStack.length - 1];
    await loadFiles(parent?.id ?? null);
  };

  const handleStartRename = (item: DriveItem) => {
    setEditingItemId(item.id);
    setEditingName(item.name || "");
  };

  const handleCancelRename = () => {
    setEditingItemId(null);
    setEditingName("");
  };

  const handleConfirmRename = async (item: DriveItem) => {
    const trimmed = editingName.trim();

    if (!trimmed) {
      alert("El nombre no puede estar vacío.");
      return;
    }

    if (trimmed === (item.name || "").trim()) {
      handleCancelRename();
      return;
    }

    setRenaming(true);
    setFilesError(null);

    try {
      await renameGoogleDriveItem(item.id, trimmed);

      setItems((prev) =>
        prev.map((x) =>
          x.id === item.id
            ? {
                ...x,
                name: trimmed,
              }
            : x
        )
      );

      handleCancelRename();
    } catch (err: any) {
      console.error("Error renombrando elemento de Google Drive:", err);
      setFilesError(err?.message ?? "No se pudo renombrar el elemento.");
    } finally {
      setRenaming(false);
    }
  };

  const handleUploadFile = async (file: File | null) => {
    if (!file) return;

    setUploading(true);
    setFilesError(null);

    try {
      await uploadGoogleDriveFile(file, currentFolderId);
      await loadFiles(currentFolderId);
    } catch (err: any) {
      console.error("Error subiendo archivo a Google Drive:", err);
      setFilesError(err?.message ?? "No se pudo subir el archivo.");
    } finally {
      setUploading(false);
    }
  };

  const handleCreateFolder = async () => {
    const trimmed = newFolderName.trim();

    if (!trimmed) {
      alert("El nombre de la carpeta no puede estar vacío.");
      return;
    }

    setCreatingFolder(true);
    setFilesError(null);

    try {
      await createGoogleDriveFolder(trimmed, currentFolderId);
      setNewFolderName("");
      setShowCreateFolderInput(false);
      await loadFiles(currentFolderId);
    } catch (err: any) {
      console.error("Error creando carpeta en Google Drive:", err);
      setFilesError(err?.message ?? "No se pudo crear la carpeta.");
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleIndexedSearch = async () => {
    const trimmed = searchText.trim();

    if (!trimmed) {
      alert("Escribe un texto para buscar.");
      return;
    }

    setSearching(true);
    setFilesError(null);

    try {
      const data = await searchDriveIndex(trimmed, false, 200);
      setSearchResults(data.results ?? []);
      setSearchMode(true);
    } catch (err: any) {
      console.error("Error buscando en el índice de Drive:", err);
      setFilesError(err?.message ?? "No se pudo realizar la búsqueda.");
    } finally {
      setSearching(false);
    }
  };

  const handleClearSearch = () => {
    setSearchText("");
    setSearchResults([]);
    setSearchMode(false);
  };

  const handleRunInitialIndex = async () => {
    setIndexingDrive(true);
    setFilesError(null);

    try {
      let done = false;
      let firstRun = true;
      let lastIndexedCount = 0;

      while (!done) {
        const result = await runGoogleDriveInitialIndex(firstRun);
        done = result.done;
        firstRun = false;
        lastIndexedCount = result.indexedCount;
      }

      alert(`Indexación completada. Elementos indexados: ${lastIndexedCount}`);
    } catch (err: any) {
      console.error("Error ejecutando la indexación inicial:", err);
      setFilesError(err?.message ?? "No se pudo ejecutar la indexación inicial.");
    } finally {
      setIndexingDrive(false);
    }
  };

  const handleSyncDriveChanges = async () => {
    setSyncingDrive(true);
    setFilesError(null);

    try {
      const result = await syncGoogleDriveChanges();
      alert(
        `Sincronización completada.\nCambios detectados: ${result.totalChanges}\nCambios aplicados: ${result.appliedChanges}`
      );

      if (!searchMode) {
        await loadFiles(currentFolderId);
      }
    } catch (err: any) {
      console.error("Error sincronizando cambios de Google Drive:", err);
      setFilesError(err?.message ?? "No se pudo sincronizar Google Drive.");
    } finally {
      setSyncingDrive(false);
    }
  };

  const handleAutoSyncDriveChanges = async () => {
    if (syncingDrive || autoSyncDone || !isOnline) return;

    setSyncingDrive(true);
    setFilesError(null);

    try {
      await syncGoogleDriveChanges();

      if (!searchMode) {
        await loadFiles(currentFolderId);
      }
    } catch (err: any) {
      console.error("Error en la sincronización automática de Google Drive:", err);
      setFilesError(err?.message ?? "No se pudo sincronizar Google Drive.");
    } finally {
      setSyncingDrive(false);
      setAutoSyncDone(true);
    }
  };

  const fileInputId = "google-drive-upload-input";


  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white p-6 lg:p-8 rounded-3xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-4 mb-6">
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
            <HardDrive size={24} />
          </div>
  
          <div>
            <h2 className="text-xl font-bold text-slate-900">Drive</h2>
            <p className="text-slate-500 text-sm">
              Explora el contenido de la carpeta compartida de Google Drive.
            </p>
          </div>
        </div>
  
        {!isOnline ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
              <div className="flex items-center gap-2 text-amber-700 font-semibold text-sm">
                <AlertCircle size={16} />
                Google Drive no disponible sin conexión
              </div>
              <p className="text-sm text-amber-800 mt-2">
                No se puede acceder al contenido de Drive porque ahora mismo no hay internet.
              </p>
              <p className="text-xs text-amber-700 mt-2">
                Cuando vuelva la conexión, esta sección volverá a cargar la información automáticamente.
              </p>
            </div>
          </div>
        ) : loadingConnection ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
            Comprobando conexión con Google Drive...
          </div>
        ) : !isConnected ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
              <div className="flex items-center gap-2 text-amber-700 font-semibold text-sm">
                <AlertCircle size={16} />
                No hay cuenta Google vinculada
              </div>
              <p className="text-sm text-amber-800 mt-2">
                Para usar este menú tienes que vincular antes una cuenta de Google.
              </p>
            </div>
  
            {connectionError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
                {connectionError}
              </div>
            )}
  
            <button
              type="button"
              onClick={() => void handleLink()}
              disabled={linking || !isOnline}
              className={`inline-flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold transition-all ${
                linking || !isOnline
                  ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                  : "bg-indigo-600 text-white hover:bg-indigo-700"
              }`}
            >
              <LinkIcon size={16} />
              {linking ? "Abriendo..." : "Vincular Google Drive"}
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4">
              <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
                <CheckCircle2 size={16} />
                Cuenta Google vinculada
              </div>
              <p className="text-sm text-emerald-800 mt-2">
                {connection?.google_email || "Cuenta vinculada correctamente."}
              </p>
            </div>
  
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[260px]">
                  <Search
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="text"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder="Buscar en el índice de Drive"
                    className="w-full pl-10 pr-4 py-2 rounded-xl border border-slate-300 text-sm text-slate-800"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void handleIndexedSearch();
                      } else if (e.key === "Escape") {
                        handleClearSearch();
                      }
                    }}
                  />
                </div>
  
                <button
                  type="button"
                  onClick={() => void handleIndexedSearch()}
                  disabled={searching || !isOnline}
                  className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                    searching || !isOnline
                      ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                      : "bg-indigo-600 text-white hover:bg-indigo-700"
                  }`}
                >
                  {searching ? "Buscando..." : "Buscar"}
                </button>
  
                {searchMode && (
                  <button
                    type="button"
                    onClick={handleClearSearch}
                    disabled={searching}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <X size={16} />
                    Limpiar
                  </button>
                )}
              </div>
  
              <p className="text-xs text-slate-500 mt-2">
                Busca por nombre o ruta dentro del índice sincronizado de Google Drive.
              </p>
            </div>
  
            {!searchMode ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => void handleGoToRoot()}
                    disabled={loadingFiles}
                    className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    Drive
                  </button>
  
                  {folderStack.map((folder, index) => (
                    <React.Fragment key={folder.id}>
                      <span className="text-slate-400">/</span>
                      <button
                        type="button"
                        disabled={loadingFiles}
                        onClick={() => {
                          const newStack = folderStack.slice(0, index + 1);
                          setFolderStack(newStack);
                          void loadFiles(folder.id);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        {folder.name}
                      </button>
                    </React.Fragment>
                  ))}
  
                  {folderStack.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleGoBackOneLevel()}
                      disabled={loadingFiles}
                      className="ml-2 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:text-slate-400"
                    >
                      Subir un nivel
                    </button>
                  )}
                </div>
  
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-slate-600">
                    {loadingFiles
                      ? "Cargando elementos..."
                      : `${items.length} elemento(s) en la carpeta compartida`}
                  </div>
  
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setShowCreateFolderInput((v) => !v)}
                      disabled={creatingFolder || uploading || syncingDrive || indexingDrive || !isOnline}
                      className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                        creatingFolder || uploading || syncingDrive || indexingDrive || !isOnline
                          ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                          : "bg-amber-100 text-amber-800 hover:bg-amber-200"
                      }`}
                    >
                      <FolderPlus size={16} />
                      Nueva carpeta
                    </button>
                    <label
                      htmlFor={fileInputId}
                      className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                        uploading || creatingFolder || syncingDrive || indexingDrive || !isOnline
                          ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                          : "bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer"
                      }`}
                    >
                      <Upload size={16} />
                      {uploading ? "Subiendo..." : "Subir archivo"}
                    </label>

                    <input
                      id={fileInputId}
                      type="file"
                      className="hidden"
                      disabled={uploading || creatingFolder || syncingDrive || indexingDrive || !isOnline}
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        void handleUploadFile(file);
                        e.currentTarget.value = "";
                      }}
                    />

                    <button
                      type="button"
                      onClick={() => void loadFiles(currentFolderId)}
                      disabled={loadingFiles || uploading || creatingFolder || syncingDrive || indexingDrive || !isOnline}
                      className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                        loadingFiles || uploading || creatingFolder || syncingDrive || indexingDrive || !isOnline
                          ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      <RefreshCw size={16} className={loadingFiles ? "animate-spin" : ""} />
                      Recargar
                    </button>
                  </div>
                </div>
  
                {showCreateFolderInput && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder="Nombre de la nueva carpeta"
                        className="flex-1 min-w-[240px] px-4 py-2 rounded-xl border border-slate-300 text-sm text-slate-800"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            void handleCreateFolder();
                          } else if (e.key === "Escape") {
                            setShowCreateFolderInput(false);
                            setNewFolderName("");
                          }
                        }}
                        autoFocus
                      />
  
                      <button
                        type="button"
                        onClick={() => void handleCreateFolder()}
                        disabled={creatingFolder}
                        className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                          creatingFolder
                            ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                            : "bg-indigo-600 text-white hover:bg-indigo-700"
                        }`}
                      >
                        {creatingFolder ? "Creando..." : "Crear"}
                      </button>
  
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateFolderInput(false);
                          setNewFolderName("");
                        }}
                        disabled={creatingFolder}
                        className="px-4 py-2 rounded-xl text-sm font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
  
                {filesError && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
                    {filesError}
                  </div>
                )}
  
                {!loadingFiles && !filesError && items.length === 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                    La carpeta no tiene elementos visibles para esta cuenta, o los scopes actuales no permiten listarlos.
                  </div>
                )}
  
                {items.length > 0 && (
                  <div className="overflow-hidden rounded-2xl border border-slate-200">
                    <div className="grid grid-cols-12 gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-500">
                      <div className="col-span-11">Nombre</div>
                      
                    </div>
  
                    <div className="divide-y divide-slate-200">
                      {items.map((item) => {
                        const isFolder = item.mimeType === GOOGLE_FOLDER_MIME;
                        const canRename = !!item.capabilities?.canRename;
                        const icon = getFileIcon(item);
  
                        return (
                          <div
                            key={item.id}
                            className="grid grid-cols-12 gap-3 px-4 py-4 items-center bg-white"
                          >
                            <div className="col-span-11 min-w-0">
                              <div className="flex items-center gap-3 min-w-0">
                                {icon}
                                <div className="min-w-0">
                                  {editingItemId === item.id ? (
                                    <div className="flex items-center gap-2 min-w-0">
                                      <input
                                        type="text"
                                        value={editingName}
                                        onChange={(e) => setEditingName(e.target.value)}
                                        className="w-full min-w-0 px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-800"
                                        autoFocus
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") {
                                            void handleConfirmRename(item);
                                          } else if (e.key === "Escape") {
                                            handleCancelRename();
                                          }
                                        }}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => void handleConfirmRename(item)}
                                        disabled={renaming}
                                        className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:bg-slate-300"
                                      >
                                        OK
                                      </button>
                                      <button
                                        type="button"
                                        onClick={handleCancelRename}
                                        disabled={renaming}
                                        className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                                      >
                                        Cancelar
                                      </button>
                                    </div>
                                  ) : isFolder ? (
                                    <button
                                      type="button"
                                      onClick={() => void handleOpenFolder(item)}
                                      className="text-sm font-semibold text-slate-800 truncate hover:underline text-left"
                                    >
                                      {item.name || "(sin nombre)"}
                                    </button>
                                  ) : item.webViewLink ? (
                                    <a
                                      href={item.webViewLink}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block text-sm font-semibold text-slate-800 truncate hover:underline"
                                      title="Abrir en Google"
                                    >
                                      {item.name || "(sin nombre)"}
                                    </a>
                                  ) : (
                                    <div className="text-sm font-semibold text-slate-800 truncate">
                                      {item.name || "(sin nombre)"}
                                    </div>
                                  )}
  
                                  <div className="text-xs text-slate-500 truncate">
                                    {item.owners?.[0]?.displayName || item.owners?.[0]?.emailAddress || "-"}
                                  </div>
                                  <div className="text-xs text-slate-400 truncate">
                                    Modificado: {formatDate(item.modifiedTime)}
                                  </div>
                                </div>
                              </div>
                            </div>  
                            <div className="col-span-1 flex items-center justify-end gap-2">
                              {canRename && editingItemId !== item.id && (
                                <button
                                  type="button"
                                  onClick={() => handleStartRename(item)}
                                  title="Renombrar"
                                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"
                                >
                                  <Pencil size={14} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-slate-600">
                    {searching
                      ? "Buscando..."
                      : `${searchResults.length} resultado(s) encontrados`}
                  </div>
                </div>
  
                {!searching && searchResults.length === 0 && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-600">
                    No se han encontrado coincidencias en esta carpeta ni en sus subcarpetas.
                  </div>
                )}
  
                {searchResults.length > 0 && (
                  <div className="overflow-hidden rounded-2xl border border-slate-200">
                    <div className="grid grid-cols-12 gap-3 px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-bold uppercase tracking-wider text-slate-500">
                      <div className="col-span-5">Nombre</div>
                      <div className="col-span-7">Ruta</div>
                    </div>
  
                    <div className="divide-y divide-slate-200">
                      {searchResults.map((item) => {
                        const isFolder = item.is_folder;
                        const icon = getFileIcon(item);
                        return (
                          <div
                            key={item.file_id}
                            className="grid grid-cols-12 gap-3 px-4 py-4 items-center bg-white"
                          >
                            <div className="col-span-5 min-w-0">
                              <div className="flex items-center gap-3 min-w-0">
                                {icon}
                                <div className="min-w-0">
                                  {isFolder ? (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        setSearchMode(false);
                                        setSearchResults([]);
                                        setFolderStack([]);
                                        await loadFiles(item.file_id);
                                      }}
                                      className="text-sm font-semibold text-slate-800 truncate hover:underline text-left"
                                    >
                                      {item.name || "(sin nombre)"}
                                    </button>
                                  ) : item.web_view_link ? (
                                    <a
                                      href={item.web_view_link}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block text-sm font-semibold text-slate-800 truncate hover:underline"
                                      title="Abrir en Google"
                                    >
                                      {item.name || "(sin nombre)"}
                                    </a>
                                  ) : (
                                    <div className="text-sm font-semibold text-slate-800 truncate">
                                      {item.name || "(sin nombre)"}
                                    </div>
                                  )}

                                  <div className="text-xs text-slate-500 truncate">
                                    {item.owner_display_name || item.owner_email || "-"}
                                  </div>
                                  <div className="text-xs text-slate-400 truncate">
                                    Modificado: {formatDate(item.modified_time)}
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="col-span-7 text-xs text-slate-500 truncate" title={item.path}>
                              {item.path}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Drive;