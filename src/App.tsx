import { useEffect, Suspense, lazy } from "react";
import { Router, Route, Switch } from "wouter";
import { Toaster } from "sonner";
import { useStore } from "./store";
import { Layout } from "./components/Layout";

const Dashboard = lazy(() => import("./pages/Dashboard").then(m => ({ default: m.Dashboard })));
const BudgetPage = lazy(() => import("./pages/Budget").then(m => ({ default: m.BudgetPage })));
const ExpensesPage = lazy(() => import("./pages/Expenses").then(m => ({ default: m.ExpensesPage })));
const GoalsPage = lazy(() => import("./pages/Goals").then(m => ({ default: m.GoalsPage })));
const InvestmentsPage = lazy(() => import("./pages/Investments").then(m => ({ default: m.InvestmentsPage })));
const ScenariosPage = lazy(() => import("./pages/Scenarios").then(m => ({ default: m.ScenariosPage })));
const MoneyFlowPage = lazy(() => import("./pages/MoneyFlow").then(m => ({ default: m.MoneyFlowPage })));
const TrendsPage = lazy(() => import("./pages/Trends").then(m => ({ default: m.TrendsPage })));
const StatementsPage = lazy(() => import("./pages/Statements").then(m => ({ default: m.StatementsPage })));
const FinancialPlannerPage = lazy(() => import("./pages/FinancialPlanner").then(m => ({ default: m.FinancialPlannerPage })));
const SettingsPage = lazy(() => import("./pages/Settings").then(m => ({ default: m.SettingsPage })));

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center animate-pulse">
          <span className="text-primary font-bold text-sm">P</span>
        </div>
        <span className="text-xs text-muted-foreground">Loading…</span>
      </div>
    </div>
  );
}

function App() {
  const init = useStore(s => s.init);
  const loading = useStore(s => s.loading);

  useEffect(() => { init(); }, [init]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center animate-pulse">
            <span className="text-primary-foreground font-bold text-lg">P</span>
          </div>
          <span className="text-sm text-muted-foreground">Loading PocketLedger…</span>
        </div>
      </div>
    );
  }

  return (
    <Router base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <Layout>
        <Suspense fallback={<LoadingFallback />}>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/budget" component={BudgetPage} />
            <Route path="/expenses" component={ExpensesPage} />
            <Route path="/goals" component={GoalsPage} />
            <Route path="/investments" component={InvestmentsPage} />
            <Route path="/scenarios" component={ScenariosPage} />
            <Route path="/money-flow" component={MoneyFlowPage} />
            <Route path="/trends" component={TrendsPage} />
            <Route path="/statements" component={StatementsPage} />
            <Route path="/planner" component={FinancialPlannerPage} />
            <Route path="/settings" component={SettingsPage} />
          </Switch>
        </Suspense>
      </Layout>
      <Toaster richColors position="top-right" />
    </Router>
  );
}

export default App;
