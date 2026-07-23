export function formatCurrency(amount: number): string {
  if (isNaN(amount)) return "$0.00";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export function monthName(month: number): string {
  return new Date(2000, month - 1, 1).toLocaleString("en-AU", { month: "long" });
}

export function today(): string {
  return new Date().toISOString().split("T")[0];
}

export function currentMonth(): { month: number; year: number } {
  const d = new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

import { Colors } from "./theme";
import type { Budget, PayFrequency, RecurringExpense, BudgetSummary, Expense, Goal, Account } from "./types";

/** Compute the date range a budget covers, based on its startDay. */
export function getBudgetDateRange(budget: Pick<Budget, "month" | "year" | "startDay">): { startDate: string; endDate: string } {
  const clamp = (y: number, m: number) => Math.min(budget.startDay, new Date(y, m, 0).getDate());
  const pad = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const startDay = clamp(budget.year, budget.month);
  const startDate = pad(budget.year, budget.month, startDay);

  const nextMonth = budget.month === 12 ? 1 : budget.month + 1;
  const nextYear = budget.month === 12 ? budget.year + 1 : budget.year;
  const endDay = clamp(nextYear, nextMonth);
  const endDate = pad(nextYear, nextMonth, endDay);

  return { startDate, endDate };
}

/** Convert an income source amount to its monthly equivalent for budgeting. */
export function monthlyIncomeAmount(amount: number, frequency: "monthly" | "fortnightly"): number {
  if (frequency === "fortnightly") return (amount * 26) / 12;
  return amount;
}

/** Convert a category allocated amount to its monthly equivalent. */
export function monthlyCategoryAmount(amount: number, frequency?: "monthly" | "fortnightly" | "weekly"): number {
  if (frequency === "weekly") return (amount * 52) / 12;
  if (frequency === "fortnightly") return (amount * 26) / 12;
  return amount;
}

/** Convert a recurring expense amount to its monthly equivalent for budgeting. */
export function monthlyRecurringAmount(amount: number, frequency: PayFrequency): number {
  switch (frequency) {
    case "weekly": return (amount * 52) / 12;
    case "fortnightly": return (amount * 26) / 12;
    case "monthly": return amount;
  }
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function dayOfWeekLabel(dow: number): string {
  return DAY_LABELS[dow] ?? "Mon";
}

/** All payment dates for a recurring expense within a budget month. */
export function getRecurringDatesInMonth(
  year: number,
  month: number,
  rec: Pick<RecurringExpense, "frequency" | "dayOfMonth" | "dayOfWeek" | "anchorDate">,
): string[] {
  const lastDay = new Date(year, month, 0).getDate();
  const pad = (d: number) =>
    `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  if (rec.frequency === "monthly") {
    return [pad(Math.min(rec.dayOfMonth ?? 1, lastDay))];
  }

  const targetDow = rec.dayOfWeek ?? 1;

  if (rec.frequency === "weekly") {
    const dates: string[] = [];
    for (let d = 1; d <= lastDay; d++) {
      if (new Date(year, month - 1, d).getDay() === targetDow) dates.push(pad(d));
    }
    return dates;
  }

  // Fortnightly
  if (rec.anchorDate) {
    const dates: string[] = [];
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month - 1, lastDay);
    const current = new Date(rec.anchorDate + "T00:00:00");
    while (current < monthStart) current.setDate(current.getDate() + 14);
    while (current <= monthEnd) {
      if (current.getFullYear() === year && current.getMonth() === month - 1) {
        dates.push(pad(current.getDate()));
      }
      current.setDate(current.getDate() + 14);
    }
    return dates;
  }

  // Fallback: first matching weekday, then every 14 days
  const dates: string[] = [];
  let startDay = 1;
  for (; startDay <= lastDay; startDay++) {
    if (new Date(year, month - 1, startDay).getDay() === targetDow) break;
  }
  for (let d = startDay; d <= lastDay; d += 14) dates.push(pad(d));
  return dates;
}

export function formatRecurringSchedule(rec: Pick<RecurringExpense, "frequency" | "dayOfMonth" | "dayOfWeek" | "anchorDate">): string {
  switch (rec.frequency) {
    case "monthly":
      return `monthly · day ${rec.dayOfMonth ?? 1}`;
    case "weekly":
      return `weekly · ${dayOfWeekLabel(rec.dayOfWeek ?? 1)}`;
    case "fortnightly":
      return rec.anchorDate
        ? `fortnightly · from ${formatDate(rec.anchorDate)}`
        : `fortnightly · ${dayOfWeekLabel(rec.dayOfWeek ?? 1)}`;
  }
}

// ─── Sankey data ──────────────────────────────────────────────────────────────

export interface SankeyNode {
  id: string;
  label: string;
  color: string;
  column: number;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
  color: string;
}

export interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

import type { BudgetSummary, Expense, Goal, Account } from "./types";

/**
 * Build nodes & links for a 3-column Sankey: Income Sources → Accounts → Categories + Goals.
 * Column 0: income sources  |  Column 1: accounts  |  Column 2: categories + goals
 */
export function computeSankeyData(
  summary: BudgetSummary,
  expenses: Expense[],
  allGoals: Goal[],
  allAccounts: Account[],
): SankeyData {
  const { startDate, endDate } = getBudgetDateRange(summary.budget);
  const periodExpenses = expenses.filter(
    e => e.budgetId === summary.budget.id && e.date >= startDate && e.date <= endDate,
  );

  const accounts = new Map(allAccounts.map(a => [a.id, a]));

  // Aggregate by category (non-goal) and by goal (contributions only)
  const catSpend = new Map<number, number>();
  const goalSpend = new Map<number, number>();
  for (const exp of periodExpenses) {
    if (exp.isWithdrawal) continue;
    if (exp.goalId != null) {
      goalSpend.set(exp.goalId, (goalSpend.get(exp.goalId) ?? 0) + exp.amount);
    } else if (exp.categoryId != null && !summary.categories.find(c => c.id === exp.categoryId)?.isRounding) {
      catSpend.set(exp.categoryId, (catSpend.get(exp.categoryId) ?? 0) + exp.amount);
    }
  }

  const nodes: SankeyNode[] = [];
  const nodeIndex = new Map<string, number>();
  const links: SankeyLink[] = [];
  const addNode = (id: string, label: string, color: string, col: number) => {
    if (nodeIndex.has(id)) return;
    nodeIndex.set(id, nodes.length);
    nodes.push({ id, label, color, column: col });
  };

  // Income sources → Accounts
  for (const inc of summary.incomeSources) {
    const incId = `inc-${inc.id}`;
    addNode(incId, inc.name, Colors.success, 0);
    const val = monthlyIncomeAmount(inc.amount, inc.frequency);
    if (inc.accountId != null) {
      const a = accounts.get(inc.accountId);
      if (a) {
        const accId = `acc-${inc.accountId}`;
        addNode(accId, a.name, Colors.primary, 1);
        links.push({ source: incId, target: accId, value: val, color: Colors.success });
        continue;
      }
    }
    addNode("acc-unallocated", "Unassigned", "#94a3b8", 1);
    links.push({ source: incId, target: "acc-unallocated", value: val, color: Colors.success });
  }

  // Helper: create links from accounts to a target node with account breakdown
  const linkAccountsTo = (targetId: string, color: string, filter: (exp: Expense) => boolean) => {
    const byAccount = new Map<number, number>();
    let total = 0;
    for (const exp of periodExpenses) {
      if (filter(exp)) {
        total += exp.amount;
        if (exp.accountId != null) {
          byAccount.set(exp.accountId, (byAccount.get(exp.accountId) ?? 0) + exp.amount);
        }
      }
    }
    for (const [accId, val] of byAccount) {
      const a = accounts.get(accId);
      if (a) {
        const accIdStr = `acc-${accId}`;
        addNode(accIdStr, a.name, Colors.primary, 1);
        links.push({ source: accIdStr, target: targetId, value: val, color });
      }
    }
    const linked = [...byAccount.values()].reduce((s, v) => s + v, 0);
    const remainder = total - linked;
    if (remainder > 0.01) {
      addNode("acc-unallocated", "Unassigned", "#94a3b8", 1);
      links.push({ source: "acc-unallocated", target: targetId, value: remainder, color });
    }
  };

  // Accounts → Categories
  for (const [catId, total] of catSpend) {
    const cat = summary.categories.find(c => c.id === catId);
    if (!cat) continue;
    const catIdStr = `cat-${catId}`;
    addNode(catIdStr, cat.name, cat.color, 2);
    linkAccountsTo(catIdStr, cat.color, exp =>
      exp.categoryId === catId && !exp.isWithdrawal && exp.goalId == null,
    );
  }

  // Accounts → Goals
  for (const [goalId, total] of goalSpend) {
    const goal = allGoals.find(g => g.id === goalId);
    if (!goal) continue;
    const goalIdStr = `goal-${goalId}`;
    addNode(goalIdStr, goal.name, goal.color, 2);
    linkAccountsTo(goalIdStr, goal.color, exp =>
      exp.goalId === goalId && !exp.isWithdrawal,
    );
  }

  return { nodes, links };
}
