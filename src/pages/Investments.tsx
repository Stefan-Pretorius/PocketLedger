import { useState, useMemo, useEffect } from "react";
import { useStore } from "../store";
import { formatCurrency, formatDate } from "../utils";
import { Colors } from "../theme";
import {
  Card, Button, Input, Modal, EmptyState, SectionHeader,
  ColorPicker, ColorDot, Confirm, ProgressBar,
} from "../components/ui";
import { PageHeader } from "../components/Layout";
import {
  Plus, Trash2, TrendingUp, TrendingDown, DollarSign,
  BarChart3, Wallet, Bitcoin, Activity, PieChart, ChevronRight,
  RefreshCw, Sparkles, User, Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Holding, HoldingType, HoldingTransaction } from "../types";

const HOLDING_TYPE_LABELS: Record<HoldingType, string> = {
  crypto: "Crypto",
  etf: "ETF",
  managed_fund: "Managed Fund",
  stock: "Stock",
  super: "Super",
  other: "Other",
};

const HOLDING_TYPE_ICONS: Record<HoldingType, React.ElementType> = {
  crypto: Bitcoin,
  etf: BarChart3,
  managed_fund: Activity,
  stock: TrendingUp,
  super: Wallet,
  other: Wallet,
};

const CRYPTO_SYMBOL_STYLES: Record<string, { glyph: string; color: string }> = {
  BTC: { glyph: "₿", color: "#F7931A" },
  ETH: { glyph: "Ξ", color: "#627EEA" },
  SOL: { glyph: "◎", color: "#9945FF" },
  XRP: { glyph: "✕", color: "#23292F" },
  ADA: { glyph: "♢", color: "#0033AD" },
  DOT: { glyph: "●", color: "#E6007A" },
  DOGE: { glyph: "Ð", color: "#C2A633" },
  SHIB: { glyph: "⟠", color: "#FFA409" },
  LTC: { glyph: "Ł", color: "#345D9D" },
  AVAX: { glyph: "◈", color: "#E84142" },
  MATIC: { glyph: "⬡", color: "#8247E5" },
  LINK: { glyph: "◉", color: "#2A5ADA" },
  UNI: { glyph: "🦄", color: "#FF007A" },
  ATOM: { glyph: "⚛", color: "#2E3148" },
  ALGO: { glyph: "Ⱥ", color: "#000000" },
  BCH: { glyph: "₿", color: "#8DC351" },
  XLM: { glyph: "★", color: "#14B4E4" },
  NEAR: { glyph: "△", color: "#000000" },
  FTM: { glyph: "◊", color: "#1969FF" },
  HBAR: { glyph: "ℏ", color: "#3C3C3D" },
  TRX: { glyph: "◈", color: "#EF0027" },
};

function HoldingIcon({ holding, size = 18 }: { holding: Holding; size?: number }) {
  const Icon = HOLDING_TYPE_ICONS[holding.type];
  if (holding.type === "crypto" && holding.symbol) {
    const style = CRYPTO_SYMBOL_STYLES[holding.symbol.trim().toUpperCase()];
    if (style) {
      return (
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: style.color + "20" }}>
          <span style={{ color: style.color, fontSize: size }}>{style.glyph}</span>
        </div>
      );
    }
  }
  return (
    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: holding.color + "20" }}>
      <Icon size={size} style={{ color: holding.color }} />
    </div>
  );
}

// ─── Holding Modal ────────────────────────────────────────────────────────────

