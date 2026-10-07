"use client";

/* LUCIAN Investing — portfolio management state.
 *
 * Separate from Markets (short-term trading) and Vault (cash/accounts).
 * Investing tracks long-term holdings, investment thesis, watchlist,
 * activity history, research, and dividends.
 *
 * All data persists to localStorage via zustand persist.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { syncSavedItem, deleteSavedItemByRef } from "@/lib/auth/live-sync";

export type AssetType = "stock" | "etf" | "crypto" | "fund" | "bond" | "cash" | "other";
export type PositionSource = "manual" | "connected";

export type TransactionType = "buy" | "sell" | "dividend" | "fee" | "adjustment";

export interface Transaction {
  id: string;
  investmentId: string;
  type: TransactionType;
  quantity: number;
  price: number;
  fees: number;
  date: number;
  notes: string;
}

export interface Thesis {
  investmentId: string;
  reason: string;
  horizon: string;
  confidence: "low" | "medium" | "high";
  targetPrice: number;
  risks: string;
  reassessmentConditions: string;
  createdAt: number;
  lastReviewedAt: number;
  nextReviewAt: number;
}

export interface Investment {
  id: string;
  portfolioId: string;
  symbol: string;
  name: string;
  assetType: AssetType;
  source: PositionSource;
  sector?: string;
  createdAt: number;
  updatedAt: number;
}

export interface WatchlistItem {
  id: string;
  symbol: string;
  name: string;
  assetType: AssetType;
  targetEntry: number;
  notes: string;
  createdAt: number;
}

export interface ResearchItem {
  id: string;
  title: string;
  type: string;
  source: string;
  url: string;
  symbol: string;
  notes: string;
  savedAt: number;
}

export interface DividendRecord {
  id: string;
  investmentId: string;
  amount: number;
  date: number;
  type: string;
}

export interface Portfolio {
  id: string;
  name: string;
  baseCurrency: string;
  createdAt: number;
}

export type ActivityType =
  | "buy" | "sell" | "dividend" | "fee"
  | "thesis-update" | "watchlist-add" | "watchlist-remove"
  | "research-saved" | "adjustment";

export interface InvestingActivity {
  id: string;
  type: ActivityType;
  entityId: string;
  entityName: string;
  message: string;
  createdAt: number;
}

interface InvestingState {
  portfolios: Portfolio[];
  investments: Investment[];
  transactions: Transaction[];
  theses: Thesis[];
  watchlist: WatchlistItem[];
  research: ResearchItem[];
  dividends: DividendRecord[];
  activities: InvestingActivity[];
  activePortfolioId: string;

  // Portfolio
  setActivePortfolio: (id: string) => void;

  // Investments
  addInvestment: (data: Partial<Investment>) => string;
  deleteInvestment: (id: string) => void;

  // Transactions
  addTransaction: (data: Omit<Transaction, "id">) => void;
  getTransactions: (investmentId: string) => Transaction[];

  // Thesis
  getThesis: (investmentId: string) => Thesis | undefined;
  updateThesis: (investmentId: string, patch: Partial<Thesis>) => void;
  createThesis: (investmentId: string) => void;

  // Watchlist
  addToWatchlist: (data: Partial<WatchlistItem>) => void;
  removeFromWatchlist: (id: string) => void;

  // Research
  addResearch: (data: Partial<ResearchItem>) => void;
  removeResearch: (id: string) => void;

  // Dividends
  addDividend: (data: Partial<DividendRecord>) => void;

  // Derived
  getInvestmentById: (id: string) => Investment | undefined;
  getPortfolioInvestments: (portfolioId: string) => Investment[];
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function addActivity(
  set: (fn: (s: InvestingState) => Partial<InvestingState>) => void,
  type: ActivityType,
  entityId: string,
  entityName: string,
  message: string,
) {
  set((s) => ({
    activities: [
      { id: genId("act"), type, entityId, entityName, message, createdAt: Date.now() },
      ...s.activities,
    ].slice(0, 100),
  }));
}

export const useInvestingStore = create<InvestingState>()(
  persist(
    (set, get) => ({
      portfolios: [
        { id: "main", name: "Main Portfolio", baseCurrency: "USD", createdAt: Date.now() },
      ],
      investments: [],
      transactions: [],
      theses: [],
      watchlist: [],
      research: [],
      dividends: [],
      activities: [],
      activePortfolioId: "main",

      setActivePortfolio: (id) => set({ activePortfolioId: id }),

      addInvestment: (data) => {
        const id = genId("inv");
        const inv: Investment = {
          id,
          portfolioId: data.portfolioId ?? get().activePortfolioId,
          symbol: data.symbol || "UNKNOWN",
          name: data.name || data.symbol || "Unknown",
          assetType: data.assetType || "other",
          source: data.source || "manual",
          sector: data.sector,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({ investments: [...s.investments, inv] }));
        addActivity(set, "buy", id, inv.symbol, `Investment added: ${inv.symbol}`);
        return id;
      },

      deleteInvestment: (id) => {
        set((s) => ({
          investments: s.investments.filter((i) => i.id !== id),
          transactions: s.transactions.filter((t) => t.investmentId !== id),
          theses: s.theses.filter((t) => t.investmentId !== id),
          dividends: s.dividends.filter((d) => d.investmentId !== id),
        }));
      },

      addTransaction: (data) => {
        const tx: Transaction = { ...data, id: genId("tx") };
        set((s) => ({ transactions: [...s.transactions, tx] }));
        const inv = get().investments.find((i) => i.id === data.investmentId);
        const entityName = inv?.symbol ?? "Unknown";
        const messages: Record<TransactionType, string> = {
          buy: `Bought ${data.quantity} ${entityName} @ $${data.price}`,
          sell: `Sold ${data.quantity} ${entityName} @ $${data.price}`,
          dividend: `Dividend received: ${entityName} +$${data.price}`,
          fee: `Fee recorded: ${entityName} $${data.price}`,
          adjustment: `Adjustment: ${entityName}`,
        };
        addActivity(set, data.type as ActivityType, data.investmentId, entityName, messages[data.type]);
      },

      getTransactions: (investmentId) =>
        get().transactions
          .filter((t) => t.investmentId === investmentId)
          .sort((a, b) => b.date - a.date),

      getThesis: (investmentId) =>
        get().theses.find((t) => t.investmentId === investmentId),

      updateThesis: (investmentId, patch) => {
        set((s) => ({
          theses: s.theses.map((t) =>
            t.investmentId === investmentId
              ? { ...t, ...patch, lastReviewedAt: Date.now() }
              : t,
          ),
        }));
        const inv = get().investments.find((i) => i.id === investmentId);
        addActivity(set, "thesis-update", investmentId, inv?.symbol ?? "Unknown", `Thesis updated: ${inv?.symbol}`);
        // Phase 17: live server-sync of thesis metadata (best-effort).
        // refId is the investmentId so updates upsert the same row.
        const updated = get().theses.find((t) => t.investmentId === investmentId);
        if (updated) {
          void syncSavedItem({
            source: "investing",
            type: "thesis",
            refId: investmentId,
            title: `Thesis: ${inv?.symbol ?? investmentId}`,
            data: { ...updated },
          }).catch(() => { /* non-fatal */ });
        }
      },

      createThesis: (investmentId) => {
        if (get().theses.some((t) => t.investmentId === investmentId)) return;
        const now = Date.now();
        const ninetyDays = 90 * 86400000;
        const thesis: Thesis = {
          investmentId,
          reason: "",
          horizon: "Long Term · 3–5 years",
          confidence: "medium",
          targetPrice: 0,
          risks: "",
          reassessmentConditions: "",
          createdAt: now,
          lastReviewedAt: now,
          nextReviewAt: now + ninetyDays,
        };
        set((s) => ({ theses: [...s.theses, thesis] }));
        // Phase 17: live server-sync (best-effort).
        const inv = get().investments.find((i) => i.id === investmentId);
        void syncSavedItem({
          source: "investing",
          type: "thesis",
          refId: investmentId,
          title: `Thesis: ${inv?.symbol ?? investmentId}`,
          data: { ...thesis },
        }).catch(() => { /* non-fatal */ });
      },

      addToWatchlist: (data) => {
        const item: WatchlistItem = {
          id: genId("wl"),
          symbol: data.symbol || "",
          name: data.name || data.symbol || "",
          assetType: data.assetType || "other",
          targetEntry: data.targetEntry ?? 0,
          notes: data.notes || "",
          createdAt: Date.now(),
        };
        set((s) => ({ watchlist: [...s.watchlist, item] }));
        addActivity(set, "watchlist-add", item.id, item.symbol, `Added to watchlist: ${item.symbol}`);
        // Phase 17: live server-sync (best-effort, non-blocking).
        void syncSavedItem({
          source: "investing",
          type: "watchlist",
          refId: item.id,
          title: item.symbol || item.name,
          data: { ...item },
        }).catch(() => { /* non-fatal — local already succeeded */ });
      },

      removeFromWatchlist: (id) => {
        const item = get().watchlist.find((w) => w.id === id);
        set((s) => ({ watchlist: s.watchlist.filter((w) => w.id !== id) }));
        if (item) addActivity(set, "watchlist-remove", id, item.symbol, `Removed from watchlist: ${item.symbol}`);
        void deleteSavedItemByRef({ source: "investing", refId: id }).catch(() => { /* non-fatal */ });
      },

      addResearch: (data) => {
        const item: ResearchItem = {
          id: genId("res"),
          title: data.title || "Untitled",
          type: data.type || "article",
          source: data.source || "",
          url: data.url || "",
          symbol: data.symbol || "",
          notes: data.notes || "",
          savedAt: Date.now(),
        };
        set((s) => ({ research: [item, ...s.research] }));
        addActivity(set, "research-saved", item.id, item.title, `Research saved: ${item.title}`);
        // Phase 17: live server-sync (best-effort, non-blocking).
        void syncSavedItem({
          source: "investing",
          type: "research",
          refId: item.id,
          title: item.title,
          data: { ...item },
        }).catch(() => { /* non-fatal — local already succeeded */ });
      },

      removeResearch: (id) => {
        set((s) => ({ research: s.research.filter((r) => r.id !== id) }));
        void deleteSavedItemByRef({ source: "investing", refId: id }).catch(() => { /* non-fatal */ });
      },

      addDividend: (data) => {
        const div: DividendRecord = {
          id: genId("div"),
          investmentId: data.investmentId || "",
          amount: data.amount ?? 0,
          date: data.date ?? Date.now(),
          type: data.type || "dividend",
        };
        set((s) => ({ dividends: [...s.dividends, div] }));
      },

      getInvestmentById: (id) => get().investments.find((i) => i.id === id),

      getPortfolioInvestments: (portfolioId) =>
        get().investments.filter((i) => i.portfolioId === portfolioId),
    }),
    {
      name: "lucian-investing",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
        return localStorage;
      }),
    },
  ),
);

