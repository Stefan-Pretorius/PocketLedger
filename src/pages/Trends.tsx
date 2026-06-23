import { useState, useMemo } from "react";
import { useStore } from "../store";
import { formatCurrency, monthName, getBudgetDateRange } from "../utils";
import { Colors } from "../theme";
import { Card, SectionHeader, EmptyState, ColorDot } from "../components/ui";
import { PageHeader } from "../components/Layout";
import { TrendingUp, TrendingDown, Minus, BarChart2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(n: number, d: number) { return d > 0 ? n / d : 0; }
function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

// ─── Income vs Spend Bar Chart ────────────────────────────────────────────────

interface MonthStat {
  key: string;       // "2025-04"
  label: string;     // "Apr 25"
  income: number;
  spent: number;
  saved: number;
  savingsPct: number;
}

function IncomeSpendChart({ months }: { months: MonthStat[] }) {
  const maxVal = Math.max(...months.map(m => m.income), 1);
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div>
      <div className="flex items-end gap-1 h-36">
        {months.map((m, i) => {
          const incomePct = clamp(pct(m.income, maxVal), 0, 1);
          const spendPct = clamp(pct(m.spent, maxVal), 0, 1);
          const over = m.spent > m.income;
          return (
            <div
              key={m.key}
              className="flex-1 flex flex-col items-center gap-0.5 cursor-default"
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Tooltip */}
              {hovered === i && (
                <div className="absolute -mt-20 z-10 bg-card border border-border rounded-xl px-3 py-2 shadow-lg text-xs pointer-events-none w-36">
                  <p className="font-semibold text-foreground mb-1">{m.label}</p>
                  <p className="text-muted-foreground">Income: <span className="text-foreground font-medium">{formatCurrency(m.income)}</span></p>
                  <p className="text-muted-foreground">Spent: <span className={cn("font-medium", over ? "text-destructive" : "text-foreground")}>{formatCurrency(m.spent)}</span></p>
                  <p className="text-muted-foreground">Saved: <span className="text-success font-medium">{formatCurrency(m.saved)}</span></p>
                </div>
              )}
              {/* Bars */}
              <div className="relative w-full flex items-end justify-center gap-0.5" style={{ height: 112 }}>
                {/* Income ghost bar */}
                <div
                  className="flex-1 rounded-t-sm border-2 border-primary/30 bg-primary/5 transition-all"
                  style={{ height: `${incomePct * 100}%` }}
                />
                {/* Spend bar */}
                <div
                  className={cn("flex-1 rounded-t-sm transition-all", over ? "bg-destructive/80" : "bg-primary")}
                  style={{ height: `${spendPct * 100}%`, opacity: hovered === i ? 1 : 0.85 }}
                />
              </div>
              <span className="text-[9px] text-muted-foreground whitespace-nowrap">{m.label}</span>
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex gap-4 mt-3">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm border-2 border-primary/30 bg-primary/5" />
          <span className="text-xs text-muted-foreground">Income</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-primary" />
          <span className="text-xs text-muted-foreground">Spent</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-destructive/80" />
          <span className="text-xs text-muted-foreground">Over budget</span>
        </div>
      </div>
    </div>
  );
}

// ─── Savings Rate Sparkline ───────────────────────────────────────────────────

function SavingsSparkline({ months }: { months: MonthStat[] }) {
  if (months.length < 2) return null;
  const W = 300;
  const H = 60;
  const pts = months.map((m, i) => ({
    x: (i / (months.length - 1)) * W,
    y: H - clamp(m.savingsPct, -0.1, 1) * H,
    m,
  }));
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const fill = `${d} L${W},${H} L0,${H} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={Colors.success} stopOpacity="0.3" />
          <stop offset="100%" stopColor={Colors.success} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* Zero line */}
      <line x1="0" y1={H * 0.5} x2={W} y2={H * 0.5} stroke="currentColor" strokeWidth="0.5" strokeDasharray="3,3" className="text-border" />
      <path d={fill} fill="url(#sparkGrad)" />
      <path d={d} fill="none" stroke={Colors.success} strokeWidth="1.5" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={Colors.success} />
      ))}
    </svg>
  );
}

// ─── Category Heat-Map ────────────────────────────────────────────────────────

interface CatTrend {
  id: number;
  name: string;
  color: string;
  amounts: number[];     // one per month slot
  allocated: number[];   // budget allocated per month
}

function HeatCell({ amount, allocated, maxAmount, color }: {
  amount: number; allocated: number; maxAmount: number; color: string;
}) {
  const intensity = maxAmount > 0 ? clamp(amount / maxAmount, 0, 1) : 0;
  const overBudget = allocated > 0 && amount > allocated;
  const overspend = overBudget ? amount - allocated : 0;
  return (
    <div
      className={cn(
        "relative flex items-center justify-center rounded-md text-[10px] font-medium transition-colors",
        amount === 0 && "text-muted-foreground/30",
        amount > 0 && overBudget && "text-destructive font-bold",
        amount > 0 && !overBudget && "text-foreground",
      )}
      style={{
        backgroundColor: amount > 0 ? (overBudget ? Colors.danger + Math.round(intensity * 0.35 * 255).toString(16).padStart(2, "0") : color + Math.round(intensity * 0.45 * 255).toString(16).padStart(2, "0")) : "transparent",
        height: 34,
        minWidth: 60,
      }}
      title={amount > 0 ? `${formatCurrency(amount)} (budget: ${formatCurrency(allocated)})` : "—"}
    >
      {amount > 0 ? (
        <span className="flex flex-col items-center leading-tight">
          <span>{formatCurrency(amount).replace("A$", "$")}</span>
          {overspend > 0 && (
            <span className="text-[8px] text-destructive/80 font-semibold leading-none -mt-0.5">
              +{formatCurrency(overspend).replace("A$", "$")}
            </span>
          )}
        </span>
      ) : "—"}
    </div>
  );
}

function CategoryHeatMap({ months, catTrends }: { months: MonthStat[]; catTrends: CatTrend[] }) {
  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="min-w-full text-xs border-separate" style={{ borderSpacing: "4px" }}>
        <thead>
          <tr>
            <th className="text-left text-xs text-muted-foreground font-medium pr-4 min-w-24">Category</th>
            {months.map(m => (
              <th key={m.key} className="text-center text-xs text-muted-foreground font-medium px-1 whitespace-nowrap min-w-16">
                {m.label}
              </th>
            ))}
            <th className="text-center text-xs text-muted-foreground font-medium px-1 min-w-16">Avg/mo</th>
            <th className="text-center text-xs text-muted-foreground font-medium px-1 min-w-16">Trend</th>
          </tr>
        </thead>
        <tbody>
          {[...catTrends].sort((a, b) => a.name.localeCompare(b.name)).map(cat => {
            const filledAmounts = cat.amounts.filter(a => a > 0);
            const avg = filledAmounts.length > 0 ? filledAmounts.reduce((s, a) => s + a, 0) / filledAmounts.length : 0;
            const maxAmt = Math.max(...cat.amounts, 1);
            // Trend: compare last 3 months avg vs prior 3 months avg
            const n = cat.amounts.length;
            const recent = cat.amounts.slice(-3).filter(a => a > 0);
            const prior = cat.amounts.slice(-6, -3).filter(a => a > 0);
            const recentAvg = recent.length ? recent.reduce((s, a) => s + a, 0) / recent.length : 0;
            const priorAvg = prior.length ? prior.reduce((s, a) => s + a, 0) / prior.length : 0;
            const changePct = priorAvg > 0 ? ((recentAvg - priorAvg) / priorAvg) * 100 : 0;

            return (
              <tr key={cat.id}>
                <td className="pr-4">
                  <div className="flex items-center gap-2">
                    <ColorDot color={cat.color} size={8} />
                    <span className="font-medium text-foreground whitespace-nowrap">{cat.name}</span>
                  </div>
                </td>
                {cat.amounts.map((amt, i) => (
                  <td key={i} className="p-0">
                    <HeatCell amount={amt} allocated={cat.allocated[i] ?? 0} maxAmount={maxAmt} color={cat.color} />
                  </td>
                ))}
                {/* Average */}
                <td className="text-center">
                  <span className="text-xs text-muted-foreground font-medium">
                    {avg > 0 ? formatCurrency(avg).replace("A$", "$") : "—"}
                  </span>
                </td>
                {/* Trend arrow */}
                <td className="text-center">
                  {priorAvg === 0 || recentAvg === 0 ? (
                    <Minus size={12} className="mx-auto text-muted-foreground" />
                  ) : changePct > 5 ? (
                    <div className="flex items-center justify-center gap-1 text-destructive">
                      <TrendingUp size={12} />
                      <span className="text-[10px] font-medium">+{Math.round(changePct)}%</span>
                    </div>
                  ) : changePct < -5 ? (
                    <div className="flex items-center justify-center gap-1 text-success">
                      <TrendingDown size={12} />
                      <span className="text-[10px] font-medium">{Math.round(changePct)}%</span>
                    </div>
                  ) : (
                    <Minus size={12} className="mx-auto text-muted-foreground" />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Biggest Movers ───────────────────────────────────────────────────────────

function BiggestMovers({ catTrends, months }: { catTrends: CatTrend[]; months: MonthStat[] }) {
  const movers = catTrends
    .map(cat => {
      const recent = cat.amounts.slice(-3).filter(a => a > 0);
      const prior = cat.amounts.slice(-6, -3).filter(a => a > 0);
      const recentAvg = recent.length ? recent.reduce((s, a) => s + a, 0) / recent.length : 0;
      const priorAvg = prior.length ? prior.reduce((s, a) => s + a, 0) / prior.length : 0;
      if (priorAvg === 0 || recentAvg === 0) return null;
      const changePct = ((recentAvg - priorAvg) / priorAvg) * 100;
      const changeDelta = recentAvg - priorAvg;
      return { ...cat, changePct, changeDelta, recentAvg, priorAvg };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b!.changePct) - Math.abs(a!.changePct))
    .slice(0, 6);

  if (movers.length === 0) return null;

  return (
    <div>
      <SectionHeader title="Biggest Movers (last 3 months vs prior 3)" />
      <Card padding={false}>
        {movers.map((m, i) => {
          if (!m) return null;
          const up = m.changePct > 0;
          const lastIdx = m.amounts.length - 1;
          const isOver = lastIdx >= 0 && m.allocated[lastIdx] > 0 && m.amounts[lastIdx] > m.allocated[lastIdx];
          const overPct = isOver ? Math.round(((m.amounts[lastIdx] / m.allocated[lastIdx]) - 1) * 100) : 0;
          return (
            <div key={m.id} className={cn("flex items-center gap-3 px-4 py-3", i < movers.length - 1 && "border-b border-border")}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: m.color + "20" }}>
                {up ? <TrendingUp size={14} style={{ color: Colors.danger }} />
                    : <TrendingDown size={14} style={{ color: Colors.success }} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <ColorDot color={m.color} size={7} />
                  <span className="text-sm font-medium text-foreground">{m.name}</span>
                  {isOver && (
                    <span className="text-destructive/80 text-[10px] font-semibold ml-auto">
                      +{overPct}% over budget
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(m.priorAvg)}/mo → {formatCurrency(m.recentAvg)}/mo
                </p>
              </div>
              <div className={cn("text-right", up ? "text-destructive" : "text-success")}>
                <p className="text-sm font-bold">{up ? "+" : ""}{Math.round(m.changePct)}%</p>
                <p className="text-xs">{up ? "+" : ""}{formatCurrency(Math.abs(m.changeDelta))}/mo</p>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function TrendsPage() {
  const { budgets, expenses, categories } = useStore();

  const months: MonthStat[] = useMemo(() => {
    const sorted = [...budgets].sort((a, b) =>
      a.year !== b.year ? a.year - b.year : a.month - b.month,
    );
    return sorted.map(b => {
      const { startDate, endDate } = getBudgetDateRange(b);
      const budgetExpenses = expenses.filter(
        e => e.budgetId === b.id && e.date >= startDate && e.date <= endDate && e.isWithdrawal !== true,
      );
      const spent = budgetExpenses.reduce((s, e) => s + e.amount, 0);
      const saved = b.totalIncome - spent;
      return {
        key: `${b.year}-${String(b.month).padStart(2, "0")}`,
        label: `${monthName(b.month).slice(0, 3)} ${String(b.year).slice(2)}`,
        income: b.totalIncome,
        spent,
        saved,
        savingsPct: b.totalIncome > 0 ? saved / b.totalIncome : 0,
      };
    });
  }, [budgets, expenses]);

  // Category trends: for each category used across any budget, collect spend per month slot
  const catTrends: CatTrend[] = useMemo(() => {
    // Find all unique category names across all budgets
    const nameSet = new Set<string>();
    categories.forEach(c => nameSet.add(c.name));

    return Array.from(nameSet).map(name => {
      // Pick the most recent category with this name for color
      const sample = [...categories].reverse().find(c => c.name === name);
      const color = sample?.color ?? Colors.primary;

      const amounts = months.map(m => {
        const budget = budgets.find(b => `${b.year}-${String(b.month).padStart(2, "0")}` === m.key);
        if (!budget) return 0;
        const cat = categories.find(c => c.budgetId === budget.id && c.name === name);
        if (!cat) return 0;
        const { startDate, endDate } = getBudgetDateRange(budget);
        return expenses.filter(
          e => e.budgetId === budget.id && e.categoryId === cat.id && e.date >= startDate && e.date <= endDate,
        ).reduce((s, e) => s + e.amount, 0);
      });

      const allocated = months.map(m => {
        const budget = budgets.find(b => `${b.year}-${String(b.month).padStart(2, "0")}` === m.key);
        if (!budget) return 0;
        const cat = categories.find(c => c.budgetId === budget.id && c.name === name);
        return cat?.allocatedAmount ?? 0;
      });

      // Only include categories that have at least one month with data
      const hasData = amounts.some(a => a > 0);
      if (!hasData) return null;

      return { id: sample?.id ?? 0, name, color, amounts, allocated };
    }).filter(Boolean) as CatTrend[];
  }, [budgets, categories, expenses, months]);

  // Summary stats
  const totals = useMemo(() => {
    const totalIncome = months.reduce((s, m) => s + m.income, 0);
    const totalSpent = months.reduce((s, m) => s + m.spent, 0);
    const avgSavingsPct = months.length > 0
      ? months.reduce((s, m) => s + m.savingsPct, 0) / months.length
      : 0;
    const bestMonth = months.reduce((best, m) => m.savingsPct > best.savingsPct ? m : best, months[0]);
    return { totalIncome, totalSpent, avgSavingsPct, bestMonth };
  }, [months]);

  if (months.length === 0) {
    return (
      <div>
        <PageHeader title="Trends" />
        <div className="px-4 sm:px-6">
          <EmptyState icon={BarChart2} title="No data yet"
            subtitle="Create budgets and add expenses to see spending trends over time."
            action={{ label: "Go to Budget", onPress: () => window.location.href = "/budget" }}
          />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Trends"
        subtitle={`${months.length} month${months.length !== 1 ? "s" : ""} of data`}
      />

      <div className="px-4 sm:px-6 space-y-6 pb-6">
        {/* Summary stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total Income", value: formatCurrency(totals.totalIncome), color: Colors.primary },
            { label: "Total Spent", value: formatCurrency(totals.totalSpent), color: Colors.danger },
            { label: "Avg Savings Rate", value: `${Math.round(totals.avgSavingsPct * 100)}%`, color: Colors.success },
            { label: "Best Month", value: totals.bestMonth?.label ?? "—", color: Colors.warning, sub: totals.bestMonth ? `${Math.round(totals.bestMonth.savingsPct * 100)}% saved` : undefined },
          ].map(s => (
            <Card key={s.label} className="text-center py-2">
              <p className="text-xs text-muted-foreground mb-1">{s.label}</p>
              <p className="text-base font-bold" style={{ color: s.color }}>{s.value}</p>
              {s.sub && <p className="text-xs text-muted-foreground mt-0.5">{s.sub}</p>}
            </Card>
          ))}
        </div>

        {/* Income vs Spending bar chart */}
        <Card>
          <p className="text-sm font-semibold text-foreground mb-4">Income vs Spending</p>
          <div className="relative">
            <IncomeSpendChart months={months} />
          </div>
        </Card>

        {/* Savings rate sparkline */}
        {months.length >= 2 && (
          <Card>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-foreground">Savings Rate</p>
              <div className="flex items-center gap-3">
                {months.slice(-1).map(m => (
                  <span key={m.key} className={cn("text-sm font-bold", m.savingsPct >= 0 ? "text-success" : "text-destructive")}>
                    {Math.round(m.savingsPct * 100)}% <span className="text-xs font-normal text-muted-foreground">this month</span>
                  </span>
                ))}
              </div>
            </div>
            <SavingsSparkline months={months} />
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-muted-foreground">{months[0]?.label}</span>
              <span className="text-[10px] text-muted-foreground">{months[months.length - 1]?.label}</span>
            </div>
          </Card>
        )}

        {/* Biggest movers */}
        {months.length >= 2 && catTrends.length > 0 && (
          <BiggestMovers catTrends={catTrends} months={months} />
        )}

        {/* Category heat-map */}
        {catTrends.length > 0 && (
          <div>
            <SectionHeader title="Category Spending by Month" />
            <Card>
              <p className="text-xs text-muted-foreground mb-3">
                Cell color intensity = proportion of that category's peak spend.
                <span className="text-destructive ml-1">Red + bold = over budget. Overspend shown.</span>
              </p>
              <CategoryHeatMap months={months} catTrends={catTrends} />
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
