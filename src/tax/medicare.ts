/** Medicare levy low-income thresholds for Australian residents (2026-27). */
export interface MedicareThresholds {
  /** Single person threshold — no levy below this income */
  singleThreshold: number;
  /** Single person shade-in range upper bound */
  singleShadeInEnd: number;
  /** Family threshold */
  familyThreshold: number;
  /** Family shade-in range upper bound */
  familyShadeInEnd: number;
  /** Medicare Levy Surcharge thresholds (individual, no private hospital cover) */
  mlsThresholds: {
    base: number;
    lower: number;
    upper: number;
  };
}

export const MEDICARE_THRESHOLDS_2026_27: MedicareThresholds = {
  singleThreshold: 28011,
  singleShadeInEnd: 35014,
  familyThreshold: 47238,
  familyShadeInEnd: 58686,
  mlsThresholds: {
    base: 93000,
    lower: 108000,
    upper: 144000,
  },
};

/** Calculate Medicare levy for an Australian resident taxpayer. */
export function calculateMedicareLevy(
  taxableIncome: number,
  levyRate: number,
  thresholds: MedicareThresholds = MEDICARE_THRESHOLDS_2026_27,
  opts?: { isFamily?: boolean },
): number {
  if (taxableIncome <= 0) return 0;

  const threshold = opts?.isFamily ? thresholds.familyThreshold : thresholds.singleThreshold;
  const shadeInEnd = opts?.isFamily ? thresholds.familyShadeInEnd : thresholds.singleShadeInEnd;

  // Below threshold — no levy
  if (taxableIncome <= threshold) return 0;

  // In shade-in range — reduced levy
  if (taxableIncome <= shadeInEnd) {
    const shadeInRange = shadeInEnd - threshold;
    const proportion = (taxableIncome - threshold) / shadeInRange;
    return taxableIncome * levyRate * proportion;
  }

  // Above shade-in range — full levy
  return taxableIncome * levyRate;
}

/** Calculate Medicare Levy Surcharge (for high-income earners without private hospital cover). */
export function calculateMLS(
  taxableIncome: number,
  thresholds: MedicareThresholds = MEDICARE_THRESHOLDS_2026_27,
  opts?: { hasPrivateHospitalCover?: boolean; isFamily?: boolean },
): number {
  if (opts?.hasPrivateHospitalCover) return 0;

  const base = thresholds.mlsThresholds.base;
  const lower = thresholds.mlsThresholds.lower;
  const upper = thresholds.mlsThresholds.upper;

  if (taxableIncome <= base) return 0;

  let rate: number;
  if (taxableIncome <= lower) {
    rate = 0.01;
  } else if (taxableIncome <= upper) {
    rate = 0.0125;
  } else {
    rate = 0.015;
  }

  return taxableIncome * rate;
}
