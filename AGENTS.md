## Goal
Build a personal finance tracker with budgeting, statement import, goals, recurring expenses, dashboard, investments, projection tools, Australian tax module, and financial planner scenarios.

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
- Australian tax rules: 2026-27 FY rates, CGT reform from 1 July 2027, super caps, Div 293/296
- CGT: Model both old (50% discount) and new (CPI indexation + 30% min tax) with split treatment
- User is in South Australia (SA stamp duty rules)
- ANZ Plus workflow: Salary → Everyday → Flex Saver → Goals → Withdrawal → Everyday → Merchant
- Both spouses have individual + joint accounts; wife also funds goals from her accounts
- Investments: ASX ETFs, US ETFs (Vanguard), Crypto, Vanguard Super, moomoo
- Full super strategy optimizer (salary sacrifice vs after-tax vs NCC with carry-forward/bring-forward)
- FIRE: Calculate spending from budget data
- User receiving lump sum from overseas super (as cash) — needs tax-effective deployment tool
- All investments currently in wife's name (lower marginal rate / CGT)
- Can gift lump sum to spouse for tax-effective investing

## Progress
### Done
- **`src/types.ts`**: Made `Goal.targetAmount` optional; added `Expense.isWithdrawal?: boolean`; `BankMappingRule.routeTo` includes `"goalWithdrawal"`; added `RecurringExpense.{goalId,holdingId}`, `Expense.fundedByGoalId`, `Category.{sectionId,frequency,linkedGoalId}`, `BudgetSection` interface, `Holding`, `HoldingTransaction`, `HoldingSummary`, `PortfolioSummary`; `Goal.bonusInterestRate`, `Goal.lastWithdrawalDate`
- **`src/store.ts`**: Full CRUD for budgets, categories, budget sections, expenses, goals, accounts, recurring, income sources, bank rules, holdings, holding transactions; `previewImport` matches bank rules (category, goal, goalWithdrawal, skip, holding, income, householdTransfer); `commitImport` handles transfer pairing, goal withdrawals (with `lastWithdrawalDate` tracking), balance override, withdrawal-merchant pairing (±10% same-date); `deleteExpense` cascades goal balance; `applyRecurring` handles goalId (contributions) and holdingId (buy transactions); `init()` migration for legacy data; price refresh cooldown (5 min `lastRefreshedAt`); tax settings fields (`selfAnnualSalary`, `partnerAnnualSalary`, `taxYearLabel`, `medicareExempt`, `selfSalarySacrifice`, `partnerSalarySacrifice`, `unusedConcessionalCaps`) with `updateTaxSettings` action
- **`src/tax/rates.ts`**: Income tax brackets FY 2024-25 through 2027-28+, LITO, marginal rates via `getTaxYearRates()` and `getMarginalRate()`
- **`src/tax/medicare.ts`**: Medicare levy (2%), MLS thresholds, low-income thresholds, `calculateMedicareLevy()`
- **`src/tax/super.ts`**: Super caps ($32.5K CC, $130K NCC for 2026-27), carry-forward, bring-forward, Div 293/296, salary sacrifice benefit calculator, `modelSuperStrategy()`, `getSuperCaps()`, `calculateCarryForward()`, `calculateBringForward()`, `calculateSalarySacrificeBenefit()`
- **`src/tax/cgt.ts`**: FIFO-based CGT calculator with pre/post 1 July 2027 split treatment, CPI indexation, `calculateCgtSummary()`, `calculateCapitalGains()`
- **`src/tax/sa.ts`**: South Australia stamp duty calculator (incl. FHB concessions), land tax, `calculateSaStampDuty()`, `calculateSaLandTax()`
- **`src/tax/index.ts`**: Barrel exports for all tax modules; `calculateTotalIncomeTax()` aggregator
- **`src/pages/FinancialPlanner.tsx`**: 5-tab financial planner:
  - **Rent vs Buy**: Age-based simulation (current age → target age 90), detailed property costs (council rates, insurance, maintenance %, strata) inflating at configurable rate, downsizing at configurable age (buy smaller / rent smaller / don't downsize), PPR = no CGT, year-by-year table at 5yr intervals with pension columns, break-even detection, CGT on investment returns (configurable effective rate), Age Pension means test (couple rates, home excluded from assets test, $78/yr taper per $1K over $419K/$643.5K threshold), dedicated Age Pension Analysis card showing pension gap between renter (non-homeowner, higher threshold but investments assessable) vs buyer (homeowner, lower threshold but PPR excluded)
  - **Super Strategy**: Full optimizer with salary sacrifice vs NCC vs combined, carry-forward/bring-forward, Div 293/296, contribution cap limits, after-tax vs pre-tax comparison
  - **Investment Property**: Negative gearing, rental yield, depreciation, CGT, stamp duty, holding period comparison
  - **FIRE Calculator**: Annual expenses from budget data, SWR-based target, Monte Carlo projection, years-to-FIRE, yearly/monthly amortization toggle (monthly shows interest earned, contributions/withdrawals, running balance at Jan/Jul intervals)
  - **Lump Sum Optimizer**: Optimal deployment across CC (with carry-forward), NCC (with bring-forward), mortgage offset, invest outside super, gift to spouse. Shows both spouses' marginal rates, caps, recommended allocation, net gain projections at horizon
- **`src/pages/Investments.tsx`**: Full portfolio management (holdings + transactions), "By Type" summary, CGT estimate (FIFO-based), holding detail with FIFO cost tracking, MillionaireProjection with Monte Carlo simulation (500 sims, 15% std dev), inflation toggle, withdrawal phase toggle, scenario presets, milestone markers, per-holding colored dashed lines with HTML legend, What If per-holding scenario comparison, auto-refresh prices from CoinGecko/Yahoo/Binance (5-min cooldown), year-range zoom, clickable legend
- **`src/pages/Budget.tsx`**: Section-organized categories, auto-organize via keyword map, inline CategoryModal with section picker + "New Section" form, RecuringModal with goal picker + holding picker + inline "Create Goal", BudgetPrintModal, category filter pills, uncategorized section with section-grouped picker, Ready to Assign banner, Age of Money estimate, per-category "available" display, quick reallocation modal
- **`src/pages/Dashboard.tsx`**: Date range heading (e.g. "15 Jun – 14 Jul"), By Category / By Section chart toggle, section-grouped category budgets using `monthlyCategoryAmount()` with `/wk` `/fn` indicators, round-up summary, ANZ Plus goal interest rate badges
- **`src/pages/Trends.tsx`**: Monthly budget allocation heatmap with `monthlyCategoryAmount()` normalization, biggest movers
- **`src/pages/Statements.tsx`**: `parseCSV` balance column detection, ending balance input in ImportReview, local folder import (scan/select/parse via `showDirectoryPicker`), TargetSelect withdrawal optgroup, RuleForm withdrawal route, quick goal form, auto-save rules, pairing preview with Break button
- **`src/pages/Settings.tsx`**: Bank rule list with goal names, Statement Import Folder settings (Google Drive + Local Folder with pick/remove), BankRuleModal withdrawal route, Tax Settings section (salaries, tax year, Medicare exempt, salary sacrifice), AccountModal with ANZ Plus sub-type picker (Everyday/Growth Saver/Flex Saver/Joint) and owner picker
- **`src/pages/Expenses.tsx`**: ExpenseModal with Contribution/Withdrawal toggle + "Funded by Goal" picker, expense row withdrawal badge + funded-by-goal badge
- **`src/pages/Goals.tsx`**: Optional target amount, GoalModal with ANZ Plus goal type (account linker, bonus interest rate, auto-contribution amount/frequency, owner picker), bonus interest eligibility tracking (no withdrawals this month), monthly interest estimate, withdrawal history tinting, no-cap contributions, balance summary, fundedByGoal expenses, ANZ Plus badges on goal cards, total monthly interest summary
- **`src/pages/Scenarios.tsx`**: Legacy scenario page (scope bug fixed, tax module imports added)
- **`src/backup.ts`**: `getImportDirHandle`, `setImportDirHandle`, `removeImportDirHandle`, `pickImportFolder`, `listImportFiles` using IndexedDB
- **`src/components/ui.tsx`**: Shared Modal, ProgressBar, ColorPicker, ColorDot, AccountPicker, Confirm, EmptyState, Card, Button, Input, SectionHeader
- **`src/components/Layout.tsx`**: Navigation with Planner link, mobile sidebar
- **`src/App.tsx`**: Routes with lazy loading (React.lazy + Suspense) for all page components
- **`src/monte-carlo.ts`**: Extracted Monte Carlo engine (normalRandom, runMonteCarlo, McHoldingInput/McPoint/McHoldingLine types) shared by Investments, Scenarios, FinancialPlanner
- **`vite.config.ts`**: VitePWA plugin with manifest, service worker, precaching, runtime caching for Google Fonts and Yahoo Finance API
- **`index.html`**: PWA meta tags (theme-color, apple-mobile-web-app-capable, apple-touch-icon)
- **`public/`**: PWA icons (icon-192.png, icon-512.png, apple-touch-icon.png)

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
- Tax module in `src/tax/` with per-concern files for maintainability
- FIFO cost basis for CGT (ATO-preferred method)
- CGT reform split treatment: gains pre-1 July 2027 get 50% discount; post get CPI indexation + 30% min tax
- Financial Planner as a page (`/planner`) with tab navigation (5 tabs: Rent vs Buy, Super Strategy, Investment Property, FIRE, Lump Sum)
- Rent vs Buy uses age-based simulation: both scenarios share same income, renter invests surplus, buyer invests surplus after mortgage + property costs. Renter starts with totalUpfront invested
- Lump Sum Optimizer: recommended order is CC first (immediate tax benefit) → NCC → mortgage → invest. Gift to spouse shown as alternative when spouse has lower marginal rate
- Super earnings taxed at 15% in super; outside super uses 50% CGT discount for long-term holdings
- Ready to Assign = totalIncome - totalAllocated; Age of Money = remaining / dailySpendRate
- Quick reallocation: decrease source category's allocatedAmount, increase destination's (frequency-normalized)

## Next Steps
- (none — all phases complete)

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
- Price refresh has 5-minute cooldown (`lastRefreshedAt`); auto-investment recurring amounts automatically included in projection `monthlyContribution`
- Chart defaults to 20-year view with year-range zoom; super holdings default to $2,500/mo contribution ($30K/yr pre-tax limit)
- 2026-27 tax rates: 0% up to $18,200; 15% to $45K; 30% to $135K; 37% to $190K; 45% above
- Super caps 2026-27: CC $32,500, NCC $130,000, SG rate 12%, transfer balance cap $2.1M
- Div 296: extra 15% on earnings for super balances $3M-$10M, extra 25% above $10M (from 1 July 2026)
- SA stamp duty: FHB full exemption up to $650K, concessional to $700K; vacant land up to $400K
- Overseas super lump sum may be taxable depending on age, country, and DTA — user should consult tax professional
- Gifting between spouses has no limit; Centrelink attribution rules ($10K/yr) unlikely to affect working couple
- ANZ Plus bonus interest: earned when no withdrawals in calendar month; tracked via `lastWithdrawalDate` on Goal
- Goal type "anzPlus" links to Flex Saver/Growth Saver accounts via `accountId`; shows bonus rate and auto-contribution info
- Vite dev server: `npm run dev` → http://localhost:5173 (or next available port)

## Relevant Files
- `src/types.ts`: All data model interfaces
- `src/store.ts`: Zustand store with full CRUD + import/recurring/portfolio + tax settings
- `src/monte-carlo.ts`: Shared Monte Carlo engine (normalRandom, runMonteCarlo, types)
- `src/tax/rates.ts`: Income tax brackets by FY
- `src/tax/medicare.ts`: Medicare levy + MLS calculations
- `src/tax/super.ts`: Super caps, carry-forward, bring-forward, Div 293/296, salary sacrifice optimizer, `modelSuperStrategy()`
- `src/tax/cgt.ts`: FIFO CGT calculator with pre/post reform split, `calculateCgtSummary()`
- `src/tax/sa.ts`: SA stamp duty calculator, `calculateSaStampDuty()`
- `src/tax/index.ts`: Barrel exports for all tax modules
- `src/pages/FinancialPlanner.tsx`: 5-tab financial planner (rent vs buy, super, investment property, FIRE, lump sum optimizer)
- `src/pages/Investments.tsx`: Holding management, CGT (FIFO), MillionaireProjection with Monte Carlo
- `src/pages/Budget.tsx`: Section-organized categories, recurring modal, print preview, Ready to Assign, Age of Money, reallocation
- `src/pages/Dashboard.tsx`: Date range heading, chart toggles, section-grouped budgets
- `src/pages/Statements.tsx`: CSV parse/import, bank rules, local folder import, pairing
- `src/pages/Settings.tsx`: Bank rules, import folder settings, Tax Settings
- `src/pages/Expenses.tsx`: Expense CRUD modal with goal/withdrawal/fundedBy support
- `src/pages/Goals.tsx`: Goal CRUD with optional target, contribution/withdrawal history
- `src/pages/Scenarios.tsx`: Legacy scenario page
- `src/backup.ts`: IndexedDB-based directory handle persistence
- `src/components/ui.tsx`: Shared UI primitives
- `src/components/Layout.tsx`: Navigation + mobile sidebar
- `src/App.tsx`: Routes
- `src/utils.ts`: formatCurrency, formatDate, monthlyCategoryAmount, getBudgetDateRange, etc.
