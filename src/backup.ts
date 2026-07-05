import type { StoreData } from "./store";

const DB_NAME = "pocketledger_backup";
const STORE_NAME = "handles";
const BACKUP_FILENAME = "pocketledger-backup.json";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get("dirHandle");
      req.onsuccess = () => { resolve(req.result ?? null); db.close(); };
      req.onerror = () => { reject(req.error); db.close(); };
    });
  } catch { return null; }
}

export async function setDirHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, "dirHandle");
    tx.oncomplete = () => { resolve(); db.close(); };
    tx.onerror = () => { reject(tx.error); db.close(); };
  });
}

export async function removeDirHandle(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete("dirHandle");
    tx.oncomplete = () => { resolve(); db.close(); };
    tx.onerror = () => { reject(tx.error); db.close(); };
  });
}

export async function pickBackupFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!("showDirectoryPicker" in window)) return null;
  try {
    const handle = await (window as any).showDirectoryPicker();
    await setDirHandle(handle);
    const lastBackup = localStorage.getItem("pocketledger_folderBackupTime");
    return handle;
  } catch { return null; }
}

export async function autoSaveToDir(data: StoreData): Promise<void> {
  const handle = await getDirHandle();
  if (!handle) return;
  try {
    const fileHandle = await handle.getFileHandle(BACKUP_FILENAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
    localStorage.setItem("pocketledger_folderBackupTime", Date.now().toString());
  } catch {}
}

// ─── Import folder (for reading statement files from a local folder) ──────────

export async function getImportDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get("importDirHandle");
      req.onsuccess = () => { resolve(req.result ?? null); db.close(); };
      req.onerror = () => { reject(req.error); db.close(); };
    });
  } catch { return null; }
}

export async function setImportDirHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, "importDirHandle");
    tx.oncomplete = () => { resolve(); db.close(); };
    tx.onerror = () => { reject(tx.error); db.close(); };
  });
}

export async function removeImportDirHandle(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete("importDirHandle");
    tx.oncomplete = () => { resolve(); db.close(); };
    tx.onerror = () => { reject(tx.error); db.close(); };
  });
}

export async function pickImportFolder(): Promise<{ handle: FileSystemDirectoryHandle; name: string } | null> {
  if (!("showDirectoryPicker" in window)) return null;
  try {
    const handle = await (window as any).showDirectoryPicker();
    await setImportDirHandle(handle);
    return { handle, name: handle.name };
  } catch { return null; }
}

export async function listImportFiles(): Promise<Array<{ name: string; handle: FileSystemFileHandle; ext: string }>> {
  const handle = await getImportDirHandle();
  if (!handle) return [];
  const files: Array<{ name: string; handle: FileSystemFileHandle; ext: string }> = [];
  try {
    for await (const entry of (handle as any).values()) {
      if (entry.kind === "file") {
        const name = entry.name;
        const ext = name.split(".").pop()?.toLowerCase() ?? "";
        if (["csv", "ofx", "qfx", "pdf"].includes(ext)) {
          files.push({ name, handle: entry as FileSystemFileHandle, ext });
        }
      }
    }
  } catch {}
  return files.sort((a, b) => a.name.localeCompare(b.name));
}
