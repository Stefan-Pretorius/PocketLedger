import { useState, useMemo, useEffect } from "react";
import { useStore } from "../store";
import { formatCurrency } from "../utils";
import { Card, Button, Input, Modal, SectionHeader } from "../components/ui";
import { PageHeader } from "../components/Layout";
import {
  Plus, Trash2, Edit2, Copy, BarChart3, Target, User, Users,
  RefreshCw, TrendingUp, Clock, DollarSign,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { ScenarioConfig, Holding } from "../types";

// ─── Monte Carlo helpers (standalone for this page) ─────────────────────────

function normalRandom(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

interface McHoldingInput {
  name: string; color: string; startValue: number; monthlyContribution: number; annualReturn: number;
}
interface McPoint { month: number; p10: number; p50: number; p90: number }
interface McHoldingLine { name: string; color: string; points: { month: number; value: number }[] }

function runMonteCarlo(
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
    const annRets = holdings.map((_, hi) => {
      const rets: number[] = [];
      for (let y = 0; y < totalYears; y++) rets.push(Math.max(effReturns[hi] + normalRandom() * stdDev, -99));
      return rets;
    });
    let isWithdrawing = false;
    for (let m = 1; m <= totalMonths; m++) {
      if (!isWithdrawing && withdrawalRate != null) {
        if (retireFromMonth != null ? m >= retireFromMonth : aggVals[m - 1] >= targetValue) isWithdrawing = true;
      }
      const oneOff = oneOffs.find(o => o.month === m);
      if (oneOff) {
        const totalVal = vals.reduce((a, b) => a + b, 0);
        if (totalVal > 0) for (let hi = 0; hi < nh; hi++) vals[hi] += oneOff.amount * (vals[hi] / totalVal);
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
  const holdingLines = holdings.map((h, hi) => {
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

function monthsToTarget(
  configs: { marketValue: number; monthlyContribution: number; annualReturn: number }[],
  target: number,
  oneOff?: { month: number; amount: number },
): number {
  const monthlyRates = configs.map(c => c.annualReturn / 100 / 12);
  let values = configs.map(c => c.marketValue);
  let total = values.reduce((a, b) => a + b, 0);
  if (total >= target) return 0;
  if (oneOff && oneOff.amount > 0 && oneOff.month > 0) {
    let lo = 1, hi = Math.max(oneOff.month, 2400);
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      let sum = 0;
      for (let i = 0; i < configs.length; i++) {
        const r = monthlyRates[i];
        const PV = configs[i].marketValue;
        const PMT = configs[i].monthlyContribution;
        if (mid <= oneOff.month) {
          if (r > 0) sum += PV * Math.pow(1 + r, mid) + PMT * (Math.pow(1 + r, mid) - 1) / r;
          else sum += PV + PMT * mid;
        } else {
          let v = r > 0 ? PV * Math.pow(1 + r, oneOff.month) + PMT * (Math.pow(1 + r, oneOff.month) - 1) / r : PV + PMT * oneOff.month;
          v += oneOff.amount * (configs[i].marketValue / configs.reduce((a, c) => a + c.marketValue, 0));
          const n2 = mid - oneOff.month;
          if (r > 0) sum += v * Math.pow(1 + r, n2) + PMT * (Math.pow(1 + r, n2) - 1) / r;
          else sum += v + PMT * n2;
        }
      }
      if (sum >= target) { hi = mid; } else { lo = mid + 1; }
    }
    values = configs.map(c => c.marketValue);
    for (let m = 1; m <= lo; m++) {
      total = 0;
      for (let i = 0; i < configs.length; i++) {
        values[i] = values[i] * (1 + monthlyRates[i]) + configs[i].monthlyContribution;
        total += values[i];
      }
      if (m === oneOff.month) {
        const weights = values.map(v => v / total);
        for (let i = 0; i < configs.length; i++) values[i] += oneOff.amount * weights[i];
        total += oneOff.amount;
      }
      if (total >= target) return m;
    }
    return Infinity;
  }
  let lo = 1, hi = 2400;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    let sum = 0;
    for (let i = 0; i < configs.length; i++) {
      const r = monthlyRates[i];
      const PV = configs[i].marketValue;
      const PMT = configs[i].monthlyContribution;
      if (r > 0) sum += PV * Math.pow(1 + r, mid) + PMT * (Math.pow(1 + r, mid) - 1) / r;
      else sum += PV + PMT * mid;
    }
    if (sum >= target) { hi = mid; } else { lo = mid + 1; }
  }
  values = configs.map(c => c.marketValue);
  for (let m = 1; m <= lo; m++) {
    total = 0;
    for (let i = 0; i < configs.length; i++) {
      values[i] = values[i] * (1 + monthlyRates[i]) + configs[i].monthlyContribution;
      total += values[i];
    }
    if (total >= target) return m;
  }
  return Infinity;
}

// ─── Monte Carlo Fan Chart ──────────────────────────────────────────────────

function MonteCarloChart({ data, target, holdingLines, milestones }: {
  data: McPoint[];
  target: number;
  holdingLines?: McHoldingLine[];
  milestones?: { month: number; label: string; p10: string; p50: string; p90: string }[];
}) {
  const filtered = data;
  if (filtered.length < 2) return null;
  const w = 1000, h = 220, pad = { t: 20, r: 16, b: 32, l: 56 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const allValues = filtered.flatMap(d => [d.p10, d.p50, d.p90, target]);
  if (holdingLines) for (const hl of holdingLines) for (const p of hl.points) allValues.push(p.value);
  const maxVal = Math.max(...allValues, 1);
  const range = maxVal - 0 || 1;
  const maxMonth = filtered[filtered.length - 1].month;
  const startMonth = 0, endMonth = maxMonth;
  const xScale = (m: number) => pad.l + ((m - startMonth) / (endMonth - startMonth || 1)) * iw;
  const yScale = (v: number) => pad.t + ih - ((v - 0) / range) * ih;

  const p10Path = filtered.map((d, i) => `${i === 0 ? "M" : "L"}${xScale(d.month).toFixed(1)},${yScale(d.p10).toFixed(1)}`).join(" ");
  const p90Rev = [...filtered].reverse().map(d => `L${xScale(d.month).toFixed(1)},${yScale(d.p90).toFixed(1)}`).join(" ");
  const fanD = `${p10Path} ${p90Rev} Z`;
  const medianD = filtered.map((d, i) => `${i === 0 ? "M" : "L"}${xScale(d.month).toFixed(1)},${yScale(d.p50).toFixed(1)}`).join(" ");

  const holdingPaths = holdingLines?.map(hl => ({
    color: hl.color,
    d: hl.points.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.month).toFixed(1)},${yScale(p.value).toFixed(1)}`).join(" "),
  })) ?? [];

  const yTicks = 5;
  const yLabels: { v: number; y: number }[] = [];
  for (let i = 0; i <= yTicks; i++) {
    const v = (range / yTicks) * i;
    yLabels.push({ v, y: yScale(v) });
  }

  const spanYears = maxMonth / 12;
  const yearStep = spanYears > 20 ? 60 : spanYears > 10 ? 24 : spanYears > 5 ? 12 : spanYears > 2 ? 6 : 3;
  const xLabels: { m: number; label: string }[] = [];
  for (let m = 0; m <= maxMonth; m += yearStep) {
    xLabels.push({ m, label: `${Math.floor(m / 12)}y` });
  }

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto block">
      {yLabels.map(({ v, y }) => (
        <g key={v}>
          <line x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke="var(--color-border)" strokeWidth="0.5" />
          <text x={pad.l - 8} y={y + 4} textAnchor="end" fill="var(--color-muted-foreground)" fontSize="12">
            {v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : formatCurrency(v)}
          </text>
        </g>
      ))}
      {xLabels.map(({ m, label }) => (
        <text key={m} x={xScale(m)} y={h - 4} textAnchor="middle" fill="var(--color-muted-foreground)" fontSize="11">
          {label}
        </text>
      ))}
      <line x1={pad.l} y1={yScale(target)} x2={w - pad.r} y2={yScale(target)}
        stroke="var(--color-warning)" strokeWidth="1.5" strokeDasharray="6 4" />
      <text x={w - pad.r - 2} y={yScale(target) - 6} textAnchor="end" fill="var(--color-warning)" fontSize="11" fontWeight="500">
        Target {formatCurrency(target)}
      </text>
      <path d={fanD} fill="var(--color-primary)" fillOpacity="0.15" />
      <path d={medianD} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinejoin="round" />
      {holdingPaths.map((hp, i) => (
        <path key={i} d={hp.d} fill="none" stroke={hp.color} strokeWidth="1.5" strokeLinejoin="round" strokeDasharray="5 3" opacity="0.8" />
      ))}
      {milestones?.map(ms => (
        <line key={ms.month} x1={xScale(ms.month)} y1={pad.t} x2={xScale(ms.month)} y2={h - pad.b}
          stroke="var(--color-muted-foreground)" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.4" />
      ))}
      <circle cx={xScale(filtered[0].month)} cy={yScale(filtered[0].p50)} r="4" fill="var(--color-primary)" />
    </svg>
  );
}

// ─── Historical return lookup ───────────────────────────────────────────────

/** Fetch historical prices from CoinGecko or Yahoo and compute CAGR for 5/10/15/20yr. */
async function fetchHistoricalReturns(
  holding: { symbol?: string; type: string; name: string; currentUnitPrice?: number },
): Promise<{ period: number; cagr: number | null; loading: boolean }[]> {
  const periods = [5, 10, 15, 20];
  const sym = holding.symbol?.trim().toUpperCase();
  if (!sym) return periods.map(p => ({ period: p, cagr: null, loading: false }));

  const now = Math.floor(Date.now() / 1000);

  try {
    let historicalPrices: { timestamp: number; price: number }[] | null = null;

    if (holding.type === "crypto") {
      const tickerMap: Record<string, string> = {
        BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "ripple",
        ADA: "cardano", DOT: "polkadot", AVAX: "avalanche-2", MATIC: "matic-network",
        LINK: "chainlink", UNI: "uniswap", ATOM: "cosmos", ALGO: "algorand",
        DOGE: "dogecoin", SHIB: "shiba-inu", LTC: "litecoin", BCH: "bitcoin-cash",
        XLM: "stellar", FTM: "fantom", NEAR: "near", HBAR: "hedera-hashgraph",
      };
      const coinId = tickerMap[sym] ?? sym.toLowerCase();
      const allData: { timestamp: number; price: number }[] = [];
      const maxYears = Math.max(...periods);
      for (let y = 0; y < maxYears; y++) {
        const from = now - (y + 1) * 365 * 86400;
        const to = now - y * 365 * 86400;
        try {
          const res = await fetch(
            `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=aud&from=${from}&to=${to}`
          );
          if (res.ok) {
            const data = await res.json();
            if (data.prices) {
              for (const [ts, pr] of data.prices) {
                allData.push({ timestamp: Math.floor(ts / 1000), price: pr });
              }
            }
            await new Promise(r => setTimeout(r, 250));
          }
        } catch {}
      }
      if (allData.length > 0) {
        allData.sort((a, b) => a.timestamp - b.timestamp);
        historicalPrices = allData;
      }
    } else {
      const suffixes = sym.includes(".") ? [sym] : [sym, `${sym}.AX`];
      for (const ys of suffixes) {
        try {
          const res = await fetch(`/api/yahoo/v8/finance/chart/${ys}?interval=1mo&range=${Math.max(...periods)}y`);
          if (res.ok) {
            const data = await res.json();
            const quotes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
            const timestamps = data?.chart?.result?.[0]?.timestamp;
            if (quotes && timestamps) {
              historicalPrices = timestamps.map((ts: number, i: number) => ({
                timestamp: ts, price: quotes[i] ?? 0,
              })).filter(p => p.price > 0);
              break;
            }
          }
        } catch {}
      }
    }

    if (!historicalPrices || historicalPrices.length < 2) return periods.map(p => ({ period: p, cagr: null, loading: false }));

    const currentPrice = holding.currentUnitPrice ?? historicalPrices[historicalPrices.length - 1].price;
    if (currentPrice <= 0) return periods.map(p => ({ period: p, cagr: null, loading: false }));

    return periods.map(period => {
      const targetTs = now - period * 365 * 86400;
      let closest = historicalPrices![0];
      for (const p of historicalPrices!) {
        if (Math.abs(p.timestamp - targetTs) < Math.abs(closest.timestamp - targetTs)) closest = p;
      }
      if (closest.price <= 0 || closest.timestamp >= historicalPrices![historicalPrices!.length - 1].timestamp) {
        return { period, cagr: null, loading: false };
      }
      const years = (now - closest.timestamp) / (365 * 86400);
      if (years < 1) return { period, cagr: null, loading: false };
      const cagr = (Math.pow(currentPrice / closest.price, 1 / years) - 1) * 100;
      return { period, cagr: Math.round(cagr * 10) / 10, loading: false };
    });
  } catch {
    return periods.map(p => ({ period: p, cagr: null, loading: false }));
  }
}

// ─── Per-holding config (mirrors Investments page) ──────────────────────────

interface PerHoldingConfig {
  monthlyContribution: number;
  annualReturn: number;
  dividendReinvestment: boolean;
}

function getDefaultConfig(summaries: { holding: Holding; marketValue: number }[]): Record<number, PerHoldingConfig> {
  const configs: Record<number, PerHoldingConfig> = {};
  for (const s of summaries) {
    configs[s.holding.id] = {
      monthlyContribution: s.holding.type === "super" ? 2500 : 0,
      annualReturn: s.holding.type === "crypto" ? 10 : 7,
      dividendReinvestment: false,
    };
  }
  return configs;
}

// ─── Scenario Projection Hook ──────────────────────────────────────────────

function useScenarioProjection(scenario: ScenarioConfig, holdings: Holding[], summaries: { holding: Holding; marketValue: number }[]) {
  const userAge = useStore(s => s.selfAge);
  const retirementAge = useStore(s => s.selfRetirementAge);
  const partnerAge = useStore(s => s.partnerAge);
  const partnerRetirementAge = useStore(s => s.partnerRetirementAge);

  return useMemo(() => {
    const target = 1_000_000;

    // Build per-holding configs from defaults + overrides
    const defaults = getDefaultConfig(summaries);
    const defaultHoldings = summaries.filter(s => {
      const override = scenario.holdingOverrides.find(o => o.holdingId === s.holding.id);
      return override?.included !== false;
    });
    if (defaultHoldings.length === 0) return null;

    const mcInputs: McHoldingInput[] = defaultHoldings.map(s => {
      const override = scenario.holdingOverrides.find(o => o.holdingId === s.holding.id);
      const def = defaults[s.holding.id];
      return {
        name: s.holding.name,
        color: s.holding.color,
        startValue: override?.marketValueOverride ?? s.marketValue,
        monthlyContribution: override?.monthlyContribution ?? def?.monthlyContribution ?? 0,
        annualReturn: override?.annualReturn ?? def?.annualReturn ?? 7,
      };
    });

    const portfolioValue = mcInputs.reduce((s, h) => s + h.startValue, 0);
    if (portfolioValue >= target) return { message: "Already at target!", points: null, milestones: [], holdingLines: [], medianMonths: 0 as number | null };

    // Determine retire from owner
    const ownerAge = scenario.owner === "partner" ? partnerAge : scenario.owner === "joint"
      ? Math.min(userAge ?? Infinity, partnerAge ?? Infinity)
      : userAge;
    const ownerRetireAge = scenario.owner === "partner" ? partnerRetirementAge : scenario.owner === "joint"
      ? Math.min(selfRetirementAge ?? Infinity, partnerRetirementAge ?? Infinity)
      : selfRetirementAge;
    const retireFromMonth = (ownerAge != null && ownerRetireAge != null && ownerRetireAge > ownerAge && isFinite(ownerAge) && isFinite(ownerRetireAge))
      ? (ownerRetireAge - ownerAge) * 12
      : undefined;

    const maxProjYears = 60;
    const { points, medianMonths, holdingLines } = runMonteCarlo(mcInputs, maxProjYears * 12, target, {
      simulations: 500, stdDevPct: 15,
      withdrawalRatePct: 4,
      oneOffInvestments: scenario.oneOffInvestments.length > 0 ? scenario.oneOffInvestments : undefined,
      retireFromMonth,
    });

    const ms: { month: number; label: string; p10: string; p50: string; p90: string }[] = [];
    for (const y of [5, 10, 15, 20]) {
      const m = y * 12;
      if (m < points.length && points[m].p50 > 0) {
        ms.push({
          month: m, label: `${y}yr · ${formatCurrency(points[m].p50)}`,
          p10: formatCurrency(points[m].p10),
          p50: formatCurrency(points[m].p50),
          p90: formatCurrency(points[m].p90),
        });
      }
    }

    const retireIncome = (retireFromMonth != null && retireFromMonth < points.length && points[retireFromMonth].p50 > 0)
      ? formatCurrency(points[retireFromMonth].p50 * 0.04 / 12)
      : undefined;

    return { points, medianMonths, holdingLines, milestones: ms, retireIncome, retireFromMonth };
  }, [scenario, holdings, summaries, userAge, retirementAge, partnerAge, partnerRetirementAge]);
}

// ─── Scenarios Page ─────────────────────────────────────────────────────────

const MILESTONE_YEARS = [5, 10, 15, 20];

export function ScenariosPage() {
  const scenarios = useStore(s => s.scenarios);
  const holdings = useStore(s => s.holdings);
  const getPortfolioSummary = useStore(s => s.getPortfolioSummary);
  const createScenario = useStore(s => s.createScenario);
  const updateScenario = useStore(s => s.updateScenario);
  const deleteScenario = useStore(s => s.deleteScenario);

  const portfolio = useMemo(() => getPortfolioSummary(), [getPortfolioSummary, holdings]);
  const summaries = portfolio.holdingSummaries;

  // Builder state
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [scName, setScName] = useState("");
  const [scDesc, setScDesc] = useState("");
  const [scOwner, setScOwner] = useState<"self" | "partner" | "joint">("self");
  const [scOverrides, setScOverrides] = useState<ScenarioConfig["holdingOverrides"]>([]);
  const [scOneOffs, setScOneOffs] = useState<{ month: number; amount: number }[]>([]);

  // Historical return lookup state
  const [historicalData, setHistoricalData] = useState<Record<number, { period: number; cagr: number | null }[]>>({});
  const [loadingHistory, setLoadingHistory] = useState<Record<number, boolean>>({});

  // Year range controls per scenario
  const [yearRanges, setYearRanges] = useState<Record<number, { start: number; end: number }>>({});

  const openNew = () => {
    setEditingId(null);
    setScName("");
    setScDesc("");
    setScOwner("self");
    setScOverrides(summaries.map(s => ({
      holdingId: s.holding.id,
      annualReturn: undefined,
      monthlyContribution: undefined,
      included: true,
      marketValueOverride: undefined,
    })));
    setScOneOffs([]);
    setBuilderOpen(true);
  };

  const openEdit = (sc: ScenarioConfig) => {
    setEditingId(sc.id);
    setScName(sc.name);
    setScDesc(sc.description ?? "");
    setScOwner(sc.owner ?? "self");
    setScOverrides([...sc.holdingOverrides]);
    setScOneOffs([...sc.oneOffInvestments]);
    setBuilderOpen(true);
  };

  const saveScenario = () => {
    if (!scName.trim()) { toast.error("Enter a name"); return; }
    const data = {
      name: scName.trim(),
      owner: scOwner,
      description: scDesc.trim() || undefined,
      holdingOverrides: scOverrides.filter(o => o.included || o.annualReturn != null || o.monthlyContribution != null || o.marketValueOverride != null),
      oneOffInvestments: scOneOffs.filter(o => o.amount > 0),
    };
    if (editingId != null) {
      updateScenario(editingId, data);
      toast.success("Scenario updated");
    } else {
      createScenario(data);
      toast.success("Scenario created");
    }
    setBuilderOpen(false);
  };

  const duplicateScenario = (sc: ScenarioConfig) => {
    createScenario({
      ...sc,
      name: `${sc.name} (copy)`,
    });
    toast.success("Scenario duplicated");
  };

  const lookupHistory = async (holdingId: number) => {
    const h = holdings.find(x => x.id === holdingId);
    if (!h) return;
    setLoadingHistory(p => ({ ...p, [holdingId]: true }));
    const results = await fetchHistoricalReturns(h);
    setHistoricalData(p => ({ ...p, [holdingId]: results }));
    setLoadingHistory(p => ({ ...p, [holdingId]: false }));
  };

  // Baseline projection (current portfolio, no modifications)
  const baselineProjection = useMemo(() => {
    if (summaries.length === 0) return null;
    const mcInputs: McHoldingInput[] = summaries.map(s => ({
      name: s.holding.name,
      color: s.holding.color,
      startValue: s.marketValue,
      monthlyContribution: s.holding.type === "super" ? 2500 : 0,
      annualReturn: s.holding.type === "crypto" ? 10 : 7,
    }));
    const target = 1_000_000;
    const portfolioValue = mcInputs.reduce((s, h) => s + h.startValue, 0);
    if (portfolioValue >= target) return { message: "Already at target!", points: null, milestones: [], medianMonths: 0 };
    const { points, medianMonths, holdingLines } = runMonteCarlo(mcInputs, 60 * 12, target, {
      simulations: 500, stdDevPct: 15,
    });
    const ms = MILESTONE_YEARS.map(y => {
      const m = y * 12;
      if (m < points.length && points[m].p50 > 0) {
        return { month: m, label: formatCurrency(points[m].p50), p10: formatCurrency(points[m].p10), p50: formatCurrency(points[m].p50), p90: formatCurrency(points[m].p90) };
      }
      return null;
    }).filter(Boolean) as { month: number; label: string; p10: string; p50: string; p90: string }[];
    return { points, medianMonths, holdingLines, milestones: ms, message: undefined as string | undefined };
  }, [summaries]);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 pb-8">
      <PageHeader
        title="Scenarios"
        subtitle="Create and compare investment scenarios with Monte Carlo projections"
        actions={
          <Button label="New Scenario" icon={Plus} onClick={openNew} />
        }
      />

      {/* Baseline chart — current portfolio trend */}
      {baselineProjection && baselineProjection.points && (
        <Card className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={14} className="text-muted-foreground" />
            <span className="text-xs font-semibold text-foreground">Current Portfolio Trend</span>
          </div>
          {baselineProjection.message ? (
            <p className="text-sm font-bold text-success text-center">{baselineProjection.message}</p>
          ) : (
            <>
              <div className="text-center mb-2">
                <p className="text-sm text-muted-foreground">
                  Median target: {baselineProjection.medianMonths != null
                    ? `${Math.floor(baselineProjection.medianMonths / 12)}y ${baselineProjection.medianMonths % 12}mo`
                    : "Not reachable"}
                </p>
              </div>
              <MonteCarloChart
                data={baselineProjection.points}
                target={1_000_000}
                holdingLines={baselineProjection.holdingLines}
                milestones={baselineProjection.milestones}
              />
            </>
          )}
        </Card>
      )}

      {/* Scenario list */}
      {(!scenarios || scenarios.length === 0) ? (
        <div className="text-center py-12 text-muted-foreground">
          <BarChart3 size={32} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">No scenarios yet. Create one to see how changes to your investments affect your long-term projection.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {scenarios.map(sc => (
            <ScenarioCard
              key={sc.id}
              scenario={sc}
              summaries={summaries}
              holdings={holdings}
              onEdit={() => openEdit(sc)}
              onDuplicate={() => duplicateScenario(sc)}
              onDelete={() => { deleteScenario(sc.id); toast.success("Scenario deleted"); }}
            />
          ))}
        </div>
      )}

      {/* Builder modal */}
      <Modal visible={builderOpen} onClose={() => setBuilderOpen(false)} title={editingId != null ? "Edit Scenario" : "New Scenario"} maxWidth="lg">
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <Input label="Name" value={scName} onChange={setScName} placeholder="e.g. Aggressive growth" />
            </div>
            <div className="flex-1">
              <label className="text-sm font-medium text-muted-foreground block mb-1">Owner</label>
              <div className="flex gap-2">
                <button onClick={() => setScOwner("self")}
                  className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                    scOwner === "self" ? "bg-primary/10 text-primary border-primary/30" : "bg-muted text-muted-foreground border-border")}>
                  <User size={12} /> Self
                </button>
                <button onClick={() => setScOwner("partner")}
                  className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                    scOwner === "partner" ? "bg-primary/10 text-primary border-primary/30" : "bg-muted text-muted-foreground border-border")}>
                  <Users size={12} /> Partner
                </button>
                <button onClick={() => setScOwner("joint")}
                  className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                    scOwner === "joint" ? "bg-primary/10 text-primary border-primary/30" : "bg-muted text-muted-foreground border-border")}>
                  <Users size={12} /> Joint
                </button>
              </div>
            </div>
          </div>
          <Input label="Description (optional)" value={scDesc} onChange={setScDesc} placeholder="What does this scenario assume?" />

          {/* Per-holding overrides */}
          <div>
            <SectionHeader title="Holding Overrides" />
            <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-thin">
              {summaries.map(s => {
                const override = scOverrides.find(o => o.holdingId === s.holding.id);
                return (
                  <div key={s.holding.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 text-xs">
                    <input type="checkbox" checked={override?.included !== false}
                      onChange={e => setScOverrides(prev => prev.map(o => o.holdingId === s.holding.id ? { ...o, included: e.target.checked } : o))}
                      className="rounded border-border" />
                    <span className="font-medium flex-1 truncate">{s.holding.name}</span>
                    <input type="number" placeholder="Return %" value={override?.annualReturn ?? ""}
                      onChange={e => setScOverrides(prev => prev.map(o => o.holdingId === s.holding.id ? { ...o, annualReturn: parseFloat(e.target.value) || undefined } : o))}
                      className="w-14 rounded border border-border bg-background px-1 py-0.5 text-right" title="Annual return % (leave empty for default)" />
                    <input type="number" placeholder="$/mo" value={override?.monthlyContribution ?? ""}
                      onChange={e => setScOverrides(prev => prev.map(o => o.holdingId === s.holding.id ? { ...o, monthlyContribution: parseFloat(e.target.value) || undefined } : o))}
                      className="w-14 rounded border border-border bg-background px-1 py-0.5 text-right" title="Monthly contribution (leave empty for default)" />
                    <input type="number" placeholder="Value" value={override?.marketValueOverride ?? ""}
                      onChange={e => setScOverrides(prev => prev.map(o => o.holdingId === s.holding.id ? { ...o, marketValueOverride: parseFloat(e.target.value) || undefined } : o))}
                      className="w-16 rounded border border-border bg-background px-1 py-0.5 text-right" title="Override market value (e.g. simulate adding lump sum)" />
                    <button onClick={() => lookupHistory(s.holding.id)} disabled={loadingHistory[s.holding.id]}
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-muted text-muted-foreground hover:bg-muted/80 transition-colors">
                      {loadingHistory[s.holding.id] ? <RefreshCw size={10} className="animate-spin" /> : <Clock size={10} />}
                      History
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Historical data display */}
            {Object.entries(historicalData).map(([hid, data]) => {
              const h = holdings.find(x => x.id === parseInt(hid));
              if (!h) return null;
              return (
                <div key={hid} className="mt-2 p-2 rounded-lg bg-muted/20 text-[10px]">
                  <p className="font-medium text-muted-foreground mb-1">{h.name} historical CAGR:</p>
                  <div className="flex gap-3">
                    {data.map(d => (
                      <span key={d.period} className={cn(d.cagr != null ? "text-foreground" : "text-muted-foreground/50")}>
                        {d.period}y: {d.cagr != null ? `${d.cagr}%` : "—"}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* One-off investments */}
          <div>
            <SectionHeader title="One-off Investments"
              action={{ label: scOneOffs.length < 3 ? "+ Add" : undefined!, onPress: () => {
                if (scOneOffs.length >= 3) return;
                setScOneOffs(prev => [...prev, { month: 0, amount: 1000 }]);
              } }}
            />
            {scOneOffs.map((oo, i) => (
              <div key={i} className="flex items-center gap-2 mb-2 text-xs">
                <span className="text-muted-foreground">$</span>
                <input type="number" value={oo.amount || ""}
                  onChange={e => setScOneOffs(prev => prev.map((o, j) => j === i ? { ...o, amount: parseFloat(e.target.value) || 0 } : o))}
                  className="w-20 rounded border border-border bg-background px-1 py-0.5 text-right" placeholder="Amount" />
                <span className="text-muted-foreground">in</span>
                <input type="number" min={0} max={60} value={oo.month !== 0 ? oo.month / 12 : 0 || ""}
                  onChange={e => setScOneOffs(prev => prev.map((o, j) => j === i ? { ...o, month: (parseInt(e.target.value) || 0) * 12 } : o))}
                  className="w-12 rounded border border-border bg-background px-1 py-0.5 text-center" placeholder="0" />
                <span className="text-muted-foreground">yr {oo.month === 0 ? "(now)" : ""}</span>
                {scOneOffs.length > 1 && (
                  <button onClick={() => setScOneOffs(prev => prev.filter((_, j) => j !== i))}
                    className="text-destructive hover:text-destructive/80">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
            {scOneOffs.length === 0 && (
              <p className="text-[10px] text-muted-foreground">No one-off investments. Add up to 3 lump sums at specific years.</p>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            <Button label="Save" onClick={saveScenario} />
            <Button label="Cancel" variant="secondary" onClick={() => setBuilderOpen(false)} />
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Scenario Card ──────────────────────────────────────────────────────────

function ScenarioCard({ scenario, summaries, holdings, onEdit, onDuplicate, onDelete }: {
  scenario: ScenarioConfig;
  summaries: { holding: Holding; marketValue: number }[];
  holdings: Holding[];
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const projection = useScenarioProjection(scenario, holdings, summaries);

  // One-off investment summary text
  const oneOffText = scenario.oneOffInvestments
    .filter(o => o.amount > 0)
    .map(o => `${formatCurrency(o.amount)} @ ${o.month / 12}yr`)
    .join(", ");

  // Holding summary
  const activeOverrides = scenario.holdingOverrides.filter(o => o.included !== false);
  const overrideCount = activeOverrides.length;

  return (
    <Card>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{scenario.name}</span>
            <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full font-medium",
              scenario.owner === "partner" ? "bg-purple-500/10 text-purple-500" : scenario.owner === "joint" ? "bg-green-500/10 text-green-500" : "bg-blue-500/10 text-blue-500")}>
              {scenario.owner === "partner" ? <><Users size={10} className="inline mr-0.5" />Partner</> : scenario.owner === "joint" ? <><Users size={10} className="inline mr-0.5" />Joint</> : <><User size={10} className="inline mr-0.5" />Self</>}
            </span>
          </div>
          {scenario.description && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{scenario.description}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onEdit} className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground"><Edit2 size={14} /></button>
          <button onClick={onDuplicate} className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground"><Copy size={14} /></button>
          <button onClick={onDelete} className="p-1 rounded hover:bg-muted transition-colors text-destructive"><Trash2 size={14} /></button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground mb-3">
        <span>{overrideCount} holding{overrideCount !== 1 ? "s" : ""}</span>
        {oneOffText && <span className="text-warning">• {oneOffText}</span>}
      </div>

      {/* Projection */}
      {projection ? (
        <>
          {projection.points ? (
            <>
              <div className="text-center mb-2">
                <p className="text-lg font-bold text-foreground">
                  {projection.medianMonths != null
                    ? `${Math.floor(projection.medianMonths / 12)}y ${projection.medianMonths % 12}mo`
                    : "Not reachable"}
                </p>
                <p className="text-[10px] text-muted-foreground">median time to $1M</p>
              </div>

              <MonteCarloChart
                data={projection.points}
                target={1_000_000}
                holdingLines={projection.holdingLines}
                milestones={projection.milestones}
              />

              {/* Milestone table */}
              {projection.milestones.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
                  {projection.milestones.map(ms => {
                    const year = Math.floor(ms.month / 12);
                    return (
                      <div key={ms.month} className="bg-muted/60 rounded-lg px-3 py-2 text-center">
                        <p className="text-[10px] text-muted-foreground font-medium">{year}yr</p>
                        <p className="text-xs font-bold text-foreground">{ms.p50}</p>
                        <p className="text-[9px] text-muted-foreground">{ms.p10} – {ms.p90}</p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Withdrawal income */}
              {projection.retireIncome && (
                <p className="text-[10px] text-warning text-center mt-2">4% withdrawal → {projection.retireIncome}/mo at retirement</p>
              )}
            </>
          ) : (
            <p className="text-sm font-bold text-success text-center">{projection.message}</p>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-4">No holdings included in this scenario.</p>
      )}
    </Card>
  );
}
