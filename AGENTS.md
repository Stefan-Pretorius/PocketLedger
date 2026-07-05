## Goal
- Add goal withdrawal support (spending from saved envelopes), make goal target amount optional, and add transfer pairing to declutter the expense list.
- Add recurring goal allocation contributions and "funded by goal" expense tagging with import-level withdrawal-merchant pairing.

## Constraints & Preferences
- Contribution/Withdrawal toggle uses the same pill button style as other app controls.
- Goal balance clamped at 0 (no negative envelope).
- Withdrawal uses the goal's color with a `Repeat` icon (not success/danger colours).
- Goal withdrawals excluded from budget spending (same as contributions).
- Deleting a withdrawal expense reverses the balance change (adds back, clamped at 0).
- Editing a contribution→withdrawal (or vice versa) reverses old and applies new, clamped at 0.
- `Goal.targetAmount` optional — no progress bar when undefined, no cap on contributions.
- `Expense.isWithdrawal` field distinguishes spending from saving on expense records.
- Goal contributions count as budget expenses (they reduce available budget). Goal withdrawals do not — they only affect `currentAmount`.
- Category picker shown alongside goal selector in contribution mode (ExpenseModal, ImportReview, ContributeModal) so contributions can be tied to a budget category.
- Balance transition logic lives in ExpenseModal (not `updateExpense` store action) to avoid double-adjustment.
- Auto-save rules for goal withdrawals use `routeTo: "goalWithdrawal"` in `BankMappingRule`.
- `RecurringExpense.goalId` links a template to a goal; `applyRecurring` creates contribution expenses AND adjusts goal balance.
- `Expense.fundedByGoalId` tags a regular expense as paid from a goal envelope (record-keeping only, no balance change).
- Withdrawal-merchant pairing in `commitImport` pairs `goalWithdrawal` transactions with merchant transactions on the same date with similar amounts (±10%). When paired, the withdrawal silently adjusts goal balance and the merchant gets `fundedByGoalId`.

## Progress
### Done
- **`src/types.ts`**: Made `Goal.targetAmount` optional; added `Expense.isWithdrawal?: boolean`; added `"goalWithdrawal"` to `BankMappingRule.routeTo` union.
- **`src/store.ts`**: Added `goalWithdrawalId?: number` to `ImportedTransaction`; `previewImport` matches `"goalWithdrawal"` bank rules and passes `goalWithdrawalId` on rows; `commitImport` handles `goalWithdrawalId` (subtracts from `currentAmount`, clamp at 0, creates `isWithdrawal: true` expense); `commitImport` returns `goalWithdrawalCount`; `deleteExpense` cascades goal balance (reverses contribution or withdrawal, clamp at 0); duplicate-check skips also clear `goalWithdrawalId`.
- **Statements.tsx**: `TargetSelect` added goal withdrawal optgroup (`🔻 Goal Withdrawals`); `RuleForm` added `"goalWithdrawal"` route button (chart-2 colour, 🔻 icon) and goal picker; quick goal form makes target optional; auto-save rules create `goalWithdrawal` rules; summary chips include `goalWithdrawalCount`; import review rows show withdrawal styling (chart-2 borders, withdrawal auto-match badges).
- **Settings.tsx**: `BankRuleModal` added `"goalWithdrawal"` route option (chart-2 colour, 🔻 icon); rule list displays "🔻 Goal withdrawal" labels.
- **Expenses.tsx**: `ExpenseModal` added Contribution/Withdrawal toggle pill (`Repeat` icon, goal colour background); save function handles withdrawal balance logic (subtract from goal, clamp at 0); expense rows show `Repeat` icon and "Withdrawn" badge for withdrawals; amount text uses `text-foreground` for withdrawals (not success).
- **Goals.tsx**: `GoalModal` makes target optional (label: "Target Amount (optional)", allows empty/undefined); `ContributeModal` skips cap when no target, shows "No target set" instead of "of $X"; goal cards show progress bar only when `targetAmount` is defined; history section shows contributions (+green) and withdrawals (goal-coloured, with `-` prefix); balance summary bar shows Contributed/Withdrawn/Net amounts.
- **Dashboard.tsx**: `goalProgress` handles optional `targetAmount` (no division by zero); goal cards show progress bar only when target exists; `recentExpenses` and trend data exclude `isWithdrawal` from budget spending.
- **`src/types.ts`**: Added `RecurringExpense.goalId?` and `Expense.fundedByGoalId?`.
- **`src/store.ts`**: `applyRecurring` handles `goalId` (creates contribution expense + bumps goal balance); `commitImport` pairs goal withdrawals with merchant transactions (±10%, same date, silent withdrawal + `fundedByGoalId`).
- **Budget.tsx**: `RecurringModal` adds goal picker toggle (Category ↔ Goal mode) and inline goal creation (`+ Goal` button); goal-linked recurring saves `goalId`.
- **Expenses.tsx**: `ExpenseModal` adds "Funded by Goal" picker for non-goal expenses; expense rows show funded-by-goal badge.
- **Statements.tsx**: `ImportReview` shows withdrawal-merchant pairing preview with "Paired with <merchant>" / "Funded by <goal>" indicators and "Break" button.
- **Goals.tsx**: Goal cards show `fundedByGoal` expenses in history list; net balance summary always shown.

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions
- Goal withdrawals tracked via `Expense.isWithdrawal` field — cleanest way to distinguish spending from saving on the same expense.
- Balance clamp at 0 rather than allowing negative envelopes, per user request.
- Transfer pairing uses two strategies: `importId`-based (reliable for new imports) and description-based (fallback for older data).
- Balance transition logic lives in ExpenseModal (not `updateExpense` store action) to avoid double-adjustment when both the modal and the store try to update goal balances.
- `updateExpense` store action is a simple field update — callers (ExpenseModal) handle goal balance adjustments themselves.
- `goalWithdrawalCount` returned from `commitImport` but not persisted in `ImportedStatement` — keeps schema simple, the count is display-only.

