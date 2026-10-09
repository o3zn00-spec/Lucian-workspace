"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Plus, Search, ChevronDown, ChevronRight, ArrowLeft, Trash2,
  Bookmark, BookmarkCheck, ExternalLink, TrendingUp, TrendingDown,
  PieChart, Activity as ActivityIcon, Bell, FileText, Eye, Target,
  X, RefreshCw, ArrowRight, Bot, Clock, DollarSign, AlertTriangle,
} from "lucide-react";
import {
  useInvestingStore,
  calculateHolding,
  getCurrentPrice,
  formatCurrency,
  formatPct,
  type Investment,
  type Transaction,
  type Thesis,
  type WatchlistItem,
  type ResearchItem,
  type AssetType,
  type TransactionType,
} from "@/store/investing";
import { INSTRUMENT_CATALOG, getInstrumentBySymbol } from "@/lib/markets/catalog";
import { useMarketsStore } from "@/store/markets";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui-devspace/dialog";
import { Button } from "@/components/ui-devspace/button";
import { Input } from "@/components/ui-devspace/input";
import { Label } from "@/components/ui-devspace/label";
import { Textarea } from "@/components/ui-devspace/textarea";
import { toast } from "@/hooks/use-toast";
import { InvestmentCanvas } from "@/components/investing/investment-canvas";
import { cn } from "@/lib/utils";



type Tab = "canvas" | "overview" | "holdings" | "watchlist" | "activity" | "research";
type DetailTab = "overview" | "thesis" | "performance" | "activity" | "notes";

const TIME_RANGES = ["1D", "1W", "1M", "3M", "YTD", "1Y", "3Y", "ALL"] as const;
const ASSET_TYPES: { id: AssetType; label: string }[] = [
  { id: "stock", label: "Stock" }, { id: "etf", label: "ETF" },
  { id: "crypto", label: "Crypto" }, { id: "fund", label: "Fund" },
  { id: "bond", label: "Bond" }, { id: "other", label: "Other" },
];

export default function InvestingPageWrapper() {
  return (
    <>
      {/* Phase 9: deep-link receiver for /investing?holding=<id> */}
      <Suspense fallback={null}>
        <InvestingDeepLinkReceiver />
      </Suspense>
      <InvestingPage />
    </>
  );
}

/**
 * Phase 9: Investing deep-link receiver.
 *
 * Reads `?holding=<id>` (or `?watchlist=<id>` / `?research=<id>`) on mount,
 * validates the entity exists in the store, dispatches a CustomEvent so
 * the inner page opens the right detail view, and strips the param.
 *
 * For `?holding=<id>` → opens the investment detail view.
 * For `?watchlist=<id>` or `?research=<id>` → opens the corresponding tab
 * (watchlist / research) with the entity visually highlighted (best-effort
 * — the underlying tab components don't yet expose a highlight prop, so
 * we just switch tabs and the user lands on the right list).
 */
function InvestingDeepLinkReceiver() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const consumedRef = useRef<string | null>(null);

  useEffect(() => {
    const holdingId = searchParams.get("holding");
    const watchlistId = searchParams.get("watchlist");
    const researchId = searchParams.get("research");

    const key = `${holdingId ?? ""}|${watchlistId ?? ""}|${researchId ?? ""}`;
    if (!key.replace(/\|/g, "")) return;
    if (consumedRef.current === key) return;
    consumedRef.current = key;

    const store = useInvestingStore.getState();
    let detail: { type: "holding" | "watchlist" | "research"; id: string } | null = null;
    if (holdingId && store.investments.some((i) => i.id === holdingId)) {
      detail = { type: "holding", id: holdingId };
    } else if (watchlistId && store.watchlist.some((w) => w.id === watchlistId)) {
      detail = { type: "watchlist", id: watchlistId };
    } else if (researchId && store.research.some((r) => r.id === researchId)) {
      detail = { type: "research", id: researchId };
    }

    if (detail) {
      window.dispatchEvent(new CustomEvent("lucian:investing-deeplink", { detail }));
    }
    // Strip whichever params were present.
    const next = new URLSearchParams(searchParams.toString());
    next.delete("holding");
    next.delete("watchlist");
    next.delete("research");
    const qs = next.toString();
    router.replace(qs ? `/investing?${qs}` : "/investing");
  }, [searchParams, router]);

  return null;
}

