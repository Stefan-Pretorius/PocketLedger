// Monte Carlo Simulation Engine
// Used by Investments.tsx, Scenarios.tsx, and Financial Planner

export function normalRandom(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export interface McHoldingInput {
  name: string; color: string; startValue: number; monthlyContribution: number; annualReturn: number;
}
export interface McPoint { month: number; p10: number; p50: number; p90: number }
export interface McHoldingLine { name: string; color: string; points: { month: number; value: number }[] }

export function runMonteCarlo(
  holdings: McHoldingInput[],
  totalMonths: number,
  targetValue: number,
  options?: {
    simulations?: number; stdDevPct?: number; withdrawalRatePct?: number; inflationPct?: number;
    oneOffInvestments?: { month: number; amount: number }[];
    retireFromMonth?: number;
  },
): { points: McPoint[]; holdingLines: McHoldingLine[]; medianMonths: number | null } {
  const sims = options?.simulations ?? 500;
  const stdDev = options?.stdDevPct ?? 15;
  const withdrawalRate = options?.withdrawalRatePct;
  const inflation = options?.inflationPct ?? 0;
  const oneOffs = options?.oneOffInvestments ?? [];
  const retireFromMonth = options?.retireFromMonth;
  const totalYears = Math.ceil(totalMonths / 12);
  const nh = holdings.length;

  const effReturns = holdings.map(h => Math.max(h.annualReturn - inflation, 0));

  const aggPaths: number[][] = Array.from({ length: sims }, () => []);
  const hPaths: number[][][] = holdings.map(() => Array.from({ length: sims }, () => [] as number[]));

  for (let sim = 0; sim < sims; sim++) {
    const vals = holdings.map(h => h.startValue);
    const aggVals: number[] = [vals.reduce((a, b) => a + b, 0)];
    const hSimPaths = hPaths.map(p => p[sim]);
    for (let hi = 0; hi < nh; hi++) hSimPaths[hi].push(vals[hi]);
    aggPaths[sim].push(aggVals[0]);

    const annRets: number[][] = holdings.map((_, hi) => {
      const rets: number[] = [];
      for (let y = 0; y < totalYears; y++) rets.push(Math.max(effReturns[hi] + normalRandom() * stdDev, -99));
      return rets;
    });

    let isWithdrawing = false;
    for (let m = 1; m <= totalMonths; m++) {
      if (!isWithdrawing) {
        if (withdrawalRate != null) {
          if (retireFromMonth != null ? m >= retireFromMonth : aggVals[m - 1] >= targetValue) {
            isWithdrawing = true;
          }
        }
      }
      const oneOff = oneOffs.find(o => o.month === m);
      if (oneOff) {
        const totalVal = vals.reduce((a, b) => a + b, 0);
        if (totalVal > 0) {
          for (let hi = 0; hi < nh; hi++) vals[hi] += oneOff.amount * (vals[hi] / totalVal);
        }
      }
      const yi = Math.floor((m - 1) / 12);
      for (let hi = 0; hi < nh; hi++) {
        const monthlyR = Math.pow(1 + annRets[hi][yi] / 100, 1 / 12) - 1;
        let contrib = holdings[hi].monthlyContribution;
        if (isWithdrawing && withdrawalRate != null) contrib = -vals[hi] * (withdrawalRate / 100 / 12);
        vals[hi] = vals[hi] * (1 + monthlyR) + contrib;
        if (vals[hi] < 0) vals[hi] = 0;
        hSimPaths[hi].push(vals[hi]);
      }
      const total = vals.reduce((a, b) => a + b, 0);
      aggPaths[sim].push(total);
      aggVals.push(total);
    }
  }

  const points: McPoint[] = [];
  for (let m = 0; m <= totalMonths; m++) {
    const vals = aggPaths.map(p => p[m]).sort((a, b) => a - b);
    points.push({ month: m, p10: vals[Math.floor(vals.length * 0.1)], p50: vals[Math.floor(vals.length * 0.5)], p90: vals[Math.floor(vals.length * 0.9)] });
  }

  const holdingLines: McHoldingLine[] = holdings.map((h, hi) => {
    const pts: { month: number; value: number }[] = [];
    for (let m = 0; m <= totalMonths; m++) {
      const vals = hPaths[hi].map(p => p[m]).sort((a, b) => a - b);
      pts.push({ month: m, value: vals[Math.floor(vals.length * 0.5)] });
    }
    return { name: h.name, color: h.color, points: pts };
  });

  let medianMonths: number | null = null;
  for (let m = 1; m <= totalMonths; m++) {
    if (points[m].p50 >= targetValue) { medianMonths = m; break; }
  }

  return { points, holdingLines, medianMonths };
}