function HoldingModal({
  visible, onClose, initial,
}: {
  visible: boolean; onClose: () => void;
  initial?: Holding;
}) {
  const { createHolding, updateHolding, createHoldingTransaction } = useStore();
  const [name, setName] = useState(initial?.name ?? "");
  const [symbol, setSymbol] = useState(initial?.symbol ?? "");
  const [type, setType] = useState<HoldingType>(initial?.type ?? "crypto");
  const [price, setPrice] = useState(String(initial?.currentUnitPrice ?? ""));
  const [color, setColor] = useState(initial?.color ?? Colors.categoryColors[0]);
  const [owner, setOwner] = useState<"self" | "partner" | undefined>(initial?.owner);
  const [walletAddress, setWalletAddress] = useState(initial?.walletAddress ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [fetchingPrice, setFetchingPrice] = useState(false);
  const [fetchingBalance, setFetchingBalance] = useState(false);
  const [previewBalance, setPreviewBalance] = useState<number | null>(null);
  // Initial buy transaction fields
  const [txUnits, setTxUnits] = useState("");
  const [txPrice, setTxPrice] = useState("");
  const [txBrokerage, setTxBrokerage] = useState("");
  const [txDate, setTxDate] = useState(new Date().toISOString().split("T")[0]);
  const [txFillTime, setTxFillTime] = useState("");

  const fetchPrice = async () => {
    const sym = symbol.trim().toUpperCase();
    if (!sym) { toast.error("Enter a symbol first"); return; }
    setFetchingPrice(true);
    try {
      let fetched: number | null = null;

      if (type === "crypto") {
        const tickerMap: Record<string, string> = {
          BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "ripple",
          ADA: "cardano", DOT: "polkadot", AVAX: "avalanche-2", MATIC: "matic-network",
          LINK: "chainlink", UNI: "uniswap", ATOM: "cosmos", ALGO: "algorand",
          DOGE: "dogecoin", SHIB: "shiba-inu", LTC: "litecoin", BCH: "bitcoin-cash",
          XLM: "stellar", FTM: "fantom", NEAR: "near",           HBAR: "hedera-hashgraph",
          TRX: "tron",
        };
        const coinId = tickerMap[sym] ?? sym.toLowerCase();
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=aud`);
        if (res.ok) {
          const data = await res.json();
          fetched = data[coinId]?.aud ?? null;
        }
        if (fetched == null) {
          const binRes = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}USDT`);
          if (binRes.ok) {
            const binData = await binRes.json();
            const usdtPrice = parseFloat(binData.price);
            if (!isNaN(usdtPrice) && usdtPrice > 0) {
              const audRes = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
              if (audRes.ok) {
                const audData = await audRes.json();
                fetched = usdtPrice * (audData.rates?.AUD ?? 1);
              }
            }
          }
        }
      } else {
        const suffixes = sym.includes(".") ? [sym] : [sym, `${sym}.AX`];
        for (const ys of suffixes) {
          const res = await fetch(`/api/yahoo/v8/finance/chart/${ys}?interval=1d&range=1d`);
          if (res.ok) {
            const data = await res.json();
            const quote = data?.chart?.result?.[0]?.meta?.regularMarketPrice;
            if (quote != null && quote > 0) { fetched = quote; break; }
          }
        }
      }

      if (fetched != null && fetched > 0) {
        setPrice(String(fetched));
        toast.success(`Price: ${formatCurrency(fetched)}`);
      } else {
        toast.error("Could not fetch price — check the symbol");
      }
    } catch {
      toast.error("Failed to fetch price — check your connection");
    } finally {
      setFetchingPrice(false);
    }
  };

  const fetchBalance = async () => {
    const raw = walletAddress.trim();
    if (!raw) { toast.error("Enter a wallet address first"); return; }
    // Strip invisible / non-printable characters that can sneak in via paste
    const addr = raw.replace(/[^\x20-\x7E]/g, "");
    if (addr !== raw) toast.info("Cleaned invisible characters from address");
    if (!addr) { toast.error("Address is empty after cleaning"); setFetchingBalance(false); return; }
    setFetchingBalance(true);
    setPreviewBalance(null);
    try {
      let balanceRaw: number | null = null;
      let decimals = 18;

      if (addr.startsWith("1") || addr.startsWith("bc1") || addr.startsWith("3")) {
        const res = await fetch(`https://blockchain.info/q/addressbalance/${addr}`);
        if (res.ok) {
          const text = await res.text();
          balanceRaw = parseInt(text, 10);
          decimals = 8;
        } else {
          toast.error("Blockchain.info API error — try again later");
          setFetchingBalance(false);
          return;
        }
      } else if (addr.startsWith("0x")) {
        // Try BlockCypher first
        const bcRes = await fetch(`https://api.blockcypher.com/v1/eth/main/addrs/${addr}/balance`);
        if (bcRes.ok) {
          const bcData = await bcRes.json();
          if (bcData.balance != null) {
            balanceRaw = bcData.balance;
            decimals = 18;
          }
        }
        // Fallback: scrape Etherscan page
        if (balanceRaw == null) {
          const esRes = await fetch(`https://etherscan.io/address/${addr}`);
          if (esRes.ok) {
            const html = await esRes.text();
            const m = html.match(/([0-9,.]+)\s*ETH/);
            if (m) {
              balanceRaw = Math.round(parseFloat(m[1].replace(/,/g, "")) * 1e18);
              decimals = 18;
            }
          }
        }
        if (balanceRaw == null) {
          toast.error("Could not fetch ETH balance from any source.");
          setFetchingBalance(false);
          return;
        }
      } else if (addr.startsWith("T")) {
        // TRON
        const tgRes = await fetch(`https://api.trongrid.io/v1/accounts/${addr}`);
        if (tgRes.ok) {
          const tgData = await tgRes.json();
          if (tgData.success && tgData.data?.[0]?.balance != null) {
            balanceRaw = tgData.data[0].balance;
            decimals = 6;
          }
        }
        if (balanceRaw == null) {
          toast.error("Could not fetch TRX balance from TRONGrid.");
          setFetchingBalance(false);
          return;
        }
      } else if (addr.startsWith("addr1") || addr.startsWith("stake1")) {
        // Cardano — use pool.pm wallet API (supports CORS, no key needed)
        const pmRes = await fetch(`https://pool.pm/wallet/${addr}`);
        if (pmRes.ok) {
          const pmData = await pmRes.json();
          if (pmData.lovelaces != null) {
            balanceRaw = pmData.lovelaces;
            decimals = 6;
          }
        }
        if (balanceRaw == null) {
          toast.error("Could not fetch ADA balance from pool.pm.");
          setFetchingBalance(false);
          return;
        }
      } else {
        toast.error("Unsupported address format. Use BTC (1/bc1/3), ETH (0x), TRX (T...), or ADA (addr1.../stake1...).");
        setFetchingBalance(false);
        return;
      }

      if (balanceRaw != null && balanceRaw > 0) {
        const units = balanceRaw / Math.pow(10, decimals);
        setPreviewBalance(units);
        toast.success(`Wallet balance: ${units.toFixed(6)} units`);
      } else if (balanceRaw === 0) {
        toast.error("Wallet is empty (balance is 0)");
      } else {
        toast.error("Could not fetch balance. Check the address.");
      }
    } catch {
      toast.error("Failed to fetch wallet balance");
    } finally {
      setFetchingBalance(false);
    }
  };

  const save = () => {
    if (!name.trim()) { toast.error("Holding name is required"); return; }

    if (previewBalance != null && previewBalance > 0) {
      const priceNum = parseFloat(price);
      if (isNaN(priceNum) || priceNum <= 0) {
        toast.error("Fetch the unit price first before importing wallet balance");
        return;
      }
    }

    const payload = {
      name: name.trim(),
      symbol: symbol.trim() || undefined,
      type,
      currentUnitPrice: price ? parseFloat(price) : undefined,
      color,
      currency: "AUD",
      owner: owner || undefined,
      walletAddress: walletAddress.trim() || undefined,
      notes: notes.trim() || undefined,
    };

    let holdingId: number;
    if (initial) {
      updateHolding(initial.id, payload);
      holdingId = initial.id;
      toast.success("Holding updated");
    } else {
      const created = createHolding(payload);
      holdingId = created.id;
      toast.success("Holding added");
    }

    if (previewBalance != null && previewBalance > 0) {
      const priceNum = parseFloat(price);
      createHoldingTransaction({
        holdingId,
        type: "buy",
        units: previewBalance,
        pricePerUnit: priceNum,
        fees: 0,
        date: new Date().toISOString().split("T")[0],
        notes: "Imported from blockchain wallet",
      });
    }

    // Initial buy transaction from HoldingModal fields
    const txU = parseFloat(txUnits);
    const txP = parseFloat(txPrice);
    if (txU > 0 && txP > 0) {
      const txB = parseFloat(txBrokerage) || 0;
      const txG = Math.round(txB * 10) / 100;
      createHoldingTransaction({
        holdingId,
        type: "buy",
        units: txU,
        pricePerUnit: txP,
        fees: txB + txG,
        brokerage: txB,
        gst: txG,
        date: txDate,
        fillTime: txFillTime || undefined,
        notes: notes.trim() ? `Initial buy — ${notes.trim()}` : "Initial buy",
      });
    }

    onClose();
  };

  return (
    <Modal visible={visible} onClose={onClose} title={initial ? "Edit Holding" : "Add Holding"}>
      <div className="space-y-4">
        <Input label="Name" value={name} onChange={setName} placeholder="e.g. Bitcoin, Vanguard ASX 300" autoFocus />
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input label="Ticker/Symbol" value={symbol} onChange={setSymbol} placeholder={type === "crypto" ? "e.g. bitcoin, ethereum" : "e.g. VAS, BHP"} />
          </div>
          <button onClick={fetchPrice} disabled={fetchingPrice || !symbol.trim()}
            className={cn("px-3 py-2 rounded-lg text-xs font-medium transition-colors flex-shrink-0", fetchingPrice ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary hover:bg-primary/20")}>
            {fetchingPrice ? "..." : "Fetch"}
          </button>
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Type</label>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(HOLDING_TYPE_LABELS) as [HoldingType, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setType(k)}
                className={cn("px-3 py-1.5 rounded-full text-sm font-medium capitalize transition-colors",
                  type === k ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80")}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <Input label="Current Unit/Share Price (AUD, optional)" value={price} onChange={setPrice} type="number" prefix="$" placeholder="0.00" />
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Owner</label>
          <div className="flex gap-2">
            {([{ value: undefined, label: "Joint / Both" }, { value: "self" as const, label: "Self" }, { value: "partner" as const, label: "Partner" }] as const).map(o => (
              <button key={o.label} onClick={() => setOwner(o.value)}
                className={cn("px-4 py-2 rounded-full text-sm font-medium transition-colors",
                  owner === o.value ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/80")}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Color</label>
          <ColorPicker value={color} onChange={setColor} colors={Colors.categoryColors} />
        </div>

        {!initial && (
          <>
            <SectionHeader title="Initial Buy Transaction (optional)" />
            <div className="flex gap-2">
              <div className="flex-1">
                <Input label="Quantity" value={txUnits} onChange={setTxUnits} type="number" placeholder="0" />
              </div>
              <div className="flex-1">
                <Input label="Fill Price ($)" value={txPrice} onChange={setTxPrice} type="number" prefix="$" placeholder="0.00" />
              </div>
            </div>
            {parseFloat(txUnits) > 0 && parseFloat(txPrice) > 0 && (
              <div className="bg-muted/60 rounded-xl px-4 py-2.5 flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Fill Amount</span>
                <span className="text-sm font-bold text-foreground">{formatCurrency(parseFloat(txUnits) * parseFloat(txPrice))}</span>
              </div>
            )}
            <div className="flex gap-2">
              <div className="flex-1">
                <Input label="Brokerage ($)" value={txBrokerage} onChange={setTxBrokerage} type="number" prefix="$" placeholder="0.00" />
              </div>
              <div className="flex-1">
                <Input label="Date" value={txDate} onChange={setTxDate} type="date" />
              </div>
              <div className="flex-1">
                <Input label="Time" value={txFillTime} onChange={setTxFillTime} type="time" />
              </div>
            </div>
          </>
        )}

        {type === "crypto" && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground block">Wallet Address (optional)</label>
            <div className="flex gap-2">
              <input value={walletAddress} onChange={e => setWalletAddress(e.target.value)}
                placeholder={symbol.trim().toUpperCase() === "BTC" ? "bc1... or 1..." : "0x..."}
                className="flex-1 text-sm rounded-lg border border-border bg-background px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40" />
              <button onClick={fetchBalance} disabled={fetchingBalance || !walletAddress.trim()}
                className={cn("px-3 py-2 rounded-lg text-xs font-medium transition-colors flex-shrink-0 whitespace-nowrap", fetchingBalance ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary hover:bg-primary/20")}>
                {fetchingBalance ? "..." : "Fetch Balance"}
              </button>
            </div>
            {previewBalance != null && (
              <p className="text-xs text-success">
                Preview: {previewBalance.toFixed(6)} units — will be imported on Save
              </p>
            )}
            {walletAddress.trim() && previewBalance == null && (
              <p className="text-[10px] text-muted-foreground">
                Fetches wallet balance from public APIs / block explorers. Balance imported on Save.
              </p>
            )}
          </div>
        )}
        <Input label="Notes (optional)" value={notes} onChange={setNotes} multiline placeholder="Any notes…" />
        <div className="flex gap-2 pt-1">
          <Button label="Cancel" onClick={onClose} variant="secondary" fullWidth />
          <Button label={initial ? "Save" : "Add Holding"} onClick={save} variant="primary" fullWidth />
        </div>
      </div>
    </Modal>
  );
}

// ─── Transaction Modal ────────────────────────────────────────────────────────

function TxModal({
  visible, onClose, holdingId, initial,
}: {
  visible: boolean; onClose: () => void; holdingId: number;
  initial?: HoldingTransaction;
}) {
  const { createHoldingTransaction, updateHoldingTransaction } = useStore();
  const [type, setType] = useState<"buy" | "sell">(initial?.type ?? "buy");
  const [units, setUnits] = useState(String(initial?.units ?? ""));
  const [price, setPrice] = useState(String(initial?.pricePerUnit ?? ""));
  const [brokerage, setBrokerage] = useState(String(initial?.brokerage ?? ""));
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().split("T")[0]);
  const [fillTime, setFillTime] = useState(initial?.fillTime ?? "");
  const [isDividend, setIsDividend] = useState(initial?.isDividend ?? false);
  const [notes, setNotes] = useState(initial?.notes ?? "");

  const b = parseFloat(brokerage) || 0;
  const g = Math.round(b * 10) / 100; // GST = 10% of brokerage
  const u = parseFloat(units) || 0;
  const p = parseFloat(price) || 0;
  const fillAmount = u * p;
  const totalFees = b + g;
  const totalCost = fillAmount + totalFees;

  const save = () => {
    if (u <= 0) { toast.error("Enter valid quantity"); return; }
    if (p <= 0) { toast.error("Enter valid fill price"); return; }
    if (!date) { toast.error("Enter a date"); return; }

    const data = {
      holdingId, type, units: u, pricePerUnit: p,
      fees: totalFees, brokerage: b, gst: g,
      date, fillTime: fillTime || undefined,
      isDividend: type === "buy" ? (isDividend || undefined) : undefined,
      notes: notes.trim() || undefined,
    };

    if (initial) {
      updateHoldingTransaction(initial.id, data);
      toast.success("Transaction updated");
    } else {
      createHoldingTransaction(data);
      toast.success(`${type === "buy" ? "Buy" : "Sell"} transaction added`);
    }
    onClose();
  };

  return (
    <Modal visible={visible} onClose={onClose} title={initial ? "Edit Transaction" : "Add Transaction"}>
      <div className="space-y-4">
        {/* Type */}
        <div>
          <label className="text-sm font-medium text-muted-foreground block mb-2">Type</label>
          <div className="flex gap-2">
            {(["buy", "sell"] as const).map(t => (
              <button key={t} onClick={() => setType(t)}
                className={cn("px-4 py-2 rounded-full text-sm font-medium capitalize transition-colors",
                  type === t ? (t === "buy" ? "bg-success text-white" : "bg-destructive text-white") : "bg-muted text-foreground hover:bg-muted/80")}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Row: Quantity + Fill Price */}
        <div className="flex gap-2">
          <div className="flex-1">
            <Input label="Quantity" value={units} onChange={setUnits} type="number" placeholder="0" />
          </div>
          <div className="flex-1">
            <Input label="Fill Price ($)" value={price} onChange={setPrice} type="number" prefix="$" placeholder="0.00" />
          </div>
        </div>

        {/* Fill Amount display */}
        {fillAmount > 0 && (
          <div className="bg-muted/60 rounded-xl px-4 py-2.5 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Fill Amount</span>
            <span className="text-sm font-bold text-foreground">{formatCurrency(fillAmount)}</span>
          </div>
        )}

        {/* Row: Brokerage + GST */}
        <div className="flex gap-2">
          <div className="flex-1">
            <Input label="Brokerage ($)" value={brokerage} onChange={setBrokerage} type="number" prefix="$" placeholder="0.00" />
          </div>
          <div className="flex-1">
            <Input label="GST (10%)" value={g > 0 ? g.toFixed(2) : ""} onChange={() => {}} type="text" prefix="$" disabled />
          </div>
        </div>

        {/* Row: Date + Time */}
        <div className="flex gap-2">
          <div className="flex-1">
            <Input label="Date" value={date} onChange={setDate} type="date" />
          </div>
          <div className="flex-1">
            <Input label="Time (optional)" value={fillTime} onChange={setFillTime} type="time" />
          </div>
        </div>

        {/* Dividend reinvestment toggle */}
        {type === "buy" && (
          <button onClick={() => setIsDividend(v => !v)}
            className={cn(
              "w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border transition-colors",
              isDividend
                ? "bg-success/10 text-success border-success/30"
                : "bg-muted/50 text-muted-foreground border-border",
            )}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            {isDividend ? "✓ Dividend reinvestment" : "Dividend reinvestment"}
          </button>
        )}

        {/* Total Cost summary */}
        {fillAmount > 0 && (
          <div className="bg-muted rounded-xl p-3 space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Fill Amount</span>
              <span className="font-medium text-foreground">{formatCurrency(fillAmount)}</span>
            </div>
            {totalFees > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Brokerage + GST</span>
                <span className="font-medium text-foreground">{formatCurrency(totalFees)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-bold text-foreground border-t border-border pt-1.5">
              <span>Total {type === "buy" ? "Cost" : "Proceeds"}</span>
              <span>{formatCurrency(totalCost)}</span>
            </div>
          </div>
        )}

        <Input label="Notes (optional)" value={notes} onChange={setNotes} multiline placeholder="Trade ID, broker, exchange, etc." />
        <div className="flex gap-2 pt-1">
          <Button label="Cancel" onClick={onClose} variant="secondary" fullWidth />
          <Button label={initial ? "Save" : "Add Transaction"} onClick={save} variant="primary" fullWidth />
        </div>
      </div>
    </Modal>
  );
}

// ─── CGT Section ──────────────────────────────────────────────────────────────

function CgtSection({ txs, holdingName }: { txs: HoldingTransaction[]; holdingName: string }) {
  const sells = txs.filter(t => t.type === "sell").sort((a, b) => a.date.localeCompare(b.date));
  const buys = txs.filter(t => t.type === "buy").sort((a, b) => a.date.localeCompare(b.date));

  if (sells.length === 0) return null;

  // Calculate realised gains with holding periods (simplified average cost)
  const totalBuyCost = buys.reduce((s, t) => s + t.units * t.pricePerUnit, 0);
  const totalBuyUnits = buys.reduce((s, t) => s + t.units, 0);
  const avgCostPerUnit = totalBuyUnits > 0 ? totalBuyCost / totalBuyUnits : 0;

  const cgtEvents = sells.map(sell => {
    const gainPerUnit = sell.pricePerUnit - avgCostPerUnit;
    const totalGain = gainPerUnit * sell.units;
    // Find earliest buy before this sell to estimate holding period
    const firstBuy = buys.find(b => b.date <= sell.date);
    const holdingDays = firstBuy
      ? Math.round((new Date(sell.date).getTime() - new Date(firstBuy.date).getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    const discountEligible = holdingDays > 365;
    return { ...sell, avgCostPerUnit, totalGain, holdingDays, discountEligible };
  });

  const totalGain = cgtEvents.reduce((s, e) => s + e.totalGain, 0);
  const discountableGain = cgtEvents.filter(e => e.discountEligible).reduce((s, e) => s + e.totalGain, 0);
  const netCapitalGain = totalGain - (discountableGain * 0.5); // 50% CGT discount

  return (
    <div className="space-y-2">
      <SectionHeader title="CGT Estimate (Australia)" />
      <Card className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-muted rounded-xl p-2 text-center">
            <p className="text-[10px] text-muted-foreground">Total Realised Gain</p>
            <p className={cn("text-sm font-bold", totalGain >= 0 ? "text-success" : "text-destructive")}>
              {formatCurrency(totalGain)}
            </p>
          </div>
          <div className="bg-muted rounded-xl p-2 text-center">
            <p className="text-[10px] text-muted-foreground">Discount Eligible</p>
            <p className="text-sm font-bold text-foreground">{formatCurrency(discountableGain)}</p>
          </div>
          <div className="bg-muted rounded-xl p-2 text-center">
            <p className="text-[10px] text-muted-foreground">50% Discount</p>
            <p className="text-sm font-bold text-success">{formatCurrency(discountableGain * 0.5)}</p>
          </div>
          <div className="bg-muted rounded-xl p-2 text-center">
            <p className="text-[10px] text-muted-foreground">Est. Net Capital Gain</p>
            <p className={cn("text-sm font-bold", netCapitalGain >= 0 ? "text-warning" : "text-success")}>
              {formatCurrency(netCapitalGain)}
            </p>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Estimate based on average cost basis. The 50% CGT discount applies to assets held &gt;12 months (individuals).
          This is an estimate — consult your accountant.
        </p>
        {cgtEvents.length > 0 && (
          <div className="divide-y divide-border -mx-4">
            {cgtEvents.map((e, i) => (
              <div key={i} className="px-4 py-2.5 flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground truncate">
                    Sold {e.units} units @ {formatCurrency(e.pricePerUnit)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {formatDate(e.date)} · Avg cost {formatCurrency(e.avgCostPerUnit)}
                    {e.discountEligible && <span className="text-success ml-1">✓ &gt;12mo</span>}
                  </p>
                </div>
                <div className="text-right ml-2">
                  <span className={cn("text-xs font-semibold", e.totalGain >= 0 ? "text-success" : "text-destructive")}>
                    {formatCurrency(e.totalGain)}
                  </span>
                  {e.discountEligible && <p className="text-[9px] text-success">50% discount</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Holding Detail View ──────────────────────────────────────────────────────

function HoldingDetail({ holdingId, onBack }: { holdingId: number; onBack: () => void }) {
  const { getHoldingSummary, deleteHolding, deleteHoldingTransaction, recurring } = useStore();
  const summary = getHoldingSummary(holdingId);
  const [showTx, setShowTx] = useState<HoldingTransaction | true | null>(null);
  const [confirmDeleteHolding, setConfirmDeleteHolding] = useState(false);
  const [confirmDeleteTx, setConfirmDeleteTx] = useState<number | null>(null);
  const [showEditPrice, setShowEditPrice] = useState(false);
  const [priceDraft, setPriceDraft] = useState("");

  if (!summary) return null;

  const { holding, totalUnits, totalCostBasis, totalInvested, marketValue,
    unrealizedGainLoss, unrealizedGainLossPct, realizedGainLoss, transactions } = summary;

  const handleUpdatePrice = () => {
    const p = parseFloat(priceDraft);
    if (!isNaN(p) && p >= 0) {
      useStore.getState().updateHolding(holding.id, { currentUnitPrice: p });
      setShowEditPrice(false);
      toast.success("Price updated");
    }
  };

  return (
    <div className="space-y-5">
      {/* Back button + header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-sm text-primary hover:underline">&larr; Back to Portfolio</button>
      </div>

      {/* Holding header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HoldingIcon holding={holding} size={18} />
          <div>
            <h2 className="text-lg font-bold text-foreground">{holding.name}</h2>
            <p className="text-xs text-muted-foreground">
              {HOLDING_TYPE_LABELS[holding.type]}
              {holding.symbol && <> · {holding.symbol}</>}
            </p>
          </div>
        </div>
        <button onClick={() => { setConfirmDeleteHolding(true); }} className="p-2 rounded-lg hover:bg-muted text-muted-foreground">
          <Trash2 size={14} />
        </button>
      </div>

      {/* Current price */}
      <Card className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Current Unit Price</p>
          {showEditPrice ? (
            <div className="flex items-center gap-2 mt-1">
              <input type="number" value={priceDraft} onChange={e => setPriceDraft(e.target.value)}
                className="w-24 text-sm rounded-lg border border-border bg-background px-2 py-1" autoFocus
                onKeyDown={e => e.key === "Enter" && handleUpdatePrice()} />
              <button onClick={handleUpdatePrice} className="text-xs font-medium text-primary">Save</button>
              <button onClick={() => setShowEditPrice(false)} className="text-xs text-muted-foreground">Cancel</button>
            </div>
          ) : (
            <p className="text-base font-bold text-foreground">
              {holding.currentUnitPrice != null ? formatCurrency(holding.currentUnitPrice) : "—"}
            </p>
          )}
        </div>
        {!showEditPrice && (
          <Button label="Update Price" onClick={() => { setPriceDraft(String(holding.currentUnitPrice ?? "")); setShowEditPrice(true); }} variant="secondary" size="sm" />
        )}
      </Card>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: totalUnits > 0 ? "Units Held" : "Type", value: totalUnits > 0 ? totalUnits.toFixed(4) : HOLDING_TYPE_LABELS[holding.type], color: Colors.primary },
          { label: "Avg Cost/Unit", value: totalUnits > 0 ? formatCurrency(summary.avgCostPerUnit) : "—", color: Colors.warning },
          { label: "Total Cost Basis", value: totalCostBasis > 0 ? formatCurrency(totalCostBasis) : "—", color: Colors.warning },
          { label: "Current Value", value: marketValue > 0 ? formatCurrency(marketValue) : "—", color: Colors.primary },
          { label: "Unrealised P&L", value: totalCostBasis > 0 ? `${unrealizedGainLoss >= 0 ? "+" : ""}${formatCurrency(unrealizedGainLoss)}` : "—", color: unrealizedGainLoss >= 0 ? Colors.success : Colors.danger },
          { label: "Unrealised %", value: totalCostBasis > 0 ? `${unrealizedGainLossPct >= 0 ? "+" : ""}${unrealizedGainLossPct.toFixed(1)}%` : "—", color: unrealizedGainLoss >= 0 ? Colors.success : Colors.danger },
          { label: "Realised P&L", value: `${realizedGainLoss >= 0 ? "+" : ""}${formatCurrency(realizedGainLoss)}`, color: realizedGainLoss >= 0 ? Colors.success : Colors.danger },
          { label: "Total Invested", value: formatCurrency(totalInvested), color: Colors.warning },
        ].map(s => (
          <Card key={s.label} className="text-center py-2.5">
            <p className="text-[10px] text-muted-foreground mb-0.5">{s.label}</p>
            <p className="text-sm font-bold" style={{ color: s.color }}>{s.value}</p>
          </Card>
        ))}
      </div>

      {/* CGT Estimate */}
      <CgtSection txs={transactions} holdingName={holding.name} />

      {/* Linked Recurring */}
      {(() => {
        const linked = recurring.filter(r => r.holdingId === holding.id);
        if (linked.length === 0) return null;
        return (
          <div>
            <SectionHeader title="Auto-invest Recurring" />
            <Card padding={false}>
              {linked.map(r => (
                <div key={r.id} className="flex items-center justify-between px-4 py-2.5 border-b border-border last:border-b-0">
                  <div>
                    <p className="text-sm font-medium text-foreground">{r.description}</p>
                    <p className="text-[11px] text-muted-foreground">{formatCurrency(r.amount)}/{r.frequency === "weekly" ? "wk" : r.frequency === "fortnightly" ? "fn" : "mo"}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{r.isActive ? "Active" : "Paused"}</span>
                </div>
              ))}
            </Card>
          </div>
        );
      })()}

      {/* Transactions */}
      <div>
        <SectionHeader title="Transactions" action={{ label: "+ Add", onPress: () => setShowTx(true) }} />
        {transactions.length === 0 ? (
          <Card>
            <EmptyState icon={BarChart3} title="No transactions"
              subtitle="Add your first buy or sell transaction." />
          </Card>
        ) : (
          <Card padding={false}>
            {[...transactions].reverse().map((tx, i) => (
              <div key={tx.id} className={cn("flex items-center gap-3 px-4 py-3", i < transactions.length - 1 && "border-b border-border")}>
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0",
                  tx.type === "buy" ? "bg-success/10" : "bg-destructive/10")}>
                  {tx.type === "buy" ? <TrendingUp size={14} className="text-success" /> : <TrendingDown size={14} className="text-destructive" />}
                </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-xs font-semibold uppercase", tx.type === "buy" ? "text-success" : "text-destructive")}>{tx.type}</span>
                      {tx.isDividend && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-success/10 text-success font-medium">Dividend</span>}
                      <span className="text-xs text-foreground font-medium">{tx.units} units @ {formatCurrency(tx.pricePerUnit)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(tx.date)}
                      {tx.fillTime && <>, {tx.fillTime}</>}
                      {tx.fees > 0 && (
                        <> · Fees: {formatCurrency(tx.fees)}
                          {tx.brokerage != null && <span className="text-[10px] text-muted-foreground/70"> (brokerage {formatCurrency(tx.brokerage)}{tx.gst ? ` + GST ${formatCurrency(tx.gst)}` : ""})</span>}</>
                      )}
                      {tx.notes && <> · {tx.notes}</>}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold text-foreground">{formatCurrency(tx.units * tx.pricePerUnit)}</p>
                    {tx.fees > 0 && <p className="text-[10px] text-muted-foreground">+{formatCurrency(tx.fees)} fees</p>}
                  </div>
                <div className="flex items-center gap-0.5">
                  <button onClick={() => setShowTx(tx)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
                  </button>
                  <button onClick={() => setConfirmDeleteTx(tx.id)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </Card>
        )}
      </div>

      <TxModal key={showTx instanceof Object ? `edit-${showTx.id}` : "new"} visible={showTx !== null} onClose={() => setShowTx(null)}
        holdingId={holdingId} initial={showTx instanceof Object ? showTx : undefined} />

      <Confirm visible={confirmDeleteHolding} onClose={() => setConfirmDeleteHolding(false)}
        onConfirm={() => { deleteHolding(holdingId); toast.success("Holding deleted"); onBack(); }}
        title="Delete holding?" message="All transactions for this holding will also be deleted." confirmLabel="Delete Holding" />

      <Confirm visible={confirmDeleteTx !== null} onClose={() => setConfirmDeleteTx(null)}
        onConfirm={() => { if (confirmDeleteTx !== null) { deleteHoldingTransaction(confirmDeleteTx); toast.success("Transaction deleted"); } }}
        title="Delete transaction?" message="This will affect cost basis and gain/loss calculations." confirmLabel="Delete" />
    </div>
  );
}

// ─── Millionaire Projection ─────────────────────────────────────────────────────

const PROJECTION_KEY = "holdingProjectionConfigs";

interface PerHoldingConfig {
  monthlyContribution: number;
  annualReturn: number;
  dividendReinvestment: boolean;
}

function loadProjectionConfigs(): Record<number, PerHoldingConfig> {
  try {
    const raw = localStorage.getItem(PROJECTION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveProjectionConfigs(configs: Record<number, PerHoldingConfig>) {
  localStorage.setItem(PROJECTION_KEY, JSON.stringify(configs));
}

function getDefaultConfig(summaries: { holding: Holding; marketValue: number }[]): Record<number, PerHoldingConfig> {
  const configs: Record<number, PerHoldingConfig> = {};
  for (const s of summaries) {
    configs[s.holding.id] = {
      monthlyContribution: 0,
      annualReturn: s.holding.type === "crypto" ? 10 : 7,
      dividendReinvestment: false,
    };
  }
  return configs;
}

function monthsToTarget(
  configs: { marketValue: number; monthlyContribution: number; annualReturn: number }[],
  target: number,
): number {
  const monthlyRates = configs.map(c => c.annualReturn / 100 / 12);
  let values = configs.map(c => c.marketValue);
  let total = values.reduce((a, b) => a + b, 0);
  if (total >= target) return 0;
  let lo = 1, hi = 2400;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    let sum = 0;
    for (let i = 0; i < configs.length; i++) {
      const r = monthlyRates[i];
      const PV = configs[i].marketValue;
      const PMT = configs[i].monthlyContribution;
      if (r > 0) {
        sum += PV * Math.pow(1 + r, mid) + PMT * (Math.pow(1 + r, mid) - 1) / r;
      } else {
        sum += PV + PMT * mid;
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
    if (total >= target) return m;
  }
  return Infinity;
}

function generateTrajectory(
  configs: { marketValue: number; monthlyContribution: number; annualReturn: number }[],
  totalMonths: number,
  points: number,
): { month: number; value: number }[] {
  const monthlyRates = configs.map(c => c.annualReturn / 100 / 12);
  const step = Math.max(1, Math.floor(totalMonths / points));
  const vals = configs.map(c => c.marketValue);
  const result: { month: number; value: number }[] = [];
  let currentMonth = 0;
  for (let m = 1; m <= totalMonths; m++) {
    for (let i = 0; i < configs.length; i++) {
      vals[i] = vals[i] * (1 + monthlyRates[i]) + configs[i].monthlyContribution;
    }
    if (m % step === 0 || m === totalMonths) {
      const total = vals.reduce((a, b) => a + b, 0);
      result.push({ month: m, value: total });
    }
  }
  return result;
}

function ProjectionChart({ data, target, startValue }: {
  data: { month: number; value: number }[];
  target: number;
  startValue: number;
}) {
  const w = 600, h = 200, pad = { t: 16, r: 16, b: 28, l: 48 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const maxVal = Math.max(target, ...data.map(d => d.value));
  const minVal = 0;
  const range = maxVal - minVal || 1;
  const xScale = (m: number) => pad.l + (m / data[data.length - 1].month) * iw;
  const yScale = (v: number) => pad.t + ih - ((v - minVal) / range) * ih;

  const pathD = data.map((d, i) => `${i === 0 ? "M" : "L"}${xScale(d.month).toFixed(1)},${yScale(d.value).toFixed(1)}`).join(" ");
  const areaD = `${pathD} L${xScale(data[data.length - 1].month).toFixed(1)},${yScale(0)} L${xScale(data[0].month).toFixed(1)},${yScale(0)} Z`;

  // Y-axis labels
  const yTicks = 5;
  const yLabels: { v: number; y: number }[] = [];
  for (let i = 0; i <= yTicks; i++) {
    const v = minVal + (range / yTicks) * i;
    yLabels.push({ v, y: yScale(v) });
  }

  // X-axis labels (show years)
  const totalMonths = data[data.length - 1].month;
  const yearStep = totalMonths > 120 ? 24 : totalMonths > 60 ? 12 : 6;
  const xLabels: { m: number; label: string }[] = [];
  for (let m = 0; m <= totalMonths; m += yearStep) {
    xLabels.push({ m, label: `${Math.floor(m / 12)}y` });
  }

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-auto" style={{ maxHeight: 180 }}>
      {/* Grid lines */}
      {yLabels.map(({ v, y }) => (
        <g key={v}>
          <line x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke="var(--color-border)" strokeWidth="0.5" />
          <text x={pad.l - 6} y={y + 3} textAnchor="end" fill="var(--color-muted-foreground)" fontSize="9">
            {v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : formatCurrency(v)}
          </text>
        </g>
      ))}
      {xLabels.map(({ m, label }) => (
        <text key={m} x={xScale(m)} y={h - 4} textAnchor="middle" fill="var(--color-muted-foreground)" fontSize="9">
          {label}
        </text>
      ))}

      {/* Target line */}
      <line x1={pad.l} y1={yScale(target)} x2={w - pad.r} y2={yScale(target)}
        stroke="var(--color-warning)" strokeWidth="1" strokeDasharray="4 3" />
      <text x={w - pad.r - 2} y={yScale(target) - 4} textAnchor="end" fill="var(--color-warning)" fontSize="8">
        Target {formatCurrency(target)}
      </text>

      {/* Area fill */}
      <path d={areaD} fill="var(--color-primary)" fillOpacity="0.08" />

      {/* Line */}
      <path d={pathD} fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinejoin="round" />

      {/* Start dot */}
      <circle cx={xScale(data[0].month)} cy={yScale(data[0].value)} r="3" fill="var(--color-primary)" />
    </svg>
  );
}

function MillionaireProjection({ summaries }: { summaries: { holding: Holding; marketValue: number }[] }) {
  const [savedConfigs, setSavedConfigs] = useState<Record<number, PerHoldingConfig>>(() => {
    const loaded = loadProjectionConfigs();
    // Merge with defaults for any missing holdings
    const merged = { ...getDefaultConfig(summaries), ...loaded };
    return merged;
  });

  const [excluded, setExcluded] = useState<Set<number>>(() => {
    return new Set(summaries.filter(s => s.holding.type === "crypto").map(s => s.holding.id));
  });
  const [collapsed, setCollapsed] = useState(true);
  const [showWhatIf, setShowWhatIf] = useState(false);
  const [whatIfScenarios, setWhatIfScenarios] = useState<Record<number, { overrideContribution: number; overrideReturn: number }>>({});

  const setWhatIfScenario = (id: number, sc: { overrideContribution: number; overrideReturn: number }) => {
    setWhatIfScenarios(prev => ({ ...prev, [id]: sc }));
  };

  const updateConfig = (id: number, patch: Partial<PerHoldingConfig>) => {
    setSavedConfigs(prev => {
      const next = { ...prev, [id]: { ...prev[id], ...patch } };
      saveProjectionConfigs(next);
      return next;
    });
  };

  const toggleHolding = (id: number) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const included = summaries.filter(s => !excluded.has(s.holding.id));
  const includedConfigs = included
    .filter(s => savedConfigs[s.holding.id])
    .map(s => ({
      holdingId: s.holding.id,
      marketValue: s.marketValue,
      monthlyContribution: savedConfigs[s.holding.id].monthlyContribution,
      annualReturn: savedConfigs[s.holding.id].annualReturn,
    }));

  const totalMonthly = includedConfigs.reduce((s, h) => s + h.monthlyContribution, 0);
  const weightedReturn = includedConfigs.length > 0
    ? includedConfigs.reduce((s, h) => s + h.marketValue * h.annualReturn, 0) / includedConfigs.reduce((s, h) => s + h.marketValue, 0)
    : 0;

  const projection = useMemo(() => {
    const target = 1_000_000;
    if (includedConfigs.length === 0) return null;
    const portfolioValue = includedConfigs.reduce((s, h) => s + h.marketValue, 0);
    if (portfolioValue >= target) return { years: 0, months: 0, message: "Already a millionaire!" as string | undefined };
    const months = monthsToTarget(includedConfigs, target);
    if (!isFinite(months)) return null;
    const trajectory = generateTrajectory(includedConfigs, months, 60);
    return { years: Math.floor(months / 12), months: months % 12, months, trajectory, message: undefined as string | undefined };
  }, [includedConfigs]);

  const totalSuper = summaries.filter(s => s.holding.type === "super").reduce((s, h) => s + h.marketValue, 0);

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-warning" />
          <span className="text-sm font-semibold text-foreground">Millionaire Projection</span>
        </div>
        <button onClick={() => setCollapsed(c => !c)} className="text-xs text-primary hover:underline">
          {collapsed ? "Show settings" : "Hide settings"}
        </button>
      </div>

      {totalSuper > 0 && (
        <p className="text-xs text-muted-foreground">Includes super ({formatCurrency(totalSuper)})</p>
      )}

      {/* Per-holding settings */}
      {!collapsed && summaries.length > 0 && (
        <div className="space-y-2.5 border border-border rounded-lg p-3">
          <p className="text-[10px] text-muted-foreground font-medium">Per-holding settings</p>
          {summaries.map(s => {
            const isExcluded = excluded.has(s.holding.id);
            const cfg = savedConfigs[s.holding.id];
            if (!cfg) return null;
            return (
              <div key={s.holding.id} className={cn(
                "flex flex-wrap items-center gap-2 rounded-md p-2 transition-colors",
                isExcluded ? "opacity-40" : "bg-muted/30",
              )}>
                <div className="flex items-center gap-1.5 min-w-0 flex-1 text-sm">
                  <HoldingIcon holding={s.holding} size={13} />
                  <span className="font-medium text-foreground truncate">{s.holding.name}</span>
                  <span className="text-muted-foreground text-xs">{formatCurrency(s.marketValue)}</span>
                  <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">{HOLDING_TYPE_LABELS[s.holding.type]}</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">$</span>
                    <input type="number" value={cfg.monthlyContribution || ""}
                      onChange={e => updateConfig(s.holding.id, { monthlyContribution: parseFloat(e.target.value) || 0 })}
                      className="w-14 text-xs rounded border border-border bg-background px-1 py-0.5 text-right"
                      placeholder="0"
                      disabled={cfg.dividendReinvestment}
                      title={cfg.dividendReinvestment ? "Dividend reinvestment active" : "Monthly manual contribution"} />
                  </div>
                  <div className="flex items-center gap-1">
                    <input type="number" value={cfg.annualReturn || ""}
                      onChange={e => updateConfig(s.holding.id, { annualReturn: parseFloat(e.target.value) || 0 })}
                      className="w-12 text-xs rounded border border-border bg-background px-1 py-0.5 text-right"
                      placeholder="7" />
                    <span className="text-[10px] text-muted-foreground">%</span>
                  </div>
                  <button onClick={() => updateConfig(s.holding.id, { dividendReinvestment: !cfg.dividendReinvestment })}
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors whitespace-nowrap",
                      cfg.dividendReinvestment
                        ? "bg-success/15 text-success border border-success/30"
                        : "bg-muted text-muted-foreground border border-border",
                    )}>
                    {cfg.dividendReinvestment ? "✓ Dividends" : "↻ Dividends"}
                  </button>
                  <button onClick={() => toggleHolding(s.holding.id)}
                    className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors",
                      isExcluded
                        ? "bg-destructive/15 text-destructive border border-destructive/30"
                        : "bg-muted text-muted-foreground border border-border",
                    )}>
                    {isExcluded ? "Excluded" : "Include"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Aggregate projection */}
      {projection && (
        <>
          {projection.message ? (
            <p className="text-sm font-bold text-success text-center">{projection.message}</p>
          ) : (
            <>
              <div className="text-center">
                <p className="text-2xl font-bold text-foreground">
                  {projection.years > 0 && <>{projection.years} yr{projection.years !== 1 ? "s" : ""} </>}
                  {projection.months > 0 && <>{projection.months} mo</>}
                  {projection.years === 0 && projection.months === 0 && "< 1 mo"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  to reach <span className="font-semibold text-foreground">{formatCurrency(1_000_000)}</span>
                  {includedConfigs.length > 0 && (
                    <> from {formatCurrency(includedConfigs.reduce((s, h) => s + h.marketValue, 0))}</>
                  )}
                </p>
              </div>

              {/* Trajectory chart */}
              {projection.trajectory && projection.trajectory.length > 1 && (
                <ProjectionChart
                  data={projection.trajectory}
                  target={1_000_000}
                  startValue={includedConfigs.reduce((s, h) => s + h.marketValue, 0)}
                />
              )}
            </>
          )}
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground justify-center">
            <span>• {formatCurrency(totalMonthly)}/mo</span>
            <span>• {weightedReturn.toFixed(1)}% p.a.</span>
            <span>• {includedConfigs.length} holding{includedConfigs.length !== 1 ? "s" : ""}</span>
          </div>
        </>
      )}
      {includedConfigs.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-1">Toggle holdings above to include them in the projection.</p>
      )}

      {/* What If comparison */}
      {projection && includedConfigs.length > 0 && (
        <>
          <div className="border-t border-border pt-3">
            <button
              onClick={() => setShowWhatIf(!showWhatIf)}
              className="flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <BarChart3 size={12} />
              {showWhatIf ? "Hide comparison" : "What if I change my investments?"}
            </button>
          </div>
          {showWhatIf && (
            <div className="space-y-3 border border-border rounded-lg p-3 bg-muted/20">
              <p className="text-[10px] text-muted-foreground font-medium">Compare a scenario against your current plan</p>
              <div className="space-y-2">
                {included.map(s => {
                  const cfg = savedConfigs[s.holding.id];
                  if (!cfg) return null;
                  const sc = whatIfScenarios[s.holding.id] ?? { overrideContribution: cfg.monthlyContribution, overrideReturn: cfg.annualReturn };
                  return (
                    <div key={s.holding.id} className="flex items-center gap-2">
                      <HoldingIcon holding={s.holding} size={12} />
                      <span className="text-xs text-foreground truncate flex-1 min-w-0">{s.holding.name}</span>
                      <div className="flex items-center gap-1">
                        <input type="number" value={sc.overrideContribution || ""}
                          onChange={e => setWhatIfScenario(s.holding.id, { ...sc, overrideContribution: parseFloat(e.target.value) || 0 })}
                          className="w-14 text-xs rounded border border-border bg-background px-1 py-0.5 text-right"
                          placeholder="0" />
                        <span className="text-[9px] text-muted-foreground">/mo</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <input type="number" value={sc.overrideReturn || ""}
                          onChange={e => setWhatIfScenario(s.holding.id, { ...sc, overrideReturn: parseFloat(e.target.value) || 0 })}
                          className="w-12 text-xs rounded border border-border bg-background px-1 py-0.5 text-right"
                          placeholder="7" />
                        <span className="text-[9px] text-muted-foreground">%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              {(() => {
                const whatIfConfigs = includedConfigs.map(c => ({
                  ...c,
                  monthlyContribution: whatIfScenarios[c.holdingId]?.overrideContribution ?? c.monthlyContribution,
                  annualReturn: whatIfScenarios[c.holdingId]?.overrideReturn ?? c.annualReturn,
                }));
                const wiMonthly = whatIfConfigs.reduce((s, h) => s + h.monthlyContribution, 0);
                const wiWeightedReturn = whatIfConfigs.length > 0
                  ? whatIfConfigs.reduce((s, h) => s + h.marketValue * h.annualReturn, 0) / whatIfConfigs.reduce((s, h) => s + h.marketValue, 0)
                  : 0;
                const wiMonths = monthsToTarget(whatIfConfigs, 1_000_000);
                const baseMonths = projection.months;
                const diffMonths = baseMonths - wiMonths;
                if (!isFinite(wiMonths)) return <p className="text-xs text-muted-foreground">Scenario never reaches target.</p>;
                return (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="text-center p-2 rounded-lg bg-card border border-border">
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Current</p>
                      <p className="text-sm font-bold text-foreground">
                        {baseMonths > 0 ? `${Math.floor(baseMonths / 12)}y ${baseMonths % 12}mo` : "< 1mo"}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{formatCurrency(totalMonthly)}/mo @ {weightedReturn.toFixed(1)}%</p>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-card border border-primary/30">
                      <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Scenario</p>
                      <p className="text-sm font-bold" style={{ color: diffMonths > 0 ? "var(--success)" : "var(--danger)" }}>
                        {wiMonths > 0 ? `${Math.floor(wiMonths / 12)}y ${wiMonths % 12}mo` : "< 1mo"}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{formatCurrency(wiMonthly)}/mo @ {wiWeightedReturn.toFixed(1)}%</p>
                    </div>
                    {diffMonths !== 0 && (
                      <div className="col-span-2 text-center">
                        <span className={cn("text-[11px] font-semibold", diffMonths > 0 ? "text-success" : "text-destructive")}>
                          {diffMonths > 0 ? "Saves " : "Adds "}{Math.abs(diffMonths)} month{Math.abs(diffMonths) !== 1 ? "s" : ""} ({Math.abs(diffMonths) >= 12 ? `${Math.floor(Math.abs(diffMonths) / 12)}y ${Math.abs(diffMonths) % 12}mo` : ""})
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function InvestmentsPage() {
  const { holdings, getPortfolioSummary, refreshAllPrices } = useStore();
  const [showNew, setShowNew] = useState(false);
  const [editHolding, setEditHolding] = useState<Holding | null>(null);
  const [detailHoldingId, setDetailHoldingId] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const portfolio = useMemo(() => getPortfolioSummary(), [getPortfolioSummary, holdings]);

  // Auto-refresh prices when holdings with symbols change
  useEffect(() => {
    const hasSymbols = holdings.some(h => h.symbol);
    if (hasSymbols) {
      refreshAllPrices().catch(() => {});
    }
  }, [holdings.length]);

  const onRefreshPrices = async () => {
    setRefreshing(true);
    const count = await refreshAllPrices();
    setRefreshing(false);
    if (count > 0) toast.success(`Refreshed prices for ${count} holding${count !== 1 ? "s" : ""}`);
  };

  if (detailHoldingId != null) {
    return (
      <div>
        <PageHeader title="Investments" />
        <div className="px-4 sm:px-6 pb-6">
          <HoldingDetail holdingId={detailHoldingId} onBack={() => setDetailHoldingId(null)} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Investments"
        subtitle={holdings.length > 0 ? `${holdings.length} holding${holdings.length !== 1 ? "s" : ""}` : undefined}
        actions={refreshing ? (
          <Button label="Refreshing…" variant="secondary" size="sm" disabled />
        ) : (
          <Button label="Add Holding" onClick={() => setShowNew(true)} variant="primary" size="sm" icon={Plus} />
        )}
      />

      <div className="px-4 sm:px-6 space-y-5 pb-6">
        {holdings.length === 0 ? (
          <EmptyState icon={PieChart} title="No holdings yet"
            subtitle="Add a crypto, ETF, managed fund, or stock to start tracking your portfolio."
            action={{ label: "Add Holding", onPress: () => setShowNew(true) }} />
        ) : (
          <>
            {/* Portfolio summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Total Invested", value: formatCurrency(portfolio.totalInvested), color: Colors.warning },
                { label: "Market Value", value: formatCurrency(portfolio.totalMarketValue), color: Colors.primary },
                { label: "Total P&L", value: `${portfolio.totalGainLoss >= 0 ? "+" : ""}${formatCurrency(portfolio.totalGainLoss)}`, color: portfolio.totalGainLoss >= 0 ? Colors.success : Colors.danger },
                { label: "Return", value: `${portfolio.totalGainLossPct >= 0 ? "+" : ""}${portfolio.totalGainLossPct.toFixed(1)}%`, color: portfolio.totalGainLossPct >= 0 ? Colors.success : Colors.danger },
              ].map(s => (
                <Card key={s.label} className="text-center py-3">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-lg font-bold" style={{ color: s.color }}>{s.value}</p>
                </Card>
              ))}
            </div>

            {/* By type summary */}
            <div>
              <SectionHeader title="By Type" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {(["crypto", "etf", "managed_fund", "stock", "super", "other"] as const).map(type => {
                  const TypeIcon = HOLDING_TYPE_ICONS[type];
                  const items = portfolio.holdingSummaries.filter(s => s.holding.type === type);
                  if (items.length === 0) return null;
                  const totalValue = items.reduce((s, h) => s + h.marketValue, 0);
                  const totalInvested = items.reduce((s, h) => s + h.totalInvested, 0);
                  const pnl = totalValue - totalInvested;
                  const pnlPct = totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;
                  return (
                    <Card key={type} className="px-4 py-3">
                      <div className="flex items-center gap-2 mb-2">
                        <TypeIcon size={14} className="text-muted-foreground" />
                        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{HOLDING_TYPE_LABELS[type]}</span>
                        <span className="text-[10px] text-muted-foreground/60 ml-auto">{items.length} {items.length === 1 ? "holding" : "holdings"}</span>
                      </div>
                      <p className="text-sm font-bold text-foreground">{formatCurrency(totalValue)}</p>
                      <p className="text-[10px] text-muted-foreground/70">Invested {formatCurrency(totalInvested)}</p>
                      <p className={cn("text-[11px] font-medium mt-0.5", pnl >= 0 ? "text-success" : "text-destructive")}>
                        {pnl >= 0 ? "+" : ""}{formatCurrency(pnl)} ({pnl >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)
                      </p>
                    </Card>
                  );
                })}
              </div>
            </div>

            {/* Millionaire projection */}
            {portfolio.totalMarketValue > 0 && (
              <MillionaireProjection summaries={portfolio.holdingSummaries} />
            )}

            {/* Holdings list */}
            <div>
              <SectionHeader
                title="Holdings"
                action={{ label: "Refresh Prices", onPress: onRefreshPrices }}
              />
              <div className="space-y-2">
                {portfolio.holdingSummaries.map(s => {
                  const hasValue = s.marketValue > 0;
                  const gainPct = s.totalCostBasis > 0 ? s.unrealizedGainLossPct : null;
                  return (
                    <Card key={s.holding.id} onClick={() => setDetailHoldingId(s.holding.id)} padding={false} className="px-4 py-3 cursor-pointer hover:border-primary/40 transition-colors">
                      <div className="flex items-center gap-3">
                        <HoldingIcon holding={s.holding} size={18} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-foreground">{s.holding.name}</p>
                            {s.holding.owner === "self" ? (
                              <User size={12} className="text-primary" />
                            ) : s.holding.owner === "partner" ? (
                              <Users size={12} className="text-warning" />
                            ) : null}
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                              {HOLDING_TYPE_LABELS[s.holding.type]}
                            </span>
                            {s.holding.symbol && <span className="text-[10px] text-muted-foreground">{s.holding.symbol}</span>}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {s.totalUnits > 0
                              ? `${s.totalUnits.toFixed(4)} units · Avg ${formatCurrency(s.avgCostPerUnit)}`
                              : "Lump sum"}
                            {s.holding.currentUnitPrice != null && <> · {s.totalUnits > 0 ? "Price" : "Value"} {formatCurrency(s.holding.currentUnitPrice)}</>}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-foreground">{hasValue ? formatCurrency(s.marketValue) : "—"}</p>
                          {gainPct != null && (
                            <p className={cn("text-xs font-medium", s.unrealizedGainLoss >= 0 ? "text-success" : "text-destructive")}>
                              {s.unrealizedGainLoss >= 0 ? "+" : ""}{gainPct.toFixed(1)}%
                            </p>
                          )}
                        </div>
                        <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>

            {/* Realised P&L Summary */}
            <div>
              <SectionHeader title="Realised Gains / Losses" />
              <Card>
                {portfolio.holdingSummaries.filter(s => s.realizedGainLoss !== 0).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-2">No realised gains yet.</p>
                ) : (
                  <div className="divide-y divide-border -mx-4">
                    {portfolio.holdingSummaries.filter(s => s.realizedGainLoss !== 0).map(s => (
                      <div key={s.holding.id} className="flex items-center justify-between px-4 py-2.5">
                        <span className="text-sm text-foreground">{s.holding.name}</span>
                        <span className={cn("text-sm font-semibold", s.realizedGainLoss >= 0 ? "text-success" : "text-destructive")}>
                          {s.realizedGainLoss >= 0 ? "+" : ""}{formatCurrency(s.realizedGainLoss)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground mt-2">
                  Realised gains may be subject to Capital Gains Tax (CGT) in Australia.
                  Holdings &gt;12 months may qualify for the 50% CGT discount.
                </p>
              </Card>
            </div>
          </>
        )}
      </div>

      <HoldingModal visible={showNew} onClose={() => setShowNew(false)} />
      <HoldingModal key={editHolding ? `edit-${editHolding.id}` : "new"} visible={editHolding != null} onClose={() => setEditHolding(null)}
        initial={editHolding ?? undefined} />
    </div>
  );
}

