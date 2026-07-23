export interface SuperCaps {
  /** Financial year label, e.g. "2026-27" */
  label: string;
  /** Concessional (before-tax) contributions cap */
  concessionalCap: number;
  /** Non-concessional (after-tax) contributions cap */
  nonConcessionalCap: number;
  /** General transfer balance cap */
  transferBalanceCap: number;
  /** CGT cap amount */
  cgtCapAmount: number;
  /** Maximum SG contribution base (annual equivalent) */
  maxSgBase: number;
  /** SG rate (e.g. 0.12 for 12%) */
  sgRate: number;
  /** Carry-forward: TSB threshold below which unused CC can be used */
  carryForwardTsbThreshold: number;
  /** Carry-forward: number of years of unused cap available */
  carryForwardYears: number;
  /** Bring-forward: TSB thresholds for 3-year, 2-year, and 1-year periods */
  bringForward: {
    threeYearTsbThreshold: number;
    twoYearTsbThreshold: number;
    maxContribution: number;
  };
}

export const SUPER_CAPS: Record<string, SuperCaps> = {
  "2024-25": {
    label: "2024-25",
    concessionalCap: 30000,
    nonConcessionalCap: 120000,
    transferBalanceCap: 1900000,
    cgtCapAmount: 1780000,
    maxSgBase: 250000,
    sgRate: 0.115,
    carryForwardTsbThreshold: 500000,
    carryForwardYears: 5,
    bringForward: {
      threeYearTsbThreshold: 1660000,
      twoYearTsbThreshold: 1780000,
      maxContribution: 360000,
    },
  },
  "2025-26": {
    label: "2025-26",
    concessionalCap: 30000,
    nonConcessionalCap: 120000,
    transferBalanceCap: 2000000,
    cgtCapAmount: 1865000,
    maxSgBase: 250000,
    sgRate: 0.12,
    carryForwardTsbThreshold: 500000,
    carryForwardYears: 5,
    bringForward: {
      threeYearTsbThreshold: 1760000,
      twoYearTsbThreshold: 1880000,
      maxContribution: 360000,
    },
  },
  "2026-27": {
    label: "2026-27",
    concessionalCap: 32500,
    nonConcessionalCap: 130000,
    transferBalanceCap: 2100000,
    cgtCapAmount: 1935000,
    maxSgBase: 270830,
    sgRate: 0.12,
    carryForwardTsbThreshold: 500000,
    carryForwardYears: 5,
    bringForward: {
      threeYearTsbThreshold: 1840000,
      twoYearTsbThreshold: 1970000,
      maxContribution: 390000,
    },
  },
};

/** Division 296 thresholds (from 1 July 2026). */
export interface Division296Thresholds {
  /** Balance threshold above which extra tax applies */
  lowerThreshold: number;
  /** Additional rate for balances between lower and upper */
  lowerRate: number;
  /** Upper threshold */
  upperThreshold: number;
  /** Additional rate for balances above upper */
  upperRate: number;
}

export const DIVISION_296: Division296Thresholds = {
  lowerThreshold: 3000000,
  lowerRate: 0.15,
  upperThreshold: 10000000,
  upperRate: 0.25,
};

/** Division 293 threshold — extra 15% on CC when income + CC > $250,000. */
export const DIVISION_293_THRESHOLD = 250000;
export const DIVISION_293_RATE = 0.15;

/** Get the super caps applicable for a financial year label. */
export function getSuperCaps(fyLabel: string): SuperCaps {
  return SUPER_CAPS[fyLabel] ?? SUPER_CAPS["2026-27"];
}

/** Calculate carry-forward concessional contribution available. */
export function calculateCarryForward(
  totalSuperBalance: number,
  unusedConcessionalCaps: number[], // Array of unused amounts from prior years (up to 5)
  currentYearCap: number,
): number {
  if (totalSuperBalance >= 500000) return currentYearCap;

  // Only unused caps from the last 5 years are available
  const available = unusedConcessionalCaps.slice(-5);
  const totalUnused = available.reduce((sum, u) => sum + u, 0);
  return currentYearCap + totalUnused;
}

/** Calculate bring-forward non-concessional contribution available. */
export function calculateBringForward(
  totalSuperBalance: number,
  caps: SuperCaps,
): { maxFirstYear: number; bringForwardPeriod: number } {
  const bf = caps.bringForward;

  if (totalSuperBalance >= bf.threeYearTsbThreshold && totalSuperBalance < bf.twoYearTsbThreshold) {
    return { maxFirstYear: caps.nonConcessionalCap * 2, bringForwardPeriod: 2 };
  }
  if (totalSuperBalance < bf.threeYearTsbThreshold) {
    return { maxFirstYear: caps.nonConcessionalCap * 3, bringForwardPeriod: 3 };
  }
  // Below 1-year threshold (>= twoYearTsbThreshold but < transferBalanceCap)
  if (totalSuperBalance < caps.transferBalanceCap) {
    return { maxFirstYear: caps.nonConcessionalCap, bringForwardPeriod: 1 };
  }
  // Above transfer balance cap — cannot make NCC
  return { maxFirstYear: 0, bringForwardPeriod: 0 };
}

/** Calculate Division 293 tax on concessional contributions. */
export function calculateDiv293(
  incomePlusCC: number,
  concessionalContributions: number,
): number {
  if (incomePlusCC <= DIVISION_293_THRESHOLD) return 0;
  // Only the CC portion that pushes above the threshold is taxed
  const excess = incomePlusCC - DIVISION_293_THRESHOLD;
  const taxableCC = Math.min(excess, concessionalContributions);
  return taxableCC * DIVISION_293_RATE;
}

