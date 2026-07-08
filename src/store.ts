import { create } from "zustand";
import type {
  Account, Budget, Category, Expense, Goal, RecurringExpense,
  IncomeSource, BankMappingRule, BudgetSummary,
  Holding, HoldingTransaction, HoldingSummary, PortfolioSummary,
  ImportedStatement,
} from "./types";
import { getBudgetDateRange, getRecurringDatesInMonth, monthlyIncomeAmount, monthlyCategoryAmount } from "./utils";
import { autoSaveToDir } from "./backup";
import { getStoredToken, getClientId, uploadToDrive } from "./googledrive";

export interface StoreData {
  accounts: Account[];
  budgets: Budget[];
  categories: Category[];
  expenses: Expense[];
  goals: Goal[];
  recurring: RecurringExpense[];
  incomeSources: IncomeSource[];
  bankRules: BankMappingRule[];
  holdings: Holding[];
  holdingTransactions: HoldingTransaction[];
  importedStatements: ImportedStatement[];
  budgetSections: BudgetSection[];
}

const STORAGE_KEY = "pocketledger_data";
let _idCounter = Date.now();
const nextId = () => ++_idCounter;
const now = () => new Date().toISOString();

let backupTimer: ReturnType<typeof setTimeout> | null = null;
function triggerBackups(data: StoreData) {
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    backupTimer = null;
    const json = JSON.stringify(data);
    autoSaveToDir(data).catch(() => {});
    const cid = getClientId();
    if (cid && getStoredToken()) {
      uploadToDrive(json, cid).catch(() => {});
    }
  }, 10000);
}

function load(): StoreData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { accounts: [], budgets: [], categories: [], expenses: [], goals: [], recurring: [], incomeSources: [], bankRules: [], holdings: [], holdingTransactions: [], importedStatements: [], budgetSections: [] };
}

function save(data: StoreData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  triggerBackups(data);
}

/** Find the budget whose date range covers the given date string (YYYY-MM-DD). */
function findBudgetForDate(date: string, budgets: Budget[]): Budget | undefined {
  return budgets.find(b => {
    const { startDate, endDate } = getBudgetDateRange(b);
    return date >= startDate && date <= endDate;
  });
}

function snapshot(s: AppState): StoreData {
  return {
    accounts: s.accounts,
    budgets: s.budgets, categories: s.categories, expenses: s.expenses,
    goals: s.goals, recurring: s.recurring, incomeSources: s.incomeSources,
    bankRules: s.bankRules, holdings: s.holdings, holdingTransactions: s.holdingTransactions,
    importedStatements: s.importedStatements, budgetSections: s.budgetSections,
  };
}

function computeBudgetIncome(budget: Budget, sources: IncomeSource[]): number {
  const fromSources = sources
    .filter(s => s.budgetId === budget.id)
    .reduce((sum, s) => sum + monthlyIncomeAmount(s.amount, s.frequency), 0);
  return fromSources + (budget.carryoverAmount ?? 0);
}

function syncBudgetIncome(budgetId: number, get: () => AppState, set: (partial: Partial<AppState>) => void) {
  const { budgets, incomeSources } = get();
  const budget = budgets.find(b => b.id === budgetId);
  if (!budget) return;
  const totalIncome = computeBudgetIncome(budget, incomeSources);
  if (budget.totalIncome === totalIncome) return;
  const updated = budgets.map(b => b.id === budgetId ? { ...b, totalIncome } : b);
  set({ budgets: updated });
  save({ ...snapshot(get()), budgets: updated });
}

export interface ImportedTransaction {
  description: string;
  merchant?: string;
  amount: number;
  date: string;
  isCredit?: true;
  balance?: number;
  categoryId: number | null;
  goalId: number | null;
  /** When set, this transaction withdraws from a goal (reduces currentAmount) */
  goalWithdrawalId?: number;
  skip: boolean;
  autoMatched: boolean;
  /** When set, this skipped transaction is an inter-account transfer */
  transferToAccountId?: number;
  /** When set, a HoldingTransaction (buy) will be created on import */
  holdingId?: number;
  /** When set, an IncomeSource is created/updated instead of an expense */
  incomeSourceName?: string;
  /** When set, the transaction is a household transfer — no expense created */
  isHouseholdTransfer?: boolean;
}

interface AppState extends StoreData {
  activeBudgetId: number | null;
  loading: boolean;

  init: () => void;
  setActiveBudget: (id: number | null) => void;
  getBudgetSummary: (budgetId: number) => BudgetSummary | null;
  getSuggestedCarryover: (budgetId: number) => number | null;

  createBudget: (b: Omit<Budget, "id" | "createdAt">) => Budget;
  updateBudget: (id: number, b: Partial<Budget>) => void;
  deleteBudget: (id: number) => void;

  createCategory: (c: Omit<Category, "id" | "createdAt">) => Category;
  updateCategory: (id: number, c: Partial<Category>) => void;
  deleteCategory: (id: number) => void;

  createBudgetSection: (s: Omit<BudgetSection, "id" | "createdAt">) => BudgetSection;
  updateBudgetSection: (id: number, s: Partial<BudgetSection>) => void;
  deleteBudgetSection: (id: number) => void;

  createExpense: (e: Omit<Expense, "id" | "createdAt">) => Expense;
  updateExpense: (id: number, e: Partial<Expense>) => void;
  deleteExpense: (id: number) => void;

  createGoal: (g: Omit<Goal, "id" | "createdAt">) => Goal;
  updateGoal: (id: number, g: Partial<Goal>) => void;
  deleteGoal: (id: number) => void;
  convertCategoryToGoal: (categoryId: number) => void;
  convertGoalToCategory: (goalId: number, budgetId: number) => void;

  createAccount: (a: Omit<Account, "id" | "createdAt">) => Account;
  updateAccount: (id: number, a: Partial<Account>) => void;
  deleteAccount: (id: number) => void;

  createRecurring: (r: Omit<RecurringExpense, "id" | "createdAt">) => RecurringExpense;
  updateRecurring: (id: number, r: Partial<RecurringExpense>) => void;
  deleteRecurring: (id: number) => void;
  applyRecurring: (budgetId: number) => { applied: number; skipped: number; unmatched: string[] };

  copyBudget: (
    sourceBudgetId: number,
    targetMonth: number,
    targetYear: number,
    applyRecurringAfter: boolean,
  ) => { budget: Budget; categoriesCopied: number; recurringResult: { applied: number; skipped: number; unmatched: string[] } | null };

  createIncomeSource: (i: Omit<IncomeSource, "id" | "createdAt">) => IncomeSource;
  updateIncomeSource: (id: number, i: Partial<IncomeSource>) => void;
  deleteIncomeSource: (id: number) => void;

