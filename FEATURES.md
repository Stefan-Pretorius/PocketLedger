# PocketLedger — Feature Guide

## Overview
PocketLedger is a personal finance tracker built for Australian users, featuring YNAB-style budgeting, ANZ Plus goal integration, detailed Australian tax calculations, investment tracking, and comprehensive financial planning tools.

---

## Budgeting

### YNAB-Style Envelope Budgeting
- **Ready to Assign**: Shows unallocated income at the top of the Budget page. Green = money available to allocate, red = overbudgeted.
- **Quick Reallocation**: Move money between categories with a single click — decreases source and increases destination (frequency-normalized).
- **Age of Money**: Displays how many days your remaining balance would last at current spending rate. Color-coded: green (>30 days), yellow (14–30), red (<14).
- **Category Available**: Each category shows "available" (allocated − spent), indicating surplus or overage.

### Budget Sections
- Categories are grouped into user-defined **Budget Sections** (e.g., "Housing", "Food", "Transport").
- Auto-organize categories into sections based on a configurable keyword map.

### Recurring Expenses
- Set up recurring transactions with configurable frequency (weekly, fortnightly, monthly).
- Frequency normalization: all amounts are shown as monthly equivalents in views.
- **Goal-linked recurring**: Automatically creates goal contributions.
- **Holding-linked recurring**: Automatically creates buy transactions for investment holdings.

### Budget Printing
- Print-friendly budget view with all categories, allocated amounts, and spending.

---

## ANZ Plus Integration

### Goal Types
- **Manual**: Traditional goal with manual contributions.
- **ANZ Plus**: Linked to ANZ Plus Flex Saver or Growth Saver accounts with bonus interest tracking.
- **Investment**: Goal linked to an investment holding.

### Bonus Interest Tracking
- Tracks whether bonus interest is earned each month (earned when no withdrawals made).
- Shows monthly interest estimate on goal cards.
- Displays total monthly interest across all ANZ Plus goals.
- Goal cards show ANZ Plus badges and interest rate indicators.

### Auto-Contribution
- Set up automatic contributions to ANZ Plus goals with configurable amount and frequency.

---

## Account Management

### ANZ Plus Account Types
- Accounts can be tagged with sub-types: Everyday, Growth Saver, Flex Saver, Joint.
- Account owner tracking (Self, Partner, Joint).
- Account picker throughout the app shows sub-type and owner information.

---

## Statement Import

### CSV Import
- Drag-and-drop or file picker for CSV bank statements.
- **Balance column detection**: Automatically detects `balance`/`running balance` columns to update account balances.
- Ending balance input in import review for verification.

### Local Folder Import
- Uses `showDirectoryPicker()` API for local folder access (no OAuth needed).
- Scan and select files from a local folder for import.

### Bank Mapping Rules
- Create rules to automatically categorize imported transactions.
- Routes: Category, Goal, Goal Withdrawal, Skip, Holding, Income, Household Transfer.
- Auto-save rules for future imports.
- Withdrawal opt-in for goal withdrawals.

### Transfer Pairing
- Automatically pairs transfer transactions between accounts.
- Break pairing option for incorrectly matched transfers.

---

## Goals

### Flexible Target
- Goal target amount is optional — set a target or track open-ended savings.

### Goal Contributions & Withdrawals
- Track contributions (add to goal balance) and withdrawals (subtract from goal balance).
- **Funded by Goal**: Link expenses to goals for record-keeping (no balance impact).
- Withdrawal history with tinting to distinguish from contributions.

### ANZ Plus Goal Features
- Bonus interest eligibility tracking.
- Monthly interest estimate.
- Owner tracking for joint goals.

---

## Investments

### Portfolio Management
- Track multiple holdings (ETFs, stocks, crypto, super).
- Holding transactions with FIFO cost basis tracking.
- **By Type** summary: Group holdings by type (ASX, US, Crypto, Super).

### CGT Estimation
- FIFO-based capital gains tax calculator.
- Pre/post 1 July 2027 split treatment (50% discount vs CPI indexation + 30% min tax).
- Australian-specific CGT calculations.

### Monte Carlo Projection
- **500 simulations** with 15% annual standard deviation.
- Annual return sampling with monthly compounding.
- **Fan chart**: Shows p10/p50/p90 percentiles with shaded regions.
- **Milestone markers**: Key year targets shown in a table below the chart.
- **Inflation toggle**: Reduces returns by 3% (real vs nominal).
- **Withdrawal phase**: Applies 4% rule after target is reached.
- **Scenario presets**: Conservative (6%), Historical (10%), Optimistic (14%) — sets all holdings' return rates at once.
- **What If**: Per-holding scenario comparison.
- **Year-range zoom**: Default 20-year view with adjustable range.

### Price Refresh
- Auto-refresh prices from CoinGecko/Yahoo/Binance APIs.
- 5-minute cooldown to prevent excessive API calls.

---

## Financial Planner

### 5-Tab Planning Tool

#### 1. Rent vs Buy
- Age-based simulation from current age to target age (90).
- Detailed property costs: council rates, insurance, maintenance, strata.
- Inflation-adjusted costs at configurable rate.
- **Downsizing at retirement**: Buy smaller / Rent smaller / Don't downsize options.
- PPR = no CGT.
- Year-by-year table at 5-year intervals.
- Break-even detection.

