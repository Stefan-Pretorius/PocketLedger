import { calculateIncomeTax, calculateLITO, getTaxYearRates } from "./rates";
import type { TaxYearRates } from "./rates";
import { calculateMedicareLevy, MEDICARE_THRESHOLDS_2026_27 } from "./medicare";

function roundDollar(n: number): number {
  return Math.round(n);
}

export interface PaygWithholding {
  weekly: number;
  fortnightly: number;
  monthly: number;
  annual: number;
}

export interface PaygPeriodBreakdown {
  /** Annual gross salary (input) */
  annualGross: number;
  /** Taxable income after salary sacrifice */
  taxableIncome: number;
  /** Super guarantee paid on top (12% of salary, capped) — informational */
  superGuarantee: number;
  withholding: PaygWithholding;
  weeklyGross: number;
  weeklyNet: number;
  fortnightlyGross: number;
  fortnightlyNet: number;
  monthlyGross: number;
  monthlyNet: number;
  annualNet: number;
}

/**
 * ATO-style PAYG withholding for an annualised salary.
 *
 * Approximates the ATO "statement of formulas" Method A: compute the annual
 * withholding (income tax + Medicare levy − LITO − WATO) then divide by the
 * number of pay periods and round to the nearest dollar. Actual employer
 * withholding follows the ATO tax tables, so figures may differ slightly
 * (always in the ATO's favour; corrected at tax-return time).
 */
export function calculatePaygWithholding(
  annualTaxableIncome: number,
  rates: TaxYearRates,
  opts?: { medicareExempt?: boolean; watoEligible?: boolean; isFamily?: boolean },
): PaygWithholding {
  if (annualTaxableIncome <= 0) return { weekly: 0, fortnightly: 0, monthly: 0, annual: 0 };

  const incomeTax = calculateIncomeTax(annualTaxableIncome, rates);
  const medicare = opts?.medicareExempt
    ? 0
    : calculateMedicareLevy(
        annualTaxableIncome,
        rates.medicareLevyRate,
        MEDICARE_THRESHOLDS_2026_27,
        { isFamily: opts?.isFamily },
      );
  const lito = calculateLITO(annualTaxableIncome, rates);
  const wato = opts?.watoEligible !== false && rates.watoMax && annualTaxableIncome > 0 ? rates.watoMax : 0;

  const annual = Math.max(0, incomeTax + medicare - lito - wato);

  return {
    weekly: roundDollar(annual / 52),
    fortnightly: roundDollar(annual / 26),
    monthly: roundDollar(annual / 12),
    annual,
  };
}

/**
 * Full per-period take-home breakdown for a salaried employee.
 * `salarySacrifice` reduces taxable income for withholding purposes.
 */
export function calculatePayg(
  annualSalary: number,
  rates: TaxYearRates,
  opts?: {
    salarySacrifice?: number;
    medicareExempt?: boolean;
    watoEligible?: boolean;
    isFamily?: boolean;
    /** Employer SG rate (default 12%) */
    sgRate?: number;
    /** Max salary base for SG purposes */
    maxSgBase?: number;
  },
): PaygPeriodBreakdown {
  const taxableIncome = Math.max(0, annualSalary - (opts?.salarySacrifice ?? 0));
  const sgRate = opts?.sgRate ?? 0.12;
  const maxSgBase = opts?.maxSgBase ?? Infinity;
  const superGuarantee = Math.min(annualSalary, maxSgBase) * sgRate;

  const withholding = calculatePaygWithholding(taxableIncome, rates, {
    medicareExempt: opts?.medicareExempt,
    watoEligible: opts?.watoEligible,
    isFamily: opts?.isFamily,
  });

  const weeklyGross = roundDollar(annualSalary / 52);
  const fortnightlyGross = roundDollar(annualSalary / 26);
  const monthlyGross = roundDollar(annualSalary / 12);

  return {
    annualGross: annualSalary,
    taxableIncome,
    superGuarantee,
    withholding,
    weeklyGross,
    weeklyNet: weeklyGross - withholding.weekly,
    fortnightlyGross,
    fortnightlyNet: fortnightlyGross - withholding.fortnightly,
    monthlyGross,
    monthlyNet: monthlyGross - withholding.monthly,
    annualNet: annualSalary - withholding.annual,
  };
}

/** Convenience: rates from a FY label string. */
export function calculatePaygForLabel(
  annualSalary: number,
  fyLabel: string,
  opts?: Parameters<typeof calculatePayg>[2],
): PaygPeriodBreakdown {
  return calculatePayg(annualSalary, getTaxYearRates(fyLabel), opts);
}
