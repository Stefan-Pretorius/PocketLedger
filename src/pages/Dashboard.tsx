import { useState, useMemo } from "react";
import { toast } from "sonner";
import { useStore } from "../store";
import { formatCurrency, monthName, currentMonth, getBudgetDateRange, monthlyCategoryAmount } from "../utils";
import { Colors } from "../theme";
import { Card, ProgressBar, SectionHeader, EmptyState, ColorDot } from "../components/ui";
import { PageHeader } from "../components/Layout";
import { BudgetYearTabs, BudgetMonthGrid } from "../components/BudgetPicker";
import { TrendingUp, TrendingDown, DollarSign, Target, Receipt, Wallet, PieChart, LayoutGrid, List, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Donut chart ─────────────────────────────────────────────────────────────

function DonutChart({
  segments,
}: {
  segments: { label: string; value: number; color: string }[];
}) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) return null;

  let offset = 0;
  const slices = segments
    .filter(s => s.value > 0)
    .map(s => {
      const dash = (s.value / total) * C;
      const slice = { ...s, dash, gap: C - dash, offset };
      offset += dash;
      return slice;
    });

  return (
    <svg viewBox="0 0 120 120" className="w-full h-full" style={{ transform: "rotate(-90deg)" }}>
      {slices.map((s, i) => (
        <circle
          key={i}
          cx="60" cy="60" r={R}
          fill="none"
          stroke={s.color}
          strokeWidth="16"
          strokeDasharray={`${s.dash} ${s.gap}`}
          strokeDashoffset={-s.offset}
        />
      ))}
      {/* Track ring */}
      <circle cx="60" cy="60" r={R} fill="none" stroke="currentColor" strokeWidth="16" className="text-muted/30" strokeDasharray={`${C}`} style={{ display: "none" }} />
    </svg>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color, sub }: {
  label: string; value: string; icon: React.ElementType; color: string; sub?: string;
}) {
  return (
    <Card className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: color + "20" }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-base font-bold text-foreground truncate">{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </Card>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function Dashboard() {
  const { budgets, activeBudgetId, setActiveBudget, getBudgetSummary, getPortfolioSummary, expenses, goals, convertCategoryToGoal, convertGoalToCategory, categories, budgetSections } = useStore();
  const cm = currentMonth();
  const [selectedYear, setSelectedYear] = useState(cm.year);
  const [newBudgetDefaults, setNewBudgetDefaults] = useState<{ month: number; year: number } | null>(null);

  const [viewMode, setViewMode] = useState<"cards" | "compact" | "list">(
    () => (localStorage.getItem("dashboardCategoryView") as "cards" | "compact" | "list") ?? "cards",
  );
  const setView = (mode: "cards" | "compact" | "list") => {
    setViewMode(mode);
    localStorage.setItem("dashboardCategoryView", mode);
  };

  const summary = activeBudgetId ? getBudgetSummary(activeBudgetId) : null;
  const activeBudget = summary?.budget;

  const recentExpenses = useMemo(() => {
    if (!activeBudget) return [];
    const { startDate, endDate } = getBudgetDateRange(activeBudget);
    return expenses.filter(
      e => e.budgetId === activeBudgetId && e.date >= startDate && e.date <= endDate && e.isWithdrawal !== true,
    ).slice(0, 5);
  }, [expenses, activeBudgetId, activeBudget]);

  const goalProgress = goals.map(g => ({
    ...g, pct: g.targetAmount != null && g.targetAmount > 0 ? g.currentAmount / g.targetAmount : 0,
  }));

  const holdings = useStore(s => s.holdings);
  const portfolioSummary = useMemo(() => {
    try { return getPortfolioSummary(); } catch { return null; }
  }, [getPortfolioSummary, holdings]);

  const [chartView, setChartView] = useState<"category" | "section">("category");

  // Category spending segments for donut (exclude rounding categories)
  const spendingSegments = useMemo(() =>
    (summary?.categories ?? [])
      .filter(c => !c.isRounding && (c.spent ?? 0) > 0)
      .map(c => ({ label: c.name, value: c.spent ?? 0, color: c.color })),
    [summary],
  );

  // Section-aggregated spending segments
  const sectionLookup = useMemo(() => new Map(budgetSections.map(s => [s.id, s])), [budgetSections]);
  const sectionSegments = useMemo(() => {
    const bySection = new Map<string, { label: string; value: number; color: string }>();
    for (const c of summary?.categories ?? []) {
      if (c.isRounding || !(c.spent ?? 0)) continue;
      const sec = c.sectionId != null ? sectionLookup.get(c.sectionId) : undefined;
      const key = sec ? `sec-${sec.id}` : "other";
      const existing = bySection.get(key);
      if (existing) {
        existing.value += c.spent ?? 0;
      } else {
        bySection.set(key, {
          label: sec?.name ?? "Other",
          value: c.spent ?? 0,
          color: sec?.color ?? "#94a3b8",
        });
      }
    }
    return [...bySection.values()].sort((a, b) => b.value - a.value);
  }, [summary, sectionLookup]);

  const activeSegments = chartView === "section" ? sectionSegments : spendingSegments;

  // Month-over-month trend: last 6 months spending
  const trendData = useMemo(() => {
    const sorted = [...budgets].sort((a, b) =>
      a.year !== b.year ? a.year - b.year : a.month - b.month,
    ).slice(-6);
    return sorted.map(b => {
      const spent = expenses.filter(e => e.budgetId === b.id && e.isWithdrawal !== true).reduce((s, e) => s + e.amount, 0);
      return { label: `${monthName(b.month).slice(0, 3)} ${String(b.year).slice(2)}`, spent, income: b.totalIncome };
    });
  }, [budgets, expenses]);

  const maxTrend = Math.max(...trendData.map(d => d.income), 1);

  return (
    <div>
      <PageHeader title="Dashboard" />

      <div className="px-4 sm:px-6 space-y-5 pb-6">
        {/* Year tabs */}
        {budgets.length > 0 && (
          <>
            <BudgetYearTabs selectedYear={selectedYear} onSelectYear={setSelectedYear} />
            <BudgetMonthGrid
              year={selectedYear}
              activeBudgetId={activeBudgetId}
              onSelect={setActiveBudget}
              onCreateMonth={(month, year) => window.location.href = `/budget`}
            />
          </>
        )}

        {!summary ? (
          <EmptyState icon={Wallet} title="No budget yet"
            subtitle="Create your first budget to start tracking expenses."
            action={{ label: "Create Budget", onPress: () => window.location.href = "/budget" }}
          />
        ) : (
          <>
            {/* Heading for selected budget */}
            {activeBudget && (() => {
              const dr = getBudgetDateRange(activeBudget);
              const fmt = (d: string) => {
                const dt = new Date(d + "T00:00:00");
                return `${dt.getDate()} ${monthName(dt.getMonth() + 1)}`;
              };
              return (
                <p className="text-lg font-bold text-foreground">
                  {activeBudget.name}
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    {fmt(dr.startDate)} – {fmt(dr.endDate)}
                  </span>
                </p>
              );
            })()}

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Total Income" value={formatCurrency(summary.totalIncome)} icon={DollarSign} color={Colors.primary}
                sub={summary.incomeSources.length > 0 ? `${summary.incomeSources.length} source${summary.incomeSources.length !== 1 ? "s" : ""}` : undefined} />
              <StatCard label="Total Spent" value={formatCurrency(summary.totalSpent)} icon={TrendingDown} color={Colors.danger}
                sub={`${summary.totalAllocated > 0 ? Math.round(summary.totalSpent / summary.totalAllocated * 100) : 0}% of allocated`} />
              <StatCard label="Remaining" value={formatCurrency(summary.remaining)} icon={TrendingUp}
                color={summary.remaining >= 0 ? Colors.success : Colors.danger} />
              {summary.totalRoundingSaved > 0 ? (
                <StatCard label="Round-up Saved" value={formatCurrency(summary.totalRoundingSaved)} icon={Wallet}
                  color={Colors.success} sub="from savings transfers" />
              ) : (
                <StatCard label="Unallocated" value={formatCurrency(summary.unallocated)} icon={Wallet}
                  color={summary.unallocated >= 0 ? Colors.warning : Colors.danger}
                  sub={summary.carryover > 0 ? `incl. ${formatCurrency(summary.carryover)} carryover` : undefined} />
              )}
            </div>

            {/* Spending Insights */}
            {activeSegments.length > 0 && (
              <Card>
                <div className="flex items-start gap-4">
                  {/* Donut */}
                  <div className="relative w-28 h-28 flex-shrink-0">
                    <DonutChart segments={activeSegments} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-xs font-bold text-foreground leading-tight">
                        {formatCurrency(summary.totalSpent).replace("A$", "$")}
                      </span>
                      <span className="text-[9px] text-muted-foreground">spent</span>
                    </div>
                  </div>
                  {/* Compact legend */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <p className="text-sm font-semibold text-foreground">Spending</p>
                      <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                        <button onClick={() => setChartView("category")} className={cn("px-2 py-0.5 rounded text-[10px] font-medium transition-colors", chartView === "category" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>By Category</button>
                        <button onClick={() => setChartView("section")} className={cn("px-2 py-0.5 rounded text-[10px] font-medium transition-colors", chartView === "section" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>By Section</button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                      {[...activeSegments].sort((a, b) => b.value - a.value).map(s => {
                        const pct = summary.totalSpent > 0 ? Math.round((s.value / summary.totalSpent) * 100) : 0;
                        return (
                          <div key={s.label} className="flex items-center gap-1.5 text-xs">
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                            <span className="text-foreground">{s.label}</span>
                            <span className="font-semibold text-foreground">{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {/* Month trend */}
            {trendData.length > 1 && (
              <Card>
                <p className="text-sm font-semibold text-foreground mb-4">Monthly Spending Trend</p>
                <div className="flex items-end gap-1.5 h-24">
                  {trendData.map((d, i) => {
                    const pct = d.income > 0 ? d.spent / d.income : 0;
                    const isActive = i === trendData.length - 1 && d.spent === summary.totalSpent;
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1">
                        <div className="w-full flex flex-col justify-end" style={{ height: 72 }}>
                          <div
                            className={cn(
                              "w-full rounded-t-md transition-all",
                              isActive ? "bg-primary" : "bg-primary/30",
                            )}
                            style={{ height: `${Math.max(pct * 100, 4)}%` }}
                            title={`${d.label}: ${formatCurrency(d.spent)}`}
                          />
                        </div>
                        <span className="text-[9px] text-muted-foreground">{d.label}</span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* Category breakdown bars */}
            {summary.categories.length > 0 && (() => {
              const budgetCats = summary.categories.filter(c => !c.isRounding);
              const bySection: Record<string, typeof budgetCats> = {};
              for (const cat of budgetCats) {
                const secName = cat.sectionId != null ? (sectionLookup.get(cat.sectionId)?.name ?? "Other") : "Other";
                if (!bySection[secName]) bySection[secName] = [];
                bySection[secName].push(cat);
              }
              const sectionKeys = Object.keys(bySection).sort((a, b) => a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b));
              return (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <SectionHeader title="Category Budgets" />
                    <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
                      <button onClick={() => setView("cards")} className={cn("p-1.5 rounded-md transition-colors", viewMode === "cards" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")} title="Card view"><LayoutGrid size={14} /></button>
                      <button onClick={() => setView("compact")} className={cn("p-1.5 rounded-md transition-colors", viewMode === "compact" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")} title="Compact grid"><LayoutGrid size={12} className="scale-75" /></button>
                      <button onClick={() => setView("list")} className={cn("p-1.5 rounded-md transition-colors", viewMode === "list" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")} title="List view"><List size={14} /></button>
                    </div>
                  </div>
                  {sectionKeys.map(secName => {
                    const cats = bySection[secName];
                    return (
                      <div key={secName} className="mb-4">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{secName}</p>
                        {viewMode === "cards" && (
                          <div className="space-y-2">
                            {cats.sort((a, b) => a.name.localeCompare(b.name)).map(cat => {
                              const monthly = monthlyCategoryAmount(cat.allocatedAmount, cat.frequency);
                              const pct = monthly > 0 ? (cat.spent ?? 0) / monthly : 0;
                              const over = pct > 1;
                              return (
                                <Card key={cat.id} padding={false} className="px-4 py-3">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <ColorDot color={cat.color} size={10} />
                                      <span className="text-sm font-medium text-foreground truncate">
                                        {cat.name}
                                        {cat.frequency === "weekly" && <span className="text-[10px] text-muted-foreground/60 font-normal">/wk</span>}
                                        {cat.frequency === "fortnightly" && <span className="text-[10px] text-muted-foreground/60 font-normal">/fn</span>}
                                      </span>
                                    </div>
                                    <span className={cn("text-xs font-medium flex-shrink-0 ml-2", over ? "text-destructive" : "text-muted-foreground")}>
                                      {formatCurrency(cat.spent ?? 0)} / {formatCurrency(monthly)}
                                      {over && (
                                        <span className="ml-1 text-destructive/70 text-[10px] font-semibold">
                                          (+{Math.round((pct - 1) * 100)}%)
                                        </span>
                                      )}
                                    </span>
                                    <button
                                      onClick={() => { convertCategoryToGoal(cat.id); toast.success(`"${cat.name}" converted to goal`); }}
                                      className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-colors ml-1"
                                      title="Convert to goal"
                                    >
                                      <ArrowUpDown size={12} />
                                    </button>
                                  </div>
                                  <ProgressBar value={pct} color={over ? Colors.danger : cat.color} height={6} />
                                </Card>
                              );
                            })}
                          </div>
                        )}
                        {viewMode === "compact" && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {cats.sort((a, b) => a.name.localeCompare(b.name)).map(cat => {
                              const monthly = monthlyCategoryAmount(cat.allocatedAmount, cat.frequency);
                              const pct = monthly > 0 ? (cat.spent ?? 0) / monthly : 0;
                              const over = pct > 1;
                              return (
                                <div key={cat.id} className="bg-card border border-border rounded-lg px-3 py-2 min-w-0 group">
                                  <div className="flex items-center justify-between gap-1 mb-1">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      <ColorDot color={cat.color} size={7} />
                                      <span className="text-xs font-medium text-foreground truncate">
                                        {cat.name}
                                        {cat.frequency === "weekly" && <span className="text-[10px] text-muted-foreground/60 font-normal">/wk</span>}
                                        {cat.frequency === "fortnightly" && <span className="text-[10px] text-muted-foreground/60 font-normal">/fn</span>}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-0.5">
                                      <span className={cn("text-[11px] font-medium flex-shrink-0", over ? "text-destructive" : "text-muted-foreground")}>
                                        {formatCurrency(cat.spent ?? 0)} / {formatCurrency(monthly)}
                                        {over && (
                                          <span className="ml-0.5 text-destructive/70 text-[10px] font-semibold">
                                            (+{Math.round((pct - 1) * 100)}%)
                                          </span>
                                        )}
                                      </span>
                                      <button
                                        onClick={() => { convertCategoryToGoal(cat.id); toast.success(`"${cat.name}" converted to goal`); }}
                                        className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-muted-foreground/30 hover:text-primary hover:bg-primary/10 transition-colors"
                                        title="Convert to goal"
                                      >
                                        <ArrowUpDown size={10} />
                                      </button>
                                    </div>
                                  </div>
                                  <ProgressBar value={pct} color={over ? Colors.danger : cat.color} height={4} />
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {viewMode === "list" && (
                          <Card padding={false}>
                            {cats.sort((a, b) => a.name.localeCompare(b.name)).map((cat, i) => {
                              const monthly = monthlyCategoryAmount(cat.allocatedAmount, cat.frequency);
                              const pct = monthly > 0 ? (cat.spent ?? 0) / monthly : 0;
                              const over = pct > 1;
                              return (
                                <div key={cat.id} className={cn("flex items-center gap-2 px-3 py-2", i < cats.length - 1 && "border-b border-border")}>
                                  <ColorDot color={cat.color} size={6} />
                                  <span className="text-xs font-medium text-foreground truncate flex-1 min-w-0">
                                    {cat.name}
                                    {cat.frequency === "weekly" && <span className="text-[10px] text-muted-foreground/60 font-normal">/wk</span>}
                                    {cat.frequency === "fortnightly" && <span className="text-[10px] text-muted-foreground/60 font-normal">/fn</span>}
                                  </span>
                                  <div className="flex-1 max-w-32">
                                    <div className="w-full rounded-full bg-muted overflow-hidden" style={{ height: 4 }}>
                                      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(pct, 1) * 100}%`, backgroundColor: over ? Colors.danger : cat.color }} />
                                    </div>
                                  </div>
                                  <span className={cn("text-[11px] font-medium flex-shrink-0 w-24 text-right", over ? "text-destructive" : "text-muted-foreground")}>
                                    {formatCurrency(cat.spent ?? 0)} / {formatCurrency(monthly)}
                                    {over && (
                                      <span className="ml-0.5 text-destructive/70 text-[10px] font-semibold">
                                        (+{Math.round((pct - 1) * 100)}%)
                                      </span>
                                    )}
                                  </span>
                                  <button
                                    onClick={() => { convertCategoryToGoal(cat.id); toast.success(`"${cat.name}" converted to goal`); }}
                                    className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-muted-foreground/30 hover:text-primary hover:bg-primary/10 transition-colors"
                                    title="Convert to goal"
                                  >
                                    <ArrowUpDown size={10} />
                                  </button>
                                </div>
                              );
                            })}
                          </Card>
                        )}
                      </div>
                    );
                  })}
                  {/* Round-up categories */}
                  {summary.categories.filter(c => c.isRounding).length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Round-up &amp; Savings</p>
                      <div className="bg-success/5 border border-success/20 rounded-lg px-4 py-2">
                        <p className="text-xs text-muted-foreground">
                          Total saved: <span className="text-success font-medium">{formatCurrency(summary.totalRoundingSaved)}</span>
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Recent expenses */}
            {recentExpenses.length > 0 && (
              <div>
                <SectionHeader title="Recent Expenses" action={{ label: "See all", onPress: () => window.location.href = "/expenses" }} />
                <Card padding={false}>
                  {recentExpenses.map((exp, i) => {
                    const cat = summary.categories.find(c => c.id === exp.categoryId);
                    return (
                      <div key={exp.id} className={cn("flex items-center gap-3 px-4 py-3", i < recentExpenses.length - 1 && "border-b border-border")}>
                        <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: (cat?.color ?? Colors.primary) + "20" }}>
                          <Receipt size={14} style={{ color: cat?.color ?? Colors.primary }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{exp.description}</p>
                          <p className="text-xs text-muted-foreground">{cat?.name ?? "Uncategorized"} · {exp.date}</p>
                        </div>
                        <span className="text-sm font-semibold text-foreground">{formatCurrency(exp.amount)}</span>
                      </div>
                    );
                  })}
                </Card>
              </div>
            )}

            {/* Goals */}
            {goalProgress.length > 0 && (
              <div>
                <SectionHeader title="Savings Goals" action={{ label: "See all", onPress: () => window.location.href = "/goals" }} />
                <div className="space-y-2">
                  {goalProgress.slice(0, 3).map(g => {
                    const hasTarget = g.targetAmount != null && g.targetAmount > 0;
                    return (
                      <Card key={g.id} padding={false} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <ColorDot color={g.color} size={10} />
                            <span className="text-sm font-medium text-foreground truncate">{g.name}</span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-xs text-muted-foreground">
                              {hasTarget
                                ? `${formatCurrency(g.currentAmount)} / ${formatCurrency(g.targetAmount!)}`
                                : formatCurrency(g.currentAmount)}
                            </span>
                            {activeBudgetId && (
                              <button
                                onClick={() => { convertGoalToCategory(g.id, activeBudgetId); toast.success(`"${g.name}" converted to category`); }}
                                className="flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground/40 hover:text-primary hover:bg-primary/10 transition-colors"
                                title="Convert to category"
                              >
                                <ArrowUpDown size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                        {hasTarget && <ProgressBar value={g.pct} color={g.color} height={6} />}
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Portfolio summary */}
            {portfolioSummary && portfolioSummary.holdingSummaries.length > 0 && (
              <div>
                <SectionHeader title="Portfolio" action={{ label: "See all", onPress: () => window.location.href = "/investments" }} />
                <div className="grid grid-cols-2 gap-2">
                  <Card className="text-center py-3">
                    <p className="text-xs text-muted-foreground">Invested</p>
                    <p className="text-sm font-bold text-foreground">{formatCurrency(portfolioSummary.totalInvested)}</p>
                  </Card>
                  <Card className="text-center py-3">
                    <p className="text-xs text-muted-foreground">Market Value</p>
                    <p className="text-sm font-bold" style={{ color: portfolioSummary.totalGainLoss >= 0 ? Colors.success : Colors.danger }}>
                      {formatCurrency(portfolioSummary.totalMarketValue)}
                    </p>
                  </Card>
                  <Card className="text-center py-3 col-span-2">
                    <div className="flex items-center justify-center gap-2">
                      <PieChart size={14} className={portfolioSummary.totalGainLoss >= 0 ? "text-success" : "text-destructive"} />
                      <p className="text-xs text-muted-foreground">Total P&amp;L</p>
                      <p className={cn("text-sm font-bold", portfolioSummary.totalGainLoss >= 0 ? "text-success" : "text-destructive")}>
                        {portfolioSummary.totalGainLoss >= 0 ? "+" : ""}{formatCurrency(portfolioSummary.totalGainLoss)}
                        <span className="text-xs ml-1">
                          ({portfolioSummary.totalGainLossPct >= 0 ? "+" : ""}{portfolioSummary.totalGainLossPct.toFixed(1)}%)
                        </span>
                      </p>
                    </div>
                  </Card>
                  {/* Owner breakdown */}
                  {(() => {
                    const self = portfolioSummary.holdingSummaries.filter(s => s.holding.owner === "self" || s.holding.owner == null);
                    const partner = portfolioSummary.holdingSummaries.filter(s => s.holding.owner === "partner");
                    const selfVal = self.reduce((s, h) => s + h.marketValue, 0);
                    const partnerVal = partner.reduce((s, h) => s + h.marketValue, 0);
                    if (selfVal > 0 || partnerVal > 0) return (
                      <>
                        {selfVal > 0 && (
                          <Card className="text-center py-2">
                            <p className="text-[10px] text-muted-foreground">Self</p>
                            <p className="text-xs font-bold text-foreground">{formatCurrency(selfVal)}</p>
                          </Card>
                        )}
                        {partnerVal > 0 && (
                          <Card className="text-center py-2">
                            <p className="text-[10px] text-muted-foreground">Partner</p>
                            <p className="text-xs font-bold text-foreground">{formatCurrency(partnerVal)}</p>
                          </Card>
                        )}
                      </>
                    );
                    return null;
                  })()}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
