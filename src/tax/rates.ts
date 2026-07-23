export interface TaxBracket {
  min: number;
  max: number;
  rate: number;
}

export interface TaxYearRates {
  /** Financial year label, e.g. "2026-27" */
  label: string;
  /** Start date of the financial year */
  startDate: string;
  brackets: TaxBracket[];
  /** Medicare levy rate (typically 0.02) */
  medicareLevyRate: number;
  /** Low Income Tax Offset maximum */
  litoMax: number;
  litoPhaseOutStart: number;
  litoPhaseOutEnd: number;
  litoPhaseOutRate: number;
  /** Working Australians Tax Offset (from 2027-28) */
  watoMax?: number;
}

export const TAX_YEARS: Record<string, TaxYearRates> = {
  "2024-25": {
    label: "2024-25",
    startDate: "2024-07-01",
    brackets: [
      { min: 0, max: 18200, rate: 0 },
      { min: 18201, max: 45000, rate: 0.16 },
      { min: 45001, max: 135000, rate: 0.30 },
      { min: 135001, max: 190000, rate: 0.37 },
      { min: 190001, max: Infinity, rate: 0.45 },
    ],
    medicareLevyRate: 0.02,
    litoMax: 700,
    litoPhaseOutStart: 37500,
    litoPhaseOutEnd: 66667,
    litoPhaseOutRate: 0.015,
  },
  "2025-26": {
    label: "2025-26",
    startDate: "2025-07-01",
    brackets: [
      { min: 0, max: 18200, rate: 0 },
      { min: 18201, max: 45000, rate: 0.16 },
      { min: 45001, max: 135000, rate: 0.30 },
      { min: 135001, max: 190000, rate: 0.37 },
      { min: 190001, max: Infinity, rate: 0.45 },
    ],
    medicareLevyRate: 0.02,
    litoMax: 700,
    litoPhaseOutStart: 37500,
    litoPhaseOutEnd: 66667,
    litoPhaseOutRate: 0.015,
  },
  "2026-27": {
    label: "2026-27",
    startDate: "2026-07-01",
    brackets: [
      { min: 0, max: 18200, rate: 0 },
      { min: 18201, max: 45000, rate: 0.15 },
      { min: 45001, max: 135000, rate: 0.30 },
      { min: 135001, max: 190000, rate: 0.37 },
      { min: 190001, max: Infinity, rate: 0.45 },
    ],
    medicareLevyRate: 0.02,
    litoMax: 700,
    litoPhaseOutStart: 37500,
    litoPhaseOutEnd: 66667,
    litoPhaseOutRate: 0.015,
  },
  "2027-28": {
    label: "2027-28",
    startDate: "2027-07-01",
    brackets: [
      { min: 0, max: 18200, rate: 0 },
      { min: 18201, max: 45000, rate: 0.14 },
      { min: 45001, max: 135000, rate: 0.30 },
      { min: 135001, max: 190000, rate: 0.37 },
      { min: 190001, max: Infinity, rate: 0.45 },
    ],
    medicareLevyRate: 0.02,
    litoMax: 700,
    litoPhaseOutStart: 37500,
    litoPhaseOutEnd: 66667,
    litoPhaseOutRate: 0.015,
    watoMax: 250,
  },
};

/** Get the tax year rates applicable for a given date (YYYY-MM-DD). */
export function getTaxYearRates(dateStr: string): TaxYearRates {
  const d = new Date(dateStr + "T00:00:00");
  // Walk backwards through tax years to find the applicable one
  const sorted = Object.values(TAX_YEARS).sort((a, b) => b.startDate.localeCompare(a.startDate));
  for (const yr of sorted) {
    if (d >= new Date(yr.startDate + "T00:00:00")) return yr;
  }
  // Default to the earliest available
  return sorted[sorted.length - 1];
}

/** Calculate income tax payable (before Medicare levy, before offsets). */
export function calculateIncomeTax(taxableIncome: number, rates: TaxYearRates): number {
  if (taxableIncome <= 0) return 0;
  let tax = 0;
  for (const bracket of rates.brackets) {
    if (taxableIncome <= bracket.min) break;
    const taxableInBracket = Math.min(taxableIncome, bracket.max) - bracket.min + (bracket.min > 0 ? 1 : 0);
    if (taxableInBracket > 0) {
      tax += taxableInBracket * bracket.rate;
    }
  }
  return Math.max(0, tax);
}

/** Calculate LITO (Low Income Tax Offset). */
export function calculateLITO(taxableIncome: number, rates: TaxYearRates): number {
  if (taxableIncome <= rates.litoPhaseOutStart) return rates.litoMax;
  if (taxableIncome >= rates.litoPhaseOutEnd) return 0;
  const reduction = (taxableIncome - rates.litoPhaseOutStart) * rates.litoPhaseOutRate;
  return Math.max(0, rates.litoMax - reduction);
}

/** Get the marginal tax rate for a given taxable income. */
export function getMarginalRate(taxableIncome: number, rates: TaxYearRates): number {
  for (const bracket of rates.brackets) {
    if (taxableIncome >= bracket.min && taxableIncome <= bracket.max) return bracket.rate;
  }
  return rates.brackets[rates.brackets.length - 1]?.rate ?? 0;
}

/** Full income tax calculation including Medicare and LITO. */
export function calculateTotalIncomeTax(
  taxableIncome: number,
  rates: TaxYearRates,
  opts?: { medicareExempt?: boolean; watoEligible?: boolean },
): {
  incomeTax: number;
  lito: number;
  medicareLevy: number;
  wato: number;
  totalTax: number;
  effectiveRate: number;
  marginalRate: number;
  takeHome: number;
} {
  const incomeTax = calculateIncomeTax(taxableIncome, rates);
  const lito = calculateLITO(taxableIncome, rates);
  const medicareLevy = opts?.medicareExempt ? 0 : taxableIncome * rates.medicareLevyRate;
  const wato = (opts?.watoEligible !== false && rates.watoMax && taxableIncome > 0) ? rates.watoMax : 0;
  const totalTax = Math.max(0, incomeTax - lito + medicareLevy - wato);
  const effectiveRate = taxableIncome > 0 ? totalTax / taxableIncome : 0;
  const marginalRate = getMarginalRate(taxableIncome, rates);
  const takeHome = taxableIncome - totalTax;

  return { incomeTax, lito, medicareLevy, wato, totalTax, effectiveRate, marginalRate, takeHome };
}
