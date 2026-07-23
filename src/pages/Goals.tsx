import { useState } from "react";
import { useStore } from "../store";
import { formatCurrency, formatDate } from "../utils";
import { Colors } from "../theme";
import {
  Card, Button, Input, Modal, EmptyState, ProgressBar,
  ColorPicker, ColorDot, Confirm,
} from "../components/ui";
import { PageHeader } from "../components/Layout";
import { Plus, Trash2, Edit2, Target, TrendingUp, LayoutGrid, List, Banknote, Repeat } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Goal } from "../types";

function GoalModal({
  visible, onClose, initial,
}: {
  visible: boolean; onClose: () => void;
  initial?: Goal;
}) {
  const { createGoal, updateGoal, accounts } = useStore();
  const [name, setName] = useState(initial?.name ?? "");
  const [desc, setDesc] = useState(initial?.description ?? "");
  const [target, setTarget] = useState(initial?.targetAmount != null ? String(initial.targetAmount) : "");
  const [current, setCurrent] = useState(String(initial?.currentAmount ?? "0"));
  const [deadline, setDeadline] = useState(initial?.deadline ?? "");
  const [color, setColor] = useState(initial?.color ?? Colors.categoryColors[0]);
  const [goalType, setGoalType] = useState<"anzPlus" | "manual" | "investment">(initial?.goalType ?? "manual");
  const [accountId, setAccountId] = useState<number | undefined>(initial?.accountId);
  const [bonusRate, setBonusRate] = useState(initial?.bonusInterestRate != null ? String(initial.bonusInterestRate) : "");
  const [autoAmt, setAutoAmt] = useState(initial?.autoContributionAmount != null ? String(initial.autoContributionAmount) : "");
  const [autoFreq, setAutoFreq] = useState<"weekly" | "fortnightly" | "monthly">(initial?.autoContributionFrequency ?? "monthly");
  const [owner, setOwner] = useState<"self" | "partner">(initial?.owner ?? "self");

  const flexSaverAccounts = accounts.filter(a => a.accountSubType === "flexSaver" || a.accountSubType === "growthSaver");

  const save = () => {
    const t = parseFloat(target);
    const c = parseFloat(current);
    const br = parseFloat(bonusRate);
    const aa = parseFloat(autoAmt);
    if (!name.trim()) { toast.error("Goal name is required"); return; }
    const targetAmount = (isNaN(t) || t <= 0) ? undefined : t;
    const bonusInterestRate = isNaN(br) || br <= 0 ? undefined : br;
    const autoContributionAmount = isNaN(aa) || aa <= 0 ? undefined : aa;
    const fields = {
      name, description: desc, targetAmount, currentAmount: isNaN(c) ? 0 : c,
      deadline: deadline || undefined, color,
      goalType, accountId: goalType === "anzPlus" ? accountId : undefined,
      bonusInterestRate, autoContributionAmount,
      autoContributionFrequency: autoContributionAmount ? autoFreq : undefined,
      owner,
    };
    if (initial) {
      updateGoal(initial.id, fields);
      toast.success("Goal updated");
    } else {
      createGoal({ ...fields, icon: "target" });
      toast.success("Goal created");
    }
    onClose();
  };

  return (
    <Modal visible={visible} onClose={onClose} title={initial ? "Edit Goal" : "New Goal"}>
      <div className="space-y-4">
        <Input label="Goal Name" value={name} onChange={setName} placeholder="e.g. Emergency Fund" autoFocus />
        <Input label="Description (optional)" value={desc} onChange={setDesc} placeholder="What is this goal for?" multiline />
        <Input label="Target Amount (optional)" value={target} onChange={setTarget} type="number" prefix="$" placeholder="No target" />
        <Input label="Current Amount" value={current} onChange={setCurrent} type="number" prefix="$" placeholder="0.00" />
        <Input label="Deadline (optional)" value={deadline} onChange={setDeadline} type="date" />
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Color</label>
          <ColorPicker value={color} onChange={setColor} colors={Colors.categoryColors} />
        </div>

        {/* Goal Type */}
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Type</label>
          <div className="flex gap-1.5">
            {([
              { value: "manual" as const, label: "Manual" },
              { value: "anzPlus" as const, label: "ANZ Plus" },
              { value: "investment" as const, label: "Investment" },
            ]).map(opt => (
              <button key={opt.value} onClick={() => setGoalType(opt.value)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                  goalType === opt.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted text-muted-foreground border-border hover:border-primary/40"
                )}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* ANZ Plus fields */}
        {goalType === "anzPlus" && (
          <div className="space-y-3 p-3 bg-muted/50 rounded-lg border border-border">
            <p className="text-xs font-medium text-muted-foreground">ANZ Plus Settings</p>
            {flexSaverAccounts.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Linked Account</label>
                <select value={accountId ?? ""} onChange={e => setAccountId(e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm">
                  <option value="">None</option>
                  {flexSaverAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name}{a.accountSubType === "flexSaver" ? " (Flex Saver)" : " (Growth Saver)"}</option>
                  ))}
                </select>
              </div>
            )}
            <Input label="Bonus Interest Rate (% p.a.)" value={bonusRate} onChange={setBonusRate} type="number" placeholder="e.g. 5.5"
              sublabel="Total rate including base + bonus" />
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Auto-Contribution</p>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input label="" value={autoAmt} onChange={setAutoAmt} type="number" prefix="$" placeholder="Amount" />
                </div>
                <select value={autoFreq} onChange={e => setAutoFreq(e.target.value as "weekly" | "fortnightly" | "monthly")}
                  className="px-2 py-2 rounded-lg border border-border bg-background text-foreground text-sm mt-[22px]">
                  <option value="weekly">Weekly</option>
                  <option value="fortnightly">Fortnightly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Owner */}
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Owner</label>
          <div className="flex gap-1.5">
            {(["self", "partner"] as const).map(o => (
              <button key={o} onClick={() => setOwner(o)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                  owner === o
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted text-muted-foreground border-border hover:border-primary/40"
                )}>
                {o === "self" ? "Self" : "Partner"}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Button label="Cancel" onClick={onClose} variant="secondary" fullWidth />
          <Button label={initial ? "Save" : "Create Goal"} onClick={save} variant="primary" fullWidth />
        </div>
      </div>
    </Modal>
  );
}

function ContributeModal({
  visible, onClose, goal,
}: {
  visible: boolean; onClose: () => void;
  goal: { id: number; name: string; currentAmount: number; targetAmount?: number; color: string } | null;
}) {
  const { updateGoal, createExpense, activeBudgetId, categories } = useStore();
  const [amount, setAmount] = useState("");
  const linkedCat = goal && categories.find(c => c.linkedGoalId === goal.id);
  const [categoryId, setCategoryId] = useState<number | null>(linkedCat?.id ?? null);
  const budgetCats = categories.filter(c => c.budgetId === activeBudgetId);

  const save = () => {
    if (!goal) return;
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) { toast.error("Enter a valid amount"); return; }
    const newAmount = goal.targetAmount !== undefined
      ? Math.min(goal.currentAmount + amt, goal.targetAmount)
      : goal.currentAmount + amt;
    updateGoal(goal.id, { currentAmount: newAmount });
    if (activeBudgetId) {
      createExpense({ budgetId: activeBudgetId, description: `⭐ Contribution to ${goal.name}`, amount: amt, date: new Date().toISOString().slice(0, 10), goalId: goal.id, categoryId: categoryId ?? undefined, importedFromBank: false });
    }
    toast.success(`+${formatCurrency(amt)} added to ${goal.name}`);
    setAmount("");
    setCategoryId(null);
    onClose();
  };

  if (!goal) return null;
  const hasTarget = goal.targetAmount !== undefined && goal.targetAmount > 0;
  const pct = hasTarget ? goal.currentAmount / goal.targetAmount! : 0;

  return (
    <Modal visible={visible} onClose={onClose} title="Add Contribution">
      <div className="space-y-4">
        <div className="text-center py-2">
          <p className="text-sm text-muted-foreground mb-1">{goal.name}</p>
          <p className="text-2xl font-bold text-foreground">{formatCurrency(goal.currentAmount)}</p>
          {hasTarget ? (
            <p className="text-sm text-muted-foreground">of {formatCurrency(goal.targetAmount!)}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No target set</p>
          )}
          {hasTarget && (
            <div className="mt-3 px-4">
              <ProgressBar value={pct} color={goal.color} height={8} />
            </div>
          )}
        </div>
        <Input label="Amount to Add" value={amount} onChange={setAmount} type="number" prefix="$" placeholder="0.00" autoFocus />
        {budgetCats.length > 0 && (
          <div>
            <label className="text-sm font-medium text-muted-foreground block mb-2">Budget Category (optional)</label>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto scrollbar-thin">
              <button onClick={() => setCategoryId(null)}
                className={cn("flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                  categoryId === null ? "bg-muted text-foreground border-border" : "border-dashed border-border text-muted-foreground hover:border-primary/40"
                )}>
                None
              </button>
              {[...budgetCats].sort((a, b) => a.name.localeCompare(b.name)).map(cat => (
                <button key={cat.id} onClick={() => setCategoryId(cat.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                    categoryId === cat.id
                      ? "border-transparent text-white"
                      : "border-border bg-card text-foreground hover:border-primary/40",
                  )}
                  style={categoryId === cat.id ? { backgroundColor: cat.color } : undefined}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: categoryId === cat.id ? "white" : cat.color }} />
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <Button label="Cancel" onClick={onClose} variant="secondary" fullWidth />
          <Button label="Add Contribution" onClick={save} variant="primary" fullWidth />
        </div>
      </div>
    </Modal>
  );
}

export function GoalsPage() {
  const { goals, expenses, deleteGoal, accounts } = useStore();
  const [showNew, setShowNew] = useState(false);
  const [editGoal, setEditGoal] = useState<typeof goals[0] | null>(null);
  const [contributeGoal, setContributeGoal] = useState<typeof goals[0] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const [viewMode, setViewMode] = useState<"cards" | "compact" | "list">(() => (localStorage.getItem("goalsView") as "cards" | "compact" | "list") ?? "cards");
  const setView = (mode: "cards" | "compact" | "list") => { setViewMode(mode); localStorage.setItem("goalsView", mode); };

  const totalSaved = goals.reduce((s, g) => s + (g.currentAmount || 0), 0);
  const goalsWithTarget = goals.filter(g => g.targetAmount != null && g.targetAmount > 0);
  const totalTarget = goalsWithTarget.reduce((s, g) => s + (g.targetAmount || 0), 0);
  const totalMonthlyInterest = goals
    .filter(g => g.goalType === "anzPlus" && g.bonusInterestRate != null && g.bonusInterestRate > 0)
    .reduce((s, g) => s + (g.currentAmount * (g.bonusInterestRate ?? 0) / 100 / 12), 0);
  const anzPlusGoals = goals.filter(g => g.goalType === "anzPlus");

  return (
    <div>
      <PageHeader
        title="Savings Goals"
        subtitle={goals.length > 0 ? `${goals.length} goal${goals.length !== 1 ? "s" : ""}` : undefined}
        actions={<Button label="New Goal" onClick={() => setShowNew(true)} variant="primary" size="sm" icon={Plus} />}
      />

      <div className="px-4 sm:px-6 space-y-5 pb-6">
        {/* View toggle */}
        {goals.length > 0 && (
          <div className="flex items-center justify-end">
            <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
              <button onClick={() => setView("cards")} className={cn("p-1.5 rounded-md transition-colors", viewMode === "cards" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")} title="Card view"><LayoutGrid size={14} /></button>
              <button onClick={() => setView("compact")} className={cn("p-1.5 rounded-md transition-colors", viewMode === "compact" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")} title="Compact grid"><LayoutGrid size={12} className="scale-75" /></button>
              <button onClick={() => setView("list")} className={cn("p-1.5 rounded-md transition-colors", viewMode === "list" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")} title="List view"><List size={14} /></button>
            </div>
          </div>
        )}

        {/* Summary */}
        {goals.length > 0 && (
          <>
            <Card className="flex items-center gap-4">
              <div className="flex-1 text-center">
                <p className="text-xs text-muted-foreground">Total Saved</p>
                <p className="text-lg font-bold text-success">{formatCurrency(totalSaved)}</p>
              </div>
              <div className="w-px h-10 bg-border" />
              <div className="flex-1 text-center">
                <p className="text-xs text-muted-foreground">Total Target</p>
                <p className="text-lg font-bold text-foreground">{formatCurrency(totalTarget)}</p>
              </div>
              <div className="w-px h-10 bg-border" />
              <div className="flex-1 text-center">
                <p className="text-xs text-muted-foreground">Overall</p>
                <p className="text-lg font-bold text-primary">
                  {totalTarget > 0 ? Math.round(totalSaved / totalTarget * 100) : 0}%
                </p>
              </div>
            </Card>
            {totalMonthlyInterest > 0 && (
              <Card className="flex items-center gap-3 px-4 py-2.5">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center flex-shrink-0">
                  <Banknote size={13} className="text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-muted-foreground">
                    Est. monthly interest ({anzPlusGoals.length} ANZ Plus goal{anzPlusGoals.length !== 1 ? "s" : ""})
                  </p>
                </div>
                <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">+{formatCurrency(totalMonthlyInterest)}/mo</span>
              </Card>
            )}
          </>
        )}

        {goals.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No goals yet"
            subtitle="Set a savings goal to start tracking your progress."
            action={{ label: "Create Goal", onPress: () => setShowNew(true) }}
          />
        ) : (
          <>
            {viewMode === "cards" && (
              <div className="space-y-3">
                {goals.map(g => {
                  const hasTarget = g.targetAmount != null && g.targetAmount > 0;
                  const pct = hasTarget ? g.currentAmount / g.targetAmount! : 0;
                  const completed = hasTarget && pct >= 1;
                  const contribs = expenses.filter(e => e.goalId === g.id && !e.isWithdrawal).sort((a, b) => b.date.localeCompare(a.date));
                  const withdrawals = expenses.filter(e => e.goalId === g.id && e.isWithdrawal).sort((a, b) => b.date.localeCompare(a.date));
                  const fundedBy = expenses.filter(e => e.fundedByGoalId === g.id).sort((a, b) => b.date.localeCompare(a.date));
                  const totalContribs = contribs.reduce((s, e) => s + e.amount, 0);
                  const totalWithdrawals = withdrawals.reduce((s, e) => s + e.amount, 0);
                  const showHistory = contribs.length > 0 || withdrawals.length > 0 || fundedBy.length > 0;
                  const now = new Date();
                  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
                  const bonusInterestEarned = g.goalType === "anzPlus" && g.bonusInterestRate != null && g.bonusInterestRate > 0
                    && !withdrawals.some(e => e.date.startsWith(currentMonth));
                  const monthlyInterest = g.bonusInterestRate != null && g.bonusInterestRate > 0
                    ? g.currentAmount * (g.bonusInterestRate / 100) / 12 : 0;
                  return (
                    <Card key={g.id}>
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: g.color + "20" }}
                          >
                            <Target size={16} style={{ color: g.color }} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold text-foreground">{g.name}</p>
                              {completed && (
                                <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-success/20 text-success">
                                  Completed!
                                </span>
                              )}
                            </div>
                            {g.description && <p className="text-xs text-muted-foreground">{g.description}</p>}
                            {g.deadline && <p className="text-xs text-muted-foreground">By {formatDate(g.deadline)}</p>}
                            {g.goalType === "anzPlus" && (
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400">
                                  ANZ Plus
                                </span>
                                {g.bonusInterestRate != null && g.bonusInterestRate > 0 && (
                                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                                    {g.bonusInterestRate}% p.a.
                                  </span>
                                )}
                                {g.accountId != null && (() => {
                                  const acct = accounts.find(a => a.id === g.accountId);
                                  return acct ? (
                                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                                      <Banknote size={8} className="inline mr-0.5" />
                                      {acct.name}
                                    </span>
                                  ) : null;
                                })()}
                                {g.autoContributionAmount != null && g.autoContributionAmount > 0 && (
                                  <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                                    <Repeat size={8} className="inline mr-0.5" />
                                    {formatCurrency(g.autoContributionAmount)}/{g.autoContributionFrequency === "weekly" ? "wk" : g.autoContributionFrequency === "fortnightly" ? "fn" : "mo"}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => setEditGoal(g)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                            <Edit2 size={13} />
                          </button>
                          <button onClick={() => setConfirmDelete(g.id)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      {showHistory && (
                        <div className="mb-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                          <span>Contributed <span className="text-success font-medium">+{formatCurrency(totalContribs)}</span></span>
                          {totalWithdrawals > 0 && (
                            <>
                              <span>Withdrawn <span className="text-destructive font-medium">-{formatCurrency(totalWithdrawals)}</span></span>
                            </>
                          )}
                          <span>Net <span className="text-foreground font-medium">{formatCurrency(totalContribs - totalWithdrawals)}</span></span>
                        </div>
                      )}

                      {g.goalType === "anzPlus" && g.bonusInterestRate != null && g.bonusInterestRate > 0 && (
                        <div className={cn(
                          "mb-2 flex items-center gap-2 text-[10px] px-2 py-1 rounded-lg",
                          bonusInterestEarned ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        )}>
                          <span className="font-medium">{bonusInterestEarned ? "Bonus interest earned" : "No bonus this month"}</span>
                          <span>· Est. {formatCurrency(monthlyInterest)}/mo</span>
                          {bonusInterestEarned && <span>· No withdrawals this month</span>}
                        </div>
                      )}

                      <div className="space-y-1.5">
                        {hasTarget ? (
                          <>
                            <ProgressBar value={pct} color={completed ? Colors.success : g.color} height={8} />
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">
                                {formatCurrency(g.currentAmount)} saved
                              </span>
                              <span className="text-xs font-medium" style={{ color: g.color }}>
                                {Math.round(pct * 100)}% · {formatCurrency(g.targetAmount! - g.currentAmount)} to go
                              </span>
                            </div>
                          </>
                        ) : (
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">No target set</span>
                            <span className="text-xs font-medium text-foreground">{formatCurrency(g.currentAmount)} saved</span>
                          </div>
                        )}
                      </div>

                      {!completed && (
                        <div className="mt-3">
                          <Button
                            label="Add Contribution"
                            onClick={() => setContributeGoal(g)}
                            variant="secondary"
                            size="sm"
                            icon={TrendingUp}
                          />
                        </div>
                      )}

                      {showHistory && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">History ({contribs.length + withdrawals.length + fundedBy.length})</p>
                          <div className="space-y-1">
                            {contribs.slice(0, 5).map(e => (
                              <div key={e.id} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-muted-foreground flex-shrink-0">{formatDate(e.date)}</span>
                                  <span className="text-foreground truncate">{e.description}</span>
                                </div>
                                <span className="text-success font-medium flex-shrink-0 ml-2">+{formatCurrency(e.amount)}</span>
                              </div>
                            ))}
                            {withdrawals.slice(0, 5).map(e => (
                              <div key={e.id} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-muted-foreground flex-shrink-0">{formatDate(e.date)}</span>
                                  <span className="text-foreground truncate">{e.description}</span>
                                </div>
                                <span className="font-medium flex-shrink-0 ml-2" style={{ color: g.color }}>-{formatCurrency(e.amount)}</span>
                              </div>
                            ))}
                            {fundedBy.slice(0, 5).map(e => (
                              <div key={e.id} className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-muted-foreground flex-shrink-0">{formatDate(e.date)}</span>
                                  <span className="text-foreground truncate">{e.description}</span>
                                </div>
                                <span className="font-medium flex-shrink-0 ml-2" style={{ color: g.color, opacity: 0.7 }}>{formatCurrency(e.amount)}</span>
                              </div>
                            ))}
                            {(contribs.length + withdrawals.length + fundedBy.length) > 15 && (
                              <p className="text-[10px] text-muted-foreground text-center pt-1">+{contribs.length + withdrawals.length + fundedBy.length - 15} more</p>
                            )}
                          </div>
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
            {viewMode === "compact" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {goals.map(g => {
                  const hasTarget = g.targetAmount != null && g.targetAmount > 0;
                  const pct = hasTarget ? g.currentAmount / g.targetAmount! : 0;
                  const completed = hasTarget && pct >= 1;
                  return (
                    <div key={g.id} className="bg-card border border-border rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: g.color + "20" }}>
                          <Target size={12} style={{ color: g.color }} />
                        </div>
                        <p className="text-sm font-semibold text-foreground truncate">{g.name}</p>
                        {completed && <span className="text-[9px] font-medium px-1 py-0.5 rounded-full bg-success/20 text-success">Done</span>}
                      </div>
                      {hasTarget ? (
                        <>
                          <ProgressBar value={pct} color={completed ? Colors.success : g.color} height={4} />
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-[10px] text-muted-foreground">{formatCurrency(g.currentAmount)}</span>
                            <span className="text-[10px] font-medium" style={{ color: g.color }}>{Math.round(pct * 100)}%</span>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs text-muted-foreground">{formatCurrency(g.currentAmount)} saved</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {viewMode === "list" && (
              <Card padding={false}>
                {goals.map((g, i) => {
                  const hasTarget = g.targetAmount != null && g.targetAmount > 0;
                  const pct = hasTarget ? g.currentAmount / g.targetAmount! : 0;
                  const completed = hasTarget && pct >= 1;
                  return (
                    <div key={g.id} className={cn("flex items-center gap-3 px-3 py-2", i < goals.length - 1 && "border-b border-border")}>
                      <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: g.color + "20" }}>
                        <Target size={10} style={{ color: g.color }} />
                      </div>
                      <p className="text-xs font-medium text-foreground flex-1 min-w-0 truncate">{g.name}</p>
                      {hasTarget && (
                        <div className="flex-1 max-w-24">
                          <div className="w-full rounded-full bg-muted overflow-hidden" style={{ height: 4 }}>
                            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 1) * 100}%`, backgroundColor: completed ? Colors.success : g.color }} />
                          </div>
                        </div>
                      )}
                      <span className="text-xs font-semibold text-foreground w-20 text-right">{formatCurrency(g.currentAmount)}</span>
                      {hasTarget && <span className="text-[10px] text-muted-foreground w-12 text-right">{Math.round(pct * 100)}%</span>}
                    </div>
                  );
                })}
              </Card>
            )}
          </>
        )}
      </div>

      <GoalModal visible={showNew} onClose={() => setShowNew(false)} />
      {editGoal && <GoalModal visible onClose={() => setEditGoal(null)} initial={editGoal} />}
      <ContributeModal visible={!!contributeGoal} onClose={() => setContributeGoal(null)} goal={contributeGoal} />
      <Confirm
        visible={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete !== null) { deleteGoal(confirmDelete); toast.success("Goal deleted"); } }}
        title="Delete goal?"
        message="This will permanently remove this goal and its progress."
      />
    </div>
  );
}
