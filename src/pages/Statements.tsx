import { useState, useRef, useMemo } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useStore, type ImportedTransaction } from "../store";
import type { ImportedStatement } from "../types";
import { formatCurrency, formatDate, getBudgetDateRange } from "../utils";
import { Colors } from "../theme";
import { Card, Button, Input, Modal, SectionHeader, ColorDot, ColorPicker } from "../components/ui";
import { PageHeader } from "../components/Layout";

import {
  Upload, FileText, Check, AlertTriangle, Receipt, Download, Trash2,
  CheckCircle2, XCircle, MinusCircle, Star, Plus, Target, Landmark, FolderPlus, FilePlus, ChevronRight,
  Cloud, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getStatementFolderId, getClientId, getStoredToken, listStatementFiles, downloadFileContent, downloadFileAsBlob, type DriveStatementFile } from "../googledrive";
import { getImportDirHandle, listImportFiles, pickImportFolder } from "../backup";

// pdfjs worker — resolved by Vite (works in dev + local Windows builds)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

// ─── Parsers ──────────────────────────────────────────────────────────────────

interface RawTx {
  description: string;
  merchant?: string;
  amount: number;
  date: string;
  isCredit?: true;
  balance?: number;
}

function parseCSV(text: string): RawTx[] {
  const lines = text.trim().split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/"/g, ""));
  const colIdx = (names: string[]) => {
    for (const n of names) {
      const i = header.findIndex(h => h.includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const dateIdx = colIdx(["date", "transaction date", "txn date"]);
  const descIdx = colIdx(["description", "details", "narrative", "payee", "memo"]);
  const amtIdx = colIdx(["debit", "amount", "withdrawal", "debit amount"]);
  const creditIdx = colIdx(["credit", "deposit", "credit amount"]);
  const balanceIdx = colIdx(["balance", "running balance"]);
  if (dateIdx < 0 || descIdx < 0) return [];

  const results: RawTx[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
    const rawDate = cols[dateIdx] ?? "";
    const desc = cols[descIdx] ?? "";
    let amount = 0;
    if (amtIdx >= 0) amount = parseFloat(cols[amtIdx]?.replace(/[^0-9.-]/g, "") ?? "0") || 0;
    if (amount <= 0 && creditIdx >= 0) amount = parseFloat(cols[creditIdx]?.replace(/[^0-9.-]/g, "") ?? "0") || 0;
    if (amount <= 0 || !desc) continue;
    let date = rawDate;
    const d = new Date(rawDate);
    if (!isNaN(d.getTime())) date = d.toISOString().split("T")[0];
    const balance = balanceIdx >= 0 ? parseFloat(cols[balanceIdx]?.replace(/[^0-9.-]/g, "") ?? "") || undefined : undefined;
    results.push({ description: desc, amount: Math.abs(amount), date, balance });
  }
  return results;
}

function parseOFX(text: string): RawTx[] {
  const results: RawTx[] = [];
  const txRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi;
  let match;
  while ((match = txRegex.exec(text))) {
    const block = match[1];
    const getTag = (tag: string) => new RegExp(`<${tag}>(.*?)(?:<|$)`, "i").exec(block)?.[1]?.trim() ?? "";
    const trnType = getTag("TRNTYPE").toUpperCase();
    const amt = parseFloat(getTag("TRNAMT") || "0");
    const dateRaw = getTag("DTPOSTED").substring(0, 8);
    const name = getTag("NAME") || getTag("MEMO");
    if (!name || amt === 0) continue;
    const isDebit = trnType === "DEBIT" || trnType === "PAYMENT" || amt < 0;
    let date = dateRaw;
    if (dateRaw.length === 8) date = `${dateRaw.substring(0, 4)}-${dateRaw.substring(4, 6)}-${dateRaw.substring(6, 8)}`;
    results.push({ description: name, amount: Math.abs(amt), date, isCredit: !isDebit ? true : undefined });
  }
  return results;
}

// ─── ANZ PDF Parser ───────────────────────────────────────────────────────────

interface PdfTextItem {
  str: string;
  x: number;
  y: number;
  pageY: number; // monotonically increasing top-to-bottom across pages
}

async function extractPdfItems(file: File): Promise<PdfTextItem[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const items: PdfTextItem[] = [];
  let pageOffset = 0;

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const item of content.items) {
      if ("str" in item && item.str.trim()) {
        const [, , , , tx, ty] = item.transform as number[];
        items.push({
          str: item.str.trim(),
          x: Math.round(tx),
          y: Math.round(ty),
          pageY: pageOffset + (vp.height - ty), // top-to-bottom
        });
      }
    }
    pageOffset += vp.height + 50; // small gap between pages
  }
  return items;
}

/** Extract account number from PDF text items using wildcard matching. */
function extractAccountInfo(items: PdfTextItem[]): string | null {
  const text = items.map(i => i.str).join(" ");
  // "account" (or "acc") follwed by any characters, then capture digits with separators
  const match = text.match(/\bacc(?:ount)?[:\s#]*([\d][\d\s-]{5,}?)(?:\s|$|[a-z])/i);
  if (match) return match[1].trim().replace(/\s+/g, "").replace(/-/g, "");
  return null;
}

/** Score how well a statement name matches an account name (0–1). */
function nameMatchScore(stmtName: string, accountName: string): number {
  const sig = (s: string) =>
    s.toLowerCase()
      .replace(/[\d,.-]+/g, " ")
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2);
  const sa = sig(stmtName);
  const sb = sig(accountName);
  if (sa.length === 0 || sb.length === 0) return 0;
  const overlap = sa.filter(w => sb.includes(w)).length;
  return overlap / Math.max(sa.length, sb.length);
}

function groupItemsIntoRows(items: PdfTextItem[], tolerance = 4): PdfTextItem[][] {
  const sorted = [...items].sort((a, b) => a.pageY - b.pageY || a.x - b.x);
  const rows: PdfTextItem[][] = [];
  for (const item of sorted) {
    const lastRow = rows[rows.length - 1];
    if (lastRow && Math.abs(item.pageY - lastRow[0].pageY) <= tolerance) {
      lastRow.push(item);
    } else {
      rows.push([item]);
    }
  }
  return rows;
}

// ANZ date patterns: "01 Jan 2025", "29 May" (ANZ Plus), "01/01/2025", etc.
const DATE_PATTERNS = [
  /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/,  // 01 Jan 2025
  /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2})$/,  // 01 Jan 25
  /^(\d{1,2})\s+([A-Za-z]{3})$/,            // 29 May (ANZ Plus Everyday — year inferred)
  /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,         // 01/01/2025
  /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/,         // 01/01/25
];

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function parseDate(str: string, defaultYear?: number): string | null {
  const m0 = DATE_PATTERNS[0].exec(str);
  if (m0) {
    const mon = MONTHS[m0[2].toLowerCase()];
    return mon ? `${m0[3]}-${mon}-${m0[1].padStart(2, "0")}` : null;
  }
  const m1 = DATE_PATTERNS[1].exec(str);
  if (m1) {
    const mon = MONTHS[m1[2].toLowerCase()];
    const yr = parseInt(m1[3]) + 2000;
    return mon ? `${yr}-${mon}-${m1[1].padStart(2, "0")}` : null;
  }
  const m2 = DATE_PATTERNS[2].exec(str);
  if (m2) {
    const mon = MONTHS[m2[2].toLowerCase()];
    const yr = defaultYear ?? new Date().getFullYear();
    return mon ? `${yr}-${mon}-${m2[1].padStart(2, "0")}` : null;
  }
  const m3 = DATE_PATTERNS[3].exec(str);
  if (m3) return `${m3[3]}-${m3[2].padStart(2, "0")}-${m3[1].padStart(2, "0")}`;
  const m4 = DATE_PATTERNS[4].exec(str);
  if (m4) {
    const yr = parseInt(m4[3]) + 2000;
    return `${yr}-${m4[2].padStart(2, "0")}-${m4[1].padStart(2, "0")}`;
  }
  return null;
}

/** Infer statement year from header text (ANZ Plus omits year on transaction rows). */
function inferStatementYear(items: PdfTextItem[]): number {
  const text = items.map(i => i.str).join(" ");

  // Prefer dates that explicitly include a year (skip "29 May" style transaction dates)
  for (const item of items) {
    const s = item.str;
    const hasExplicitYear =
      /\b20\d{2}\b/.test(s) ||
      /\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4}/i.test(s) ||
      /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(s);
    if (!hasExplicitYear) continue;
    const withYear = parseDate(s);
    if (withYear) return parseInt(withYear.slice(0, 4), 10);
  }

  const rangeMatch = /(\d{1,2}\s+[A-Za-z]{3}\s+(20\d{2}))/i.exec(text);
  if (rangeMatch) {
    const parsed = parseDate(rangeMatch[1]);
    if (parsed) return parseInt(parsed.slice(0, 4), 10);
  }

  const yearMatch = /\b(20\d{2})\b/.exec(text);
  if (yearMatch) return parseInt(yearMatch[1], 10);

  return new Date().getFullYear();
}

function isAmountStr(str: string): boolean {
  return /^\$?[\d,]+\.\d{2}$/.test(str.replace(/,/g, ""));
}

function parseAmount(str: string): number {
  return parseFloat(str.replace(/[$,]/g, "")) || 0;
}

