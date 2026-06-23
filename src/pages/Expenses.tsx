import { useState, useMemo, useEffect } from "react";
import { useStore } from "../store";
import { formatCurrency, formatDate, today, currentMonth, getBudgetDateRange } from "../utils";
import { Colors } from "../theme";
import {
  Card, Button, Input, Modal, EmptyState, SectionHeader,
  ColorDot, Confirm, Badge, AccountPicker,
} from "../components/ui";
import { PageHeader } from "../components/Layout";
import { BudgetYearTabs, BudgetMonthGrid } from "../components/BudgetPicker";
import { Plus, Trash2, Edit2, Receipt, Search, Filter, ChevronDown, Target, Repeat, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function ExpenseModal({
  visible, onClose, budgetId, initial,
}: {
  visible: boolean; onClose: () => void; budgetId: number;
  initial?: { id: number; description: string; amount: number; date: string; categoryId?: number | null; goalId?: number | null; isWithdrawal?: boolean; accountId?: number; merchant?: string; notes?: string };
}) {
  const { createExpense, updateExpense, updateGoal, categories, accounts, goals } = useStore();
  const budgetCats = categories.filter(c => c.budgetId === budgetId);
  const [desc, setDesc] = useState(initial?.description ?? "");
  const [amount, setAmount] = useState(String(initial?.amount ?? ""));
  const [date, setDate] = useState(initial?.date ?? today());
  const [categoryId, setCategoryId] = useState<number | null>(initial?.goalId && !initial?.isWithdrawal ? null : (initial?.categoryId ?? budgetCats[0]?.id ?? null));
  const [goalId, setGoalId] = useState<number | null>(initial?.goalId ?? null);
  const [withdraw, setWithdraw] = useState(initial?.isWithdrawal ?? false);
  const [accountId, setAccountId] = useState<number | null>(initial?.accountId ?? null);
  const [merchant, setMerchant] = useState(initial?.merchant ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");

  // Auto-suggest withdrawal when a linked category is selected (new expenses only)
  useEffect(() => {
    if (initial) return;
    if (categoryId != null) {
      const cat = budgetCats.find(c => c.id === categoryId);
      if (cat?.linkedGoalId != null) {
        setGoalId(cat.linkedGoalId);
        setWithdraw(true);
      }
    }
  }, [categoryId, initial]);

  const isGoalMode = goalId != null;

  const save = () => {
    const amt = parseFloat(amount);
    if (!desc.trim()) { toast.error("Description is required"); return; }
    if (isNaN(amt) || (!initial && amt <= 0)) { toast.error("Enter a valid amount"); return; }
    if (isGoalMode && withdraw) {
      // Withdrawal: subtract from goal
      if (initial) {
        // For edit, let the store's updateExpense handle the balance transition
        const oldGoal = initial.goalId != null ? goals.find(g => g.id === initial.goalId) : null;
        const newGoal = goals.find(g => g.id === goalId);
        if (oldGoal && newGoal && oldGoal.id !== newGoal.id) {
          // Reverse old + apply new
          const rev = initial.isWithdrawal
            ? oldGoal.currentAmount + initial.amount
            : Math.max(0, oldGoal.currentAmount - initial.amount);
          updateGoal(oldGoal.id, { currentAmount: rev });
          updateGoal(newGoal.id, { currentAmount: Math.max(0, newGoal.currentAmount - amt) });
        } else if (oldGoal && newGoal && oldGoal.id === newGoal.id) {
          // Reversal logic: reverse old effect and apply new
          const reversed = initial.isWithdrawal
            ? oldGoal.currentAmount + initial.amount
            : Math.max(0, oldGoal.currentAmount - initial.amount);
          updateGoal(oldGoal.id, { currentAmount: Math.max(0, reversed - amt) });
        } else if (newGoal && !oldGoal) {
          updateGoal(newGoal.id, { currentAmount: Math.max(0, newGoal.currentAmount - amt) });
        } else if (oldGoal && !newGoal) {
          const rev = initial.isWithdrawal
            ? oldGoal.currentAmount + initial.amount
            : Math.max(0, oldGoal.currentAmount - initial.amount);
          updateGoal(oldGoal.id, { currentAmount: rev });
        }
      } else {
        const goal = goals.find(g => g.id === goalId);
        if (goal) updateGoal(goalId, { currentAmount: Math.max(0, goal.currentAmount - amt) });
      }
    } else if (isGoalMode) {
      // Contribution: add to goal
      if (initial) {
        const oldGoal = initial.goalId != null ? goals.find(g => g.id === initial.goalId) : null;
        const newGoal = goals.find(g => g.id === goalId);
        if (oldGoal && newGoal && oldGoal.id !== newGoal.id) {
          const rev = initial.isWithdrawal
            ? oldGoal.currentAmount + initial.amount
            : Math.max(0, oldGoal.currentAmount - initial.amount);
          updateGoal(oldGoal.id, { currentAmount: rev });
          updateGoal(newGoal.id, { currentAmount: newGoal.currentAmount + amt });
        } else if (oldGoal && newGoal && oldGoal.id === newGoal.id) {
          const diff = amt - initial.amount;
          updateGoal(oldGoal.id, { currentAmount: Math.max(0, oldGoal.currentAmount + diff) });
        } else if (newGoal && !oldGoal) {
          updateGoal(newGoal.id, { currentAmount: newGoal.currentAmount + amt });
        } else if (oldGoal && !newGoal) {
          const rev = initial.isWithdrawal
            ? oldGoal.currentAmount + initial.amount
            : Math.max(0, oldGoal.currentAmount - initial.amount);
          updateGoal(oldGoal.id, { currentAmount: rev });
        }
      } else {
        const goal = goals.find(g => g.id === goalId);
        if (goal) updateGoal(goalId, { currentAmount: goal.currentAmount + amt });
      }
    } else if (initial && initial.goalId != null) {
      // Was goal contribution/withdrawal, now category — reverse
      const oldGoal = goals.find(g => g.id === initial.goalId);
      if (oldGoal) {
        const rev = initial.isWithdrawal
          ? oldGoal.currentAmount + initial.amount
          : Math.max(0, oldGoal.currentAmount - initial.amount);
        updateGoal(oldGoal.id, { currentAmount: rev });
      }
    }

    if (initial) {
      updateExpense(initial.id, {
        description: desc, amount: amt, date,
        categoryId: isGoalMode && withdraw ? undefined : (categoryId ?? undefined),
        goalId: isGoalMode ? goalId : undefined,
        isWithdrawal: isGoalMode ? withdraw : undefined,
        accountId: accountId ?? undefined, merchant, notes,
      });
      toast.success("Expense updated");
    } else if (isGoalMode) {
      const goal = goals.find(g => g.id === goalId);
      if (goal) {
        createExpense({
          budgetId, description: desc, amount: amt, date, goalId,
          isWithdrawal: withdraw, accountId: accountId ?? undefined,
          categoryId: withdraw ? undefined : (categoryId ?? undefined),
          merchant, notes, importedFromBank: false,
        });
      }
      toast.success(withdraw ? `Withdrew ${formatCurrency(amt)} from "${goal?.name ?? "Goal"}"` : `Added ${formatCurrency(amt)} to "${goal?.name ?? "Goal"}"`);
    } else {
      createExpense({ budgetId, description: desc, amount: amt, date, categoryId: categoryId ?? undefined, accountId: accountId ?? undefined, merchant, notes, importedFromBank: false });
      toast.success("Expense added");
    }
    onClose();
  };

  return (
    <Modal visible={visible} onClose={onClose} title={initial ? "Edit Expense" : "Add Expense"}>
      <div className="space-y-4">
        <Input label="Description" value={desc} onChange={setDesc} placeholder="e.g. Weekly groceries" autoFocus />
        <Input label="Amount" value={amount} onChange={setAmount} type="number" prefix="$" placeholder="0.00" />
        <Input label="Date" value={date} onChange={setDate} type="date" />
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Category</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto scrollbar-thin pr-1">
            {(!isGoalMode || !withdraw) && (
              <button onClick={() => setCategoryId(null)}
                className={cn("flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors",
                  categoryId === null ? "bg-muted text-foreground border-border" : "border-dashed border-border text-muted-foreground hover:border-primary/40"
                )}>
                Uncategorized
              </button>
            )}
            {[...budgetCats].sort((a, b) => a.name.localeCompare(b.name)).map(cat => (
              <button
                key={cat.id}
                onClick={() => { setCategoryId(cat.id); if (!isGoalMode) setGoalId(null); }}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors",
                  categoryId === cat.id && (!isGoalMode || !withdraw)
                    ? "border-transparent text-white"
                    : "border-border bg-card text-foreground hover:border-primary/40",
                )}
                style={categoryId === cat.id && (!isGoalMode || !withdraw) ? { backgroundColor: cat.color } : undefined}
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: categoryId === cat.id && !isGoalMode ? "white" : cat.color }} />
                <span className="truncate">{cat.name}</span>
              </button>
            ))}
          </div>
        </div>
        {goals.length > 0 && (
          <div>
            <label className="text-sm font-medium text-muted-foreground block mb-2">
              {isGoalMode ? "Contributing to Goal" : "Or contribute to a Goal"}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {goals.map(g => {
                const selected = goalId === g.id;
                return (
                  <button
                    key={g.id}
                    onClick={() => { setGoalId(selected ? null : g.id); if (!selected) setCategoryId(null); }}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors",
                      selected
                        ? "border-transparent text-white"
                        : "border-border bg-card text-foreground hover:border-primary/40",
                    )}
                    style={selected ? { backgroundColor: g.color } : undefined}
                  >
                    <span className={selected ? "text-white" : "text-muted-foreground"}>⭐</span>
                    <span className="truncate">{g.name}</span>
                  </button>
                );
              })}
            </div>
            {isGoalMode && (
              <button
                onClick={() => setWithdraw(!withdraw)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors mt-2",
                  withdraw
                    ? "border-transparent text-white"
                    : "border-border bg-card text-foreground hover:border-primary/40",
                )}
                style={withdraw ? { backgroundColor: goals.find(g => g.id === goalId)?.color ?? "var(--chart-2)" } : undefined}
              >
                <Repeat size={12} />
                {withdraw ? "Withdrawal" : "Contribution"}
              </button>
            )}
          </div>
        )}
        <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} label="Paid From Account" />
        <Input label="Merchant (optional)" value={merchant} onChange={setMerchant} placeholder="e.g. Woolworths" />
        <Input label="Notes (optional)" value={notes} onChange={setNotes} multiline placeholder="Any notes…" />
        <div className="flex gap-2 pt-1">
          <Button label="Cancel" onClick={onClose} variant="secondary" fullWidth />
          <Button label={initial ? "Save" : isGoalMode ? `Add to ${goals.find(g => g.id === goalId)?.name ?? "Goal"}` : "Add Expense"} onClick={save} variant="primary" fullWidth />
        </div>
      </div>
    </Modal>
  );
}

