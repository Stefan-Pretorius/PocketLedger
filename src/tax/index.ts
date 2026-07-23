export { TAX_YEARS, getTaxYearRates, calculateIncomeTax, calculateLITO, getMarginalRate, calculateTotalIncomeTax } from "./rates";
export type { TaxBracket, TaxYearRates } from "./rates";

export { MEDICARE_THRESHOLDS_2026_27, calculateMedicareLevy, calculateMLS } from "./medicare";
export type { MedicareThresholds } from "./medicare";

export {
  SUPER_CAPS, DIVISION_296, DIVISION_293_THRESHOLD, DIVISION_293_RATE,
  getSuperCaps, calculateCarryForward, calculateBringForward,
  calculateDiv293, calculateDiv296, calculateSalarySacrificeBenefit, modelSuperStrategy,
} from "./super";
export type { SuperCaps, Division296Thresholds } from "./super";

export {
  CGT_REFORM_DATE, calculateCgtEvent, calculateCgtSummary, isCgtReformActive,
} from "./cgt";
export type { CgtEvent, CgtSummary } from "./cgt";

export { calculateSaStampDuty, calculateSaLandTax } from "./sa";
export type { StampDutyResult } from "./sa";
