const FILE_NAME = "pocketledger-backup.json";
const MIME_TYPE = "application/json";
const STORAGE_TOKEN = "pocketledger_drive_token";
const STORAGE_EXPIRES = "pocketledger_drive_expiresAt";
const STORAGE_FILE_ID = "pocketledger_drive_fileId";
const STORAGE_CLIENT_ID = "pocketledger_drive_clientId";
const STORAGE_LAST_SYNC = "pocketledger_drive_lastSync";
const SCOPE = "https://www.googleapis.com/auth/drive.file";

let tokenClient: any = null;
let gisLoaded = false;

function loadGis(): Promise<void> {
  if (gisLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => { gisLoaded = true; resolve(); };
    s.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(s);
  });
}

export function getClientId(): string | null {
  return localStorage.getItem(STORAGE_CLIENT_ID);
}

export function setClientId(id: string): void {
  localStorage.setItem(STORAGE_CLIENT_ID, id);
}

export function getStoredToken(): string | null {
  const token = localStorage.getItem(STORAGE_TOKEN);
  const expiresAt = localStorage.getItem(STORAGE_EXPIRES);
  if (!token || !expiresAt) return null;
  if (Date.now() > parseInt(expiresAt, 10)) {
    // Token expired — clear it
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_EXPIRES);
    return null;
  }
  return token;
}

export function getLastSyncTime(): number | null {
  const v = localStorage.getItem(STORAGE_LAST_SYNC);
  return v ? parseInt(v, 10) : null;
}

export function getConnectedEmail(): string | null {
  return localStorage.getItem("pocketledger_drive_email");
}

export async function authenticate(clientId: string): Promise<{ token: string; email: string }> {
  await loadGis();
  return new Promise((resolve, reject) => {
    try {
      tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: (resp: any) => {
          if (resp.error) { reject(new Error(resp.error)); return; }
          localStorage.setItem(STORAGE_TOKEN, resp.access_token);
          localStorage.setItem(STORAGE_EXPIRES, String(Date.now() + (resp.expires_in ?? 3600) * 1000));
          // Decode the ID token to get the email
          let email = "Connected";
          if (resp.id_token) {
            try {
              const payload = JSON.parse(atob(resp.id_token.split(".")[1]));
              if (payload.email) email = payload.email;
              localStorage.setItem("pocketledger_drive_email", email);
            } catch {}
          }
          resolve({ token: resp.access_token, email });
        },
      });
      tokenClient.requestAccessToken({ prompt: "consent" });
    } catch (err) {
      reject(err);
    }
  });
}

export async function refreshTokenIfNeeded(clientId: string): Promise<string | null> {
  const existing = getStoredToken();
  if (existing) return existing;
  try {
    await loadGis();
    return new Promise((resolve, reject) => {
      try {
        const tc = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPE,
          callback: (resp: any) => {
            if (resp.error) { resolve(null); return; }
            localStorage.setItem(STORAGE_TOKEN, resp.access_token);
            localStorage.setItem(STORAGE_EXPIRES, String(Date.now() + (resp.expires_in ?? 3600) * 1000));
            resolve(resp.access_token);
          },
        });
        tc.requestAccessToken({ prompt: "" });
      } catch { resolve(null); }
    });
  } catch { return null; }
}

export async function uploadToDrive(data: string, clientId: string): Promise<void> {
  const token = await refreshTokenIfNeeded(clientId);
  if (!token) return;

  let fileId = localStorage.getItem(STORAGE_FILE_ID);

  if (!fileId) {
    // Create the file
    const res = await fetch("https://www.googleapis.com/drive/v3/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: FILE_NAME,
        mimeType: MIME_TYPE,
        parents: ["appDataFolder"],
      }),
    });
    if (!res.ok) return;
    const file = await res.json();
    fileId = file.id;
    localStorage.setItem(STORAGE_FILE_ID, fileId);
  }

  // Upload content
  const uploadRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": MIME_TYPE,
    },
    body: data,
  });
  if (!uploadRes.ok) return;
  localStorage.setItem(STORAGE_LAST_SYNC, Date.now().toString());
}

export async function downloadFromDrive(clientId: string): Promise<string | null> {
  const token = await refreshTokenIfNeeded(clientId);
  if (!token) return null;

  let fileId = localStorage.getItem(STORAGE_FILE_ID);
  if (!fileId) {
    // Find the file by name in appDataFolder
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='${FILE_NAME}' and 'appDataFolder' in parents&spaces=appDataFolder`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const list = await res.json();
    if (!list.files?.length) return null;
    fileId = list.files[0].id;
    localStorage.setItem(STORAGE_FILE_ID, fileId);
  }

  const dl = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!dl.ok) return null;
  return await dl.text();
}

// ─── Statement Import Folder ──────────────────────────────────────────────

const STORAGE_STMT_FOLDER = "pocketledger_stmt_folderId";

export function getStatementFolderId(): string | null {
  return localStorage.getItem(STORAGE_STMT_FOLDER);
}

export function setStatementFolderId(id: string): void {
  localStorage.setItem(STORAGE_STMT_FOLDER, id);
}

export function removeStatementFolderId(): void {
  localStorage.removeItem(STORAGE_STMT_FOLDER);
}

export interface DriveStatementFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;  // ISO string from Drive API
}

/** Ensure the stored token has drive.readonly scope, re-authing if needed. */
async function ensureStatementsAuth(clientId: string): Promise<string | null> {
  const existing = getStoredToken();
  if (existing) return existing;
  await loadGis();
  return new Promise((resolve) => {
    try {
      const tc = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly",
        callback: (resp: any) => {
          if (resp.error) { resolve(null); return; }
          localStorage.setItem(STORAGE_TOKEN, resp.access_token);
          localStorage.setItem(STORAGE_EXPIRES, String(Date.now() + (resp.expires_in ?? 3600) * 1000));
          resolve(resp.access_token);
        },
      });
      tc.requestAccessToken({ prompt: "" });
    } catch { resolve(null); }
  });
}

export async function listStatementFiles(folderId: string, clientId: string): Promise<DriveStatementFile[]> {
  const token = await ensureStatementsAuth(clientId);
  if (!token) return [];
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,mimeType,modifiedTime)&orderBy=modifiedTimeDesc`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.files ?? [];
  } catch { return []; }
}

export async function downloadFileContent(fileId: string, clientId: string): Promise<string | null> {
  const token = await ensureStatementsAuth(clientId);
  if (!token) return null;
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

export async function downloadFileAsBlob(fileId: string, clientId: string): Promise<Blob | null> {
  const token = await ensureStatementsAuth(clientId);
  if (!token) return null;
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return await res.blob();
  } catch { return null; }
}

export function revokeAccess(): void {
  const token = localStorage.getItem(STORAGE_TOKEN);
  if (token) {
    fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: "POST" }).catch(() => {});
  }
  localStorage.removeItem(STORAGE_TOKEN);
  localStorage.removeItem(STORAGE_EXPIRES);
  localStorage.removeItem(STORAGE_FILE_ID);
  localStorage.removeItem(STORAGE_LAST_SYNC);
  localStorage.removeItem("pocketledger_drive_email");
}
