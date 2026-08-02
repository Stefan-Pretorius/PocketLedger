// ─── AI-proposed actions: schema, description, execution ─────────────────────
// Actions are proposed by the AI, shown to the user for confirm/decline/edit,
// and only executed after confirmation via executeAction().

import { useStore } from "./store";
import { Colors } from "./theme";
import { formatCurrency } from "./utils";

export type AiAction =
  | { action: "createCategory"; name: string; budgetId: number; allocatedAmount?: number; frequency?: "monthly" | "fortnightly" | "weekly"; sectionId?: number }
  | { action: "updateCategoryBudget"; categoryId: number; allocatedAmount: number; frequency?: "monthly" | "fortnightly" | "weekly" }
  | { action: "deleteCategory"; categoryId: number }
  | { action: "createGoal"; name: string; targetAmount?: number; owner?: "self" | "partner" }
  | { action: "deleteGoal"; goalId: number }
  | { action: "createBankRule"; keyword: string; routeTo: "category" | "goal" | "goalWithdrawal" | "skip" | "holding" | "income" | "householdTransfer"; categoryName?: string; goalId?: number; holdingId?: number; incomeSourceName?: string }
  | { action: "deleteBankRule"; ruleId: number }
  | { action: "createBudgetSection"; budgetId: number; name: string }
  | { action: "createIncomeSource"; name: string; budgetId: number; amount: number; frequency?: "monthly" | "fortnightly" };

const FREQ = (f?: string) => (f === "weekly" || f === "fortnightly" ? f : "monthly");

/** Build the system prompt + current data context for the global "Ask AI" chat. */
export function buildAppSystemPrompt(): string {
  const s = useStore.getState();
  const budgets = s.budgets.map(b => `- budget ${b.id}: "${b.name}" (${b.month}/${b.year}, startDay ${b.startDay})`).join("\n");
  const sections = s.budgetSections.map(sec => `- section ${sec.id}: "${sec.name}"`).join("\n");
  const categories = s.categories.map(c => `- category ${c.id}: "${c.name}" (budget ${c.budgetId}${c.sectionId != null ? `, section ${c.sectionId}` : ""}, ${formatCurrency(c.allocatedAmount)}/${c.frequency ?? "monthly"})`).join("\n");
  const goals = s.goals.map(g => `- goal ${g.id}: "${g.name}" (${formatCurrency(g.currentAmount)} saved${g.targetAmount != null ? ` of ${formatCurrency(g.targetAmount)}` : ""})`).join("\n");
  const accounts = s.accounts.map(a => `- account ${a.id}: "${a.name}" (${a.type})`).join("\n");
  const holdings = s.holdings.map(h => `- holding ${h.id}: "${h.name}" (${h.type})`).join("\n");
  const incomeSources = s.incomeSources.map(i => `- income ${i.id}: "${i.name}" ${formatCurrency(i.amount)}/${i.frequency}`).join("\n");
  const rules = s.bankRules.map(r => `- rule "${r.keyword}" → ${r.routeTo}${r.categoryName ? ` (${r.categoryName})` : ""}${r.goalId != null ? ` (goal ${r.goalId})` : ""}`).join("\n");

  return `You are an AI assistant inside a personal finance tracker (PocketLedger). The user can ask questions about their finances or ask you to make changes.

CURRENT DATA:
Budgets:
${budgets || "- none"}
Sections:
${sections || "- none"}
Categories:
${categories || "- none"}
Goals:
${goals || "- none"}
Accounts:
${accounts || "- none"}
Holdings:
${holdings || "- none"}
Income sources:
${incomeSources || "- none"}
Bank mapping rules (keyword → action):
${rules || "- none"}

AVAILABLE ACTIONS (propose, never execute):
- {"action":"createCategory","name":"...","budgetId":N,"allocatedAmount":N,"frequency":"monthly|fortnightly|weekly","sectionId":N}
- {"action":"updateCategoryBudget","categoryId":N,"allocatedAmount":N,"frequency":"monthly|fortnightly|weekly"}
- {"action":"deleteCategory","categoryId":N}
- {"action":"createGoal","name":"...","targetAmount":N,"owner":"self|partner"}
- {"action":"deleteGoal","goalId":N}
- {"action":"createBankRule","keyword":"...","routeTo":"category|goal|goalWithdrawal|skip|holding|income|householdTransfer","categoryName":"...","goalId":N,"holdingId":N,"incomeSourceName":"..."}
- {"action":"deleteBankRule","ruleId":N}
- {"action":"createBudgetSection","budgetId":N,"name":"..."}
- {"action":"createIncomeSource","name":"...","budgetId":N,"amount":N,"frequency":"monthly|fortnightly"}

RESPONSE PROTOCOL — respond with ONLY ONE JSON object, no markdown fences:
- To ask the user a clarifying question: {"type":"question","text":"your question"}
- To propose one or more changes (the user must confirm before they run): {"type":"actions","actions":[{...},...]}
- For plain Q&A with no changes: {"type":"answer","text":"your answer"}
Always use real IDs from the CURRENT DATA above. Never invent IDs. If the data you need doesn't exist, ask a question or propose creating it.`;
}