#### 2. Super Strategy
- Full optimizer comparing salary sacrifice vs after-tax vs non-concessional contributions.
- Carry-forward and bring-forward rules.
- Div 293/296 tax calculations.
- Contribution cap limits.

#### 3. Investment Property
- Negative gearing analysis.
- Rental yield calculations.
- Depreciation schedules.
- CGT estimation.
- Stamp duty (SA-specific).
- Holding period comparison.

#### 4. FIRE Calculator
- **Annual Spending Target**: Enter your desired retirement spending or auto-calculate from latest budget.
- **Savings Rate**: Manual input or auto-calculated from (income − current spending) / income.
- **FIRE Number**: Spending ÷ Withdrawal Rate (e.g. $100K ÷ 4% = $2.5M).
- **Annual Savings**: Income × Savings Rate — shows how much you add to portfolio each year.
- Year-by-year projection with accumulation and withdrawal phases.
- Shows years to FIRE and FIRE age.

#### 5. Lump Sum Optimizer
- Optimal deployment across:
  - Concessional contributions (with carry-forward).
  - Non-concessional contributions (with bring-forward).
  - Mortgage offset.
  - Invest outside super.
  - Gift to spouse.
- Shows both spouses' marginal tax rates.
- Cap limits and recommended allocation.
- Net gain projections at horizon.

---

## Australian Tax Module

### Income Tax
- **FY 2024-25 through 2027-28+** brackets.
- Low Income Tax Offset (LITO).
- Marginal rate calculator.

### Medicare Levy
- Standard 2% levy.
- Medicare Levy Surcharge (MLS) thresholds.
- Low-income thresholds.

### Superannuation
- **2026-27 caps**: CC $32,500, NCC $130,000.
- SG rate 12%.
- Transfer balance cap $2.1M.
- Carry-forward (unused concessional caps from prior years).
- Bring-forward (prepay up to 3 years of NCC).
- **Div 293**: Extra 15% on contributions for high-income earners ($250K+).
- **Div 296**: Extra 15% on earnings for super balances $3M–$10M, extra 25% above $10M (from 1 July 2026).
- Salary sacrifice benefit calculator.

### Capital Gains Tax
- FIFO cost basis (ATO-preferred).
- **Pre-1 July 2027**: 50% CGT discount for holdings >12 months.
- **Post-1 July 2027**: CPI indexation + 30% minimum tax.
- Split treatment for holdings spanning the reform date.

### South Australia Stamp Duty
- FHB full exemption up to $650K.
- Concessional rates to $700K.
- Vacant land up to $400K.
- Land tax calculator.

---

## Dashboard

### Overview
- **Date range heading**: Shows budget period (e.g., "15 Jun – 14 Jul").
- **Spending chart**: Toggle between "By Category" and "By Section".
- **Section-grouped budget summary**: Categories organized by section with monthly amounts.
- **Round-up summary**: Shows savings from rounding categories.
- **ANZ Plus goal badges**: Interest rate indicators on goal cards.

---

## Money Flow (Sankey Diagram)

### Visual Flow
- **3-column Sankey**: Income Sources → Accounts → Categories + Goals.
- Color-coded flows matching category/goal colors.
- Verify mode: Checklist of categories with budget vs actual comparison.
- Year tabs for navigating between years.
- Auto-selects current month's budget.
- Handles unassigned income/expenses (no account set) through "Unassigned" node.

---

## Trends

### Monthly Budget Allocation Heatmap
- Visual heatmap showing category allocation patterns over time.
- Biggest movers: Categories with the largest changes between periods.

---

## Expenses

### Expense Management
- CRUD modal with goal/withdrawal/fundedBy support.
- **Contribution/Withdrawal toggle**: Distinguish between adding to and withdrawing from goals.
- **Funded by Goal picker**: Link expenses to goals for record-keeping.
- Expense rows show withdrawal badges and funded-by-goal badges.

---

## Settings

### Bank Rules
- List of mapping rules with goal names and routes.
- Rule modal with category, goal, and withdrawal route options.

### Import Folder Settings
- Google Drive integration.
- Local folder picker with IndexedDB persistence.

### Tax Settings
- Self/partner annual salary inputs.
- Tax year selector.
- Medicare exemption toggle.
- Salary sacrifice inputs.
- Unused concessional caps for carry-forward.

### Account Management
- ANZ Plus sub-type picker.
- Owner picker (Self/Partner/Joint).

---

## Progressive Web App (PWA)

### Offline Support
- Service worker with precaching for offline access.
- Runtime caching for Google Fonts and Yahoo Finance API.
- Installable on mobile and desktop.

### PWA Features
- Manifest with app icons.
- Apple mobile web app capable.
- Theme color matching.

---

## Architecture

### Code Splitting
- All page components are lazy-loaded (React.lazy + Suspense).
- Main bundle: ~310 KB; each page loads on demand.

### Shared Modules
- **Monte Carlo engine** (`src/monte-carlo.ts`): Shared by Investments, Scenarios, and Financial Planner.
- **Tax module** (`src/tax/`): Modular tax calculations by concern (rates, medicare, super, CGT, SA stamp duty).
- **Budget picker** (`src/components/BudgetPicker.tsx`): Reusable year tabs and month grid.

### State Management
- Zustand store with full CRUD for all entities.
- IndexedDB persistence via backup module.
- Import/recurring/portfolio/tax settings all in one store.
