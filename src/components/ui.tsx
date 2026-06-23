import { useState, useRef, useEffect, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Account } from "../types";

export function Card({
  children, className, onClick, padding = true,
}: {
  children: ReactNode; className?: string; onClick?: () => void; padding?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-card border border-border rounded-xl shadow-sm",
        padding && "p-4",
        onClick && "cursor-pointer hover:border-primary/40 transition-colors",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ProgressBar({
  value, color, height = 8, showLabel, className,
}: {
  value: number; color?: string; height?: number; showLabel?: boolean; className?: string;
}) {
  const pct = Math.min(Math.max(value, 0), 1) * 100;
  const barColor = color ?? "#6366f1";
  return (
    <div className={cn("w-full", className)}>
      <div className="w-full rounded-full bg-muted overflow-hidden" style={{ height }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
      {showLabel && (
        <div className="flex justify-between mt-1 text-xs text-muted-foreground">
          <span>{Math.round(pct)}%</span>
        </div>
      )}
    </div>
  );
}

export function Button({
  label, onClick, variant = "primary", size = "md", loading, disabled, fullWidth, icon: Icon, className,
}: {
  label: string; onClick?: () => void; variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md"; loading?: boolean; disabled?: boolean; fullWidth?: boolean;
  icon?: React.ElementType; className?: string;
}) {
  const base = "inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = { sm: "px-3 py-1.5 text-sm", md: "px-4 py-2 text-sm" };
  const variants = {
    primary: "bg-primary text-primary-foreground hover:bg-primary/90",
    secondary: "bg-muted text-foreground hover:bg-muted/80 border border-border",
    danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    ghost: "text-foreground hover:bg-accent",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(base, sizes[size], variants[variant], fullWidth && "w-full", className)}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : Icon ? <Icon size={14} /> : null}
      {label}
    </button>
  );
}

export function Input({
  label, value, onChange, placeholder, type = "text", prefix, multiline, className, autoFocus,
}: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string;
  type?: string; prefix?: string; multiline?: boolean; className?: string; autoFocus?: boolean;
}) {
  const inputClass = cn(
    "w-full bg-background border border-input rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors",
    prefix ? "pl-7 pr-3 py-2" : "px-3 py-2",
    className,
  );

  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-sm font-medium text-muted-foreground">{label}</label>}
      <div className="relative">
        {prefix && (
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
            {prefix}
          </span>
        )}
        {multiline ? (
          <textarea
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            autoFocus={autoFocus}
            rows={3}
            className={cn(inputClass, "resize-none py-2")}
          />
        ) : (
          <input
            type={type}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            autoFocus={autoFocus}
            className={inputClass}
          />
        )}
      </div>
    </div>
  );
}

export function Modal({
  visible, onClose, title, children, maxWidth = "md",
}: {
  visible: boolean; onClose: () => void; title: string; children: ReactNode; maxWidth?: "sm" | "md" | "lg";
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    if (visible) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [visible, onClose]);

  if (!visible) return null;

  const maxWidths = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg" };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className={cn("relative w-full bg-card border border-border rounded-2xl shadow-2xl overflow-hidden", maxWidths[maxWidth])}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 overflow-y-auto max-h-[75vh] scrollbar-thin">
          {children}
        </div>
      </div>
    </div>
  );
}

export function Badge({
  label, color, variant = "solid",
}: {
  label: string; color: string; variant?: "solid" | "soft";
}) {
  const style = variant === "soft"
    ? { backgroundColor: color + "20", color }
    : { backgroundColor: color + "20", color };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium" style={style}>
      {label}
    </span>
  );
}

export function ColorDot({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <span
      className="inline-block rounded-full flex-shrink-0"
      style={{ width: size, height: size, backgroundColor: color }}
    />
  );
}

export function EmptyState({
  icon: Icon, title, subtitle, action,
}: {
  icon: React.ElementType; title: string; subtitle?: string; action?: { label: string; onPress: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
        <Icon size={28} className="text-muted-foreground" />
      </div>
      <div>
        <p className="font-semibold text-foreground">{title}</p>
        {subtitle && <p className="text-sm text-muted-foreground mt-1 max-w-xs">{subtitle}</p>}
      </div>
      {action && (
        <Button label={action.label} onClick={action.onPress} variant="primary" size="sm" />
      )}
    </div>
  );
}

export function SectionHeader({
  title, action,
}: {
  title: string; action?: { label: string; onPress: () => void };
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{title}</span>
      {action && (
        <button onClick={action.onPress} className="text-xs font-medium text-primary hover:underline">
          {action.label}
        </button>
      )}
    </div>
  );
}

export function ColorPicker({
  value, onChange, colors,
}: {
  value: string; onChange: (c: string) => void; colors: string[];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map(c => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className="w-8 h-8 rounded-full transition-all"
          style={{
            backgroundColor: c,
            outline: value === c ? `3px solid ${c}` : "none",
            outlineOffset: "2px",
          }}
        />
      ))}
    </div>
  );
}

export function MonthPicker({
  value, onChange,
}: {
  value: number; onChange: (m: number) => void;
}) {
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return (
    <div className="flex flex-wrap gap-1.5">
      {months.map(m => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={cn(
            "px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
            value === m ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80",
          )}
        >
          {names[m - 1]}
        </button>
      ))}
    </div>
  );
}

export function YearPicker({
  value, onChange,
}: {
  value: number; onChange: (y: number) => void;
}) {
  const years = [2024, 2025, 2026, 2027];
  return (
    <div className="flex gap-2">
      {years.map(y => (
        <button
          key={y}
          onClick={() => onChange(y)}
          className={cn(
            "px-4 py-1.5 rounded-full text-sm font-medium transition-colors",
            value === y ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80",
          )}
        >
          {y}
        </button>
      ))}
    </div>
  );
}

export function AccountPicker({
  accounts, value, onChange, label = "Account", optional = true,
}: {
  accounts: Account[];
  value: number | null;
  onChange: (id: number | null) => void;
  label?: string;
  optional?: boolean;
}) {
  if (accounts.length === 0) return null;
  return (
    <div>
      <label className="text-sm font-medium text-muted-foreground block mb-2">{label}</label>
      <div className="flex flex-wrap gap-2">
        {optional && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className={cn(
              "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
              value === null
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border bg-card text-foreground hover:border-primary/40",
            )}
          >
            None
          </button>
        )}
        {accounts.map(acc => (
          <button
            key={acc.id}
            type="button"
            onClick={() => onChange(acc.id)}
            className={cn(
              "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors capitalize",
              value === acc.id
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border bg-card text-foreground hover:border-primary/40",
            )}
          >
            {acc.name}
            <span className="ml-1 opacity-70 text-xs">({acc.type})</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Confirm({
  visible, onClose, onConfirm, title, message, confirmLabel = "Delete", danger = true,
}: {
  visible: boolean; onClose: () => void; onConfirm: () => void;
  title: string; message: string; confirmLabel?: string; danger?: boolean;
}) {
  if (!visible) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-foreground mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground mb-5">{message}</p>
        <div className="flex gap-2 justify-end">
          <Button label="Cancel" onClick={onClose} variant="secondary" />
          <Button label={confirmLabel} onClick={() => { onConfirm(); onClose(); }} variant={danger ? "danger" : "primary"} />
        </div>
      </div>
    </div>
  );
}
