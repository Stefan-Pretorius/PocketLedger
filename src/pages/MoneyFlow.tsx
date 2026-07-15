import { useState, useMemo } from "react";
import { useStore } from "../store";
import { getBudgetDateRange, computeSankeyData, monthlyCategoryAmount, formatCurrency } from "../utils";
import { EmptyState } from "../components/ui";
import { PageHeader } from "../components/Layout";
import { Sankey } from "../components/Sankey";
import { BudgetYearTabs, BudgetMonthGrid } from "../components/BudgetPicker";
import { Wallet, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function MoneyFlowPage() {
  const { budgets, activeBudgetId, setActiveBudget, getBudgetSummary, expenses, goals, accounts } = useStore();
  const cm = useMemo(() => {
    const d = new Date();
    return { month: d.getMonth() + 1, year: d.getFullYear() };
  }, []);

  const summary = activeBudgetId ? getBudgetSummary(activeBudgetId) : null;

  const [verifyMode, setVerifyMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const toggleChecked = (id: string) => {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const sankeyData = useMemo(() => {
    if (!summary) return { nodes: [], links: [] };
    return computeSankeyData(summary, expenses, goals, accounts);
  }, [summary, expenses, goals, accounts]);

  // Build checklist items from summary categories (non-rounding, with spending or allocation)
  const checklistItems = useMemo(() => {
    if (!summary || !verifyMode) return [];
    return summary.categories
      .filter(c => !c.isRounding)
      .map(c => {
        const budgeted = monthlyCategoryAmount(c.allocatedAmount, c.frequency);
        const spent = c.spent ?? 0;
        const pct = budgeted > 0 ? spent / budgeted : 0;
        return { id: `cat-${c.id}`, name: c.name, color: c.color, budgeted, spent, pct };
      })
      .sort((a, b) => b.spent - a.spent);
  }, [summary, verifyMode]);

  return (
    <div>
      <PageHeader title="Money Flow" subtitle="See how money flows from income sources through accounts to spending categories and goals"
        actions={
          summary ? (
            <button
              onClick={() => setVerifyMode(v => !v)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                verifyMode
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:text-foreground",
              )}
            >
              <ClipboardCheck size={14} />
              {verifyMode ? "Exit Verify" : "Verify"}
            </button>
          ) : undefined
        }
      />
      <div className="px-4 sm:px-6 space-y-5 pb-6">
        {budgets.length > 0 && (
          <>
            <BudgetYearTabs selectedYear={cm.year} onSelectYear={() => {}} />
            <BudgetMonthGrid
              year={cm.year}
              activeBudgetId={activeBudgetId}
              onSelect={setActiveBudget}
              onCreateMonth={(month, year) => window.location.href = `/budget`}
            />
          </>
        )}
        {!summary ? (
          <EmptyState icon={Wallet} title="No budget yet"
            subtitle="Create a budget to see your money flow."
            action={{ label: "Create Budget", onPress: () => window.location.href = "/budget" }}
          />
        ) : sankeyData.nodes.length === 0 ? (
          <EmptyState icon={Wallet} title="No flow data"
            subtitle="Add income sources and expenses to this budget to see the money flow."
          />
        ) : (
          <div className="overflow-auto max-w-full">
            <div className="border-b border-border pb-3 mb-3">
              <p className="text-sm font-semibold text-foreground">
                {summary.budget.name}
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  {(() => {
                    const dr = getBudgetDateRange(summary.budget);
                    const fmt = (d: string) => {
                      const dt = new Date(d + "T00:00:00");
                      return `${dt.getDate()} ${dt.toLocaleDateString("en-AU", { month: "short" })}`;
                    };
                    return `${fmt(dr.startDate)} – ${fmt(dr.endDate)}`;
                  })()}
                </span>
              </p>
            </div>
            <Sankey data={sankeyData} width={1200} dimmedIds={verifyMode ? checked : undefined} />

            {verifyMode && checklistItems.length > 0 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden mt-5">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">Budget Verification</p>
                  <p className="text-xs text-muted-foreground">{checked.size} of {checklistItems.length} checked</p>
                </div>
                <div className="divide-y divide-border max-h-80 overflow-y-auto">
                  {checklistItems.map(item => {
                    const isChecked = checked.has(item.id);
                    return (
                      <div
                        key={item.id}
                        onClick={() => toggleChecked(item.id)}
                        className={cn(
                          "flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-muted/50",
                          isChecked && "bg-success/5",
                        )}
                      >
                        <div className={cn(
                          "w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                          isChecked ? "bg-success border-success" : "border-muted-foreground/40",
                        )}>
                          {isChecked && <span className="text-[8px] text-white font-bold">✓</span>}
                        </div>
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                        <span className={cn("text-sm flex-1 min-w-0 truncate", isChecked && "line-through text-muted-foreground")}>
                          {item.name}
                        </span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatCurrency(item.spent)} / {formatCurrency(item.budgeted)}
                        </span>
                        <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden flex-shrink-0">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(item.pct, 1) * 100}%`,
                              backgroundColor: item.pct > 1 ? "#ef4444" : item.color,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
