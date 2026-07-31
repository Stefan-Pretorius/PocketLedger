import { useState, useMemo, useCallback, useRef, memo } from "react";
import { useStore } from "../store";
import { formatCurrency, formatDate, getBudgetDateRange } from "../utils";
import { Card, Button, Input, SectionHeader } from "../components/ui";
import { PageHeader } from "../components/Layout";
import {
  Home, TrendingUp, Calculator, PiggyBank, Landmark, Shield,
  ChevronRight, DollarSign, Clock, BarChart3, SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  calculateSaStampDuty, calculateSaLandTax,
  calculateTotalIncomeTax, getTaxYearRates, getMarginalRate,
  calculateSalarySacrificeBenefit, modelSuperStrategy,
  getSuperCaps, calculateCarryForward, calculateBringForward,
} from "../tax";
import { normalRandom } from "../monte-carlo";

// ─── Tab Navigation ─────────────────────────────────────────────────────────

type ScenarioTab = "rent-vs-buy" | "super-strategy" | "investment-property" | "fire" | "lump-sum" | "pivot-optimizer";

const TABS: { id: ScenarioTab; label: string; icon: React.ElementType }[] = [
  { id: "rent-vs-buy", label: "Rent vs Buy", icon: Home },
  { id: "super-strategy", label: "Super Strategy", icon: Landmark },
  { id: "investment-property", label: "Investment Property", icon: TrendingUp },
  { id: "fire", label: "FIRE Calculator", icon: Calculator },
  { id: "lump-sum", label: "Lump Sum", icon: DollarSign },
  { id: "pivot-optimizer", label: "Pivot Optimizer", icon: SlidersHorizontal },
];

// ─── Age Pension helpers ─────────────────────────────────────────────────────
// 2026-27 rates (couple combined, homeowner)
const PENSION_MAX_COUPLE = 44855;
const PENSION_ASSET_LOWER_HOMEOWNER = 419000;
const PENSION_ASSET_UPPER_HOMEOWNER = 954000;
const PENSION_ASSET_LOWER_NONHOMEOWNER = 643500;
const PENSION_ASSET_UPPER_NONHOMEOWNER = 1178500;
const PENSION_TAPER_PER_1000 = 78; // $/yr per $1,000 over lower threshold

function calcAgePension(assessableAssets: number, isHomeowner: boolean): number {
  const lower = isHomeowner ? PENSION_ASSET_LOWER_HOMEOWNER : PENSION_ASSET_LOWER_NONHOMEOWNER;
  const upper = isHomeowner ? PENSION_ASSET_UPPER_HOMEOWNER : PENSION_ASSET_UPPER_NONHOMEOWNER;
  if (assessableAssets <= lower) return PENSION_MAX_COUPLE;
  if (assessableAssets >= upper) return 0;
  const reduction = ((assessableAssets - lower) / 1000) * PENSION_TAPER_PER_1000;
  return Math.max(0, PENSION_MAX_COUPLE - reduction);
}

// ─── Scenario persistence ────────────────────────────────────────────────────

function usePlannerInputs<T extends Record<string, number | boolean | string>>(
  tabId: string,
  defaults: T,
): [T, (patch: Partial<T>) => void] {
  const stored = useStore(s => s.plannerInputs[tabId]);
  const setPlannerInputs = useStore(s => s.setPlannerInputs);
  const defaultsRef = useRef(defaults);
  const inputs = useMemo(() =>
    (stored ? { ...defaultsRef.current, ...stored } : defaultsRef.current) as T,
    [stored],
  );
  const setPartial = useCallback((patch: Partial<T>) => {
    setPlannerInputs(tabId, patch as unknown as Record<string, number | boolean | string>);
  }, [tabId, setPlannerInputs]);
  return [inputs, setPartial];
}

const ScenarioBar = memo(function ScenarioBar({ tabId, currentInputs }: { tabId: string; currentInputs: Record<string, number | boolean | string> }) {
  const allScenarios = useStore(s => s.plannerScenarios);
  const savePlannerScenario = useStore(s => s.savePlannerScenario);
  const deletePlannerScenario = useStore(s => s.deletePlannerScenario);
  const setPlannerInputs = useStore(s => s.setPlannerInputs);
  const scenarios = useMemo(() => allScenarios.filter(sc => sc.tabId === tabId), [allScenarios, tabId]);
  const [scenarioName, setScenarioName] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const selected = selectedId ? scenarios.find(s => s.id === selectedId) : null;

  const handleSave = () => {
    if (!scenarioName.trim()) {
      toast.error("Enter a scenario name");
      return;
    }
    savePlannerScenario(tabId, scenarioName.trim(), currentInputs);
    toast.success(`Saved "${scenarioName.trim()}"`);
    setScenarioName("");
  };

  const handleLoad = () => {
    if (!selected) return;
    setPlannerInputs(tabId, selected.inputs);
    toast.success(`Loaded "${selected.name}"`);
  };

  const handleDelete = () => {
    if (!selected) return;
    deletePlannerScenario(selected.id);
    toast.success(`Deleted "${selected.name}"`);
    setSelectedId(null);
  };

  return (
    <div className="flex items-center gap-2 bg-muted/50 rounded-xl p-2.5 flex-wrap">
      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mr-1">Scenario</span>
      <input
        type="text"
        value={scenarioName}
        onChange={e => setScenarioName(e.target.value)}
        placeholder="Name..."
        className="h-7 px-2 rounded-lg bg-background border border-border text-xs text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary w-28"
        onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
      />
      <button onClick={handleSave}
        className="h-7 px-2.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90 transition-opacity">
        Save
      </button>
      <div className="w-px h-5 bg-border mx-1" />
      <select
        value={selectedId ?? ""}
        onChange={e => setSelectedId(e.target.value ? parseInt(e.target.value) : null)}
        className="h-7 px-2 rounded-lg bg-background border border-border text-xs text-foreground outline-none focus:border-primary max-w-[140px]"
      >
        <option value="">Load saved…</option>
        {scenarios.map(sc => (
          <option key={sc.id} value={sc.id}>{sc.name}</option>
        ))}
      </select>
      <button onClick={handleLoad} disabled={!selected}
        className="h-7 px-2.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-medium hover:opacity-90 transition-opacity disabled:opacity-30">
        Load
      </button>
      <button onClick={handleDelete} disabled={!selected}
        className="h-7 px-2.5 rounded-lg bg-destructive/10 text-destructive text-[11px] font-medium hover:bg-destructive/20 transition-colors disabled:opacity-30">
        Delete
      </button>
    </div>
  );
});

// ─── Default inputs per tab ────────────────────────────────────────────────

const RENT_VS_BUY_DEFAULTS = {
  currentAge: 30, retirementAge: 65, targetAge: 90, annualIncome: 120000,
  weeklyRent: 550, rentIncreasePct: 3, investReturnPct: 8,
  purchasePrice: 650000, depositPct: 20, mortgageRate: 6.2, mortgageTerm: 30,
  capitalGrowthPct: 4, isFirstHomeBuyer: false, isPPR: true,
  councilRates: 2200, homeInsurance: 2000, maintenancePct: 1, strataBodyCorp: 0,
  inflationPct: 3,
  downsizeAge: 65, downsizeAction: "buy",
  downsizePurchasePrice: 400000, downsizeWeeklyRent: 350,
  downsizeCouncilRates: 1500, downsizeHomeInsurance: 1400,
  downsizeMaintenancePct: 1, downsizeStrataBodyCorp: 0,
  cgtRatePct: 22.5, includePension: true,
};

const SUPER_DEFAULTS = { annualReturnPct: 7, yearsToProject: 20 };

const INVESTMENT_PROPERTY_DEFAULTS = {
  purchasePrice: 550000, depositPct: 20, mortgageRate: 6.2, weeklyRent: 450,
  capitalGrowthPct: 4, rentIncreasePct: 3, isPreReform: true, years: 20,
};

const FIRE_DEFAULTS = {
  annualReturnPct: 8, annualSpendingInput: 0, selfSavingsRate: 0, partnerSavingsRate: 0,
  withdrawalRatePct: 4, inflationPct: 3, showMonthly: false,
};

const LUMP_SUM_DEFAULTS = {
  lumpSum: 100000, annualIncome: 120000, spouseIncome: 60000, ccUsedThisYear: 0,
  carryForwardAmount: 0, mortgageBalance: 0, mortgageRate: 6.2, horizonYears: 10,
  superReturnPct: 7, investReturnPct: 8,
};

const PIVOT_DEFAULTS = {
  retirementAge: 65,
  mortgageBalance: 0,
  mortgageRate: 6.2,
  spendingCut: 0,
  salarySacrificeExtra: 0,
  mortgageVsInvest: 50,
  giftToSpouse: 0,
  portfolioReturnPct: 8,
};

// ─── Rent vs Buy ────────────────────────────────────────────────────────────

