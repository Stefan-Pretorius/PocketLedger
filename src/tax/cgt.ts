import type { HoldingTransaction } from "../types";

/** The date from which the new CGT rules apply (gains accruing after this date). */
export const CGT_REFORM_DATE = "2027-07-01";

/** CPI indexation factor — simplified annual CPI assumption for cost base indexing. */
const DEFAULT_ANNUAL_CPI = 0.03;

export interface CgtEvent {
  /** The sell transaction */
  transaction: HoldingTransaction;
  /** Total gain/loss before any discount or indexation */
  grossGain: number;
  /** Cost basis of the sold units */
  costBasis: number;
  /** Number of units sold */
  unitsSold: number;
  /** Holding period in days */
  holdingDays: number;
  /** Whether the asset was held for more than 12 months */
  longTerm: boolean;

  /** Pre-reform portion (gains accrued before 1 July 2027) */
  preReformGain: number;
  /** Post-reform portion (gains accrued after 1 July 2027) */
  postReformGain: number;

  /** 50% discount applied to pre-reform long-term gains */
  discountAmount: number;
  /** CPI-indexed cost base for post-reform gains */
  indexedCostBasis: number;
  /** 30% minimum tax on post-reform gain */
  minTax30: number;

  /** Final net capital gain after all discounts and indexation */
  netCapitalGain: number;
  /** Effective tax rate on this gain */
  effectiveTaxRate: number;
}

export interface CgtSummary {
  events: CgtEvent[];
  totalGrossGain: number;
  totalNetCapitalGain: number;
  totalDiscount: number;
  totalIndexationBenefit: number;
  totalMinTax: number;
  /** Breakdown for display */
  preReformTotal: number;
  postReformTotal: number;
}

/**
 * Calculate CPI indexation factor from acquisition date to the reform date.
 * Uses simplified annual CPI assumption.
 */