## Next Steps
- (none presently)

## Critical Context
- `BankMappingRule` uses `"goalWithdrawal"` route with the same `goalId` field — the route toggles whether it adds (goal) or subtracts (goalWithdrawal).
- `commitImport` checks `goalWithdrawalId` before `goalId` — mutually exclusive, only one wins per row.
- `deleteExpense` adjusts goal balance AFTER the expense is removed from the array but BEFORE `save()`, so `snapshot(get())` includes the updated goal.
- Goal contributions (`goalId`) still use `+=` on `currentAmount` — unchanged behavior.
- Goal withdrawals excluded from budget spending (same as contributions).
- Import review `TargetSelect` shows withdrawal options as separate optgroup "Goal Withdrawals" with 🔻 icon.
- Category picker shown alongside goal selector in contribution mode (ExpenseModal, ImportReview, ContributeModal) so contributions can be tied to a budget category.
- `commitImport` passes `categoryId` through for goal contributions so imported contributions carry the category picked in review.
- Goal-linked recurring templates (`RecurringExpense.goalId`) create contribution expenses and bump goal balance — same as manual contribution but automated.
- `fundedByGoalId` is purely record-keeping — no balance change. The actual balance adjustment happens via the paired withdrawal.
- Withdrawal-merchant pairing happens automatically in `commitImport` based on same-date ±10% amount matching. Users can break pairs in import review by clearing the withdrawal assignment.

## Relevant Files
- `src/types.ts`: `BudgetSection` interface + `sectionId` on `Category`; `Goal.targetAmount?`, `Expense.isWithdrawal?`, `BankMappingRule.routeTo` with `"goalWithdrawal"`; `RecurringExpense.goalId?`, `Expense.fundedByGoalId?`
- `src/store.ts`: `budgetSections` in `StoreData`, CRUD actions; `goalWithdrawalId` on `ImportedTransaction`; `previewImport`/`commitImport`/`deleteExpense` updated; `applyRecurring` goalId handling; `commitImport` withdrawal-merchant pairing
- `src/pages/Budget.tsx`: `CategoryModal` section picker, section-grouped display, `SECTION_KEYWORDS` + auto-organize; goal indicator on `RecurringRow`; `RecurringModal` goal picker
- `src/pages/Dashboard.tsx`: date range heading, By Category/By Section chart toggle, section-grouped category budgets; undefined target handling; exclude withdrawals from budget spending
- `src/pages/Statements.tsx`: `parseCSV` balance column, ending balance input in `ImportReview`; local folder import flow (scan, select, import from stored directory handle); `TargetSelect` withdrawal optgroup; `RuleForm` withdrawal route; quick goal optional target; auto-save `goalWithdrawal` rules; `ImportReview` withdrawal-merchant pairing preview
- `src/pages/Settings.tsx`: mapping list shows goal names; "Statement Import Folder" has both Google Drive and Local Folder options with pick/remove controls; `BankRuleModal` withdrawal route option
- `src/backup.ts`: Added `getImportDirHandle`, `setImportDirHandle`, `removeImportDirHandle`, `pickImportFolder`, `listImportFiles` using the same IndexedDB store as backup handles
- `src/pages/Expenses.tsx`: `ExpenseModal` Contribution/Withdrawal toggle; expense row withdrawal badge; "Funded by Goal" picker; expense row funded-by-goal badge
- `src/pages/Goals.tsx`: Optional target; withdrawal history tinting; balance summary; no-cap contribution
