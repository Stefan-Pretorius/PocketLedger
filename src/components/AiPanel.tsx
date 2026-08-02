import { useState, useRef, useEffect, type FormEvent } from "react";
import { Modal, Button } from "./ui";
import { useAiChat, type AiChatMessage } from "../useAiChat";
import { buildAppSystemPrompt, describeAction, executeAction, type AiAction } from "../aiActions";
import { getAiConfig } from "../aimatch";
import { toast } from "sonner";
import { Sparkles, Send, Check, X, Pencil, ChevronUp, Loader2 } from "lucide-react";

function ActionCard({
  action, defaultJson, onConfirm, onDecline, onEditToggle, editing, index,
}: {
  action: AiAction; defaultJson: string;
  onConfirm: (json: string) => void; onDecline: () => void;
  onEditToggle: () => void; editing: boolean; index: number;
}) {
  const [json, setJson] = useState(defaultJson);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const confirm = () => {
    try {
      const parsed = JSON.parse(json);
      onConfirm(JSON.stringify(parsed));
    } catch {
      setParseErr("Invalid JSON — fix it and try again.");
    }
  };
  return (
    <div className="border border-border rounded-xl p-3 space-y-2 bg-muted/30">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center flex-shrink-0 text-[10px] font-bold">
            {index + 1}
          </span>
          <p className="text-xs font-medium text-foreground">{describeAction(action)}</p>
        </div>
        <button onClick={onEditToggle} className="text-muted-foreground hover:text-foreground p-1" title="Edit">
          {editing ? <ChevronUp size={14} /> : <Pencil size={14} />}
        </button>
      </div>
      {editing && (
        <div className="space-y-1">
          <textarea
            value={json}
            onChange={e => { setJson(e.target.value); setParseErr(null); }}
            rows={5}
            className="w-full font-mono text-[11px] rounded-lg border border-border bg-background p-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {parseErr && <p className="text-[10px] text-destructive">{parseErr}</p>}
        </div>
      )}
      <div className="flex gap-2">
        <Button label="Confirm" onClick={confirm} size="sm" icon={Check} className="flex-1" />
        <Button label="Decline" onClick={onDecline} size="sm" variant="secondary" icon={X} className="flex-1" />
      </div>
    </div>
  );
}

function AiMessageRow({ msg, handled, setHandled, msgIdx }: {
  msg: AiChatMessage;
  handled: Record<string, boolean>;
  setHandled: (h: Record<string, boolean>) => void;
  msgIdx: number;
}) {
  const [editing, setEditing] = useState<Record<string, boolean>>({});

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-primary/10 border border-primary/20 rounded-2xl rounded-br-sm px-3 py-2 text-xs text-foreground whitespace-pre-wrap">
          {msg.text}
        </div>
      </div>
    );
  }

  if (msg.kind === "actions" && msg.actions && msg.actions.length > 0) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
          <Sparkles size={12} /> AI proposes {msg.actions.length} change{msg.actions.length !== 1 ? "s" : ""} — review before applying
        </div>
        {msg.actions.map((a, i) => {
          const key = `${msgIdx}-${i}`;
          const json = JSON.stringify(a);
          if (handled[key]) return null;
          return (
            <ActionCard
              key={key}
              action={a as AiAction}
              defaultJson={json}
              editing={!!editing[key]}
              onEditToggle={() => setEditing(prev => ({ ...prev, [key]: !prev[key] }))}
              onConfirm={rawJson => {
                try {
                  const parsed = JSON.parse(rawJson) as AiAction;
                  const result = executeAction(parsed);
                  toast.success(result);
                } catch (e) {
                  toast.error("Failed: " + (e as Error).message);
                }
                setHandled({ ...handled, [key]: true });
              }}
              onDecline={() => setHandled({ ...handled, [key]: true })}
              index={i}
            />
          );
        })}
        {msg.actions.length > 0 && msg.actions.every((_, i) => handled[`${msgIdx}-${i}`]) && (
          <p className="text-[10px] text-muted-foreground text-center">All proposals resolved.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] bg-card border border-border rounded-2xl rounded-bl-sm px-3 py-2 text-xs text-foreground whitespace-pre-wrap">
        {msg.kind === "question" && (
          <div className="flex items-center gap-1.5 text-xs font-medium text-warning mb-1">
            <Sparkles size={12} /> Question
          </div>
        )}
        {msg.text}
        {msg.kind === "question" && (
          <p className="text-[10px] text-muted-foreground mt-1">Reply in the box below to answer.</p>
        )}
      </div>
    </div>
  );
}

export function AiPanel() {
  const chat = useAiChat(buildAppSystemPrompt());
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [handled, setHandled] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const cfg = getAiConfig();

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.messages, chat.busy, open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (chat.busy || !input.trim()) return;
    const text = input.trim();
    setInput("");
    chat.send(text);
  };

  const quickAction = (label: string) => () => { setOpen(true); chat.send(label); };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 sm:bottom-5 right-5 z-40 w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:opacity-90 transition-opacity"
        title="Ask AI"
      >
        <Sparkles size={20} />
      </button>

      <Modal visible={open} onClose={() => setOpen(false)} title="Ask AI" maxWidth="lg">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {!cfg ? (
              <p className="text-[11px] text-muted-foreground w-full">
                AI is not configured. Open <span className="font-medium text-foreground">Settings → AI Statement Matching</span> to connect
                to your local opencode server (<span className="font-mono">opencode serve --cors http://localhost:5173</span>).
              </p>
            ) : (
              <>
                <span className="text-[11px] text-muted-foreground w-full">Try:</span>
                <button onClick={quickAction("How much have I spent on groceries this year?")} className="text-[11px] px-2.5 py-1 rounded-full bg-muted text-foreground hover:bg-accent">Spending summary</button>
                <button onClick={quickAction("Propose creating bank rules for the most common merchants I haven't mapped yet.")} className="text-[11px] px-2.5 py-1 rounded-full bg-muted text-foreground hover:bg-accent">Suggest bank rules</button>
                <button onClick={quickAction("Look at my categories and goals and suggest any missing savings goals or budget categories.")} className="text-[11px] px-2.5 py-1 rounded-full bg-muted text-foreground hover:bg-accent">Budget suggestions</button>
              </>
            )}
          </div>

          <div ref={scrollRef} className="h-72 overflow-y-auto space-y-2 pr-1 scrollbar-thin">
            {chat.messages.length === 0 && !chat.busy && (
              <p className="text-xs text-muted-foreground text-center pt-8">
                Ask anything about your finances, or ask the AI to make changes — it will propose them for your approval first.
              </p>
            )}
            {chat.messages.map((m, i) => (
              <AiMessageRow key={i} msg={m} msgIdx={i} handled={handled} setHandled={setHandled} />
            ))}
            {chat.busy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={12} className="animate-spin" /> Thinking…
              </div>
            )}
          </div>

          {chat.error && (
            <p className="text-[11px] text-destructive bg-destructive/10 rounded-lg px-3 py-2">{chat.error}</p>
          )}

          <form onSubmit={submit} className="flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={chat.messages.some(m => m.kind === "question" && m.role === "ai") ? "Type your answer…" : "Ask the AI…"}
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button label="Send" loading={chat.busy} icon={Send} disabled={!input.trim()} />
          </form>
        </div>
      </Modal>
    </>
  );
}