async function parseANZPdf(file: File): Promise<RawTx[]> {
  let items: PdfTextItem[];
  try {
    items = await extractPdfItems(file);
  } catch {
    throw new Error("Could not read PDF. Make sure it is a text-based PDF statement (not a scanned image).");
  }

  const rows = groupItemsIntoRows(items);
  const results: RawTx[] = [];
  const statementYear = inferStatementYear(items);

  // Find column x-positions from header row
  let debitColX = -1;
  let creditColX = -1;
  let balanceColX = -1;

  for (const row of rows) {
    const texts = row.map(r => r.str.toLowerCase());
    const hasDate = texts.some(t => t === "date");
    const hasDebit = texts.some(t => t.includes("debit") || t.includes("withdrawal"));
    const hasCredit = texts.some(t => t.includes("credit") || t.includes("deposit"));
    if (hasDate && (hasDebit || hasCredit)) {
      for (const item of row) {
        const t = item.str.toLowerCase();
        if (t.includes("debit") || t.includes("withdrawal")) debitColX = item.x;
        else if (t.includes("credit") || t.includes("deposit")) creditColX = item.x;
        else if (t.includes("balance")) balanceColX = item.x;
      }
      break;
    }
  }

  // Parse transaction rows (multi-line descriptions append to previous row)
  for (const row of rows) {
    const first = row[0].str;
    let txDate: string | null = null;
    let dateEndIdx = 1;

    // Date may be split: "29" + "May" or "01" + "Jan 2025"
    if (/^\d{1,2}$/.test(first) && row.length > 1) {
      const combined = parseDate(`${first} ${row[1].str}`, statementYear);
      if (combined) {
        txDate = combined;
        dateEndIdx = 2;
      }
    }
    if (!txDate) {
      txDate = parseDate(first, statementYear);
      dateEndIdx = 1;
    }

    if (!txDate) {
      // Continuation line — append to previous transaction description
      const extra = row.map(r => r.str).join(" ").trim();
      if (extra && results.length > 0) {
        results[results.length - 1].description += " " + extra;
      }
      continue;
    }

    // Collect amounts and non-amount/non-date items
    const amounts: { value: number; x: number }[] = [];
    const descItems: string[] = [];

    for (let i = dateEndIdx; i < row.length; i++) {
      const item = row[i];
      if (isAmountStr(item.str)) {
        amounts.push({ value: parseAmount(item.str), x: item.x });
      } else if (!/^(dr|cr|debit|credit)$/i.test(item.str)) {
        descItems.push(item.str);
      }
    }

    if (amounts.length === 0 || descItems.length === 0) continue;

    // Determine if this is a debit or credit transaction
    let debitAmount: number | null = null;
    let creditAmount: number | null = null;
    let balance: number | null = null;

    if (debitColX > 0 || creditColX > 0) {
      for (const a of amounts) {
        if (balanceColX > 0 && Math.abs(a.x - balanceColX) < 30) { balance = a.value; continue; }
        if (debitColX > 0 && Math.abs(a.x - debitColX) < 40) debitAmount = a.value;
        else if (creditColX > 0 && Math.abs(a.x - creditColX) < 40) creditAmount = a.value;
      }
    } else {
      const rowText = row.map(r => r.str).join(" ");
      const isDr = /\bDR\b/i.test(rowText);
      const isCr = /\bCR\b/i.test(rowText);
      const amt = amounts[0]?.value ?? 0;
      if (isCr) creditAmount = amt;
      else debitAmount = amt;
    }

    const description = descItems.join(" ").replace(/\s+/g, " ").trim();
    if (!description) continue;

    const tx = { description, date: txDate, balance: balance ?? undefined };
    if (debitAmount && debitAmount > 0) {
      results.push({ ...tx, amount: debitAmount });
    } else if (creditAmount && creditAmount > 0) {
      results.push({ ...tx, amount: creditAmount, isCredit: true });
    }
  }

  return results;
}

// ─── Target Select (categories + goals) ──────────────────────────────────────

