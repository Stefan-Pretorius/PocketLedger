import { useState } from "react";
import { useStore } from "../store";
import { formatCurrency, formatDate } from "../utils";
import { Colors } from "../theme";
import {
  Card, Button, Input, Modal, EmptyState, ProgressBar,
  ColorPicker, ColorDot, Confirm,
} from "../components/ui";
import { PageHeader } from "../components/Layout";
import { Plus, Trash2, Edit2, Target, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function GoalModal({
  visible, onClose, initial,
}: {
  visible: boolean; onClose: () => void;
  initial?: { id: number; name: string; description?: string; targetAmount?: number; currentAmount: number; deadline?: string; color: string; icon: string };
}) {
  const { createGoal, updateGoal } = useStore();
  const [name, setName] = useState(initial?.name ?? "");
  const [desc, setDesc] = useState(initial?.description ?? "");
  const [target, setTarget] = useState(initial?.targetAmount != null ? String(initial.targetAmount) : "");
  const [current, setCurrent] = useState(String(initial?.currentAmount ?? "0"));
  const [deadline, setDeadline] = useState(initial?.deadline ?? "");
  const [color, setColor] = useState(initial?.color ?? Colors.categoryColors[0]);

  const save = () => {
    const t = parseFloat(target);
    const c = parseFloat(current);
    if (!name.trim()) { toast.error("Goal name is required"); return; }
    const targetAmount = (isNaN(t) || t <= 0) ? undefined : t;
    if (initial) {
      updateGoal(initial.id, { name, description: desc, targetAmount, currentAmount: isNaN(c) ? 0 : c, deadline: deadline || undefined, color });
      toast.success("Goal updated");
    } else {
      createGoal({ name, description: desc, targetAmount, currentAmount: isNaN(c) ? 0 : c, deadline: deadline || undefined, color, icon: "target" });
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
  const { goals, expenses, deleteGoal } = useStore();
  const [showNew, setShowNew] = useState(false);
  const [editGoal, setEditGoal] = useState<typeof goals[0] | null>(null);
  const [contributeGoal, setContributeGoal] = useState<typeof goals[0] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const totalSaved = goals.reduce((s, g) => s + g.currentAmount, 0);
  const goalsWithTarget = goals.filter(g => g.targetAmount != null && g.targetAmount > 0);
  const totalTarget = goalsWithTarget.reduce((s, g) => s + g.targetAmount!, 0);

  return (
    <div>
      <PageHeader
        title="Savings Goals"
        subtitle={goals.length > 0 ? `${goals.length} goal${goals.length !== 1 ? "s" : ""}` : undefined}
        actions={<Button label="New Goal" onClick={() => setShowNew(true)} variant="primary" size="sm" icon={Plus} />}
      />

      <div className="px-4 sm:px-6 space-y-5 pb-6">
        {/* Summary */}
        {goals.length > 0 && (
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
        )}

        {goals.length === 0 ? (
          <EmptyState
            icon={Target}
            title="No goals yet"
            subtitle="Set a savings goal to start tracking your progress."
            action={{ label: "Create Goal", onPress: () => setShowNew(true) }}
          />
        ) : (
          <div className="space-y-3">
            {goals.map(g => {
              const hasTarget = g.targetAmount != null && g.targetAmount > 0;
              const pct = hasTarget ? g.currentAmount / g.targetAmount! : 0;
              const completed = hasTarget && pct >= 1;
              const contribs = expenses.filter(e => e.goalId === g.id && !e.isWithdrawal).sort((a, b) => b.date.localeCompare(a.date));
              const withdrawals = expenses.filter(e => e.goalId === g.id && e.isWithdrawal).sort((a, b) => b.date.localeCompare(a.date));
              const totalContribs = contribs.reduce((s, e) => s + e.amount, 0);
              const totalWithdrawals = withdrawals.reduce((s, e) => s + e.amount, 0);
              const showHistory = contribs.length > 0 || withdrawals.length > 0;
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
                          <span>Net <span className="text-foreground font-medium">{formatCurrency(totalContribs - totalWithdrawals)}</span></span>
                        </>
                      )}
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
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">History ({contribs.length + withdrawals.length})</p>
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
                        {(contribs.length + withdrawals.length) > 10 && (
                          <p className="text-[10px] text-muted-foreground text-center pt-1">+{contribs.length + withdrawals.length - 10} more</p>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
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
