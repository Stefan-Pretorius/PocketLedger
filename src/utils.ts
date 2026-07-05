export function formatCurrency(amount: number): string {
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

import type { Budget, PayFrequency, RecurringExpense } from "./types";

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
