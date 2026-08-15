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

/** Resolve the AI config to use. Falls back to the default local server
 *  (http://localhost:4096) so AI features work with zero setup once the
 *  `opencode serve` command from Settings has been started. */
export function getEffectiveConfig(): AiConfig {
  return getAiConfig() ?? { serverUrl: defaultServerUrl() };
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
  let res: Response;
  try {
    res = await fetch(normalizeUrl(config.serverUrl) + path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(config),
        ...(init?.headers ?? {}),
      },
      signal: ctrl.signal,
    });
  } catch (e) {
    const reason = (e as Error).message ?? String(e);
    throw new Error(
      `Cannot reach the AI server at ${config.serverUrl} (${reason}). ` +
        `Start it with "opencode serve" — the exact command is in Settings → AI Statement Matching — then try again.`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const looksHtml = /^<!DOCTYPE|^<html/i.test(body.trimStart());
    if (res.status === 401) {
      throw new Error(
        looksHtml
          ? `The server at ${config.serverUrl} returned a 401 HTML page — that is not the opencode server. Is another app using port 4096?`
          : `AI server returned 401 Unauthorized. If the server was started with OPENCODE_SERVER_PASSWORD, ` +
            `enter that same password in Settings → AI Statement Matching. If not, clear the password field.`,
      );
    }
    throw new Error(
      looksHtml
        ? `The server at ${config.serverUrl} returned an HTML error page (HTTP ${res.status}) — not the opencode server. ` +
          `Check that nothing else is using port 4096, then restart "opencode serve".`
        : `Server responded HTTP ${res.status}: ${body.slice(0, 300)}`,
    );
  }
  return res;
}

/** Parse a successful response body as JSON, giving a clear error when a web
 *  page (HTML) is returned instead — e.g. the Server URL points at the app's
 *  own dev server or another website rather than the opencode server. */
async function expectJson(res: Response, config: AiConfig): Promise<unknown> {
  const text = await res.text().catch(() => "");
  const trimmed = text.trimStart();
  if (!text) {
    throw new Error(`The server at ${config.serverUrl} returned an empty response.`);
  }
  if (trimmed.startsWith("<")) {
    const appOrigin = `${window.location.protocol}//${window.location.host}`;
    const sameAsApp = normalizeUrl(config.serverUrl).startsWith(normalizeUrl(appOrigin));
    throw new Error(
      sameAsApp
        ? `The server at ${config.serverUrl} returned a web page — that is the app's own address. ` +
          `Server URL must point to the opencode server (default http://localhost:4096), not the app.`
        : `The server at ${config.serverUrl} returned an HTML page instead of JSON — that is not the opencode server. ` +
          `Start "opencode serve" (Settings → AI Statement Matching shows the command) and make sure nothing else is using port 4096.`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `The server at ${config.serverUrl} returned invalid JSON. Make sure "opencode serve" is running and the URL is correct.`,
    );
  }
}

export async function testAiConnection(config: AiConfig): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const res = await request(config, "/global/health", undefined, 10000);
    const data = (await expectJson(res, config)) as { version?: string };
    return { ok: true, version: data?.version };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function createSession(config: AiConfig, title: string): Promise<string> {
  const res = await request(config, "/session", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  const data = (await expectJson(res, config)) as { id?: string };
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
  const data = (await expectJson(res, config)) as { parts?: Array<{ type?: string; text?: string }> };
  const parts = data?.parts ?? [];
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
