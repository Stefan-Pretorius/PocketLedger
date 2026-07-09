export type AccountType = "individual" | "joint";
export type PayFrequency = "weekly" | "fortnightly" | "monthly";

export interface Account {
  id: number;
  name: string;
  type: AccountType;
  balance?: number;
  accountNumber?: string;
  createdAt: string;
}

export interface Budget {
  id: number;
  name: string;
  month: number;
  year: number;
  startDay: number;
  totalIncome: number;
  /** Unallocated money carried forward from a previous period */
  carryoverAmount?: number;
  notes?: string;
  createdAt: string;
}

export interface BudgetSection {
  id: number;
  budgetId: number;
  name: string;
  color?: string;
  sortOrder: number;
  createdAt: string;
}

export interface Category {
  id: number;
  budgetId: number;
  name: string;
  allocatedAmount: number;
  /** How often the allocatedAmount applies — "monthly" (default), "fortnightly", or "weekly" */
  frequency?: "monthly" | "fortnightly" | "weekly";
  color: string;
  icon: string;
  createdAt: string;
  spent?: number;
  /** Round-up/savings categories don't consume budget — they track automatic savings transfers */
  isRounding?: boolean;
  /** Linked savings goal (envelope) — contributions auto-select this category, expenses in this category auto-suggest withdrawal */
  linkedGoalId?: number;
  /** Section this category belongs to (reference to BudgetSection.id) */
  sectionId?: number;
}

export interface Expense {
  id: number;
  /** The budget this expense belongs to, or null if unallocated */
  budgetId?: number;
  categoryId?: number;
  /** Bank account this expense was paid from */
  accountId?: number;
  description: string;
  amount: number;
  date: string;
  merchant?: string;
  notes?: string;
  importedFromBank: boolean;
  /** Links this expense to the ImportedStatement that created it */
  importId?: number;
  /** When set, this is a goal contribution (savings), not a budget expense */
  goalId?: number;
  /** When true, this is a withdrawal from a goal (reduces currentAmount) */
  isWithdrawal?: boolean;
  /** When set, this regular expense was funded from a goal envelope (record-keeping only, no balance change) */
  fundedByGoalId?: number;
  createdAt: string;
  categoryName?: string;
  categoryColor?: string;
}

export interface Goal {
  id: number;
  name: string;
  description?: string;
  targetAmount?: number;
  currentAmount: number;
  deadline?: string;
  color: string;
  icon: string;
  createdAt: string;
}

export interface RecurringExpense {
  id: number;
  description: string;
  amount: number;
  frequency: PayFrequency;
  /** Used when frequency is monthly (1–31) */
  dayOfMonth?: number;
  /** Used when frequency is weekly or fortnightly (0=Sun … 6=Sat) */
  dayOfWeek?: number;
  /** Used when frequency is fortnightly — a known payment date to anchor the cycle */
  anchorDate?: string;
  categoryName: string;
  /** Bank account this expense is paid from */
  accountId?: number;
  /** When set, this recurring template contributes to the goal envelope */
  goalId?: number;
  /** When set, this recurring template creates buy transactions on the holding */
  holdingId?: number;
  merchant?: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
}

export interface IncomeSource {
  id: number;
  budgetId: number;
  name: string;
  amount: number;
  frequency: "monthly" | "fortnightly";
  /** Bank account this income is deposited into */
  accountId?: number;
  createdAt: string;
}

export interface BankMappingRule {
  id: number;
  keyword: string;
  routeTo: "category" | "goal" | "goalWithdrawal" | "skip" | "holding" | "income" | "householdTransfer";
  categoryName?: string;
  goalId?: number;
  holdingId?: number;
  incomeSourceName?: string;
  /** When routeTo is "skip", optionally track this as a transfer to another account */
  transferToAccountId?: number;
  createdAt: string;
}

export type HoldingType = "crypto" | "etf" | "managed_fund" | "stock" | "super" | "other";

export interface Holding {
  id: number;
  name: string;
  symbol?: string;
  type: HoldingType;
  color: string;
  currentUnitPrice?: number;
  currency: string;
  owner?: "self" | "partner";
  /** Public blockchain wallet address for auto-importing balances */
  walletAddress?: string;
  notes?: string;
  createdAt: string;
}

export interface HoldingTransaction {
  id: number;
  holdingId: number;
  type: "buy" | "sell";
  units: number;
  pricePerUnit: number;
  fees: number;
  brokerage?: number;
  gst?: number;
  date: string;
  fillTime?: string;
  isDividend?: boolean;
  notes?: string;
  createdAt: string;
}

export interface HoldingSummary {
  holding: Holding;
  totalUnits: number;
  totalCostBasis: number;
  totalInvested: number;
  avgCostPerUnit: number;
  marketValue: number;
  unrealizedGainLoss: number;
  unrealizedGainLossPct: number;
  realizedGainLoss: number;
  transactions: HoldingTransaction[];
}

export interface PortfolioSummary {
  totalInvested: number;
  totalMarketValue: number;
  totalGainLoss: number;
  totalGainLossPct: number;
  holdingSummaries: HoldingSummary[];
}

export interface ScenarioConfig {
  id: number;
  name: string;
  owner?: "self" | "partner" | "joint";
  description?: string;
  /** Per-holding overrides. Omitted holdings use their default values from savedConfigs. */
  holdingOverrides: {
    holdingId: number;
    annualReturn?: number;
    monthlyContribution?: number;
    included?: boolean;
    /** Override market value for this scenario (e.g. to simulate buying more) */
    marketValueOverride?: number;
  }[];
  oneOffInvestments: { month: number; amount: number }[];
  createdAt: string;
  updatedAt: string;
}

export interface ImportedStatement {
  id: number;
  fileName: string;
  importedAt: string;
  budgetId: number;
  transactionCount: number;
  importedCount: number;
  skippedCount: number;
  goalContributions: number;
  totalAmount: number;
  budgetMonth: string;
  accountId?: number;
  endingBalance?: number;
  balanceDate?: string;
  driveFileId?: string;
  driveModifiedTime?: string;
}

export interface BudgetSummary {
  budget: Budget;
  categories: Category[];
  incomeSources: IncomeSource[];
  incomeFromSources: number;
  carryover: number;
  totalIncome: number;
  totalAllocated: number;
  totalSpent: number;
  /** Total of rounding/savings category expenses (excluded from totalSpent) */
  totalRoundingSaved: number;
  roundingCategories: Category[];
  uncategorizedTotal: number;
  unallocated: number;
  remaining: number;
}