/* ── Portfolio calculation helpers ── */

export interface HoldingCalc {
  investment: Investment;
  totalQuantity: number;
  avgCost: number;
  totalInvested: number;
  currentValue: number;
  unrealizedPnl: number;
  returnPct: number;
  allocation: number;
  realizedPnl: number;
  totalDividends: number;
}

/** Calculate holding metrics from transactions + catalog prices. */
export function calculateHolding(
  investment: Investment,
  transactions: Transaction[],
  dividends: DividendRecord[],
  currentPrice: number,
  totalPortfolioValue: number,
): HoldingCalc {
  const buys = transactions.filter((t) => t.type === "buy");
  const sells = transactions.filter((t) => t.type === "sell");
  const fees = transactions.filter((t) => t.type === "fee");
  const divs = dividends.filter((d) => d.investmentId === investment.id);

  // Total bought
  const totalBoughtQty = buys.reduce((s, t) => s + t.quantity, 0);
  const totalBoughtCost = buys.reduce((s, t) => s + t.quantity * t.price + t.fees, 0);

  // Total sold
  const totalSoldQty = sells.reduce((s, t) => s + t.quantity, 0);
  const totalSoldValue = sells.reduce((s, t) => s + t.quantity * t.price - t.fees, 0);

  // Remaining
  const totalQuantity = totalBoughtQty - totalSoldQty;
  const remainingCostBasis = totalQuantity > 0 && totalBoughtQty > 0
    ? (totalBoughtCost / totalBoughtQty) * totalQuantity
    : 0;

  // Average cost
  const avgCost = totalBoughtQty > 0 ? totalBoughtCost / totalBoughtQty : 0;

  // Current value
  const currentValue = totalQuantity * currentPrice;

  // Unrealized P/L
  const unrealizedPnl = currentValue - remainingCostBasis;

  // Return %
  const returnPct = remainingCostBasis > 0 ? (unrealizedPnl / remainingCostBasis) * 100 : 0;

  // Realized P/L (simplified: sold value - proportional cost)
  const costRatio = totalBoughtQty > 0 ? totalBoughtCost / totalBoughtQty : 0;
  const realizedPnl = totalSoldValue - totalSoldQty * costRatio;

  // Total fees
  const totalFees = fees.reduce((s, t) => s + t.fees, 0);

  // Dividends
  const totalDividends = divs.reduce((s, d) => s + d.amount, 0);

  // Total invested (net of sells)
  const totalInvested = remainingCostBasis;

  // Allocation
  const allocation = totalPortfolioValue > 0 ? (currentValue / totalPortfolioValue) * 100 : 0;

  return {
    investment,
    totalQuantity,
    avgCost,
    totalInvested,
    currentValue,
    unrealizedPnl,
    returnPct,
    allocation,
    realizedPnl: realizedPnl - totalFees,
    totalDividends,
  };
}

/** Get current price for a symbol from the catalog. */
export function getCurrentPrice(symbol: string): number {
  // Lazy-load catalog to avoid circular imports.
  const { INSTRUMENT_CATALOG } = require("@/lib/markets/catalog");
  const inst = INSTRUMENT_CATALOG.find(
    (i: { symbol: string }) => i.symbol === symbol || i.symbol === symbol + ".Daily",
  );
  if (inst) return (inst.bid + inst.ask) / 2;
  // Fallback: try with .Daily suffix
  const instDaily = INSTRUMENT_CATALOG.find(
    (i: { symbol: string }) => i.symbol === symbol + ".Daily",
  );
  if (instDaily) return (instDaily.bid + instDaily.ask) / 2;
  return 0;
}

/** Format currency. */
export function formatCurrency(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Format percentage. */
export function formatPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}