/** Calculate Division 296 additional tax on large super balances. */
export function calculateDiv296(
  totalSuperBalance: number,
  earnings: number, // Realised + unrealised gains + income
  thresholds: Division296Thresholds = DIVISION_296,
): number {
  if (totalSuperBalance <= thresholds.lowerThreshold) return 0;

  if (totalSuperBalance <= thresholds.upperThreshold) {
    const proportionAboveLower = (totalSuperBalance - thresholds.lowerThreshold) / totalSuperBalance;
    return earnings * proportionAboveLower * thresholds.lowerRate;
  }

  // Above upper threshold
  const proportionBetween = (thresholds.upperThreshold - thresholds.lowerThreshold) / totalSuperBalance;
  const proportionAboveUpper = (totalSuperBalance - thresholds.upperThreshold) / totalSuperBalance;
  const tax = earnings * proportionBetween * thresholds.lowerRate
    + earnings * proportionAboveUpper * thresholds.upperRate;
  return tax;
}

/** Calculate the tax benefit of salary sacrifice (marginal rate saving minus 15% super tax). */
export function calculateSalarySacrificeBenefit(
  grossAmount: number,
  marginalRate: number,
  opts?: { hasDiv293?: boolean },
): { superTax: number; marginalSaving: number; netBenefit: number; effectiveCost: number } {
  const superTax = grossAmount * 0.15;
  const marginalSaving = grossAmount * marginalRate;
  const div293 = opts?.hasDiv293 ? grossAmount * DIVISION_293_RATE : 0;
  const netBenefit = marginalSaving - superTax - div293;
  const effectiveCost = grossAmount - netBenefit;

  return { superTax, marginalSaving, netBenefit, effectiveCost };
}

/** Model a full super contribution strategy comparison. */
export function modelSuperStrategy(opts: {
  annualSalary: number;
  existingSalarySacrifice: number;
  currentSuperBalance: number;
  partnerSalary?: number;
  partnerSuperBalance?: number;
  marginalRate: number;
  partnerMarginalRate?: number;
  unusedConcessionalCaps?: number[];
  yearsToProject: number;
  annualReturnPct: number;
  fyLabel?: string;
}): {
  currentPath: { totalSuper: number[]; totalTax: number; totalContributions: number };
  optimisedPath: { totalSuper: number[]; totalTax: number; totalContributions: number; additionalSS: number; carryForwardUsed: number };
  taxSavedPerYear: number;
  carryForwardAvailable: number;
  bringForwardAvailable: number;
} {
  const caps = getSuperCaps(opts.fyLabel ?? "2026-27");
  const selfSG = Math.min(opts.annualSalary * caps.sgRate, caps.maxSgBase * caps.sgRate);

  // Current path
  const currentCC = selfSG + opts.existingSalarySacrifice;
  const currentSuperPath: number[] = [];
  let currentSuper = opts.currentSuperBalance;
  let currentTotalTax = 0;
  let currentTotalContributions = 0;
  const monthlyReturn = Math.pow(1 + opts.annualReturnPct / 100, 1 / 12) - 1;

  for (let m = 0; m < opts.yearsToProject * 12; m++) {
    if (m > 0 && m % 12 === 0) currentSuperPath.push(currentSuper);
    const monthlyCC = currentCC / 12;
    currentSuper = currentSuper * (1 + monthlyReturn) + monthlyCC * 0.85; // 15% tax
    if (m % 12 === 11) {
      currentTotalContributions += currentCC;
      currentTotalTax += currentCC * 0.15;
    }
  }
  currentSuperPath.push(currentSuper);

  // Optimised path — maximise salary sacrifice up to cap
  const carryForwardAvailable = calculateCarryForward(
    opts.currentSuperBalance,
    opts.unusedConcessionalCaps ?? [],
    caps.concessionalCap,
  );
  const maxSS = Math.max(0, caps.concessionalCap - selfSG);
  const additionalSS = Math.max(0, maxSS - opts.existingSalarySacrifice);
  const optimisedCC = selfSG + maxSS;
  const carryForwardUsed = carryForwardAvailable - caps.concessionalCap;

  const optimisedSuperPath: number[] = [];
  let optimisedSuper = opts.currentSuperBalance;
  let optimisedTotalTax = 0;
  let optimisedTotalContributions = 0;

  for (let m = 0; m < opts.yearsToProject * 12; m++) {
    if (m > 0 && m % 12 === 0) optimisedSuperPath.push(optimisedSuper);
    const monthlyCC = optimisedCC / 12;
    optimisedSuper = optimisedSuper * (1 + monthlyReturn) + monthlyCC * 0.85;
    if (m % 12 === 11) {
      optimisedTotalContributions += optimisedCC;
      optimisedTotalTax += optimisedCC * 0.15;
    }
  }
  optimisedSuperPath.push(optimisedSuper);

  const taxSavedPerYear = additionalSS * (opts.marginalRate - 0.15);

  const bfAvailable = calculateBringForward(opts.currentSuperBalance, caps);

  return {
    currentPath: { totalSuper: currentSuperPath, totalTax: currentTotalTax, totalContributions: currentTotalContributions },
    optimisedPath: { totalSuper: optimisedSuperPath, totalTax: optimisedTotalTax, totalContributions: optimisedTotalContributions, additionalSS, carryForwardUsed },
    taxSavedPerYear,
    carryForwardAvailable,
    bringForwardAvailable: bfAvailable.maxFirstYear,
  };
}