function calculateCpiIndexation(acquisitionDate: string, cpiRate: number = DEFAULT_ANNUAL_CPI): number {
  const acq = new Date(acquisitionDate + "T00:00:00");
  const reform = new Date(CGT_REFORM_DATE + "T00:00:00");
  const years = (reform.getTime() - acq.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  if (years <= 0) return 1;
  return Math.pow(1 + cpiRate, years);
}

/**
 * Calculate CGT for a single sell transaction using FIFO cost matching.
 * Handles the pre/post 1 July 2027 split treatment.
 */
export function calculateCgtEvent(
  sell: HoldingTransaction,
  buyQueue: { transaction: HoldingTransaction; remainingUnits: number }[],
  opts?: { cpiRate?: number; marginalRate?: number },
): CgtEvent {
  let remainingToSell = sell.units;
  let totalCostBasis = 0;
  const matchedBuys: { buy: HoldingTransaction; units: number; costPerUnit: number; buyDate: string }[] = [];

  // FIFO matching
  const queue = buyQueue.map(q => ({ ...q }));
  while (remainingToSell > 0 && queue.length > 0) {
    const lot = queue[0];
    const unitsFromLot = Math.min(remainingToSell, lot.remainingUnits);
    const costPerUnit = lot.transaction.pricePerUnit + (lot.transaction.fees + (lot.transaction.brokerage ?? 0) + (lot.transaction.gst ?? 0)) / lot.transaction.units;
    matchedBuys.push({
      buy: lot.transaction,
      units: unitsFromLot,
      costPerUnit,
      buyDate: lot.transaction.date,
    });
    totalCostBasis += unitsFromLot * costPerUnit;
    lot.remainingUnits -= unitsFromLot;
    remainingToSell -= unitsFromLot;
    if (lot.remainingUnits <= 0) queue.shift();
  }

  const proceeds = sell.units * sell.pricePerUnit;
  const grossGain = proceeds - totalCostBasis;
  const holdingDays = matchedBuys.length > 0
    ? Math.round((new Date(sell.date).getTime() - new Date(matchedBuys[0].buyDate).getTime()) / (86400000))
    : 0;
  const longTerm = holdingDays > 365;

  // Split gain into pre-reform and post-reform portions
  const sellDate = new Date(sell.date + "T00:00:00");
  const reformDate = new Date(CGT_REFORM_DATE + "T00:00:00");

  let preReformGain = 0;
  let postReformGain = 0;

  if (sellDate < reformDate) {
    // Asset sold before reform — entire gain uses old rules (50% discount for long-term)
    preReformGain = grossGain;
    postReformGain = 0;
  } else if (matchedBuys.length > 0 && new Date(matchedBuys[0].buyDate) < reformDate) {
    // Split: some gains accrued before reform, some after
    // Proportional split by time
    const totalHoldingPeriod = (sellDate.getTime() - new Date(matchedBuys[0].buyDate).getTime()) / 86400000;
    const preReformPeriod = (reformDate.getTime() - new Date(matchedBuys[0].buyDate).getTime()) / 86400000;
    const postReformPeriod = totalHoldingPeriod - preReformPeriod;

    if (totalHoldingPeriod > 0) {
      preReformGain = grossGain * (preReformPeriod / totalHoldingPeriod);
      postReformGain = grossGain * (postReformPeriod / totalHoldingPeriod);
    } else {
      postReformGain = grossGain;
    }
  } else {
    // All gains accrued after reform
    postReformGain = grossGain;
  }

  // Apply old rules to pre-reform portion
  const discountAmount = longTerm ? preReformGain * 0.5 : 0;

  // Apply new rules to post-reform portion
  // CPI indexation increases cost base (reduces taxable gain)
  let indexedCostBasis = totalCostBasis;
  let minTax30 = 0;

  if (postReformGain > 0) {
    const cpiFactor = calculateCpiIndexation(matchedBuys[0]?.buyDate ?? sell.date, opts?.cpiRate);
    // Indexed cost base is the original cost base × CPI factor, capped at actual proceeds
    indexedCostBasis = Math.min(totalCostBasis * cpiFactor, proceeds);
    const indexedGain = proceeds - indexedCostBasis;
    // Apply proportional split for the post-reform portion
    const effectiveIndexedGain = postReformGain > 0 ? indexedGain * (postReformGain / grossGain) : 0;
    minTax30 = effectiveIndexedGain * 0.30;
  }

  // Net capital gain calculation
  // Pre-reform: grossGain - discount
  // Post-reform: max(indexed gain, 30% minimum tax)
  const netPreReform = preReformGain - discountAmount;
  const netPostReform = postReformGain > 0 ? Math.max(postReformGain * (1 - 0), minTax30) : 0;
  // Actually for post-reform, the gain itself is taxed (no discount), and 30% is the MINIMUM rate
  // The actual rate depends on marginal rate, but 30% is the floor
  // For simplicity: net = preReformGain - discount + postReformGain (taxed at marginal, min 30%)
  const netCapitalGain = netPreReform + (postReformGain > 0 ? postReformGain : 0);

  const effectiveTaxRate = opts?.marginalRate
    ? Math.max(opts.marginalRate, postReformGain > 0 ? 0.30 : 0)
    : 0;

  return {
    transaction: sell,
    grossGain,
    costBasis: totalCostBasis,
    unitsSold: sell.units,
    holdingDays,
    longTerm,
    preReformGain,
    postReformGain,
    discountAmount,
    indexedCostBasis,
    minTax30,
    netCapitalGain,
    effectiveTaxRate,
  };
}

/**
 * Calculate full CGT summary for all sell transactions using FIFO.
 */
export function calculateCgtSummary(
  transactions: HoldingTransaction[],
  opts?: { cpiRate?: number; marginalRate?: number },
): CgtSummary {
  const sortedBuys = transactions.filter(t => t.type === "buy").sort((a, b) => a.date.localeCompare(b.date));
  const sortedSells = transactions.filter(t => t.type === "sell").sort((a, b) => a.date.localeCompare(b.date));

  // Build FIFO queue
  const buyQueue: { transaction: HoldingTransaction; remainingUnits: number }[] =
    sortedBuys.map(t => ({ transaction: t, remainingUnits: t.units }));

  const events: CgtEvent[] = [];

  for (const sell of sortedSells) {
    const event = calculateCgtEvent(sell, buyQueue, opts);
    events.push(event);
  }

  const totalGrossGain = events.reduce((s, e) => s + e.grossGain, 0);
  const totalNetCapitalGain = events.reduce((s, e) => s + e.netCapitalGain, 0);
  const totalDiscount = events.reduce((s, e) => s + e.discountAmount, 0);
  const totalIndexationBenefit = events.reduce((s, e) => s + (e.grossGain * (e.postReformGain > 0 ? 1 : 0) - e.minTax30), 0);
  const totalMinTax = events.reduce((s, e) => s + e.minTax30, 0);
  const preReformTotal = events.reduce((s, e) => s + e.preReformGain, 0);
  const postReformTotal = events.reduce((s, e) => s + e.postReformGain, 0);

  return {
    events,
    totalGrossGain,
    totalNetCapitalGain,
    totalDiscount,
    totalIndexationBenefit,
    totalMinTax,
    preReformTotal,
    postReformTotal,
  };
}

/** Check if the CGT reform applies based on date. */
export function isCgtReformActive(date: string): boolean {
  return date >= CGT_REFORM_DATE;
}