export function InvestingPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedInv, setSelectedInv] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  // Phase 9: listen for deep-link events from the outer receiver.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ type: "holding" | "watchlist" | "research"; id: string }>).detail;
      if (!detail) return;
      if (detail.type === "holding") {
        setSelectedInv(detail.id);
      } else if (detail.type === "watchlist") {
        setSelectedInv(null);
        setTab("watchlist");
      } else if (detail.type === "research") {
        setSelectedInv(null);
        setTab("research");
      }
    };
    window.addEventListener("lucian:investing-deeplink", handler as EventListener);
    return () => window.removeEventListener("lucian:investing-deeplink", handler as EventListener);
  }, []);

  return (
    <div className="themed flex h-full min-h-0 flex-col bg-canvas text-fg">
      {/* Header */}
      <div className="shrink-0 border-b border-line-muted px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[16px] font-semibold tracking-tight text-fg">Investing</h1>
            <p className="mt-0.5 text-[11px] text-fg-muted">Long-term portfolio management</p>
          </div>
          <div className="flex items-center gap-2">
            
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="mr-1 h-3 w-3" /> Add Investment
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selectedInv && <InvestmentDetail id={selectedInv} onBack={() => setSelectedInv(null)} />}
          <div hidden={!!selectedInv}>
            <PortfolioSummary />
            <div className="border-b border-line-muted px-4 sm:px-6">
              <div className="flex gap-1 overflow-x-auto">
                {([
                  ["overview", "Overview"], ["holdings", "Holdings"],
                  ["watchlist", "Watchlist"], ["activity", "Activity"], ["research", "Research"], ["canvas", "Canvas"],
                ] as [Tab, string][]).map(([id, label]) => (
                  <button key={id} onClick={() => setTab(id)}
                    className={cn("border-b-2 px-3 py-1.5 text-[12px] font-medium transition-colors",
                      tab === id ? "border-[var(--accent)] text-fg" : "border-transparent text-fg-muted hover:text-fg")}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-4 sm:p-6">
              {tab === "canvas" && <InvestmentCanvas onOpenInvestment={setSelectedInv} />}
              {tab === "overview" && <OverviewTab onOpenInv={setSelectedInv} />}
              {tab === "holdings" && <HoldingsTab onOpenInv={setSelectedInv} />}
              {tab === "watchlist" && <WatchlistTab />}
              {tab === "activity" && <ActivityTab />}
              {tab === "research" && <ResearchTab />}
            </div>
          </div>
      </div>

      {addOpen && <AddInvestmentDialog onClose={() => setAddOpen(false)} />}
    </div>
  );
}

/* ═══ Portfolio Summary ═══ */

function PortfolioSummary() {
  const investments = useInvestingStore((s) => s.investments);
  const transactions = useInvestingStore((s) => s.transactions);
  const dividends = useInvestingStore((s) => s.dividends);
  const [timeRange, setTimeRange] = useState<string>("1M");

  const { totalValue, totalInvested, totalReturn, returnPct, todayChange, todayPct, totalDividends, totalCash } = useMemo(() => {
    let value = 0, invested = 0, divs = 0;
    for (const inv of investments) {
      const price = getCurrentPrice(inv.symbol);
      const txns = transactions.filter((t) => t.investmentId === inv.id);
      const calc = calculateHolding(inv, txns, dividends.filter(d => d.investmentId === inv.id), price, 1);
      value += calc.currentValue;
      invested += calc.totalInvested;
      divs += calc.totalDividends;
    }
    const ret = value - invested;
    const retPct = invested > 0 ? (ret / invested) * 100 : 0;
    // Today's change (simplified: use catalog changePct)
    const todayChg = investments.reduce((s, inv) => {
      const inst = getInstrumentBySymbol(inv.symbol) ?? getInstrumentBySymbol(inv.symbol + ".Daily");
      const price = getCurrentPrice(inv.symbol);
      const txns = transactions.filter((t) => t.investmentId === inv.id);
      const calc = calculateHolding(inv, txns, [], price, 1);
      return s + calc.currentValue * ((inst?.changePct ?? 0) / 100);
    }, 0);
    const todayPctVal = value > 0 ? (todayChg / value) * 100 : 0;
    return {
      totalValue: value, totalInvested: invested, totalReturn: ret,
      returnPct: retPct, todayChange: todayChg, todayPct: todayPctVal,
      totalDividends: divs, totalCash: 0,
    };
  }, [investments, transactions, dividends]);

  if (investments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <PieChart className="h-12 w-12 text-fg-faint opacity-30" />
        <p className="mt-3 text-[14px] font-medium text-fg-muted">Build your portfolio</p>
        <p className="mt-1 max-w-sm text-[12px] text-fg-faint">
          Track long-term investments, performance, thesis, research and portfolio allocation in one place.
        </p>
      </div>
    );
  }

  return (
    <div className="border-b border-line-muted px-4 py-4 sm:px-6">
      <div className="mx-auto max-w-5xl">
        {/* Portfolio value */}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-fg-faint">Portfolio Value</p>
            <p className="mt-1 font-mono text-[28px] font-bold tabular-nums text-fg">{formatCurrency(totalValue)}</p>
            <div className="mt-1 flex items-center gap-3 text-[12px]">
              <span className={cn("flex items-center gap-0.5", todayChange >= 0 ? "text-green-400" : "text-red-400")}>
                {todayChange >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {todayChange >= 0 ? "+" : ""}{formatCurrency(todayChange)} ({formatPct(todayPct)}) today
              </span>
            </div>
          </div>
          <div className="flex gap-1">
            {TIME_RANGES.map(r => (
              <button key={r} onClick={() => setTimeRange(r)}
                className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium",
                  timeRange === r ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg")}>
                {r}
              </button>
            ))}
          </div>
        </div>
        {/* Summary stats */}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatBox label="Total Invested" value={formatCurrency(totalInvested)} />
          <StatBox label="Total Return" value={formatCurrency(totalReturn)} sub={formatPct(returnPct)} positive={totalReturn >= 0} />
          <StatBox label="Income" value={formatCurrency(totalDividends)} />
          <StatBox label="Cash" value={formatCurrency(totalCash)} />
        </div>
        {/* Performance chart (simplified) */}
        <div className="mt-3 h-[80px] rounded-md border border-line bg-surface">
          <Sparkline data={generatePerfData(totalValue, timeRange)} positive={totalReturn >= 0} />
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, sub, positive }: { label: string; value: string; sub?: string; positive?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2">
      <div className="text-[9px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className="mt-0.5 font-mono text-[16px] font-bold tabular-nums text-fg">{value}</div>
      {sub && <div className={cn("text-[10px] tabular-nums", positive ? "text-green-400" : "text-red-400")}>{sub}</div>}
    </div>
  );
}

function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  if (data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const w = 600, h = 80, step = w / (data.length - 1);
  const pts = data.map((v, i) => `${i * step},${h - ((v - min) / range) * h}`).join(" ");
  const color = positive ? "#089981" : "#f23645";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" preserveAspectRatio="none">
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`${color}15`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function generatePerfData(base: number, range: string): number[] {
  const count = range === "1D" ? 24 : range === "1W" ? 7 : range === "1M" ? 30 : 60;
  const out: number[] = [];
  let v = base * 0.92;
  for (let i = 0; i < count; i++) {
    const r = ((Math.sin(i * 0.3) + Math.cos(i * 0.15)) * 0.5 + Math.random() * 0.02 - 0.01);
    v = v * (1 + r * 0.015);
    out.push(v);
  }
  out.push(base);
  return out;
}

/* ═══ Overview Tab ═══ */

function OverviewTab({ onOpenInv }: { onOpenInv: (id: string) => void }) {
  const investments = useInvestingStore((s) => s.investments);
  const transactions = useInvestingStore((s) => s.transactions);
  const dividends = useInvestingStore((s) => s.dividends);
  const watchlist = useInvestingStore((s) => s.watchlist);
  const activities = useInvestingStore((s) => s.activities);
  const research = useInvestingStore((s) => s.research);

  const holdings = useMemo(() => {
    const calcs = investments.map(inv => {
      const price = getCurrentPrice(inv.symbol);
      const txns = transactions.filter(t => t.investmentId === inv.id);
      const divs = dividends.filter(d => d.investmentId === inv.id);
      const calc = calculateHolding(inv, txns, divs, price, 1);
      return { ...calc, price };
    }).sort((a, b) => b.currentValue - a.currentValue);
    // Aggregate totalValue via reduce (avoids reassigning a let during render).
    const totalValue = calcs.reduce((sum, c) => sum + c.currentValue, 0);
    return { calcs, totalValue };
  }, [investments, transactions, dividends]);

  const allocations = useMemo(() => {
    const groups: Record<string, number> = {};
    for (const h of holdings.calcs) {
      const type = h.investment.assetType;
      groups[type] = (groups[type] ?? 0) + h.currentValue;
    }
    return Object.entries(groups).map(([type, value]) => ({
      label: type, value, pct: holdings.totalValue > 0 ? (value / holdings.totalValue) * 100 : 0,
    })).sort((a, b) => b.value - a.value);
  }, [holdings]);

  const topHoldings = holdings.calcs.slice(0, 5);
  const totalDividends = dividends.reduce((s, d) => s + d.amount, 0);

  // Risk metrics
  const largestPct = holdings.calcs[0]?.allocation ?? 0;
  const top3Pct = holdings.calcs.slice(0, 3).reduce((s, h) => s + h.allocation, 0);
  const cryptoPct = allocations.find(a => a.label === "crypto")?.pct ?? 0;
  const techPct = holdings.calcs.filter(h => h.investment.sector === "technology").reduce((s, h) => s + h.allocation, 0);

  if (investments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-[13px] font-medium text-fg-muted">No investments yet</p>
        <p className="mt-1 text-[12px] text-fg-faint">Add your first investment to start tracking your portfolio.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Allocation + Movers */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Allocation */}
        <div className="rounded-lg border border-line bg-surface p-4">
          <h3 className="mb-3 text-[12px] font-semibold text-fg">Portfolio Allocation</h3>
          <div className="flex items-center gap-4">
            <DonutChart segments={allocations.map(a => ({ label: a.label, value: a.value, color: getColorForType(a.label) }))} total={holdings.totalValue} />
            <div className="flex-1 space-y-1">
              {allocations.map(a => (
                <div key={a.label} className="flex items-center gap-2 text-[11px]">
                  <span className="h-2 w-2 rounded-full" style={{ background: getColorForType(a.label) }} />
                  <span className="flex-1 capitalize text-fg-muted">{a.label}</span>
                  <span className="font-mono tabular-nums text-fg">{a.pct.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* Today's Movers */}
        <div className="rounded-lg border border-line bg-surface p-4">
          <h3 className="mb-3 text-[12px] font-semibold text-fg">Today&apos;s Movers</h3>
          <div className="space-y-1">
            {holdings.calcs.slice(0, 5).map(h => {
              const inst = getInstrumentBySymbol(h.investment.symbol) ?? getInstrumentBySymbol(h.investment.symbol + ".Daily");
              const change = inst?.changePct ?? 0;
              return (
                <button key={h.investment.id} type="button" aria-label={`Open ${h.investment.symbol} investment`} onClick={() => onOpenInv(h.investment.id)}
                  className="flex w-full items-center justify-between rounded px-2 py-1 text-[11px] hover:bg-hover">
                  <span className="font-medium text-fg">{h.investment.symbol}</span>
                  <span className={cn("flex items-center gap-0.5 font-mono tabular-nums", change >= 0 ? "text-green-400" : "text-red-400")}>
                    {change >= 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                    {formatPct(change)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Top Holdings */}
      <div className="rounded-lg border border-line bg-surface p-4">
        <h3 className="mb-3 text-[12px] font-semibold text-fg">Your Investments</h3>
        <div className="space-y-1">
          {topHoldings.map(h => (
            <button key={h.investment.id} onClick={() => onOpenInv(h.investment.id)}
              className="flex w-full items-center justify-between rounded px-2 py-2 text-[12px] hover:bg-hover">
              <div className="flex items-center gap-2">
                <span className="font-medium text-fg">{h.investment.symbol}</span>
                <span className="text-[10px] text-fg-faint">{h.investment.name}</span>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-mono tabular-nums text-fg">{formatCurrency(h.currentValue)}</span>
                <span className={cn("font-mono tabular-nums", h.returnPct >= 0 ? "text-green-400" : "text-red-400")}>{formatPct(h.returnPct)}</span>
                <span className="font-mono tabular-nums text-fg-muted">{h.allocation.toFixed(1)}%</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Risk + Income */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-4">
          <h3 className="mb-3 text-[12px] font-semibold text-fg">Portfolio Risk</h3>
          <div className="space-y-1 text-[11px]">
            <RiskRow label="Largest Position" value={`${holdings.calcs[0]?.investment.symbol ?? "—"} · ${largestPct.toFixed(1)}%`} />
            <RiskRow label="Top 3 Concentration" value={`${top3Pct.toFixed(1)}%`} warning={top3Pct > 50} />
            <RiskRow label="Crypto Exposure" value={`${cryptoPct.toFixed(1)}%`} warning={cryptoPct > 30} />
            <RiskRow label="Technology Exposure" value={`${techPct.toFixed(1)}%`} />
            <RiskRow label="Asset Concentration" value={top3Pct > 50 ? "High" : top3Pct > 30 ? "Moderate" : "Diversified"} />
          </div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <h3 className="mb-3 text-[12px] font-semibold text-fg">Investment Income</h3>
          <div className="text-[11px]">
            <div className="text-[9px] uppercase text-fg-faint">2026 Income</div>
            <div className="font-mono text-[18px] font-bold text-fg">{formatCurrency(totalDividends)}</div>
          </div>
          <div className="mt-2 text-[10px] text-fg-faint">
            {dividends.length} dividend {dividends.length === 1 ? "payment" : "payments"} recorded
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="rounded-lg border border-line bg-surface p-4">
        <h3 className="mb-2 text-[12px] font-semibold text-fg">Recent Activity</h3>
        {activities.length === 0 ? (
          <p className="py-3 text-center text-[11px] text-fg-faint">No activity yet.</p>
        ) : (
          <div className="space-y-1">
            {activities.slice(0, 5).map(a => (
              <div key={a.id} className="flex items-center gap-2 text-[11px]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                <span className="flex-1 truncate text-fg-muted">{a.message}</span>
                <span className="text-[9px] text-fg-faint">{formatTimeAgo(a.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Watchlist + Research preview */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-4">
          <h3 className="mb-2 text-[12px] font-semibold text-fg">Watchlist ({watchlist.length})</h3>
          {watchlist.length === 0 ? (
            <p className="text-[11px] text-fg-faint">No items on watchlist.</p>
          ) : (
            <div className="space-y-1">
              {watchlist.slice(0, 3).map(w => (
                <div key={w.id} className="flex items-center justify-between text-[11px]">
                  <span className="text-fg">{w.symbol}</span>
                  <span className="font-mono text-fg-muted">{formatCurrency(getCurrentPrice(w.symbol))}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <h3 className="mb-2 text-[12px] font-semibold text-fg">Research ({research.length})</h3>
          {research.length === 0 ? (
            <p className="text-[11px] text-fg-faint">No saved research.</p>
          ) : (
            <div className="space-y-1">
              {research.slice(0, 3).map(r => (
                <div key={r.id} className="truncate text-[11px] text-fg-muted">{r.title}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function RiskRow({ label, value, warning }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-fg-faint">{label}</span>
      <span className={cn("font-mono tabular-nums", warning ? "text-amber-400" : "text-fg")}>{value}</span>
    </div>
  );
}

function DonutChart({ segments, total }: { segments: { label: string; value: number; color: string }[]; total: number }) {
  const r = 32, circ = 2 * Math.PI * r;
  // Precompute each segment's dash + offset via reduce (avoids reassigning
  // a `let` accumulator during render — React 19 immutability rule).
  const computedSegments = segments.reduce<{ label: string; dash: number; offset: number; color: string }[]>(
    (acc, s) => {
      const frac = total > 0 ? s.value / total : 0;
      const dash = frac * circ;
      const segOffset = acc.length > 0 ? acc[acc.length - 1].offset + acc[acc.length - 1].dash : 0;
      acc.push({ label: s.label, dash, offset: segOffset, color: s.color });
      return acc;
    },
    [],
  );
  return (
    <svg viewBox="0 0 100 100" className="h-[90px] w-[90px]">
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="10" />
      {computedSegments.map(s => (
        <circle key={s.label} cx="50" cy="50" r={r} fill="none" stroke={s.color} strokeWidth="10"
          strokeDasharray={`${s.dash} ${circ - s.dash}`} strokeDashoffset={-s.offset} transform="rotate(-90 50 50)" />
      ))}
      <text x="50" y="48" textAnchor="middle" className="fill-fg font-mono text-[8px] font-bold">{total > 0 ? `$${Math.round(total).toLocaleString()}` : "$0"}</text>
      <text x="50" y="56" textAnchor="middle" className="fill-fg-faint text-[5px] uppercase">Total</text>
    </svg>
  );
}

function getColorForType(type: string): string {
  const colors: Record<string, string> = {
    stock: "#3b82f6", etf: "#22c55e", crypto: "#8b5cf6", fund: "#f59e0b",
    bond: "#06b6d4", cash: "#6b7280", other: "#ec4899",
  };
  return colors[type] ?? "#6b7280";
}

/* ═══ Holdings Tab ═══ */

function HoldingsTab({ onOpenInv }: { onOpenInv: (id: string) => void }) {
  const investments = useInvestingStore((s) => s.investments);
  const transactions = useInvestingStore((s) => s.transactions);
  const dividends = useInvestingStore((s) => s.dividends);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("value");

  const holdings = useMemo(() => {
    const calcs = investments.map(inv => {
      const price = getCurrentPrice(inv.symbol);
      const txns = transactions.filter(t => t.investmentId === inv.id);
      const divs = dividends.filter(d => d.investmentId === inv.id);
      const calc = calculateHolding(inv, txns, divs, price, 1);
      return { ...calc, price };
    });
    // Aggregate totalValue via reduce (avoids reassigning a let during render).
    const totalValue = calcs.reduce((sum, c) => sum + c.currentValue, 0);
    // Recalculate allocation with correct total
    calcs.forEach(c => { c.allocation = totalValue > 0 ? (c.currentValue / totalValue) * 100 : 0; });
    return { calcs, totalValue };
  }, [investments, transactions, dividends]);

  const filtered = useMemo(() => {
    let list = holdings.calcs;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(h => h.investment.symbol.toLowerCase().includes(q) || h.investment.name.toLowerCase().includes(q));
    }
    if (filter !== "all") list = list.filter(h => h.investment.assetType === filter);
    if (sort === "value") list.sort((a, b) => b.currentValue - a.currentValue);
    else if (sort === "return") list.sort((a, b) => b.returnPct - a.returnPct);
    else if (sort === "alloc") list.sort((a, b) => b.allocation - a.allocation);
    else if (sort === "name") list.sort((a, b) => a.investment.symbol.localeCompare(b.investment.symbol));
    return list;
  }, [holdings.calcs, search, filter, sort]);

  if (investments.length === 0) {
    return <div className="py-8 text-center text-[12px] text-fg-faint">No holdings yet. Click &quot;Add Investment&quot; to start.</div>;
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-faint" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search investments..."
            className="w-full rounded-md border border-line bg-surface py-1.5 pl-7 pr-2 text-[12px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)]" />
        </div>
        <Dropdown value={filter} onChange={setFilter} options={[{ value: "all", label: "All Types" }, ...ASSET_TYPES.map(t => ({ value: t.id, label: t.label }))]} />
        <Dropdown value={sort} onChange={setSort} options={[
          { value: "value", label: "Value" }, { value: "return", label: "Return" },
          { value: "alloc", label: "Allocation" }, { value: "name", label: "Name" },
        ]} />
      </div>
      {/* Table */}
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <div className="hidden grid-cols-[1.5fr_0.8fr_0.6fr_1fr_1fr_1fr_0.6fr] gap-2 border-b border-line-muted px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-fg-faint sm:grid">
          <span>Asset</span><span>Price</span><span>Qty</span><span>Value</span><span>Invested</span><span>Return</span><span>Alloc</span>
        </div>
        {filtered.map(h => (
          <button key={h.investment.id} onClick={() => onOpenInv(h.investment.id)}
            className="grid w-full grid-cols-[1fr_auto] items-center gap-2 border-b border-line-muted/60 px-3 py-2 text-left transition-colors last:border-0 hover:bg-hover sm:grid-cols-[1.5fr_0.8fr_0.6fr_1fr_1fr_1fr_0.6fr]">
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium text-fg">{h.investment.symbol}</p>
              <p className="truncate text-[9px] text-fg-faint">{h.investment.name}</p>
            </div>
            <span className="hidden font-mono text-[11px] tabular-nums text-fg-muted sm:block">{h.price > 0 ? formatCurrency(h.price) : "—"}</span>
            <span className="hidden font-mono text-[11px] tabular-nums text-fg-muted sm:block">{h.totalQuantity}</span>
            <span className="hidden font-mono text-[11px] tabular-nums text-fg sm:block">{formatCurrency(h.currentValue)}</span>
            <span className="hidden font-mono text-[11px] tabular-nums text-fg-muted sm:block">{formatCurrency(h.totalInvested)}</span>
            <span className={cn("hidden font-mono text-[11px] tabular-nums sm:block", h.returnPct >= 0 ? "text-green-400" : "text-red-400")}>{formatPct(h.returnPct)}</span>
            <span className="hidden font-mono text-[11px] tabular-nums text-fg-muted sm:block">{h.allocation.toFixed(1)}%</span>
            {/* Mobile */}
            <div className="flex items-center gap-2 sm:hidden">
              <div className="text-right">
                <div className="font-mono text-[12px] text-fg">{formatCurrency(h.currentValue)}</div>
                <div className={cn("text-[10px]", h.returnPct >= 0 ? "text-green-400" : "text-red-400")}>{formatPct(h.returnPct)}</div>
              </div>
              <ChevronRight className="h-3 w-3 text-fg-faint" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ═══ Investment Detail ═══ */

function InvestmentDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const inv = useInvestingStore((s) => s.investments.find(i => i.id === id));
  const transactions = useInvestingStore((s) => s.transactions.filter(t => t.investmentId === id));
  const dividends = useInvestingStore((s) => s.dividends.filter(d => d.investmentId === id));
  const thesis = useInvestingStore((s) => s.theses.find(t => t.investmentId === id));
  const getThesis = useInvestingStore((s) => s.getThesis);
  const createThesis = useInvestingStore((s) => s.createThesis);
  const updateThesis = useInvestingStore((s) => s.updateThesis);
  const addTransaction = useInvestingStore((s) => s.addTransaction);
  const addDividend = useInvestingStore((s) => s.addDividend);
  const deleteInvestment = useInvestingStore((s) => s.deleteInvestment);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [addTxnOpen, setAddTxnOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Thesis review status — `now` is captured once via useState lazy init
  // (calling Date.now() directly during render violates the React 19
  // purity rule). Declared BEFORE the early return below so the hook
  // is always called (rules-of-hooks).
  const [now] = useState(() => Date.now());

  if (!inv) return <div className="py-8 text-center text-fg-faint">Investment not found</div>;

  const price = getCurrentPrice(inv.symbol);
  const calc = calculateHolding(inv, transactions, dividends, price, 1);
  const inst = getInstrumentBySymbol(inv.symbol) ?? getInstrumentBySymbol(inv.symbol + ".Daily");
  const todayChange = inst?.changePct ?? 0;

  const reviewStatus = thesis
    ? thesis.nextReviewAt < now ? "overdue" : thesis.nextReviewAt < now + 7 * 86400000 ? "soon" : "current"
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      {/* Back */}
      <button onClick={onBack} className="flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg">
        <ArrowLeft className="h-3 w-3" /> Holdings
      </button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[18px] font-bold text-fg">{inv.symbol}</h2>
          <p className="text-[12px] text-fg-muted">{inv.name}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[18px] font-bold text-fg">{price > 0 ? formatCurrency(price) : "—"}</p>
          <p className={cn("text-[11px]", todayChange >= 0 ? "text-green-400" : "text-red-400")}>{formatPct(todayChange)} today</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md border border-line bg-surface p-3">
          <div className="text-[9px] uppercase text-fg-faint">Current Value</div>
          <div className="mt-0.5 font-mono text-[16px] font-bold text-fg">{formatCurrency(calc.currentValue)}</div>
        </div>
        <div className="rounded-md border border-line bg-surface p-3">
          <div className="text-[9px] uppercase text-fg-faint">Invested</div>
          <div className="mt-0.5 font-mono text-[16px] font-bold text-fg">{formatCurrency(calc.totalInvested)}</div>
        </div>
        <div className="rounded-md border border-line bg-surface p-3">
          <div className="text-[9px] uppercase text-fg-faint">Return</div>
          <div className={cn("mt-0.5 font-mono text-[16px] font-bold", calc.returnPct >= 0 ? "text-green-400" : "text-red-400")}>
            {formatPct(calc.returnPct)}
          </div>
        </div>
      </div>

      {/* Detail tabs */}
      <div className="border-b border-line-muted">
        <div className="flex gap-1">
          {([
            ["overview", "Overview"], ["thesis", "Thesis"], ["performance", "Performance"],
            ["activity", "Activity"], ["notes", "Notes"],
          ] as [DetailTab, string][]).map(([tid, label]) => (
            <button key={tid} onClick={() => setDetailTab(tid)}
              className={cn("border-b-2 px-3 py-1.5 text-[11px] font-medium",
                detailTab === tid ? "border-[var(--accent)] text-fg" : "border-transparent text-fg-muted hover:text-fg")}>
              {label}
              {tid === "thesis" && reviewStatus === "overdue" && <span className="ml-1 text-amber-400">●</span>}
              {tid === "thesis" && reviewStatus === "soon" && <span className="ml-1 text-blue-400">●</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Detail content */}
      {detailTab === "overview" && (
        <div className="space-y-3">
          <div className="rounded-md border border-line bg-surface p-4">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
              <Row label="Quantity" value={String(calc.totalQuantity)} />
              <Row label="Average Cost" value={formatCurrency(calc.avgCost)} />
              <Row label="Realized P/L" value={formatCurrency(calc.realizedPnl)} />
              <Row label="Unrealized P/L" value={formatCurrency(calc.unrealizedPnl)} />
              <Row label="Dividends" value={formatCurrency(calc.totalDividends)} />
              <Row label="Allocation" value={`${calc.allocation.toFixed(1)}%`} />
              <Row label="Source" value={inv.source === "manual" ? "Manual" : "Connected"} />
              <Row label="Asset Type" value={inv.assetType} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setAddTxnOpen(true)}><Plus className="mr-1 h-3 w-3" /> Add Transaction</Button>
            <a href="/markets" className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[11px] text-fg-muted hover:text-fg">
              <ExternalLink className="h-3 w-3" /> Open in Markets
            </a>
            
            <Button size="sm" variant="ghost" className="text-red-400" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="mr-1 h-3 w-3" /> Remove
            </Button>
          </div>
        </div>
      )}

      {detailTab === "thesis" && (
        <ThesisPanel investmentId={id} thesis={thesis} getThesis={getThesis} createThesis={createThesis} updateThesis={updateThesis} />
      )}

      {detailTab === "performance" && (
        <div className="space-y-2">
          <div className="rounded-md border border-line bg-surface p-4">
            <h3 className="mb-2 text-[12px] font-semibold text-fg">Performance</h3>
            <div className="h-[120px]"><Sparkline data={generatePerfData(calc.currentValue, "1M")} positive={calc.returnPct >= 0} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <StatBox label="Total Return" value={formatCurrency(calc.unrealizedPnl)} sub={formatPct(calc.returnPct)} positive={calc.unrealizedPnl >= 0} />
            <StatBox label="Realized P/L" value={formatCurrency(calc.realizedPnl)} positive={calc.realizedPnl >= 0} />
          </div>
        </div>
      )}

      {detailTab === "activity" && (
        <div className="rounded-md border border-line bg-surface">
          {transactions.length === 0 ? (
            <p className="py-4 text-center text-[11px] text-fg-faint">No transactions yet.</p>
          ) : (
            <div className="divide-y divide-line-muted/60">
              {transactions.sort((a, b) => b.date - a.date).map(t => (
                <div key={t.id} className="flex items-center gap-3 px-3 py-2 text-[11px]">
                  <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-bold uppercase",
                    t.type === "buy" ? "bg-green-500/15 text-green-400" : t.type === "sell" ? "bg-red-500/15 text-red-400" : "bg-surface-2 text-fg-muted")}>
                    {t.type}
                  </span>
                  <span className="flex-1 text-fg-muted">{t.quantity} @ {formatCurrency(t.price)}</span>
                  <span className="font-mono text-fg">{formatCurrency(t.quantity * t.price)}</span>
                  <span className="text-[9px] text-fg-faint">{formatTimeAgo(t.date)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {detailTab === "notes" && <NotesPanel key={id} investmentId={id} />}

      {/* Add transaction dialog */}
      {addTxnOpen && <AddTransactionDialog investmentId={id} onClose={() => setAddTxnOpen(false)} />}

      {/* Delete confirmation */}
      {confirmDelete && (
        <Dialog open onOpenChange={() => setConfirmDelete(false)}>
          <DialogContent showCloseButton={false} className="max-w-sm">
            <DialogHeader><DialogTitle className="text-[13px]">Remove Investment?</DialogTitle></DialogHeader>
            <div className="space-y-3 p-4">
              <p className="text-[12px] text-fg-muted">This will remove {inv.symbol} and all its transactions, thesis, and dividends. This cannot be undone.</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                <Button size="sm" variant="destructive" onClick={() => { deleteInvestment(id); onBack(); toast({ title: "Investment removed" }); }}>Remove</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function ThesisPanel({ investmentId, thesis, getThesis, createThesis, updateThesis }: any) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Thesis>>(thesis ?? {});
  // Compute review status against a stable `now` captured once on mount
  // via useState lazy init (avoids the React 19 purity rule violation
  // that fires when Date.now() is called during render). Declared BEFORE
  // the conditional early returns below so the hook is always called.
  const [now] = useState(() => Date.now());

  if (!thesis) {
    return (
      <div className="rounded-md border border-line bg-surface p-4 text-center">
        <FileText className="mx-auto h-8 w-8 text-fg-faint opacity-30" />
        <p className="mt-2 text-[12px] font-medium text-fg-muted">No investment thesis yet</p>
        <p className="mt-1 text-[11px] text-fg-faint">Document why you own this investment, your risks, and exit conditions.</p>
        <Button size="sm" className="mt-3" onClick={() => { createThesis(investmentId); setEditing(true); }}>
          <Plus className="mr-1 h-3 w-3" /> Create Thesis
        </Button>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="space-y-3 rounded-md border border-line bg-surface p-4">
        <h3 className="text-[12px] font-semibold text-fg">Investment Thesis</h3>
        <div><Label className="text-[11px] text-fg-muted">Why I Own This</Label><Textarea value={draft.reason ?? ""} onChange={e => setDraft({ ...draft, reason: e.target.value })} rows={3} className="mt-1 text-[12px]" /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label className="text-[11px] text-fg-muted">Investment Horizon</Label><Input value={draft.horizon ?? ""} onChange={e => setDraft({ ...draft, horizon: e.target.value })} className="mt-1 text-[12px]" /></div>
          <div><Label className="text-[11px] text-fg-muted">Target Price</Label><Input type="number" value={draft.targetPrice ?? ""} onChange={e => setDraft({ ...draft, targetPrice: Number(e.target.value) })} className="mt-1 text-[12px]" /></div>
        </div>
        <div><Label className="text-[11px] text-fg-muted">Risks</Label><Textarea value={draft.risks ?? ""} onChange={e => setDraft({ ...draft, risks: e.target.value })} rows={2} className="mt-1 text-[12px]" /></div>
        <div><Label className="text-[11px] text-fg-muted">Exit / Reassessment Conditions</Label><Textarea value={draft.reassessmentConditions ?? ""} onChange={e => setDraft({ ...draft, reassessmentConditions: e.target.value })} rows={2} className="mt-1 text-[12px]" /></div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setDraft(thesis); }}>Cancel</Button>
          <Button size="sm" onClick={() => { updateThesis(investmentId, draft); setEditing(false); toast({ title: "Thesis saved" }); }}>Save Thesis</Button>
        </div>
      </div>
    );
  }

  const reviewStatus = thesis.nextReviewAt < now ? "Overdue" : thesis.nextReviewAt < now + 7 * 86400000 ? "Review Soon" : "Current";

  return (
    <div className="space-y-3 rounded-md border border-line bg-surface p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[12px] font-semibold text-fg">Investment Thesis</h3>
        <Button size="sm" variant="ghost" onClick={() => { setDraft(thesis); setEditing(true); }}>Edit</Button>
      </div>
      {thesis.reason && <div><div className="text-[9px] uppercase text-fg-faint">Why I Own This</div><p className="mt-0.5 text-[12px] text-fg">{thesis.reason}</p></div>}
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <Row label="Horizon" value={thesis.horizon} />
        <Row label="Confidence" value={thesis.confidence} />
        <Row label="Target Price" value={thesis.targetPrice > 0 ? formatCurrency(thesis.targetPrice) : "—"} />
        <Row label="Review Status" value={reviewStatus} />
      </div>
      {thesis.risks && <div><div className="text-[9px] uppercase text-fg-faint">Risks</div><p className="mt-0.5 text-[12px] text-fg-muted">{thesis.risks}</p></div>}
      {thesis.reassessmentConditions && <div><div className="text-[9px] uppercase text-fg-faint">Exit / Reassessment</div><p className="mt-0.5 text-[12px] text-fg-muted">{thesis.reassessmentConditions}</p></div>}
      <div className="flex items-center gap-4 text-[10px] text-fg-faint">
        <span>Created: {new Date(thesis.createdAt).toLocaleDateString()}</span>
        <span>Reviewed: {new Date(thesis.lastReviewedAt).toLocaleDateString()}</span>
        <span>Next: {new Date(thesis.nextReviewAt).toLocaleDateString()}</span>
      </div>
      <Button size="sm" variant="outline" onClick={() => { updateThesis(investmentId, { lastReviewedAt: Date.now(), nextReviewAt: Date.now() + 90 * 86400000 }); toast({ title: "Thesis reviewed", description: "Next review in 90 days" }); }}>
        <Clock className="mr-1 h-3 w-3" /> Mark as Reviewed
      </Button>
    </div>
  );
}

function NotesPanel({ investmentId }: { investmentId: string }) {
  const STORAGE_KEY = `lucian-investing-notes-${investmentId}`;
  // Hydrate persisted notes via lazy useState initializer (avoids
  // React 19 set-state-in-effect rule).
  const [notes, setNotes] = useState(() => {
    try { return localStorage.getItem(`lucian-investing-notes-${investmentId}`) ?? ""; } catch { return ""; }
  });

  const handleSave = (text: string) => {
    setNotes(text);
    try { localStorage.setItem(STORAGE_KEY, text); } catch { /* ignore */ }
  };

  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <h3 className="mb-2 text-[12px] font-semibold text-fg">Investment Notes</h3>
      <Textarea value={notes} onChange={e => handleSave(e.target.value)} rows={6} placeholder="Write your investment notes..." className="text-[12px]" />
      <p className="mt-1 text-[10px] text-fg-faint">Notes auto-save to your browser.</p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div><span className="text-[9px] uppercase text-fg-faint">{label}</span><div className="capitalize text-fg">{value}</div></div>;
}

/* ═══ Watchlist Tab ═══ */

function WatchlistTab() {
  const watchlist = useInvestingStore((s) => s.watchlist);
  const addToWatchlist = useInvestingStore((s) => s.addToWatchlist);
  const removeFromWatchlist = useInvestingStore((s) => s.removeFromWatchlist);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 flex justify-end">
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}><Plus className="mr-1 h-3 w-3" /> Add to Watchlist</Button>
      </div>
      {watchlist.length === 0 ? (
        <div className="py-8 text-center text-[12px] text-fg-faint">No items on watchlist.</div>
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-surface">
          <div className="hidden grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] gap-2 border-b border-line-muted px-3 py-1.5 text-[9px] font-semibold uppercase text-fg-faint sm:grid">
            <span>Asset</span><span>Price</span><span>Today</span><span>Target Entry</span><span>Notes</span><span></span>
          </div>
          {watchlist.map(w => {
            const price = getCurrentPrice(w.symbol);
            const inst = getInstrumentBySymbol(w.symbol) ?? getInstrumentBySymbol(w.symbol + ".Daily");
            const change = inst?.changePct ?? 0;
            return (
              <div key={w.id} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-line-muted/60 px-3 py-2 text-[11px] last:border-0 sm:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]">
                <div><p className="font-medium text-fg">{w.symbol}</p><p className="text-[9px] text-fg-faint">{w.name}</p></div>
                <span className="hidden font-mono text-fg-muted sm:block">{price > 0 ? formatCurrency(price) : "—"}</span>
                <span className={cn("hidden font-mono sm:block", change >= 0 ? "text-green-400" : "text-red-400")}>{formatPct(change)}</span>
                <span className="hidden font-mono text-fg-muted sm:block">{w.targetEntry > 0 ? formatCurrency(w.targetEntry) : "—"}</span>
                <span className="hidden truncate text-fg-faint sm:block">{w.notes || "—"}</span>
                <div className="flex items-center gap-1">
                  <a href="/markets" className="rounded p-1 text-fg-faint hover:text-fg" title="Open in Markets"><ExternalLink className="h-3 w-3" /></a>
                  <button type="button" aria-label={`Remove ${w.symbol} from watchlist`} onClick={() => removeFromWatchlist(w.id)} className="rounded p-1 text-fg-faint hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {addOpen && <AddWatchlistDialog onClose={() => setAddOpen(false)} />}
    </div>
  );
}

/* ═══ Activity Tab ═══ */

function ActivityTab() {
  const activities = useInvestingStore((s) => s.activities);
  if (activities.length === 0) return <div className="py-8 text-center text-[12px] text-fg-faint">No activity yet.</div>;
  return (
    <div className="mx-auto max-w-3xl">
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <div className="divide-y divide-line-muted/60">
          {activities.map(a => (
            <div key={a.id} className="flex items-center gap-3 px-3 py-2 text-[11px]">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
              <span className="flex-1 truncate text-fg-muted">{a.message}</span>
              <span className="shrink-0 text-[9px] text-fg-faint">{formatTimeAgo(a.createdAt)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══ Research Tab ═══ */

function ResearchTab() {
  const research = useInvestingStore((s) => s.research);
  const addResearch = useInvestingStore((s) => s.addResearch);
  const removeResearch = useInvestingStore((s) => s.removeResearch);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 flex flex-wrap justify-end gap-2">
        
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}><Plus className="mr-1 h-3 w-3" /> Add Research</Button>
      </div>
      {research.length === 0 ? (
        <div className="py-8 text-center text-[12px] text-fg-faint">No saved research yet.</div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {research.map(r => (
            <div key={r.id} className="rounded-md border border-line bg-surface p-3">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium text-fg">{r.title}</p>
                  <p className="text-[9px] text-[var(--accent)]">{r.type}</p>
                </div>
                <button type="button" aria-label={`Remove research: ${r.title}`} onClick={() => removeResearch(r.id)} className="text-fg-faint hover:text-red-400"><X className="h-3 w-3" /></button>
              </div>
              {r.notes && <p className="mt-1 line-clamp-2 text-[10px] text-fg-muted">{r.notes}</p>}
              {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-1 text-[10px] text-[var(--accent)] hover:underline"><ExternalLink className="h-2.5 w-2.5" /> {r.source || "Source"}</a>}
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[9px] text-fg-faint">{formatTimeAgo(r.savedAt)}</span>
                
              </div>
            </div>
          ))}
        </div>
      )}
      {addOpen && <AddResearchDialog onClose={() => setAddOpen(false)} />}
    </div>
  );
}

/* ═══ Dialogs ═══ */

function AddInvestmentDialog({ onClose }: { onClose: () => void }) {
  const addInvestment = useInvestingStore((s) => s.addInvestment);
  const addTransaction = useInvestingStore((s) => s.addTransaction);
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("stock");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [fees, setFees] = useState("0");

  const handleAdd = () => {
    if (!symbol.trim()) return;
    const invId = addInvestment({ symbol: symbol.trim().toUpperCase(), name: name.trim() || symbol.trim(), assetType });
    if (quantity && price) {
      addTransaction({
        investmentId: invId, type: "buy", quantity: parseFloat(quantity),
        price: parseFloat(price), fees: parseFloat(fees) || 0,
        date: new Date(date).getTime(), notes: "",
      });
    }
    toast({ title: "Investment added", description: symbol.trim().toUpperCase() });
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent showCloseButton={false} className="max-w-md">
        <DialogHeader className="flex-row items-center justify-between border-b border-line-muted px-4 py-2.5">
          <DialogTitle className="text-[13px]">Add Investment</DialogTitle>
          <button type="button" aria-label="Close add investment dialog" onClick={onClose} className="text-fg-muted hover:text-fg"><X className="h-4 w-4" /></button>
        </DialogHeader>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-[11px] text-fg-muted">Symbol</Label><Input value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="AAPL" className="mt-1 text-[12px]" autoFocus /></div>
            <div><Label className="text-[11px] text-fg-muted">Name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Apple Inc." className="mt-1 text-[12px]" /></div>
          </div>
          <div><Label className="text-[11px] text-fg-muted">Investment type</Label>
            <div className="mt-1 flex gap-1 flex-wrap">
              {ASSET_TYPES.map(t => <button key={t.id} onClick={() => setAssetType(t.id)} className={cn("rounded px-2 py-0.5 text-[10px]", assetType === t.id ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "bg-surface-2 text-fg-muted hover:text-fg")}>{t.label}</button>)}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label className="text-[11px] text-fg-muted">Quantity</Label><Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="100" className="mt-1 text-[12px]" /></div>
            <div><Label className="text-[11px] text-fg-muted">Price</Label><Input type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="$214.00" className="mt-1 text-[12px]" /></div>
            <div><Label className="text-[11px] text-fg-muted">Fees</Label><Input type="number" value={fees} onChange={e => setFees(e.target.value)} className="mt-1 text-[12px]" /></div>
          </div>
          <div><Label className="text-[11px] text-fg-muted">Purchase date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} className="mt-1 text-[12px]" /></div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={!symbol.trim()} onClick={handleAdd}>Add Investment</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddTransactionDialog({ investmentId, onClose }: { investmentId: string; onClose: () => void }) {
  const addTransaction = useInvestingStore((s) => s.addTransaction);
  const addDividend = useInvestingStore((s) => s.addDividend);
  const [type, setType] = useState<TransactionType>("buy");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fees, setFees] = useState("0");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  const handleAdd = () => {
    if (type === "dividend") {
      addDividend({ investmentId, amount: parseFloat(price) || 0, date: new Date(date).getTime(), type: "dividend" });
      addTransaction({ investmentId, type: "dividend", quantity: 0, price: parseFloat(price) || 0, fees: 0, date: new Date(date).getTime(), notes });
    } else {
      addTransaction({ investmentId, type, quantity: parseFloat(quantity) || 0, price: parseFloat(price) || 0, fees: parseFloat(fees) || 0, date: new Date(date).getTime(), notes });
    }
    toast({ title: "Transaction added" });
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader className="flex-row items-center justify-between border-b border-line-muted px-4 py-2.5">
          <DialogTitle className="text-[13px]">Add Transaction</DialogTitle>
          <button type="button" aria-label="Close add transaction dialog" onClick={onClose} className="text-fg-muted hover:text-fg"><X className="h-4 w-4" /></button>
        </DialogHeader>
        <div className="space-y-3 p-4">
          <div className="flex gap-1 flex-wrap">
            {(["buy", "sell", "dividend", "fee"] as TransactionType[]).map(t => (
              <button key={t} onClick={() => setType(t)} className={cn("rounded px-2 py-0.5 text-[10px] capitalize", type === t ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "bg-surface-2 text-fg-muted")}>{t}</button>
            ))}
          </div>
          {type !== "dividend" && <div><Label className="text-[11px] text-fg-muted">Quantity</Label><Input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} className="mt-1 text-[12px]" /></div>}
          <div><Label className="text-[11px] text-fg-muted">{type === "dividend" ? "Amount" : "Price"}</Label><Input type="number" value={price} onChange={e => setPrice(e.target.value)} className="mt-1 text-[12px]" /></div>
          {type !== "dividend" && <div><Label className="text-[11px] text-fg-muted">Fees</Label><Input type="number" value={fees} onChange={e => setFees(e.target.value)} className="mt-1 text-[12px]" /></div>}
          <div><Label className="text-[11px] text-fg-muted">Date</Label><Input type="date" value={date} onChange={e => setDate(e.target.value)} className="mt-1 text-[12px]" /></div>
          <div><Label className="text-[11px] text-fg-muted">Notes</Label><Input value={notes} onChange={e => setNotes(e.target.value)} className="mt-1 text-[12px]" /></div>
          <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" onClick={handleAdd}>Add</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddWatchlistDialog({ onClose }: { onClose: () => void }) {
  const addToWatchlist = useInvestingStore((s) => s.addToWatchlist);
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("stock");
  const [targetEntry, setTargetEntry] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader className="flex-row items-center justify-between border-b border-line-muted px-4 py-2.5">
          <DialogTitle className="text-[13px]">Add to Watchlist</DialogTitle>
          <button type="button" aria-label="Close watchlist dialog" onClick={onClose} className="text-fg-muted hover:text-fg"><X className="h-4 w-4" /></button>
        </DialogHeader>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-[11px] text-fg-muted">Symbol</Label><Input value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="MSFT" className="mt-1 text-[12px]" autoFocus /></div>
            <div><Label className="text-[11px] text-fg-muted">Name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Microsoft" className="mt-1 text-[12px]" /></div>
          </div>
          <div className="flex gap-1 flex-wrap">
            {ASSET_TYPES.map(t => <button key={t.id} onClick={() => setAssetType(t.id)} className={cn("rounded px-2 py-0.5 text-[10px]", assetType === t.id ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "bg-surface-2 text-fg-muted")}>{t.label}</button>)}
          </div>
          <div><Label className="text-[11px] text-fg-muted">Target entry price</Label><Input type="number" value={targetEntry} onChange={e => setTargetEntry(e.target.value)} placeholder="$450" className="mt-1 text-[12px]" /></div>
          <div><Label className="text-[11px] text-fg-muted">Notes</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="mt-1 text-[12px]" /></div>
          <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={!symbol.trim()} onClick={() => { addToWatchlist({ symbol: symbol.trim().toUpperCase(), name, assetType, targetEntry: parseFloat(targetEntry) || 0, notes }); toast({ title: "Added to watchlist" }); onClose(); }}>Add</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddResearchDialog({ onClose }: { onClose: () => void }) {
  const addResearch = useInvestingStore((s) => s.addResearch);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("article");
  const [source, setSource] = useState("");
  const [url, setUrl] = useState("");
  const [symbol, setSymbol] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader className="flex-row items-center justify-between border-b border-line-muted px-4 py-2.5">
          <DialogTitle className="text-[13px]">Add Research</DialogTitle>
          <button type="button" aria-label="Close research dialog" onClick={onClose} className="text-fg-muted hover:text-fg"><X className="h-4 w-4" /></button>
        </DialogHeader>
        <div className="space-y-3 p-4">
          <div><Label className="text-[11px] text-fg-muted">Title</Label><Input value={title} onChange={e => setTitle(e.target.value)} className="mt-1 text-[12px]" autoFocus /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-[11px] text-fg-muted">Type</Label><Input value={type} onChange={e => setType(e.target.value)} className="mt-1 text-[12px]" /></div>
            <div><Label className="text-[11px] text-fg-muted">Symbol</Label><Input value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="AAPL" className="mt-1 text-[12px]" /></div>
          </div>
          <div><Label className="text-[11px] text-fg-muted">Source</Label><Input value={source} onChange={e => setSource(e.target.value)} className="mt-1 text-[12px]" /></div>
          <div><Label className="text-[11px] text-fg-muted">URL</Label><Input value={url} onChange={e => setUrl(e.target.value)} className="mt-1 text-[12px]" /></div>
          <div><Label className="text-[11px] text-fg-muted">Notes</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="mt-1 text-[12px]" /></div>
          <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button><Button size="sm" disabled={!title.trim()} onClick={() => { addResearch({ title, type, source, url, symbol, notes }); toast({ title: "Research saved" }); onClose(); }}>Save</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ═══ Shared ═══ */

function Dropdown({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const id = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => { clearTimeout(id); document.removeEventListener("mousedown", handler); };
  }, [open]);
  const selected = options.find(o => o.value === value);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)} className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5 text-[11px] text-fg-muted hover:text-fg">
        {selected?.label ?? "Select..."} <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 max-h-[240px] overflow-y-auto rounded-md border border-line bg-overlay shadow-pop">
          {options.map(o => <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }} className={cn("flex w-full items-center px-3 py-1.5 text-left text-[11px]", o.value === value ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg")}>{o.label}</button>)}
        </div>
      )}
    </div>
  );
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 86400000 * 2) return "yesterday";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
