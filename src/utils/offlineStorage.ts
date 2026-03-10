const DB_NAME = 'control-asistencia-offline';
const DB_VERSION = 1;
const STORE_NAME = 'app_cache';

export type OfflineCacheKey =
  | 'currentUser'
  | 'students'
  | 'groups'
  | 'groupCatechistLinks'
  | 'users'
  | 'attendance'
  | 'classDays'
  | 'parishEvents'
  | 'incidents'
  | 'schoolNames';

export interface OfflineCacheRecord<T = unknown> {
  key: string;
  data: T;
  updatedAt: string;
}

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error ?? new Error('No se pudo abrir IndexedDB'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
}

export async function saveOfflineData<T>(
  key: string,
  data: T
): Promise<void> {
  const db = await openOfflineDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const record: OfflineCacheRecord<T> = {
      key,
      data,
      updatedAt: new Date().toISOString(),
    };

    const request = store.put(record);

    request.onerror = () => {
      reject(request.error ?? new Error(`No se pudo guardar la clave "${key}"`));
    };

    request.onsuccess = () => {
      resolve();
    };

    transaction.oncomplete = () => {
      db.close();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error('Error en la transacción de escritura'));
    };
  });
}

export async function getOfflineData<T>(
  key: string
): Promise<OfflineCacheRecord<T> | null> {
  const db = await openOfflineDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onerror = () => {
      reject(request.error ?? new Error(`No se pudo leer la clave "${key}"`));
    };

    request.onsuccess = () => {
      resolve((request.result as OfflineCacheRecord<T> | undefined) ?? null);
    };

    transaction.oncomplete = () => {
      db.close();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error('Error en la transacción de lectura'));
    };
  });
}

export async function removeOfflineData(key: string): Promise<void> {
  const db = await openOfflineDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(key);

    request.onerror = () => {
      reject(request.error ?? new Error(`No se pudo borrar la clave "${key}"`));
    };

    request.onsuccess = () => {
      resolve();
    };

    transaction.oncomplete = () => {
      db.close();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error('Error en la transacción de borrado'));
    };
  });
}

export async function clearOfflineData(): Promise<void> {
  const db = await openOfflineDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onerror = () => {
      reject(request.error ?? new Error('No se pudo limpiar IndexedDB'));
    };

    request.onsuccess = () => {
      resolve();
    };

    transaction.oncomplete = () => {
      db.close();
    };

    transaction.onerror = () => {
      reject(transaction.error ?? new Error('Error en la transacción de limpieza'));
    };
  });
}