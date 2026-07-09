import { useState, useRef, useMemo } from "react";
import { useStore } from "../store";
import { formatCurrency, formatDate, monthName, currentMonth, today, monthlyIncomeAmount, monthlyRecurringAmount, dayOfWeekLabel, formatRecurringSchedule, getBudgetDateRange } from "../utils";
import { Colors } from "../theme";
import {
  Card, Button, Input, Modal, EmptyState, SectionHeader,
  ColorPicker, MonthPicker, YearPicker, ProgressBar, ColorDot, Confirm, AccountPicker,
} from "../components/ui";
import { PageHeader } from "../components/Layout";
import { BudgetYearTabs, BudgetMonthGrid } from "../components/BudgetPicker";
import {
  Plus, Trash2, Edit2, Wallet, RefreshCw, ToggleLeft, ToggleRight, CalendarClock, Copy, ChevronDown, Repeat, Tag, MoveRight, AlertTriangle, Target, Printer, LayoutGrid, List,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { RecurringExpense, IncomeSource, PayFrequency, ImportedStatement } from "../types";

// ─── Budget Modal ─────────────────────────────────────────────────────────────

function BudgetModal({
  visible, onClose, initial, defaultMonth, defaultYear,
}: {
  visible: boolean; onClose: () => void;
  initial?: { id: number; name: string; month: number; year: number; carryoverAmount?: number; startDay: number; notes?: string };
  defaultMonth?: number;
  defaultYear?: number;
}) {
  const { createBudget, updateBudget, budgets, importedStatements } = useStore();
  const cm = currentMonth();
  const [name, setName] = useState(initial?.name ?? "Monthly Budget");
  const [month, setMonth] = useState(initial?.month ?? defaultMonth ?? cm.month);
  const [year, setYear] = useState(initial?.year ?? defaultYear ?? cm.year);
  const [carryover, setCarryover] = useState(String(initial?.carryoverAmount ?? ""));
  const [startDay, setStartDay] = useState(String(initial?.startDay ?? 1));
  const [notes, setNotes] = useState(initial?.notes ?? "");

  // Suggested carryover from bank statements of the previous budget
  const modalSuggested = useMemo(() => {
    const sorted = [...budgets].sort((a, b) =>
      b.year !== a.year ? b.year - a.year :
        b.month !== a.month ? b.month - a.month :
          (b.startDay ?? 1) - (a.startDay ?? 1),
    );
    // Editing: exclude the budget being edited so it doesn't match itself
    const prev = sorted.find(b =>
      (initial ? b.id !== initial.id : true) &&
      (b.year < year || (b.year === year && b.month < month) ||
      (b.year === year && b.month === month && (b.startDay ?? 1) < (parseInt(startDay) || 1))),
    );
    if (!prev) return null;
    const stmts = importedStatements.filter(s => s.budgetId === prev.id && s.endingBalance != null);
    if (stmts.length === 0) return null;
    const perAccount = new Map<number, ImportedStatement>();
    for (const s of stmts) {
      if (s.accountId == null) continue;
      const existing = perAccount.get(s.accountId);
      if (!existing || (s.balanceDate ?? "") > (existing.balanceDate ?? "")) {
        perAccount.set(s.accountId, s);
      }
    }
    let total = 0;
    for (const [, s] of perAccount) total += s.endingBalance!;
    return total;
  }, [budgets, importedStatements, month, year, startDay, initial]);

  const save = () => {
    const carryoverAmt = parseFloat(carryover) || 0;
    if (!name.trim()) { toast.error("Budget name is required"); return; }
    if (carryover && (isNaN(carryoverAmt) || carryoverAmt < 0)) { toast.error("Enter a valid carryover amount"); return; }
    if (initial) {
      updateBudget(initial.id, {
        name, month, year,
        carryoverAmount: carryoverAmt,
        startDay: parseInt(startDay) || 1,
        notes,
      });
      toast.success("Budget updated");
    } else {
      createBudget({
        name, month, year,
        totalIncome: carryoverAmt,
        carryoverAmount: carryoverAmt,
        startDay: parseInt(startDay) || 1,
        notes,
      });
      toast.success("Budget created");
    }
    onClose();
  };

  return (
    <Modal visible={visible} onClose={onClose} title={initial ? "Edit Budget" : "New Budget"} maxWidth="md">
      <div className="space-y-4">
        <Input label="Budget Name" value={name} onChange={setName} placeholder="e.g. Monthly Budget" autoFocus />
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Month</label>
          <MonthPicker value={month} onChange={setMonth} />
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Year</label>
          <YearPicker value={year} onChange={setYear} />
        </div>
        <Input
          label="Unallocated Carryover (optional)"
          value={carryover}
          onChange={setCarryover}
          type="number"
          prefix="$"
          placeholder="0.00"
        />
        <p className="text-xs text-muted-foreground -mt-2">
          Leftover unallocated money from a previous period. Add salary/income sources after creating the budget.
        </p>
        {modalSuggested !== null && (
          <div className="flex items-center justify-between -mt-1">
            <p className="text-[11px] text-muted-foreground">
              Suggested from bank statements: {formatCurrency(modalSuggested)}
            </p>
            <button
              onClick={() => setCarryover(String(modalSuggested))}
              className="text-[11px] font-medium text-primary hover:underline"
            >
              Apply
            </button>
          </div>
        )}
        <Input label="Budget Start Day" value={startDay} onChange={setStartDay} type="number" placeholder="1" />
        <Input label="Notes (optional)" value={notes} onChange={setNotes} multiline placeholder="Any notes…" />
        <div className="flex gap-2 pt-1">
          <Button label="Cancel" onClick={onClose} variant="secondary" fullWidth />
          <Button label={initial ? "Save Changes" : "Create Budget"} onClick={save} variant="primary" fullWidth />
        </div>
      </div>
    </Modal>
  );
}

// ─── Category Modal ───────────────────────────────────────────────────────────

function CategoryModal({
  visible, onClose, budgetId, initial,
}: {
  visible: boolean; onClose: () => void; budgetId: number;
  initial?: { id: number; name: string; allocatedAmount: number; color: string; icon: string; isRounding?: boolean; linkedGoalId?: number; frequency?: "monthly" | "fortnightly" | "weekly"; sectionId?: number };
}) {
  const { createCategory, updateCategory, goals, budgetSections: rawBudgetSections, createBudgetSection } = useStore();
  const budgetSections = rawBudgetSections ?? [];
  const [name, setName] = useState(initial?.name ?? "");
  const [amount, setAmount] = useState(String(initial?.allocatedAmount ?? ""));
  const [frequency, setFrequency] = useState<"monthly" | "fortnightly" | "weekly">(initial?.frequency ?? "monthly");
  const [isRounding, setIsRounding] = useState(initial?.isRounding ?? false);
  const [color, setColor] = useState(initial?.color ?? Colors.categoryColors[0]);
  const [linkedGoalId, setLinkedGoalId] = useState<number | null>(initial?.linkedGoalId ?? null);
  const [sectionId, setSectionId] = useState<number | null>(initial?.sectionId ?? null);
  const [showNewSection, setShowNewSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");

  const availableSections = budgetSections.filter(s => s.budgetId === budgetId).sort((a, b) => a.sortOrder - b.sortOrder);

  const save = () => {
    const amt = isRounding ? 0 : parseFloat(amount);
    if (!name.trim()) { toast.error("Category name is required"); return; }
    if (!isRounding && (isNaN(amt) || amt < 0)) { toast.error("Enter a valid amount"); return; }
    const freq = isRounding ? undefined : frequency;
    if (initial) {
      updateCategory(initial.id, { name, allocatedAmount: amt, color, isRounding, linkedGoalId: linkedGoalId ?? undefined, frequency: freq, sectionId: sectionId ?? undefined });
      toast.success("Category updated");
    } else {
      createCategory({ budgetId, name, allocatedAmount: amt, color, icon: "wallet", isRounding, linkedGoalId: linkedGoalId ?? undefined, frequency: freq, sectionId: sectionId ?? undefined });
      toast.success("Category added");
    }
    onClose();
  };

  const addSection = () => {
    if (!newSectionName.trim()) return;
    const sec = createBudgetSection({ budgetId, name: newSectionName.trim(), sortOrder: availableSections.length });
    setSectionId(sec.id);
    setNewSectionName("");
    setShowNewSection(false);
  };

  return (
    <Modal visible={visible} onClose={onClose} title={initial ? "Edit Category" : "Add Category"}>
      <div className="space-y-4">
        <Input label="Category Name" value={name} onChange={setName} placeholder="e.g. Groceries" autoFocus />
        {!isRounding && (
          <Input label="Allocated Amount" value={amount} onChange={setAmount} type="number" prefix="$" placeholder="0.00" />
        )}
        {!isRounding && (
          <div>
            <label className="text-sm font-medium text-muted-foreground block mb-2">Frequency</label>
            <div className="flex gap-2">
              {(["weekly", "fortnightly", "monthly"] as const).map(f => (
                <button key={f} onClick={() => setFrequency(f)}
                  className={cn("px-4 py-2 rounded-full text-sm font-medium transition-colors",
                    frequency === f ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80",
                  )}>
                  {f === "fortnightly" ? "Fortnightly" : f === "weekly" ? "Weekly" : "Monthly"}
                </button>
              ))}
            </div>
            {frequency !== "monthly" && parseFloat(amount) > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                ≈ {formatCurrency(frequency === "weekly" ? (parseFloat(amount) * 52 / 12) : (parseFloat(amount) * 26 / 12))}/mo
              </p>
            )}
          </div>
        )}
        {/* Round-up savings toggle */}
        <button
          type="button"
          onClick={() => { setIsRounding(v => !v); if (!initial) setAmount("0"); }}
          className={cn(
            "flex items-center gap-3 w-full p-3 rounded-xl border transition-colors text-left",
            isRounding ? "border-success/40 bg-success/5" : "border-border bg-card hover:bg-muted/50",
          )}
        >
          <div className={cn(
            "w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors",
            isRounding ? "bg-success border-success" : "border-muted-foreground/40",
          )}>
            {isRounding && <span className="text-white text-[10px] font-bold">✓</span>}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Round-up / Savings</p>
            <p className="text-xs text-muted-foreground">
              {isRounding
                ? "Transactions assigned here are savings (no budget allocated)."
                : "Bank round-ups and automatic savings transfers."}
            </p>
          </div>
        </button>
        {isRounding && (
          <div className="p-3 rounded-xl bg-success/5 border border-success/20">
            <p className="text-xs text-success font-medium">
              Round-up categories don't use a budget amount. Transactions assigned here track how much you've saved through round-ups.
            </p>
          </div>
        )}
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Color</label>
          <ColorPicker value={color} onChange={setColor} colors={Colors.categoryColors} />
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Section (optional)</label>
          {availableSections.length === 0 && !showNewSection && (
            <p className="text-xs text-muted-foreground mb-2">No sections yet — add one below.</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setSectionId(null)}
              className={cn("px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                sectionId === null ? "bg-muted text-foreground border-border" : "border-dashed border-border text-muted-foreground hover:border-primary/40"
              )}>
              None
            </button>
            {availableSections.map(s => (
              <button key={s.id} onClick={() => setSectionId(s.id === sectionId ? null : s.id)}
                className={cn("px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                  sectionId === s.id ? "bg-primary text-primary-foreground border-primary" : "border-border bg-card text-foreground hover:border-primary/40"
                )}>
                {s.name}
              </button>
            ))}
          </div>
          {!showNewSection ? (
            <button onClick={() => setShowNewSection(true)} className="text-xs text-primary hover:underline mt-2">
              + New Section
            </button>
          ) : (
            <div className="flex gap-2 mt-2">
              <input type="text" value={newSectionName} onChange={e => setNewSectionName(e.target.value)}
                placeholder="Section name"
                className="flex-1 px-3 py-1.5 rounded-lg border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/30" />
              <button onClick={addSection} className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium">Add</button>
              <button onClick={() => setShowNewSection(false)} className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium">Cancel</button>
            </div>
          )}
        </div>
        {!isRounding && goals.length > 0 && (
          <div>
            <label className="text-sm font-medium text-muted-foreground block mb-2">Link to Goal (optional)</label>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setLinkedGoalId(null)}
                className={cn("flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                  linkedGoalId === null ? "bg-muted text-foreground border-border" : "border-dashed border-border text-muted-foreground hover:border-primary/40"
                )}>
                None
              </button>
              {[...goals].sort((a, b) => a.name.localeCompare(b.name)).map(g => (
                <button key={g.id} onClick={() => setLinkedGoalId(g.id === linkedGoalId ? null : g.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                    linkedGoalId === g.id
                      ? "border-transparent text-white"
                      : "border-border bg-card text-foreground hover:border-primary/40",
                  )}
                  style={linkedGoalId === g.id ? { backgroundColor: g.color } : undefined}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: linkedGoalId === g.id ? "white" : g.color }} />
                  <span className="truncate">{g.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <Button label="Cancel" onClick={onClose} variant="secondary" fullWidth />
          <Button label={initial ? "Save" : "Add Category"} onClick={save} variant="primary" fullWidth />
        </div>
      </div>
    </Modal>
  );
}

// ─── Income Source Modal ──────────────────────────────────────────────────────

function IncomeSourceModal({
  visible, onClose, budgetId, initial, defaultName,
}: {
  visible: boolean;
  onClose: () => void;
  budgetId: number;
  initial?: IncomeSource;
  defaultName?: string;
}) {
  const { createIncomeSource, updateIncomeSource, accounts } = useStore();
  const [name, setName] = useState(initial?.name ?? defaultName ?? "");
  const [amount, setAmount] = useState(String(initial?.amount ?? ""));
  const defaultFreq: "monthly" | "fortnightly" =
    defaultName?.toLowerCase().includes("partner") ? "fortnightly" : "monthly";
  const [freq, setFreq] = useState<"monthly" | "fortnightly">(initial?.frequency ?? defaultFreq);
  const [accountId, setAccountId] = useState<number | null>(initial?.accountId ?? null);

  const save = () => {
    const amt = parseFloat(amount);
    if (!name.trim()) { toast.error("Name required"); return; }
    if (isNaN(amt) || amt <= 0) { toast.error("Enter a valid amount"); return; }
    const payload = { name, amount: amt, frequency: freq, accountId: accountId ?? undefined };
    if (initial) {
      updateIncomeSource(initial.id, payload);
      toast.success("Income source updated");
    } else {
      createIncomeSource({ budgetId, ...payload });
      toast.success("Income source added");
    }
    onClose();
  };

  return (
    <Modal visible={visible} onClose={onClose} title={initial ? "Edit Income Source" : "Add Income Source"}>
      <div className="space-y-4">
        <Input label="Source Name" value={name} onChange={setName} placeholder="e.g. My salary, Partner income" autoFocus />
        <Input label="Amount (per pay)" value={amount} onChange={setAmount} type="number" prefix="$" />
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Pay Frequency</label>
          <div className="flex gap-2">
            {(["monthly", "fortnightly"] as const).map(f => (
              <button key={f} onClick={() => setFreq(f)} className={cn("px-4 py-2 rounded-full text-sm font-medium transition-colors capitalize", freq === f ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80")}>
                {f}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {freq === "monthly"
              ? "Paid once per month"
              : `Budgeted as ${formatCurrency(monthlyIncomeAmount(parseFloat(amount) || 0, "fortnightly"))}/mo`}
          </p>
        </div>
        <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} label="Deposit Account" />
        <div className="flex gap-2">
          <Button label="Cancel" onClick={onClose} variant="secondary" fullWidth />
          <Button label={initial ? "Save" : "Add"} onClick={save} variant="primary" fullWidth />
        </div>
      </div>
    </Modal>
  );
}

// ─── Recurring Modal ──────────────────────────────────────────────────────────

function RecurringModal({ visible, onClose, initial }: { visible: boolean; onClose: () => void; initial?: RecurringExpense }) {
  const { createRecurring, updateRecurring, createGoal, accounts, goals, holdings } = useStore();
  const [description, setDescription] = useState(initial?.description ?? "");
  const [amount, setAmount] = useState(String(initial?.amount ?? ""));
  const [categoryName, setCategoryName] = useState(initial?.categoryName ?? "");
  const [goalId, setGoalId] = useState<number | null>(initial?.goalId ?? null);
  const [holdingId, setHoldingId] = useState<number | null>(initial?.holdingId ?? null);
  const [frequency, setFrequency] = useState<PayFrequency>(initial?.frequency ?? "monthly");
  const [dayOfMonth, setDayOfMonth] = useState(String(initial?.dayOfMonth ?? "1"));
  const [dayOfWeek, setDayOfWeek] = useState(initial?.dayOfWeek ?? 1);
  const [anchorDate, setAnchorDate] = useState(initial?.anchorDate ?? "");
  const [accountId, setAccountId] = useState<number | null>(initial?.accountId ?? null);
  const [merchant, setMerchant] = useState(initial?.merchant ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const isGoalMode = goalId != null;
  const [showNewGoal, setShowNewGoal] = useState(false);
  const [newGoalName, setNewGoalName] = useState("");
  const [newGoalTarget, setNewGoalTarget] = useState("");
  const [newGoalColor, setNewGoalColor] = useState(Colors.categoryColors[0]);
  const [savingGoal, setSavingGoal] = useState(false);

  const handleCreateGoal = async () => {
    if (!newGoalName.trim()) { toast.error("Goal name is required"); return; }
    setSavingGoal(true);
    const targetAmount = newGoalTarget.trim() ? parseFloat(newGoalTarget) : undefined;
    if (newGoalTarget.trim() && (isNaN(targetAmount!) || targetAmount! <= 0)) { toast.error("Invalid target amount"); setSavingGoal(false); return; }
    const goal = createGoal({ name: newGoalName.trim(), targetAmount, color: newGoalColor, icon: "target" });
    setGoalId(goal.id);
    setShowNewGoal(false);
    setNewGoalName("");
    setNewGoalTarget("");
    setNewGoalColor(Colors.categoryColors[0]);
    setSavingGoal(false);
    toast.success(`Goal "${goal.name}" created`);
  };

  const save = () => {
    const amt = parseFloat(amount);
    if (!description.trim()) { toast.error("Description is required"); return; }
    if (!isGoalMode && !categoryName.trim()) { toast.error("Category name is required"); return; }
    if (isNaN(amt) || amt <= 0) { toast.error("Enter a valid amount"); return; }
    const payload = {
      description,
      amount: amt,
      categoryName: isGoalMode ? "" : categoryName,
      goalId: goalId ?? undefined,
      holdingId: holdingId ?? undefined,
      frequency,
      dayOfMonth: frequency === "monthly" ? Math.min(Math.max(parseInt(dayOfMonth) || 1, 1), 31) : undefined,
      dayOfWeek: frequency !== "monthly" ? dayOfWeek : undefined,
      anchorDate: frequency === "fortnightly" && anchorDate ? anchorDate : undefined,
      accountId: accountId ?? undefined,
      merchant,
      notes,
      isActive: initial?.isActive ?? true,
    };
    if (initial) {
      updateRecurring(initial.id, payload);
      toast.success("Recurring expense updated");
    } else {
      createRecurring(payload);
      toast.success("Recurring expense added");
    }
    onClose();
  };

  const amtNum = parseFloat(amount) || 0;

  return (
    <Modal visible={visible} onClose={onClose} title={initial ? "Edit Recurring Expense" : "New Recurring Expense"}>
      <div className="space-y-4">
        <div className="p-3 rounded-xl bg-primary/5 border border-primary/20">
          <p className="text-xs text-primary font-medium">
            Global templates — weekly, fortnightly, or monthly. Apply to any budget in one click.
          </p>
        </div>
        <Input label="Description" value={description} onChange={setDescription} placeholder="e.g. Netflix, Groceries" autoFocus />
        {!isGoalMode && (
          <Input label="Category Name" value={categoryName} onChange={setCategoryName} placeholder="e.g. Subscriptions" />
        )}
        <Input label="Amount (per occurrence)" value={amount} onChange={setAmount} type="number" prefix="$" placeholder="0.00" />
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Frequency</label>
          <div className="flex flex-wrap gap-2">
            {(["weekly", "fortnightly", "monthly"] as const).map(f => (
              <button key={f} onClick={() => setFrequency(f)} className={cn("px-4 py-2 rounded-full text-sm font-medium transition-colors capitalize", frequency === f ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80")}>
                {f}
              </button>
            ))}
          </div>
          {amtNum > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              ≈ {formatCurrency(monthlyRecurringAmount(amtNum, frequency))}/mo in this budget
            </p>
          )}
        </div>
        {frequency === "monthly" && (
          <Input label="Day of Month" value={dayOfMonth} onChange={setDayOfMonth} type="number" placeholder="1–31" />
        )}
        {frequency !== "monthly" && (
          <div>
            <label className="text-sm font-medium text-muted-foreground block mb-2">Day of Week</label>
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3, 4, 5, 6].map(d => (
                <button key={d} onClick={() => setDayOfWeek(d)} className={cn("px-3 py-1.5 rounded-full text-sm font-medium transition-colors", dayOfWeek === d ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80")}>
                  {dayOfWeekLabel(d)}
                </button>
              ))}
            </div>
          </div>
        )}
        {frequency === "fortnightly" && (
          <div>
            <Input label="Anchor Date (optional)" value={anchorDate} onChange={setAnchorDate} type="date" />
            <p className="text-xs text-muted-foreground mt-1">First known payment date — used to align the fortnightly cycle.</p>
          </div>
        )}
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">
            {isGoalMode ? "Or link to a Budget Category" : "Or link to a Savings Goal"}
          </label>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setGoalId(null)}
              className={cn("flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                goalId === null ? "bg-muted text-foreground border-border" : "border-dashed border-border text-muted-foreground hover:border-primary/40"
              )}>
              {isGoalMode ? "Switch to Category" : "None"}
            </button>
            {goals.map(g => (
              <button key={g.id} onClick={() => setGoalId(g.id === goalId ? null : g.id)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                  goalId === g.id
                    ? "border-transparent text-white"
                    : "border-border bg-card text-foreground hover:border-primary/40",
                )}
                style={goalId === g.id ? { backgroundColor: g.color } : undefined}>
                <span className={goalId === g.id ? "text-white" : "text-muted-foreground"}>⭐</span>
                <span className="truncate">{g.name}</span>
              </button>
            ))}
            <button onClick={() => setShowNewGoal(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-dashed border-border text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors">
              <Plus size={12} /> Goal
            </button>
          </div>
          {showNewGoal && (
            <div className="mt-3 p-3 rounded-xl border border-border bg-muted/20 space-y-3">
              <p className="text-xs font-semibold text-foreground">New Savings Goal</p>
              <Input placeholder="Goal name" value={newGoalName} onChange={setNewGoalName} autoFocus />
              <Input placeholder="Target (optional)" value={newGoalTarget} onChange={setNewGoalTarget} type="number" prefix="$" />
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Color</label>
                <ColorPicker value={newGoalColor} onChange={setNewGoalColor} colors={Colors.categoryColors} />
              </div>
              <div className="flex gap-2">
                <Button label={savingGoal ? "Creating…" : "Create Goal"} onClick={handleCreateGoal} variant="primary" size="sm" loading={savingGoal} />
                <Button label="Cancel" onClick={() => setShowNewGoal(false)} variant="secondary" size="sm" />
              </div>
            </div>
          )}
        </div>
        {!isGoalMode && holdings.length > 0 && (
          <div>
            <label className="text-sm font-medium text-muted-foreground block mb-2">Auto-invest to Holding (optional)</label>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setHoldingId(null)}
                className={cn("flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                  holdingId === null ? "bg-muted text-foreground border-border" : "border-dashed border-border text-muted-foreground hover:border-primary/40"
                )}>
                None
              </button>
              {holdings.map(h => (
                <button key={h.id} onClick={() => setHoldingId(h.id === holdingId ? null : h.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                    holdingId === h.id
                      ? "border-transparent text-white"
                      : "border-border bg-card text-foreground hover:border-primary/40",
                  )}
                  style={holdingId === h.id ? { backgroundColor: h.color } : undefined}>
                  <span className={holdingId === h.id ? "text-white" : "text-muted-foreground"}>📈</span>
                  <span className="truncate">{h.name}</span>
                </button>
              ))}
            </div>
            {holdingId != null && (
              <p className="text-xs text-muted-foreground mt-1">Creates a buy transaction on this holding when recurring is applied.</p>
            )}
          </div>
        )}
        <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} label="Paid From Account" />
        <Input label="Merchant (optional)" value={merchant} onChange={setMerchant} placeholder="e.g. Netflix" />
        <Input label="Notes (optional)" value={notes} onChange={setNotes} multiline placeholder="Any notes…" />
        <div className="flex gap-2 pt-1">
          <Button label="Cancel" onClick={onClose} variant="secondary" fullWidth />
          <Button label={initial ? "Save" : "Add Recurring"} onClick={save} variant="primary" fullWidth />
        </div>
      </div>
    </Modal>
  );
}

// ─── Copy Budget Modal ────────────────────────────────────────────────────────

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function CopyBudgetModal({
  visible, onClose, sourceBudget, onCopy,
}: {
  visible: boolean;
  onClose: () => void;
  sourceBudget: { id: number; name: string; month: number; year: number } | null;
  onCopy: (targetMonth: number, targetYear: number, applyRecurring: boolean) => void;
}) {
  const { budgets } = useStore();
  const cm = currentMonth();
  const [targetYear, setTargetYear] = useState(cm.year);
  const [targetMonth, setTargetMonth] = useState<number | null>(null);
  const [applyRec, setApplyRec] = useState(true);

  if (!sourceBudget) return null;

  // Years available: current year ± 1
  const years = Array.from(new Set([cm.year - 1, cm.year, cm.year + 1])).sort();

  const alreadyExists = (month: number) =>
    budgets.some(b => b.month === month && b.year === targetYear);

  const handleCopy = () => {
    if (!targetMonth) { toast.error("Pick a target month"); return; }
    if (alreadyExists(targetMonth)) { toast.error("A budget already exists for that month"); return; }
    onCopy(targetMonth, targetYear, applyRec);
    onClose();
  };

  return (
    <Modal visible={visible} onClose={onClose} title="Copy Budget to New Month">
      <div className="space-y-5">
        {/* Source info */}
        <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20">
          <Copy size={16} className="text-primary flex-shrink-0" />
          <p className="text-sm text-foreground">
            Copying <span className="font-semibold">{sourceBudget.name}</span>
            <span className="text-muted-foreground"> ({monthName(sourceBudget.month)} {sourceBudget.year})</span>
            <br />
            <span className="text-xs text-muted-foreground">Categories and allocations will be duplicated. Expenses are not copied.</span>
          </p>
        </div>

        {/* Target year */}
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-2">Target Year</p>
          <div className="flex gap-2">
            {years.map(y => (
              <button key={y} onClick={() => { setTargetYear(y); setTargetMonth(null); }}
                className={cn("px-4 py-1.5 rounded-full text-sm font-semibold border transition-colors",
                  y === targetYear ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/40")}>
                {y}
              </button>
            ))}
          </div>
        </div>

        {/* Target month grid */}
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-2">Target Month</p>
          <div className="grid grid-cols-4 gap-2">
            {MONTH_SHORT.map((label, idx) => {
              const month = idx + 1;
              const exists = alreadyExists(month);
              const isSource = sourceBudget.month === month && sourceBudget.year === targetYear;
              const selected = targetMonth === month;
              return (
                <button key={month} onClick={() => !exists && !isSource && setTargetMonth(month)}
                  disabled={exists || isSource}
                  className={cn(
                    "py-2.5 rounded-xl text-xs font-medium border transition-all",
                    selected ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : exists || isSource ? "bg-muted/30 text-muted-foreground/40 border-transparent cursor-not-allowed"
                        : "bg-card border-border hover:border-primary/50 hover:bg-primary/5 text-foreground",
                  )}>
                  {label}
                  {exists && !isSource && <span className="block text-[8px] opacity-60">taken</span>}
                  {isSource && <span className="block text-[8px] opacity-60">source</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Apply recurring option */}
        <button
          onClick={() => setApplyRec(v => !v)}
          className="flex items-center gap-3 w-full p-3 rounded-xl border border-border hover:bg-muted/50 transition-colors text-left"
        >
          <div className={cn("w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors",
            applyRec ? "bg-primary border-primary" : "border-muted-foreground/40")}>
            {applyRec && <span className="text-primary-foreground text-[10px] font-bold">✓</span>}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Apply recurring expenses</p>
            <p className="text-xs text-muted-foreground">Stamp active recurring templates into the new budget</p>
          </div>
        </button>

        <div className="flex gap-2 pt-1">
          <Button label="Cancel" onClick={onClose} variant="secondary" fullWidth />
          <Button label="Copy Budget" onClick={handleCopy} variant="primary" fullWidth icon={Copy}
            disabled={!targetMonth} />
        </div>
      </div>
    </Modal>
  );
}

// ─── Apply Result Modal ───────────────────────────────────────────────────────

function ApplyResultModal({
  visible, onClose, result,
}: {
  visible: boolean; onClose: () => void;
  result: { applied: number; skipped: number; unmatched: string[] } | null;
}) {
  if (!result) return null;
  return (
    <Modal visible={visible} onClose={onClose} title="Recurring Expenses Applied">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Card className="text-center py-3">
            <p className="text-2xl font-bold text-success">{result.applied}</p>
            <p className="text-xs text-muted-foreground mt-1">Applied</p>
          </Card>
          <Card className="text-center py-3">
            <p className="text-2xl font-bold text-muted-foreground">{result.skipped}</p>
            <p className="text-xs text-muted-foreground mt-1">Already existed</p>
          </Card>
        </div>
        {result.unmatched.length > 0 && (
          <div className="p-3 rounded-xl bg-warning/10 border border-warning/30">
            <p className="text-xs font-semibold text-warning mb-1.5">
              {result.unmatched.length} item{result.unmatched.length !== 1 ? "s" : ""} couldn't be matched:
            </p>
            {result.unmatched.map(u => <p key={u} className="text-xs text-muted-foreground">• {u}</p>)}
            <p className="text-xs text-muted-foreground mt-1.5">Add a matching category name to this budget and try again.</p>
          </div>
        )}
        <Button label="Done" onClick={onClose} variant="primary" fullWidth />
      </div>
    </Modal>
  );
}

// ─── Category Card ─────────────────────────────────────────────────────────────

function CategoryCard({ cat, recurring, activeBudgetId, expandedCategory, setExpandedCategory, expenses, summary, updateExpense, movingExpense, setMovingExpense, movingRefs, handleConvertToRecurring, setEditCat, setConfirmDelete }: {
  cat: any; recurring: boolean; activeBudgetId: number | null; expandedCategory: number | null; setExpandedCategory: (v: number | null) => void;
  expenses: any[]; summary: any; updateExpense: (id: number, e: any) => void;
  movingExpense: number | null; setMovingExpense: (v: number | null) => void; movingRefs: React.MutableRefObject<Record<number, HTMLDivElement | null>>;
  handleConvertToRecurring: (cat: any) => void; setEditCat: (cat: any) => void; setConfirmDelete: (v: any) => void;
}) {
  const { goals } = useStore();
  const linkedGoal = cat.linkedGoalId ? goals.find((g: any) => g.id === cat.linkedGoalId) : null;
  const effectiveMonthly = cat.frequency === "weekly" ? (cat.allocatedAmount * 52 / 12) : cat.frequency === "fortnightly" ? (cat.allocatedAmount * 26 / 12) : cat.allocatedAmount;
  const pct = effectiveMonthly > 0 ? (cat.spent ?? 0) / effectiveMonthly : 0;
  const over = pct > 1;
  const isExpanded = expandedCategory === cat.id;
  const catExpenses = expenses.filter(
    (e: any) => e.categoryId === cat.id,
  ).sort((a: any, b: any) => b.date.localeCompare(a.date));
  return (
    <Card padding={false} className={cn("px-4 py-3 cursor-pointer transition-colors hover:bg-muted/30", isExpanded && "rounded-b-none")}>
      <div className="flex items-center gap-3" onClick={() => setExpandedCategory(isExpanded ? null : cat.id)}>
        <ColorDot color={cat.color} size={12} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-medium text-foreground inline-flex items-center gap-1.5">
              {cat.name}
              {cat.frequency === "fortnightly" && <span className="text-[10px] text-muted-foreground/60 font-normal">/fn</span>}
              {cat.frequency === "weekly" && <span className="text-[10px] text-muted-foreground/60 font-normal">/wk</span>}
              {recurring && <CalendarClock size={11} className="text-primary" />}
              {linkedGoal && <Target size={11} style={{ color: linkedGoal.color }} />}
            </span>
            {linkedGoal && (
              <p className="text-[10px] text-muted-foreground/70 leading-tight">
                <Target size={9} className="inline mr-0.5" style={{ color: linkedGoal.color }} />
                {linkedGoal.name}
              </p>
            )}
            <div className="flex items-center gap-1.5">
              <span className={cn("text-xs font-medium flex items-center gap-1", over ? "text-destructive" : "text-muted-foreground")}>
                <span>{formatCurrency(cat.spent ?? 0)} / {formatCurrency(cat.allocatedAmount)}{cat.frequency === "fortnightly" ? <span className="text-[10px] text-muted-foreground/60">/fn</span> : cat.frequency === "weekly" ? <span className="text-[10px] text-muted-foreground/60">/wk</span> : null}</span>
                {over && (
                  <span className="text-destructive/70 text-[10px] font-semibold whitespace-nowrap">
                    (+{formatCurrency((cat.spent ?? 0) - effectiveMonthly)}, {Math.round((pct - 1) * 100)}%)
                  </span>
                )}
                {cat.frequency !== "monthly" && !over && (
                  <span className="text-[10px] text-muted-foreground/60">≈{formatCurrency(effectiveMonthly)}/mo</span>
                )}
              </span>
              <button onClick={(e) => { e.stopPropagation(); handleConvertToRecurring(cat); }} className="p-1 rounded-lg hover:bg-muted text-muted-foreground" title="Convert to recurring expense"><Repeat size={12} /></button>
              <button onClick={(e) => { e.stopPropagation(); setEditCat(cat); }} className="p-1 rounded-lg hover:bg-muted text-muted-foreground"><Edit2 size={12} /></button>
              <button onClick={(e) => { e.stopPropagation(); setConfirmDelete({ type: "category", id: cat.id }); }} className="p-1 rounded-lg hover:bg-muted text-muted-foreground"><Trash2 size={12} /></button>
              <ChevronDown size={14} className={cn("text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
            </div>
          </div>
          <ProgressBar value={pct} color={over ? Colors.danger : cat.color} height={6} />
        </div>
      </div>
      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-border space-y-1" onClick={e => e.stopPropagation()}>
          {catExpenses.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">No transactions yet</p>
          ) : (
            catExpenses.map((ex: any) => (
              <div key={ex.id} className="flex items-center gap-2 py-1.5 px-1 rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{ex.description}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {ex.date}{ex.merchant ? ` · ${ex.merchant}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-xs font-semibold text-foreground">{formatCurrency(ex.amount)}</span>
                  <button
                    onClick={() => setMovingExpense(movingExpense === ex.id ? null : ex.id)}
                    className="p-1 rounded-lg hover:bg-muted text-muted-foreground"
                    title="Move to another category"
                  >
                    <MoveRight size={11} />
                  </button>
                </div>
                {movingExpense === ex.id && (
                  <div className="w-full mt-1" ref={el => { movingRefs.current[ex.id] = el; }}>
                    <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-muted/50 border border-border">
                      <p className="w-full text-[10px] text-muted-foreground font-medium mb-0.5">Move to category:</p>
                      {[...summary.categories].filter((c: any) => !c.isRounding && c.id !== cat.id).sort((a: any, b: any) => a.name.localeCompare(b.name)).map((targetCat: any) => (
                        <button
                          key={targetCat.id}
                          onClick={() => {
                            updateExpense(ex.id, { categoryId: targetCat.id });
                            setMovingExpense(null);
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-card hover:bg-primary/10 border border-border hover:border-primary/30 transition-colors"
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: targetCat.color }} />
                          {targetCat.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Rounding Card ─────────────────────────────────────────────────────────────

function RoundingCard({ cat, recurring, activeBudgetId, expandedCategory, setExpandedCategory, expenses, summary, updateExpense, movingExpense, setMovingExpense, movingRefs, handleConvertToRecurring, setEditCat, setConfirmDelete }: {
  cat: any; recurring: boolean; activeBudgetId: number | null; expandedCategory: number | null; setExpandedCategory: (v: number | null) => void;
  expenses: any[]; summary: any; updateExpense: (id: number, e: any) => void;
  movingExpense: number | null; setMovingExpense: (v: number | null) => void; movingRefs: React.MutableRefObject<Record<number, HTMLDivElement | null>>;
  handleConvertToRecurring: (cat: any) => void; setEditCat: (cat: any) => void; setConfirmDelete: (v: any) => void;
}) {
  const isExpanded = expandedCategory === cat.id;
  const catExpenses = expenses.filter(
    (e: any) => e.categoryId === cat.id,
  ).sort((a: any, b: any) => b.date.localeCompare(a.date));
  return (
    <Card padding={false} className={cn("px-4 py-3 border-success/20 cursor-pointer transition-colors hover:bg-muted/30", isExpanded && "rounded-b-none")}>
      <div className="flex items-center gap-3" onClick={() => setExpandedCategory(isExpanded ? null : cat.id)}>
        <ColorDot color={cat.color} size={12} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground inline-flex items-center gap-1.5">
              {cat.name}
              {recurring && <CalendarClock size={11} className="text-primary" />}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-success">{formatCurrency(cat.spent ?? 0)}</span>
              <button onClick={(e) => { e.stopPropagation(); handleConvertToRecurring(cat); }} className="p-1 rounded-lg hover:bg-muted text-muted-foreground" title="Convert to recurring expense"><Repeat size={12} /></button>
              <button onClick={(e) => { e.stopPropagation(); setEditCat(cat); }} className="p-1 rounded-lg hover:bg-muted text-muted-foreground"><Edit2 size={12} /></button>
              <button onClick={(e) => { e.stopPropagation(); setConfirmDelete({ type: "category", id: cat.id }); }} className="p-1 rounded-lg hover:bg-muted text-muted-foreground"><Trash2 size={12} /></button>
              <ChevronDown size={14} className={cn("text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground">No budget allocation — savings tracked</p>
        </div>
      </div>
      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-border space-y-1" onClick={e => e.stopPropagation()}>
          {catExpenses.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">No transactions yet</p>
          ) : (
            catExpenses.map((ex: any) => (
              <div key={ex.id} className="flex items-center gap-2 py-1.5 px-1 rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{ex.description}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {ex.date}{ex.merchant ? ` · ${ex.merchant}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="text-xs font-semibold text-success">{formatCurrency(ex.amount)}</span>
                  <button
                    onClick={() => setMovingExpense(movingExpense === ex.id ? null : ex.id)}
                    className="p-1 rounded-lg hover:bg-muted text-muted-foreground"
                    title="Move to another category"
                  >
                    <MoveRight size={11} />
                  </button>
                </div>
                {movingExpense === ex.id && (
                  <div className="w-full mt-1" ref={el => { movingRefs.current[ex.id] = el; }}>
                    <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-muted/50 border border-border">
                      <p className="w-full text-[10px] text-muted-foreground font-medium mb-0.5">Move to category:</p>
                      {[...summary.categories].filter((c: any) => !c.isRounding && c.id !== cat.id).sort((a: any, b: any) => a.name.localeCompare(b.name)).map((targetCat: any) => (
                        <button
                          key={targetCat.id}
                          onClick={() => {
                            updateExpense(ex.id, { categoryId: targetCat.id });
                            setMovingExpense(null);
                          }}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-card hover:bg-primary/10 border border-border hover:border-primary/30 transition-colors"
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: targetCat.color }} />
                          {targetCat.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Recurring Row ────────────────────────────────────────────────────────────

function RecurringRow({ rec, accountName, goalName, goalColor, onEdit, onDelete, onToggle, onConvert }: {
  rec: RecurringExpense; accountName?: string; goalName?: string; goalColor?: string; onEdit: () => void; onDelete: () => void; onToggle: () => void; onConvert?: () => void;
}) {
  const isGoalLinked = rec.goalId != null;
  return (
    <Card padding={false} className={cn("px-4 py-3", !rec.isActive && "opacity-60")}>
      <div className="flex items-center gap-3">
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0", isGoalLinked ? "bg-yellow-100 dark:bg-yellow-900/30" : rec.isActive ? "bg-primary/10" : "bg-muted")}>
          <CalendarClock size={15} className={isGoalLinked ? "text-yellow-600 dark:text-yellow-400" : rec.isActive ? "text-primary" : "text-muted-foreground"} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{rec.description}</p>
          <p className="text-xs text-muted-foreground">
            {isGoalLinked
              ? <><span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: goalColor ?? "var(--chart-2)" }} />{goalName ?? "Goal"}</span> · {formatRecurringSchedule(rec)}</>
              : <>{rec.categoryName} · {formatRecurringSchedule(rec)}</>}
            {accountName && <> · {accountName}</>}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <div className="text-right mr-1">
            <span className="text-sm font-semibold text-foreground block">{formatCurrency(rec.amount)}</span>
            <span className="text-[10px] text-muted-foreground">{formatCurrency(monthlyRecurringAmount(rec.amount, rec.frequency))}/mo</span>
          </div>
          <button onClick={onToggle} className={cn("p-1.5 rounded-lg transition-colors", rec.isActive ? "text-primary hover:bg-primary/10" : "text-muted-foreground hover:bg-muted")} title={rec.isActive ? "Pause" : "Activate"}>
            {rec.isActive ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
          </button>
          {onConvert && <button onClick={onConvert} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground" title="Convert to budget category"><Tag size={13} /></button>}
          <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><Edit2 size={13} /></button>
          <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><Trash2 size={13} /></button>
        </div>
      </div>
    </Card>
  );
}

// ─── Section Rules ────────────────────────────────────────────────────────────

const SECTION_KEYWORDS: [string, string][] = [
  ["fuel|petrol|diesel|uber|taxi|lyft|bus|train|metro|tram|parking|toll|car|auto|transport|ride|drive", "Transport"],
  ["grocery|supermarket|coles|woolworths|aldi|iga|food|dining|restaurant|cafe|takeaway|mcdonald|kfc|pizza|sushi|bakery|eat", "Food"],
  ["rent|mortgage|lease|property|housing", "Housing"],
  ["electricity|energy|power|gas|water|utility|bill|internet|nbn|phone|mobile|telstra|optus|vodafone", "Utilities"],
  ["netflix|spotify|apple|google|amazon|disney|youtube|hulu|patreon|subscription", "Subscriptions"],
  ["insuranc|aami|allianz|bupa|medibank|nib", "Insurance"],
  ["doctor|medical|dentist|pharmacy|chemist|hospital|clinic|health|physio|gym|fitness", "Health"],
  ["clothing|fashion|target|kmart|big w|ikea|home|furniture|decor|bunnings|hardware|kogan|catch", "Shopping"],
  ["cinema|movie|game|hobby|book|music|concert|event|festival", "Entertainment"],
  ["flight|airbnb|hotel|travel|holiday|vacation|accommodation|booking|hostel", "Travel"],
  ["invest|super|share|stock|etf|dividend|crypto|index", "Investments"],
];

// ─── Budget Print Modal ─────────────────────────────────────────────────────────

function BudgetPrintModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { goals, categories, recurring, budgetSections: rawBudgetSections, accounts, activeBudgetId, getBudgetSummary } = useStore();
  const budgetSections = rawBudgetSections ?? [];
  const summary = activeBudgetId ? getBudgetSummary(activeBudgetId) : null;
  const activeBudget = summary?.budget;
  if (!summary || !activeBudget) return null;
  const { startDate, endDate } = getBudgetDateRange(activeBudget);
  const sectionLookup = new Map(budgetSections.map(s => [s.id, s]));
  const goalLookup = new Map(goals.map(g => [g.id, g]));
  const budgetCats = summary.categories.filter((c: any) => !c.isRounding);
  const roundingCats = summary.categories.filter((c: any) => c.isRounding);

  const bySection: Record<string, typeof budgetCats> = {};
  for (const cat of budgetCats) {
    const secName = cat.sectionId != null ? (sectionLookup.get(cat.sectionId)?.name ?? "Other") : "Other";
    if (!bySection[secName]) bySection[secName] = [];
    bySection[secName].push(cat);
  }
  const sectionKeys = Object.keys(bySection).sort((a, b) => a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b));

  const catMonthly = (c: any) => c.frequency === "weekly" ? (c.allocatedAmount * 52 / 12) : c.frequency === "fortnightly" ? (c.allocatedAmount * 26 / 12) : c.allocatedAmount;

  return (
    <Modal visible={visible} onClose={onClose} title="" maxWidth="5xl">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #budget-print-content, #budget-print-content * { visibility: visible; }
          #budget-print-content { position: absolute; left: 0; top: 0; width: 100%; padding: 0.5in; }
          .print-hide { display: none !important; }
          @page { margin: 0.5in; }
        }
      `}</style>
      <div id="budget-print-content">
        {/* ── Print action bar ── */}
        <div className="print-hide flex items-center justify-between mb-4">
          <p className="text-sm text-muted-foreground">Budget print preview</p>
          <div className="flex gap-2">
            <Button label="Print" onClick={() => window.print()} variant="primary" icon={Printer} />
            <Button label="Close" onClick={onClose} variant="secondary" />
          </div>
        </div>

        {/* ── Budget Header ── */}
        <div className="mb-4">
          <h1 className="text-lg font-bold text-foreground">{activeBudget.name}</h1>
          <p className="text-sm text-muted-foreground">{monthName(activeBudget.month)} {activeBudget.year} · {formatDate(startDate)} → {formatDate(endDate)}</p>
        </div>

        {/* ── Summary Stats ── */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="bg-muted rounded-lg p-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Income</p>
            <p className="text-sm font-bold text-foreground">{formatCurrency(summary.totalIncome)}</p>
          </div>
          <div className="bg-muted rounded-lg p-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Allocated</p>
            <p className="text-sm font-bold text-foreground">{formatCurrency(summary.totalAllocated)}</p>
          </div>
          <div className="bg-muted rounded-lg p-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Unallocated</p>
            <p className="text-sm font-bold" style={{ color: summary.unallocated >= 0 ? "var(--success)" : "var(--danger)" }}>{formatCurrency(summary.unallocated)}</p>
          </div>
          <div className="bg-muted rounded-lg p-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Spent</p>
            <p className="text-sm font-bold text-foreground">{formatCurrency(summary.totalSpent)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground mb-4">
          {summary.incomeFromSources > 0 && <span>From income: {formatCurrency(summary.incomeFromSources)}</span>}
          {summary.carryover > 0 && <span>Carryover: {formatCurrency(summary.carryover)}</span>}
          {summary.totalRoundingSaved > 0 && <span>Round-up saved: {formatCurrency(summary.totalRoundingSaved)}</span>}
          {summary.uncategorizedTotal > 0 && <span>Uncategorized: {formatCurrency(summary.uncategorizedTotal)}</span>}
          <span>Remaining: {formatCurrency(summary.totalIncome - summary.totalSpent)}</span>
        </div>

        {/* ── Income Sources ── */}
        {summary.incomeSources.length > 0 && (
          <div className="mb-4">
            <h2 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">Income Sources</h2>
            <div className="divide-y divide-border">
              {summary.incomeSources.map(s => {
                const acct = accounts.find(a => a.id === s.accountId);
                return (
                  <div key={s.id} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="text-foreground">{s.name}</span>
                    <span className="text-muted-foreground">{formatCurrency(s.amount)}/{s.frequency === "monthly" ? "mo" : "fn"}{acct ? ` · ${acct.name}` : ""}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Goals ── */}
        {goals.length > 0 && (
          <div className="mb-4">
            <h2 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">Savings Goals</h2>
            <div className="space-y-2">
              {goals.map(g => {
                const hasTarget = g.targetAmount != null && g.targetAmount > 0;
                const pct = hasTarget ? g.currentAmount / g.targetAmount! : 0;
                const linkedCats = categories.filter(c => c.linkedGoalId === g.id);
                const linkedRecurring = recurring.filter(r => r.goalId === g.id);
                return (
                  <div key={g.id} className="border border-border rounded-lg p-2.5">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: g.color }} />
                        <span className="text-sm font-semibold text-foreground">{g.name}</span>
                      </div>
                      <span className="text-sm font-medium text-foreground">{formatCurrency(g.currentAmount)}{hasTarget ? ` / ${formatCurrency(g.targetAmount!)}` : ""}</span>
                    </div>
                    {hasTarget && (
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-1">
                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct * 100, 100)}%`, backgroundColor: g.color }} />
                      </div>
                    )}
                    {(linkedCats.length > 0 || linkedRecurring.length > 0) && (
                      <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
                        {linkedCats.length > 0 && <p>Categories: {linkedCats.map(c => c.name).join(", ")}</p>}
                        {linkedRecurring.length > 0 && <p>Recurring: {linkedRecurring.map(r => r.description).join(", ")}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Budget Categories by Section ── */}
        {budgetCats.length > 0 && (
          <div className="mb-4">
            <h2 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">Budget Categories</h2>
            <div className="space-y-3">
              {sectionKeys.map(sec => {
                const cats = bySection[sec];
                const secTotal = cats.reduce((s: number, c: any) => s + catMonthly(c), 0);
                const secSpent = cats.reduce((s: number, c: any) => s + (c.spent ?? 0), 0);
                return (
                  <div key={sec}>
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-xs font-semibold text-foreground">{sec}</h3>
                      <span className="text-[10px] text-muted-foreground">alloc {formatCurrency(secTotal)} · spent {formatCurrency(secSpent)}</span>
                    </div>
                    <div className="space-y-1">
                      {cats.map((cat: any) => {
                        const monthly = catMonthly(cat);
                        const spent = cat.spent ?? 0;
                        const pct = monthly > 0 ? spent / monthly : 0;
                        const overBudget = monthly > 0 && spent > monthly;
                        const linkedGoal = cat.linkedGoalId != null ? goalLookup.get(cat.linkedGoalId) : null;
                        return (
                          <div key={cat.id} className="flex items-center gap-2 py-1">
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-foreground font-medium truncate">{cat.name}{cat.frequency && cat.frequency !== "monthly" ? cat.frequency === "weekly" ? " /wk" : " /fn" : ""}</span>
                                <span className="text-xs" style={{ color: overBudget ? "var(--danger)" : "var(--foreground)" }}>
                                  {formatCurrency(monthly)} alloc
                                  {monthly > 0 && <> · {formatCurrency(spent)} spent</>}
                                </span>
                              </div>
                              {monthly > 0 && (
                                <div className="h-1 rounded-full bg-muted overflow-hidden mt-0.5">
                                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct * 100, 100)}%`, backgroundColor: overBudget ? "var(--danger)" : cat.color }} />
                                </div>
                              )}
                              {linkedGoal && (
                                <p className="text-[9px] text-muted-foreground mt-0.5">⭐ Linked: {linkedGoal.name}</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Uncategorized Expenses ── */}
        {summary.uncategorizedTotal > 0 && (
          <div className="mb-4">
            <h2 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">Uncategorized Expenses</h2>
            <p className="text-xs text-muted-foreground">{formatCurrency(summary.uncategorizedTotal)} total</p>
          </div>
        )}

        {/* ── Round-up Savings ── */}
        {roundingCats.length > 0 && (
          <div className="mb-4">
            <h2 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">Round-up Savings</h2>
            <div className="space-y-1">
              {roundingCats.map((cat: any) => {
                const linkedGoal = cat.linkedGoalId != null ? goalLookup.get(cat.linkedGoalId) : null;
                return (
                  <div key={cat.id} className="flex items-center gap-2 py-0.5 text-sm">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                    <span className="text-foreground">{cat.name}</span>
                    <span className="text-muted-foreground text-xs">· saved {formatCurrency(cat.spent ?? 0)}</span>
                    {linkedGoal && <span className="text-muted-foreground text-xs">· ⭐ {linkedGoal.name}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Recurring Templates ── */}
        {recurring.length > 0 && (
          <div className="mb-4">
            <h2 className="text-xs font-bold text-foreground uppercase tracking-wider mb-2">Recurring Templates</h2>
            <div className="space-y-1">
              {recurring.filter(r => r.isActive).map(r => {
                const linkedGoal = r.goalId != null ? goalLookup.get(r.goalId) : null;
                return (
                  <div key={r.id} className="flex items-center justify-between py-1 text-sm">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-foreground truncate">{r.description}</span>
                      <span className="text-muted-foreground text-xs whitespace-nowrap">
                        {linkedGoal
                          ? <><span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: linkedGoal.color }} /> {linkedGoal.name}</>
                          : r.categoryName}
                        · {formatRecurringSchedule(r)}
                      </span>
                    </div>
                    <span className="text-foreground font-medium ml-2">{formatCurrency(r.amount)}/{r.frequency === "weekly" ? "wk" : r.frequency === "fortnightly" ? "fn" : "mo"}</span>
                  </div>
                );
              })}
              {recurring.filter(r => !r.isActive).length > 0 && (
                <>
                  <p className="text-[10px] text-muted-foreground mt-2 mb-1">Paused</p>
                  {recurring.filter(r => !r.isActive).map(r => (
                    <div key={r.id} className="flex items-center justify-between py-0.5 text-sm opacity-60">
                      <span className="text-foreground truncate">{r.description}</span>
                      <span className="text-foreground font-medium ml-2">{formatCurrency(r.amount)}/{r.frequency === "weekly" ? "wk" : "fn"}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function BudgetPage() {
  const {
    budgets, activeBudgetId, setActiveBudget, getBudgetSummary, getSuggestedCarryover,
    categories, expenses, recurring, accounts, goals, budgetSections,
    deleteCategory, deleteBudget, deleteIncomeSource, deleteRecurring,
    updateRecurring, applyRecurring, copyBudget, updateBudget,
    createCategory, createRecurring, updateExpense,
    createBudgetSection, updateCategory,
  } = useStore();

  const cm = currentMonth();
  const [selectedYear, setSelectedYear] = useState(cm.year);
  const [expandedCategory, setExpandedCategory] = useState<number | null>(null);
  const [movingExpense, setMovingExpense] = useState<number | null>(null);
  const movingRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [showNewBudget, setShowNewBudget] = useState(false);
  const [newBudgetDefaults, setNewBudgetDefaults] = useState<{ month: number; year: number } | null>(null);
  const [editBudget, setEditBudget] = useState<typeof budgets[0] | null>(null);
  const [showNewCat, setShowNewCat] = useState(false);
  const [editCat, setEditCat] = useState<typeof categories[0] | null>(null);
  const [showIncome, setShowIncome] = useState(false);
  const [editIncome, setEditIncome] = useState<IncomeSource | null>(null);
  const [incomeDefaultName, setIncomeDefaultName] = useState<string | undefined>();
  const [editingCarryover, setEditingCarryover] = useState(false);
  const [carryoverDraft, setCarryoverDraft] = useState("");
  const [showNewRecurring, setShowNewRecurring] = useState(false);
  const [editRecurring, setEditRecurring] = useState<RecurringExpense | null>(null);
  const [applyResult, setApplyResult] = useState<{ applied: number; skipped: number; unmatched: string[] } | null>(null);
  const [showCopy, setShowCopy] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ type: "budget" | "category" | "income" | "recurring"; id: number } | null>(null);
  const [filterCategoryId, setFilterCategoryId] = useState<number | "uncategorized" | null>(null);
  const [viewMode, setViewMode] = useState<"cards" | "compact" | "list">(() => (localStorage.getItem("budgetView") as "cards" | "compact" | "list") ?? "cards");
  const setView = (mode: "cards" | "compact" | "list") => { setViewMode(mode); localStorage.setItem("budgetView", mode); };

  const safeBudgetSections = budgetSections ?? [];
  const summary = activeBudgetId ? getBudgetSummary(activeBudgetId) : null;
  const activeBudget = summary?.budget;
  const suggestedCarryover = activeBudgetId ? getSuggestedCarryover(activeBudgetId) : null;
  const budgetIncome = summary?.incomeSources ?? [];
  const budgetDateRange = summary?.budget ? getBudgetDateRange(summary.budget) : null;
  const budgetExpenses = budgetDateRange ? expenses.filter(
    e => e.budgetId === activeBudgetId && e.date >= budgetDateRange.startDate && e.date <= budgetDateRange.endDate && e.isWithdrawal !== true,
  ).filter(e => {
    if (filterCategoryId === "uncategorized") return e.categoryId == null;
    if (filterCategoryId != null) return e.categoryId === filterCategoryId;
    return true;
  }) : [];

  const openAddIncome = (defaultName?: string) => {
    setEditIncome(null);
    setIncomeDefaultName(defaultName);
    setShowIncome(true);
  };

  const saveCarryover = () => {
    if (!activeBudgetId) return;
    const amt = parseFloat(carryoverDraft) || 0;
    if (carryoverDraft && (isNaN(amt) || amt < 0)) {
      toast.error("Enter a valid carryover amount");
      return;
    }
    updateBudget(activeBudgetId, { carryoverAmount: amt });
    setEditingCarryover(false);
    toast.success("Carryover updated");
  };
  const activeRecurring = recurring.filter(r => r.isActive);
  const inactiveRecurring = recurring.filter(r => !r.isActive);

  const handleApplyRecurring = () => {
    if (!activeBudgetId) return;
    const result = applyRecurring(activeBudgetId);
    setApplyResult(result);
    if (result.applied > 0) toast.success(`Applied ${result.applied} recurring expense${result.applied !== 1 ? "s" : ""}`);
    else if (result.skipped > 0 && result.unmatched.length === 0) toast.info("All recurring expenses already applied for this budget");
  };

  const handleConvertToRecurring = (cat: NonNullable<typeof summary>["categories"][0]) => {
    createRecurring({
      description: cat.name,
      amount: cat.allocatedAmount,
      categoryName: cat.name,
      frequency: "monthly",
      dayOfMonth: 1,
      isActive: true,
    });
    toast.success(`"${cat.name}" added as a recurring expense`);
  };

  const handleConvertToCategory = (rec: RecurringExpense) => {
    if (!activeBudgetId) return;
    createCategory({
      budgetId: activeBudgetId,
      name: rec.description,
      allocatedAmount: rec.amount,
      color: Colors.categoryColors[Math.floor(Math.random() * Colors.categoryColors.length)],
      icon: "wallet",
    });
    deleteRecurring(rec.id);
    toast.success(`"${rec.description}" converted to a budget category`);
  };

  const handleOrganizeSections = () => {
    if (!activeBudgetId) return;
    const cats = categories.filter(c => c.budgetId === activeBudgetId && c.sectionId == null && !c.isRounding);
    let assigned = 0;
    for (const cat of cats) {
      const lower = cat.name.toLowerCase();
      let match: string | null = null;
      for (const [keywords, sectionName] of SECTION_KEYWORDS) {
        if (keywords.split("|").some(kw => lower.includes(kw))) {
          match = sectionName;
          break;
        }
      }
      if (!match) continue;
      let sec = safeBudgetSections.find(s => s.budgetId === activeBudgetId && s.name === match);
      if (!sec) {
        sec = createBudgetSection({ budgetId: activeBudgetId, name: match, sortOrder: safeBudgetSections.filter(s => s.budgetId === activeBudgetId).length });
      }
      updateCategory(cat.id, { sectionId: sec.id });
      assigned++;
    }
    if (assigned > 0) toast.success(`Organized ${assigned} categor${assigned === 1 ? "y" : "ies"} into sections`);
    else toast.info("No unorganized categories found");
  };

  const openCreateForMonth = (month: number, year: number) => {
    setNewBudgetDefaults({ month, year });
    setShowNewBudget(true);
  };

  return (
    <div>
      <PageHeader
        title="Budget"
        actions={<Button label="New Budget" onClick={() => { setNewBudgetDefaults(null); setShowNewBudget(true); }} variant="primary" size="sm" icon={Plus} />}
      />

      <div className="px-4 sm:px-6 space-y-5 pb-6">
        {/* Year/Month navigation */}
        {budgets.length > 0 ? (
          <>
            <BudgetYearTabs selectedYear={selectedYear} onSelectYear={setSelectedYear} />
            <BudgetMonthGrid
              year={selectedYear}
              activeBudgetId={activeBudgetId}
              onSelect={setActiveBudget}
              onCreateMonth={openCreateForMonth}
            />
          </>
        ) : (
          <EmptyState icon={Wallet} title="No budget yet"
            subtitle="Create a budget to start allocating your income."
            action={{ label: "Create Budget", onPress: () => setShowNewBudget(true) }}
          />
        )}

        {activeBudget && summary && (
          <>
            {/* Budget summary */}
            <Card>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-base font-bold text-foreground">{activeBudget.name}</p>
                  <p className="text-sm text-muted-foreground">{monthName(activeBudget.month)} {activeBudget.year}</p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setShowPrint(true)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground" title="Print budget"><Printer size={14} /></button>
                  <button onClick={() => setShowCopy(true)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground" title="Copy to new month"><Copy size={14} /></button>
                  <button onClick={() => setEditBudget(activeBudget)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><Edit2 size={14} /></button>
                  <button onClick={() => setConfirmDelete({ type: "budget", id: activeBudget.id })} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><Trash2 size={14} /></button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                {[
                  { label: "Total Income", value: summary.totalIncome, color: Colors.primary },
                  { label: "Allocated", value: summary.totalAllocated, color: Colors.warning },
                  { label: "Unallocated", value: summary.unallocated, color: summary.unallocated >= 0 ? Colors.success : Colors.danger },
                  { label: "Spent", value: summary.totalSpent, color: Colors.danger },
                ].map(item => (
                  <div key={item.label} className="bg-muted rounded-xl p-2">
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className="text-sm font-bold" style={{ color: item.color }}>{formatCurrency(item.value)}</p>
                    {item.label === "Spent" && summary.totalRoundingSaved > 0 && (
                      <p className="text-[10px] text-success mt-0.5">+{formatCurrency(summary.totalRoundingSaved)} round-up saved</p>
                    )}
                  </div>
                ))}
              </div>
              {summary.totalIncome > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {summary.incomeFromSources > 0 && (
                    <span>Income sources: {formatCurrency(summary.incomeFromSources)}</span>
                  )}
                  {summary.carryover > 0 && (
                    <span>Carryover: {formatCurrency(summary.carryover)}</span>
                  )}
                  {summary.totalRoundingSaved > 0 && (
                    <span className="text-success">Round-up saved: {formatCurrency(summary.totalRoundingSaved)}</span>
                  )}
                  {summary.uncategorizedTotal > 0 && (
                    <span className="text-warning">Uncategorized: {formatCurrency(summary.uncategorizedTotal)}</span>
                  )}
                  <span>Remaining after spend: {formatCurrency(summary.remaining)}</span>
                </div>
              )}
              {summary.totalAllocated > 0 && (
                <div className="mt-3">
                  <ProgressBar value={summary.totalSpent / summary.totalAllocated} color={summary.totalSpent > summary.totalAllocated ? Colors.danger : Colors.primary} height={8} />
                </div>
              )}
            </Card>

            {/* Budget Health */}
            {(() => {
              const catMonthly = (c: any) => c.frequency === "weekly" ? (c.allocatedAmount * 52 / 12) : c.frequency === "fortnightly" ? (c.allocatedAmount * 26 / 12) : c.allocatedAmount;
              const budgetCats = summary.categories.filter((c: any) => !c.isRounding);
              const overCats = budgetCats.filter((c: any) => catMonthly(c) > 0 && (c.spent ?? 0) > catMonthly(c));
              if (overCats.length === 0) return null;
              const totalOverspend = overCats.reduce((s: number, c: any) => s + (c.spent ?? 0) - catMonthly(c), 0);
              const avgOverPct = Math.round(overCats.reduce((s: number, c: any) => s + (((c.spent ?? 0) / catMonthly(c)) - 1), 0) / overCats.length * 100);
              const healthyCount = budgetCats.filter((c: any) => catMonthly(c) > 0 && (c.spent ?? 0) <= catMonthly(c)).length;
              const healthPct = budgetCats.filter((c: any) => catMonthly(c) > 0).length > 0
                ? healthyCount / budgetCats.filter((c: any) => catMonthly(c) > 0).length : 0;
              return (
                <Card>
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-destructive/10 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle size={16} className="text-destructive" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">Budget Health</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        <span className="text-destructive font-medium">{overCats.length} of {budgetCats.length}</span> categories over budget
                        {budgetCats.length > 1 && <span className="text-muted-foreground/60"> · Avg {avgOverPct}% over</span>}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <div className="flex-1 max-w-40">
                          <ProgressBar value={healthPct} color={healthPct > 0.5 ? Colors.success : Colors.danger} height={5} />
                        </div>
                        <span className="text-[10px] text-muted-foreground font-medium">{Math.round(healthPct * 100)}% healthy</span>
                      </div>
                      <p className="text-[11px] text-destructive font-medium mt-1">
                        Total overspend: {formatCurrency(totalOverspend)}
                      </p>
                    </div>
                  </div>
                </Card>
              );
            })()}

            {/* Income & Salary */}
            <div>
              <SectionHeader
                title="Income & Salary"
                action={{ label: "+ Add", onPress: () => openAddIncome() }}
              />
              <Card className="space-y-3">
                {budgetIncome.length === 0 ? (
                  <div className="grid sm:grid-cols-2 gap-2">
                    {["My Salary", "Partner Income"].map(label => (
                      <button
                        key={label}
                        onClick={() => openAddIncome(label)}
                        className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-colors text-left"
                      >
                        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Wallet size={16} className="text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{label}</p>
                          <p className="text-xs text-muted-foreground">Tap to add</p>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="divide-y divide-border -mx-4">
                    {budgetIncome.map(inc => (
                      <div key={inc.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">{inc.name}</p>
                          <p className="text-xs text-muted-foreground capitalize">
                            {formatCurrency(inc.amount)}/pay · {inc.frequency}
                            {inc.accountId && accounts.find(a => a.id === inc.accountId) && (
                              <> · {accounts.find(a => a.id === inc.accountId)!.name}</>
                            )}
                            {inc.frequency === "fortnightly" && (
                              <> · {formatCurrency(monthlyIncomeAmount(inc.amount, inc.frequency))}/mo</>
                            )}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-foreground">
                          {formatCurrency(monthlyIncomeAmount(inc.amount, inc.frequency))}
                        </span>
                        <button onClick={() => { setEditIncome(inc); setShowIncome(true); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><Edit2 size={13} /></button>
                        <button onClick={() => setConfirmDelete({ type: "income", id: inc.id })} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><Trash2 size={13} /></button>
                      </div>
                    ))}
                    {budgetIncome.length === 1 && (
                      <button
                        onClick={() => openAddIncome("Partner Income")}
                        className="w-full px-4 py-3 text-left text-sm text-primary hover:bg-primary/5 transition-colors"
                      >
                        + Add second income source
                      </button>
                    )}
                  </div>
                )}

                {/* Unallocated carryover */}
                <div className="pt-1 border-t border-border">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">Unallocated Carryover</p>
                      <p className="text-xs text-muted-foreground">Leftover money from a previous period</p>
                    </div>
                    {editingCarryover ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          value={carryoverDraft}
                          onChange={e => setCarryoverDraft(e.target.value)}
                          className="w-24 text-sm rounded-lg border border-border bg-background px-2 py-1.5 text-right"
                          autoFocus
                        />
                        <button onClick={saveCarryover} className="text-xs font-medium text-primary">Save</button>
                        <button onClick={() => setEditingCarryover(false)} className="text-xs text-muted-foreground">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {formatCurrency(summary.carryover)}
                        </span>
                        <button
                          onClick={() => {
                            setCarryoverDraft(String(summary.carryover || ""));
                            setEditingCarryover(true);
                          }}
                          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
                        >
                          <Edit2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                  {suggestedCarryover !== null && suggestedCarryover !== summary.carryover && (
                    <div className="flex items-center justify-between pt-1.5">
                      <p className="text-[11px] text-muted-foreground">
                        From bank statements: {formatCurrency(suggestedCarryover)}
                      </p>
                      <button
                        onClick={() => {
                          setCarryoverDraft(String(suggestedCarryover));
                          setEditingCarryover(true);
                        }}
                        className="text-[11px] font-medium text-primary hover:underline"
                      >
                        Apply
                      </button>
                    </div>
                  )}
                </div>

                {/* Total available */}
                <div className="rounded-xl bg-primary/5 border border-primary/20 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">Total Available</p>
                    <p className="text-base font-bold text-primary">{formatCurrency(summary.totalIncome)}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatCurrency(summary.unallocated)} still unallocated to categories
                  </p>
                </div>
              </Card>
            </div>

            {/* Category Filter */}
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-1 mb-3 -mx-1 px-1">
              <button
                onClick={() => setFilterCategoryId(null)}
                className={cn(
                  "flex-shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors border",
                  filterCategoryId === null ? "bg-foreground text-background border-foreground" : "bg-card text-muted-foreground border-border hover:border-muted-foreground/30",
                )}
              >
                All
              </button>
              {summary.categories.filter((c: any) => !c.isRounding).sort((a: any, b: any) => a.name.localeCompare(b.name)).map((cat: any) => (
                <button
                  key={cat.id}
                  onClick={() => setFilterCategoryId(filterCategoryId === cat.id ? null : cat.id)}
                  className={cn(
                    "flex-shrink-0 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors border",
                    filterCategoryId === cat.id ? "text-foreground border-foreground" : "text-muted-foreground border-border hover:border-muted-foreground/30",
                  )}
                  style={filterCategoryId === cat.id ? { backgroundColor: cat.color + "20", borderColor: cat.color } : {}}
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                  {cat.name}
                </button>
              ))}
              {summary.uncategorizedTotal > 0 && (
                <button
                  onClick={() => setFilterCategoryId(filterCategoryId === "uncategorized" ? null : "uncategorized")}
                  className={cn(
                    "flex-shrink-0 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors border",
                    filterCategoryId === "uncategorized" ? "bg-warning/20 text-warning border-warning" : "text-muted-foreground border-border hover:border-warning/50",
                  )}
                >
                  <span className="w-2 h-2 rounded-full bg-warning" />
                  Uncategorized
                </button>
              )}
            </div>

            {/* Budget Categories */}
            <div>
              <SectionHeader title="Budget Categories" action={{ label: "+ Add", onPress: () => setShowNewCat(true) }} />
              <div className="flex items-center justify-between -mt-2 mb-2">
                <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                  <button onClick={() => setView("cards")} className={cn("p-1.5 rounded-md transition-colors", viewMode === "cards" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")} title="Card view"><LayoutGrid size={14} /></button>
                  <button onClick={() => setView("compact")} className={cn("p-1.5 rounded-md transition-colors", viewMode === "compact" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")} title="Compact view"><div className="grid grid-cols-2 gap-[2px]"><div className="w-[5px] h-[5px] rounded-sm bg-current" /><div className="w-[5px] h-[5px] rounded-sm bg-current" /><div className="w-[5px] h-[5px] rounded-sm bg-current" /><div className="w-[5px] h-[5px] rounded-sm bg-current" /></div></button>
                  <button onClick={() => setView("list")} className={cn("p-1.5 rounded-md transition-colors", viewMode === "list" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")} title="List view"><List size={14} /></button>
                </div>
                <button onClick={handleOrganizeSections} className="text-[11px] text-primary hover:underline">
                  Auto-organize sections
                </button>
              </div>
              {(() => {
                const budgetCats = summary.categories.filter(c => !c.isRounding);
                if (budgetCats.length === 0) return (
                  <EmptyState icon={Wallet} title="No categories" subtitle="Add categories to organize your spending."
                    action={{ label: "Add Category", onPress: () => setShowNewCat(true) }} />
                );
                const sectionLookup = new Map(safeBudgetSections.map(s => [s.id, s]));
                const bySection: Record<string, typeof budgetCats> = {};
                for (const cat of budgetCats) {
                  const secName = cat.sectionId != null ? (sectionLookup.get(cat.sectionId)?.name ?? "Other") : "Other";
                  if (!bySection[secName]) bySection[secName] = [];
                  bySection[secName].push(cat);
                }
                const sectionKeys = Object.keys(bySection).sort((a, b) => a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b));
                return (
                  <div className="space-y-4">
                    {sectionKeys.map(sec => {
                      const cats = bySection[sec];
                      const recCats = cats.filter(c => recurring.some(r => r.categoryName?.toLowerCase() === c.name.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
                      const oneoffCats = cats.filter(c => !recurring.some(r => r.categoryName?.toLowerCase() === c.name.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
                      return (
                        <div key={sec}>
                          <SectionHeader title={sec} />
                          {viewMode === "cards" && (
                            <div className="space-y-2">
                              {recCats.map(cat => <CategoryCard key={cat.id} cat={cat} recurring={true}
                                activeBudgetId={activeBudgetId} expandedCategory={expandedCategory} setExpandedCategory={setExpandedCategory}
                                expenses={budgetExpenses} summary={summary} updateExpense={updateExpense}
                                movingExpense={movingExpense} setMovingExpense={setMovingExpense}
                                movingRefs={movingRefs} handleConvertToRecurring={handleConvertToRecurring}
                                setEditCat={setEditCat} setConfirmDelete={setConfirmDelete} />)}
                              {recCats.length > 0 && oneoffCats.length > 0 && (
                                <div className="flex items-center gap-3 pt-1 pb-1">
                                  <div className="h-px flex-1 bg-border" />
                                  <span className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">One-off</span>
                                  <div className="h-px flex-1 bg-border" />
                                </div>
                              )}
                              {oneoffCats.map(cat => <CategoryCard key={cat.id} cat={cat} recurring={false}
                                activeBudgetId={activeBudgetId} expandedCategory={expandedCategory} setExpandedCategory={setExpandedCategory}
                                expenses={budgetExpenses} summary={summary} updateExpense={updateExpense}
                                movingExpense={movingExpense} setMovingExpense={setMovingExpense}
                                movingRefs={movingRefs} handleConvertToRecurring={handleConvertToRecurring}
                                setEditCat={setEditCat} setConfirmDelete={setConfirmDelete} />)}
                            </div>
                          )}
                          {viewMode === "compact" && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {cats.map(cat => {
                                const effectiveMonthly = cat.frequency === "weekly" ? (cat.allocatedAmount * 52 / 12) : cat.frequency === "fortnightly" ? (cat.allocatedAmount * 26 / 12) : cat.allocatedAmount;
                                const pct = effectiveMonthly > 0 ? (cat.spent ?? 0) / effectiveMonthly : 0;
                                return (
                                  <div key={cat.id} className="bg-card border border-border rounded-lg px-3 py-2">
                                    <div className="flex items-center gap-1.5 mb-1">
                                      <ColorDot color={cat.color} size={7} />
                                      <span className="text-xs font-medium text-foreground truncate">{cat.name}</span>
                                      {cat.frequency === "fortnightly" && <span className="text-[9px] text-muted-foreground/60">/fn</span>}
                                      {cat.frequency === "weekly" && <span className="text-[9px] text-muted-foreground/60">/wk</span>}
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className={cn("text-[11px] font-medium", (cat.spent ?? 0) > effectiveMonthly ? "text-destructive" : "text-muted-foreground")}>
                                        {formatCurrency(cat.spent ?? 0)} / {formatCurrency(cat.allocatedAmount)}
                                      </span>
                                      <ProgressBar value={pct} color={(cat.spent ?? 0) > effectiveMonthly ? Colors.danger : cat.color} height={4} />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {viewMode === "list" && (
                            <Card padding={false}>
                              {cats.map((cat, i) => {
                                const effectiveMonthly = cat.frequency === "weekly" ? (cat.allocatedAmount * 52 / 12) : cat.frequency === "fortnightly" ? (cat.allocatedAmount * 26 / 12) : cat.allocatedAmount;
                                const pct = effectiveMonthly > 0 ? (cat.spent ?? 0) / effectiveMonthly : 0;
                                return (
                                  <div key={cat.id} className={cn("flex items-center gap-2 px-3 py-2", i < cats.length - 1 && "border-b border-border")}>
                                    <ColorDot color={cat.color} size={6} />
                                    <span className="text-xs font-medium text-foreground flex-1 min-w-0 truncate">{cat.name}</span>
                                    {cat.frequency !== "monthly" && <span className="text-[9px] text-muted-foreground/60">/{cat.frequency === "fortnightly" ? "fn" : "wk"}</span>}
                                    <div className="flex-1 max-w-24">
                                      <div className="w-full rounded-full bg-muted overflow-hidden" style={{ height: 4 }}>
                                        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 1) * 100}%`, backgroundColor: (cat.spent ?? 0) > effectiveMonthly ? Colors.danger : cat.color }} />
                                      </div>
                                    </div>
                                    <span className={cn("text-[11px] font-semibold w-20 text-right", (cat.spent ?? 0) > effectiveMonthly ? "text-destructive" : "text-foreground")}>
                                      {formatCurrency(cat.spent ?? 0)} / {formatCurrency(cat.allocatedAmount)}
                                    </span>
                                  </div>
                                );
                              })}
                            </Card>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Uncategorized Expenses */}
            {summary.uncategorizedTotal > 0 && (() => {
              const isExpanded = expandedCategory === -1;
              const uncatExpenses = budgetExpenses.filter(
                e => e.categoryId == null,
              ).sort((a, b) => b.date.localeCompare(a.date));
              return (
                <div>
                  <SectionHeader title="Uncategorized" />
                  <Card padding={false} className={cn("px-4 py-3 border-warning/30 cursor-pointer transition-colors hover:bg-muted/30", isExpanded && "rounded-b-none")}>
                    <div className="flex items-center gap-3" onClick={() => setExpandedCategory(isExpanded ? null : -1)}>
                      <div className="w-3 h-3 rounded-full bg-warning/30 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-foreground">Uncategorized</span>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-warning">{formatCurrency(summary.uncategorizedTotal)}</span>
                            <ChevronDown size={14} className={cn("text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                          </div>
                        </div>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-border space-y-1" onClick={e => e.stopPropagation()}>
                        {uncatExpenses.map(ex => (
                          <div key={ex.id} className="flex items-center gap-2 py-1.5 px-1 rounded-lg hover:bg-muted/50 transition-colors">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-foreground truncate">{ex.description}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {ex.date}{ex.merchant ? ` · ${ex.merchant}` : ""}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <span className="text-xs font-semibold text-warning">{formatCurrency(ex.amount)}</span>
                              <button
                                onClick={() => setMovingExpense(movingExpense === ex.id ? null : ex.id)}
                                className={cn("p-1 rounded-lg hover:bg-muted text-muted-foreground transition-colors", movingExpense === ex.id && "bg-primary/10 text-primary")}
                                title="Assign category"
                              >
                                <MoveRight size={11} />
                              </button>
                            </div>
                            {movingExpense === ex.id && (
                              <div className="w-full mt-1">
                                <div className="p-2 rounded-lg bg-muted/50 border border-border">
                                  <p className="text-[10px] text-muted-foreground font-medium mb-1.5">Assign to category:</p>
                                  {(() => {
                                    const catList = [...summary.categories].filter((c: any) => !c.isRounding);
                                    const sectionLookup = new Map(safeBudgetSections.map(s => [s.id, s]));
                                    const bySec: Record<string, typeof catList> = {};
                                    for (const c of catList) {
                                      const secName = c.sectionId != null ? (sectionLookup.get(c.sectionId)?.name ?? "Other") : "Other";
                                      if (!bySec[secName]) bySec[secName] = [];
                                      bySec[secName].push(c);
                                    }
                                    const secKeys = Object.keys(bySec).sort((a, b) => a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b));
                                    return (
                                      <>
                                        {secKeys.map(sec => (
                                          <div key={sec} className="mb-1.5 last:mb-0">
                                            <p className="text-[9px] text-muted-foreground/60 uppercase tracking-wider font-semibold mb-1">{sec}</p>
                                            <div className="grid grid-cols-2 gap-1">
                                              {bySec[sec].sort((a: any, b: any) => a.name.localeCompare(b.name)).map((targetCat: any) => (
                                                <button
                                                  key={targetCat.id}
                                                  onClick={() => {
                                                    updateExpense(ex.id, { categoryId: targetCat.id });
                                                    setMovingExpense(null);
                                                  }}
                                                  className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-card hover:bg-primary/10 border border-border hover:border-primary/30 transition-colors"
                                                >
                                                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: targetCat.color }} />
                                                  {targetCat.name}
                                                </button>
                                              ))}
                                            </div>
                                          </div>
                                        ))}
                                        <div className="border-t border-border pt-1.5 mt-1.5">
                                          <button
                                            onClick={() => { setMovingExpense(null); setShowNewCat(true); }}
                                            className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium text-primary hover:bg-primary/10 border border-primary/30 hover:border-primary transition-colors"
                                          >
                                            <Plus size={11} />
                                            Add Category
                                          </button>
                                        </div>
                                      </>
                                    );
                                  })()}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                </div>
              );
            })()}

            {/* Round-up / Savings Categories */}
            {summary.categories.filter(c => c.isRounding).length > 0 && (
              <div>
                <SectionHeader title="Round-up &amp; Savings" />
                <Card className="mb-2 p-3 bg-success/5 border-success/20">
                  <p className="text-xs text-muted-foreground">
                    Bank round-ups and automatic savings transfers — these don't consume your budget.
                    <span className="text-success font-medium ml-1">Total saved: {formatCurrency(summary.totalRoundingSaved)}</span>
                  </p>
                </Card>
                {(() => {
                  const roundingCats = summary.categories.filter(c => c.isRounding);
                  const recRounding = roundingCats.filter(c => recurring.some(r => r.categoryName?.toLowerCase() === c.name.toLowerCase()));
                  const oneoffRounding = roundingCats.filter(c => !recurring.some(r => r.categoryName?.toLowerCase() === c.name.toLowerCase()));
                  return (
                    <div className="space-y-2">
                      {recRounding.map(cat => <RoundingCard key={cat.id} cat={cat} recurring={true}
                        activeBudgetId={activeBudgetId} expandedCategory={expandedCategory} setExpandedCategory={setExpandedCategory}
                        expenses={budgetExpenses} summary={summary} updateExpense={updateExpense}
                        movingExpense={movingExpense} setMovingExpense={setMovingExpense}
                        movingRefs={movingRefs} handleConvertToRecurring={handleConvertToRecurring}
                        setEditCat={setEditCat} setConfirmDelete={setConfirmDelete} />)}
                      {recRounding.length > 0 && oneoffRounding.length > 0 && (
                        <div className="flex items-center gap-3 pt-2 pb-1">
                          <div className="h-px flex-1 bg-border" />
                          <span className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider">One-off</span>
                          <div className="h-px flex-1 bg-border" />
                        </div>
                      )}
                      {oneoffRounding.map(cat => <RoundingCard key={cat.id} cat={cat} recurring={false}
                        activeBudgetId={activeBudgetId} expandedCategory={expandedCategory} setExpandedCategory={setExpandedCategory}
                        expenses={budgetExpenses} summary={summary} updateExpense={updateExpense}
                        movingExpense={movingExpense} setMovingExpense={setMovingExpense}
                        movingRefs={movingRefs} handleConvertToRecurring={handleConvertToRecurring}
                        setEditCat={setEditCat} setConfirmDelete={setConfirmDelete} />)}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Recurring Expenses */}
            <div>
              <SectionHeader title="Recurring Expenses" action={{ label: "+ Add", onPress: () => setShowNewRecurring(true) }} />
              {recurring.length === 0 ? (
                <Card>
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <CalendarClock size={16} className="text-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-foreground">No recurring expenses yet</p>
                      <p className="text-xs text-muted-foreground mt-0.5 mb-2">Define weekly, fortnightly, or monthly bills once and apply them to any budget.</p>
                      <Button label="Add Recurring Expense" onClick={() => setShowNewRecurring(true)} variant="secondary" size="sm" icon={Plus} />
                    </div>
                  </div>
                </Card>
              ) : (
                <>
                  <Card className="mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <CalendarClock size={16} className="text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">Apply to this budget</p>
                        <p className="text-xs text-muted-foreground">{activeRecurring.length} active template{activeRecurring.length !== 1 ? "s" : ""}</p>
                      </div>
                      <Button label="Apply" onClick={handleApplyRecurring} variant="primary" size="sm" icon={RefreshCw} />
                    </div>
                  </Card>
                  {activeRecurring.length > 0 && (
                    <div className="space-y-2 mb-2">
                      {activeRecurring.map(rec => (
                        <RecurringRow key={rec.id} rec={rec}
                          accountName={accounts.find(a => a.id === rec.accountId)?.name}
                          goalName={goals.find(g => g.id === rec.goalId)?.name}
                          goalColor={goals.find(g => g.id === rec.goalId)?.color}
                          onEdit={() => setEditRecurring(rec)}
                          onDelete={() => setConfirmDelete({ type: "recurring", id: rec.id })}
                          onToggle={() => updateRecurring(rec.id, { isActive: false })}
                          onConvert={() => handleConvertToCategory(rec)} />
                      ))}
                    </div>
                  )}
                  {inactiveRecurring.length > 0 && (
                    <>
                      <p className="text-xs text-muted-foreground mb-2 mt-3">Paused</p>
                      <div className="space-y-2">
                        {inactiveRecurring.map(rec => (
                          <RecurringRow key={rec.id} rec={rec}
                            accountName={accounts.find(a => a.id === rec.accountId)?.name}
                            goalName={goals.find(g => g.id === rec.goalId)?.name}
                            goalColor={goals.find(g => g.id === rec.goalId)?.color}
                            onEdit={() => setEditRecurring(rec)}
                            onDelete={() => setConfirmDelete({ type: "recurring", id: rec.id })}
                            onToggle={() => updateRecurring(rec.id, { isActive: true })}
                            onConvert={() => handleConvertToCategory(rec)} />
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Modals */}
      <BudgetModal visible={showNewBudget} onClose={() => { setShowNewBudget(false); setNewBudgetDefaults(null); }}
        defaultMonth={newBudgetDefaults?.month} defaultYear={newBudgetDefaults?.year} />
      {editBudget && <BudgetModal visible onClose={() => setEditBudget(null)} initial={editBudget} />}
      {activeBudgetId && <CategoryModal visible={showNewCat} onClose={() => setShowNewCat(false)} budgetId={activeBudgetId} />}
      {editCat && <CategoryModal visible onClose={() => setEditCat(null)} budgetId={editCat.budgetId} initial={editCat} />}
      {activeBudgetId && (
        <IncomeSourceModal
          key={`${editIncome?.id ?? "new"}-${incomeDefaultName ?? ""}`}
          visible={showIncome}
          onClose={() => { setShowIncome(false); setEditIncome(null); setIncomeDefaultName(undefined); }}
          budgetId={activeBudgetId}
          initial={editIncome ?? undefined}
          defaultName={incomeDefaultName}
        />
      )}
      <RecurringModal visible={showNewRecurring} onClose={() => setShowNewRecurring(false)} />
      {editRecurring && <RecurringModal visible onClose={() => setEditRecurring(null)} initial={editRecurring} />}
      <ApplyResultModal visible={!!applyResult} onClose={() => setApplyResult(null)} result={applyResult} />
      <BudgetPrintModal visible={showPrint} onClose={() => setShowPrint(false)} />
      <CopyBudgetModal
        visible={showCopy}
        onClose={() => setShowCopy(false)}
        sourceBudget={activeBudget ?? null}
        onCopy={(targetMonth, targetYear, applyRec) => {
          if (!activeBudgetId) return;
          const { budget, categoriesCopied, recurringResult } = copyBudget(activeBudgetId, targetMonth, targetYear, applyRec);
          let msg = `Budget copied to ${monthName(budget.month)} ${budget.year} with ${categoriesCopied} categories`;
          if (recurringResult && recurringResult.applied > 0) msg += ` · ${recurringResult.applied} recurring applied`;
          toast.success(msg);
          if (recurringResult && recurringResult.unmatched.length > 0) {
            setApplyResult(recurringResult);
          }
        }}
      />
      <Confirm
        visible={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (!confirmDelete) return;
          if (confirmDelete.type === "budget") { deleteBudget(confirmDelete.id); toast.success("Budget deleted"); }
          else if (confirmDelete.type === "category") { deleteCategory(confirmDelete.id); toast.success("Category deleted"); }
          else if (confirmDelete.type === "income") { deleteIncomeSource(confirmDelete.id); toast.success("Income source removed"); }
          else { deleteRecurring(confirmDelete.id); toast.success("Recurring expense deleted"); }
        }}
        title={`Delete ${confirmDelete?.type === "recurring" ? "recurring expense" : (confirmDelete?.type ?? "")}?`}
        message="This action cannot be undone."
      />
    </div>
  );
}
