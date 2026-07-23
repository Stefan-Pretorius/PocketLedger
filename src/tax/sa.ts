/**
 * South Australia Stamp Duty Calculator.
 * Based on RevenueSA rates effective from 1 July 2024.
 * https://www.revenuesa.sa.gov.au/online-services/stamp-duty-calculator
 */

export interface StampDutyResult {
  /** Base stamp duty payable */
  duty: number;
  /** First Home Buyer Concession (if applicable) */
  fhbConcession: number;
  /** Net stamp duty after concessions */
  netDuty: number;
  /** Total upfront costs (duty + legal fees estimate) */
  totalUpfront: number;
}

/**
 * Calculate SA stamp duty for a property purchase.
 * @param purchasePrice - Property purchase price in AUD
 * @param isPrincipalPlace - Whether it will be the principal place of residence
 * @param isFirstHomeBuyer - First Home Buyer concession eligibility
 * @param isVacantLand - Whether purchasing vacant land (different thresholds)
 */
export function calculateSaStampDuty(
  purchasePrice: number,
  opts?: { isPrincipalPlace?: boolean; isFirstHomeBuyer?: boolean; isVacantLand?: boolean },
): StampDutyResult {
  const isFHB = opts?.isFirstHomeBuyer ?? false;
  const isPPR = opts?.isPrincipalPlace ?? false;
  const isVacant = opts?.isVacantLand ?? false;

  // SA Stamp Duty rates (2024-25, indexed annually)
  // Based on the sliding scale
  let duty = 0;

  if (purchasePrice <= 12000) {
    duty = purchasePrice * 0.01;
  } else if (purchasePrice <= 30000) {
    duty = 120 + (purchasePrice - 12000) * 0.02;
  } else if (purchasePrice <= 50000) {
    duty = 480 + (purchasePrice - 30000) * 0.03;
  } else if (purchasePrice <= 100000) {
    duty = 1080 + (purchasePrice - 50000) * 0.035;
  } else if (purchasePrice <= 200000) {
    duty = 2830 + (purchasePrice - 100000) * 0.04;
  } else if (purchasePrice <= 250000) {
    duty = 6830 + (purchasePrice - 200000) * 0.0425;
  } else if (purchasePrice <= 300000) {
    duty = 8955 + (purchasePrice - 250000) * 0.0475;
  } else if (purchasePrice <= 500000) {
    duty = 11330 + (purchasePrice - 300000) * 0.05;
  } else {
    duty = 21330 + (purchasePrice - 500000) * 0.055;
  }

  let fhbConcession = 0;

  if (isFHB && isPPR) {
    // First Home Buyer Concession in SA
    // Full exemption for properties up to $650,000 (principal place of residence)
    // Concessional rate for properties $650,001 - $700,000
    if (isVacant) {
      // Vacant land concession: full exemption up to $400,000, concessional to $450,000
      if (purchasePrice <= 400000) {
        fhbConcession = duty;
      } else if (purchasePrice <= 450000) {
        fhbConcession = duty * (1 - (purchasePrice - 400000) / 50000);
      }
    } else {
      if (purchasePrice <= 650000) {
        fhbConcession = duty;
      } else if (purchasePrice <= 700000) {
        fhbConcession = duty * (1 - (purchasePrice - 650000) / 50000);
      }
    }
  }

  const netDuty = Math.max(0, duty - fhbConcession);
  const legalFeesEstimate = 1500; // Rough estimate for conveyancing
  const totalUpfront = netDuty + legalFeesEstimate;

  return { duty, fhbConcession, netDuty, totalUpfront };
}

/**
 * Calculate annual land tax for investment property in SA.
 * Based on Individual land tax rates (2024-25).
 */
export function calculateSaLandTax(
  landValue: number,
  opts?: { isPrincipalPlace?: boolean; totalLandHoldings?: number },
): number {
  if (opts?.isPrincipalPlace) return 0;

  const holdings = opts?.totalLandHoldings ?? landValue;

  if (holdings <= 450000) return 0;
  if (holdings <= 1048000) return (holdings - 450000) * 0.005;
  return 2990 + (holdings - 1048000) * 0.025;
}