function TargetSelect({ categoryId, goalId, goalWithdrawalId, onChange, categories, goals, disabled, onCreateGoal, onCreateCategory, onCreateRule, holdingId, incomeSourceName, holdings, isHouseholdTransfer }: {
  categoryId: number | null;
  goalId: number | null;
  goalWithdrawalId?: number;
  onChange: (patch: { categoryId: number | null; goalId: number | null; goalWithdrawalId?: number; holdingId?: number; incomeSourceName?: string; isHouseholdTransfer?: boolean }) => void;
  categories: { id: number; name: string; color: string }[];
  goals: { id: number; name: string; color: string }[];
  disabled?: boolean;
  onCreateGoal?: () => void;
  onCreateCategory?: () => void;
  onCreateRule?: () => void;
  holdingId?: number;
  incomeSourceName?: string;
  holdings?: { id: number; symbol: string; name: string }[];
  isHouseholdTransfer?: boolean;
}) {
  const value = isHouseholdTransfer ? "transfer"
    : categoryId != null ? `cat:${categoryId}`
    : goalId != null ? `goal:${goalId}`
    : goalWithdrawalId != null ? `wdr:${goalWithdrawalId}`
    : holdingId != null ? `hold:${holdingId}`
    : incomeSourceName != null ? `inc:${incomeSourceName}`
    : "";
  const unassigned = !disabled && categoryId === null && goalId === null && goalWithdrawalId == null && holdingId == null && incomeSourceName == null && !isHouseholdTransfer;

  const handleChange = (v: string) => {
    if (!v) onChange({ categoryId: null, goalId: null, goalWithdrawalId: undefined, holdingId: undefined, incomeSourceName: undefined, isHouseholdTransfer: false });
    else if (v === "transfer") onChange({ categoryId: null, goalId: null, goalWithdrawalId: undefined, holdingId: undefined, incomeSourceName: undefined, isHouseholdTransfer: true });
    else if (v.startsWith("cat:")) onChange({ categoryId: Number(v.slice(4)), goalId: null, goalWithdrawalId: undefined, holdingId: undefined, incomeSourceName: undefined, isHouseholdTransfer: false });
    else if (v.startsWith("goal:")) onChange({ categoryId: null, goalId: Number(v.slice(5)), goalWithdrawalId: undefined, holdingId: undefined, incomeSourceName: undefined, isHouseholdTransfer: false });
    else if (v.startsWith("wdr:")) onChange({ categoryId: null, goalId: null, goalWithdrawalId: Number(v.slice(4)), holdingId: undefined, incomeSourceName: undefined, isHouseholdTransfer: false });
    else if (v.startsWith("hold:")) onChange({ categoryId: null, goalId: null, goalWithdrawalId: undefined, holdingId: Number(v.slice(5)), incomeSourceName: undefined, isHouseholdTransfer: false });
    else if (v.startsWith("inc:")) onChange({ categoryId: null, goalId: null, goalWithdrawalId: undefined, holdingId: undefined, incomeSourceName: v.slice(4), isHouseholdTransfer: false });
  };

  return (
    <div className="flex gap-1.5">
      <select
        disabled={disabled}
        value={value}
        onChange={e => handleChange(e.target.value)}
        className={cn(
          "flex-1 text-xs rounded-lg border border-border bg-background px-2 py-1.5",
          "text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          unassigned && "border-warning/60 bg-warning/5",
        )}
      >
        <option value="">— Assign to… —</option>
        {categories.length > 0 && (
          <optgroup label="Budget Categories">
            {[...categories].sort((a, b) => a.name.localeCompare(b.name)).map(c => <option key={`cat:${c.id}`} value={`cat:${c.id}`}>{c.name}</option>)}
          </optgroup>
        )}
        {goals.length > 0 && (
          <optgroup label="Goal Contributions">
            {goals.map(g => <option key={`goal:${g.id}`} value={`goal:${g.id}`}>⭐ {g.name}</option>)}
          </optgroup>
        )}
        {goals.length > 0 && (
          <optgroup label="Goal Withdrawals">
            {goals.map(g => <option key={`wdr:${g.id}`} value={`wdr:${g.id}`}>🔻 {g.name}</option>)}
          </optgroup>
        )}
        {holdings && holdings.length > 0 && (
          <optgroup label="Investments">
            {holdings.map(h => <option key={`hold:${h.id}`} value={`hold:${h.id}`}>📈 {h.name} ({h.symbol})</option>)}
          </optgroup>
        )}
        <optgroup label="Income">
          <option value="inc:Salary">💰 Salary</option>
          <option value="inc:Interest">🏦 Interest</option>
          <option value="inc:Dividends">📊 Dividends</option>
          <option value="inc:Other Income">💵 Other Income</option>
        </optgroup>
        <optgroup label="Transfers">
          <option value="transfer">🏠 Household Transfer</option>
        </optgroup>
      </select>
      <div className="flex gap-1">
        {onCreateCategory && (
          <button
            onClick={onCreateCategory}
            className="flex-shrink-0 w-7 h-7 rounded-lg border border-dashed border-border flex items-center justify-center hover:border-primary hover:text-primary transition-colors text-muted-foreground"
            title="New category"
          >
            <FolderPlus size={13} />
          </button>
        )}
        {onCreateGoal && (
          <button
            onClick={onCreateGoal}
            className="flex-shrink-0 w-7 h-7 rounded-lg border border-dashed border-border flex items-center justify-center hover:border-primary hover:text-primary transition-colors text-muted-foreground"
            title="New goal"
          >
            <Plus size={13} />
          </button>
        )}
        {onCreateRule && (
          <button
            onClick={onCreateRule}
            className="flex-shrink-0 w-7 h-7 rounded-lg border border-dashed border-border flex items-center justify-center hover:border-primary hover:text-primary transition-colors text-muted-foreground"
            title="Add mapping rule"
          >
            <FilePlus size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Smart description matching ──────────────────────────────────────────────

/** Strip dates, numbers, special chars, keeping only significant words. */
function descriptionsMatch(a: string, b: string): boolean {
  const words = (s: string) =>
    s.toLowerCase()
      .replace(/\b\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\b/g, "")
      .replace(/[\d,.-]+/g, "")
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2);
  const wa = words(a);
  const wb = words(b);
  if (wa.length === 0 || wb.length === 0) return false;
  const overlap = wa.filter(w => wb.includes(w)).length;
  return overlap / Math.min(wa.length, wb.length) >= 0.5;
}

// ─── Bank Rule Quick Form ─────────────────────────────────────────────────────

function RuleForm({
  initialKeyword, initialCategoryId, initialGoalId, initialSkip, initialTransferToAccountId,
  initialHoldingId, initialIncomeSourceName, initialGoalWithdrawalId,
  categories, goals, accounts, holdings, onSave, onCancel,
}: {
  initialKeyword: string;
  initialCategoryId: number | null;
  initialGoalId: number | null;
  initialSkip: boolean;
  initialTransferToAccountId?: number;
  initialHoldingId?: number;
  initialIncomeSourceName?: string;
  initialIsHouseholdTransfer?: boolean;
  initialGoalWithdrawalId?: number;
  categories: { id: number; name: string; color: string }[];
  goals: { id: number; name: string; color: string }[];
  accounts: { id: number; name: string }[];
  holdings?: { id: number; symbol: string; name: string }[];
  onSave: (keyword: string, routeTo: "category" | "goal" | "goalWithdrawal" | "skip" | "holding" | "income" | "householdTransfer", categoryName?: string, goalId?: number, transferToAccountId?: number, holdingId?: number, incomeSourceName?: string) => void;
  onCancel: () => void;
}) {
  const [keyword, setKeyword] = useState(initialKeyword.split(" ").slice(0, 3).join(" "));
  const [routeTo, setRouteTo] = useState<"category" | "goal" | "goalWithdrawal" | "skip" | "holding" | "income" | "householdTransfer">(
    initialGoalWithdrawalId != null ? "goalWithdrawal" : initialIsHouseholdTransfer ? "householdTransfer" : initialSkip ? "skip" : initialGoalId != null ? "goal" : initialCategoryId != null ? "category" : initialHoldingId != null ? "holding" : initialIncomeSourceName != null ? "income" : "category",
  );
  const [catId, setCatId] = useState(initialCategoryId);
  const [gId, setGId] = useState(initialGoalId);
  const [transferAccId, setTransferAccId] = useState(initialTransferToAccountId);
  const [holdId, setHoldId] = useState(initialHoldingId);
  const [incomeName, setIncomeName] = useState(initialIncomeSourceName ?? "Salary");

  const save = () => {
    if (!keyword.trim()) { toast.error("Keyword required"); return; }
    if (routeTo === "householdTransfer") {
      onSave(keyword.trim(), "householdTransfer");
    } else if (routeTo === "skip") {
      onSave(keyword.trim(), "skip", undefined, undefined, transferAccId);
    } else if (routeTo === "category") {
      const cat = categories.find(c => c.id === catId);
      if (!cat) { toast.error("Select a category"); return; }
      onSave(keyword.trim(), "category", cat.name);
    } else if (routeTo === "goal") {
      if (gId == null) { toast.error("Select a goal"); return; }
      onSave(keyword.trim(), "goal", undefined, gId);
    } else if (routeTo === "goalWithdrawal") {
      if (gId == null) { toast.error("Select a goal"); return; }
      onSave(keyword.trim(), "goalWithdrawal", undefined, gId);
    } else if (routeTo === "holding") {
      if (holdId == null) { toast.error("Select an investment"); return; }
      onSave(keyword.trim(), "holding", undefined, undefined, undefined, holdId);
    } else if (routeTo === "income") {
      if (!incomeName.trim()) { toast.error("Enter income source name"); return; }
      onSave(keyword.trim(), "income", undefined, undefined, undefined, undefined, incomeName.trim());
    }
  };

  return (
    <div className="space-y-4">
      <Input label="Transaction Keyword" value={keyword} onChange={setKeyword} placeholder="e.g. ROUND UP TO SAVINGS" autoFocus />
      <div>
        <label className="text-sm font-medium text-muted-foreground block mb-2">Route To</label>
        <div className="flex flex-wrap gap-2">
          {(["category", "goal", "goalWithdrawal", "skip", "holding", "income", "householdTransfer"] as const).map(t => (
            <button key={t} onClick={() => { setRouteTo(t); if (t !== "skip") setTransferAccId(undefined); }}
              className={cn(
                "px-4 py-2 rounded-full text-sm font-medium capitalize transition-colors",
                routeTo === t ? (t === "skip" ? "bg-destructive text-destructive-foreground" : t === "income" ? "bg-success text-success-foreground" : t === "householdTransfer" ? "bg-primary text-primary-foreground" : t === "goalWithdrawal" ? "bg-chart-2 text-white" : "bg-primary text-primary-foreground") : "bg-muted text-foreground hover:bg-muted/80",
              )}>
              {t === "goal" ? "⭐ Goal" : t === "goalWithdrawal" ? "🔻 Withdraw" : t === "skip" ? "⏭ Skip" : t === "holding" ? "📈 Invest" : t === "income" ? "💰 Income" : t === "householdTransfer" ? "🏠 Household Transfer" : t}
            </button>
          ))}
        </div>
      </div>
      {routeTo === "category" && (
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Category</label>
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">No categories — add one first.</p>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto scrollbar-thin">
              {[...categories].sort((a, b) => a.name.localeCompare(b.name)).map(c => (
                <button key={c.id} onClick={() => setCatId(c.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
                    catId === c.id ? "bg-primary text-primary-foreground border-primary" : "border-border bg-card text-foreground hover:border-primary/40",
                  )}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {routeTo === "goal" && (
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Goal</label>
          {goals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No goals — create one first.</p>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto scrollbar-thin">
              {goals.map(g => (
                <button key={g.id} onClick={() => setGId(g.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
                    gId === g.id ? "bg-primary text-primary-foreground border-primary" : "border-border bg-card text-foreground hover:border-primary/40",
                  )}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0 inline-block" style={{ backgroundColor: g.color }} />
                  <span className="ml-1">⭐ {g.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {routeTo === "goalWithdrawal" && (
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Goal (withdraw from)</label>
          {goals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No goals — create one first.</p>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto scrollbar-thin">
              {goals.map(g => (
                <button key={g.id} onClick={() => setGId(g.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
                    gId === g.id ? "bg-chart-2 text-white border-chart-2" : "border-border bg-card text-foreground hover:border-chart-2/40",
                  )}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0 inline-block" style={{ backgroundColor: g.color }} />
                  <span className="ml-1">🔻 {g.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {routeTo === "skip" && (
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Transfer to Account (optional)</label>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accounts — add one in Settings.</p>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto scrollbar-thin">
              {accounts.map(a => (
                <button key={a.id} onClick={() => setTransferAccId(transferAccId === a.id ? undefined : a.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
                    transferAccId === a.id ? "bg-destructive text-destructive-foreground border-destructive" : "border-border bg-card text-foreground hover:border-destructive/40",
                  )}>
                  <Landmark size={13} />
                  {a.name}
                </button>
              ))}
            </div>
          )}
          {transferAccId != null && (
            <p className="text-xs text-success mt-1">
              A debit on the importing account and a credit on the destination account will be recorded.
            </p>
          )}
        </div>
      )}
      {routeTo === "holding" && (
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Investment</label>
          {!holdings || holdings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No investments — add one on the Investments page first.</p>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto scrollbar-thin">
              {holdings.map(h => (
                <button key={h.id} onClick={() => setHoldId(h.id)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
                    holdId === h.id ? "bg-primary text-primary-foreground border-primary" : "border-border bg-card text-foreground hover:border-primary/40",
                  )}>
                  📈 {h.name} ({h.symbol})
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {routeTo === "income" && (
        <Input label="Income Source Name" value={incomeName} onChange={setIncomeName} placeholder="e.g. Salary, Interest" />
      )}
      <p className="text-xs text-muted-foreground">
        {routeTo === "skip"
          ? "Transactions containing this keyword will be automatically skipped."
          : routeTo === "category"
          ? "Transactions containing this keyword will be auto-assigned to this category."
          : routeTo === "goal"
          ? "Transactions containing this keyword will contribute to the selected goal."
          : routeTo === "holding"
          ? "Transactions containing this keyword will create an investment buy transaction."
          : routeTo === "income"
          ? "Transactions containing this keyword will be recorded as income instead of expenses."
          : "Transactions containing this keyword will be marked as household transfers (no expense created)."}
      </p>
      <div className="flex gap-2 pt-1">
        <Button label="Cancel" onClick={onCancel} variant="secondary" fullWidth />
        <Button label="Add Rule" onClick={save} variant="primary" fullWidth />
      </div>
    </div>
  );
}

// ─── Import Review ────────────────────────────────────────────────────────────

function ImportReview({ fileName, rows, onChange, onConfirm, onCancel, categories, goals, accounts, accountId, onAccountChange, onCreateGoal, onCreateCategory, onCreateRule, holdings, detectedAccountInfo, endingBalance, onEndingBalanceChange, currentAccountBalance }: {
  fileName: string;
  rows: ImportedTransaction[];
  onChange: (updated: ImportedTransaction[]) => void;
  onConfirm: () => void;
  onCancel: () => void;
  categories: { id: number; name: string; color: string }[];
  goals: { id: number; name: string; color: string }[];
  accounts: { id: number; name: string }[];
  accountId: number | null;
  onAccountChange: (id: number | null) => void;
  onCreateGoal?: () => void;
  onCreateCategory?: () => void;
  onCreateRule?: (row: ImportedTransaction) => void;
  holdings?: { id: number; symbol: string; name: string }[];
  endingBalance?: string;
  onEndingBalanceChange?: (v: string) => void;
  currentAccountBalance?: number;
  detectedAccountInfo?: { number: string; matchedAccountId?: number; matchedByName?: boolean } | null;
}) {
  const autoCount = rows.filter(r => r.autoMatched && !r.skip && !r.isHouseholdTransfer).length;
  const needsReview = rows.filter(r => !r.skip && !r.isHouseholdTransfer && r.categoryId === null && r.goalId === null && r.goalWithdrawalId == null && r.holdingId == null && r.incomeSourceName == null).length;
  const skipCount = rows.filter(r => r.skip).length;
  const goalCount = rows.filter(r => !r.skip && (r.goalId !== null || r.goalWithdrawalId != null)).length;
  const transferCount = rows.filter(r => r.isHouseholdTransfer).length;
  const toImport = rows.filter(r => !r.skip && !r.isHouseholdTransfer).length;

  // Compute withdrawal-merchant pairings for preview
  const withdrawalPairs = (() => {
    const pairs: { withdrawalIdx: number; merchantIdx: number; goalId: number }[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].goalWithdrawalId == null || rows[i].skip) continue;
      for (let j = 0; j < rows.length; j++) {
        if (i === j) continue;
        const m = rows[j];
        if (m.skip || m.isHouseholdTransfer || m.isCredit || m.transferToAccountId != null || m.incomeSourceName != null || m.holdingId != null || m.goalId != null || m.goalWithdrawalId != null) continue;
        if (m.date !== rows[i].date) continue;
        const ratio = Math.abs(m.amount - rows[i].amount) / Math.max(m.amount, rows[i].amount);
        if (ratio > 0.1) continue;
        pairs.push({ withdrawalIdx: i, merchantIdx: j, goalId: rows[i].goalWithdrawalId });
        break;
      }
    }
    return pairs;
  })();
  const pairedMerchantIndices = new Set(withdrawalPairs.map(p => p.merchantIdx));
  const pairedWithdrawalIndices = new Set(withdrawalPairs.map(p => p.withdrawalIdx));

  const update = (i: number, patch: Partial<ImportedTransaction>) => {
    const hasAssignment = patch.categoryId != null || patch.goalId != null || patch.goalWithdrawalId != null || patch.holdingId != null || patch.incomeSourceName != null || patch.isHouseholdTransfer === true;
    if (hasAssignment) {
      const src = rows[i];
      onChange(rows.map((r, idx) => {
        if (idx === i) {
          // When setting household transfer, clear other assignments
          if (patch.isHouseholdTransfer) {
            return { ...r, categoryId: null, goalId: null, goalWithdrawalId: undefined, holdingId: undefined, incomeSourceName: undefined, skip: false, isHouseholdTransfer: true, autoMatched: false };
          }
          return { ...r, ...patch, autoMatched: false };
        }
        // Auto-match other unassigned rows with similar descriptions (skip for transfers)
        if (r.skip || r.isHouseholdTransfer || r.categoryId != null || r.goalId != null || r.goalWithdrawalId != null || r.holdingId != null || r.incomeSourceName != null) return r;
        return descriptionsMatch(src.description, r.description)
          ? { ...r, ...patch, autoMatched: true }
          : r;
      }));
      return;
    }
    // When unassigning (v === ""), clear isHouseholdTransfer too
    if (patch.isHouseholdTransfer === false) {
      onChange(rows.map((r, idx) => idx === i ? { ...r, isHouseholdTransfer: false } : r));
      return;
    }
    onChange(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  };

  return (
    <div className="space-y-4">
      {/* Summary chips */}
      <div className="flex flex-wrap gap-2">
        {(() => { const n = rows.filter(r => r.isCredit && !r.skip).length; return n > 0 ? <span className="flex items-center gap-1.5 bg-success/10 text-success text-xs font-medium px-2.5 py-1.5 rounded-full"><CheckCircle2 size={12} />{n} credit</span> : null; })()}
        {autoCount > 0 && (
          <span className="flex items-center gap-1.5 bg-success/10 text-success text-xs font-medium px-2.5 py-1.5 rounded-full">
            <CheckCircle2 size={12} />{autoCount} auto-matched
          </span>
        )}
        {goalCount > 0 && (
          <span className="flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-medium px-2.5 py-1.5 rounded-full">
            <Star size={12} />{goalCount} → goal
          </span>
        )}
        {withdrawalPairs.length > 0 && (
          <span className="flex items-center gap-1.5 bg-chart-2/10 text-chart-2 text-xs font-medium px-2.5 py-1.5 rounded-full">
            <CheckCircle2 size={12} />{withdrawalPairs.length} w/d paired
          </span>
        )}
        {needsReview > 0 && (
          <span className="flex items-center gap-1.5 bg-warning/10 text-warning text-xs font-medium px-2.5 py-1.5 rounded-full">
            <AlertTriangle size={12} />{needsReview} unassigned
          </span>
        )}
        {skipCount > 0 && (
          <span className="flex items-center gap-1.5 bg-muted text-muted-foreground text-xs font-medium px-2.5 py-1.5 rounded-full">
            <MinusCircle size={12} />{skipCount} skipped
          </span>
        )}
        {transferCount > 0 && (
          <span className="flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-medium px-2.5 py-1.5 rounded-full">
            <Landmark size={12} />{transferCount} transferred
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{fileName}</span> — {rows.length} transactions.{" "}
        Assign each to a budget category or savings goal. Assignments are remembered for next time.
      </p>

      {accounts.length > 0 && (
        <div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground flex-shrink-0">Link to account:</label>
            <select
              value={accountId ?? ""}
              onChange={e => onAccountChange(e.target.value ? Number(e.target.value) : null)}
              className="flex-1 text-xs rounded-lg border border-border bg-background px-2 py-1.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
            >
              <option value="">— Not linked —</option>
              {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
            </select>
            {accountId != null && rows.some(r => r.balance != null) && (
              <span className="text-[10px] text-muted-foreground">
                Balance will be updated from last transaction
              </span>
            )}
          </div>
          {detectedAccountInfo && !detectedAccountInfo.matchedAccountId && detectedAccountInfo.number && (
            <p className="text-xs text-muted-foreground mt-1.5">
              Detected account: <span className="font-mono text-foreground">{detectedAccountInfo.number}</span>
              {" "}— select the matching account above, or{" "}
              <button onClick={() => onAccountChange(null)} className="underline text-primary">ignore</button>
            </p>
          )}
          {accountId != null && onEndingBalanceChange && (
            <div className="flex items-center gap-2 mt-2">
              <label className="text-xs text-muted-foreground flex-shrink-0">Ending balance:</label>
              <input type="text" value={endingBalance ?? ""} onChange={e => onEndingBalanceChange(e.target.value)}
                className="flex-1 text-xs rounded-lg border border-border bg-background px-2 py-1.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors w-28"
                placeholder="0.00" />
              {currentAccountBalance != null && (
                <span className="text-[10px] text-muted-foreground">
                  Current: {formatCurrency(currentAccountBalance)}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="space-y-2 max-h-[50vh] overflow-y-auto scrollbar-thin pr-1">
        {rows.map((row, i) => {
          const assigned = row.categoryId !== null || row.goalId !== null || row.goalWithdrawalId != null;
          const isGoal = row.goalId !== null;
          const isWithdrawal = row.goalWithdrawalId != null;
          const isTransfer = row.isHouseholdTransfer;
          return (
            <div key={i} className={cn(
              "rounded-xl border p-3 transition-colors",
              row.skip ? "border-border bg-muted/40 opacity-50"
                : isTransfer ? "border-primary/40 bg-primary/5"
                  : row.isCredit ? "border-success/30 bg-success/5"
                    : !assigned ? "border-warning/40 bg-warning/5"
                      : isGoal ? "border-primary/30 bg-primary/5"
                        : isWithdrawal ? "border-chart-2/30 bg-chart-2/5"
                          : row.autoMatched ? "border-success/30 bg-success/5"
                            : "border-border bg-card",
            )}>
              <div className="flex items-start gap-2">
                {isTransfer ? (
                  <div className="mt-0.5 flex-shrink-0">
                    <Landmark size={16} className="text-primary" />
                  </div>
                ) : (
                  <button onClick={() => update(i, { skip: !row.skip })} className="mt-0.5 flex-shrink-0" title={row.skip ? "Include" : "Skip"}>
                    {row.skip
                      ? <XCircle size={16} className="text-muted-foreground" />
                      : <CheckCircle2 size={16} className={!assigned ? "text-warning" : isGoal ? "text-primary" : isWithdrawal ? "text-chart-2" : "text-success"} />}
                  </button>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 mb-1.5">
                    <span className="text-sm font-medium text-foreground truncate">{row.description}</span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {row.isCredit && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-success/10 text-success">Credit</span>}
                      <span className="text-sm font-bold text-foreground">{formatCurrency(row.amount)}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <span className="text-xs text-muted-foreground">
                      {formatDate(row.date)}
                      {row.balance != null && <span className="ml-2 text-[10px] text-muted-foreground/60">bal: {formatCurrency(row.balance)}</span>}
                    </span>
                    <div className="flex items-center gap-1">
                      {row.isHouseholdTransfer ? (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full text-primary bg-primary/10">
                          🏠 Household Transfer
                        </span>
                      ) : row.transferToAccountId != null ? (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full text-destructive bg-destructive/10">
                          ⏭ Transfer → {accounts.find(a => a.id === row.transferToAccountId)?.name ?? "?"}
                        </span>
                      ) : row.autoMatched && !row.skip ? (
                        <span className={cn(
                          "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                          isGoal ? "text-primary bg-primary/10" : isWithdrawal ? "text-chart-2 bg-chart-2/10" : "text-success bg-success/10",
                        )}>
                          {isGoal ? "auto → goal" : isWithdrawal ? "auto → withdrawal" : "auto-matched"}
                        </span>
                      ) : row.skip ? (
                        <span className={cn(
                          "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                          row.autoMatched ? "text-destructive bg-destructive/10" : "text-muted-foreground bg-muted/30",
                        )}>
                          {row.autoMatched ? "⏭ skip rule" : "will skip"}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {/* Show pairing indicators */}
                  {pairedWithdrawalIndices.has(i) && (() => {
                    const pair = withdrawalPairs.find(p => p.withdrawalIdx === i);
                    if (!pair) return null;
                    const merchant = rows[pair.merchantIdx];
                    const goal = goals.find(g => g.id === pair.goalId);
                    return (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground">
                          Paired with "<span className="text-foreground font-medium">{merchant.description}</span>"
                          {goal && <span> → funded by <span className="text-foreground font-medium">{goal.name}</span></span>}
                        </span>
                        <button
                          onClick={() => update(i, { goalWithdrawalId: undefined })}
                          className="text-[10px] text-primary hover:underline"
                          title="Break pair and create withdrawal expense instead"
                        >
                          Break
                        </button>
                      </div>
                    );
                  })()}
                  {pairedMerchantIndices.has(i) && (() => {
                    const pair = withdrawalPairs.find(p => p.merchantIdx === i);
                    if (!pair) return null;
                    const wd = rows[pair.withdrawalIdx];
                    const goal = goals.find(g => g.id === pair.goalId);
                    return (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="text-[10px] text-muted-foreground">
                          💰 Funded by {goal ? <span className="text-foreground font-medium">{goal.name}</span> : "goal"}
                          {" (from "}<span className="text-foreground font-medium">{wd.description}</span>)
                        </span>
                      </div>
                    );
                  })()}
                  {row.transferToAccountId != null ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground font-medium">Transfer to:</span>
                      {accounts.map(acc => (
                        <button key={acc.id} onClick={() => update(i, { transferToAccountId: row.transferToAccountId === acc.id ? undefined : acc.id })}
                          className={cn(
                            "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors",
                            row.transferToAccountId === acc.id
                              ? "bg-destructive text-destructive-foreground border-destructive"
                              : "border-border bg-card text-foreground hover:border-destructive/40",
                          )}>
                          <Landmark size={10} />
                          {acc.name}
                        </button>
                      ))}
                      <button onClick={() => update(i, { transferToAccountId: undefined })}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border border-border bg-card text-muted-foreground hover:text-foreground">
                        <XCircle size={10} />
                        Remove
                      </button>
                    </div>
                  ) : row.skip && !row.isCredit && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground font-medium">Transfer to (optional):</span>
                      {accounts.length === 0 ? (
                        <span className="text-[10px] text-muted-foreground">No accounts</span>
                      ) : (
                        accounts.map(acc => (
                          <button key={acc.id} onClick={() => update(i, { transferToAccountId: acc.id })}
                            className={cn(
                              "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors",
                              "border-border bg-card text-foreground hover:border-destructive/40",
                            )}>
                            <Landmark size={10} />
                            {acc.name}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                  {!row.skip && !row.isHouseholdTransfer && row.transferToAccountId == null && (
                    <TargetSelect
                      categoryId={row.categoryId}
                      goalId={row.goalId}
                      goalWithdrawalId={row.goalWithdrawalId}
                      holdingId={row.holdingId}
                      incomeSourceName={row.incomeSourceName}
                      isHouseholdTransfer={false}
                      onChange={patch => update(i, { ...patch, autoMatched: false })}
                      categories={categories}
                      goals={goals}
                      holdings={holdings}
                      onCreateGoal={onCreateGoal}
                      onCreateCategory={onCreateCategory}
                      onCreateRule={() => onCreateRule?.(row)}
                    />
                  )}
                  {row.goalId != null && row.goalWithdrawalId == null && !row.skip && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground font-medium">Budget category (optional):</span>
                      {categories.length === 0 ? (
                        <span className="text-[10px] text-muted-foreground">No categories</span>
                      ) : (
                        [...categories].sort((a, b) => a.name.localeCompare(b.name)).map(cat => (
                          <button
                            key={cat.id}
                            onClick={() => update(i, { categoryId: row.categoryId === cat.id ? null : cat.id, autoMatched: false })}
                            className={cn(
                              "flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors",
                              row.categoryId === cat.id
                                ? "border-transparent text-white"
                                : "border-border bg-card text-foreground hover:border-primary/40",
                            )}
                            style={row.categoryId === cat.id ? { backgroundColor: cat.color } : undefined}
                          >
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: row.categoryId === cat.id ? "white" : cat.color }} />
                            {cat.name}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between pt-1 border-t border-border">
        <span className="text-xs text-muted-foreground">{toImport} will be imported · assignments auto-saved as rules</span>
        <div className="flex gap-2">
          <Button label="Cancel" onClick={onCancel} variant="secondary" size="sm" />
          <Button label={`Import ${toImport}`} onClick={onConfirm} variant="primary" size="sm" icon={Check} disabled={toImport === 0} />
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function StatementsPage() {
  const {
    budgets, expenses, activeBudgetId, categories, goals, holdings,
    previewImport, commitImport, deleteImportedStatement, upsertBankRule, importedStatements, accounts,
  } = useStore();

  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [reviewRows, setReviewRows] = useState<ImportedTransaction[] | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; goalContributions: number; transferred: number } | null>(null);
  const [parsePending, setParsePending] = useState(false);
  const [importAccountId, setImportAccountId] = useState<number | null>(null);
  const [importEndingBalance, setImportEndingBalance] = useState<string>("");
  const [importBalanceDate, setImportBalanceDate] = useState<string>("");
  const [detectedAccountInfo, setDetectedAccountInfo] = useState<{ number: string; matchedAccountId?: number; matchedByName?: boolean } | null>(null);
  const [deleteConfirmStmt, setDeleteConfirmStmt] = useState<ImportedStatement | null>(null);
  const [duplicateFileConfirm, setDuplicateFileConfirm] = useState<{ fileName: string; existingStmt: ImportedStatement; file: File } | null>(null);
  const [expandedImports, setExpandedImports] = useState<Set<number>>(new Set());
  const [parsedTxs, setParsedTxs] = useState<RawTx[] | null>(null);
  const [ruleModalData, setRuleModalData] = useState<{
    description: string;
    categoryId: number | null;
    goalId: number | null;
    goalWithdrawalId?: number;
    skip: boolean;
    transferToAccountId?: number;
    holdingId?: number;
    incomeSourceName?: string;
    isHouseholdTransfer?: boolean;
  } | null>(null);

  // Drive import state
  const [driveFiles, setDriveFiles] = useState<DriveStatementFile[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [selectedDriveFiles, setSelectedDriveFiles] = useState<Set<string>>(new Set());
  const [importingFromDrive, setImportingFromDrive] = useState(false);

  // Local folder import state
  const [localFiles, setLocalFiles] = useState<Awaited<ReturnType<typeof listImportFiles>> | null>(null);
  const [selectedLocalFiles, setSelectedLocalFiles] = useState<Set<string>>(new Set());
  const [importingLocal, setImportingLocal] = useState(false);

  const proceedWithDuplicateImport = async (file: File) => {
    setDuplicateFileConfirm(null);
    setParsePending(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      let txs: RawTx[] = [];
      let detectedAcct: string | null = null;
      if (ext === "csv") {
        txs = parseCSV(await file.text());
      } else if (ext === "ofx" || ext === "qfx") {
        txs = parseOFX(await file.text());
      } else if (ext === "pdf") {
        txs = await parseANZPdf(file);
        try {
          const items = await extractPdfItems(file);
          detectedAcct = extractAccountInfo(items);
        } catch {}
      } else return;
      if (txs.length === 0) { toast.error("No transactions found."); return; }
      const rows = previewImport(txs, activeBudgetId!);

      const fnDigits = file.name.match(/\d{3,}/);
      const fnNum = fnDigits ? fnDigits.sort((a, b) => b.length - a.length)[0] : null;
      if (fnNum && (!detectedAcct || fnNum.length > detectedAcct.replace(/\D/g, "").length)) detectedAcct = fnNum;

      let matchedId: number | undefined;
      let matchedByName = false;
      if (detectedAcct) {
        const digits = detectedAcct.replace(/\D/g, "");
        const matchByNumber = accounts.find(a => {
          if (!a.accountNumber) return false;
          const acctDigits = a.accountNumber.replace(/\D/g, "");
          return acctDigits.endsWith(digits) || acctDigits.includes(digits) || digits.includes(acctDigits);
        });
        if (matchByNumber) { matchedId = matchByNumber.id; setImportAccountId(matchedId); }
      }
      if (matchedId == null) {
        const stmtName = file.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
        let bestScore = 0;
        let best: (typeof accounts)[number] | null = null;
        for (const acc of accounts) {
          const score = nameMatchScore(stmtName, acc.name);
          if (score > bestScore) { bestScore = score; best = acc; }
        }
        if (best && bestScore >= 0.4) { matchedId = best.id; matchedByName = true; setImportAccountId(matchedId); }
      }
      setDetectedAccountInfo({ number: detectedAcct ?? fnNum ?? "", matchedAccountId: matchedId, matchedByName });

      setFileName(file.name);
      setReviewRows(rows);
      setParsedTxs(txs);
      const lastBal = [...rows].reverse().find(r => r.balance != null);
      setImportEndingBalance(lastBal?.balance != null ? String(lastBal.balance) : "");
      setImportBalanceDate(lastBal?.date ?? "");
    } catch (err) {
      toast.error("Failed to re-import: " + (err as Error).message);
    } finally {
      setParsePending(false);
    }
  };

  const toggleImport = (id: number) => {
    setExpandedImports(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const activeBudget = budgets.find(b => b.id === activeBudgetId);
  const budgetCats = categories.filter(c => c.budgetId === activeBudgetId);

  const [showQuickGoal, setShowQuickGoal] = useState(false);
  const [goalName, setGoalName] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalColor, setGoalColor] = useState(Colors.categoryColors[0]);

  const [showQuickCat, setShowQuickCat] = useState(false);
  const [catName, setCatName] = useState("");
  const [catAlloc, setCatAlloc] = useState("");
  const [catColor, setCatColor] = useState(Colors.categoryColors[0]);

  const createQuickGoal = () => {
    if (!goalName.trim()) { toast.error("Goal name required"); return; }
    const target = parseFloat(goalTarget);
    const targetAmount = (isNaN(target) || target <= 0) ? undefined : target;
    const goal = useStore.getState().createGoal({
      name: goalName.trim(), description: undefined, targetAmount,
      currentAmount: 0, deadline: undefined, color: goalColor, icon: "target",
    });
    // Assign the new goal to the first unassigned row
    if (reviewRows) {
      const firstUnassigned = reviewRows.findIndex(r => !r.skip && r.categoryId === null && r.goalId === null);
      if (firstUnassigned >= 0) {
        const updated = reviewRows.map((r, i) =>
          i === firstUnassigned ? { ...r, goalId: goal.id, autoMatched: true } : r,
        );
        setReviewRows(updated);
        toast.success(`"${goal.name}" created and assigned to a transaction`);
      } else {
        toast.success(`"${goal.name}" created`);
      }
    } else {
      toast.success(`"${goal.name}" created`);
    }
    setShowQuickGoal(false);
    setGoalName("");
    setGoalTarget("");
  };

  const createQuickCategory = () => {
    if (!catName.trim()) { toast.error("Category name required"); return; }
    if (!activeBudgetId) { toast.error("No active budget"); return; }
    const alloc = parseFloat(catAlloc) || 0;
    const cat = useStore.getState().createCategory({
      budgetId: activeBudgetId,
      name: catName.trim(),
      allocatedAmount: alloc,
      color: catColor,
      icon: "wallet",
    });
    if (reviewRows) {
      const firstUnassigned = reviewRows.findIndex(r => !r.skip && r.categoryId === null && r.goalId === null);
      if (firstUnassigned >= 0) {
        const updated = reviewRows.map((r, i) =>
          i === firstUnassigned ? { ...r, categoryId: cat.id, autoMatched: true } : r,
        );
        setReviewRows(updated);
        toast.success(`"${cat.name}" created and assigned to a transaction`);
      } else {
        toast.success(`"${cat.name}" created`);
      }
    } else {
      toast.success(`"${cat.name}" created`);
    }
    setShowQuickCat(false);
    setCatName("");
    setCatAlloc("");
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeBudgetId) return;
    e.target.value = "";

    // Duplicate file check — same file name already imported?
    const existing = importedStatements.find(
      s => s.fileName.toLowerCase() === file.name.toLowerCase(),
    );
    if (existing) {
      setDuplicateFileConfirm({ fileName: file.name, existingStmt: existing, file });
      return;
    }

    setParsePending(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      let txs: RawTx[] = [];
      let detectedAcct: string | null = null;
      if (ext === "csv") {
        txs = parseCSV(await file.text());
      } else if (ext === "ofx" || ext === "qfx") {
        txs = parseOFX(await file.text());
      } else if (ext === "pdf") {
        txs = await parseANZPdf(file);
        // Detect account info from PDF
        try {
          const items = await extractPdfItems(file);
          detectedAcct = extractAccountInfo(items);
        } catch {}
      } else {
        toast.error("Unsupported file. Use CSV, OFX/QFX, or ANZ PDF.");
        return;
      }
      if (txs.length === 0) {
        toast.error(ext === "pdf"
          ? "No transactions found. This parser supports ANZ PDF statements. Scanned/image PDFs are not supported."
          : "No transactions found. Check the file format.");
        return;
      }
      const rows = previewImport(txs, activeBudgetId);

      // Also detect from file name (e.g. "Everyday x2828")
      const fnDigits = file.name.match(/\d{3,}/);
      const fnNum = fnDigits ? fnDigits.sort((a, b) => b.length - a.length)[0] : null;
      if (fnNum && (!detectedAcct || fnNum.length > detectedAcct.replace(/\D/g, "").length)) {
        detectedAcct = fnNum;
      }

      // Auto-detect account — match by number (last 4+ digits) OR by name (fuzzy)
      let matchedId: number | undefined;
      let matchedByName = false;
      if (detectedAcct) {
        const digits = detectedAcct.replace(/\D/g, "");
        const matchByNumber = accounts.find(a => {
          if (!a.accountNumber) return false;
          const acctDigits = a.accountNumber.replace(/\D/g, "");
          return acctDigits.endsWith(digits) || acctDigits.includes(digits) || digits.includes(acctDigits);
        });
        if (matchByNumber) {
          matchedId = matchByNumber.id;
          setImportAccountId(matchedId);
          toast.success(`Auto-detected account: ${matchByNumber.name}`);
        }
      }
      // Also try matching file name against account names
      if (matchedId == null) {
        const stmtName = file.name.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
        let bestScore = 0;
        let best: (typeof accounts)[number] | null = null;
        for (const acc of accounts) {
          const score = nameMatchScore(stmtName, acc.name);
          if (score > bestScore) { bestScore = score; best = acc; }
        }
        if (best && bestScore >= 0.4) {
          matchedId = best.id;
          matchedByName = true;
          setImportAccountId(matchedId);
          toast.success(`Auto-detected account: ${best.name}`);
        }
      }
      setDetectedAccountInfo({ number: detectedAcct ?? fnNum ?? "", matchedAccountId: matchedId, matchedByName });

      setParsedTxs(txs);
      setReviewRows(rows);
      setFileName(file.name);
      setImportResult(null);
      // Auto-detect ending balance from last transaction with balance data
      const lastBal = [...rows].reverse().find(r => r.balance != null);
      setImportEndingBalance(lastBal?.balance != null ? String(lastBal.balance) : "");
      setImportBalanceDate(lastBal?.date ?? "");
      toast.success(`Found ${txs.length} transaction${txs.length !== 1 ? "s" : ""} in ${file.name}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to parse file.");
    } finally {
      setParsePending(false);
    }
  };

  const confirmImport = () => {
    if (!reviewRows || !activeBudgetId) return;

    // Auto-save rules for all manually-assigned rows (not auto-matched)
    let rulesSaved = 0;
    for (const row of reviewRows) {
      if (row.autoMatched) continue;
      const keyword = row.description.split(" ").slice(0, 3).join(" ").toLowerCase().trim();
      if (!keyword) continue;

      // Manually skipped: create a skip rule (with optional transfer account)
      if (row.skip) {
        upsertBankRule({ keyword, routeTo: "skip", transferToAccountId: row.transferToAccountId });
        rulesSaved++;
      } else if (row.goalId !== null) {
        upsertBankRule({ keyword, routeTo: "goal", goalId: row.goalId });
        rulesSaved++;
      } else if (row.goalWithdrawalId != null) {
        upsertBankRule({ keyword, routeTo: "goalWithdrawal", goalId: row.goalWithdrawalId });
        rulesSaved++;
      } else if (row.categoryId !== null) {
        const cat = budgetCats.find(c => c.id === row.categoryId);
        if (cat) {
          upsertBankRule({ keyword, routeTo: "category", categoryName: cat.name });
          rulesSaved++;
        }
      } else if (row.holdingId != null) {
        upsertBankRule({ keyword, routeTo: "holding", holdingId: row.holdingId });
        rulesSaved++;
      } else if (row.incomeSourceName != null) {
        upsertBankRule({ keyword, routeTo: "income", incomeSourceName: row.incomeSourceName });
        rulesSaved++;
      } else if (row.isHouseholdTransfer) {
        upsertBankRule({ keyword, routeTo: "householdTransfer" });
        rulesSaved++;
      }
    }

    const bal = parseFloat(importEndingBalance);
    const result = commitImport(reviewRows, activeBudgetId, fileName, importAccountId ?? undefined, isNaN(bal) ? undefined : bal);
    setImportResult(result);
    setReviewRows(null);
    setImportAccountId(null);

    const parts: string[] = [`Imported ${result.imported} transaction${result.imported !== 1 ? "s" : ""}`];
    if (result.goalContributions > 0) parts.push(`${result.goalContributions} goal contribution${result.goalContributions !== 1 ? "s" : ""}`);
    if (result.goalWithdrawalCount > 0) parts.push(`${result.goalWithdrawalCount} goal withdrawal${result.goalWithdrawalCount !== 1 ? "s" : ""}`);
    if (result.transferred > 0) parts.push(`${result.transferred} transferred`);
    if (rulesSaved > 0) parts.push(`${rulesSaved} rule${rulesSaved !== 1 ? "s" : ""} saved`);
    toast.success(parts.join(" · "));
  };

  const handleSaveRule = (keyword: string, routeTo: "category" | "goal" | "goalWithdrawal" | "skip" | "holding" | "income" | "householdTransfer", categoryName?: string, goalId?: number, transferToAccountId?: number, holdingId?: number, incomeSourceName?: string) => {
    if (!keyword.trim()) { toast.error("Keyword required"); return; }
    upsertBankRule({ keyword: keyword.trim(), routeTo, categoryName, goalId, transferToAccountId, holdingId, incomeSourceName });
    if (parsedTxs && activeBudgetId) {
      setReviewRows(previewImport(parsedTxs, activeBudgetId));
    }
    setRuleModalData(null);
    toast.success("Rule saved and applied");
  };

  // ─── Drive Statement Import ──────────────────────────────────────────────

  const handleScanDrive = async () => {
    const folderId = getStatementFolderId();
    const clientId = getClientId();
    if (!folderId || !clientId) { toast.error("Configure statement folder in Settings first"); return; }
    if (!getStoredToken()) { toast.error("Connect Google Drive Sync in Settings first"); return; }
    setScanning(true);
    setDriveFiles(null);
    try {
      const files = await listStatementFiles(folderId, clientId);
      if (files.length === 0) {
        toast.success("No files found in the folder");
        setDriveFiles([]);
      } else {
        setDriveFiles(files);
        // Pre-select new/updated files
        const alreadyImportedIds = new Set(
          importedStatements.filter(s => s.driveFileId).map(s => s.driveFileId!),
        );
        const alreadyModified = new Map(
          importedStatements.filter(s => s.driveFileId && s.driveModifiedTime).map(s => [s.driveFileId!, s.driveModifiedTime!]),
        );
        const preSelected = new Set<string>();
        for (const f of files) {
          if (!alreadyImportedIds.has(f.id)) {
            preSelected.add(f.id);
          } else if (alreadyModified.get(f.id) !== f.modifiedTime) {
            preSelected.add(f.id);
          }
        }
        setSelectedDriveFiles(preSelected);
        toast.success(`Found ${files.length} file${files.length !== 1 ? "s" : ""}`);
      }
    } catch {
      toast.error("Failed to scan folder");
    } finally {
      setScanning(false);
    }
  };

  const toggleDriveFile = (id: string) => {
    setSelectedDriveFiles(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const importDriveFiles = async () => {
    const folderId = getStatementFolderId();
    const clientId = getClientId();
    if (!folderId || !clientId || !activeBudgetId) return;
    setImportingFromDrive(true);
    let imported = 0, failed = 0;
    for (const fileId of selectedDriveFiles) {
      const file = driveFiles?.find(f => f.id === fileId);
      if (!file) continue;
      // Skip already-imported files
      const alreadyImported = importedStatements.some(
        s => s.fileName.toLowerCase() === file.name.toLowerCase(),
      );
      if (alreadyImported) { failed++; continue; }
      try {
        const ext = file.name.split(".").pop()?.toLowerCase();
        let txs: RawTx[] | null = null;
        if (ext === "csv" || ext === "ofx" || ext === "qfx") {
          const content = await downloadFileContent(fileId, clientId);
          if (!content) { failed++; continue; }
          if (ext === "csv") txs = parseCSV(content);
          else txs = parseOFX(content);
        } else if (ext === "pdf") {
          const blob = await downloadFileAsBlob(fileId, clientId);
          if (!blob) { failed++; continue; }
          const pdfFile = new File([blob], file.name, { type: "application/pdf" });
          txs = await parseANZPdf(pdfFile);
        }
        if (!txs || txs.length === 0) { failed++; continue; }
        const rows = previewImport(txs, activeBudgetId);
        const result = commitImport(rows, activeBudgetId, file.name, importAccountId ?? undefined, file.id, file.modifiedTime);
        imported += result.imported;
      } catch { failed++; }
    }
    setImportingFromDrive(false);
    setDriveFiles(null);
    setSelectedDriveFiles(new Set());
    if (imported > 0) toast.success(`Imported ${imported} file${imported !== 1 ? "s" : ""} from Drive`);
    if (failed > 0) toast.error(`${failed} file${failed !== 1 ? "s" : ""} failed`);
  };

  // ─── Local Folder Import ──────────────────────────────────────────────────

  const handleScanLocalFolder = async () => {
    const handle = await getImportDirHandle();
    if (!handle) { toast.error("Configure a local import folder in Settings first"); return; }
    setLocalFiles(null);
    const files = await listImportFiles();
    if (files.length === 0) {
      toast.success("No CSV/OFX/PDF files found in the folder");
      setLocalFiles([]);
    } else {
      setLocalFiles(files);
      const alreadyImportedNames = new Set(importedStatements.map(s => s.fileName.toLowerCase()));
      const preSelected = new Set(
        files.filter(f => !alreadyImportedNames.has(f.name.toLowerCase())).map(f => f.name),
      );
      setSelectedLocalFiles(preSelected);
      toast.success(`Found ${files.length} file${files.length !== 1 ? "s" : ""}`);
    }
  };

  const toggleLocalFile = (name: string) => {
    setSelectedLocalFiles(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const importLocalFiles = async () => {
    if (!activeBudgetId) return;
    setImportingLocal(true);
    let imported = 0, failed = 0;
    for (const fileName of selectedLocalFiles) {
      const file = localFiles?.find(f => f.name === fileName);
      if (!file) continue;
      const alreadyImported = importedStatements.some(
        s => s.fileName.toLowerCase() === fileName.toLowerCase(),
      );
      if (alreadyImported) { failed++; continue; }
      try {
        const blob = await file.handle.getFile();
        const ext = file.ext;
        let txs: RawTx[] | null = null;
        if (ext === "csv") {
          txs = parseCSV(await blob.text());
        } else if (ext === "ofx" || ext === "qfx") {
          txs = parseOFX(await blob.text());
        } else if (ext === "pdf") {
          const pdfFile = new File([blob], fileName, { type: "application/pdf" });
          txs = await parseANZPdf(pdfFile);
        }
        if (!txs || txs.length === 0) { failed++; continue; }
        const rows = previewImport(txs, activeBudgetId);
        const result = commitImport(rows, activeBudgetId, fileName, importAccountId ?? undefined);
        imported += result.imported;
      } catch { failed++; }
    }
    setImportingLocal(false);
    setLocalFiles(null);
    setSelectedLocalFiles(new Set());
    if (imported > 0) toast.success(`Imported ${imported} file${imported !== 1 ? "s" : ""} from local folder`);
    if (failed > 0) toast.error(`${failed} file${failed !== 1 ? "s" : ""} failed`);
  };

  const confirmDeleteStmt = () => {
    if (!deleteConfirmStmt) return;
    deleteImportedStatement(deleteConfirmStmt.id);
    const count = expenses.filter(e => e.importId === deleteConfirmStmt.id).length;
    toast.success(`Deleted ${deleteConfirmStmt.fileName} · ${count} transaction${count !== 1 ? "s" : ""} removed`);
    setDeleteConfirmStmt(null);
  };

  const budgetExpenses = useMemo(() => {
    if (!activeBudget) return [];
    const { startDate, endDate } = getBudgetDateRange(activeBudget);
    return expenses.filter(
      e => e.budgetId === activeBudgetId && e.date >= startDate && e.date <= endDate,
    ).sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, activeBudgetId, activeBudget]);

  const exportCSV = () => {
    if (!activeBudget || budgetExpenses.length === 0) return;
    const rows = [
      ["Date", "Description", "Category", "Merchant", "Amount", "Notes", "Source"],
      ...budgetExpenses.map(e => {
        const cat = categories.find(c => c.id === e.categoryId);
        return [e.date, e.description, cat?.name ?? "", e.merchant ?? "", String(e.amount), e.notes ?? "", e.importedFromBank ? "Bank Import" : "Manual"];
      }),
    ];
    const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${activeBudget.name}-${activeBudget.year}-${String(activeBudget.month).padStart(2, "0")}.csv`;
    a.click();
    toast.success("CSV exported");
  };

  return (
    <div>
      <PageHeader
        title="Statements"
        subtitle={activeBudget ? activeBudget.name : undefined}
        actions={budgetExpenses.length > 0 ? <Button label="Export CSV" onClick={exportCSV} variant="secondary" size="sm" icon={Download} /> : undefined}
      />

      <div className="px-4 sm:px-6 space-y-5 pb-6">        
        {/* Account balances */}
            {accounts.length > 0 && (
              <Card padding={false} className="divide-y divide-border">
                {accounts.map(acc => {
                  const lastStmt = [...importedStatements].reverse().find(s => s.accountId === acc.id);
                  return (
                    <div key={acc.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Landmark size={14} className="text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">{acc.name}</p>
                        <p className="text-[10px] text-muted-foreground capitalize">{acc.type} account</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-foreground">{acc.balance != null ? formatCurrency(acc.balance) : "—"}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {lastStmt?.balanceDate ? `Balance · ${formatDate(lastStmt.balanceDate)}` : "Balance"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </Card>
            )}

            {/* Drive import */}
            {!reviewRows && !importResult && (
              <Card>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Cloud size={18} className="text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Import from Google Drive</p>
                    <p className="text-xs text-muted-foreground">Scan a folder for CSV/OFX/PDF statement files</p>
                  </div>
                </div>
                {driveFiles === null ? (
                  <Button label={scanning ? "Scanning…" : "Scan Drive Folder"} onClick={handleScanDrive}
                    variant="secondary" fullWidth icon={RefreshCw} loading={scanning} />
                ) : (
                  <div className="space-y-3">
                    {driveFiles.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No files found in the folder</p>
                    ) : (
                      <>
                        <div className="divide-y divide-border max-h-64 overflow-y-auto -mx-4">
                          {driveFiles.map(f => {
                            const alreadyImported = importedStatements.some(
                              s => s.driveFileId === f.id && s.driveModifiedTime === f.modifiedTime,
                            );
                            const checked = selectedDriveFiles.has(f.id);
                            return (
                              <label key={f.id} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/30 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleDriveFile(f.id)}
                                  className="rounded border-border accent-primary"
                                />
                                <FileText size={14} className="text-muted-foreground flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-foreground truncate">{f.name}</p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {new Date(f.modifiedTime).toLocaleDateString()}
                                    {alreadyImported ? " · Already imported" : ""}
                                  </p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                        <div className="flex gap-2">
                          <Button label={`Import Selected (${selectedDriveFiles.size})`} onClick={importDriveFiles}
                            variant="primary" size="sm" icon={Cloud} loading={importingFromDrive}
                            disabled={selectedDriveFiles.size === 0} />
                          <Button label="Cancel" onClick={() => { setDriveFiles(null); setSelectedDriveFiles(new Set()); }}
                            variant="secondary" size="sm" />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </Card>
            )}

            {/* Local folder import */}
            {!reviewRows && !importResult && (
              <Card>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <FolderPlus size={18} className="text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Import from Local Folder</p>
                    <p className="text-xs text-muted-foreground">Read CSV/OFX/PDF files from a folder on your computer</p>
                  </div>
                </div>
                {localFiles === null ? (
                  <Button label="Scan Local Folder" onClick={handleScanLocalFolder}
                    variant="secondary" fullWidth icon={FolderPlus} />
                ) : (
                  <div className="space-y-3">
                    {localFiles.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">No CSV/OFX/PDF files found</p>
                    ) : (
                      <>
                        <div className="divide-y divide-border max-h-64 overflow-y-auto -mx-4">
                          {localFiles.map(f => {
                            const alreadyImported = importedStatements.some(
                              s => s.fileName.toLowerCase() === f.name.toLowerCase(),
                            );
                            const checked = selectedLocalFiles.has(f.name);
                            return (
                              <label key={f.name} className="flex items-center gap-3 px-4 py-2 hover:bg-muted/30 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleLocalFile(f.name)}
                                  className="rounded border-border accent-primary"
                                />
                                <FileText size={14} className="text-muted-foreground flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-foreground truncate">{f.name}</p>
                                  <p className="text-[10px] text-muted-foreground">
                                    .{f.ext}
                                    {alreadyImported ? " · Already imported" : ""}
                                  </p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                        <div className="flex gap-2">
                          <Button label={`Import Selected (${selectedLocalFiles.size})`} onClick={importLocalFiles}
                            variant="primary" size="sm" icon={FolderPlus} loading={importingLocal}
                            disabled={selectedLocalFiles.size === 0} />
                          <Button label="Cancel" onClick={() => { setLocalFiles(null); setSelectedLocalFiles(new Set()); }}
                            variant="secondary" size="sm" />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </Card>
            )}

            {/* Duplicate file warning */}
            {duplicateFileConfirm && (
              <Card>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
                    <AlertTriangle size={18} className="text-warning" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Already imported</p>
                    <p className="text-xs text-muted-foreground">
                      "{duplicateFileConfirm.fileName}" was imported on{" "}
                      {new Date(duplicateFileConfirm.existingStmt.importedAt).toLocaleDateString()}.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    label="Cancel"
                    variant="secondary"
                    onClick={() => setDuplicateFileConfirm(null)}
                  />
                  <Button
                    label="Import anyway"
                    variant="danger"
                    onClick={() => proceedWithDuplicateImport(duplicateFileConfirm.file)}
                  />
                </div>
              </Card>
            )}

            {/* Upload card */}
            {!reviewRows && (
              <Card>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <Upload size={18} className="text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Import Bank Statement</p>
                    <p className="text-xs text-muted-foreground">CSV, OFX/QFX, or ANZ PDF</p>
                  </div>
                </div>
                <input ref={fileRef} type="file" accept=".csv,.ofx,.qfx,.pdf" className="hidden" onChange={handleFile} />
                <Button label={parsePending ? "Reading file…" : "Choose File"} onClick={() => fileRef.current?.click()}
                  variant="primary" fullWidth icon={Upload} loading={parsePending} />
                <div className="mt-3 flex flex-col gap-1">
                  <p className="text-xs text-muted-foreground text-center font-medium">Supported formats</p>
                  <div className="flex flex-wrap justify-center gap-2 mt-1">
                    {["ANZ PDF ✓", "ANZ CSV", "NAB CSV", "CommBank CSV", "Westpac CSV", "OFX / QFX"].map(label => (
                      <span key={label} className="text-[10px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{label}</span>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground text-center mt-1">
                    ANZ PDF: supports ANZ Plus Everyday and classic ANZ statements (text-based, not scanned)
                  </p>
                </div>
              </Card>
            )}

            {/* Import result */}
            {importResult && (
              <Card>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center">
                    <CheckCircle2 size={18} className="text-success" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">Import Complete</p>
                    <p className="text-xs text-muted-foreground">
                      {importResult.imported} imported
                      {importResult.goalContributions > 0 && ` · ${importResult.goalContributions} goal contribution${importResult.goalContributions !== 1 ? "s" : ""}`}
                      {importResult.skipped > 0 && ` · ${importResult.skipped} skipped`}
                      {importResult.transferred > 0 && ` · ${importResult.transferred} transferred`}
                    </p>
                  </div>
                </div>
                <Button label="Import Another File" onClick={() => setImportResult(null)} variant="secondary" fullWidth size="sm" icon={Upload} />
              </Card>
            )}

            {/* Review — individual transaction rows for category matching */}
            {reviewRows && (
              <ImportReview
                fileName={fileName}
                rows={reviewRows}
                onChange={setReviewRows}
                onConfirm={confirmImport}
                onCancel={() => { setReviewRows(null); setImportAccountId(null); setDetectedAccountInfo(null); }}
                categories={budgetCats}
                goals={goals}
                accounts={accounts}
                holdings={holdings}
                accountId={importAccountId}
                onAccountChange={setImportAccountId}
                endingBalance={importEndingBalance}
                onEndingBalanceChange={setImportEndingBalance}
                currentAccountBalance={importAccountId != null ? accounts.find(a => a.id === importAccountId)?.balance : undefined}
                onCreateGoal={() => setShowQuickGoal(true)}
                onCreateCategory={() => setShowQuickCat(true)}
                onCreateRule={row => setRuleModalData({
                  description: row.description,
                  categoryId: row.categoryId,
                  goalId: row.goalId,
                  goalWithdrawalId: row.goalWithdrawalId,
                  skip: row.skip,
                  transferToAccountId: row.transferToAccountId,
                  holdingId: row.holdingId,
                  incomeSourceName: row.incomeSourceName,
                  isHouseholdTransfer: row.isHouseholdTransfer,
                })}
                detectedAccountInfo={detectedAccountInfo}
              />
            )}

            {/* Quick goal creation */}
            <Modal visible={showQuickGoal} onClose={() => setShowQuickGoal(false)} title="New Savings Goal">
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-primary/5 border border-primary/20">
                  <p className="text-xs text-primary font-medium">
                    Create a goal to route savings transactions toward. The first unassigned transaction will be assigned to this goal.
                  </p>
                </div>
                <Input label="Goal Name" value={goalName} onChange={setGoalName} placeholder="e.g. Holiday, Emergency Fund" autoFocus />
                <Input label="Target Amount (optional)" value={goalTarget} onChange={setGoalTarget} type="number" prefix="$" placeholder="No target" />
                <div>
                  <label className="text-sm font-medium text-muted-foreground block mb-2">Color</label>
                  <ColorPicker value={goalColor} onChange={setGoalColor} colors={Colors.categoryColors} />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button label="Cancel" onClick={() => setShowQuickGoal(false)} variant="secondary" fullWidth />
                  <Button label="Create Goal" onClick={createQuickGoal} variant="primary" fullWidth />
                </div>
              </div>
            </Modal>

            {/* Quick category creation */}
            <Modal visible={showQuickCat} onClose={() => setShowQuickCat(false)} title="New Budget Category">
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-primary/5 border border-primary/20">
                  <p className="text-xs text-primary font-medium">
                    Create a category to organise this expense. The first unassigned transaction will be assigned to this category.
                  </p>
                </div>
                <Input label="Category Name" value={catName} onChange={setCatName} placeholder="e.g. Groceries, Transport" autoFocus />
                <Input label="Monthly Allocation (optional)" value={catAlloc} onChange={setCatAlloc} type="number" prefix="$" placeholder="0.00" />
                <div>
                  <label className="text-sm font-medium text-muted-foreground block mb-2">Color</label>
                  <ColorPicker value={catColor} onChange={setCatColor} colors={Colors.categoryColors} />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button label="Cancel" onClick={() => setShowQuickCat(false)} variant="secondary" fullWidth />
                  <Button label="Create Category" onClick={createQuickCategory} variant="primary" fullWidth />
                </div>
              </div>
            </Modal>

            {/* Quick rule creation */}
            {ruleModalData && (
              <Modal visible onClose={() => setRuleModalData(null)} title="Add Bank Mapping Rule">
                <RuleForm
                  initialKeyword={ruleModalData.description}
                  initialCategoryId={ruleModalData.categoryId}
                  initialGoalId={ruleModalData.goalId}
                  initialGoalWithdrawalId={ruleModalData.goalWithdrawalId}
                  initialSkip={ruleModalData.skip}
                  initialTransferToAccountId={ruleModalData.transferToAccountId}
                  initialHoldingId={ruleModalData.holdingId}
                  initialIncomeSourceName={ruleModalData.incomeSourceName}
                  initialIsHouseholdTransfer={ruleModalData.isHouseholdTransfer}
                  categories={budgetCats}
                  goals={goals}
                  accounts={accounts}
                  holdings={holdings}
                  onSave={handleSaveRule}
                  onCancel={() => setRuleModalData(null)}
                />
              </Modal>
            )}

            {/* Statement import history */}
            {importedStatements.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <SectionHeader title="Import History" />
                </div>
                <Card padding={false} className="divide-y divide-border">
                  {[...importedStatements].reverse().map(s => {
                    const acc = s.accountId != null ? accounts.find(a => a.id === s.accountId) : null;
                    const linkedCount = expenses.filter(e => e.importId === s.id).length;
                    const isOpen = expandedImports.has(s.id);
                    const linked = expenses.filter(e => e.importId === s.id);
                    return (
                      <div key={s.id}>
                        <div
                          className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                          onClick={() => toggleImport(s.id)}
                        >
                          <ChevronRight size={14} className={cn("text-muted-foreground transition-transform flex-shrink-0", isOpen && "rotate-90")} />
                          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <FileText size={15} className="text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{s.fileName}</p>
                            <p className="text-xs text-muted-foreground">
                              {linkedCount} transaction{linkedCount !== 1 ? "s" : ""}
                              {s.budgetMonth && <> · {s.budgetMonth}</>}
                              {acc && <> · {acc.name}</>}
                            </p>
                          </div>
                          <span className="text-xs text-muted-foreground flex-shrink-0">{formatDate(s.importedAt.slice(0, 10))}</span>
                          <button
                            onClick={e => { e.stopPropagation(); setDeleteConfirmStmt(s); }}
                            className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
                            title="Delete import"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                        {isOpen && linked.length > 0 && (
                          <div className="border-t border-border bg-muted/20">
                            {linked.map((exp, i) => {
                              const cat = categories.find(c => c.id === exp.categoryId);
                              const goal = goals.find(g => g.id === exp.goalId);
                              return (
                                <div key={exp.id} className={cn("flex items-center gap-3 px-4 py-2.5", i < linked.length - 1 && "border-b border-border/50")}>
                                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: (cat?.color ?? Colors.primary) + "20" }}>
                                    <Receipt size={12} style={{ color: cat?.color ?? Colors.primary }} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium text-foreground truncate">{exp.description}</p>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                      {cat && <ColorDot color={cat.color} size={5} />}
                                      <span className="text-[10px] text-muted-foreground truncate">
                                        {cat?.name ?? (goal ? `→ ${goal.name}` : "Uncategorized")}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground/60">· {formatDate(exp.date)}</span>
                                    </div>
                                  </div>
                                  <span className="text-xs font-semibold text-foreground">{formatCurrency(exp.amount)}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </Card>
              </div>
            )}

            {/* Delete confirmation modal */}
            <Modal visible={deleteConfirmStmt != null} onClose={() => setDeleteConfirmStmt(null)} title="Delete Imported Statement?">
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-destructive/5 border border-destructive/20">
                  <p className="text-xs text-destructive font-medium">
                    This will permanently remove <strong>{deleteConfirmStmt?.fileName}</strong> and all {expenses.filter(e => e.importId === deleteConfirmStmt?.id).length} transactions linked to it. This action cannot be undone.
                  </p>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button label="Cancel" onClick={() => setDeleteConfirmStmt(null)} variant="secondary" fullWidth />
                  <Button label="Delete" onClick={confirmDeleteStmt} variant="primary" fullWidth icon={Trash2} />
                </div>
              </div>
            </Modal>

      </div>
    </div>
  );
}
