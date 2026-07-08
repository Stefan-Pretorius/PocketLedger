## Goal
Build a personal finance tracker with budgeting, statement import, goals, recurring expenses, dashboard, investments, and projection tools.

## Constraints & Preferences
- Vite v8 builds with zero errors
- `showDirectoryPicker()` for local folder import (no OAuth needed)
- Categories grouped into user-defined `BudgetSection` entities
- Budget date range uses `startDay` (e.g. 15 Jun → 14 Jul)
- Dashboard spending chart toggles "By Category" / "By Section"
- CSV parser detects `balance`/`running balance` column for auto-updating account balance
- Category frequency (weekly/fortnightly/monthly) normalized to monthly equivalent in all views
- Goal-linked recurring creates auto-contributions; holding-linked recurring creates buy transactions
- Monte Carlo projection uses 500 simulations, 15% annual std dev, annual return sampling with monthly compounding
- Monte Carlo fan chart shows p10/p50/p90 percentiles; milestone values shown in a table below the chart (not on the SVG) to avoid overlap
- Inflation toggle reduces returns by 3% (real vs nominal)
- Withdrawal phase applies 4% rule after target is reached
- Scenario presets (Conservative 6%, Historical 10%, Optimistic 14%) set all holdings' return rates at once

## Progress
### Done
- **`src/types.ts`**: Made `Goal.targetAmount` optional; added `Expense.isWithdrawal?: boolean`; `BankMappingRule.routeTo` includes `"goalWithdrawal"`; added `RecurringExpense.{goalId,holdingId}`, `Expense.fundedByGoalId`, `Category.{sectionId,frequency,linkedGoalId}`, `BudgetSection` interface, `Holding`, `HoldingTransaction`, `HoldingSummary`, `PortfolioSummary`
- **`src/store.ts`**: Full CRUD for budgets, categories, budget sections, expenses, goals, accounts, recurring, income sources, bank rules, holdings, holding transactions; `previewImport` matches bank rules (category, goal, goalWithdrawal, skip, holding, income, householdTransfer); `commitImport` handles transfer pairing, goal withdrawals, balance override, withdrawal-merchant pairing (±10% same-date); `deleteExpense` cascades goal balance; `applyRecurring` handles goalId (contributions) and holdingId (buy transactions); `init()` migration for legacy data; price refresh cooldown (5 min `lastRefreshedAt`)
- **`src/pages/Investments.tsx`**: Full portfolio management (holdings + transactions), "By Type" summary, CGT estimate, holding detail with FIFO cost tracking, MillionaireProjection with Monte Carlo simulation (500 sims, 15% std dev, annual return sampling → p10/p50/p90 fan chart), inflation toggle (real vs nominal), withdrawal phase toggle (4% rule after target), scenario presets (6%/10%/14%), milestone markers at 5/10/15/20yr shown as table below chart (not on SVG to avoid overlap), per-holding colored dashed lines with HTML legend, What If per-holding scenario comparison with its own Monte Carlo chart, auto-refresh prices from CoinGecko/Yahoo/Binance (5-min cooldown), auto-investment recurring amounts in projection, year-range zoom controls on chart, clickable legend to toggle individual holding lines on/off
- **`src/pages/Budget.tsx`**: Section-organized categories, auto-organize via keyword map, inline CategoryModal with section picker + "New Section" form, RecuringModal with goal picker + holding picker + inline "Create Goal", BudgetPrintModal, category filter pills, uncategorized section with section-grouped picker
- **`src/pages/Dashboard.tsx`**: Date range heading (e.g. "15 Jun – 14 Jul"), By Category / By Section chart toggle, section-grouped category budgets using `monthlyCategoryAmount()` with `/wk` `/fn` indicators, round-up summary
- **`src/pages/Trends.tsx`**: Monthly budget allocation heatmap with `monthlyCategoryAmount()` normalization, biggest movers
- **`src/pages/Statements.tsx`**: `parseCSV` balance column detection, ending balance input in ImportReview, local folder import (scan/select/parse via `showDirectoryPicker`), TargetSelect withdrawal optgroup, RuleForm withdrawal route, quick goal form, auto-save rules, pairing preview with Break button
- **`src/pages/Settings.tsx`**: Bank rule list with goal names, Statement Import Folder settings (Google Drive + Local Folder with pick/remove), BankRuleModal withdrawal route
- **`src/pages/Expenses.tsx`**: ExpenseModal with Contribution/Withdrawal toggle + "Funded by Goal" picker, expense row withdrawal badge + funded-by-goal badge
- **`src/pages/Goals.tsx`**: Optional target amount, GoalModal, withdrawal history tinting, no-cap contributions, balance summary, fundedByGoal expenses
- **`src/backup.ts`**: `getImportDirHandle`, `setImportDirHandle`, `removeImportDirHandle`, `pickImportFolder`, `listImportFiles` using IndexedDB
- **`src/components/ui.tsx`**: Shared Modal, ProgressBar, ColorPicker, ColorDot, AccountPicker, Confirm, EmptyState, Card, Button, Input, SectionHeader

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- `BudgetSection` as separate entity (not free-text) so user defines once and picks from list
- Goal withdrawals tracked via `Expense.isWithdrawal` — cleanest way to distinguish spending from saving
- Balance clamp at 0 rather than negative envelopes
- Transfer pairing uses `importId`-based (reliable for new imports) and description-based (fallback for old data)
- Balance transition logic lives in ExpenseModal (not `updateExpense` store action) to avoid double-adjustment
- `updateExpense` store action is a simple field update — callers handle goal balance adjustments themselves
- Monte Carlo: annual return sampling (N(μ, σ) per year) with monthly compounding — most realistic for long-term projections
- 500 simulations × 60 year max with 15% annual std dev matches historical S&P 500 volatility
- Withdrawal phase uses 4% of current balance monthly (simplified safe withdrawal rate)
- What If scenario presets update all holdings' return rates simultaneously for quick comparison
- Milestone values shown as HTML table (not on SVG) to avoid overlapping badges at dense year intervals