function RentVsBuy() {
  const selfAnnualSalary = useStore(s => s.selfAnnualSalary);
  const [i, setI] = usePlannerInputs("rent-vs-buy", RENT_VS_BUY_DEFAULTS);

  const result = useMemo(() => {
    const years = i.targetAge - i.currentAge;
    if (years <= 0) return null;

    const deposit = i.purchasePrice * (i.depositPct / 100);
    const loanAmount = i.purchasePrice - deposit;
    const stampDutyResult = calculateSaStampDuty(i.purchasePrice, { isPrincipalPlace: i.isPPR as boolean, isFirstHomeBuyer: i.isFirstHomeBuyer as boolean });
    const totalUpfront = deposit + stampDutyResult.netDuty + 1500;

    const monthlyRate = i.mortgageRate / 100 / 12;
    const totalPayments = i.mortgageTerm * 12;
    const monthlyRepayment = loanAmount > 0
      ? loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, totalPayments))
        / (Math.pow(1 + monthlyRate, totalPayments) - 1)
      : 0;

    const cgtRate = i.cgtRatePct / 100;
    const investReturn = i.investReturnPct / 100;

    let renterPortfolio = totalUpfront;
    let buyerPortfolio = 0;
    let propertyValue = i.purchasePrice;
    let loanBalance = loanAmount;
    let currentWeeklyRent = i.weeklyRent;

    let downsizeExecuted = false;
    let newPropertyValue = 0;
    let newLoanBalance = 0;
    let downsizeProceeds = 0;
    let downsizeYear: number | null = null;
    const actualDownsizeAge = Math.min(i.downsizeAge, i.retirementAge);

    let totalRentPaid = 0;
    let totalMortgagePaid = 0;
    let totalPropertyCostsPaid = 0;
    let totalCGTPaid = 0;

    const rentPath: number[] = [];
    const buyPath: number[] = [];
    const renterPensionPath: number[] = [];
    const buyerPensionPath: number[] = [];
    const rentPerYear: number[] = [];
    const mortgagePerYear: number[] = [];
    const equityPerYear: number[] = [];
    const propertyValuePerYear: number[] = [];
    const interestPerYear: number[] = [];
    const principalPerYear: number[] = [];
    const propertyCostsPerYear: number[] = [];
    const rentChangePerYear: number[] = [];

    for (let y = 0; y <= years; y++) {
      const age = i.currentAge + y;
      const inflationFactor = Math.pow(1 + i.inflationPct / 100, y);
      const yearIncome = i.annualIncome * inflationFactor;

      const buyerEquity = !downsizeExecuted ? Math.max(0, propertyValue - loanBalance) : 0;
      const buyerNewEquity = downsizeExecuted && i.downsizeAction === "buy"
        ? Math.max(0, newPropertyValue - newLoanBalance) : 0;

      // Renter: home = no asset (homeowner = false for pension)
      const renterAssessable = renterPortfolio;
      const renterPension = (age >= i.retirementAge && i.includePension)
        ? calcAgePension(renterAssessable, false) : 0;

      // Buyer: home EXCLUDED from assets test, only portfolio is assessable
      const buyerHomeValue = !downsizeExecuted ? propertyValue
        : (i.downsizeAction === "buy" ? newPropertyValue : 0);
      const buyerAssessable = buyerPortfolio;
      const buyerIsHomeowner = i.downsizeAction !== "rent" || !downsizeExecuted;
      const buyerPension = (age >= i.retirementAge && i.includePension && buyerIsHomeowner)
        ? calcAgePension(buyerAssessable, true) : 0;

      rentPath.push(renterPortfolio);
      buyPath.push(buyerEquity + buyerNewEquity + buyerPortfolio);
      renterPensionPath.push(renterPension);
      buyerPensionPath.push(buyerPension);

      if (y === 0) {
        rentPerYear.push(currentWeeklyRent * 52);
        mortgagePerYear.push(0);
        equityPerYear.push(buyerEquity + buyerNewEquity);
        propertyValuePerYear.push(!downsizeExecuted ? propertyValue : (i.downsizeAction === "buy" ? newPropertyValue : 0));
        interestPerYear.push(0);
        principalPerYear.push(0);
        propertyCostsPerYear.push(0);
        rentChangePerYear.push(0);
        continue;
      }

      // Downsize event
      if (age >= actualDownsizeAge && i.isPPR && i.downsizeAction !== "none" && !downsizeExecuted) {
        downsizeExecuted = true;
        downsizeYear = y;
        downsizeProceeds = Math.max(0, propertyValue - loanBalance);
        loanBalance = 0;
        propertyValue = 0;

        if (i.downsizeAction === "buy") {
          const newDuty = calculateSaStampDuty(i.downsizePurchasePrice, { isPrincipalPlace: true, isFirstHomeBuyer: false });
          const needed = i.downsizePurchasePrice + newDuty.netDuty;
          if (downsizeProceeds >= needed) {
            newPropertyValue = i.downsizePurchasePrice;
            newLoanBalance = 0;
            buyerPortfolio += downsizeProceeds - needed;
          } else {
            newPropertyValue = i.downsizePurchasePrice;
            newLoanBalance = needed - downsizeProceeds;
          }
        } else {
          buyerPortfolio += downsizeProceeds;
          currentWeeklyRent = i.downsizeWeeklyRent;
        }
      }

      // ─── Costs ───
      let yearMortgagePayment = 0;
      let yearPropertyCosts = 0;
      let yearDownsizeCosts = 0;
      let yearInterestPaid = 0;
      let yearPrincipalPaid = 0;

      if (!downsizeExecuted) {
        yearPropertyCosts = (i.councilRates + i.homeInsurance + i.strataBodyCorp) * inflationFactor
          + propertyValue * (i.maintenancePct / 100);
        totalPropertyCostsPaid += yearPropertyCosts;

        if (loanBalance > 0) {
          yearMortgagePayment = Math.min(monthlyRepayment * 12, loanBalance * (1 + monthlyRate));
          const yearInterestCalc = loanBalance * (i.mortgageRate / 100);
          yearInterestPaid = yearInterestCalc;
          yearPrincipalPaid = yearMortgagePayment - yearInterestCalc;
          loanBalance = Math.max(0, loanBalance - yearPrincipalPaid);
          totalMortgagePaid += yearMortgagePayment;
        }
        propertyValue = propertyValue * (1 + i.capitalGrowthPct / 100);
      } else if (i.downsizeAction === "buy") {
        yearDownsizeCosts = (i.downsizeCouncilRates + i.downsizeHomeInsurance + i.downsizeStrataBodyCorp) * inflationFactor
          + newPropertyValue * (i.downsizeMaintenancePct / 100);
        if (newLoanBalance > 0) {
          const newYearMortgage = Math.min(monthlyRepayment * 12, newLoanBalance * (1 + monthlyRate));
          const newYearInterest = newLoanBalance * (i.mortgageRate / 100);
          yearInterestPaid = newYearInterest;
          yearPrincipalPaid = newYearMortgage - newYearInterest;
          newLoanBalance = Math.max(0, newLoanBalance - yearPrincipalPaid);
          yearDownsizeCosts += newYearMortgage;
          totalMortgagePaid += newYearMortgage;
        }
        newPropertyValue = newPropertyValue * (1 + i.capitalGrowthPct / 100);
        totalPropertyCostsPaid += yearDownsizeCosts;
      } else if (i.downsizeAction === "rent") {
        yearDownsizeCosts = currentWeeklyRent * 52;
        totalRentPaid += yearDownsizeCosts;
      }

      // ─── Renter ───
      const yearRent = currentWeeklyRent * 52;
      totalRentPaid += yearRent;
      const renterGrossGain = renterPortfolio * investReturn;
      const renterTax = renterGrossGain * cgtRate;
      totalCGTPaid += renterTax;
      const renterSurplus = yearIncome - yearRent + renterPension;
      renterPortfolio = Math.max(0, renterPortfolio + renterGrossGain - renterTax + renterSurplus);

      // ─── Buyer ───
      const totalBuyerHousingCost = yearMortgagePayment + yearPropertyCosts + yearDownsizeCosts;
      const buyerGrossGain = buyerPortfolio * investReturn;
      const buyerTax = buyerGrossGain * cgtRate;
      totalCGTPaid += buyerTax;
      const buyerSurplus = yearIncome - totalBuyerHousingCost + buyerPension;
      buyerPortfolio = Math.max(0, buyerPortfolio + buyerGrossGain - buyerTax + buyerSurplus);

      const nextRentVal = currentWeeklyRent * (1 + i.rentIncreasePct / 100) * 52;
      const prevRentVal = rentPerYear[rentPerYear.length - 1] || nextRentVal;
      const displayPropertyCosts = !downsizeExecuted
        ? yearPropertyCosts
        : (i.downsizeAction === "buy"
            ? (i.downsizeCouncilRates + i.downsizeHomeInsurance + i.downsizeStrataBodyCorp) * inflationFactor
              + newPropertyValue * (i.downsizeMaintenancePct / 100)
            : 0);
      rentPerYear.push(nextRentVal);
      mortgagePerYear.push(yearMortgagePayment + yearDownsizeCosts);
      equityPerYear.push(!downsizeExecuted ? Math.max(0, propertyValue - loanBalance)
        : (i.downsizeAction === "buy" ? Math.max(0, newPropertyValue - newLoanBalance) : 0));
      propertyValuePerYear.push(!downsizeExecuted ? propertyValue
        : (i.downsizeAction === "buy" ? newPropertyValue : 0));
      interestPerYear.push(yearInterestPaid);
      principalPerYear.push(yearPrincipalPaid);
      propertyCostsPerYear.push(displayPropertyCosts);
      rentChangePerYear.push(nextRentVal - prevRentVal);

      currentWeeklyRent *= (1 + i.rentIncreasePct / 100);
    }

    const totalRenterPension = renterPensionPath.reduce((s, v) => s + v, 0);
    const totalBuyerPension = buyerPensionPath.reduce((s, v) => s + v, 0);
    const totalPensionReceived = totalRenterPension + totalBuyerPension;

    const breakevenYear = buyPath.findIndex((v, i) => i > 0 && v > rentPath[i]);

    return {
      rentPath, buyPath,
      renterPensionPath, buyerPensionPath,
      stampDuty: stampDutyResult.netDuty,
      monthlyRepayment,
      breakevenYear: breakevenYear > 0 ? breakevenYear : null,
      finalRentNetWorth: rentPath[years],
      finalBuyNetWorth: buyPath[years],
      totalRentPaid, totalMortgagePaid, totalPropertyCostsPaid,
      totalCGTPaid, totalPensionReceived,
      totalRenterPension, totalBuyerPension,
      downsizeYear, downsizeProceeds,
      rentPerYear, mortgagePerYear, equityPerYear, propertyValuePerYear,
      interestPerYear, principalPerYear, propertyCostsPerYear, rentChangePerYear,
      renterAssessableAtRetirement: rentPath[Math.min(i.retirementAge - i.currentAge, years)],
      buyerPortfolioAtRetirement: buyPath[Math.min(i.retirementAge - i.currentAge, years)],
      renterPensionAtRetirement: renterPensionPath[Math.min(i.retirementAge - i.currentAge, years)],
      buyerPensionAtRetirement: buyerPensionPath[Math.min(i.retirementAge - i.currentAge, years)],
    };
  }, [i]);

  if (!result) {
    return <div className="text-sm text-muted-foreground p-4">Target age must be greater than current age.</div>;
  }

  return (
    <div className="space-y-4">
      <ScenarioBar tabId="rent-vs-buy" currentInputs={i} />
      {/* Row 1: Personal Details + Rent */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="space-y-3">
          <SectionHeader title="Your Details" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Current Age" type="number" value={i.currentAge}
              onChange={v => setI({ currentAge: parseInt(v) || 30 })} />
            <Input label="Retirement Age" type="number" value={i.retirementAge}
              onChange={v => setI({ retirementAge: parseInt(v) || 65 })} />
            <Input label="Compare Until Age" type="number" value={i.targetAge}
              onChange={v => setI({ targetAge: parseInt(v) || 90 })} />
            <Input label="Annual Household Income" type="number" value={i.annualIncome}
              onChange={v => setI({ annualIncome: parseFloat(v) || 0 })} prefix="$" />
          </div>
        </Card>

        <Card className="space-y-3">
          <SectionHeader title="Rent + Invest" />
          <Input label="Weekly Rent" type="number" value={i.weeklyRent}
            onChange={v => setI({ weeklyRent: parseFloat(v) || 0 })} prefix="$" />
          <Input label="Annual Rent Increase %" type="number" value={i.rentIncreasePct}
            onChange={v => setI({ rentIncreasePct: parseFloat(v) || 0 })} prefix="%" />
          <Input label="Investment Return %" type="number" value={i.investReturnPct}
            onChange={v => setI({ investReturnPct: parseFloat(v) || 0 })} prefix="%" />
          <p className="text-[10px] text-muted-foreground">
            Deposit money + yearly savings difference invested at {i.investReturnPct}% p.a.
          </p>
        </Card>
      </div>

      {/* Row 2: Buy + Property Costs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="space-y-3">
          <SectionHeader title="Buy Family Home" />
          <Input label="Purchase Price" type="number" value={i.purchasePrice}
            onChange={v => setI({ purchasePrice: parseFloat(v) || 0 })} prefix="$" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Deposit %" type="number" value={i.depositPct}
              onChange={v => setI({ depositPct: parseFloat(v) || 0 })} prefix="%" />
            <Input label="Mortgage Rate %" type="number" value={i.mortgageRate}
              onChange={v => setI({ mortgageRate: parseFloat(v) || 0 })} prefix="%" />
            <Input label="Mortgage Term (yrs)" type="number" value={i.mortgageTerm}
              onChange={v => setI({ mortgageTerm: parseInt(v) || 30 })} />
            <Input label="Capital Growth %" type="number" value={i.capitalGrowthPct}
              onChange={v => setI({ capitalGrowthPct: parseFloat(v) || 0 })} prefix="%" />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={i.isFirstHomeBuyer as boolean}
                onChange={e => setI({ isFirstHomeBuyer: e.target.checked })}
                className="rounded border-border" />
              First Home Buyer
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={i.isPPR as boolean}
                onChange={e => setI({ isPPR: e.target.checked })}
                className="rounded border-border" />
              Principal Place
            </label>
          </div>
        </Card>

        <Card className="space-y-3">
          <SectionHeader title="Ownership Costs (Annual)" />
          <p className="text-[10px] text-muted-foreground">All costs inflate at the inflation rate below.</p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Council Rates" type="number" value={i.councilRates}
              onChange={v => setI({ councilRates: parseFloat(v) || 0 })} prefix="$" />
            <Input label="Home Insurance" type="number" value={i.homeInsurance}
              onChange={v => setI({ homeInsurance: parseFloat(v) || 0 })} prefix="$" />
            <Input label="Maintenance %" type="number" value={i.maintenancePct}
              onChange={v => setI({ maintenancePct: parseFloat(v) || 0 })} prefix="%" sublabel="of property value" />
            <Input label="Strata / Body Corp" type="number" value={i.strataBodyCorp}
              onChange={v => setI({ strataBodyCorp: parseFloat(v) || 0 })} prefix="$" />
          </div>
          <div className="max-w-[140px]">
            <Input label="Inflation %" type="number" value={i.inflationPct}
              onChange={v => setI({ inflationPct: parseFloat(v) || 0 })} prefix="%" />
          </div>
        </Card>
      </div>

      {/* Downsizing */}
      <Card className="space-y-3">
        <SectionHeader title="Downsize" />
        <p className="text-[10px] text-muted-foreground">
          Sell the family home (PPR = no CGT) and downsize. Sale proceeds net of any remaining mortgage.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Downsize at Age" type="number" value={i.downsizeAge}
            onChange={v => setI({ downsizeAge: parseInt(v) || 65 })} />
          <div className="flex items-end gap-2">
            {([
              { id: "buy" as const, label: "Buy Smaller" },
              { id: "rent" as const, label: "Rent Smaller" },
              { id: "none" as const, label: "Don't Downsize" },
            ]).map(opt => (
              <button
                key={opt.id}
                onClick={() => setI({ downsizeAction: opt.id })}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  i.downsizeAction === opt.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {i.downsizeAction === "buy" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
              <Input label="Downsized Purchase Price" type="number" value={i.downsizePurchasePrice}
                onChange={v => setI({ downsizePurchasePrice: parseFloat(v) || 0 })} prefix="$" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Council Rates" type="number" value={i.downsizeCouncilRates}
                onChange={v => setI({ downsizeCouncilRates: parseFloat(v) || 0 })} prefix="$" />
              <Input label="Home Insurance" type="number" value={i.downsizeHomeInsurance}
                onChange={v => setI({ downsizeHomeInsurance: parseFloat(v) || 0 })} prefix="$" />
              <Input label="Maintenance %" type="number" value={i.downsizeMaintenancePct}
                onChange={v => setI({ downsizeMaintenancePct: parseFloat(v) || 0 })} prefix="%" />
              <Input label="Strata / Body Corp" type="number" value={i.downsizeStrataBodyCorp}
                onChange={v => setI({ downsizeStrataBodyCorp: parseFloat(v) || 0 })} prefix="$" />
            </div>
          </div>
        )}

        {i.downsizeAction === "rent" && (
          <div className="max-w-[200px]">
            <Input label="Weekly Rent (Smaller Place)" type="number" value={i.downsizeWeeklyRent}
              onChange={v => setI({ downsizeWeeklyRent: parseFloat(v) || 0 })} prefix="$" />
          </div>
        )}
      </Card>

      {/* Tax & Pension */}
      <Card className="space-y-3">
        <SectionHeader title="Tax & Age Pension" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Effective CGT Rate %" type="number" value={i.cgtRatePct}
            onChange={v => setI({ cgtRatePct: parseFloat(v) || 0 })} prefix="%"
            sublabel="50% discount × marginal rate" />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={i.includePension as boolean}
                onChange={e => setI({ includePension: e.target.checked })}
                className="rounded border-border" />
              Include Age Pension
            </label>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Pension is means-tested on assessable assets. Home (PPR) is EXCLUDED from the assets test, so buyers may qualify for more pension. 
          Renter's investments ARE assessable — full pension below {formatCurrency(PENSION_ASSET_LOWER_NONHOMEOWNER)}, none above {formatCurrency(PENSION_ASSET_UPPER_NONHOMEOWNER)} (couple, non-homeowner).
          Maximum pension: {formatCurrency(PENSION_MAX_COUPLE)}/yr.
        </p>
      </Card>

      {/* Results */}
      <Card className="space-y-3">
        <SectionHeader title="Results" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Stamp Duty</p>
            <p className="text-sm font-bold text-foreground">{formatCurrency(result.stampDuty)}</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Monthly Mortgage</p>
            <p className="text-sm font-bold text-foreground">{formatCurrency(result.monthlyRepayment)}</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Total CGT Paid</p>
            <p className="text-sm font-bold text-warning">{formatCurrency(result.totalCGTPaid)}</p>
          </div>
          {i.includePension && (
            <div className="bg-muted rounded-xl p-3 text-center">
              <p className="text-[10px] text-muted-foreground">Total Pension Received</p>
              <p className="text-sm font-bold text-success">{formatCurrency(result.totalPensionReceived)}</p>
            </div>
          )}
          {result.downsizeYear !== null && (
            <div className="bg-muted rounded-xl p-3 text-center">
              <p className="text-[10px] text-muted-foreground">Downsize at Age {i.currentAge + result.downsizeYear}</p>
              <p className="text-sm font-bold text-success">{formatCurrency(result.downsizeProceeds)}</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Net Worth at Age {i.targetAge} (Rent)</p>
            <p className={cn("text-sm font-bold", result.finalRentNetWorth >= result.finalBuyNetWorth ? "text-success" : "text-foreground")}>
              {formatCurrency(result.finalRentNetWorth)}
            </p>
            <p className="text-[9px] text-muted-foreground mt-0.5">Total rent: {formatCurrency(result.totalRentPaid)}</p>
            {i.includePension && <p className="text-[9px] text-success mt-0.5">Pension: {formatCurrency(result.totalRenterPension)}</p>}
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Net Worth at Age {i.targetAge} (Buy)</p>
            <p className={cn("text-sm font-bold", result.finalBuyNetWorth >= result.finalRentNetWorth ? "text-success" : "text-foreground")}>
              {formatCurrency(result.finalBuyNetWorth)}
            </p>
            <p className="text-[9px] text-muted-foreground mt-0.5">Total mortgage: {formatCurrency(result.totalMortgagePaid)}</p>
            {i.includePension && <p className="text-[9px] text-success mt-0.5">Pension: {formatCurrency(result.totalBuyerPension)}</p>}
          </div>
        </div>

        {i.includePension && (() => {
          const renterAssets = result.renterAssessableAtRetirement;
          const buyerAssets = result.buyerPortfolioAtRetirement;
          const renterPensionYr = result.renterPensionAtRetirement;
          const buyerPensionYr = result.buyerPensionAtRetirement;
          const pensionGap = buyerPensionYr - renterPensionYr;
          const pensionGapLifetime = result.totalBuyerPension - result.totalRenterPension;
          const renterBelowLower = renterAssets < PENSION_ASSET_LOWER_NONHOMEOWNER;
          const renterAboveUpper = renterAssets > PENSION_ASSET_UPPER_NONHOMEOWNER;
          const buyerBelowLower = buyerAssets < PENSION_ASSET_LOWER_HOMEOWNER;
          const buyerAboveUpper = buyerAssets > PENSION_ASSET_UPPER_HOMEOWNER;

          return (
            <div className="bg-muted/50 rounded-xl p-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                <p className="text-xs font-medium text-foreground">Age Pension Analysis (at retirement age {i.retirementAge})</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                <div className="bg-background rounded-lg p-2.5 space-y-1.5">
                  <p className="font-medium text-primary">Renter (Non-Homeowner)</p>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Investments (assessable)</span>
                    <span className="text-foreground">{formatCurrency(renterAssets)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Threshold</span>
                    <span className="text-muted-foreground">{formatCurrency(PENSION_ASSET_LOWER_NONHOMEOWNER)} – {formatCurrency(PENSION_ASSET_UPPER_NONHOMEOWNER)}</span>
                  </div>
                  <div className="flex justify-between font-medium border-t border-border pt-1">
                    <span className="text-foreground">Annual Pension</span>
                    <span className={cn(renterPensionYr > 0 ? "text-success" : "text-destructive")}>
                      {formatCurrency(renterPensionYr)}/yr
                    </span>
                  </div>
                  {renterAboveUpper && (
                    <p className="text-[9px] text-destructive">Investments above {formatCurrency(PENSION_ASSET_UPPER_NONHOMEOWNER)} — no pension</p>
                  )}
                  {renterBelowLower && (
                    <p className="text-[9px] text-success">Below threshold — full pension</p>
                  )}
                </div>

                <div className="bg-background rounded-lg p-2.5 space-y-1.5">
                  <p className="font-medium text-success">Buyer (Homeowner)</p>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Portfolio (assessable)</span>
                    <span className="text-foreground">{formatCurrency(buyerAssets)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Threshold</span>
                    <span className="text-muted-foreground">{formatCurrency(PENSION_ASSET_LOWER_HOMEOWNER)} – {formatCurrency(PENSION_ASSET_UPPER_HOMEOWNER)}</span>
                  </div>
                  <div className="flex justify-between font-medium border-t border-border pt-1">
                    <span className="text-foreground">Annual Pension</span>
                    <span className={cn(buyerPensionYr > 0 ? "text-success" : "text-destructive")}>
                      {formatCurrency(buyerPensionYr)}/yr
                    </span>
                  </div>
                  {buyerAboveUpper && (
                    <p className="text-[9px] text-destructive">Portfolio above {formatCurrency(PENSION_ASSET_UPPER_HOMEOWNER)} — no pension</p>
                  )}
                  {buyerBelowLower && (
                    <p className="text-[9px] text-success">Below threshold — full pension</p>
                  )}
                  <p className="text-[9px] text-success">Home (PPR) excluded from assets test</p>
                </div>
              </div>

              {pensionGap !== 0 && (
                <div className={cn("rounded-lg p-2.5 text-[11px]",
                  pensionGap > 0 ? "bg-success/10" : "bg-warning/10")}>
                  <p className={cn("font-medium", pensionGap > 0 ? "text-success" : "text-warning")}>
                    Pension Gap: {formatCurrency(Math.abs(pensionGap))}/yr {pensionGap > 0 ? "in favour of buying" : "in favour of renting"}
                  </p>
                  <p className="text-muted-foreground mt-0.5">
                    Over retirement, buying receives {formatCurrency(pensionGapLifetime)} more in total pension.
                    {pensionGap > 0 && " The home is a pension 'safe haven' — excluded from the assets test, while renter investments reduce pension entitlements."}
                    {pensionGap < 0 && " In this scenario the renter's lower portfolio qualifies for more pension."}
                  </p>
                </div>
              )}

              {pensionGap === 0 && renterPensionYr === 0 && buyerPensionYr === 0 && (
                <div className="bg-muted rounded-lg p-2.5 text-[11px] text-muted-foreground">
                  Both scenarios have too many assessable assets to qualify for Age Pension at retirement.
                </div>
              )}
            </div>
          );
        })()}

        {result.breakevenYear && (
          <div className="bg-info/10 rounded-lg p-3 text-xs text-info">
            Buying overtakes renting at age {i.currentAge + result.breakevenYear} (year {result.breakevenYear}).
            After that point, buying is financially better.
          </div>
        )}
        {!result.breakevenYear && (
          <div className="bg-primary/10 rounded-lg p-3 text-xs text-primary">
            Renting remains financially better throughout the entire {i.targetAge - i.currentAge}-year period.
          </div>
        )}

        {/* Year-by-year comparison */}
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Age</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Annual Rent</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Rent Δ</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Interest</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Principal</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Costs</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Equity</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Value</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Rent NW</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Buy NW</th>
                {i.includePension && (
                  <>
                    <th className="text-right py-2 px-2 text-muted-foreground font-medium">R Pen.</th>
                    <th className="text-right py-2 px-2 text-muted-foreground font-medium">B Pen.</th>
                  </>
                )}
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Winner</th>
              </tr>
            </thead>
            <tbody>
              {result.rentPath.map((rentVal, idx) => {
                if (idx % 5 !== 0 && idx !== result.rentPath.length - 1 && idx !== result.downsizeYear) return null;
                const buyVal = result.buyPath[idx];
                const rentPension = result.renterPensionPath[idx];
                const buyPension = result.buyerPensionPath[idx];
                const rent = result.rentPerYear[idx];
                const mortgage = result.mortgagePerYear[idx];
                const equity = result.equityPerYear[idx];
                const propVal = result.propertyValuePerYear[idx];
                const interest = result.interestPerYear[idx];
                const principal = result.principalPerYear[idx];
                const propCosts = result.propertyCostsPerYear[idx];
                const rentChange = result.rentChangePerYear[idx];
                const hasMortgage = interest > 0 || principal > 0;
                return (
                  <tr key={idx} className={cn("border-b border-border/50",
                    idx === result.downsizeYear && "bg-info/5")}>
                    <td className="py-2 px-2 font-medium whitespace-nowrap">
                      {i.currentAge + idx}
                      {idx === result.downsizeYear && <span className="ml-1 text-info text-[10px]">⬇</span>}
                    </td>
                    <td className="py-2 px-2 text-right text-warning whitespace-nowrap">{formatCurrency(rent)}</td>
                    <td className={cn("py-2 px-2 text-right whitespace-nowrap",
                      rentChange > 0 ? "text-warning" : "text-muted-foreground")}>
                      {rentChange > 0 ? `+${formatCurrency(rentChange)}` : "—"}
                    </td>
                    <td className={cn("py-2 px-2 text-right whitespace-nowrap",
                      hasMortgage ? "text-destructive" : "text-muted-foreground")}>
                      {hasMortgage ? formatCurrency(interest) : "—"}
                    </td>
                    <td className={cn("py-2 px-2 text-right whitespace-nowrap",
                      hasMortgage ? "text-success" : "text-muted-foreground")}>
                      {hasMortgage ? formatCurrency(principal) : "—"}
                    </td>
                    <td className="py-2 px-2 text-right text-muted-foreground whitespace-nowrap">
                      {propCosts > 0 ? formatCurrency(propCosts) : "—"}
                    </td>
                    <td className="py-2 px-2 text-right text-primary whitespace-nowrap">
                      {equity > 0 ? formatCurrency(equity) : "—"}
                    </td>
                    <td className="py-2 px-2 text-right text-muted-foreground whitespace-nowrap">
                      {propVal > 0 ? formatCurrency(propVal) : "—"}
                    </td>
                    <td className="py-2 px-2 text-right font-medium whitespace-nowrap">{formatCurrency(rentVal)}</td>
                    <td className="py-2 px-2 text-right font-medium whitespace-nowrap">{formatCurrency(buyVal)}</td>
                    {i.includePension && (
                      <>
                        <td className="py-2 px-2 text-right text-success whitespace-nowrap">{rentPension > 0 ? formatCurrency(rentPension) : "—"}</td>
                        <td className="py-2 px-2 text-right text-success whitespace-nowrap">{buyPension > 0 ? formatCurrency(buyPension) : "—"}</td>
                      </>
                    )}
                    <td className={cn("py-2 px-2 text-right font-medium whitespace-nowrap",
                      buyVal > rentVal ? "text-success" : "text-primary")}>
                      {buyVal > rentVal ? "Buy" : "Rent"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] text-muted-foreground">
          Both scenarios assume the same household income (inflating at {i.inflationPct}% p.a.).
          Renter invests the deposit + yearly savings difference at {i.investReturnPct}% p.a. after CGT.
          Buyer pays mortgage, council rates, insurance, maintenance ({i.maintenancePct}% of value), and strata — all inflating at {i.inflationPct}% p.a.
          {i.downsizeAction !== "none" && ` Family home sold at age ${Math.min(i.downsizeAge, i.retirementAge)} (PPR = no CGT). ${
            i.downsizeAction === "buy"
              ? `Downsizing to ${formatCurrency(i.downsizePurchasePrice)} property.`
              : `Investing sale proceeds, renting at $${i.downsizeWeeklyRent}/wk.`
          }`}
          {i.includePension && ` Age Pension included (couple rates, means-tested on assessable assets — PPR excluded).`}
        </p>
      </Card>
    </div>
  );
}

// ─── Super Strategy Optimizer ───────────────────────────────────────────────

function SuperStrategy() {
  const [i, setI] = usePlannerInputs("super-strategy", SUPER_DEFAULTS);
  const selfAge = useStore(s => s.selfAge);
  const selfRetirementAge = useStore(s => s.selfRetirementAge);
  const selfAnnualSalary = useStore(s => s.selfAnnualSalary);
  const selfSalarySacrifice = useStore(s => s.selfSalarySacrifice);
  const taxYearLabel = useStore(s => s.taxYearLabel);
  const holdings = useStore(s => s.holdings);
  const getHoldingSummary = useStore(s => s.getHoldingSummary);

  const result = useMemo(() => {
    const salary = selfAnnualSalary ?? 85000;
    const existingSS = selfSalarySacrifice ?? 0;
    const currentAge = selfAge ?? 30;
    const retireAge = selfRetirementAge ?? 65;
    const years = Math.max(1, retireAge - currentAge);
    const fyLabel = taxYearLabel ?? "2026-27";

    // Find super holdings balance
    const superHoldings = holdings.filter(h => h.type === "super");
    const totalSuper = superHoldings.reduce((sum, h) => {
      const s = getHoldingSummary(h.id);
      return sum + (s?.marketValue ?? 0);
    }, 0);

    const taxYear = getTaxYearRates(fyLabel);
    const marginalRate = getMarginalRate(salary, taxYear);

    const strategy = modelSuperStrategy({
      annualSalary: salary,
      existingSalarySacrifice: existingSS,
      currentSuperBalance: totalSuper,
      marginalRate,
      yearsToProject: Math.min(years, i.yearsToProject),
      annualReturnPct: i.annualReturnPct,
      fyLabel,
    });

    const benefit = calculateSalarySacrificeBenefit(
      strategy.optimisedPath.additionalSS,
      marginalRate,
    );

    return { ...strategy, benefit, currentAge, retireAge, fyLabel, marginalRate };
  }, [selfAnnualSalary, selfSalarySacrifice, selfAge, selfRetirementAge, taxYearLabel,
      holdings, getHoldingSummary, i]);

  return (
    <div className="space-y-4">
      <ScenarioBar tabId="super-strategy" currentInputs={i} />
      <Card className="space-y-3">
        <SectionHeader title="Your Super Strategy" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Current Super Balance</p>
            <p className="text-sm font-bold text-foreground">
              {formatCurrency(holdings.filter(h => h.type === "super").reduce((s, h) => s + (getHoldingSummary(h.id)?.marketValue ?? 0), 0))}
            </p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Marginal Tax Rate</p>
            <p className="text-sm font-bold text-foreground">{(result.marginalRate * 100).toFixed(0)}%</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Carry-Forward Available</p>
            <p className="text-sm font-bold text-success">{formatCurrency(result.carryForwardAvailable)}</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Tax Saved / Year</p>
            <p className="text-sm font-bold text-success">{formatCurrency(result.taxSavedPerYear)}</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="space-y-3">
          <SectionHeader title="Current Path" />
          <p className="text-xs text-muted-foreground">
            Your current salary sacrifice: <span className="font-medium text-foreground">{formatCurrency(selfSalarySacrifice ?? 0)}/yr</span>
          </p>
          <div className="space-y-1">
            {result.currentPath.totalSuper.map((val, i) => (
              (i % 5 === 0 || i === result.currentPath.totalSuper.length - 1) && (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Year {i + 1} (age {result.currentAge + i + 1})</span>
                  <span className="font-medium">{formatCurrency(val)}</span>
                </div>
              )
            ))}
          </div>
        </Card>

        <Card className="space-y-3">
          <SectionHeader title="Optimised Path" />
          <p className="text-xs text-muted-foreground">
            Maximise salary sacrifice up to cap: <span className="font-medium text-foreground">{formatCurrency(result.optimisedPath.additionalSS)}/yr extra</span>
          </p>
          <div className="space-y-1">
            {result.optimisedPath.totalSuper.map((val, i) => (
              (i % 5 === 0 || i === result.optimisedPath.totalSuper.length - 1) && (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Year {i + 1} (age {result.currentAge + i + 1})</span>
                  <span className="font-medium text-success">{formatCurrency(val)}</span>
                </div>
              )
            ))}
          </div>
        </Card>
      </div>

      <Card className="space-y-3">
        <SectionHeader title="Salary Sacrifice Benefit Breakdown" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Extra SS Amount</p>
            <p className="text-sm font-bold text-foreground">{formatCurrency(result.optimisedPath.additionalSS)}/yr</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Income Tax Saved</p>
            <p className="text-sm font-bold text-success">{formatCurrency(result.benefit.marginalSaving)}/yr</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Super Tax (15%)</p>
            <p className="text-sm font-bold text-destructive">-{formatCurrency(result.benefit.superTax)}/yr</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Net Benefit</p>
            <p className="text-sm font-bold text-success">{formatCurrency(result.benefit.netBenefit)}/yr</p>
          </div>
        </div>

        <div className="bg-success/10 rounded-lg p-3 text-xs text-success">
          By salary sacrificing {formatCurrency(result.optimisedPath.additionalSS)}/yr extra into super, you save approximately {formatCurrency(result.taxSavedPerYear)}/yr in tax.
          The effective cost of contributing {formatCurrency(result.optimisedPath.additionalSS)} is only {formatCurrency(result.optimisedPath.additionalSS - result.taxSavedPerYear)}.
        </div>

        {result.bringForwardAvailable > 0 && (
          <div className="bg-info/10 rounded-lg p-3 text-xs text-info">
            Bring-forward rule: You may be able to contribute up to {formatCurrency(result.bringForwardAvailable)} as a lump sum non-concessional contribution (3-year bring-forward).
          </div>
        )}

        <div className="mt-2">
          <div className="flex gap-3 items-end">
            <div className="flex-1 max-w-[160px]">
              <Input label="Investment Return %" type="number" value={i.annualReturnPct}
                onChange={v => setI({ annualReturnPct: parseFloat(v) || 7 })} prefix="%" />
            </div>
            <div className="flex-1 max-w-[160px]">
              <Input label="Project Years" type="number" value={i.yearsToProject}
                onChange={v => setI({ yearsToProject: parseInt(v) || 20 })} />
            </div>
          </div>
        </div>

        <p className="text-[10px] text-muted-foreground">
          FY{result.fyLabel} caps: CC ${getSuperCaps(result.fyLabel).concessionalCap.toLocaleString()} · NCC ${getSuperCaps(result.fyLabel).nonConcessionalCap.toLocaleString()} ·
          SG rate {(getSuperCaps(result.fyLabel).sgRate * 100).toFixed(0)}%.
          Carry-forward requires TSB &lt; $500K. Bring-forward requires TSB &lt; $1.84M.
        </p>
      </Card>
    </div>
  );
}

// ─── Investment Property ────────────────────────────────────────────────────

function InvestmentProperty() {
  const [i, setI] = usePlannerInputs("investment-property", INVESTMENT_PROPERTY_DEFAULTS);
  const selfAnnualSalary = useStore(s => s.selfAnnualSalary);
  const taxYearLabel = useStore(s => s.taxYearLabel);

  const annualSalary = selfAnnualSalary ?? 85000;
  const fyLabel = taxYearLabel ?? "2026-27";

  const result = useMemo(() => {
    const deposit = i.purchasePrice * (i.depositPct / 100);
    const loanAmount = i.purchasePrice - deposit;
    const monthlyRate = i.mortgageRate / 100 / 12;
    const totalPayments = 30 * 12;
    const monthlyRepayment = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, totalPayments))
      / (Math.pow(1 + monthlyRate, totalPayments) - 1);

    const stampDutyResult = calculateSaStampDuty(i.purchasePrice, { isPrincipalPlace: false, isFirstHomeBuyer: false });

    const taxYear = getTaxYearRates(fyLabel);
    const marginalRate = getMarginalRate(annualSalary, taxYear);

    let propertyValue = i.purchasePrice;
    let loanBalance = loanAmount;
    let currentRent = i.weeklyRent * 52;
    let totalNetReturn = 0;
    let totalTaxSaved = 0;
    let totalRentalIncome = 0;
    let totalInterestPaid = 0;
    let totalCapitalGain = 0;

    const yearlyData: {
      year: number; propertyValue: number; equity: number; rentalIncome: number;
      interestPaid: number; taxDeduction: number; taxSaved: number; netCashFlow: number;
    }[] = [];

    for (let y = 1; y <= i.years; y++) {
      const yearRentalIncome = currentRent;
      const yearInterest = loanBalance * (i.mortgageRate / 100);
      const propertyCosts = propertyValue * 0.015; // Rates + insurance + maintenance
      const landTax = calculateSaLandTax(propertyValue * 0.6, { isPrincipalPlace: false });

      // Negative gearing: rental income - all costs = net rental position
      const netRental = yearRentalIncome - yearInterest - propertyCosts - landTax;
      const taxDeduction = netRental < 0 ? Math.abs(netRental) : 0;
      const taxSaved = taxDeduction * marginalRate;

      // After-tax cash flow
      const cashIn = yearRentalIncome + taxSaved;
      const cashOut = monthlyRepayment * 12 + propertyCosts + landTax;
      const netCashFlow = cashIn - cashOut;

      totalRentalIncome += yearRentalIncome;
      totalInterestPaid += yearInterest;
      totalTaxSaved += taxSaved;

      yearlyData.push({
        year: y,
        propertyValue,
        equity: Math.max(0, propertyValue - loanBalance),
        rentalIncome: yearRentalIncome,
        interestPaid: yearInterest,
        taxDeduction,
        taxSaved,
        netCashFlow,
      });

      // Appreciate property, amortise loan
      propertyValue = propertyValue * (1 + i.capitalGrowthPct / 100);
      const yearMortgage = monthlyRepayment * 12;
      const yearPrincipal = yearMortgage - yearInterest;
      loanBalance = Math.max(0, loanBalance - yearPrincipal);
      currentRent = currentRent * (1 + i.rentIncreasePct / 100);
    }

    // CGT on disposal
    const capitalGain = propertyValue - i.purchasePrice;
    totalCapitalGain = capitalGain;

    // Post-2027 reform: indexation + 30% min tax for gains after 1 July 2027
    // Pre-reform: 50% discount
    let cgtPayable: number;
    if (i.isPreReform) {
      // Assume 60% of gain accrued before reform (conservative)
      const preReformGain = capitalGain * 0.6;
      const postReformGain = capitalGain * 0.4;
      const afterDiscount = preReformGain * 0.5; // 50% discount
      const afterMinTax = postReformGain * 0.30; // 30% min tax
      cgtPayable = afterDiscount + afterMinTax;
    } else {
      // All post-reform: indexation + 30% min
      cgtPayable = capitalGain * 0.30;
    }

    return {
      stampDuty: stampDutyResult.netDuty,
      monthlyRepayment,
      totalTaxSaved,
      totalRentalIncome,
      totalInterestPaid,
      totalCapitalGain,
      cgtPayable,
      finalEquity: Math.max(0, propertyValue - loanBalance),
      finalValue: propertyValue,
      yearlyData,
    };
  }, [i, annualSalary, fyLabel]);

  return (
    <div className="space-y-4">
      <ScenarioBar tabId="investment-property" currentInputs={i} />
      <Card className="space-y-3">
        <SectionHeader title="Investment Property (SA)" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            <Input label="Purchase Price" type="number" value={i.purchasePrice}
              onChange={v => setI({ purchasePrice: parseFloat(v) || 0 })} prefix="$" />
            <Input label="Deposit %" type="number" value={i.depositPct}
              onChange={v => setI({ depositPct: parseFloat(v) || 0 })} prefix="%" />
            <Input label="Mortgage Rate %" type="number" value={i.mortgageRate}
              onChange={v => setI({ mortgageRate: parseFloat(v) || 0 })} prefix="%" />
            <Input label="Weekly Rent" type="number" value={i.weeklyRent}
              onChange={v => setI({ weeklyRent: parseFloat(v) || 0 })} prefix="$" />
          </div>
          <div className="space-y-3">
            <Input label="Capital Growth %" type="number" value={i.capitalGrowthPct}
              onChange={v => setI({ capitalGrowthPct: parseFloat(v) || 0 })} prefix="%" />
            <Input label="Rent Increase %" type="number" value={i.rentIncreasePct}
              onChange={v => setI({ rentIncreasePct: parseFloat(v) || 0 })} prefix="%" />
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={i.isPreReform as boolean}
                onChange={e => setI({ isPreReform: e.target.checked })}
                className="rounded border-border" />
              Acquired before 12 May 2026 (50% CGT discount applies to pre-reform gains)
            </label>
          </div>
        </div>
      </Card>

      <Card className="space-y-3">
        <SectionHeader title="Results" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Stamp Duty (SA)</p>
            <p className="text-sm font-bold text-foreground">{formatCurrency(result.stampDuty)}</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Monthly Repayment</p>
            <p className="text-sm font-bold text-foreground">{formatCurrency(result.monthlyRepayment)}</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Tax Saved ({i.years}yr)</p>
            <p className="text-sm font-bold text-success">{formatCurrency(result.totalTaxSaved)}</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Est. CGT on Disposal</p>
            <p className="text-sm font-bold text-warning">{formatCurrency(result.cgtPayable)}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Final Property Value</p>
            <p className="text-sm font-bold text-foreground">{formatCurrency(result.finalValue)}</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Final Equity</p>
            <p className="text-sm font-bold text-success">{formatCurrency(result.finalEquity)}</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Total Rental Income</p>
            <p className="text-sm font-bold text-foreground">{formatCurrency(result.totalRentalIncome)}</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Total Interest Paid</p>
            <p className="text-sm font-bold text-destructive">{formatCurrency(result.totalInterestPaid)}</p>
          </div>
        </div>

        {/* Year-by-year table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Yr</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Value</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Equity</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Rental</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Interest</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Tax Saved</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Net Cash</th>
              </tr>
            </thead>
            <tbody>
              {result.yearlyData.filter(d => d.year % 5 === 0 || d.year === i.years).map(d => (
                <tr key={d.year} className="border-b border-border/50">
                  <td className="py-2 px-2 font-medium">{d.year}</td>
                  <td className="py-2 px-2 text-right">{formatCurrency(d.propertyValue)}</td>
                  <td className="py-2 px-2 text-right text-success">{formatCurrency(d.equity)}</td>
                  <td className="py-2 px-2 text-right">{formatCurrency(d.rentalIncome)}</td>
                  <td className="py-2 px-2 text-right text-destructive">{formatCurrency(d.interestPaid)}</td>
                  <td className="py-2 px-2 text-right text-success">{formatCurrency(d.taxSaved)}</td>
                  <td className={cn("py-2 px-2 text-right font-medium", d.netCashFlow >= 0 ? "text-success" : "text-destructive")}>
                    {formatCurrency(d.netCashFlow)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-[10px] text-muted-foreground">
          Negative gearing: net rental losses are deductible against other income (pre-2027 rules).
          From 1 July 2027, net rental losses on residential property are quarantined to property income only.
          CGT uses split treatment for pre-reform assets. SA stamp duty is general rate (non-FHB).
        </p>
      </Card>
    </div>
  );
}

// ─── FIRE Calculator ────────────────────────────────────────────────────────

function FireCalculator() {
  const selfAge = useStore(s => s.selfAge);
  const selfRetirementAge = useStore(s => s.selfRetirementAge);
  const selfAnnualSalary = useStore(s => s.selfAnnualSalary);
  const partnerAnnualSalary = useStore(s => s.partnerAnnualSalary);
  const selfSalarySacrifice = useStore(s => s.selfSalarySacrifice);
  const partnerSalarySacrifice = useStore(s => s.partnerSalarySacrifice);
  const holdings = useStore(s => s.holdings);
  const getHoldingSummary = useStore(s => s.getHoldingSummary);
  const budgets = useStore(s => s.budgets);
  const categories = useStore(s => s.categories);
  const expenses = useStore(s => s.expenses);
  const incomeSources = useStore(s => s.incomeSources);
  const goals = useStore(s => s.goals);

  const [i, setI] = usePlannerInputs("fire-calculator", {
    annualReturnPct: 8,
    annualSpendingInput: "",
    selfSavingsRate: "",
    partnerSavingsRate: "",
    withdrawalRatePct: 4,
    inflationPct: 3,
    showMonthly: false,
  });

  const result = useMemo(() => {
    const currentAge = selfAge ?? 30;
    const maxYears = Math.max(1, 65 - currentAge);

    // Portfolio
    const portfolio = holdings.reduce((sum, h) => {
      const s = getHoldingSummary(h.id);
      return sum + (s?.marketValue ?? 0);
    }, 0);

    // Latest budget
    const sortedBudgets = [...budgets].sort((a, b) =>
      b.year !== a.year ? b.year - a.year : b.month - a.month,
    );
    const latestBudget = sortedBudgets[0];

    // ── Gross salaries (for super SG calculation only) ──
    const selfGross = selfAnnualSalary ?? 0;
    const partnerGross = partnerAnnualSalary ?? 0;

    // ── Net income from budget (take-home pay, what you actually budget with) ──
    const budgetMonthlyIncome = latestBudget
      ? incomeSources
          .filter(s => s.budgetId === latestBudget.id)
          .reduce((sum, inc) => {
            const monthly = inc.frequency === "fortnightly" ? (inc.amount * 26) / 12 : inc.amount;
            return sum + monthly;
          }, 0)
      : 0;
    const netAnnualIncome = budgetMonthlyIncome * 12;

    // ── Current spending from budget ──
    const currentSpending = (() => {
      if (!latestBudget) return 0;
      const cats = categories.filter(c => c.budgetId === latestBudget.id && !c.isRounding);
      const catIds = new Set(cats.map(c => c.id));
      const { startDate, endDate } = getBudgetDateRange(latestBudget);
      return expenses
        .filter(e =>
          e.budgetId === latestBudget.id
          && e.date >= startDate
          && e.date <= endDate
          && !e.isWithdrawal
          && e.goalId == null
          && e.categoryId != null
          && catIds.has(e.categoryId)
        )
        .reduce((s, e) => s + e.amount, 0);
    })();

    // ── Actual savings from budget (net income - net spending) ──
    const goalContributions = (() => {
      if (!latestBudget) return 0;
      const { startDate, endDate } = getBudgetDateRange(latestBudget);
      return expenses
        .filter(e =>
          e.budgetId === latestBudget.id
          && e.date >= startDate
          && e.date <= endDate
          && !e.isWithdrawal
          && e.goalId != null
        )
        .reduce((s, e) => s + e.amount, 0);
    })();
    const superContributions = (selfSalarySacrifice ?? 0) + (partnerSalarySacrifice ?? 0);
    const actualAnnualSavings = netAnnualIncome > 0 && currentSpending > 0
      ? netAnnualIncome - currentSpending
      : 0;

    // ── FIRE spending target ──
    const annualSpending = i.annualSpendingInput !== "" && i.annualSpendingInput > 0
      ? (i.annualSpendingInput as number)
      : currentSpending > 0 ? currentSpending : 48000;

    // ── Savings rate (per spouse, based on gross income for FIRE modeling) ──
    const autoSelfRate = selfGross > 0 && currentSpending > 0
      ? Math.max(0, (selfGross - (currentSpending * (selfGross / (selfGross + partnerGross)))) / selfGross)
      : 0.2;
    const autoPartnerRate = partnerGross > 0 && currentSpending > 0
      ? Math.max(0, (partnerGross - (currentSpending * (partnerGross / (selfGross + partnerGross)))) / partnerGross)
      : 0.2;

    const effSelfRate = i.selfSavingsRate !== "" && i.selfSavingsRate > 0
      ? (i.selfSavingsRate as number) / 100
      : autoSelfRate;
    const effPartnerRate = i.partnerSavingsRate !== "" && i.partnerSavingsRate > 0
      ? (i.partnerSavingsRate as number) / 100
      : autoPartnerRate;

    const selfAnnualSavings = selfGross * effSelfRate;
    const partnerAnnualSavings = partnerGross * effPartnerRate;
    const combinedAnnualSavings = selfAnnualSavings + partnerAnnualSavings;

    // Use manual rates if set, otherwise use actual budget-derived savings
    const annualSavings = (i.selfSavingsRate !== "" || i.partnerSavingsRate !== "")
      ? combinedAnnualSavings
      : actualAnnualSavings > 0 ? actualAnnualSavings : combinedAnnualSavings;

    const effectiveSavingsRate = netAnnualIncome > 0
      ? annualSavings / netAnnualIncome
      : 0;

    // Super breakdown (gross-based)
    const SG_RATE = 0.12;
    const CC_CAP = 32500;
    const selfSG = selfGross * SG_RATE;
    const partnerSG = partnerGross * SG_RATE;
    const selfTotalSuper = selfSG + (selfSalarySacrifice ?? 0);
    const partnerTotalSuper = partnerSG + (partnerSalarySacrifice ?? 0);
    const selfCCUsed = Math.min(selfTotalSuper, CC_CAP);
    const partnerCCUsed = Math.min(partnerTotalSuper, CC_CAP);

    const realReturn = Math.pow(1 + i.annualReturnPct / 100, 1 / (1 + i.inflationPct / 100)) - 1;

    // FIRE number
    const fireNumber = annualSpending / (i.withdrawalRatePct / 100);

    // Projection
    let balance = portfolio;
    const projection: { year: number; age: number; balance: number; phase: "accumulation" | "withdrawal" }[] = [];
    let yearsToFIRE: number | null = null;

    for (let y = 0; y <= maxYears; y++) {
      projection.push({ year: y, age: currentAge + y, balance, phase: balance >= fireNumber ? "withdrawal" : "accumulation" });
      if (y === maxYears) break;
      if (balance >= fireNumber) {
        const withdrawal = balance * (i.withdrawalRatePct / 100);
        balance = balance * (1 + realReturn) - withdrawal;
        if (yearsToFIRE === null) yearsToFIRE = y;
      } else {
        balance = balance * (1 + realReturn) + annualSavings;
      }
    }

    const fireAge = yearsToFIRE !== null ? currentAge + yearsToFIRE : null;

    // ── Monthly amortization ──
    const monthlyReturn = Math.pow(1 + realReturn, 1 / 12) - 1;
    const monthlySavings = annualSavings / 12;
    const monthlySpending = annualSpending / 12;
    type MonthRow = {
      year: number; month: number; age: number;
      balance: number; monthlyIn: number; monthlyOut: number;
      interest: number; phase: "accumulation" | "withdrawal";
    };
    const monthlyProjection: MonthRow[] = [];
    let mBalance = portfolio;
    let mYearsToFIRE: number | null = null;

    for (let y = 0; y <= maxYears; y++) {
      for (let m = 0; m < 12; m++) {
        const monthIdx = y * 12 + m;
        const isWithdrawal = mBalance >= fireNumber;
        const interest = mBalance * monthlyReturn;
        let monthlyIn = 0;
        let monthlyOut = 0;

        if (isWithdrawal) {
          monthlyOut = monthlySpending;
          mBalance = mBalance + interest - monthlyOut;
          if (mYearsToFIRE === null && y > 0) mYearsToFIRE = y;
        } else {
          monthlyIn = monthlySavings;
          mBalance = mBalance + interest + monthlyIn;
        }

        mBalance = Math.max(0, mBalance);

        monthlyProjection.push({
          year: y, month: m, age: currentAge + y,
          balance: mBalance, monthlyIn, monthlyOut, interest,
          phase: isWithdrawal ? "withdrawal" : "accumulation",
        });
      }
    }

    return {
      portfolio, annualSpending, netAnnualIncome, currentSpending,
      selfGross, partnerGross, selfAnnualSavings, partnerAnnualSavings,
      combinedAnnualSavings, annualSavings, effectiveSavingsRate,
      goalContributions, superContributions, actualAnnualSavings,
      selfSG, partnerSG, selfTotalSuper, partnerTotalSuper,
      selfCCUsed, partnerCCUsed, CC_CAP,
      fireNumber, yearsToFIRE, fireAge,
      projection, currentAge, autoSelfRate, autoPartnerRate,
      monthlyProjection,
    };
  }, [i, selfAge, selfRetirementAge, selfAnnualSalary, partnerAnnualSalary,
      selfSalarySacrifice, partnerSalarySacrifice,
      holdings, getHoldingSummary, budgets, categories, expenses,
      incomeSources]);

  return (
    <div className="space-y-4">
      <ScenarioBar tabId="fire-calculator" currentInputs={i} />
      <Card className="space-y-3">
        <SectionHeader title="FIRE Calculator" />
        <p className="text-xs text-muted-foreground">
          Calculate years to Financial Independence. Income from Tax Settings, spending from budget data.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Current Portfolio</p>
            <p className="text-sm font-bold text-foreground">{formatCurrency(result.portfolio)}</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Annual Spending</p>
            <p className="text-sm font-bold text-foreground">{formatCurrency(result.annualSpending)}</p>
            {i.annualSpendingInput === "" && result.currentSpending > 0 && (
              <p className="text-[9px] text-muted-foreground mt-0.5">from budget</p>
            )}
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Savings Rate</p>
            <p className="text-sm font-bold text-foreground">{(result.effectiveSavingsRate * 100).toFixed(0)}%</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">FIRE Number</p>
            <p className="text-sm font-bold text-warning">{formatCurrency(result.fireNumber)}</p>
          </div>
        </div>

        <div className="bg-muted/50 rounded-lg p-2.5 text-[10px] text-muted-foreground space-y-0.5">
          <p><span className="font-medium text-foreground">FIRE Number</span> = Annual Spending ÷ Withdrawal Rate (e.g. $100K ÷ 4% = $2.5M)</p>
          <p><span className="font-medium text-foreground">Annual Savings</span> = {formatCurrency(result.annualSavings)}/yr ({(result.effectiveSavingsRate * 100).toFixed(0)}% of net income {formatCurrency(result.netAnnualIncome)})</p>
        </div>

        {result.yearsToFIRE !== null && (
          <div className="bg-success/10 rounded-lg p-3">
            <p className="text-sm font-bold text-success">
              You reach FIRE in {result.yearsToFIRE} years at age {result.fireAge}
            </p>
            <p className="text-xs text-success/80 mt-1">
              At {i.withdrawalRatePct}% withdrawal rate, your portfolio sustains {formatCurrency(result.annualSpending)}/yr.
            </p>
          </div>
        )}

        {result.yearsToFIRE === null && result.portfolio === 0 && (
          <div className="bg-muted rounded-lg p-3 text-xs text-muted-foreground">
            Add investments on the Investments page to calculate your FIRE timeline.
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <SectionHeader title="Current Savings Breakdown" />
        {result.netAnnualIncome > 0 ? (
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-muted-foreground">Net Income (take-home)</span>
              <span className="font-medium text-foreground">{formatCurrency(result.netAnnualIncome)}/yr</span>
            </div>
            <div className="border-t border-border pt-2 mt-2">
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground">Lifestyle Spending</span>
                <span className="text-warning">−{formatCurrency(result.currentSpending)}/yr</span>
              </div>
            </div>
            <div className="border-t border-border pt-2 mt-2">
              <div className="flex justify-between items-center text-xs font-medium">
                <span className="text-foreground">Actual Savings (from budget)</span>
                <span className="text-success">+{formatCurrency(result.actualAnnualSavings)}/yr</span>
              </div>
              {result.actualAnnualSavings > 0 && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {((result.actualAnnualSavings / result.netAnnualIncome) * 100).toFixed(0)}% savings rate
                </p>
              )}
            </div>
            {result.goalContributions > 0 && (
              <div className="flex justify-between items-center text-xs pl-3">
                <span className="text-muted-foreground">→ Goal Contributions</span>
                <span className="text-foreground">{formatCurrency(result.goalContributions)}/yr</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Add income sources to your budget to see your savings breakdown.
          </p>
        )}
      </Card>

      <Card className="space-y-3">
        <SectionHeader title="Super Contributions" />
        {result.selfGross > 0 || result.partnerGross > 0 ? (
          <div className="space-y-3">
            <p className="text-[10px] text-muted-foreground">
              CC Cap: {formatCurrency(result.CC_CAP)}/yr per person (2026-27). SG is 12% of gross salary.
            </p>
            {result.selfGross > 0 && (
              <div className="bg-muted/50 rounded-lg p-2.5 space-y-1">
                <p className="text-xs font-medium text-foreground">You</p>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">Gross Salary</span>
                  <span className="text-foreground">{formatCurrency(result.selfGross)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">SG (12%)</span>
                  <span className="text-foreground">{formatCurrency(result.selfSG)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">Salary Sacrifice</span>
                  <span className="text-foreground">{formatCurrency(selfSalarySacrifice ?? 0)}</span>
                </div>
                <div className="flex justify-between text-[11px] font-medium border-t border-border pt-1">
                  <span className="text-foreground">Total Concessional</span>
                  <span className={cn(result.selfTotalSuper > result.CC_CAP ? "text-warning" : "text-success")}>
                    {formatCurrency(result.selfTotalSuper)}
                    {result.selfTotalSuper > result.CC_CAP && " (over cap!)"}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min((result.selfCCUsed / result.CC_CAP) * 100, 100)}%`,
                      backgroundColor: result.selfTotalSuper > result.CC_CAP ? "var(--color-warning)" : "var(--color-success)",
                    }}
                  />
                </div>
                <p className="text-[9px] text-muted-foreground">
                  {formatCurrency(result.selfCCUsed)} of {formatCurrency(result.CC_CAP)} cap used
                </p>
              </div>
            )}
            {result.partnerGross > 0 && (
              <div className="bg-muted/50 rounded-lg p-2.5 space-y-1">
                <p className="text-xs font-medium text-foreground">Wife</p>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">Gross Salary</span>
                  <span className="text-foreground">{formatCurrency(result.partnerGross)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">SG (12%)</span>
                  <span className="text-foreground">{formatCurrency(result.partnerSG)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">Salary Sacrifice</span>
                  <span className="text-foreground">{formatCurrency(partnerSalarySacrifice ?? 0)}</span>
                </div>
                <div className="flex justify-between text-[11px] font-medium border-t border-border pt-1">
                  <span className="text-foreground">Total Concessional</span>
                  <span className={cn(result.partnerTotalSuper > result.CC_CAP ? "text-warning" : "text-success")}>
                    {formatCurrency(result.partnerTotalSuper)}
                    {result.partnerTotalSuper > result.CC_CAP && " (over cap!)"}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min((result.partnerCCUsed / result.CC_CAP) * 100, 100)}%`,
                      backgroundColor: result.partnerTotalSuper > result.CC_CAP ? "var(--color-warning)" : "var(--color-success)",
                    }}
                  />
                </div>
                <p className="text-[9px] text-muted-foreground">
                  {formatCurrency(result.partnerCCUsed)} of {formatCurrency(result.CC_CAP)} cap used
                </p>
              </div>
            )}
            <div className="bg-muted/50 rounded-lg p-2.5 space-y-1">
              <div className="flex justify-between text-[11px] font-medium">
                <span className="text-foreground">Combined Super Contributions</span>
                <span className="text-foreground">{formatCurrency(result.selfTotalSuper + result.partnerTotalSuper)}/yr</span>
              </div>
              <p className="text-[9px] text-muted-foreground">
                This is pre-tax money growing in super at 15% tax rate — not counted in FIRE savings above.
              </p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Set salaries in Settings → Tax Settings to see super breakdown.
          </p>
        )}
      </Card>

      <Card className="space-y-3">
        <SectionHeader title="Inputs" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Annual Spending Target" type="number" value={i.annualSpendingInput || ""}
            onChange={v => setI({ annualSpendingInput: parseFloat(v) || "" })} prefix="$"
            placeholder={result.currentSpending > 0 ? formatCurrency(result.currentSpending) : "48000"} />
          <Input label="Investment Return %" type="number" value={i.annualReturnPct}
            onChange={v => setI({ annualReturnPct: parseFloat(v) || 8 })} prefix="%" />
          <Input label="Withdrawal Rate %" type="number" value={i.withdrawalRatePct}
            onChange={v => setI({ withdrawalRatePct: parseFloat(v) || 4 })} prefix="%" />
          <Input label="Inflation %" type="number" value={i.inflationPct}
            onChange={v => setI({ inflationPct: parseFloat(v) || 3 })} prefix="%" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Your Savings Rate %" type="number" value={i.selfSavingsRate || ""}
            onChange={v => setI({ selfSavingsRate: parseFloat(v) || "" })} prefix="%"
            placeholder={result.selfGross > 0 ? `${(result.autoSelfRate * 100).toFixed(0)}%` : "—"} />
          <Input label="Wife's Savings Rate %" type="number" value={i.partnerSavingsRate || ""}
            onChange={v => setI({ partnerSavingsRate: parseFloat(v) || "" })} prefix="%"
            placeholder={result.partnerGross > 0 ? `${(result.autoPartnerRate * 100).toFixed(0)}%` : "—"} />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Leave blank to auto-calculate from budget. Set individual rates to model different savings for each spouse.
        </p>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionHeader title="Projection" />
          <div className="flex gap-1 bg-muted rounded-lg p-0.5">
            <button
              onClick={() => setI({ showMonthly: false })}
              className={cn("px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
                !i.showMonthly ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Yearly
            </button>
            <button
              onClick={() => setI({ showMonthly: true })}
              className={cn("px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
                i.showMonthly ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Monthly
            </button>
          </div>
        </div>

        {!i.showMonthly ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-2 text-muted-foreground font-medium">Age</th>
                  <th className="text-right py-2 px-2 text-muted-foreground font-medium">Balance</th>
                  <th className="text-right py-2 px-2 text-muted-foreground font-medium">Per Year</th>
                  <th className="text-right py-2 px-2 text-muted-foreground font-medium">% of FIRE</th>
                </tr>
              </thead>
              <tbody>
                {result.projection.filter((_, i) => i % 5 === 0 || i === result.projection.length - 1).map(d => {
                  const pct = result.fireNumber > 0 ? Math.min((d.balance / result.fireNumber) * 100, 999) : 0;
                  return (
                    <tr key={d.age} className="border-b border-border/50">
                      <td className="py-2 px-2 font-medium">{d.age}</td>
                      <td className={cn("py-2 px-2 text-right font-medium",
                        d.balance >= result.fireNumber ? "text-success" : "text-foreground")}>
                        {formatCurrency(d.balance)}
                      </td>
                      <td className={cn("py-2 px-2 text-right",
                        d.phase === "withdrawal" ? "text-warning" : "text-success")}>
                        {d.phase === "withdrawal"
                          ? `−${formatCurrency(result.annualSpending)}`
                          : `+${formatCurrency(result.annualSavings)}`}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(pct, 100)}%`,
                                backgroundColor: pct >= 100 ? "var(--color-success)" : "var(--color-primary)",
                              }}
                            />
                          </div>
                          <span className={cn("text-[10px] font-medium w-8 text-right",
                            pct >= 100 ? "text-success" : "text-muted-foreground")}>
                            {pct >= 100 ? "✓" : `${pct.toFixed(0)}%`}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background z-10">
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-2 text-muted-foreground font-medium">Month</th>
                  <th className="text-right py-2 px-2 text-muted-foreground font-medium">Interest</th>
                  <th className="text-right py-2 px-2 text-muted-foreground font-medium">In / Out</th>
                  <th className="text-right py-2 px-2 text-muted-foreground font-medium">Balance</th>
                  <th className="text-right py-2 px-2 text-muted-foreground font-medium">% of FIRE</th>
                </tr>
              </thead>
              <tbody>
                {result.monthlyProjection.filter((_, i) => {
                  if (i === result.monthlyProjection.length - 1) return true;
                  const m = i % 12;
                  return m === 0 || m === 6;
                }).map((d, idx) => {
                  const pct = result.fireNumber > 0 ? Math.min((d.balance / result.fireNumber) * 100, 999) : 0;
                  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                  return (
                    <tr key={idx} className={cn("border-b border-border/50",
                      d.phase === "withdrawal" && "bg-success/5")}>
                      <td className="py-1.5 px-2 font-medium">
                        <span className="text-foreground">{d.age}</span>
                        <span className="text-muted-foreground ml-1">{monthNames[d.month]}</span>
                      </td>
                      <td className={cn("py-1.5 px-2 text-right",
                        d.interest >= 0 ? "text-success" : "text-destructive")}>
                        {d.interest >= 0 ? "+" : ""}{formatCurrency(d.interest)}
                      </td>
                      <td className={cn("py-1.5 px-2 text-right font-medium",
                        d.phase === "withdrawal" ? "text-warning" : "text-success")}>
                        {d.phase === "withdrawal"
                          ? `−${formatCurrency(d.monthlyOut)}`
                          : `+${formatCurrency(d.monthlyIn)}`}
                      </td>
                      <td className={cn("py-1.5 px-2 text-right font-medium",
                        d.balance >= result.fireNumber ? "text-success" : "text-foreground")}>
                        {formatCurrency(d.balance)}
                      </td>
                      <td className="py-1.5 px-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.min(pct, 100)}%`,
                                backgroundColor: pct >= 100 ? "var(--color-success)" : "var(--color-primary)",
                              }}
                            />
                          </div>
                          <span className={cn("text-[10px] font-medium w-8 text-right",
                            pct >= 100 ? "text-success" : "text-muted-foreground")}>
                            {pct >= 100 ? "✓" : `${pct.toFixed(0)}%`}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="space-y-3">
        <SectionHeader title="What You Need to Do" />
        <div className="space-y-2.5">
          {result.netAnnualIncome > 0 && (
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-primary">1</span>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Save {formatCurrency(result.annualSavings)}/year</p>
                <p className="text-xs text-muted-foreground">
                  That's {formatCurrency(result.annualSavings / 12)}/month from your {formatCurrency(result.netAnnualIncome)}/yr net income
                  ({(result.effectiveSavingsRate * 100).toFixed(0)}% savings rate).
                </p>
              </div>
            </div>
          )}
          {result.netAnnualIncome === 0 && (
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-warning/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-warning">!</span>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Add income sources to your budget</p>
                <p className="text-xs text-muted-foreground">
                  The calculator needs your income to determine savings rate and timeline.
                </p>
              </div>
            </div>
          )}
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <span className="text-xs font-bold text-primary">{result.netAnnualIncome > 0 ? "2" : "!"}</span>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">Build portfolio to {formatCurrency(result.fireNumber)}</p>
              <p className="text-xs text-muted-foreground">
                At {i.withdrawalRatePct}% withdrawal rate, this sustains {formatCurrency(result.annualSpending)}/yr.
                {result.portfolio > 0 && ` You currently have ${formatCurrency(result.portfolio)} (${((result.portfolio / result.fireNumber) * 100).toFixed(0)}% there).`}
              </p>
            </div>
          </div>
          {result.yearsToFIRE !== null && (
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-success/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-success">{result.netAnnualIncome > 0 ? "3" : "!"}</span>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Stay the course for {result.yearsToFIRE} years</p>
                <p className="text-xs text-muted-foreground">
                  You'll reach FIRE at age {result.fireAge}. Keep saving {formatCurrency(result.annualSavings)}/yr and investing at {i.annualReturnPct}% return.
                </p>
              </div>
            </div>
          )}
          {result.yearsToFIRE === null && result.portfolio > 0 && result.annualSavings > 0 && (
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-warning/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-warning">!</span>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Increase savings or returns</p>
                <p className="text-xs text-muted-foreground">
                  At current rate, FIRE isn't reached by age {result.currentAge + Math.max(1, 65 - result.currentAge)}.
                  Try increasing your savings rate or investment returns.
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── Lump Sum Optimiser ────────────────────────────────────────────────────

function LumpSumOptimizer() {
  const selfAnnualSalary = useStore(s => s.selfAnnualSalary);
  const partnerAnnualSalary = useStore(s => s.partnerAnnualSalary);
  const taxYearLabel = useStore(s => s.taxYearLabel);
  const holdings = useStore(s => s.holdings);
  const getHoldingSummary = useStore(s => s.getHoldingSummary);
  const storeUnusedCCCaps = useStore(s => s.unusedConcessionalCaps);

  const [i, setI] = usePlannerInputs("lump-sum", {
    lumpSum: 100000,
    annualIncome: selfAnnualSalary ?? 120000,
    spouseIncome: partnerAnnualSalary ?? 60000,
    ccUsedThisYear: 0,
    carryForwardAmount: 0,
    mortgageBalance: 0,
    mortgageRate: 6.2,
    horizonYears: 10,
    superReturnPct: 7,
    investReturnPct: 8,
  });

  const result = useMemo(() => {
    const fyLabel = taxYearLabel ?? "2026-27";
    const caps = getSuperCaps(fyLabel);
    const taxYear = getTaxYearRates(fyLabel);
    const marginalRate = getMarginalRate(i.annualIncome, taxYear);
    const spouseMarginalRate = getMarginalRate(i.spouseIncome, taxYear);

    const currentSuper = holdings.reduce((sum, h) => {
      const s = getHoldingSummary(h.id);
      return sum + (s?.marketValue ?? 0);
    }, 0);

    // Carry-forward: only if super < $500K
    const carryForwardEligible = currentSuper < 500000;
    const storeCarryForward = storeUnusedCCCaps?.reduce((sum, u) => sum + u, 0) ?? 0;
    const effectiveCarryForward = carryForwardEligible
      ? (i.carryForwardAmount > 0 ? i.carryForwardAmount : storeCarryForward)
      : 0;
    const ccAvailable = Math.max(0, caps.concessionalCap - i.ccUsedThisYear + effectiveCarryForward);

    // NCC bring-forward
    const bf = calculateBringForward(currentSuper, caps);
    const nccAvailable = bf.maxFirstYear;

    // Recommended allocation
    const ccAmount = Math.min(i.lumpSum, ccAvailable);
    const rem1 = i.lumpSum - ccAmount;
    const nccAmount = Math.min(rem1, nccAvailable);
    const rem2 = rem1 - nccAmount;
    const mortgageAmount = Math.min(rem2, i.mortgageBalance);
    const investAmount = rem2 - mortgageAmount;

    const ccTaxSaved = ccAmount * marginalRate;
    const ccSuperTax = ccAmount * 0.15;
    const ccNetBenefit = ccTaxSaved - ccSuperTax;

    const superEff = i.superReturnPct / 100 * 0.85;
    const investEff = i.investReturnPct / 100 * (1 - marginalRate * 0.5);
    const spouseInvestEff = i.investReturnPct / 100 * (1 - spouseMarginalRate * 0.5);

    // Projected values at horizon
    const projCC = ccAmount > 0 ? ccAmount * 0.85 * Math.pow(1 + superEff, i.horizonYears) : 0;
    const projNCC = nccAmount * Math.pow(1 + superEff, i.horizonYears);
    const projInvest = investAmount * Math.pow(1 + investEff, i.horizonYears);
    const projMortgage = mortgageAmount * (Math.pow(1 + i.mortgageRate / 100, i.horizonYears) - 1);

    // All-in-one comparison
    const allCC = Math.min(i.lumpSum, ccAvailable);
    const allCCVal = allCC > 0 ? allCC * 0.85 * Math.pow(1 + superEff, i.horizonYears) : 0;
    const allCCBenefit = allCC * (marginalRate - 0.15);

    const allNCC = Math.min(i.lumpSum, nccAvailable);
    const allNCCVal = allNCC * Math.pow(1 + superEff, i.horizonYears);

    const allInvestVal = i.lumpSum * Math.pow(1 + investEff, i.horizonYears);

    // Gift to spouse: invest in her name at her lower tax rate
    const allSpouseVal = i.lumpSum * Math.pow(1 + spouseInvestEff, i.horizonYears);

    const allMort = Math.min(i.lumpSum, i.mortgageBalance);
    const allMortVal = allMort * (Math.pow(1 + i.mortgageRate / 100, i.horizonYears) - 1);

    // Year-by-year projection for recommended split
    const projection: { year: number; super: number; invest: number; mortgageSaved: number; total: number }[] = [];
    let cumSuper = 0;
    let cumInvest = 0;
    let cumMortgage = 0;
    for (let y = 0; y <= i.horizonYears; y++) {
      if (y > 0) {
        cumSuper = (cumSuper + (y === 1 ? ccAmount * 0.85 + nccAmount : 0)) * (1 + superEff);
        cumInvest = (cumInvest + (y === 1 ? investAmount : 0)) * (1 + investEff);
        cumMortgage = cumMortgage * (1 + i.mortgageRate / 100) + (y === 1 ? mortgageAmount : 0) * (i.mortgageRate / 100);
      }
      projection.push({
        year: y,
        super: y === 0 ? ccAmount * 0.85 + nccAmount : cumSuper,
        invest: y === 0 ? investAmount : cumInvest,
        mortgageSaved: cumMortgage,
        total: (y === 0 ? ccAmount * 0.85 + nccAmount : cumSuper) + (y === 0 ? investAmount : cumInvest) + cumMortgage,
      });
    }

    return {
      marginalRate, spouseMarginalRate, currentSuper, ccAvailable, nccAvailable,
      carryForwardEligible, currentYearCap: caps.concessionalCap,
      ccAmount, nccAmount, mortgageAmount, investAmount,
      ccTaxSaved, ccSuperTax, ccNetBenefit,
      projCC, projNCC, projInvest, projMortgage,
      allCC, allCCVal, allCCBenefit,
      allNCC, allNCCVal, allInvestVal, allSpouseVal, allMort, allMortVal,
      projection,
    };
  }, [i, taxYearLabel, holdings, getHoldingSummary, storeUnusedCCCaps]);

  return (
    <div className="space-y-4">
      <ScenarioBar tabId="lump-sum" currentInputs={i} />
      {/* Inputs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="space-y-3">
          <SectionHeader title="Your Lump Sum" />
          <Input label="Lump Sum Amount" type="number" value={i.lumpSum}
            onChange={v => setI({ lumpSum: parseFloat(v) || 0 })} prefix="$" />
          <Input label="Your Annual Income" type="number" value={i.annualIncome}
            onChange={v => setI({ annualIncome: parseFloat(v) || 0 })} prefix="$" />
          <Input label="Spouse Annual Income" type="number" value={i.spouseIncome}
            onChange={v => setI({ spouseIncome: parseFloat(v) || 0 })} prefix="$" sublabel="for gift-to-spouse option" />
          <Input label="CC Used This Year" type="number" value={i.ccUsedThisYear}
            onChange={v => setI({ ccUsedThisYear: parseFloat(v) || 0 })} prefix="$" sublabel="salary sacrifice + employer SG already counted" />
          <Input label="Carry-Forward Available" type="number" value={i.carryForwardAmount}
            onChange={v => setI({ carryForwardAmount: parseFloat(v) || 0 })} prefix="$"
            sublabel={result.carryForwardEligible
              ? `Super < $500K ✓ — unused CC from last 5 yrs`
              : `Super ≥ $500K — not eligible`} />
        </Card>

        <Card className="space-y-3">
          <SectionHeader title="Debts & Horizon" />
          <Input label="Mortgage Balance" type="number" value={i.mortgageBalance}
            onChange={v => setI({ mortgageBalance: parseFloat(v) || 0 })} prefix="$" />
          <Input label="Mortgage Rate %" type="number" value={i.mortgageRate}
            onChange={v => setI({ mortgageRate: parseFloat(v) || 0 })} prefix="%" />
          <Input label="Projection Horizon (yrs)" type="number" value={i.horizonYears}
            onChange={v => setI({ horizonYears: parseInt(v) || 10 })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Super Return %" type="number" value={i.superReturnPct}
              onChange={v => setI({ superReturnPct: parseFloat(v) || 7 })} prefix="%" />
            <Input label="Invest Return %" type="number" value={i.investReturnPct}
              onChange={v => setI({ investReturnPct: parseFloat(v) || 8 })} prefix="%" />
          </div>
        </Card>
      </div>

      {/* Your Caps */}
      <Card className="space-y-3">
        <SectionHeader title="Your Contribution Caps" />
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Your Marginal Rate</p>
            <p className="text-sm font-bold text-foreground">{(result.marginalRate * 100).toFixed(0)}%</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Spouse Marginal Rate</p>
            <p className={cn("text-sm font-bold", result.spouseMarginalRate < result.marginalRate ? "text-success" : "text-foreground")}>
              {(result.spouseMarginalRate * 100).toFixed(0)}%
            </p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">CC Available</p>
            <p className="text-sm font-bold text-success">{formatCurrency(result.ccAvailable)}</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">NCC Available</p>
            <p className="text-sm font-bold text-success">{formatCurrency(result.nccAvailable)}</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Current Super</p>
            <p className="text-sm font-bold text-foreground">{formatCurrency(result.currentSuper)}</p>
          </div>
        </div>
      </Card>

      {/* Recommended Allocation */}
      <Card className="space-y-3">
        <SectionHeader title="Recommended Allocation" />
        <p className="text-[10px] text-muted-foreground">
          Optimal order: max out concessional contribution first (tax deduction), then non-concessional, then mortgage, then invest.
          {result.spouseMarginalRate < result.marginalRate && " Since spouse is in a lower bracket, consider gifting invest amount to her."}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-success/10 rounded-xl p-3 text-center">
            <p className="text-[10px] text-success">Concessional (CC)</p>
            <p className="text-sm font-bold text-foreground">{formatCurrency(result.ccAmount)}</p>
            <p className="text-[10px] text-success mt-1">Tax saved: {formatCurrency(result.ccNetBenefit)}</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Non-Concessional (NCC)</p>
            <p className="text-sm font-bold text-foreground">{formatCurrency(result.nccAmount)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">No tax deduction</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Pay Mortgage</p>
            <p className="text-sm font-bold text-foreground">{formatCurrency(result.mortgageAmount)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Guaranteed {i.mortgageRate}% return</p>
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Invest Outside</p>
            <p className="text-sm font-bold text-foreground">{formatCurrency(result.investAmount)}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Accessible anytime</p>
          </div>
        </div>

        {result.ccAmount > 0 && (
          <div className="bg-success/10 rounded-lg p-3 text-xs text-success">
            Contributing {formatCurrency(result.ccAmount)} as concessional saves you {formatCurrency(result.ccNetBenefit)} in tax
            ({(result.marginalRate * 100).toFixed(0)}% marginal − 15% super tax = {((result.marginalRate - 0.15) * 100).toFixed(0)}% net benefit).
            Effective cost: {formatCurrency(result.ccAmount - result.ccNetBenefit)}.
          </div>
        )}
      </Card>

      {/* Comparison: All-In-One */}
      <Card className="space-y-3">
        <SectionHeader title={`What If You Put All ${formatCurrency(i.lumpSum)} Into…`} />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Option</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Amount</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Tax Benefit</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Value at {i.horizonYears}yr</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Net Gain</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/50">
                <td className="py-2 px-2 font-medium text-success">CC (Super)</td>
                <td className="py-2 px-2 text-right">{formatCurrency(result.allCC)}</td>
                <td className="py-2 px-2 text-right text-success">{formatCurrency(result.allCCBenefit)}</td>
                <td className="py-2 px-2 text-right">{formatCurrency(result.allCCVal)}</td>
                <td className="py-2 px-2 text-right font-medium text-success">
                  {formatCurrency(result.allCCVal + result.allCCBenefit - result.allCC)}
                </td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2 px-2 font-medium">NCC (Super)</td>
                <td className="py-2 px-2 text-right">{formatCurrency(result.allNCC)}</td>
                <td className="py-2 px-2 text-right text-muted-foreground">—</td>
                <td className="py-2 px-2 text-right">{formatCurrency(result.allNCCVal)}</td>
                <td className="py-2 px-2 text-right font-medium">{formatCurrency(result.allNCCVal - result.allNCC)}</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-2 px-2 font-medium">Invest Outside</td>
                <td className="py-2 px-2 text-right">{formatCurrency(i.lumpSum)}</td>
                <td className="py-2 px-2 text-right text-muted-foreground">—</td>
                <td className="py-2 px-2 text-right">{formatCurrency(result.allInvestVal)}</td>
                <td className="py-2 px-2 text-right font-medium">{formatCurrency(result.allInvestVal - i.lumpSum)}</td>
              </tr>
              <tr className={cn("border-b border-border/50",
                result.spouseMarginalRate < result.marginalRate && "bg-success/5")}>
                <td className="py-2 px-2 font-medium">
                  Gift to Spouse
                  {result.spouseMarginalRate < result.marginalRate && <span className="ml-1 text-success text-[10px]">(lower tax)</span>}
                </td>
                <td className="py-2 px-2 text-right">{formatCurrency(i.lumpSum)}</td>
                <td className="py-2 px-2 text-right text-muted-foreground">—</td>
                <td className="py-2 px-2 text-right">{formatCurrency(result.allSpouseVal)}</td>
                <td className={cn("py-2 px-2 text-right font-medium",
                  result.allSpouseVal > result.allInvestVal ? "text-success" : "")}>
                  {formatCurrency(result.allSpouseVal - i.lumpSum)}
                  {result.allSpouseVal > result.allInvestVal && (
                    <span className="ml-1 text-[10px]">+{formatCurrency(result.allSpouseVal - result.allInvestVal)} vs you</span>
                  )}
                </td>
              </tr>
              {result.allMort > 0 && (
                <tr className="border-b border-border/50">
                  <td className="py-2 px-2 font-medium">Pay Mortgage</td>
                  <td className="py-2 px-2 text-right">{formatCurrency(result.allMort)}</td>
                  <td className="py-2 px-2 text-right text-muted-foreground">—</td>
                  <td className="py-2 px-2 text-right">{formatCurrency(result.allMortVal)}</td>
                  <td className="py-2 px-2 text-right font-medium text-success">{formatCurrency(result.allMortVal)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Net gain = projected value − cash outlay (+ tax benefit for CC).
          Super returns net of15% earnings tax. Outside super uses50% CGT discount.
          CC is almost always the best first option for tax relief.
        </p>
      </Card>

      {/* Notes */}
      <Card className="space-y-3">
        <SectionHeader title="Notes" />
        <div className="text-xs text-muted-foreground space-y-2">
          <p>
            <span className="font-medium text-foreground">Concessional Contribution (CC):</span>{" "}
            Tax-deductible up to your available cap. Includes salary sacrifice AND personal deductible contributions
            (after-tax contributions you claim a deduction for). Both count towards the same cap.
            You pay15% super tax instead of your marginal rate.
            {result.marginalRate >= 0.37
              ? ` At ${(result.marginalRate * 100).toFixed(0)}% marginal, you save ${((result.marginalRate - 0.15) * 100).toFixed(0)}c per dollar.`
              : ` At ${(result.marginalRate * 100).toFixed(0)}% marginal, the benefit is more modest at ${((result.marginalRate - 0.15) * 100).toFixed(0)}c per dollar.`}
          </p>
          <p>
            <span className="font-medium text-foreground">Carry-Forward:</span>{" "}
            {result.carryForwardEligible
              ? `Your super balance is under $500K — you can use unused CC cap from the last 5 years. Current available: ${formatCurrency(result.ccAvailable)} (includes ${formatCurrency(result.ccAvailable - result.currentYearCap + i.ccUsedThisYear)} carry-forward).`
              : `Your super is ≥ $500K — carry-forward is not available. You can only use the current year cap of ${formatCurrency(result.currentYearCap)}.`}
          </p>
          <p>
            <span className="font-medium text-foreground">Non-Concessional Contribution (NCC):</span>{" "}
            No tax deduction, but investment earnings taxed at15% in super vs your marginal rate outside.
            Bring-forward allows up to 3 years' cap in one go if super &lt; $1.84M.
            Money locked until preservation age (currently60).
          </p>
          <p>
            <span className="font-medium text-foreground">Mortgage:</span>{" "}
            Guaranteed return at your mortgage rate. No tax benefit but guaranteed risk-free return.
            Consider this if your mortgage rate exceeds expected investment returns.
          </p>
          <p>
            <span className="font-medium text-foreground">Invest Outside Super:</span>{" "}
            Accessible anytime. Taxed at your marginal rate (50% CGT discount for assets held &gt;12 months).
            After1 July 2027, new CGT rules apply (CPI indexation +30% min tax).
          </p>
          {result.spouseMarginalRate < result.marginalRate && (
            <p className="text-success">
              <span className="font-medium">Gift to Spouse:</span>{" "}
              Spouse is in a lower bracket ({(result.spouseMarginalRate * 100).toFixed(0)}% vs {(result.marginalRate * 100).toFixed(0)}%).
              Investing in her name saves {((result.marginalRate - result.spouseMarginalRate) * 50).toFixed(0)}% on CGT (50% discount × rate difference).
              No limit on gifts between spouses. Attribution rules may apply for Centrelink if over $10K/yr but unlikely to affect you while working.
            </p>
          )}
          <p className="text-warning">
            <span className="font-medium">Overseas super lump sum:</span>{" "}
            Tax treatment depends on your age, the country, and any double taxation agreement.
            If under60, the lump sum may be taxable. Consult a tax professional for your specific situation.
          </p>
        </div>
      </Card>
    </div>
  );
}

// ─── Pivot Optimizer ─────────────────────────────────────────────────────────

const SIMS = 500;

function projectPivot(
  p: {
    currentAge: number; retireAge: number; years: number;
    selfGross: number; partnerGross: number;
    curSelfSS: number; curPartnerSS: number;
    totalPortfolio: number; totalSuper: number;
    currentSpending: number; spendingCut: number;
    salarySacrificeExtra: number;
    mortgageBalance: number; mortgageRate: number; mortgageVsInvest: number;
    giftToSpouse: number; portfolioReturnPct: number;
    marginalRate: number; spouseMarginalRate: number;
    fyLabel: string; taxYear: ReturnType<typeof getTaxYearRates>;
  },
  annualReturns?: number[],
) {
  const {
    currentAge, retireAge, years,
    selfGross, partnerGross, curSelfSS, curPartnerSS,
    totalPortfolio, totalSuper, currentSpending, spendingCut,
    salarySacrificeExtra, mortgageBalance, mortgageRate, mortgageVsInvest,
    giftToSpouse, portfolioReturnPct, marginalRate, spouseMarginalRate,
    fyLabel, taxYear,
  } = p;
  const inflationPct = 3;
  const sgRate = 0.12;
  const swrPct = 4;
  const cgtDiscount = 0.5;

  const cut = Math.min(spendingCut, currentSpending * 0.9);
  const effectiveSpending = Math.max(0, currentSpending - cut);
  const extraSS = salarySacrificeExtra;
  const totalSS = curSelfSS + extraSS;
  const meanRet = portfolioReturnPct / 100;
  const superTaxRet = meanRet * 0.85;

  let bP = totalPortfolio, bS = totalSuper;
  let oP = totalPortfolio, oS = totalSuper;
  let oMort = mortgageBalance;
  const bPath: number[] = [bP + bS];
  const oPath: number[] = [oP + oS];
  let mortgageFreeYear: number | null = null;

  for (let y = 1; y <= years; y++) {
    const ret = annualReturns ? annualReturns[y - 1] / 100 : meanRet;
    const supRet = annualReturns ? ret * 0.85 : superTaxRet;
    const infl = Math.pow(1 + inflationPct / 100, y);
    const income = (selfGross + partnerGross) * infl;
    const spend = effectiveSpending * infl;

    const bTaxable = Math.max(0, selfGross * infl - curSelfSS * infl);
    const bTax = bTaxable * getMarginalRate(bTaxable, taxYear);
    const bSC = (selfGross * sgRate + partnerGross * sgRate + curSelfSS + curPartnerSS) * infl;

    const oTaxable = Math.max(0, selfGross * infl - totalSS * infl);
    const oTax = oTaxable * getMarginalRate(oTaxable, taxYear);
    const oSC = (selfGross * sgRate + partnerGross * sgRate + totalSS + curPartnerSS) * infl;

    const bSurplus = income - bTax - spend;
    const oSurplus = income - oTax - spend;

    const giftAmt = giftToSpouse * infl;
    const spouseCGT = spouseMarginalRate * cgtDiscount;
    const selfCGT = marginalRate * cgtDiscount;
    const giftBenefit = giftAmt > 0 ? giftAmt * (selfCGT - spouseCGT) * (annualReturns ? ret : meanRet) : 0;

    let oMP = 0;
    if (oMort > 0) {
      const alloc = mortgageVsInvest / 100;
      oMP = oSurplus * alloc;
      oMort = Math.max(0, oMort - oMP);
      if (oMort <= 0 && mortgageFreeYear === null) mortgageFreeYear = currentAge + y;
    }

    bP = bP * (1 + ret) + bSurplus;
    bS = bS * (1 + supRet) + bSC * 0.85;
    oP = oP * (1 + ret) + (oSurplus - oMP) + giftBenefit;
    oS = oS * (1 + supRet) + oSC * 0.85;

    bPath.push(bP + bS);
    oPath.push(oP + oS);
  }

  const fBase = bPath[bPath.length - 1];
  const fOpt = oPath[oPath.length - 1];
  const retireMarginal = getMarginalRate(Math.max(fBase, fOpt) * (swrPct / 100), taxYear);

  const calcRetireIncome = (total: number) => {
    const draw = total * (swrPct / 100);
    const tax = draw * retireMarginal * cgtDiscount;
    return draw - tax + calcAgePension(total, true);
  };

  const annualTaxSaved = extraSS > 0 ? extraSS * (marginalRate - 0.15) : 0;

  return {
    bAfterTax: calcRetireIncome(fBase), oAfterTax: calcRetireIncome(fOpt),
    bRepl: effectiveSpending > 0 ? (calcRetireIncome(fBase) / effectiveSpending) * 100 : 0,
    oRepl: effectiveSpending > 0 ? (calcRetireIncome(fOpt) / effectiveSpending) * 100 : 0,
    fBase, fOpt, bPath, oPath, cut, effectiveSpending, annualTaxSaved,
    mortgageFreeYear, oSurplus: oP + oS,
  };
}

function pivotAutoOptimize(p: ReturnType<typeof buildPivotParams>) {
  const candidates = [
    { id: "spendingCut" as const, values: [0, 5000, 10000, 15000, 25000] },
    { id: "salarySacrificeExtra" as const, values: [0, 5000, 10000, 20000, 32500] },
    { id: "mortgageVsInvest" as const, values: [0, 50, 100] },
    { id: "giftToSpouse" as const, values: [0, 10000, 25000, 50000] },
    { id: "portfolioReturnPct" as const, values: [6, 8, 10, 14] },
  ];

  const best = { ...p };
  const rankings: { id: string; name: string; value: number; gain: number }[] = [];

  for (const lever of candidates) {
    let bestVal = p[lever.id];
    let bestGain = 0;
    for (const v of lever.values) {
      const test = { ...best, [lever.id]: v };
      const res = projectPivot(test);
      if (res.oAfterTax > bestGain) { bestGain = res.oAfterTax; bestVal = v; }
    }
    best[lever.id] = bestVal;
    const gain = bestGain - projectPivot(p).oAfterTax;
    const names: Record<string, string> = {
      spendingCut: "Cut Spending",
      salarySacrificeExtra: "Salary Sacrifice",
      mortgageVsInvest: "Mortgage vs Invest",
      giftToSpouse: "Gift to Spouse",
      portfolioReturnPct: "Portfolio Return",
    };
    rankings.push({ id: lever.id, name: names[lever.id], value: bestVal, gain });
  }

  rankings.sort((a, b) => b.gain - a.gain);
  const top = rankings[0];
  // Build combined best
  for (const r of rankings) { best[r.id] = r.value; }
  const comb = projectPivot(best);

  return { rankings, top, combinedIncome: comb.oAfterTax, combined: best };
}

function buildPivotParams(
  i: typeof PIVOT_DEFAULTS,
  selfAge: number | undefined, selfRetirementAge: number | undefined,
  selfAnnualSalary: number | undefined, partnerAnnualSalary: number | undefined,
  selfSalarySacrifice: number | undefined, partnerSalarySacrifice: number | undefined,
  totalPortfolio: number, totalSuper: number, currentSpending: number,
  taxYearLabel: string | undefined,
) {
  const currentAge = selfAge ?? 30;
  const retireAge = i.retirementAge || (selfRetirementAge ?? 65);
  const years = Math.max(1, retireAge - currentAge);
  const fyLabel = taxYearLabel ?? "2026-27";
  const taxYear = getTaxYearRates(fyLabel);
  const selfGross = selfAnnualSalary ?? 0;
  const partnerGross = partnerAnnualSalary ?? 0;
  const curSelfSS = selfSalarySacrifice ?? 0;
  const curPartnerSS = partnerSalarySacrifice ?? 0;
  const marginalRate = getMarginalRate(selfGross, taxYear);
  const spouseMarginalRate = getMarginalRate(partnerGross, taxYear);
  return {
    currentAge, retireAge, years, fyLabel, taxYear,
    selfGross, partnerGross, curSelfSS, curPartnerSS,
    totalPortfolio, totalSuper, currentSpending,
    marginalRate, spouseMarginalRate,
    spendingCut: i.spendingCut,
    salarySacrificeExtra: i.salarySacrificeExtra,
    mortgageBalance: i.mortgageBalance,
    mortgageRate: i.mortgageRate,
    mortgageVsInvest: i.mortgageVsInvest,
    giftToSpouse: i.giftToSpouse,
    portfolioReturnPct: i.portfolioReturnPct,
  };
}

function PivotOptimizer() {
  const selfAge = useStore(s => s.selfAge);
  const selfRetirementAge = useStore(s => s.selfRetirementAge);
  const selfAnnualSalary = useStore(s => s.selfAnnualSalary);
  const partnerAnnualSalary = useStore(s => s.partnerAnnualSalary);
  const selfSalarySacrifice = useStore(s => s.selfSalarySacrifice);
  const partnerSalarySacrifice = useStore(s => s.partnerSalarySacrifice);
  const holdings = useStore(s => s.holdings);
  const getHoldingSummary = useStore(s => s.getHoldingSummary);
  const budgets = useStore(s => s.budgets);
  const categories = useStore(s => s.categories);
  const expenses = useStore(s => s.expenses);
  const taxYearLabel = useStore(s => s.taxYearLabel);

  const [i, setI] = usePlannerInputs("pivot-optimizer", PIVOT_DEFAULTS);

  const totalPortfolio = useMemo(() => holdings.reduce((sum, h) => {
    if (h.type === "super") return sum;
    return sum + (getHoldingSummary(h.id)?.marketValue ?? 0);
  }, 0), [holdings, getHoldingSummary]);

  const totalSuper = useMemo(() => holdings.reduce((sum, h) => {
    if (h.type !== "super") return sum;
    return sum + (getHoldingSummary(h.id)?.marketValue ?? 0);
  }, 0), [holdings, getHoldingSummary]);

  const currentSpending = useMemo(() => {
    const sortedBudgets = [...budgets].sort((a, b) =>
      b.year !== a.year ? b.year - a.year : b.month - a.month,
    );
    const lb = sortedBudgets[0];
    if (!lb) return 48000;
    const cats = categories.filter(c => c.budgetId === lb.id && !c.isRounding);
    const catIds = new Set(cats.map(c => c.id));
    const { startDate, endDate } = getBudgetDateRange(lb);
    return expenses
      .filter(e => e.budgetId === lb.id && e.date >= startDate && e.date <= endDate
        && !e.isWithdrawal && e.goalId == null && e.categoryId != null && catIds.has(e.categoryId))
      .reduce((s, e) => s + e.amount, 0);
  }, [budgets, categories, expenses]);

  const p = buildPivotParams(i, selfAge, selfRetirementAge, selfAnnualSalary, partnerAnnualSalary,
    selfSalarySacrifice, partnerSalarySacrifice, totalPortfolio, totalSuper, currentSpending, taxYearLabel);

  // Deterministic (for slider feedback)
  const det = useMemo(() => projectPivot(p), [p]);

  // Monte Carlo
  const mc = useMemo(() => {
    const mcBaseWrite = () => {
      let ok = 0;
      for (let s = 0; s < SIMS; s++) {
        const rets: number[] = [];
        for (let y = 0; y < p.years; y++) rets.push(Math.max(p.portfolioReturnPct + normalRandom() * 15, -99));
        const r = projectPivot({ ...p, portfolioReturnPct: p.portfolioReturnPct }, rets);
        if (r.bAfterTax >= p.currentSpending) ok++;
      }
      return ok;
    };
    const mcOptWins = () => {
      let ok = 0;
      for (let s = 0; s < SIMS; s++) {
        const rets: number[] = [];
        for (let y = 0; y < p.years; y++) rets.push(Math.max(p.portfolioReturnPct + normalRandom() * 15, -99));
        const r = projectPivot({ ...p, portfolioReturnPct: p.portfolioReturnPct }, rets);
        if (r.oAfterTax >= p.currentSpending) ok++;
      }
      return ok;
    };
    const bWins = mcBaseWrite();
    const oWins = mcOptWins();
    return { baseSuccessRate: (bWins / SIMS) * 100, optSuccessRate: (oWins / SIMS) * 100 };
  }, [p]);

  // Auto-optimize
  const auto = useMemo(() => pivotAutoOptimize(p), [p]);

  // Path data for chart (deterministic)
  const pathData = useMemo(() => {
    const combined = [...det.bPath, ...det.oPath];
    const maxVal = Math.max(...combined, 1);
    const w = 600; const h = 200; const pad = 10;
    const scale = (v: number) => pad + (v / maxVal) * (h - pad * 2);
    const step = (det.bPath.length - 1) || 1;
    return {
      bPts: det.bPath.map((v, i) => `${(i / step) * w},${h - scale(v)}`).join(" "),
      oPts: det.oPath.map((v, i) => `${(i / step) * w},${h - scale(v)}`).join(" "),
      maxVal, w, h,
    };
  }, [det]);

  const successColor = (rate: number) =>
    rate >= 80 ? "text-success" : rate >= 50 ? "text-warning" : "text-destructive";

  return (
    <div className="space-y-4">
      <ScenarioBar tabId="pivot-optimizer" currentInputs={i} />

      {/* Success rate + Top recommendation */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 space-y-3">
          <SectionHeader title="Chance of Reaching Your Goal" />
          <p className="text-[10px] text-muted-foreground">
            Goal: {formatCurrency(p.currentSpending)}/yr retirement income ({formatCurrency(Math.round(p.currentSpending / 12))}/mo)
          </p>
          <div className="flex items-center gap-6">
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">Without Change</p>
              <p className={cn("text-2xl font-bold", successColor(mc.baseSuccessRate))}>
                {mc.baseSuccessRate.toFixed(0)}%
              </p>
            </div>
            <div className="text-2xl text-muted-foreground">→</div>
            <div className="text-center">
              <p className="text-[10px] text-muted-foreground">With Changes</p>
              <p className={cn("text-2xl font-bold", successColor(mc.optSuccessRate))}>
                {mc.optSuccessRate.toFixed(0)}%
              </p>
              {mc.optSuccessRate > mc.baseSuccessRate && (
                <p className="text-[10px] text-success">+{(mc.optSuccessRate - mc.baseSuccessRate).toFixed(0)}pp</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-muted rounded-xl p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground">Median Retirement Income</p>
              <p className="text-sm font-bold text-foreground">{formatCurrency(det.oAfterTax)}/yr</p>
            </div>
            <div className="bg-muted rounded-xl p-2.5 text-center">
              <p className="text-[10px] text-muted-foreground">Replacement Rate</p>
              <p className="text-sm font-bold text-foreground">{det.oRepl.toFixed(0)}%</p>
            </div>
          </div>
        </Card>

        <Card className="space-y-3">
          <SectionHeader title="Do This First" />
          {auto.top && auto.top.gain > 0 ? (
            <>
              <p className="text-sm font-bold text-primary">{auto.top.name}</p>
              <p className="text-lg font-bold text-success">+{formatCurrency(auto.top.gain)}/yr</p>
              <p className="text-[10px] text-muted-foreground">
                {auto.top.id === "spendingCut" && `Reduce spending by ${formatCurrency(auto.top.value)}/yr`}
                {auto.top.id === "salarySacrificeExtra" && `Salary sacrifice ${formatCurrency(auto.top.value)}/yr extra`}
                {auto.top.id === "mortgageVsInvest" && `Allocate ${auto.top.value}% of surplus to mortgage`}
                {auto.top.id === "giftToSpouse" && `Gift ${formatCurrency(auto.top.value)}/yr to spouse`}
                {auto.top.id === "portfolioReturnPct" && `Target ${auto.top.value}% portfolio return`}
              </p>
              <button
                onClick={() => setI({ [auto.top.id]: auto.top.value })}
                className="mt-2 w-full h-8 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity">
                Apply
              </button>
            </>
          ) : (
            <p className="text-[10px] text-muted-foreground">Adjust the levers below to see what helps most.</p>
          )}
        </Card>
      </div>

      {/* All levers ranked */}
      <Card className="space-y-3">
        <SectionHeader title="What Moves the Needle (Ranked)" />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">#</th>
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Lever</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Best Setting</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Extra Income/yr</th>
              </tr>
            </thead>
            <tbody>
              {auto.rankings.filter(r => r.gain > 0).map((r, idx) => (
                <tr key={r.id} className="border-b border-border/50">
                  <td className="py-2 px-2 font-medium text-muted-foreground">{idx + 1}</td>
                  <td className="py-2 px-2 font-medium text-foreground">{r.name}</td>
                  <td className="py-2 px-2 text-right">
                    {r.id === "spendingCut" && formatCurrency(r.value)}
                    {r.id === "salarySacrificeExtra" && formatCurrency(r.value)}
                    {r.id === "mortgageVsInvest" && `${r.value}%`}
                    {r.id === "giftToSpouse" && formatCurrency(r.value)}
                    {r.id === "portfolioReturnPct" && `${r.value}%`}
                  </td>
                  <td className="py-2 px-2 text-right text-success">+{formatCurrency(r.gain)}/yr</td>
                </tr>
              ))}
              {auto.rankings.filter(r => r.gain > 0).length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-muted-foreground">
                    No levers have positive impact — try adjusting the settings below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Sliders */}
      <Card className="space-y-4">
        <SectionHeader title="Fine-Tune Your Levers" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-medium text-foreground">Spending Cut</span>
              <span className="text-xs text-muted-foreground">{formatCurrency(det.cut)}/yr of {formatCurrency(p.currentSpending)}</span>
            </div>
            <input type="range" min={0} max={Math.max(0, Math.round(p.currentSpending * 0.5 / 1000) * 1000)} step={500}
              value={det.cut}
              onChange={e => setI({ spendingCut: parseFloat(e.target.value) || 0 })}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-muted accent-primary" />
          </div>
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-medium text-foreground">Extra Salary Sacrifice</span>
              <span className="text-xs text-muted-foreground">Tax saved: {formatCurrency(det.annualTaxSaved)}/yr</span>
            </div>
            <input type="range" min={0} max={32500} step={500}
              value={i.salarySacrificeExtra}
              onChange={e => setI({ salarySacrificeExtra: parseFloat(e.target.value) || 0 })}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-muted accent-primary" />
          </div>
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-medium text-foreground">Mortgage vs Invest: {i.mortgageVsInvest}% to mortgage</span>
            </div>
            <input type="range" min={0} max={100} step={5}
              value={i.mortgageVsInvest}
              onChange={e => setI({ mortgageVsInvest: parseFloat(e.target.value) || 50 })}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-muted accent-primary" />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
              <span>All invest</span>
              <span>All mortgage</span>
            </div>
          </div>
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-medium text-foreground">Gift to Spouse</span>
              {p.spouseMarginalRate < p.marginalRate && (
                <span className="text-xs text-success">
                  Her rate: {(p.spouseMarginalRate * 100).toFixed(0)}% vs {(p.marginalRate * 100).toFixed(0)}%
                </span>
              )}
            </div>
            <input type="range" min={0} max={50000} step={1000}
              value={i.giftToSpouse}
              onChange={e => setI({ giftToSpouse: parseFloat(e.target.value) || 0 })}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-muted accent-primary" />
          </div>
          <div className="sm:col-span-2">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-medium text-foreground">Portfolio Return: {i.portfolioReturnPct}%</span>
              <div className="flex gap-1">
                {[6, 8, 10, 14].map(r => (
                  <button key={r}
                    onClick={() => setI({ portfolioReturnPct: r })}
                    className={cn("px-2 py-0.5 rounded text-[11px] font-medium transition-colors",
                      i.portfolioReturnPct === r
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent",
                    )}>
                    {r}%
                  </button>
                ))}
              </div>
            </div>
            <input type="range" min={3} max={16} step={0.5}
              value={i.portfolioReturnPct}
              onChange={e => setI({ portfolioReturnPct: parseFloat(e.target.value) || 8 })}
              className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-muted accent-primary" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:col-span-2">
            <Input label="Mortgage Balance" type="number" value={i.mortgageBalance}
              onChange={v => setI({ mortgageBalance: parseFloat(v) || 0 })} prefix="$" />
            <Input label="Mortgage Rate %" type="number" value={i.mortgageRate}
              onChange={v => setI({ mortgageRate: parseFloat(v) || 6.2 })} />
          </div>
        </div>
      </Card>

      {/* Chart */}
      {pathData && (
        <Card className="space-y-2">
          <SectionHeader title="Net Worth Trajectory (Median Projection)" />
          <svg viewBox={`0 0 ${pathData.w} ${pathData.h}`} className="w-full max-h-52" preserveAspectRatio="xMidYMid meet">
            <polyline points={pathData.bPts} fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.6} />
            <polyline points={pathData.oPts} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} />
            <text x={pathData.w - 60} y={14} fontSize={10} fill="hsl(var(--muted-foreground))">Baseline</text>
            <text x={pathData.w - 60} y={28} fontSize={10} fill="hsl(var(--primary))">Optimized</text>
          </svg>
        </Card>
      )}

      {det.mortgageFreeYear && (
        <div className="bg-success/10 rounded-xl p-3 text-xs text-success text-center">
          Mortgage-free at age {det.mortgageFreeYear} with current pivot settings.
        </div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export function FinancialPlannerPage() {
  const [activeTab, setActiveTab] = useState<ScenarioTab>("rent-vs-buy");

  return (
    <div className="space-y-4">
      <PageHeader title="Financial Planner" subtitle="Compare scenarios to optimise your financial strategy" />

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap",
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "rent-vs-buy" && <RentVsBuy />}
      {activeTab === "super-strategy" && <SuperStrategy />}
      {activeTab === "investment-property" && <InvestmentProperty />}
      {activeTab === "fire" && <FireCalculator />}
      {activeTab === "lump-sum" && <LumpSumOptimizer />}
      {activeTab === "pivot-optimizer" && <PivotOptimizer />}
    </div>
  );
}
