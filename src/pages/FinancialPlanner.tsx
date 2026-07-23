import { useState, useMemo } from "react";
import { useStore } from "../store";
import { formatCurrency, formatDate, getBudgetDateRange } from "../utils";
import { Card, Button, Input, SectionHeader } from "../components/ui";
import { PageHeader } from "../components/Layout";
import {
  Home, TrendingUp, Calculator, PiggyBank, Landmark, Shield,
  ChevronRight, DollarSign, Clock, BarChart3,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  calculateSaStampDuty, calculateSaLandTax,
  calculateTotalIncomeTax, getTaxYearRates, getMarginalRate,
  calculateSalarySacrificeBenefit, modelSuperStrategy,
  getSuperCaps, calculateCarryForward, calculateBringForward,
} from "../tax";

// ─── Tab Navigation ─────────────────────────────────────────────────────────

type ScenarioTab = "rent-vs-buy" | "super-strategy" | "investment-property" | "fire" | "lump-sum";

const TABS: { id: ScenarioTab; label: string; icon: React.ElementType }[] = [
  { id: "rent-vs-buy", label: "Rent vs Buy", icon: Home },
  { id: "super-strategy", label: "Super Strategy", icon: Landmark },
  { id: "investment-property", label: "Investment Property", icon: TrendingUp },
  { id: "fire", label: "FIRE Calculator", icon: Calculator },
  { id: "lump-sum", label: "Lump Sum", icon: DollarSign },
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

// ─── Rent vs Buy ────────────────────────────────────────────────────────────

function RentVsBuy() {
  const selfAnnualSalary = useStore(s => s.selfAnnualSalary);

  // Personal details
  const [currentAge, setCurrentAge] = useState(30);
  const [retirementAge, setRetirementAge] = useState(65);
  const [targetAge, setTargetAge] = useState(90);
  const [annualIncome, setAnnualIncome] = useState(selfAnnualSalary ?? 120000);

  // Rent scenario
  const [weeklyRent, setWeeklyRent] = useState(550);
  const [rentIncreasePct, setRentIncreasePct] = useState(3);
  const [investReturnPct, setInvestReturnPct] = useState(8);

  // Buy scenario
  const [purchasePrice, setPurchasePrice] = useState(650000);
  const [depositPct, setDepositPct] = useState(20);
  const [mortgageRate, setMortgageRate] = useState(6.2);
  const [mortgageTerm, setMortgageTerm] = useState(30);
  const [capitalGrowthPct, setCapitalGrowthPct] = useState(4);
  const [isFirstHomeBuyer, setIsFirstHomeBuyer] = useState(false);
  const [isPPR, setIsPPR] = useState(true);

  // Property costs (annual, year-0 values — all inflate at inflationPct)
  const [councilRates, setCouncilRates] = useState(2200);
  const [homeInsurance, setHomeInsurance] = useState(2000);
  const [maintenancePct, setMaintenancePct] = useState(1);
  const [strataBodyCorp, setStrataBodyCorp] = useState(0);

  // Common
  const [inflationPct, setInflationPct] = useState(3);

  // Downsizing
  const [downsizeAge, setDownsizeAge] = useState(65);
  const [downsizeAction, setDownsizeAction] = useState<"buy" | "rent" | "none">("buy");
  const [downsizePurchasePrice, setDownsizePurchasePrice] = useState(400000);
  const [downsizeWeeklyRent, setDownsizeWeeklyRent] = useState(350);
  const [downsizeCouncilRates, setDownsizeCouncilRates] = useState(1500);
  const [downsizeHomeInsurance, setDownsizeHomeInsurance] = useState(1400);
  const [downsizeMaintenancePct, setDownsizeMaintenancePct] = useState(1);
  const [downsizeStrataBodyCorp, setDownsizeStrataBodyCorp] = useState(0);

  // Tax & Pension
  const [cgtRatePct, setCgtRatePct] = useState(22.5); // effective CGT rate (50% discount * marginal rate)
  const [includePension, setIncludePension] = useState(true);

  const result = useMemo(() => {
    const years = targetAge - currentAge;
    if (years <= 0) return null;

    const deposit = purchasePrice * (depositPct / 100);
    const loanAmount = purchasePrice - deposit;
    const stampDutyResult = calculateSaStampDuty(purchasePrice, { isPrincipalPlace: isPPR, isFirstHomeBuyer });
    const totalUpfront = deposit + stampDutyResult.netDuty + 1500;

    const monthlyRate = mortgageRate / 100 / 12;
    const totalPayments = mortgageTerm * 12;
    const monthlyRepayment = loanAmount > 0
      ? loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, totalPayments))
        / (Math.pow(1 + monthlyRate, totalPayments) - 1)
      : 0;

    const cgtRate = cgtRatePct / 100;
    const investReturn = investReturnPct / 100;

    let renterPortfolio = totalUpfront;
    let buyerPortfolio = 0;
    let propertyValue = purchasePrice;
    let loanBalance = loanAmount;
    let currentWeeklyRent = weeklyRent;

    let downsizeExecuted = false;
    let newPropertyValue = 0;
    let newLoanBalance = 0;
    let downsizeProceeds = 0;
    let downsizeYear: number | null = null;
    const actualDownsizeAge = Math.min(downsizeAge, retirementAge);

    let totalRentPaid = 0;
    let totalMortgagePaid = 0;
    let totalPropertyCostsPaid = 0;
    let totalCGTPaid = 0;

    const rentPath: number[] = [];
    const buyPath: number[] = [];
    const renterPensionPath: number[] = [];
    const buyerPensionPath: number[] = [];

    for (let y = 0; y <= years; y++) {
      const age = currentAge + y;
      const inflationFactor = Math.pow(1 + inflationPct / 100, y);
      const yearIncome = annualIncome * inflationFactor;

      const buyerEquity = !downsizeExecuted ? Math.max(0, propertyValue - loanBalance) : 0;
      const buyerNewEquity = downsizeExecuted && downsizeAction === "buy"
        ? Math.max(0, newPropertyValue - newLoanBalance) : 0;

      // Renter: home = no asset (homeowner = false for pension)
      const renterAssessable = renterPortfolio;
      const renterPension = (age >= retirementAge && includePension)
        ? calcAgePension(renterAssessable, false) : 0;

      // Buyer: home EXCLUDED from assets test, only portfolio is assessable
      const buyerHomeValue = !downsizeExecuted ? propertyValue
        : (downsizeAction === "buy" ? newPropertyValue : 0);
      const buyerAssessable = buyerPortfolio;
      const buyerIsHomeowner = downsizeAction !== "rent" || !downsizeExecuted;
      const buyerPension = (age >= retirementAge && includePension && buyerIsHomeowner)
        ? calcAgePension(buyerAssessable, true) : 0;

      rentPath.push(renterPortfolio);
      buyPath.push(buyerEquity + buyerNewEquity + buyerPortfolio);
      renterPensionPath.push(renterPension);
      buyerPensionPath.push(buyerPension);

      if (y === 0) continue;

      // Downsize event
      if (age >= actualDownsizeAge && isPPR && downsizeAction !== "none" && !downsizeExecuted) {
        downsizeExecuted = true;
        downsizeYear = y;
        downsizeProceeds = Math.max(0, propertyValue - loanBalance);
        loanBalance = 0;
        propertyValue = 0;

        if (downsizeAction === "buy") {
          const newDuty = calculateSaStampDuty(downsizePurchasePrice, { isPrincipalPlace: true, isFirstHomeBuyer: false });
          const needed = downsizePurchasePrice + newDuty.netDuty;
          if (downsizeProceeds >= needed) {
            newPropertyValue = downsizePurchasePrice;
            newLoanBalance = 0;
            buyerPortfolio += downsizeProceeds - needed;
          } else {
            newPropertyValue = downsizePurchasePrice;
            newLoanBalance = needed - downsizeProceeds;
          }
        } else {
          buyerPortfolio += downsizeProceeds;
          currentWeeklyRent = downsizeWeeklyRent;
        }
      }

      // ─── Costs ───
      let yearMortgagePayment = 0;
      let yearPropertyCosts = 0;
      let yearDownsizeCosts = 0;

      if (!downsizeExecuted) {
        yearPropertyCosts = (councilRates + homeInsurance + strataBodyCorp) * inflationFactor
          + propertyValue * (maintenancePct / 100);
        totalPropertyCostsPaid += yearPropertyCosts;

        if (loanBalance > 0) {
          yearMortgagePayment = Math.min(monthlyRepayment * 12, loanBalance * (1 + monthlyRate));
          const yearInterest = loanBalance * (mortgageRate / 100);
          loanBalance = Math.max(0, loanBalance - (yearMortgagePayment - yearInterest));
          totalMortgagePaid += yearMortgagePayment;
        }
        propertyValue = propertyValue * (1 + capitalGrowthPct / 100);
      } else if (downsizeAction === "buy") {
        yearDownsizeCosts = (downsizeCouncilRates + downsizeHomeInsurance + downsizeStrataBodyCorp) * inflationFactor
          + newPropertyValue * (downsizeMaintenancePct / 100);
        if (newLoanBalance > 0) {
          const newYearMortgage = Math.min(monthlyRepayment * 12, newLoanBalance * (1 + monthlyRate));
          const newYearInterest = newLoanBalance * (mortgageRate / 100);
          newLoanBalance = Math.max(0, newLoanBalance - (newYearMortgage - newYearInterest));
          yearDownsizeCosts += newYearMortgage;
          totalMortgagePaid += newYearMortgage;
        }
        newPropertyValue = newPropertyValue * (1 + capitalGrowthPct / 100);
        totalPropertyCostsPaid += yearDownsizeCosts;
      } else if (downsizeAction === "rent") {
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

      currentWeeklyRent *= (1 + rentIncreasePct / 100);
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
      renterAssessableAtRetirement: rentPath[Math.min(retirementAge - currentAge, years)],
      buyerPortfolioAtRetirement: buyPath[Math.min(retirementAge - currentAge, years)],
      renterPensionAtRetirement: renterPensionPath[Math.min(retirementAge - currentAge, years)],
      buyerPensionAtRetirement: buyerPensionPath[Math.min(retirementAge - currentAge, years)],
    };
  }, [currentAge, retirementAge, targetAge, annualIncome, weeklyRent, rentIncreasePct,
      investReturnPct, purchasePrice, depositPct, mortgageRate, mortgageTerm,
      capitalGrowthPct, isFirstHomeBuyer, isPPR, councilRates, homeInsurance,
      maintenancePct, strataBodyCorp, inflationPct, downsizeAge, downsizeAction,
      downsizePurchasePrice, downsizeWeeklyRent, downsizeCouncilRates,
      downsizeHomeInsurance, downsizeMaintenancePct, downsizeStrataBodyCorp,
      cgtRatePct, includePension]);

  if (!result) {
    return <div className="text-sm text-muted-foreground p-4">Target age must be greater than current age.</div>;
  }

  return (
    <div className="space-y-4">
      {/* Row 1: Personal Details + Rent */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="space-y-3">
          <SectionHeader title="Your Details" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Current Age" type="number" value={currentAge}
              onChange={v => setCurrentAge(parseInt(v) || 30)} />
            <Input label="Retirement Age" type="number" value={retirementAge}
              onChange={v => setRetirementAge(parseInt(v) || 65)} />
            <Input label="Compare Until Age" type="number" value={targetAge}
              onChange={v => setTargetAge(parseInt(v) || 90)} />
            <Input label="Annual Household Income" type="number" value={annualIncome}
              onChange={v => setAnnualIncome(parseFloat(v) || 0)} prefix="$" />
          </div>
        </Card>

        <Card className="space-y-3">
          <SectionHeader title="Rent + Invest" />
          <Input label="Weekly Rent" type="number" value={weeklyRent}
            onChange={v => setWeeklyRent(parseFloat(v) || 0)} prefix="$" />
          <Input label="Annual Rent Increase %" type="number" value={rentIncreasePct}
            onChange={v => setRentIncreasePct(parseFloat(v) || 0)} prefix="%" />
          <Input label="Investment Return %" type="number" value={investReturnPct}
            onChange={v => setInvestReturnPct(parseFloat(v) || 0)} prefix="%" />
          <p className="text-[10px] text-muted-foreground">
            Deposit money + yearly savings difference invested at {investReturnPct}% p.a.
          </p>
        </Card>
      </div>

      {/* Row 2: Buy + Property Costs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="space-y-3">
          <SectionHeader title="Buy Family Home" />
          <Input label="Purchase Price" type="number" value={purchasePrice}
            onChange={v => setPurchasePrice(parseFloat(v) || 0)} prefix="$" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Deposit %" type="number" value={depositPct}
              onChange={v => setDepositPct(parseFloat(v) || 0)} prefix="%" />
            <Input label="Mortgage Rate %" type="number" value={mortgageRate}
              onChange={v => setMortgageRate(parseFloat(v) || 0)} prefix="%" />
            <Input label="Mortgage Term (yrs)" type="number" value={mortgageTerm}
              onChange={v => setMortgageTerm(parseInt(v) || 30)} />
            <Input label="Capital Growth %" type="number" value={capitalGrowthPct}
              onChange={v => setCapitalGrowthPct(parseFloat(v) || 0)} prefix="%" />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={isFirstHomeBuyer}
                onChange={e => setIsFirstHomeBuyer(e.target.checked)}
                className="rounded border-border" />
              First Home Buyer
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={isPPR}
                onChange={e => setIsPPR(e.target.checked)}
                className="rounded border-border" />
              Principal Place
            </label>
          </div>
        </Card>

        <Card className="space-y-3">
          <SectionHeader title="Ownership Costs (Annual)" />
          <p className="text-[10px] text-muted-foreground">All costs inflate at the inflation rate below.</p>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Council Rates" type="number" value={councilRates}
              onChange={v => setCouncilRates(parseFloat(v) || 0)} prefix="$" />
            <Input label="Home Insurance" type="number" value={homeInsurance}
              onChange={v => setHomeInsurance(parseFloat(v) || 0)} prefix="$" />
            <Input label="Maintenance %" type="number" value={maintenancePct}
              onChange={v => setMaintenancePct(parseFloat(v) || 0)} prefix="%" sublabel="of property value" />
            <Input label="Strata / Body Corp" type="number" value={strataBodyCorp}
              onChange={v => setStrataBodyCorp(parseFloat(v) || 0)} prefix="$" />
          </div>
          <div className="max-w-[140px]">
            <Input label="Inflation %" type="number" value={inflationPct}
              onChange={v => setInflationPct(parseFloat(v) || 0)} prefix="%" />
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
          <Input label="Downsize at Age" type="number" value={downsizeAge}
            onChange={v => setDownsizeAge(parseInt(v) || 65)} />
          <div className="flex items-end gap-2">
            {([
              { id: "buy" as const, label: "Buy Smaller" },
              { id: "rent" as const, label: "Rent Smaller" },
              { id: "none" as const, label: "Don't Downsize" },
            ]).map(opt => (
              <button
                key={opt.id}
                onClick={() => setDownsizeAction(opt.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                  downsizeAction === opt.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {downsizeAction === "buy" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
              <Input label="Downsized Purchase Price" type="number" value={downsizePurchasePrice}
                onChange={v => setDownsizePurchasePrice(parseFloat(v) || 0)} prefix="$" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Council Rates" type="number" value={downsizeCouncilRates}
                onChange={v => setDownsizeCouncilRates(parseFloat(v) || 0)} prefix="$" />
              <Input label="Home Insurance" type="number" value={downsizeHomeInsurance}
                onChange={v => setDownsizeHomeInsurance(parseFloat(v) || 0)} prefix="$" />
              <Input label="Maintenance %" type="number" value={downsizeMaintenancePct}
                onChange={v => setDownsizeMaintenancePct(parseFloat(v) || 0)} prefix="%" />
              <Input label="Strata / Body Corp" type="number" value={downsizeStrataBodyCorp}
                onChange={v => setDownsizeStrataBodyCorp(parseFloat(v) || 0)} prefix="$" />
            </div>
          </div>
        )}

        {downsizeAction === "rent" && (
          <div className="max-w-[200px]">
            <Input label="Weekly Rent (Smaller Place)" type="number" value={downsizeWeeklyRent}
              onChange={v => setDownsizeWeeklyRent(parseFloat(v) || 0)} prefix="$" />
          </div>
        )}
      </Card>

      {/* Tax & Pension */}
      <Card className="space-y-3">
        <SectionHeader title="Tax & Age Pension" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Effective CGT Rate %" type="number" value={cgtRatePct}
            onChange={v => setCgtRatePct(parseFloat(v) || 0)} prefix="%"
            sublabel="50% discount × marginal rate" />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={includePension}
                onChange={e => setIncludePension(e.target.checked)}
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
          {includePension && (
            <div className="bg-muted rounded-xl p-3 text-center">
              <p className="text-[10px] text-muted-foreground">Total Pension Received</p>
              <p className="text-sm font-bold text-success">{formatCurrency(result.totalPensionReceived)}</p>
            </div>
          )}
          {result.downsizeYear !== null && (
            <div className="bg-muted rounded-xl p-3 text-center">
              <p className="text-[10px] text-muted-foreground">Downsize at Age {currentAge + result.downsizeYear}</p>
              <p className="text-sm font-bold text-success">{formatCurrency(result.downsizeProceeds)}</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Net Worth at Age {targetAge} (Rent)</p>
            <p className={cn("text-sm font-bold", result.finalRentNetWorth >= result.finalBuyNetWorth ? "text-success" : "text-foreground")}>
              {formatCurrency(result.finalRentNetWorth)}
            </p>
            <p className="text-[9px] text-muted-foreground mt-0.5">Total rent: {formatCurrency(result.totalRentPaid)}</p>
            {includePension && <p className="text-[9px] text-success mt-0.5">Pension: {formatCurrency(result.totalRenterPension)}</p>}
          </div>
          <div className="bg-muted rounded-xl p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Net Worth at Age {targetAge} (Buy)</p>
            <p className={cn("text-sm font-bold", result.finalBuyNetWorth >= result.finalRentNetWorth ? "text-success" : "text-foreground")}>
              {formatCurrency(result.finalBuyNetWorth)}
            </p>
            <p className="text-[9px] text-muted-foreground mt-0.5">Total mortgage: {formatCurrency(result.totalMortgagePaid)}</p>
            {includePension && <p className="text-[9px] text-success mt-0.5">Pension: {formatCurrency(result.totalBuyerPension)}</p>}
          </div>
        </div>

        {includePension && (() => {
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
                <p className="text-xs font-medium text-foreground">Age Pension Analysis (at retirement age {retirementAge})</p>
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
            Buying overtakes renting at age {currentAge + result.breakevenYear} (year {result.breakevenYear}).
            After that point, buying is financially better.
          </div>
        )}
        {!result.breakevenYear && (
          <div className="bg-primary/10 rounded-lg p-3 text-xs text-primary">
            Renting remains financially better throughout the entire {targetAge - currentAge}-year period.
          </div>
        )}

        {/* Year-by-year comparison */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Age</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Rent Net Worth</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Buy Net Worth</th>
                {includePension && (
                  <>
                    <th className="text-right py-2 px-2 text-muted-foreground font-medium">Renter Pension</th>
                    <th className="text-right py-2 px-2 text-muted-foreground font-medium">Buyer Pension</th>
                  </>
                )}
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Winner</th>
              </tr>
            </thead>
            <tbody>
              {result.rentPath.map((rentVal, i) => {
                if (i % 5 !== 0 && i !== result.rentPath.length - 1 && i !== result.downsizeYear) return null;
                const buyVal = result.buyPath[i];
                const rentPension = result.renterPensionPath[i];
                const buyPension = result.buyerPensionPath[i];
                return (
                  <tr key={i} className={cn("border-b border-border/50",
                    i === result.downsizeYear && "bg-info/5")}>
                    <td className="py-2 px-2 font-medium">
                      {currentAge + i}
                      {i === result.downsizeYear && <span className="ml-1 text-info text-[10px]">(downsize)</span>}
                    </td>
                    <td className="py-2 px-2 text-right">{formatCurrency(rentVal)}</td>
                    <td className="py-2 px-2 text-right">{formatCurrency(buyVal)}</td>
                    {includePension && (
                      <>
                        <td className="py-2 px-2 text-right text-success">{rentPension > 0 ? formatCurrency(rentPension) : "—"}</td>
                        <td className="py-2 px-2 text-right text-success">{buyPension > 0 ? formatCurrency(buyPension) : "—"}</td>
                      </>
                    )}
                    <td className={cn("py-2 px-2 text-right font-medium",
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
          Both scenarios assume the same household income (inflating at {inflationPct}% p.a.).
          Renter invests the deposit + yearly savings difference at {investReturnPct}% p.a. after CGT.
          Buyer pays mortgage, council rates, insurance, maintenance ({maintenancePct}% of value), and strata — all inflating at {inflationPct}% p.a.
          {downsizeAction !== "none" && ` Family home sold at age ${Math.min(downsizeAge, retirementAge)} (PPR = no CGT). ${
            downsizeAction === "buy"
              ? `Downsizing to ${formatCurrency(downsizePurchasePrice)} property.`
              : `Investing sale proceeds, renting at $${downsizeWeeklyRent}/wk.`
          }`}
          {includePension && ` Age Pension included (couple rates, means-tested on assessable assets — PPR excluded).`}
        </p>
      </Card>
    </div>
  );
}

// ─── Super Strategy Optimizer ───────────────────────────────────────────────

function SuperStrategy() {
  const selfAge = useStore(s => s.selfAge);
  const selfRetirementAge = useStore(s => s.selfRetirementAge);
  const selfAnnualSalary = useStore(s => s.selfAnnualSalary);
  const selfSalarySacrifice = useStore(s => s.selfSalarySacrifice);
  const taxYearLabel = useStore(s => s.taxYearLabel);
  const holdings = useStore(s => s.holdings);
  const getHoldingSummary = useStore(s => s.getHoldingSummary);

  const [annualReturnPct, setAnnualReturnPct] = useState(7);
  const [yearsToProject, setYearsToProject] = useState(20);

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
      yearsToProject: Math.min(years, yearsToProject),
      annualReturnPct,
      fyLabel,
    });

    const benefit = calculateSalarySacrificeBenefit(
      strategy.optimisedPath.additionalSS,
      marginalRate,
    );

    return { ...strategy, benefit, currentAge, retireAge, fyLabel, marginalRate };
  }, [selfAnnualSalary, selfSalarySacrifice, selfAge, selfRetirementAge, taxYearLabel,
      holdings, getHoldingSummary, annualReturnPct, yearsToProject]);

  return (
    <div className="space-y-4">
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
              <Input label="Investment Return %" type="number" value={annualReturnPct}
                onChange={v => setAnnualReturnPct(parseFloat(v) || 7)} prefix="%" />
            </div>
            <div className="flex-1 max-w-[160px]">
              <Input label="Project Years" type="number" value={yearsToProject}
                onChange={v => setYearsToProject(parseInt(v) || 20)} />
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
  const selfAnnualSalary = useStore(s => s.selfAnnualSalary);
  const taxYearLabel = useStore(s => s.taxYearLabel);

  const [purchasePrice, setPurchasePrice] = useState(550000);
  const [depositPct, setDepositPct] = useState(20);
  const [mortgageRate, setMortgageRate] = useState(6.2);
  const [weeklyRent, setWeeklyRent] = useState(450);
  const [capitalGrowthPct, setCapitalGrowthPct] = useState(4);
  const [rentIncreasePct, setRentIncreasePct] = useState(3);
  const [isPreReform, setIsPreReform] = useState(true); // Acquired before 12 May 2026
  const [years, setYears] = useState(20);

  const annualSalary = selfAnnualSalary ?? 85000;
  const fyLabel = taxYearLabel ?? "2026-27";

  const result = useMemo(() => {
    const deposit = purchasePrice * (depositPct / 100);
    const loanAmount = purchasePrice - deposit;
    const monthlyRate = mortgageRate / 100 / 12;
    const totalPayments = 30 * 12;
    const monthlyRepayment = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, totalPayments))
      / (Math.pow(1 + monthlyRate, totalPayments) - 1);

    const stampDutyResult = calculateSaStampDuty(purchasePrice, { isPrincipalPlace: false, isFirstHomeBuyer: false });

    const taxYear = getTaxYearRates(fyLabel);
    const marginalRate = getMarginalRate(annualSalary, taxYear);

    let propertyValue = purchasePrice;
    let loanBalance = loanAmount;
    let currentRent = weeklyRent * 52;
    let totalNetReturn = 0;
    let totalTaxSaved = 0;
    let totalRentalIncome = 0;
    let totalInterestPaid = 0;
    let totalCapitalGain = 0;

    const yearlyData: {
      year: number; propertyValue: number; equity: number; rentalIncome: number;
      interestPaid: number; taxDeduction: number; taxSaved: number; netCashFlow: number;
    }[] = [];

    for (let y = 1; y <= years; y++) {
      const yearRentalIncome = currentRent;
      const yearInterest = loanBalance * (mortgageRate / 100);
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
      propertyValue = propertyValue * (1 + capitalGrowthPct / 100);
      const yearMortgage = monthlyRepayment * 12;
      const yearPrincipal = yearMortgage - yearInterest;
      loanBalance = Math.max(0, loanBalance - yearPrincipal);
      currentRent = currentRent * (1 + rentIncreasePct / 100);
    }

    // CGT on disposal
    const capitalGain = propertyValue - purchasePrice;
    totalCapitalGain = capitalGain;

    // Post-2027 reform: indexation + 30% min tax for gains after 1 July 2027
    // Pre-reform: 50% discount
    let cgtPayable: number;
    if (isPreReform) {
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
  }, [purchasePrice, depositPct, mortgageRate, weeklyRent, capitalGrowthPct,
      rentIncreasePct, isPreReform, years, annualSalary, fyLabel]);

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <SectionHeader title="Investment Property (SA)" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            <Input label="Purchase Price" type="number" value={purchasePrice}
              onChange={v => setPurchasePrice(parseFloat(v) || 0)} prefix="$" />
            <Input label="Deposit %" type="number" value={depositPct}
              onChange={v => setDepositPct(parseFloat(v) || 0)} prefix="%" />
            <Input label="Mortgage Rate %" type="number" value={mortgageRate}
              onChange={v => setMortgageRate(parseFloat(v) || 0)} prefix="%" />
            <Input label="Weekly Rent" type="number" value={weeklyRent}
              onChange={v => setWeeklyRent(parseFloat(v) || 0)} prefix="$" />
          </div>
          <div className="space-y-3">
            <Input label="Capital Growth %" type="number" value={capitalGrowthPct}
              onChange={v => setCapitalGrowthPct(parseFloat(v) || 0)} prefix="%" />
            <Input label="Rent Increase %" type="number" value={rentIncreasePct}
              onChange={v => setRentIncreasePct(parseFloat(v) || 0)} prefix="%" />
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" checked={isPreReform}
                onChange={e => setIsPreReform(e.target.checked)}
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
            <p className="text-[10px] text-muted-foreground">Tax Saved ({years}yr)</p>
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
              {result.yearlyData.filter(d => d.year % 5 === 0 || d.year === years).map(d => (
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

  const [annualReturnPct, setAnnualReturnPct] = useState(8);
  const [annualSpendingInput, setAnnualSpendingInput] = useState<number | "">("");
  const [selfSavingsRate, setSelfSavingsRate] = useState<number | "">("");
  const [partnerSavingsRate, setPartnerSavingsRate] = useState<number | "">("");
  const [withdrawalRatePct, setWithdrawalRatePct] = useState(4);
  const [inflationPct, setInflationPct] = useState(3);
  const [showMonthly, setShowMonthly] = useState(false);

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
    const annualSpending = annualSpendingInput !== "" && annualSpendingInput > 0
      ? annualSpendingInput
      : currentSpending > 0 ? currentSpending : 48000;

    // ── Savings rate (per spouse, based on gross income for FIRE modeling) ──
    const autoSelfRate = selfGross > 0 && currentSpending > 0
      ? Math.max(0, (selfGross - (currentSpending * (selfGross / (selfGross + partnerGross)))) / selfGross)
      : 0.2;
    const autoPartnerRate = partnerGross > 0 && currentSpending > 0
      ? Math.max(0, (partnerGross - (currentSpending * (partnerGross / (selfGross + partnerGross)))) / partnerGross)
      : 0.2;

    const effSelfRate = selfSavingsRate !== "" && selfSavingsRate > 0
      ? selfSavingsRate / 100
      : autoSelfRate;
    const effPartnerRate = partnerSavingsRate !== "" && partnerSavingsRate > 0
      ? partnerSavingsRate / 100
      : autoPartnerRate;

    const selfAnnualSavings = selfGross * effSelfRate;
    const partnerAnnualSavings = partnerGross * effPartnerRate;
    const combinedAnnualSavings = selfAnnualSavings + partnerAnnualSavings;

    // Use manual rates if set, otherwise use actual budget-derived savings
    const annualSavings = (selfSavingsRate !== "" || partnerSavingsRate !== "")
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

    const realReturn = Math.pow(1 + annualReturnPct / 100, 1 / (1 + inflationPct / 100)) - 1;

    // FIRE number
    const fireNumber = annualSpending / (withdrawalRatePct / 100);

    // Projection
    let balance = portfolio;
    const projection: { year: number; age: number; balance: number; phase: "accumulation" | "withdrawal" }[] = [];
    let yearsToFIRE: number | null = null;

    for (let y = 0; y <= maxYears; y++) {
      projection.push({ year: y, age: currentAge + y, balance, phase: balance >= fireNumber ? "withdrawal" : "accumulation" });
      if (y === maxYears) break;
      if (balance >= fireNumber) {
        const withdrawal = balance * (withdrawalRatePct / 100);
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
  }, [selfAge, selfRetirementAge, selfAnnualSalary, partnerAnnualSalary,
      selfSalarySacrifice, partnerSalarySacrifice,
      holdings, getHoldingSummary, budgets, categories, expenses,
      incomeSources, annualReturnPct, annualSpendingInput,
      selfSavingsRate, partnerSavingsRate, withdrawalRatePct, inflationPct]);

  return (
    <div className="space-y-4">
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
            {annualSpendingInput === "" && result.currentSpending > 0 && (
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
              At {withdrawalRatePct}% withdrawal rate, your portfolio sustains {formatCurrency(result.annualSpending)}/yr.
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
          <Input label="Annual Spending Target" type="number" value={annualSpendingInput || ""}
            onChange={v => setAnnualSpendingInput(parseFloat(v) || "")} prefix="$"
            placeholder={result.currentSpending > 0 ? formatCurrency(result.currentSpending) : "48000"} />
          <Input label="Investment Return %" type="number" value={annualReturnPct}
            onChange={v => setAnnualReturnPct(parseFloat(v) || 8)} prefix="%" />
          <Input label="Withdrawal Rate %" type="number" value={withdrawalRatePct}
            onChange={v => setWithdrawalRatePct(parseFloat(v) || 4)} prefix="%" />
          <Input label="Inflation %" type="number" value={inflationPct}
            onChange={v => setInflationPct(parseFloat(v) || 3)} prefix="%" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Your Savings Rate %" type="number" value={selfSavingsRate || ""}
            onChange={v => setSelfSavingsRate(parseFloat(v) || "")} prefix="%"
            placeholder={result.selfGross > 0 ? `${(result.autoSelfRate * 100).toFixed(0)}%` : "—"} />
          <Input label="Wife's Savings Rate %" type="number" value={partnerSavingsRate || ""}
            onChange={v => setPartnerSavingsRate(parseFloat(v) || "")} prefix="%"
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
              onClick={() => setShowMonthly(false)}
              className={cn("px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
                !showMonthly ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Yearly
            </button>
            <button
              onClick={() => setShowMonthly(true)}
              className={cn("px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors",
                showMonthly ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Monthly
            </button>
          </div>
        </div>

        {!showMonthly ? (
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
                At {withdrawalRatePct}% withdrawal rate, this sustains {formatCurrency(result.annualSpending)}/yr.
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
                  You'll reach FIRE at age {result.fireAge}. Keep saving {formatCurrency(result.annualSavings)}/yr and investing at {annualReturnPct}% return.
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

  const [lumpSum, setLumpSum] = useState(100000);
  const [annualIncome, setAnnualIncome] = useState(selfAnnualSalary ?? 120000);
  const [spouseIncome, setSpouseIncome] = useState(partnerAnnualSalary ?? 60000);
  const [ccUsedThisYear, setCcUsedThisYear] = useState(0);
  const [carryForwardAmount, setCarryForwardAmount] = useState(0);
  const [mortgageBalance, setMortgageBalance] = useState(0);
  const [mortgageRate, setMortgageRate] = useState(6.2);
  const [horizonYears, setHorizonYears] = useState(10);
  const [superReturnPct, setSuperReturnPct] = useState(7);
  const [investReturnPct, setInvestReturnPct] = useState(8);

  const result = useMemo(() => {
    const fyLabel = taxYearLabel ?? "2026-27";
    const caps = getSuperCaps(fyLabel);
    const taxYear = getTaxYearRates(fyLabel);
    const marginalRate = getMarginalRate(annualIncome, taxYear);
    const spouseMarginalRate = getMarginalRate(spouseIncome, taxYear);

    const currentSuper = holdings.reduce((sum, h) => {
      const s = getHoldingSummary(h.id);
      return sum + (s?.marketValue ?? 0);
    }, 0);

    // Carry-forward: only if super < $500K
    const carryForwardEligible = currentSuper < 500000;
    const storeCarryForward = storeUnusedCCCaps?.reduce((sum, u) => sum + u, 0) ?? 0;
    const effectiveCarryForward = carryForwardEligible
      ? (carryForwardAmount > 0 ? carryForwardAmount : storeCarryForward)
      : 0;
    const ccAvailable = Math.max(0, caps.concessionalCap - ccUsedThisYear + effectiveCarryForward);

    // NCC bring-forward
    const bf = calculateBringForward(currentSuper, caps);
    const nccAvailable = bf.maxFirstYear;

    // Recommended allocation
    const ccAmount = Math.min(lumpSum, ccAvailable);
    const rem1 = lumpSum - ccAmount;
    const nccAmount = Math.min(rem1, nccAvailable);
    const rem2 = rem1 - nccAmount;
    const mortgageAmount = Math.min(rem2, mortgageBalance);
    const investAmount = rem2 - mortgageAmount;

    const ccTaxSaved = ccAmount * marginalRate;
    const ccSuperTax = ccAmount * 0.15;
    const ccNetBenefit = ccTaxSaved - ccSuperTax;

    const superEff = superReturnPct / 100 * 0.85;
    const investEff = investReturnPct / 100 * (1 - marginalRate * 0.5);
    const spouseInvestEff = investReturnPct / 100 * (1 - spouseMarginalRate * 0.5);

    // Projected values at horizon
    const projCC = ccAmount > 0 ? ccAmount * 0.85 * Math.pow(1 + superEff, horizonYears) : 0;
    const projNCC = nccAmount * Math.pow(1 + superEff, horizonYears);
    const projInvest = investAmount * Math.pow(1 + investEff, horizonYears);
    const projMortgage = mortgageAmount * (Math.pow(1 + mortgageRate / 100, horizonYears) - 1);

    // All-in-one comparison
    const allCC = Math.min(lumpSum, ccAvailable);
    const allCCVal = allCC > 0 ? allCC * 0.85 * Math.pow(1 + superEff, horizonYears) : 0;
    const allCCBenefit = allCC * (marginalRate - 0.15);

    const allNCC = Math.min(lumpSum, nccAvailable);
    const allNCCVal = allNCC * Math.pow(1 + superEff, horizonYears);

    const allInvestVal = lumpSum * Math.pow(1 + investEff, horizonYears);

    // Gift to spouse: invest in her name at her lower tax rate
    const allSpouseVal = lumpSum * Math.pow(1 + spouseInvestEff, horizonYears);

    const allMort = Math.min(lumpSum, mortgageBalance);
    const allMortVal = allMort * (Math.pow(1 + mortgageRate / 100, horizonYears) - 1);

    // Year-by-year projection for recommended split
    const projection: { year: number; super: number; invest: number; mortgageSaved: number; total: number }[] = [];
    let cumSuper = 0;
    let cumInvest = 0;
    let cumMortgage = 0;
    for (let y = 0; y <= horizonYears; y++) {
      if (y > 0) {
        cumSuper = (cumSuper + (y === 1 ? ccAmount * 0.85 + nccAmount : 0)) * (1 + superEff);
        cumInvest = (cumInvest + (y === 1 ? investAmount : 0)) * (1 + investEff);
        cumMortgage = cumMortgage * (1 + mortgageRate / 100) + (y === 1 ? mortgageAmount : 0) * (mortgageRate / 100);
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
  }, [lumpSum, annualIncome, spouseIncome, ccUsedThisYear, carryForwardAmount, mortgageBalance, mortgageRate,
      horizonYears, superReturnPct, investReturnPct, taxYearLabel,
      holdings, getHoldingSummary, storeUnusedCCCaps]);

  return (
    <div className="space-y-4">
      {/* Inputs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="space-y-3">
          <SectionHeader title="Your Lump Sum" />
          <Input label="Lump Sum Amount" type="number" value={lumpSum}
            onChange={v => setLumpSum(parseFloat(v) || 0)} prefix="$" />
          <Input label="Your Annual Income" type="number" value={annualIncome}
            onChange={v => setAnnualIncome(parseFloat(v) || 0)} prefix="$" />
          <Input label="Spouse Annual Income" type="number" value={spouseIncome}
            onChange={v => setSpouseIncome(parseFloat(v) || 0)} prefix="$" sublabel="for gift-to-spouse option" />
          <Input label="CC Used This Year" type="number" value={ccUsedThisYear}
            onChange={v => setCcUsedThisYear(parseFloat(v) || 0)} prefix="$" sublabel="salary sacrifice + employer SG already counted" />
          <Input label="Carry-Forward Available" type="number" value={carryForwardAmount}
            onChange={v => setCarryForwardAmount(parseFloat(v) || 0)} prefix="$"
            sublabel={result.carryForwardEligible
              ? `Super < $500K ✓ — unused CC from last 5 yrs`
              : `Super ≥ $500K — not eligible`} />
        </Card>

        <Card className="space-y-3">
          <SectionHeader title="Debts & Horizon" />
          <Input label="Mortgage Balance" type="number" value={mortgageBalance}
            onChange={v => setMortgageBalance(parseFloat(v) || 0)} prefix="$" />
          <Input label="Mortgage Rate %" type="number" value={mortgageRate}
            onChange={v => setMortgageRate(parseFloat(v) || 0)} prefix="%" />
          <Input label="Projection Horizon (yrs)" type="number" value={horizonYears}
            onChange={v => setHorizonYears(parseInt(v) || 10)} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Super Return %" type="number" value={superReturnPct}
              onChange={v => setSuperReturnPct(parseFloat(v) || 7)} prefix="%" />
            <Input label="Invest Return %" type="number" value={investReturnPct}
              onChange={v => setInvestReturnPct(parseFloat(v) || 8)} prefix="%" />
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
            <p className="text-[10px] text-muted-foreground mt-1">Guaranteed {mortgageRate}% return</p>
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
        <SectionHeader title={`What If You Put All ${formatCurrency(lumpSum)} Into…`} />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Option</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Amount</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Tax Benefit</th>
                <th className="text-right py-2 px-2 text-muted-foreground font-medium">Value at {horizonYears}yr</th>
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
                <td className="py-2 px-2 text-right">{formatCurrency(lumpSum)}</td>
                <td className="py-2 px-2 text-right text-muted-foreground">—</td>
                <td className="py-2 px-2 text-right">{formatCurrency(result.allInvestVal)}</td>
                <td className="py-2 px-2 text-right font-medium">{formatCurrency(result.allInvestVal - lumpSum)}</td>
              </tr>
              <tr className={cn("border-b border-border/50",
                result.spouseMarginalRate < result.marginalRate && "bg-success/5")}>
                <td className="py-2 px-2 font-medium">
                  Gift to Spouse
                  {result.spouseMarginalRate < result.marginalRate && <span className="ml-1 text-success text-[10px]">(lower tax)</span>}
                </td>
                <td className="py-2 px-2 text-right">{formatCurrency(lumpSum)}</td>
                <td className="py-2 px-2 text-right text-muted-foreground">—</td>
                <td className="py-2 px-2 text-right">{formatCurrency(result.allSpouseVal)}</td>
                <td className={cn("py-2 px-2 text-right font-medium",
                  result.allSpouseVal > result.allInvestVal ? "text-success" : "")}>
                  {formatCurrency(result.allSpouseVal - lumpSum)}
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
              ? `Your super balance is under $500K — you can use unused CC cap from the last 5 years. Current available: ${formatCurrency(result.ccAvailable)} (includes ${formatCurrency(result.ccAvailable - result.currentYearCap + ccUsedThisYear)} carry-forward).`
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
    </div>
  );
}