  createBankRule: (r: Omit<BankMappingRule, "id" | "createdAt">) => BankMappingRule;
  upsertBankRule: (r: Omit<BankMappingRule, "id" | "createdAt">) => BankMappingRule;
  deleteBankRule: (id: number) => void;

  previewImport: (
    transactions: Array<{ description: string; merchant?: string; amount: number; date: string; isCredit?: true; balance?: number; transferToAccountId?: number }>,
    budgetId: number,
  ) => ImportedTransaction[];

  commitImport: (
    transactions: ImportedTransaction[],
    budgetId: number,
    fileName?: string,
    accountId?: number,
    endingBalanceOverride?: number,
    driveFileId?: string,
    driveModifiedTime?: string,
  ) => { imported: number; skipped: number; goalContributions: number; transferred: number };

  deleteImportedStatement: (id: number) => void;

  /** Returns a list of integrity issues found in the data */
  validateIntegrity: () => string[];
  /** Unsets importedFromBank on expenses with no matching statement */
  deleteOrphanedBankExpenses: () => number;

  // Holdings
  createHolding: (h: Omit<Holding, "id" | "createdAt">) => Holding;
  updateHolding: (id: number, h: Partial<Holding>) => void;
  deleteHolding: (id: number) => void;
  createHoldingTransaction: (t: Omit<HoldingTransaction, "id" | "createdAt">) => HoldingTransaction;
  updateHoldingTransaction: (id: number, patch: Partial<HoldingTransaction>) => void;
  deleteHoldingTransaction: (id: number) => void;
  getHoldingSummary: (holdingId: number) => HoldingSummary | null;
  getPortfolioSummary: () => PortfolioSummary;
  refreshPrice: (holdingId: number) => Promise<void>;
  refreshAllPrices: () => Promise<number>;
  /** Fetch balance from blockchain for a holding with a walletAddress */
  fetchWalletBalance: (holdingId: number) => Promise<void>;

  exportData: () => string;
  importData: (json: string) => void;
}

