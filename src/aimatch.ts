// ─── AI client for statement matching & "Ask AI" ─────────────────────────────
// Talks to the local opencode server (`opencode serve --cors http://localhost:5173`)
// which uses the user's configured model (e.g. big-pickle). No extra API key.

export interface AiConfig {
  serverUrl: string;
  password?: string;
  model?: string;
}

const CONFIG_KEY = "pocketledger_ai_config";

/** True when the app is served from localhost or a private LAN address,
 *  where the AI server is reachable directly on the same host/network. */
function isLocalOrLanHost(host: string): boolean {
  if (!host || host === "localhost") return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const parts = host.split(".").map(Number);
    if (parts[0] === 127) return true;
    if (parts[0] === 10) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    return false;
  }
  return host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".home.arpa");
}

/** Default AI server URL.
 *  - On localhost / LAN (laptop or phone on same Wi-Fi): http://<host>:4096
 *  - On a public site (Netlify etc.): http://localhost:4096 as a starting point —
 *    the AI server is not auto-detectable there; use an HTTPS tunnel URL instead. */
export function defaultServerUrl(): string {
  try {
    const host = window.location.hostname || "localhost";
    return isLocalOrLanHost(host) ? `http://${host}:4096` : "http://localhost:4096";
  } catch {
    return "http://localhost:4096";
  }
}

export function getAiConfig(): AiConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AiConfig;
  } catch {
    return null;
  }
}

export function setAiConfig(c: AiConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
}

export function clearAiConfig() {
  localStorage.removeItem(CONFIG_KEY);
}

export function normalizeUrl(u: string): string {
  return u.trim().replace(/\/+$/, "");
}

function authHeaders(config: AiConfig): Record<string, string> {
  if (config.password) {
    return { Authorization: `Basic ${btoa(`opencode:${config.password}`)}` };
  }
  return {};
}

async function request(
  config: AiConfig,
  path: string,
  init?: RequestInit,
  timeoutMs = 180000,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(normalizeUrl(config.serverUrl) + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(config),
        ...(init?.headers ?? {}),
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Server responded HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function testAiConnection(config: AiConfig): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const res = await request(config, "/global/health", undefined, 10000);
    const data = await res.json();
    return { ok: true, version: data.version };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function createSession(config: AiConfig, title: string): Promise<string> {
  const res = await request(config, "/session", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  const data = await res.json();
  if (!data?.id) throw new Error("No session id returned");
  return data.id as string;
}

export async function deleteSession(config: AiConfig, sessionId: string) {
  try {
    await request(config, `/session/${sessionId}`, { method: "DELETE" }, 10000);
  } catch {
    // best effort cleanup
  }
}

export async function sendMessage(
  config: AiConfig,
  sessionId: string,
  opts: { system?: string; text: string },
): Promise<string> {
  const res = await request(config, `/session/${sessionId}/message`, {
    method: "POST",
    body: JSON.stringify({
      system: opts.system,
      tools: {},
      parts: [{ type: "text", text: opts.text }],
    }),
  });
  const data = await res.json();
  const parts: Array<{ type?: string; text?: string }> = data?.parts ?? [];
  return parts.filter(p => p.type === "text").map(p => p.text ?? "").join("\n").trim();
}

/** Extract a JSON value from an LLM text response (tolerates markdown fences + prose). */
export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as T;
    } catch {
      // fall through
    }
  }
  const arrStart = candidate.indexOf("[");
  const arrEnd = candidate.lastIndexOf("]");
  if (arrStart >= 0 && arrEnd > arrStart) {
    try {
      return JSON.parse(candidate.slice(arrStart, arrEnd + 1)) as T;
    } catch {
      // fall through
    }
  }
  throw new Error("Could not parse AI response as JSON");
}