export function ExpensesPage() {
  const { expenses, categories, accounts, activeBudgetId, budgets, setActiveBudget, deleteExpense, goals } = useStore();
  const [showNew, setShowNew] = useState(false);
  const [editExp, setEditExp] = useState<typeof expenses[0] | null>(null);
  const [filterTab, setFilterTab] = useState<"all" | "categorized" | "uncategorized" | "transfers">("all");
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<number | null>(null);
  const [filterAccount, setFilterAccount] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const activeBudget = budgets.find(b => b.id === activeBudgetId);
  const budgetCats = categories.filter(c => c.budgetId === activeBudgetId);
  const budgetDateRange = useMemo(() => activeBudget ? getBudgetDateRange(activeBudget) : null, [activeBudget]);
  const cm = currentMonth();
  const [selectedYear, setSelectedYear] = useState(activeBudget?.year ?? cm.year);
  useEffect(() => {
    if (activeBudget?.year) setSelectedYear(activeBudget.year);
  }, [activeBudgetId]);

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(e => e.id)));
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const bulkDelete = () => {
    for (const id of selectedIds) deleteExpense(id);
    toast.success(`${selectedIds.size} expense${selectedIds.size !== 1 ? "s" : ""} deleted`);
    setSelectedIds(new Set());
    setConfirmBulkDelete(false);
  };

  interface TransferPair {
    debit: typeof expenses[number];
    credit: typeof expenses[number];
    baseDescription: string;
  }

  const matchTransferPairs = (exps: typeof expenses): { pairs: TransferPair[]; unmatched: typeof expenses } => {
    const used = new Set<number>();
    const pairs: TransferPair[] = [];

    // Strategy 1: same importId + opposite amounts + different accounts + same date
    const byImport = new Map<number | undefined, typeof expenses>();
    for (const e of exps) {
      if (e.importId == null) continue;
      const g = byImport.get(e.importId) ?? [];
      g.push(e);
      byImport.set(e.importId, g);
    }
    for (const [, g] of byImport) {
      const debits = g.filter(e => e.amount > 0);
      const credits = g.filter(e => e.amount < 0);
      const usedC = new Set<number>();
      for (const d of debits) {
        const m = credits.find(c =>
          !usedC.has(c.id) && c.date === d.date && c.amount === -d.amount &&
          c.accountId != null && d.accountId != null && c.accountId !== d.accountId
        );
        if (m) {
          usedC.add(m.id); used.add(d.id); used.add(m.id);
          pairs.push({ debit: d, credit: m, baseDescription: d.description.replace(/ → .*$/, "") });
        }
      }
    }

    // Strategy 2: description-based matching for leftover items
    const rest = exps.filter(e => !used.has(e.id));
    const debits = rest.filter(e => e.amount > 0 && (e.description.includes(" → ") || e.description.toLowerCase().includes("transfer")));
    const credits = rest.filter(e => e.amount < 0 && (e.description.includes(" (from ") || e.description.toLowerCase().includes("transfer")));
    const usedC = new Set<number>();
    for (const d of debits) {
      const base = d.description.includes(" → ") ? d.description.substring(0, d.description.indexOf(" → ")) : d.description;
      const dLow = d.description.toLowerCase();
      const m = credits.find(c =>
        !usedC.has(c.id) && c.date === d.date && Math.abs(c.amount) === d.amount &&
        c.accountId != null && d.accountId != null && c.accountId !== d.accountId
      );
      if (m) {
        usedC.add(m.id); used.add(d.id); used.add(m.id);
        pairs.push({ debit: d, credit: m, baseDescription: base });
      }
    }

    return { pairs, unmatched: rest.filter(e => !used.has(e.id)) };
  };

  const filtered = useMemo(() => {
    let list = expenses.filter(e => e.budgetId === activeBudgetId || e.budgetId == null);
    if (budgetDateRange) {
      list = list.filter(e => e.date >= budgetDateRange.startDate && e.date <= budgetDateRange.endDate);
    }
    // Tab filter
    if (filterTab === "categorized") {
      list = list.filter(e => e.categoryId != null);
    } else if (filterTab === "uncategorized") {
      list = list.filter(e => e.categoryId == null);
    }
    // Transfers tab uses the full list; pairing is done separately
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(e =>
        e.description.toLowerCase().includes(q) ||
        (e.merchant ?? "").toLowerCase().includes(q)
      );
    }
    if (filterCat === -1) {
      list = list.filter(e => e.categoryId == null);
    } else if (filterCat !== null) {
      list = list.filter(e => e.categoryId === filterCat);
    }
    if (filterAccount !== null) {
      list = list.filter(e => e.accountId === filterAccount);
    }
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, activeBudgetId, budgetDateRange, filterTab, search, filterCat, filterAccount]);

  const [expandedPairs, setExpandedPairs] = useState<Set<string>>(new Set());

  const togglePairExpand = (key: string) => {
    setExpandedPairs(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const pairInfo = useMemo(() => {
    if (filterTab !== "transfers") return null;
    return matchTransferPairs(filtered);
  }, [filtered, filterTab]);

  const totalFiltered = filtered.reduce((s, e) => s + e.amount, 0);

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle={activeBudget ? activeBudget.name : undefined}
        actions={
          activeBudgetId
            ? <Button label="Add" onClick={() => setShowNew(true)} variant="primary"  icon={Plus} />
            : undefined
        }
      />

      <div className="px-4 sm:px-6 space-y-4 pb-6">
        {/* Budget picker (month/year grid) */}
        {budgets.length > 1 && (
          <div className="space-y-2">
            <BudgetYearTabs selectedYear={selectedYear} onSelectYear={setSelectedYear} />
            <BudgetMonthGrid year={selectedYear} activeBudgetId={activeBudgetId} onSelect={setActiveBudget} />
          </div>
        )}

        {!activeBudgetId ? (
          <EmptyState
            icon={Receipt}
            title="No budget selected"
            subtitle="Create or select a budget to start tracking expenses."
            action={{ label: "Go to Budget", onPress: () => window.location.href = "/budget" }}
          />
        ) : (
          <>
            {/* View tabs */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
              {(["all", "categorized", "uncategorized", "transfers"] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => { setFilterTab(tab); setFilterCat(null); }}
                  className={cn(
                    "flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize",
                    filterTab === tab ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80",
                  )}
                >
                  {tab === "transfers" ? "Transfers" : tab}
                </button>
              ))}
            </div>

            {/* Search + filter */}
            <div className="space-y-2">
              <Input
                value={search}
                onChange={setSearch}
                placeholder="Search expenses…"
                prefix="🔍"
              />
              {budgetCats.length > 0 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                  <button
                    onClick={() => setFilterCat(null)}
                    className={cn(
                      "flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors",
                      filterCat === null ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80",
                    )}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setFilterCat(filterCat === -1 ? null : -1)}
                    className={cn(
                      "flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors",
                      filterCat === -1 ? "bg-warning text-warning-foreground" : "bg-muted text-foreground hover:bg-muted/80",
                    )}
                  >
                    Uncategorized
                  </button>
                  {[...budgetCats].sort((a, b) => a.name.localeCompare(b.name)).map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => setFilterCat(filterCat === cat.id ? null : cat.id)}
                      className="flex-shrink-0 flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors bg-muted text-foreground hover:bg-muted/80"
                      style={filterCat === cat.id ? { backgroundColor: cat.color + "20", color: cat.color } : undefined}
                    >
                      <ColorDot color={cat.color} size={6} />
                      {cat.name}
                    </button>
                  ))}
                </div>
              )}
              {accounts.length > 0 && (
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
                  <button
                    onClick={() => setFilterAccount(null)}
                    className={cn(
                      "flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors",
                      filterAccount === null ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80",
                    )}
                  >
                    All accounts
                  </button>
                  {accounts.map(acc => (
                    <button
                      key={acc.id}
                      onClick={() => setFilterAccount(filterAccount === acc.id ? null : acc.id)}
                      className={cn(
                        "flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize",
                        filterAccount === acc.id ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80",
                      )}
                    >
                      {acc.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Summary bar */}
            {filtered.length > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {filterTab === "transfers" && pairInfo
                    ? `${pairInfo.pairs.length} paired transfer${pairInfo.pairs.length !== 1 ? "s" : ""}${pairInfo.unmatched.length ? ` + ${pairInfo.unmatched.length} single` : ""}`
                    : `${filtered.length} expense${filtered.length !== 1 ? "s" : ""}`
                  }
                </span>
                <div className="flex items-center gap-2">
                  {selectedIds.size > 0 && (
                    <>
                      <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
                      <button onClick={toggleSelectAll} className="text-xs text-primary hover:underline">
                        {selectedIds.size === filtered.length ? "Deselect all" : "Select all"}
                      </button>
                      <Button label="Delete" onClick={() => setConfirmBulkDelete(true)} variant="primary"  icon={Trash2} />
                    </>
                  )}
                  <span className={cn("font-semibold", selectedIds.size > 0 && "ml-2")}>{formatCurrency(totalFiltered)}</span>
                </div>
              </div>
            )}

            {/* Expense list */}
            {filtered.length === 0 ? (
              <EmptyState
                icon={Receipt}
                title={search ? "No matching expenses" : "No expenses yet"}
                subtitle={search ? "Try a different search term." : "Tap + to add your first expense."}
                action={!search ? { label: "Add Expense", onPress: () => setShowNew(true) } : undefined}
              />
            ) : (
              <Card padding={false}>
                {filterTab === "transfers" && pairInfo ? (
                  <>
                    {pairInfo.pairs.map(pair => {
                      const pairKey = `${pair.debit.id}-${pair.credit.id}`;
                      const expanded = expandedPairs.has(pairKey);
                      const debitAcc = accounts.find(a => a.id === pair.debit.accountId);
                      const creditAcc = accounts.find(a => a.id === pair.credit.accountId);
                      return (
                        <div key={pairKey}>
                          <div
                            className="flex items-center gap-3 px-4 py-3 border-b border-border"
                          >
                            <input
                              type="checkbox"
                              checked={selectedIds.has(pair.debit.id) && selectedIds.has(pair.credit.id)}
                              onChange={() => {
                                const both = selectedIds.has(pair.debit.id) && selectedIds.has(pair.credit.id);
                                setSelectedIds(prev => {
                                  const next = new Set(prev);
                                  if (both) { next.delete(pair.debit.id); next.delete(pair.credit.id); }
                                  else { next.add(pair.debit.id); next.add(pair.credit.id); }
                                  return next;
                                });
                              }}
                              className="w-4 h-4 rounded border-border accent-primary flex-shrink-0 cursor-pointer"
                            />
                            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-primary/10">
                              <Repeat size={14} className="text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{pair.baseDescription}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-xs text-muted-foreground">
                                  {formatCurrency(pair.debit.amount)}
                                  {" · "}
                                  {debitAcc?.name ?? "?"} → {creditAcc?.name ?? "?"}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground">$0.00</span>
                              <button
                                onClick={() => togglePairExpand(pairKey)}
                                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
                              >
                                <ChevronRight size={13} className={cn("transition-transform", expanded && "rotate-90")} />
                              </button>
                            </div>
                          </div>
                          {expanded && (
                            <div className="bg-muted/30">
                              {[pair.debit, pair.credit].map(leg => {
                                const legCat = budgetCats.find(c => c.id === leg.categoryId);
                                const legAcc = accounts.find(a => a.id === leg.accountId);
                                const legGoal = goals.find(g => g.id === leg.goalId);
                                return (
                                  <div key={leg.id} className="flex items-center gap-3 pl-10 pr-4 py-2.5 border-b border-border/50">
                                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                                      style={{ backgroundColor: Colors.primary + "10" }}
                                    >
                                      <Repeat size={12} className="text-primary/60" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs text-foreground truncate">{leg.description}</p>
                                      <div className="flex items-center gap-1.5 mt-0.5">
                                        <span className="text-[10px] text-muted-foreground">{formatDate(leg.date)}</span>
                                        {legAcc && <Badge label={legAcc.name} color={Colors.warning} variant="soft"  />}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                      <span className={cn("text-xs font-semibold", leg.amount < 0 ? "text-success" : "")}>{formatCurrency(leg.amount)}</span>
                                      <button onClick={() => setEditExp(leg)} className="p-1 rounded-lg hover:bg-muted text-muted-foreground"><Edit2 size={11} /></button>
                                      <button onClick={() => setConfirmDelete(leg.id)} className="p-1 rounded-lg hover:bg-muted text-muted-foreground"><Trash2 size={11} /></button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {pairInfo.unmatched.map((exp, i) => {
                      const cat = budgetCats.find(c => c.id === exp.categoryId);
                      const acc = accounts.find(a => a.id === exp.accountId);
                      const goal = goals.find(g => g.id === exp.goalId);
                      return (
                        <div key={exp.id}
                          className={cn("flex items-center gap-3 px-4 py-3", i < pairInfo.unmatched.length - 1 && "border-b border-border")}
                        >
                          <input type="checkbox" checked={selectedIds.has(exp.id)} onChange={() => toggleSelect(exp.id)}
                            className="w-4 h-4 rounded border-border accent-primary flex-shrink-0 cursor-pointer" />
                          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: Colors.warning + "20" }}>
                            <Repeat size={14} className="text-warning" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{exp.description}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-muted-foreground">{formatDate(exp.date)}</span>
                              {acc && <Badge label={acc.name} color={Colors.warning} variant="soft"  />}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-semibold">{formatCurrency(exp.amount)}</span>
                            <button onClick={() => setEditExp(exp)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground ml-1"><Edit2 size={13} /></button>
                            <button onClick={() => setConfirmDelete(exp.id)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"><Trash2 size={13} /></button>
                          </div>
                        </div>
                      );
                    })}
                  </>
                ) : (
                  filtered.map((exp, i) => {
                    const cat = budgetCats.find(c => c.id === exp.categoryId);
                    const acc = accounts.find(a => a.id === exp.accountId);
                    const goal = goals.find(g => g.id === exp.goalId);
                    return (
                      <div
                        key={exp.id}
                        className={cn(
                          "flex items-center gap-3 px-4 py-3",
                          i < filtered.length - 1 && "border-b border-border",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(exp.id)}
                          onChange={() => toggleSelect(exp.id)}
                          className="w-4 h-4 rounded border-border accent-primary flex-shrink-0 cursor-pointer"
                        />
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: goal ? (goal.color + "20") : ((cat?.color ?? Colors.primary) + "20") }}
                        >
                          {goal && exp.isWithdrawal ? <Repeat size={14} style={{ color: goal.color }} /> : goal ? <Target size={14} style={{ color: goal.color }} /> : <Receipt size={14} style={{ color: cat?.color ?? Colors.primary }} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{exp.description}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {goal && <ColorDot color={goal.color} size={6} />}
                            {!goal && cat && <ColorDot color={cat.color} size={6} />}
                            <span className="text-xs text-muted-foreground">
                              {goal ? `→ ${goal.name}` : (cat?.name ?? "Uncategorized")} · {formatDate(exp.date)}
                            </span>
                            {exp.importedFromBank && (
                              <Badge label="Bank" color={Colors.primary} variant="soft"  />
                            )}
                            {exp.budgetId == null && (
                              <Badge label="Unallocated" color={Colors.danger} variant="soft"  />
                            )}
                            {goal && !exp.isWithdrawal && (
                              <Badge label="Goal" color={goal.color} variant="soft"  />
                            )}
                            {goal && exp.isWithdrawal && (
                              <Badge label="Withdrawn" color={goal.color} variant="soft" icon={Repeat} />
                            )}
                            {acc && (
                              <Badge label={acc.name} color={Colors.warning} variant="soft"  />
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className={cn("text-sm font-semibold", goal && !exp.isWithdrawal ? "text-success" : goal && exp.isWithdrawal ? "text-foreground" : "text-foreground")}>{formatCurrency(exp.amount)}</span>
                          <button
                            onClick={() => setEditExp(exp)}
                            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground ml-1"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => setConfirmDelete(exp.id)}
                            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </Card>
            )}
          </>
        )}
      </div>

      {activeBudgetId && (
        <ExpenseModal visible={showNew} onClose={() => setShowNew(false)} budgetId={activeBudgetId} />
      )}
      {editExp && activeBudgetId && (
        <ExpenseModal visible onClose={() => setEditExp(null)} budgetId={activeBudgetId} initial={editExp} />
      )}
      <Confirm
        visible={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete !== null) { deleteExpense(confirmDelete); toast.success("Expense deleted"); } }}
        title="Delete expense?"
        message="This will permanently remove the expense."
      />
      <Confirm
        visible={confirmBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={bulkDelete}
        title={`Delete ${selectedIds.size} expense${selectedIds.size !== 1 ? "s" : ""}?`}
        message={`This will permanently remove ${selectedIds.size} expense${selectedIds.size !== 1 ? "s" : ""}. This action cannot be undone.`}
      />
    </div>
  );
}