export function describeAction(a: AiAction): string {
  switch (a.action) {
    case "createCategory":
      return `Create category "${a.name}"${a.allocatedAmount != null ? ` (budget ${formatMoney(a.allocatedAmount)}/yr)` : ""}`;
    case "updateCategoryBudget":
      return `Set category #${a.categoryId} budget to ${formatMoney(a.allocatedAmount)}/yr (${FREQ(a.frequency)})`;
    case "deleteCategory":
      return `Delete category #${a.categoryId}`;
    case "createGoal":
      return `Create goal "${a.name}"${a.targetAmount != null ? ` (target ${formatMoney(a.targetAmount)})` : ""}`;
    case "deleteGoal":
      return `Delete goal #${a.goalId}`;
    case "createBankRule": {
      const route = a.routeTo === "category" ? `→ ${a.categoryName ?? "category"}` : a.routeTo;
      return `Add bank rule "${a.keyword}" ${route}`;
    }
    case "deleteBankRule":
      return `Delete bank rule #${a.ruleId}`;
    case "createBudgetSection":
      return `Create budget section "${a.name}"`;
    case "createIncomeSource":
      return `Add income "${a.name}" ${formatMoney(a.amount)}/${FREQ(a.frequency)}`;
    default:
      return "Unknown action";
  }
}

function formatMoney(n: number): string {
  const abs = Math.round(Math.abs(n)).toLocaleString("en-AU");
  return `${n < 0 ? "-" : ""}$${abs}`;
}

/** Execute a confirmed action against the store. Returns a human-readable result. */
export function executeAction(a: AiAction): string {
  const s = useStore.getState();
  switch (a.action) {
    case "createCategory": {
      const cat = s.createCategory({
        budgetId: a.budgetId,
        name: a.name,
        allocatedAmount: a.allocatedAmount ?? 0,
        frequency: FREQ(a.frequency),
        color: Colors.categoryColors[Math.floor(Math.random() * Colors.categoryColors.length)],
        icon: "wallet",
        sectionId: a.sectionId,
      });
      return `Created category "${cat.name}" (id ${cat.id})`;
    }
    case "updateCategoryBudget": {
      s.updateCategory(a.categoryId, { allocatedAmount: a.allocatedAmount, frequency: FREQ(a.frequency) });
      return `Updated category #${a.categoryId} budget to ${formatMoney(a.allocatedAmount)}/yr`;
    }
    case "deleteCategory": {
      s.deleteCategory(a.categoryId);
      return `Deleted category #${a.categoryId}`;
    }
    case "createGoal": {
      const goal = s.createGoal({
        name: a.name,
        currentAmount: 0,
        targetAmount: a.targetAmount,
        owner: a.owner,
        color: Colors.categoryColors[Math.floor(Math.random() * Colors.categoryColors.length)],
        icon: "piggy-bank",
      });
      return `Created goal "${goal.name}" (id ${goal.id})`;
    }
    case "deleteGoal": {
      s.deleteGoal(a.goalId);
      return `Deleted goal #${a.goalId}`;
    }
    case "createBankRule": {
      s.upsertBankRule({
        keyword: a.keyword,
        routeTo: a.routeTo,
        categoryName: a.categoryName,
        goalId: a.goalId,
        holdingId: a.holdingId,
        incomeSourceName: a.incomeSourceName,
      });
      return `Added bank rule "${a.keyword}" → ${a.routeTo}`;
    }
    case "deleteBankRule": {
      s.deleteBankRule(a.ruleId);
      return `Deleted bank rule #${a.ruleId}`;
    }
    case "createBudgetSection": {
      const sec = s.createBudgetSection({ budgetId: a.budgetId, name: a.name, sortOrder: 0 });
      return `Created section "${sec.name}"`;
    }
    case "createIncomeSource": {
      s.createIncomeSource({
        name: a.name,
        budgetId: a.budgetId,
        amount: a.amount,
        frequency: FREQ(a.frequency) === "weekly" ? "monthly" : FREQ(a.frequency),
      });
      return `Added income "${a.name}"`;
    }
    default:
      return "Unknown action — not executed";
  }
}
