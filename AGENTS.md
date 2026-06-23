## Goal
- Add goal withdrawal support (spending from saved envelopes), make goal target amount optional, and add transfer pairing to declutter the expense list.

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

## Progress
### Done
- **`src/types.ts`**: Made `Goal.targetAmount` optional; added `Expense.isWithdrawal?: boolean`; added `"goalWithdrawal"` to `BankMappingRule.routeTo` union.
- **`src/store.ts`**: Added `goalWithdrawalId?: number` to `ImportedTransaction`; `previewImport` matches `"goalWithdrawal"` bank rules and passes `goalWithdrawalId` on rows; `commitImport` handles `goalWithdrawalId` (subtracts from `currentAmount`, clamp at 0, creates `isWithdrawal: true` expense); `commitImport` returns `goalWithdrawalCount`; `deleteExpense` cascades goal balance (reverses contribution or withdrawal, clamp at 0); duplicate-check skips also clear `goalWithdrawalId`.
- **Statements.tsx**: `TargetSelect` added goal withdrawal optgroup (`🔻 Goal Withdrawals`); `RuleForm` added `"goalWithdrawal"` route button (chart-2 colour, 🔻 icon) and goal picker; quick goal form makes target optional; auto-save rules create `goalWithdrawal` rules; summary chips include `goalWithdrawalCount`; import review rows show withdrawal styling (chart-2 borders, withdrawal auto-match badges).
- **Settings.tsx**: `BankRuleModal` added `"goalWithdrawal"` route option (chart-2 colour, 🔻 icon); rule list displays "🔻 Goal withdrawal" labels.
- **Expenses.tsx**: `ExpenseModal` added Contribution/Withdrawal toggle pill (`Repeat` icon, goal colour background); save function handles withdrawal balance logic (subtract from goal, clamp at 0); expense rows show `Repeat` icon and "Withdrawn" badge for withdrawals; amount text uses `text-foreground` for withdrawals (not success).
- **Goals.tsx**: `GoalModal` makes target optional (label: "Target Amount (optional)", allows empty/undefined); `ContributeModal` skips cap when no target, shows "No target set" instead of "of $X"; goal cards show progress bar only when `targetAmount` is defined; history section shows contributions (+green) and withdrawals (goal-coloured, with `-` prefix); balance summary bar shows Contributed/Withdrawn/Net amounts.
- **Dashboard.tsx**: `goalProgress` handles optional `targetAmount` (no division by zero); goal cards show progress bar only when target exists; `recentExpenses` and trend data exclude `isWithdrawal` from budget spending.

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
- (none presently — goal withdrawal feature is complete)

## Critical Context
- `BankMappingRule` uses `"goalWithdrawal"` route with the same `goalId` field — the route toggles whether it adds (goal) or subtracts (goalWithdrawal).
- `commitImport` checks `goalWithdrawalId` before `goalId` — mutually exclusive, only one wins per row.
- `deleteExpense` adjusts goal balance AFTER the expense is removed from the array but BEFORE `save()`, so `snapshot(get())` includes the updated goal.
- Goal contributions (`goalId`) still use `+=` on `currentAmount` — unchanged behavior.
- Goal withdrawals excluded from budget spending (same as contributions).
- Import review `TargetSelect` shows withdrawal options as separate optgroup "Goal Withdrawals" with 🔻 icon.
- Category picker shown alongside goal selector in contribution mode (ExpenseModal, ImportReview, ContributeModal) so contributions can be tied to a budget category.
- `commitImport` passes `categoryId` through for goal contributions so imported contributions carry the category picked in review.

## Relevant Files
- `src/types.ts`: `Goal.targetAmount?`, `Expense.isWithdrawal?`, `BankMappingRule.routeTo` with `"goalWithdrawal"`.
- `src/store.ts`: `goalWithdrawalId` on `ImportedTransaction`; `previewImport`/`commitImport`/`deleteExpense` updated.
- `src/pages/Statements.tsx`: `TargetSelect` withdrawal optgroup; `RuleForm` withdrawal route; quick goal optional target; auto-save `goalWithdrawal` rules.
- `src/pages/Settings.tsx`: `BankRuleModal` withdrawal route option.
- `src/pages/Expenses.tsx`: `ExpenseModal` Contribution/Withdrawal toggle; expense row withdrawal badge.
- `src/pages/Goals.tsx`: Optional target; withdrawal history tinting; balance summary; no-cap contribution.
- `src/pages/Dashboard.tsx`: Undefined target handling; exclude withdrawals from budget spending.