## Next Steps
- (none presently)

## Critical Context
- `BankMappingRule` uses `"goalWithdrawal"` route with same `goalId` field — route toggles add (goal) vs subtract (goalWithdrawal)
- `commitImport` checks `goalWithdrawalId` before `goalId` — mutually exclusive, only one wins per row
- `deleteExpense` adjusts goal balance AFTER expense removed from array but BEFORE `save()`, so `snapshot(get())` includes updated goal
- Goal contributions count as budget expenses (reduce available budget). Goal withdrawals do not — only affect `currentAmount`
- `fundedByGoalId` is purely record-keeping — no balance change. Actual balance adjustment happens via paired withdrawal
- `getHoldingSummary` uses FIFO cost tracking for realised gains, CGT estimate (Australia, 50% discount >12mo)
- Monte Carlo `normalRandom()` uses Box-Muller transform; `runMonteCarlo` pre-generates annual returns per simulation then compounds monthly
- Projection chart renders SVG fan (p10-p90 shaded, p50 line) + milestone badge rects with p10–p90 range text
- Inflation toggle subtracts 3% from effective return rate; withdrawal toggle activates 4% rule after median crosses target
- Price refresh has 5-minute cooldown (`lastRefreshedAt`); auto-investment recurring amounts automatically included in projection `monthlyContribution`; What If scenario now renders its own Monte Carlo fan chart below comparison text
- Chart defaults to 20-year view with year-range zoom; super holdings default to $2,500/mo contribution ($30K/yr pre-tax limit)

## Relevant Files
- `src/types.ts`: All data model interfaces
- `src/store.ts`: Zustand store with full CRUD + import/recurring/portfolio logic
- `src/pages/Investments.tsx`: Holding management, CGT, MillionaireProjection with Monte Carlo
- `src/pages/Budget.tsx`: Section-organized categories, recurring modal, print preview
- `src/pages/Dashboard.tsx`: Date range heading, chart toggles, section-grouped budgets
- `src/pages/Statements.tsx`: CSV parse/import, bank rules, local folder import, pairing
- `src/pages/Settings.tsx`: Bank rules, import folder settings
- `src/pages/Expenses.tsx`: Expense CRUD modal with goal/withdrawal/fundedBy support
- `src/pages/Goals.tsx`: Goal CRUD with optional target, contribution/withdrawal history
- `src/backup.ts`: IndexedDB-based directory handle persistence
- `src/components/ui.tsx`: Shared UI primitives
- `src/utils.ts`: formatCurrency, formatDate, monthlyCategoryAmount, getBudgetDateRange, etc.