export const useStore = create<AppState>()((set, get) => ({
  accounts: [], budgets: [], categories: [], expenses: [], goals: [],
  recurring: [], incomeSources: [], bankRules: [], holdings: [], holdingTransactions: [],
  importedStatements: [],
  budgetSections: [],
  activeBudgetId: null, loading: true,

  init: () => {
    const data = load();
    let changed = false;

    // Default accounts for new installs
    let accounts = data.accounts ?? [];
    if (accounts.length === 0) {
      accounts = [
        { id: nextId(), name: "Personal", type: "individual", createdAt: now() },
        { id: nextId(), name: "Joint", type: "joint", createdAt: now() },
      ];
      changed = true;
    }

    // Migrate legacy budgets that stored income only in totalIncome
    const budgets = data.budgets.map(b => {
      const sources = data.incomeSources.filter(s => s.budgetId === b.id);
      if (sources.length === 0 && (b.carryoverAmount ?? 0) === 0 && b.totalIncome > 0) {
        changed = true;
        return { ...b, carryoverAmount: b.totalIncome };
      }
      return b;
    });

    // Migrate legacy recurring expenses (monthly-only, dayOfMonth field)
    const recurring = (data.recurring ?? []).map(r => {
      const legacy = r as RecurringExpense & { dayOfMonth?: number };
      if (legacy.frequency) return legacy;
      changed = true;
      return {
        ...legacy,
        frequency: "monthly" as const,
        dayOfMonth: legacy.dayOfMonth ?? 1,
      };
    });

    // Migrate legacy categories (no frequency field — default to monthly)
    const categories = (data.categories ?? []).map(c => {
      if (c.frequency) return c;
      changed = true;
      return { ...c, frequency: "monthly" as const };
    });

    // Clean up orphaned bank-imported expenses (importId doesn't match any statement)
    const stmtIds = new Set(data.importedStatements.map(s => s.id));
    let hadOrphans = false;
    const expenses = data.expenses.map(e => {
      if (e.importedFromBank && (e.importId == null || !stmtIds.has(e.importId))) {
        hadOrphans = true;
        return { ...e, importedFromBank: false };
      }
      return e;
    });
    if (hadOrphans) changed = true;

    const migrated = { ...data, budgetSections: data.budgetSections ?? [], accounts, budgets, categories, expenses, recurring, holdings: data.holdings ?? [], holdingTransactions: data.holdingTransactions ?? [], importedStatements: data.importedStatements ?? [] };
    if (changed) save(migrated);
    set({ ...migrated, activeBudgetId: budgets[0]?.id ?? null, loading: false });
  },

  setActiveBudget: (id) => set({ activeBudgetId: id }),

  getBudgetSummary: (budgetId) => {
    const { budgets, categories, expenses, incomeSources } = get();
    const budget = budgets.find(b => b.id === budgetId);
    if (!budget) return null;
    const { startDate, endDate } = getBudgetDateRange(budget);
    const budgetExpenses = expenses.filter(
      e => e.budgetId === budgetId && e.date >= startDate && e.date <= endDate && e.isWithdrawal !== true,
    );
    const sources = incomeSources.filter(s => s.budgetId === budgetId);
    const incomeFromSources = sources.reduce(
      (sum, s) => sum + monthlyIncomeAmount(s.amount, s.frequency), 0,
    );
    const carryover = budget.carryoverAmount ?? 0;
    const totalIncome = incomeFromSources + carryover;
    const cats = categories
      .filter(c => c.budgetId === budgetId)
      .map(c => ({
        ...c,
        spent: budgetExpenses.filter(e => e.categoryId === c.id).reduce((s, e) => s + e.amount, 0),
        isRounding: c.isRounding ?? false,
      }));
    const roundingCats = cats.filter(c => c.isRounding);
    const budgetCats = cats.filter(c => !c.isRounding);
    const totalRoundingSaved = roundingCats.reduce((s, c) => s + (c.spent ?? 0), 0);
    const totalAllocated = budgetCats.reduce((s, c) => s + monthlyCategoryAmount(c.allocatedAmount, c.frequency), 0);
    const totalSpent = budgetCats.reduce((s, c) => s + (c.spent ?? 0), 0);
    const uncategorizedTotal = budgetExpenses
      .filter(e => e.categoryId == null)
      .reduce((s, e) => s + e.amount, 0);
    return {
      budget,
      categories: cats,
      incomeSources: sources,
      incomeFromSources,
      carryover,
      totalIncome,
      totalAllocated,
      totalSpent,
      totalRoundingSaved,
      roundingCategories: roundingCats,
      uncategorizedTotal,
      unallocated: totalIncome - totalAllocated,
      remaining: totalIncome - (totalSpent + uncategorizedTotal),
    };
  },

  getSuggestedCarryover: (budgetId) => {
    const { budgets, importedStatements } = get();
    const current = budgets.find(b => b.id === budgetId);
    if (!current) return null;
    const sorted = [...budgets].sort((a, b) =>
      b.year !== a.year ? b.year - a.year :
        b.month !== a.month ? b.month - a.month :
          (b.startDay ?? 1) - (a.startDay ?? 1),
    );
    const idx = sorted.findIndex(b => b.id === budgetId);
    if (idx < 0 || idx >= sorted.length - 1) return null;
    const prev = sorted[idx + 1];
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
  },

  createBudget: (b) => {
    const budget: Budget = { ...b, id: nextId(), createdAt: now() };
    const budgets = [budget, ...get().budgets];
    set(s => ({ budgets, activeBudgetId: budget.id }));
    save({ ...snapshot(get()), budgets });
    return budget;
  },

  updateBudget: (id, b) => {
    set(s => ({ budgets: s.budgets.map(x => x.id === id ? { ...x, ...b } : x) }));
    save(snapshot(get()));
    syncBudgetIncome(id, get, set);
  },

  deleteBudget: (id) => {
    const { budgets } = get();
    const remaining = budgets.filter(x => x.id !== id);
    set(s => ({
      budgets: remaining,
      categories: s.categories.filter(x => x.budgetId !== id),
      expenses: s.expenses.filter(x => x.budgetId !== id),
      incomeSources: s.incomeSources.filter(x => x.budgetId !== id),
      activeBudgetId: s.activeBudgetId === id ? (remaining[0]?.id ?? null) : s.activeBudgetId,
    }));
    save(snapshot(get()));
  },

  createCategory: (c) => {
    const cat: Category = { ...c, id: nextId(), createdAt: now() };
    const categories = [...get().categories, cat];
    set({ categories });
    save({ ...snapshot(get()), categories });
    return cat;
  },

  updateCategory: (id, c) => {
    set(s => ({ categories: s.categories.map(x => x.id === id ? { ...x, ...c } : x) }));
    save(snapshot(get()));
  },

  deleteCategory: (id) => {
    set(s => ({
      categories: s.categories.filter(x => x.id !== id),
      expenses: s.expenses.filter(x => x.categoryId !== id),
    }));
    save(snapshot(get()));
  },

  createBudgetSection: (s) => {
    const sec: BudgetSection = { ...s, id: nextId(), createdAt: now() };
    const budgetSections = [...get().budgetSections, sec];
    set({ budgetSections });
    save({ ...snapshot(get()), budgetSections });
    return sec;
  },
  updateBudgetSection: (id, patch) => {
    set(s => ({ budgetSections: s.budgetSections.map(x => x.id === id ? { ...x, ...patch } : x) }));
    save(snapshot(get()));
  },
  deleteBudgetSection: (id) => {
    set(s => ({
      budgetSections: s.budgetSections.filter(x => x.id !== id),
      categories: s.categories.map(c => c.sectionId === id ? { ...c, sectionId: undefined } : c),
    }));
    save(snapshot(get()));
  },

  createExpense: (e) => {
    const exp: Expense = { ...e, id: nextId(), createdAt: now() };
    const expenses = [exp, ...get().expenses];
    set({ expenses });
    save({ ...snapshot(get()), expenses });
    return exp;
  },

  updateExpense: (id, e) => {
    set(s => ({ expenses: s.expenses.map(x => x.id === id ? { ...x, ...e } : x) }));
    save(snapshot(get()));
  },

  deleteExpense: (id) => {
    const exp = get().expenses.find(x => x.id === id);
    set(s => ({ expenses: s.expenses.filter(x => x.id !== id) }));
    if (exp?.goalId != null) {
      const goal = get().goals.find(g => g.id === exp.goalId);
      if (goal) {
        const adjustment = exp.isWithdrawal
          ? goal.currentAmount + exp.amount   // reverse withdrawal
          : Math.max(0, goal.currentAmount - exp.amount); // reverse contribution
        get().updateGoal(exp.goalId, { currentAmount: adjustment });
      }
    }
    save(snapshot(get()));
  },

  createGoal: (g) => {
    const goal: Goal = { ...g, id: nextId(), createdAt: now() };
    const goals = [...get().goals, goal];
    set({ goals });
    save({ ...snapshot(get()), goals });
    return goal;
  },

  updateGoal: (id, g) => {
    set(s => ({ goals: s.goals.map(x => x.id === id ? { ...x, ...g } : x) }));
    save(snapshot(get()));
  },

  deleteGoal: (id) => {
    set(s => ({ goals: s.goals.filter(x => x.id !== id) }));
    save(snapshot(get()));
  },

  convertCategoryToGoal: (categoryId) => {
    const cat = get().categories.find(c => c.id === categoryId);
    if (!cat) return;
    get().createGoal({
      name: cat.name,
      description: undefined,
      targetAmount: cat.allocatedAmount,
      currentAmount: 0,
      deadline: undefined,
      color: cat.color,
      icon: "target",
    });
    get().deleteCategory(categoryId);
  },

  convertGoalToCategory: (goalId, budgetId) => {
    const goal = get().goals.find(g => g.id === goalId);
    if (!goal) return;
    get().createCategory({
      budgetId,
      name: goal.name,
      allocatedAmount: goal.targetAmount,
      color: goal.color,
      icon: "wallet",
    });
    get().deleteGoal(goalId);
  },

  createAccount: (a) => {
    const account: Account = { ...a, id: nextId(), createdAt: now() };
    const accounts = [...get().accounts, account];
    set({ accounts });
    save({ ...snapshot(get()), accounts });
    return account;
  },

  updateAccount: (id, a) => {
    set(s => ({ accounts: s.accounts.map(x => x.id === id ? { ...x, ...a } : x) }));
    save(snapshot(get()));
  },

  deleteAccount: (id) => {
    set(s => ({
      accounts: s.accounts.filter(x => x.id !== id),
      expenses: s.expenses.map(e => e.accountId === id ? { ...e, accountId: undefined } : e),
      incomeSources: s.incomeSources.map(i => i.accountId === id ? { ...i, accountId: undefined } : i),
      recurring: s.recurring.map(r => r.accountId === id ? { ...r, accountId: undefined } : r),
    }));
    save(snapshot(get()));
  },

  createRecurring: (r) => {
    const rec: RecurringExpense = { ...r, id: nextId(), createdAt: now() };
    const recurring = [...get().recurring, rec];
    set({ recurring });
    save({ ...snapshot(get()), recurring });
    return rec;
  },

  updateRecurring: (id, r) => {
    set(s => ({ recurring: s.recurring.map(x => x.id === id ? { ...x, ...r } : x) }));
    save(snapshot(get()));
  },

  deleteRecurring: (id) => {
    set(s => ({ recurring: s.recurring.filter(x => x.id !== id) }));
    save(snapshot(get()));
  },

  applyRecurring: (budgetId) => {
    const { recurring, categories, expenses, budgets, goals, holdings } = get();
    const budget = budgets.find(b => b.id === budgetId);
    if (!budget) return { applied: 0, skipped: 0, unmatched: [] };

    const budgetCats = categories.filter(c => c.budgetId === budgetId);
    let applied = 0, skipped = 0;
    const unmatched: string[] = [];

    for (const rec of recurring) {
      if (!rec.isActive) continue;

      const dates = getRecurringDatesInMonth(budget.year, budget.month, rec);

      if (rec.goalId != null) {
        // Goal-linked recurring: create contribution expenses
        const goal = goals.find(g => g.id === rec.goalId);
        if (!goal) {
          unmatched.push(rec.description);
          continue;
        }
        for (const date of dates) {
          const alreadyExists = expenses.some(
            e => e.budgetId === budgetId &&
              e.goalId === goal.id &&
              e.description === rec.description &&
              e.date === date,
          );
          if (alreadyExists) { skipped++; continue; }
          get().createExpense({
            budgetId,
            description: rec.description,
            merchant: rec.merchant,
            amount: rec.amount,
            date,
            accountId: rec.accountId,
            notes: rec.notes,
            goalId: goal.id,
            importedFromBank: false,
          });
          get().updateGoal(goal.id, { currentAmount: goal.currentAmount + rec.amount });
          applied++;
        }
      } else {
        const cat = budgetCats.find(
          c => c.name.toLowerCase() === rec.categoryName.toLowerCase(),
        );
        if (!cat) {
          unmatched.push(rec.description);
          continue;
        }
        for (const date of dates) {
          const alreadyExists = expenses.some(
            e => e.budgetId === budgetId &&
              e.categoryId === cat.id &&
              e.description === rec.description &&
              e.date === date,
          );
          if (alreadyExists) { skipped++; continue; }

          get().createExpense({
            budgetId, categoryId: cat.id,
            description: rec.description,
            merchant: rec.merchant,
            amount: rec.amount,
            date,
            accountId: rec.accountId,
            notes: rec.notes,
            importedFromBank: false,
          });

          // If linked to a holding, create a buy transaction
          if (rec.holdingId != null) {
            const holding = holdings.find(h => h.id === rec.holdingId);
            if (holding && holding.currentUnitPrice != null && holding.currentUnitPrice > 0) {
              get().createHoldingTransaction({
                holdingId: rec.holdingId,
                type: "buy",
                units: rec.amount / holding.currentUnitPrice,
                pricePerUnit: holding.currentUnitPrice,
                fees: 0,
                date,
                isDividend: false,
              });
            }
          }

          applied++;
        }
      }
    }
    return { applied, skipped, unmatched };
  },

  copyBudget: (sourceBudgetId, targetMonth, targetYear, applyRecurringAfter) => {
    const { budgets, categories } = get();
    const source = budgets.find(b => b.id === sourceBudgetId);
    if (!source) throw new Error("Source budget not found");

    // Create the new budget
    const newBudget: Budget = {
      ...source,
      id: nextId(),
      month: targetMonth,
      year: targetYear,
      createdAt: now(),
    };
    const updatedBudgets = [newBudget, ...get().budgets];
    set(s => ({ budgets: updatedBudgets, activeBudgetId: newBudget.id }));
    save({ ...snapshot(get()), budgets: updatedBudgets });

    // Copy categories
    const sourceCats = categories.filter(c => c.budgetId === sourceBudgetId);
    for (const cat of sourceCats) {
      get().createCategory({
        budgetId: newBudget.id,
        name: cat.name,
        allocatedAmount: cat.allocatedAmount,
        color: cat.color,
        icon: cat.icon,
        isRounding: cat.isRounding,
        frequency: cat.frequency,
        sectionId: cat.sectionId,
        linkedGoalId: cat.linkedGoalId,
      });
    }

    // Copy income sources
    const sourceIncome = get().incomeSources.filter(i => i.budgetId === sourceBudgetId);
    for (const inc of sourceIncome) {
      get().createIncomeSource({
        budgetId: newBudget.id,
        name: inc.name,
        amount: inc.amount,
        frequency: inc.frequency,
      });
    }
    syncBudgetIncome(newBudget.id, get, set);

    // Optionally apply recurring templates
    let recurringResult = null;
    if (applyRecurringAfter) {
      recurringResult = get().applyRecurring(newBudget.id);
    }

    return { budget: newBudget, categoriesCopied: sourceCats.length, recurringResult };
  },

  createIncomeSource: (i) => {
    const inc: IncomeSource = { ...i, id: nextId(), createdAt: now() };
    const incomeSources = [...get().incomeSources, inc];
    set({ incomeSources });
    save({ ...snapshot(get()), incomeSources });
    syncBudgetIncome(i.budgetId, get, set);
    return inc;
  },

  updateIncomeSource: (id, i) => {
    const existing = get().incomeSources.find(x => x.id === id);
    set(s => ({ incomeSources: s.incomeSources.map(x => x.id === id ? { ...x, ...i } : x) }));
    save(snapshot(get()));
    if (existing) syncBudgetIncome(existing.budgetId, get, set);
  },

  deleteIncomeSource: (id) => {
    const existing = get().incomeSources.find(x => x.id === id);
    set(s => ({ incomeSources: s.incomeSources.filter(x => x.id !== id) }));
    save(snapshot(get()));
    if (existing) syncBudgetIncome(existing.budgetId, get, set);
  },

  createBankRule: (r) => {
    const rule: BankMappingRule = { ...r, id: nextId(), createdAt: now() };
    const bankRules = [...get().bankRules, rule];
    set({ bankRules });
    save({ ...snapshot(get()), bankRules });
    return rule;
  },

  upsertBankRule: (r) => {
    const { bankRules } = get();
    const kw = r.keyword.toLowerCase().trim();
    const existing = bankRules.find(x => x.keyword.toLowerCase() === kw);
    if (existing) {
      const updated = bankRules.map(x => x.id === existing.id ? { ...x, ...r, keyword: kw } : x);
      set({ bankRules: updated });
      save({ ...snapshot(get()), bankRules: updated });
      return { ...existing, ...r, keyword: kw };
    }
    const rule: BankMappingRule = { ...r, keyword: kw, id: nextId(), createdAt: now() };
    const updated = [...bankRules, rule];
    set({ bankRules: updated });
    save({ ...snapshot(get()), bankRules: updated });
    return rule;
  },

  deleteBankRule: (id) => {
    set(s => ({ bankRules: s.bankRules.filter(x => x.id !== id) }));
    save(snapshot(get()));
  },

  previewImport: (transactions, budgetId) => {
    const { bankRules, categories, expenses, goals, holdings } = get();
    const budgetCategories = categories.filter(c => c.budgetId === budgetId);

    return transactions
      .filter(tx => tx.amount > 0)
      .map(tx => {
        const isDuplicate = expenses.some(
          e => e.importedFromBank && e.budgetId === budgetId && e.description === tx.description && e.date === tx.date && e.amount === tx.amount,
        );
        if (isDuplicate) {
          return { ...tx, categoryId: null, goalId: null, goalWithdrawalId: undefined, skip: true, autoMatched: false };
        }

        const desc = tx.description.toLowerCase();
        let matchedCategoryId: number | null = null;
        let matchedGoalId: number | null = null;
        let matchedGoalWithdrawalId: number | undefined;
        let matchedSkip = false;
        let matchedTransferId: number | undefined;
        let matchedHoldingId: number | undefined;
        let matchedIncomeSourceName: string | undefined;
        let matchedHouseholdTransfer = false;

        // Helper: check bank rules and return match result
        // Skip & householdTransfer are fallbacks — higher-priority rules (goal, goalWithdrawal, category, holding, income) take precedence
        const matchRules = (): boolean => {
          let skipFallback: { matched: true; transferId?: number } | undefined;
          let householdFallback = false;
          for (const rule of bankRules) {
            if (!desc.includes(rule.keyword.toLowerCase())) continue;
            if (rule.routeTo === "skip") { skipFallback = { matched: true, transferId: rule.transferToAccountId }; continue; }
            if (rule.routeTo === "householdTransfer") { householdFallback = true; continue; }
            if (rule.routeTo === "goal" && rule.goalId != null) {
              const goal = goals.find(g => g.id === rule.goalId);
              if (goal) { matchedGoalId = goal.id; return true; }
            } else if (rule.routeTo === "goalWithdrawal" && rule.goalId != null) {
              const goal = goals.find(g => g.id === rule.goalId);
              if (goal) { matchedGoalWithdrawalId = goal.id; return true; }
            } else if (rule.routeTo === "category" && rule.categoryName) {
              const cat = budgetCategories.find(
                c => c.name.toLowerCase() === rule.categoryName!.toLowerCase(),
              );
              if (cat) { matchedCategoryId = cat.id; return true; }
            } else if (rule.routeTo === "holding" && rule.holdingId != null) {
              const holding = holdings.find(h => h.id === rule.holdingId);
              if (holding) { matchedHoldingId = holding.id; return true; }
            } else if (rule.routeTo === "income" && rule.incomeSourceName) {
              matchedIncomeSourceName = rule.incomeSourceName; return true;
            }
          }
          if (skipFallback) { matchedSkip = true; matchedTransferId = skipFallback.transferId; }
          if (householdFallback) { matchedHouseholdTransfer = true; }
          return skipFallback != null || householdFallback;
        };

        // Credit transactions are default-skipped (they're income/transfers, not expenses)
        const isCredit = tx.isCredit;
        if (isCredit) {
          const matched = matchRules();
          const hasTransfer = matchedTransferId != null;
          return {
            ...tx,
            categoryId: matchedCategoryId,
            goalId: matchedGoalId,
            goalWithdrawalId: matchedGoalWithdrawalId,
            skip: hasTransfer ? false : (!matched || (matchedSkip && !matchedHouseholdTransfer)),
            autoMatched: matched,
            transferToAccountId: matchedTransferId,
            holdingId: matchedHoldingId,
            incomeSourceName: matchedIncomeSourceName,
            isHouseholdTransfer: matchedHouseholdTransfer,
          };
        }

        // Auto-detect round-up / savings-transfer transactions
        const isRoundUp = /\bround[\s-]?up\b/i.test(desc);
        if (isRoundUp) {
          const roundCat = budgetCategories.find(c => c.isRounding);
          if (roundCat) { matchedCategoryId = roundCat.id; }
        }

        // Check bank mapping rules (skip if already matched as round-up)
        if (matchedCategoryId === null && matchedGoalId === null) {
          matchRules();
        }

        const autoMatched = matchedCategoryId !== null || matchedGoalId !== null || matchedGoalWithdrawalId != null || matchedSkip || matchedHoldingId != null || matchedIncomeSourceName != null || matchedHouseholdTransfer;
        return {
          ...tx,
          categoryId: matchedCategoryId,
          goalId: matchedGoalId,
          goalWithdrawalId: matchedGoalWithdrawalId,
          skip: matchedSkip && !matchedTransferId,
          autoMatched,
          transferToAccountId: matchedTransferId,
          holdingId: matchedHoldingId,
          incomeSourceName: matchedIncomeSourceName,
          isHouseholdTransfer: matchedHouseholdTransfer,
        };
      });
  },

  commitImport: (transactions, budgetId, fileName, accountId, endingBalanceOverride, driveFileId, driveModifiedTime) => {
    const { accounts, budgets } = get();
    let imported = 0, skipped = 0, goalContributions = 0, transferred = 0, goalWithdrawalCount = 0;
    let totalAmount = 0;

    // Generate statement ID upfront so we can link expenses to it
    const stmtId = fileName ? nextId() : undefined;

    // Pre-pass: pair goal withdrawals with merchant transactions on same date + similar amount
    const pairedWithdrawals = new Set<number>(); // indices of withdrawal transactions that are paired
    const merchantToWithdrawal = new Map<number, number>(); // merchant index -> withdrawal goalId
    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      if (tx.goalWithdrawalId == null || tx.skip) continue;
      // Search for a matching merchant transaction (same date, amount within 10% tolerance)
      for (let j = 0; j < transactions.length; j++) {
        if (i === j) continue;
        const m = transactions[j];
        if (m.skip || m.isHouseholdTransfer || m.isCredit || m.transferToAccountId != null || m.incomeSourceName != null || m.holdingId != null || m.goalId != null || m.goalWithdrawalId != null) continue;
        if (m.date !== tx.date) continue;
        const ratio = Math.abs(m.amount - tx.amount) / Math.max(m.amount, tx.amount);
        if (ratio > 0.1) continue; // within 10% tolerance
        pairedWithdrawals.add(i);
        merchantToWithdrawal.set(j, tx.goalWithdrawalId);
        break;
      }
    }

    for (let i = 0; i < transactions.length; i++) {
      const tx = transactions[i];
      // Find the budget that covers this transaction's date
      const dateBudget = findBudgetForDate(tx.date, budgets);
      const txBudgetId = dateBudget?.id;

      // Household transfer: no expense created, just count it
      if (tx.isHouseholdTransfer) {
        transferred++;
        totalAmount += tx.amount;
        continue;
      }

      // Inter-account transfer: create debit (source) + credit (destination)
      if (tx.transferToAccountId != null && accountId != null) {
        const destAccount = accounts.find(a => a.id === tx.transferToAccountId);
        const srcAccount = accounts.find(a => a.id === accountId);
        const destName = destAccount?.name ?? "Other Account";
        const srcName = srcAccount?.name ?? "Source";
        // Debit on source account
        get().createExpense({
          budgetId: txBudgetId,
          description: `${tx.description} → ${destName}`,
          amount: tx.amount,
          date: tx.date,
          merchant: tx.merchant,
          accountId,
          importedFromBank: true,
          importId: stmtId,
        });
        // Credit on destination account (negative amount = money in)
        get().createExpense({
          budgetId: txBudgetId,
          description: `${tx.description} (from ${srcName})`,
          amount: -tx.amount,
          date: tx.date,
          merchant: tx.merchant,
          accountId: tx.transferToAccountId,
          importedFromBank: true,
          importId: stmtId,
        });
        imported++;
        totalAmount += tx.amount;
        continue;
      }

      // Transfer without an import account — fall back to plain skip
      if (tx.transferToAccountId != null && accountId == null) {
        skipped++;
        continue;
      }

      if (tx.skip) { skipped++; continue; }

      // Income transaction: create/update income source instead of expense
      if (tx.incomeSourceName != null) {
        const existingInc = get().incomeSources.find(
          s => s.budgetId === txBudgetId && s.name.toLowerCase() === tx.incomeSourceName!.toLowerCase(),
        );
        if (existingInc) {
          get().updateIncomeSource(existingInc.id, { amount: existingInc.amount + tx.amount });
        } else if (txBudgetId != null) {
          get().createIncomeSource({
            budgetId: txBudgetId,
            name: tx.incomeSourceName,
            amount: tx.amount,
            frequency: "monthly",
          });
        }
        imported++;
        totalAmount += tx.amount;
        continue;
      }

      // Paired goal withdrawal: adjust goal balance silently, no expense created
      if (tx.goalWithdrawalId != null && pairedWithdrawals.has(i)) {
        const goal = get().goals.find(g => g.id === tx.goalWithdrawalId);
        if (goal) {
          get().updateGoal(tx.goalWithdrawalId, { currentAmount: Math.max(0, goal.currentAmount - tx.amount) });
          goalWithdrawalCount++;
          // Don't create a separate expense — the merchant will get fundedByGoalId
        }
        continue;
      }

      // Unpaired goal withdrawal: create isWithdrawal expense
      if (tx.goalWithdrawalId != null) {
        const goal = get().goals.find(g => g.id === tx.goalWithdrawalId);
        if (goal) {
          get().updateGoal(tx.goalWithdrawalId, { currentAmount: Math.max(0, goal.currentAmount - tx.amount) });
          get().createExpense({
            budgetId: txBudgetId,
            categoryId: tx.categoryId ?? undefined,
            description: tx.description,
            amount: tx.amount,
            date: tx.date,
            merchant: tx.merchant,
            goalId: tx.goalWithdrawalId,
            isWithdrawal: true,
            importedFromBank: true,
            importId: stmtId,
          });
          goalWithdrawalCount++;
          imported++;
        } else {
          skipped++;
        }
      } else if (tx.goalId !== null) {
        const goal = get().goals.find(g => g.id === tx.goalId);
        if (goal) {
          get().updateGoal(tx.goalId, { currentAmount: goal.currentAmount + tx.amount });
          get().createExpense({
            budgetId: txBudgetId,
            description: tx.description,
            amount: tx.amount,
            date: tx.date,
            merchant: tx.merchant,
            categoryId: tx.categoryId ?? undefined,
            goalId: tx.goalId,
            importedFromBank: true,
            importId: stmtId,
          });
          goalContributions++;
          imported++;
        } else {
          skipped++;
        }
      } else {
        // Merchant expense: check if paired with a withdrawal
        const fundedByGoalId = merchantToWithdrawal.get(i) ?? undefined;
        get().createExpense({
          budgetId: txBudgetId,
          categoryId: tx.categoryId ?? undefined,
          description: tx.description,
          merchant: tx.merchant,
          amount: tx.amount,
          date: tx.date,
          importedFromBank: true,
          importId: stmtId,
          fundedByGoalId,
        });
        imported++;
      }

      // Holding transaction: create a buy transaction alongside the expense
      if (tx.holdingId != null) {
        const holding = get().holdings.find(h => h.id === tx.holdingId);
        if (holding && holding.currentUnitPrice != null && holding.currentUnitPrice > 0) {
          get().createHoldingTransaction({
            holdingId: holding.id,
            type: "buy",
            units: tx.amount / holding.currentUnitPrice,
            pricePerUnit: holding.currentUnitPrice,
            fees: 0,
            date: tx.date,
            notes: `Imported from ${fileName ?? "bank statement"}`,
          });
        }
      }
      if (!tx.skip) totalAmount += tx.amount;
    }

    // Auto-update account balance from the last transaction's running balance (or explicit override)
    let endingBalance: number | undefined;
    let balanceDate: string | undefined;
    if (accountId != null) {
      if (endingBalanceOverride != null) {
        endingBalance = endingBalanceOverride;
        const lastTx = [...transactions].sort((a, b) => a.date.localeCompare(b.date)).pop();
        balanceDate = lastTx?.date;
        get().updateAccount(accountId, { balance: endingBalance });
      } else {
        const withBalance = transactions
          .filter(t => t.balance != null && !t.skip && !t.isHouseholdTransfer)
          .sort((a, b) => a.date.localeCompare(b.date));
        const last = withBalance[withBalance.length - 1];
        if (last?.balance != null) {
          endingBalance = last.balance;
          balanceDate = last.date;
          get().updateAccount(accountId, { balance: endingBalance });
        }
      }
    }

    // Record the import statement
    if (fileName && stmtId != null) {
      const budget = get().budgets.find(b => b.id === budgetId);
      const stmt: ImportedStatement = {
        id: stmtId,
        fileName,
        importedAt: now(),
        budgetId,
        transactionCount: transactions.filter(t => !t.skip).length,
        importedCount: imported,
        skippedCount: skipped,
        goalContributions,
        totalAmount,
        budgetMonth: budget ? `${budget.name} ${budget.month}/${budget.year}` : "",
        accountId: accountId ?? undefined,
        endingBalance,
        balanceDate,
        driveFileId,
        driveModifiedTime,
      };
      const importedStatements = [...get().importedStatements, stmt];
      set({ importedStatements });
      save({ ...snapshot(get()), importedStatements });
    }

    return { imported, skipped, goalContributions, transferred, goalWithdrawalCount };

  // ─── Goal withdrawal helpers (used by ExpenseModal & goals page) ──────────────
  },

  deleteImportedStatement: (id) => {
    // Remove all expenses linked to this import
    const remainingExpenses = get().expenses.filter(e => e.importId !== id);
    // Unset importedFromBank on orphaned bank expenses (e.g. old data before importId existed)
    const stmtIds = new Set(get().importedStatements.filter(s => s.id !== id).map(s => s.id));
    const cleaned = remainingExpenses.map(e =>
      e.importedFromBank && (e.importId == null || !stmtIds.has(e.importId))
        ? { ...e, importedFromBank: false }
        : e,
    );
    set({ expenses: cleaned });
    // Remove the statement record
    const remainingStmts = get().importedStatements.filter(s => s.id !== id);
    set({ importedStatements: remainingStmts });
    save({ ...snapshot(get()), expenses: cleaned, importedStatements: remainingStmts });
  },

  validateIntegrity: () => {
    const s = get();
    const issues: string[] = [];
    const budgetIds = new Set(s.budgets.map(b => b.id));
    const catIds = new Set(s.categories.map(c => c.id));
    const goalIds = new Set(s.goals.map(g => g.id));
    const accountIds = new Set(s.accounts.map(a => a.id));
    const stmtIds = new Set(s.importedStatements.map(st => st.id));
    const holdingIds = new Set(s.holdings.map(h => h.id));

    for (const e of s.expenses) {
      if (e.budgetId != null && !budgetIds.has(e.budgetId)) issues.push(`Expense ${e.id} references deleted budget ${e.budgetId}`);
      if (e.categoryId != null && !catIds.has(e.categoryId)) issues.push(`Expense ${e.id} references deleted category ${e.categoryId}`);
      if (e.goalId != null && !goalIds.has(e.goalId)) issues.push(`Expense ${e.id} references deleted goal ${e.goalId}`);
      if (e.accountId != null && !accountIds.has(e.accountId)) issues.push(`Expense ${e.id} references deleted account ${e.accountId}`);
      if (e.importedFromBank && (e.importId == null || !stmtIds.has(e.importId))) issues.push(`Expense ${e.id} has orphaned bank flag (no matching statement)`);
    }
    for (const c of s.categories) {
      if (!budgetIds.has(c.budgetId)) issues.push(`Category ${c.id} ("${c.name}") references deleted budget ${c.budgetId}`);
    }
    for (const src of s.incomeSources) {
      if (!budgetIds.has(src.budgetId)) issues.push(`IncomeSource ${src.id} references deleted budget ${src.budgetId}`);
    }
    for (const stmt of s.importedStatements) {
      if (!budgetIds.has(stmt.budgetId)) issues.push(`ImportedStatement ${stmt.id} references deleted budget ${stmt.budgetId}`);
      if (stmt.accountId != null && !accountIds.has(stmt.accountId)) issues.push(`ImportedStatement ${stmt.id} references deleted account ${stmt.accountId}`);
    }
    for (const tx of s.holdingTransactions) {
      if (!holdingIds.has(tx.holdingId)) issues.push(`HoldingTransaction ${tx.id} references deleted holding ${tx.holdingId}`);
    }
    return issues;
  },

  deleteOrphanedBankExpenses: () => {
    const stmtIds = new Set(get().importedStatements.map(s => s.id));
    let count = 0;
    const cleaned = get().expenses.map(e => {
      if (e.importedFromBank && (e.importId == null || !stmtIds.has(e.importId))) {
        count++;
        return { ...e, importedFromBank: false };
      }
      return e;
    });
    if (count > 0) {
      set({ expenses: cleaned });
      save({ ...snapshot(get()), expenses: cleaned });
    }
    return count;
  },

  createHolding: (h) => {
    const holding: Holding = { ...h, id: nextId(), createdAt: now() };
    const holdings = [...get().holdings, holding];
    set({ holdings });
    save({ ...snapshot(get()), holdings });
    return holding;
  },

  updateHolding: (id, h) => {
    set(s => ({ holdings: s.holdings.map(x => x.id === id ? { ...x, ...h } : x) }));
    save(snapshot(get()));
  },

  deleteHolding: (id) => {
    set(s => ({
      holdings: s.holdings.filter(x => x.id !== id),
      holdingTransactions: s.holdingTransactions.filter(x => x.holdingId !== id),
    }));
    save(snapshot(get()));
  },

  createHoldingTransaction: (t) => {
    const tx: HoldingTransaction = { ...t, id: nextId(), createdAt: now() };
    const holdingTransactions = [...get().holdingTransactions, tx];
    set({ holdingTransactions });
    save({ ...snapshot(get()), holdingTransactions });
    return tx;
  },

  updateHoldingTransaction: (id, patch) => {
    set(s => ({
      holdingTransactions: s.holdingTransactions.map(x => x.id === id ? { ...x, ...patch } : x),
    }));
    save(snapshot(get()));
  },

  deleteHoldingTransaction: (id) => {
    set(s => ({ holdingTransactions: s.holdingTransactions.filter(x => x.id !== id) }));
    save(snapshot(get()));
  },

  getHoldingSummary: (holdingId) => {
    const { holdings, holdingTransactions } = get();
    const holding = holdings.find(h => h.id === holdingId);
    if (!holding) return null;
    const txs = holdingTransactions
      .filter(t => t.holdingId === holdingId)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

    // FIFO cost tracking
    const buyQueue: { units: number; price: number; fees: number; date: string }[] = [];
    let totalInvested = 0;
    let totalProceeds = 0;
    let costOfSold = 0;

    for (const tx of txs) {
      if (tx.type === "buy") {
        buyQueue.push({ units: tx.units, price: tx.pricePerUnit, fees: tx.fees, date: tx.date });
        totalInvested += tx.units * tx.pricePerUnit + tx.fees;
      } else {
        let remaining = tx.units;
        totalProceeds += tx.units * tx.pricePerUnit - tx.fees;
        while (remaining > 0.0001 && buyQueue.length > 0) {
          const lot = buyQueue[0];
          const used = Math.min(remaining, lot.units);
          costOfSold += used * lot.price + (used / lot.units) * lot.fees;
          lot.units -= used;
          remaining -= used;
          if (lot.units < 0.0001) buyQueue.shift();
        }
      }
    }

    const totalUnits = buyQueue.reduce((s, lot) => s + lot.units, 0);
    const totalCostBasis = buyQueue.reduce((s, lot) => s + lot.units * lot.price + lot.fees, 0);
    const avgCostPerUnit = totalUnits > 0 ? totalCostBasis / totalUnits : 0;

    // If no transactions exist but a unit/share price is set, treat it as a lump-sum total value
    // (useful for super, or any holding where the user just sets a balance directly)
    const hasLumpSum = totalUnits === 0 && holding.currentUnitPrice != null && holding.currentUnitPrice > 0;
    const marketValue = hasLumpSum
      ? holding.currentUnitPrice
      : totalUnits > 0 && holding.currentUnitPrice != null
        ? totalUnits * holding.currentUnitPrice
        : 0;
    const lumpSumCost = hasLumpSum ? holding.currentUnitPrice : 0;
    const unrealizedGainLoss = marketValue - (hasLumpSum ? lumpSumCost : totalCostBasis);
    const unrealizedGainLossPct = (hasLumpSum ? lumpSumCost : totalCostBasis) > 0
      ? (unrealizedGainLoss / (hasLumpSum ? lumpSumCost : totalCostBasis)) * 100 : 0;
    const realizedGainLoss = totalProceeds - costOfSold;

    return {
      holding,
      totalUnits,
      totalCostBasis,
      totalInvested: totalInvested + lumpSumCost,
      avgCostPerUnit,
      marketValue,
      unrealizedGainLoss,
      unrealizedGainLossPct,
      realizedGainLoss,
      transactions: txs,
    };
  },

  getPortfolioSummary: () => {
    const { holdings } = get();
    const summaries = holdings
      .map(h => get().getHoldingSummary(h.id))
      .filter((s): s is HoldingSummary => s !== null);
    const totalInvested = summaries.reduce((s, h) => s + h.totalInvested, 0);
    const totalMarketValue = summaries.reduce((s, h) => s + h.marketValue, 0);
    const totalGainLoss = totalMarketValue - totalInvested;
    const totalGainLossPct = totalInvested > 0 ? (totalGainLoss / totalInvested) * 100 : 0;
    return { totalInvested, totalMarketValue, totalGainLoss, totalGainLossPct, holdingSummaries: summaries };
  },

  refreshPrice: async (holdingId) => {
    const { holdings } = get();
    const h = holdings.find(x => x.id === holdingId);
    if (!h?.symbol) return;
    const sym = h.symbol.trim().toUpperCase();
    try {
      let price: number | null = null;

      if (h.type === "crypto") {
        // Common crypto ticker → CoinGecko ID mapping
        const tickerMap: Record<string, string> = {
          BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "ripple",
          ADA: "cardano", DOT: "polkadot", AVAX: "avalanche-2", MATIC: "matic-network",
          LINK: "chainlink", UNI: "uniswap", ATOM: "cosmos", ALGO: "algorand",
          DOGE: "dogecoin", SHIB: "shiba-inu", LTC: "litecoin", BCH: "bitcoin-cash",
          XLM: "stellar", FTM: "fantom", NEAR: "near", HBAR: "hedera-hashgraph",
        };
        const coinId = tickerMap[sym] ?? sym.toLowerCase();
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=aud`);
        if (res.ok) {
          const data = await res.json();
          price = data[coinId]?.aud ?? null;
        }
        // Fallback: try Binance (USDT pair), then convert to AUD
        if (price == null) {
          const binRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}USDT`);
          if (binRes.ok) {
            const binData = await binRes.json();
            const usdtPrice = parseFloat(binData.price);
            if (!isNaN(usdtPrice) && usdtPrice > 0) {
              const audRes = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
              if (audRes.ok) {
                const audData = await audRes.json();
                price = usdtPrice * (audData.rates?.AUD ?? 1);
              }
            }
          }
        }
      } else {
        // Try with the symbol as-is (US stocks), then try .AX (ASX)
        const suffixes = sym.includes(".") ? [sym] : [sym, `${sym}.AX`];
        for (const ys of suffixes) {
          const res = await fetch(`/api/yahoo/v8/finance/chart/${ys}?interval=1d&range=1d`);
          if (res.ok) {
            const data = await res.json();
            const quote = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
            if (quote != null && quote > 0) { price = quote; break; }
          }
        }
      }

      if (price != null && price > 0) {
        get().updateHolding(holdingId, { currentUnitPrice: price });
      }
    } catch {
      // silently fail
    }
  },

  refreshAllPrices: async () => {
    const { holdings } = get();
    const withSymbols = holdings.filter(h => h.symbol);
    let ok = 0;
    for (const h of withSymbols) {
      await get().refreshPrice(h.id);
      ok++;
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    }
    return ok;
  },

  fetchWalletBalance: async (holdingId) => {
    const { holdings } = get();
    const h = holdings.find(x => x.id === holdingId);
    if (!h?.walletAddress) return;
    const addr = h.walletAddress.trim();
    try {
      let balanceRaw: number | null = null;
      let decimals = 18;

      // Detect chain by address prefix
      if (addr.startsWith("1") || addr.startsWith("bc1") || addr.startsWith("3")) {
        // Bitcoin via blockchain.info
        const res = await fetch(`https://blockchain.info/q/addressbalance/${addr}`);
        if (res.ok) {
          const text = await res.text();
          balanceRaw = parseInt(text, 10);
          decimals = 8;
        }
      } else if (addr.startsWith("0x")) {
        // Ethereum / ERC-20 via Etherscan
        const res = await fetch(`https://api.etherscan.io/api?module=account&action=balance&address=${addr}&tag=latest`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === "1" && data.result != null) {
            balanceRaw = parseFloat(data.result);
          }
        }
      }

      if (balanceRaw != null && balanceRaw > 0) {
        const units = balanceRaw / Math.pow(10, decimals);
        // Set the balance as units via a buy transaction
        get().createHoldingTransaction({
          holdingId,
          type: "buy",
          units,
          pricePerUnit: h.currentUnitPrice ?? 0,
          fees: 0,
          date: new Date().toISOString().split("T")[0],
          notes: "Imported from blockchain wallet",
        });
      }
    } catch {
      // silently fail
    }
  },

  exportData: () => {
    const s = get();
    return JSON.stringify({
      accounts: s.accounts,
      budgets: s.budgets, categories: s.categories, expenses: s.expenses,
      goals: s.goals, recurring: s.recurring, incomeSources: s.incomeSources,
      bankRules: s.bankRules, holdings: s.holdings, holdingTransactions: s.holdingTransactions,
      importedStatements: s.importedStatements,
      budgetSections: s.budgetSections,
      exportedAt: now(),
    }, null, 2);
  },

  importData: (json) => {
    const data = JSON.parse(json) as StoreData;
    const imported: StoreData = {
      accounts: data.accounts ?? [],
      budgets: data.budgets ?? [],
      categories: data.categories ?? [],
      expenses: data.expenses ?? [],
      goals: data.goals ?? [],
      recurring: (data.recurring ?? []).map(r => ({
        ...r,
        frequency: r.frequency ?? "monthly",
        dayOfMonth: r.dayOfMonth ?? 1,
      })),
      incomeSources: data.incomeSources ?? [],
      bankRules: data.bankRules ?? [],
      holdings: data.holdings ?? [],
      holdingTransactions: data.holdingTransactions ?? [],
      importedStatements: data.importedStatements ?? [],
      budgetSections: data.budgetSections ?? [],
    };
    if (imported.accounts.length === 0) {
      imported.accounts = [
        { id: nextId(), name: "Personal", type: "individual", createdAt: now() },
        { id: nextId(), name: "Joint", type: "joint", createdAt: now() },
      ];
    }
    set({ ...imported, activeBudgetId: imported.budgets[0]?.id ?? null });
    save(imported);
  },
}));
