import { useMemo } from "react";
import { useStore } from "../store";
import { currentMonth, monthName } from "../utils";
import { cn } from "@/lib/utils";

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

interface Props {
  selectedYear: number;
  onSelectYear: (y: number) => void;
}

export function BudgetYearTabs({ selectedYear, onSelectYear }: Props) {
  const { budgets } = useStore();
  const cy = currentMonth().year;

  const years = useMemo(() => {
    const set = new Set<number>(budgets.map(b => b.year));
    set.add(cy);
    return Array.from(set).sort();
  }, [budgets, cy]);

  return (
    <div className="flex gap-1.5 flex-wrap">
      {years.map(y => (
        <button
          key={y}
          onClick={() => onSelectYear(y)}
          className={cn(
            "px-3 py-0.5 rounded-full text-xs font-semibold transition-colors border",
            y === selectedYear
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-foreground",
          )}
        >
          {y}
        </button>
      ))}
    </div>
  );
}

interface MonthGridProps {
  year: number;
  activeBudgetId: number | null;
  onSelect: (budgetId: number) => void;
  onCreateMonth?: (month: number, year: number) => void;
}

export function BudgetMonthGrid({ year, activeBudgetId, onSelect, onCreateMonth }: MonthGridProps) {
  const { budgets } = useStore();
  const cm = currentMonth();

  return (
    <div className="grid grid-cols-6 gap-1.5">
      {MONTH_SHORT.map((label, idx) => {
        const month = idx + 1;
        const budget = budgets.find(b => b.year === year && b.month === month);
        const isActive = budget?.id === activeBudgetId;
        const isCurrent = year === cm.year && month === cm.month;

        return (
          <button
            key={month}
            onClick={() => {
              if (budget) onSelect(budget.id);
              else onCreateMonth?.(month, year);
            }}
            className={cn(
              "relative flex items-center justify-center rounded-lg py-1 px-1 text-xs font-medium transition-all border gap-1",
              isActive
                ? "bg-primary text-primary-foreground border-primary shadow-sm"
                : budget
                  ? "bg-card text-foreground border-border hover:border-primary/50 hover:bg-primary/5"
                  : "bg-muted/30 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground",
            )}
          >
            {isCurrent && !isActive && (
              <span className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-primary" />
            )}
            <span>{label}</span>
            {!budget && onCreateMonth && (
              <span className="opacity-30 text-[9px]">+</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
