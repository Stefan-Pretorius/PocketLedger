import { useEffect } from "react";
import { Router, Route, Switch } from "wouter";
import { Toaster } from "sonner";
import { useStore } from "./store";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { MoneyFlowPage } from "./pages/MoneyFlow";
import { BudgetPage } from "./pages/Budget";
import { ExpensesPage } from "./pages/Expenses";
import { GoalsPage } from "./pages/Goals";
import { InvestmentsPage } from "./pages/Investments";
import { ScenariosPage } from "./pages/Scenarios";
import { TrendsPage } from "./pages/Trends";
import { StatementsPage } from "./pages/Statements";
import { SettingsPage } from "./pages/Settings";

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
          <Route path="/settings" component={SettingsPage} />
        </Switch>
      </Layout>
      <Toaster richColors position="top-right" />
    </Router>
  );
}

export default App;
