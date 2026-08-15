// ─── Shared AI chat hook for "Ask AI" and statement matching ─────────────────
import { useCallback, useEffect, useRef, useState } from "react";
import { getEffectiveConfig, createSession, deleteSession, sendMessage, extractJson } from "./aimatch";

export type AiAssignment = {
  index: number;
  action: "category" | "goal" | "goalWithdrawal" | "income" | "transfer" | "holding" | "householdTransfer" | "skip";
  categoryId?: number;
  goalId?: number;
  name?: string;
  accountId?: number;
  holdingId?: number;
};

export type AiChatMessage = {
  role: "user" | "ai";
  text: string;
  kind: "question" | "answer" | "actions" | "assignments" | "text";
  actions?: unknown[];
  assignments?: AiAssignment[];
};

export type AiParsed =
  | { type: "question"; text: string }
  | { type: "answer"; text: string }
  | { type: "actions"; actions: unknown[] }
  | { type: "assignments"; rows: AiAssignment[] };

export function parseAiResponse(text: string): AiParsed {
  const json = extractJson<Record<string, unknown>>(text);
  const t = String(json.type ?? "");
  if (t === "question") return { type: "question", text: String(json.text ?? "") };
  if (t === "actions") {
    const raw = Array.isArray(json.actions) ? json.actions : [];
    const actions = raw.map(a => (typeof a === "string" ? JSON.parse(a) : a)).filter(a => a && typeof a === "object");
    return { type: "actions", actions };
  }
  if (t === "assignments") {
    const rows = Array.isArray(json.rows) ? (json.rows as AiAssignment[]) : [];
    return { type: "assignments", rows };
  }
  if (t === "answer") return { type: "answer", text: String(json.text ?? "") };
  // Default: treat as plain answer text
  return { type: "answer", text };
}

export function useAiChat(systemPrompt: string) {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const configRef = useRef<AiConfig | null>(null);
  const messagesRef = useRef<AiChatMessage[]>([]);

  useEffect(() => { messagesRef.current = messages; }, [messages]);

  useEffect(() => {
    const cfg = getEffectiveConfig();
    configRef.current = cfg;
    setConnected(!!cfg);
  }, []);

  const ensureSession = useCallback(async () => {
    if (sessionIdRef.current) return sessionIdRef.current;
    const cfg = getEffectiveConfig();
    configRef.current = cfg;
    const id = await createSession(cfg, "PocketLedger AI");
    sessionIdRef.current = id;
    return id;
  }, []);

  const send = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setError(null);
    setMessages(prev => [...prev, { role: "user", text: text.trim(), kind: "text" }]);
    setBusy(true);
    try {
      const sessionId = await ensureSession();
      const cfg = configRef.current!;
      const history = messagesRef.current
        .filter(m => m.kind !== "actions" && m.kind !== "assignments")
        .map(m => `${m.role.toUpperCase()}: ${m.text}`)
        .join("\n");
      const reply = await sendMessage(cfg, sessionId, {
        system: systemPrompt,
        text: history ? `Conversation so far:\n${history}\n\nUSER: ${text.trim()}` : text.trim(),
      });
      const parsed = parseAiResponse(reply);
      const msg: AiChatMessage = {
        role: "ai",
        text: parsed.text,
        kind: parsed.type === "question" ? "question" : parsed.type === "actions" ? "actions" : parsed.type === "assignments" ? "assignments" : "answer",
        actions: parsed.type === "actions" ? parsed.actions : undefined,
        assignments: parsed.type === "assignments" ? parsed.rows : undefined,
      };
      setMessages(prev => [...prev, msg]);
      return msg;
    } catch (e) {
      // A failed send usually means the server was restarted and the cached
      // session id is stale — drop it so the next attempt creates a new one.
      sessionIdRef.current = null;
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [systemPrompt, ensureSession]);

  const clear = useCallback(() => {
    const cfg = configRef.current;
    const id = sessionIdRef.current;
    if (cfg && id) deleteSession(cfg, id).catch(() => {});
    sessionIdRef.current = null;
    setMessages([]);
    messagesRef.current = [];
    setError(null);
  }, []);

  useEffect(() => {
    return () => {
      const cfg = configRef.current;
      const id = sessionIdRef.current;
      if (cfg && id) deleteSession(cfg, id).catch(() => {});
    };
  }, []);

  return { messages, busy, error, connected, send, clear };
}
