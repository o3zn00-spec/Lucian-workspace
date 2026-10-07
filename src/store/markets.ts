"use client";

// LUCIAN Market Terminal — state management.
//
// ONE source of truth for live market data on the Markets page.
//
//   BybitProvider (crypto only)
//        ↓ subscribePrice / subscribeKline / getCandles / getTicker
//   useMarketsStore
//        ↓ prices | tickers | candlesByPaneKey | statusBySymbol
//   ┌────────────┬────────────┬──────────────┬─────────────┐
//   Instruments  Chart        OrderDetails   Intelligence
//   Panel         Workspace    Panel          Panel
//
// Non-crypto (forex / metals / indices / stocks / energies) has no live
// provider configured. Their DataStatus is `setup-required` and the UI
// shows "REFERENCE" snapshot prices from the catalog. The catalog snapshot
// is also used as a fallback display value before the first live tick
// arrives for a crypto symbol.

import { create } from "zustand";
import type {
  AccountState,
  Candle,
  ClosedPosition,
  DataStatus,
  Instrument,
  OperationHistoryEntry,
  PendingOrder,
  Position,
  PriceUpdate,
  RiskRules,
  Ticker,
  Timeframe,
} from "@/lib/markets/types";
import { loadRiskRules, saveRiskRules, DEFAULT_RISK_RULES } from "@/lib/markets/risk-engine";
import {
  getAccountState,
  getOpenPositions,
  getClosedPositions,
  getPendingOrders,
  getOperationHistory,
  openPosition,
  placePendingOrder,
  closePositionsByIds,
  syncPaperAccountFromCloud,
  cancelPendingOrder,
  updateUnrealizedPnl,
  evaluatePendingTriggers,
} from "@/lib/markets/paper-trading";
import { registerProvider, getProvider } from "@/lib/markets/provider";
import { BybitProvider } from "@/lib/markets/bybit-provider";
import type { OrderSide } from "@/lib/markets/types";
import { getInstrumentBySymbol } from "@/lib/markets/catalog";
import {
  isSupportedCrypto,
  toBybitSymbol,
} from "@/lib/markets/symbol-mapping";

// Phase 3: the legacy `lucian-markets-watchlist` store field has been
// removed. The canonical favorites system is the `useFavorites` hook
// (`@/hooks/use-favorites.ts`) backed by `localStorage["lucian-markets-favorites"]`.
// If a user has an old `lucian-markets-watchlist` value, we migrate it
// into the canonical favorites set on first load below.
const LEGACY_WATCHLIST_KEY = "lucian-markets-watchlist";
const FAVORITES_KEY = "lucian-markets-favorites";

function migrateLegacyWatchlistToFavorites(): void {
  if (typeof window === "undefined") return;
  try {
    const legacy = localStorage.getItem(LEGACY_WATCHLIST_KEY);
    if (!legacy) return;
    const parsed = JSON.parse(legacy) as Array<{ symbol?: string }>;
    const symbols = parsed
      .map((w) => w?.symbol)
      .filter((s): s is string => typeof s === "string" && s.length > 0);
    if (symbols.length === 0) {
      localStorage.removeItem(LEGACY_WATCHLIST_KEY);
      return;
    }
    // Merge into the existing favorites set.
    const existingRaw = localStorage.getItem(FAVORITES_KEY);
    const existing: string[] = existingRaw ? JSON.parse(existingRaw) : [];
    const merged = Array.from(new Set([...existing, ...symbols]));
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(merged));
    // Remove the legacy key so we don't re-migrate on next load.
    localStorage.removeItem(LEGACY_WATCHLIST_KEY);
  } catch {
    // ignore — migration is best-effort
  }
}

// Run the migration once on module load (client-side only).
if (typeof window !== "undefined") {
  migrateLegacyWatchlistToFavorites();
}

/**
 * Pane subscription key — `${lucianSymbol}|${lucianTimeframe}`. Used as the map
 * key for cached candles and as the dedupe key for WebSocket subscriptions.
 */
export function paneKey(symbol: string, timeframe: LucianTimeframe | Timeframe): string {
  return `${symbol}|${timeframe}`;
}

/**
 * The LUCIAN-side timeframe type used by the chart pane UI. The store
 * accepts this string format ("M1", "M5", …, "W") and internally converts
 * to the provider's `Timeframe` enum ("1m", "5m", …, "1w").
 */
export type LucianTimeframe =
  | "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1" | "W";

const LUCIAN_TF_TO_PROVIDER: Record<LucianTimeframe, Timeframe> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  M30: "30m",
  H1: "1h",
  H4: "4h",
  D1: "1d",
  W: "1w",
};

interface ActiveContextSnapshot {
  symbol: string;
  timeframe: LucianTimeframe;
  /** Live bid (best bid from ticker or last trade). Falls back to catalog bid. */
  bid: number;
  /** Live ask (best ask from ticker or last trade). Falls back to catalog ask. */
  ask: number;
  /** Live 24h change percent. null when unknown. */
  changePct: number | null;
  /** Current data status for the symbol. */
  status: DataStatus;
  /** True when this symbol has a live provider backing it. */
  live: boolean;
}

interface MarketsState {
  // Account mode — Virtual (paper) vs Real (broker-required).
  // `mode` is the legacy field name kept for backward-compat with any
  // consumer that reads it; `accountMode` is the canonical Phase 3 name.
  // Both are kept in sync.
  mode: "paper" | "bybit_testnet" | "bybit_live";
  accountMode: "paper" | "bybit_testnet" | "bybit_live";
  setAccountMode: (m: "paper" | "bybit_testnet" | "bybit_live") => void;
  /** Legacy alias for setAccountMode — kept for backward-compat. */
  setMode: (m: "paper" | "bybit_testnet" | "bybit_live") => void;

  // Operation history (audit trail of every Virtual-account event).
  // Refreshed by `refreshHistory()` after any trading mutation.
  operationHistory: OperationHistoryEntry[];
  refreshHistory: () => void;

  // Instruments (catalog metadata merged with Bybit live list)
  instruments: Instrument[];
  loadingInstruments: boolean;
  refreshInstruments: () => Promise<void>;

  // Selected instrument (legacy single-symbol selector — kept in sync with
  // the active chart pane so legacy consumers like OrderDetails and
  // Intelligence panels still work.)
  selectedSymbol: string | null;
  selectSymbol: (symbol: string) => void;

  // Active chart pane — the pane whose context feeds OrderDetails + Intelligence.
  activePaneIndex: number;
  setActivePaneIndex: (i: number) => void;

  // Per-pane symbol/timeframe (the source of truth for chart state).
  // Order matches the chart layout. Index 0 is always present.
  paneStates: { symbol: string; timeframe: LucianTimeframe }[];
  setPaneState: (
    index: number,
    patch: Partial<{ symbol: string; timeframe: LucianTimeframe }>,
  ) => void;
  setPaneCount: (count: number) => void;

  // Phase 3: the legacy single `timeframe` / `setTimeframe` fields have
  // been removed. The canonical timeframe state is the per-pane
  // `paneStates[i].timeframe` (type `LucianTimeframe`). Multi-pane charts
  // can each have their own timeframe, and the active pane's timeframe is
  // read via `paneStates[activePaneIndex].timeframe`. There is no longer a
  // parallel legacy timeframe store representing the same concept.

  // Live prices (LUCIAN symbol → last trade price)
  prices: Map<string, number>;
  updatePrice: (update: PriceUpdate) => void;

  // 24h tickers (LUCIAN symbol → Ticker)
  tickers: Map<string, Ticker>;
  updateTicker: (symbol: string, ticker: Ticker) => void;
  /** Refresh the 24h ticker for a symbol from the provider. */
  refreshTicker: (lucianSymbol: string) => Promise<void>;

  // Candles cache: paneKey → array of candles. Updated by:
  //   1. Initial historical fetch on subscribe
  //   2. Live kline WS — last candle is replaced/extended each tick
  candlesByKey: Map<string, Candle[]>;
  /** Replace the entire candle array for a pane key (initial history). */
  setCandles: (key: string, candles: Candle[]) => void;
  /** Update or append the latest candle for a pane key (live kline). */
  upsertCandle: (key: string, candle: Candle) => void;

  // Per-symbol data status (LUCIAN symbol → DataStatus)
  statusBySymbol: Map<string, DataStatus>;
  setStatus: (symbol: string, status: DataStatus) => void;

  // ── Subscription lifecycle ──
  /**
   * Subscribe the store to live updates for a given LUCIAN symbol +
   * chart timeframe. Idempotent — multiple panes requesting the same
   * (symbol, tf) share ONE WebSocket. The store tracks a refcount and
   * only tears down when the last consumer unsubscribes.
   *
   * On success: candles get loaded into `candlesByKey`, prices flow
   * into `prices`, status flips to `live`.
   * On failure: status flips to `disconnected`, candles are NOT
   * fabricated (per Phase 1 requirement).
   */
  subscribePane: (symbol: string, timeframe: LucianTimeframe) => void;
  unsubscribePane: (symbol: string, timeframe: LucianTimeframe) => void;
  /** Force a one-shot retry of the historical fetch for a pane key. */
  retryPane: (symbol: string, timeframe: LucianTimeframe) => Promise<void>;

  // Phase 3: the legacy `watchlist` / `addToWatchlist` / `removeFromWatchlist`
  // fields have been removed. The canonical favorites system is the
  // `useFavorites` hook backed by `localStorage["lucian-markets-favorites"]`.
  // Old `lucian-markets-watchlist` data is migrated on module load (see
  // `migrateLegacyWatchlistToFavorites` above).

  // Risk rules
  riskRules: RiskRules;
  updateRiskRules: (rules: RiskRules) => void;

  // Account (paper)
  account: AccountState | null;
  refreshAccount: () => void;

  // Open positions / pending orders / closed history (from paper-trading)
  positions: Position[];
  pendingOrders: PendingOrder[];
  closedPositions: ClosedPosition[];
  refreshTrading: () => void;

  // Place a market order via the Virtual engine.
  placeMarketOrder: (
    symbol: string,
    side: OrderSide,
    entryPrice: number,
    volume: number,
    stopLoss?: number,
    takeProfit?: number,
  ) => { success: boolean; error?: string };

  // Place a pending order via the Virtual engine.
  // Phase 2: `orderType` is the explicit pending type (buy_limit /
  // buy_stop / sell_limit / sell_stop) — the engine stores exactly
  // what the UI passes, so the visible label always matches.
  placePending: (
    symbol: string,
    side: OrderSide,
    orderType: PendingOrder["orderType"],
    price: number,
    volume: number,
    stopLoss?: number,
    takeProfit?: number,
  ) => { success: boolean; error?: string };

  // Close positions matching a given filter, using the current bid/ask
  // prices for the symbol of each position as the exit price.
  closeMatching: (
    filter: "all" | "profitable" | "losing" | "long" | "short",
  ) => { closed: number; realizedPnl: number };

  // Cancel a single pending order.
  cancelPending: (orderId: string) => void;

  // Provider initialized
  initialized: boolean;
  initialize: () => void;

  // ── Left contextual panel mode (Instruments | OrderDetails) ──
  leftPanelMode: "instruments" | "order";
  setLeftPanelMode: (m: "instruments" | "order") => void;
  onToggleInstruments?: () => void;
  setToggleInstrumentsHandler: (fn: (() => void) | undefined) => void;
}

// ── Module-private subscription registries ────────────────────────────
//
// Phase 3 splits the subscription model into two layers so an open
// position's live P/L / SL / TP / pending monitoring doesn't stop when
// the user switches the visible chart pane to a different symbol.
//
//   PRICE subscriptions  — per LUCIAN symbol, shared by:
//     - visible chart panes (for live price overlay)
//     - open positions (for unrealized P/L + SL/TP triggers)
//     - pending orders (for trigger evaluation)
//   Refcounted. When the last consumer unsubscribes, the WebSocket closes.
//
//   KLINE subscriptions  — per (LUCIAN symbol, timeframe), used only by
//     visible chart panes to render candle history. Each chart pane
//     owns its own kline subscription; switching timeframe cleanly
//     tears down the old one and opens the new one.
//   Refcounted (multi-pane layouts may share the same symbol+tf).
//
// Both registries are stored OUTSIDE the Zustand state so React's diff
// loop never sees the WebSocket objects.

interface PriceSubscription {
  /** Refcount — visible chart panes + open positions + pending orders on this symbol. */
  refCount: number;
  bybitSymbol: string;
  unsubscribePrice: () => void;
}

interface KlineSubscription {
  /** Refcount — visible chart panes only. */
  refCount: number;
  bybitSymbol: string;
  timeframe: Timeframe;
  unsubscribeKline: () => void;
}

const priceSubscriptions = new Map<string, PriceSubscription>();
const klineSubscriptions = new Map<string, KlineSubscription>();

// Register Bybit public market data on module load (client-side only).
if (typeof window !== "undefined") {
  registerProvider(BybitProvider);
}

/**
 * Ensure a live price stream exists for the given LUCIAN symbol. Shared
 * by chart panes + open positions + pending orders. Idempotent — multiple
 * callers increment the refcount, the WebSocket only opens once.
 *
 * NOTE: this helper is defined BEFORE `useMarketsStore` is created, so
 * it can't close over `get`/`set`. It uses `useMarketsStore.getState()`
 * instead, which is safe because Zustand's `create` returns a hook with
 * a `.getState()` method that's available immediately after creation.
 * The forward reference is hoisted at call-time, not definition-time.
 */
function ensurePriceSubscription(lucianSymbol: string): void {
  if (!isSupportedCrypto(lucianSymbol)) return;
  const existing = priceSubscriptions.get(lucianSymbol);
  if (existing) {
    existing.refCount += 1;
    return;
  }
  const provider = getProvider("crypto");
  if (!provider) return;
  let bybitSymbol: string;
  try {
    bybitSymbol = toBybitSymbol(lucianSymbol);
  } catch {
    return;
  }
  const unsubscribePrice = provider.subscribePrice(
    bybitSymbol,
    (update) => useMarketsStore.getState().updatePrice(update),
    (status) => {
      const store = useMarketsStore.getState();
      // Only downgrade to disconnected if we have no candles yet.
      if (status.kind === "error" || status.kind === "closed") {
        const haveCandles = Array.from(store.candlesByKey.keys()).some(
          (k) => typeof k === "string" && k.startsWith(lucianSymbol + "|"),
        );
        if (!haveCandles) {
          store.setStatus(lucianSymbol, "disconnected");
        }
      } else if (status.kind === "open") {
        const cur = store.statusBySymbol.get(lucianSymbol);
        if (cur !== "live") store.setStatus(lucianSymbol, "live");
      }
    },
  );
  priceSubscriptions.set(lucianSymbol, {
    refCount: 1,
    bybitSymbol,
    unsubscribePrice,
  });
}

/**
 * Decrement the refcount on a symbol's price stream. When the last
 * consumer unsubscribes (no visible chart pane + no open positions +
 * no pending orders), the WebSocket closes cleanly.
 */
function releasePriceSubscription(lucianSymbol: string): void {
  const sub = priceSubscriptions.get(lucianSymbol);
  if (!sub) return;
  sub.refCount -= 1;
  if (sub.refCount > 0) return;
  sub.unsubscribePrice();
  priceSubscriptions.delete(lucianSymbol);
}

export const useMarketsStore = create<MarketsState>((set, get) => ({
  mode: "paper",
  accountMode: "paper",
  setAccountMode: (m) => {
    if (typeof window !== "undefined") localStorage.setItem("lucian-trading-mode", m);
    set({ mode: m, accountMode: m });
  },
  setMode: (m) => get().setAccountMode(m),

  // Operation history — populated from localStorage on first refresh.
  operationHistory: typeof window !== "undefined" ? getOperationHistory() : [],
  refreshHistory: () => {
    set({ operationHistory: getOperationHistory() });
  },

  instruments: [],
  loadingInstruments: false,

  refreshInstruments: async () => {
    set({ loadingInstruments: true });
    try {
      const provider = getProvider("crypto");
      // The provider returns Bybit-native symbols (BTCUSDT). The LUCIAN
      // catalog uses BTCUSD; we keep the catalog as the authoritative
      // instrument list (display names, categories, precision) and only
      // use the provider list to mark which symbols are LIVE.
      const liveInstruments = provider ? await provider.listInstruments() : [];
      // Merge: every catalog entry is an Instrument. The `live` flag is
      // derived from the symbol (catalog uses BTCUSD, provider returns
      // BTCUSDT — `isSupportedCrypto` answers that question for both).
      void liveInstruments; // used for the side-effect of confirming provider reachability
      set({ loadingInstruments: false });
    } catch (err) {
      console.error("Failed to load instruments:", err);
      set({ loadingInstruments: false });
    }
  },

  selectedSymbol: "BTCUSD",
  selectSymbol: (symbol) => {
    set({ selectedSymbol: symbol });
    // Also reflect into pane 0 so legacy selectSymbol() calls (from
    // InstrumentsPanel row clicks) update the visible chart.
    const panes = get().paneStates;
    if (panes[0] && panes[0].symbol !== symbol) {
      get().setPaneState(0, { symbol });
    }
  },

  // ── Active pane ──
  activePaneIndex: 0,
  setActivePaneIndex: (i) => set({ activePaneIndex: i }),

  paneStates: [{ symbol: "BTCUSD", timeframe: "M1" }],
  setPaneState: (index, patch) => {
    set((s) => {
      const next = [...s.paneStates];
      const cur = next[index];
      if (!cur) return s;
      next[index] = { ...cur, ...patch };
      // Reflect pane 0 into selectedSymbol for legacy consumers (the
      // InstrumentsPanel row-click path calls selectSymbol which mirrors
      // into pane 0; the Intelligence panel reads selectedSymbol directly).
      const selectedSymbol = next[0]?.symbol ?? s.selectedSymbol;
      return { paneStates: next, selectedSymbol };
    });
  },
  setPaneCount: (count) => {
    set((s) => {
      const next = [...s.paneStates];
      const defaults: { symbol: string; timeframe: LucianTimeframe }[] = [
        { symbol: "BTCUSD", timeframe: "M1" },
        { symbol: "ETHUSD", timeframe: "M1" },
        { symbol: "SOLUSD", timeframe: "M1" },
        { symbol: "ETHUSD", timeframe: "M1" },
      ];
      while (next.length < count) {
        next.push(defaults[next.length] ?? defaults[0]);
      }
      next.length = count;
      return { paneStates: next };
    });
  },

  prices: new Map(),
  updatePrice: (update) => {
    set((s) => {
      const next = new Map(s.prices);
      // `update.symbol` is the Bybit-native symbol (BTCUSDT). We store
      // under the LUCIAN symbol (BTCUSD) so the rest of the app keys off
      // the catalog symbol consistently.
      const lucianSymbol = bybitToLucian(update.symbol);
      if (lucianSymbol) next.set(lucianSymbol, update.price);
      return { prices: next };
    });
    // Hook the live price into the paper engine so unrealized PnL stays
    // current and SL/TP triggers fire. Also evaluate pending-order
    // triggers so a pending order fills as soon as the entry condition
    // is met. Refresh trading state so the bottom panel + account
    // metrics reflect the new PnL.
    const lucianSymbol = bybitToLucian(update.symbol);
    if (lucianSymbol) {
      const prices = get().prices;
      updateUnrealizedPnl(prices);
      evaluatePendingTriggers(prices, get().riskRules);
      // Phase 10: evaluate user-defined price alerts. Uses the same live
      // price (no separate provider) and fires ONE notification per alert
      // when the condition is newly met. The alert's `triggered` flag
      // prevents continuous firing while the condition remains true.
      try {
        // Dynamic import keeps the markets store bundle clean of the
        // alerts store until first use; also avoids any module-load
        // ordering issues during SSR.
        void import("@/store/markets-price-alerts").then(({ evaluateAlertsForSymbol }) => {
          evaluateAlertsForSymbol(lucianSymbol, update.price);
        });
      } catch {
        // Non-fatal — alerts are best-effort.
      }
      // Refresh trading state (positions + account) without clobbering
      // selection / pane state. Bounded by requestAnimationFrame so we
      // don't trigger a Zustand set on every single tick (which would
      // cause React to re-render the bottom panel dozens of times per
      // second). The state is read inside the rAF callback so we always
      // see the freshest prices.
      scheduleAccountRefresh();
    }
  },

  tickers: new Map(),
  updateTicker: (symbol, ticker) => {
    set((s) => {
      const next = new Map(s.tickers);
      // `symbol` is the Bybit-native symbol. Normalize to LUCIAN.
      const lucianSymbol = bybitToLucian(symbol);
      if (lucianSymbol) next.set(lucianSymbol, ticker);
      return { tickers: next };
    });
  },
  refreshTicker: async (lucianSymbol) => {
    if (!isSupportedCrypto(lucianSymbol)) return;
    const provider = getProvider("crypto");
    if (!provider) return;
    try {
      const bybitSymbol = toBybitSymbol(lucianSymbol);
      const t = await provider.getTicker(bybitSymbol);
      if (t) get().updateTicker(bybitSymbol, t);
    } catch {
      // Non-fatal — ticker is best-effort.
    }
  },

  candlesByKey: new Map(),
  setCandles: (key, candles) => {
    set((s) => {
      const next = new Map(s.candlesByKey);
      next.set(key, candles);
      return { candlesByKey: next };
    });
  },
  upsertCandle: (key, candle) => {
    set((s) => {
      const next = new Map(s.candlesByKey);
      const arr = next.get(key);
      if (!arr || arr.length === 0) {
        next.set(key, [candle]);
        return { candlesByKey: next };
      }
      const last = arr[arr.length - 1];
      if (last.time === candle.time) {
        // Replace the forming candle.
        const copy = arr.slice(0, -1);
        copy.push(candle);
        next.set(key, copy);
      } else if (candle.time > last.time) {
        // New candle started.
        const copy = arr.length >= 200 ? arr.slice(arr.length - 199) : arr.slice();
        copy.push(candle);
        next.set(key, copy);
      }
      // Out-of-order / older candle — ignore.
      return { candlesByKey: next };
    });
  },

  statusBySymbol: new Map(),
  setStatus: (symbol, status) => {
    set((s) => {
      const next = new Map(s.statusBySymbol);
      next.set(symbol, status);
      return { statusBySymbol: next };
    });
  },

  subscribePane: (lucianSymbol, lucianTimeframe) => {
    // Only crypto symbols have a live provider. Non-crypto symbols just
    // get a `setup-required` status and are otherwise inert (their
    // candles are reference-snapshot data owned by the chart component).
    if (!isSupportedCrypto(lucianSymbol)) {
      get().setStatus(lucianSymbol, "setup-required");
      return;
    }
    const tf = LUCIAN_TF_TO_PROVIDER[lucianTimeframe];
    const key = paneKey(lucianSymbol, lucianTimeframe);

    // ── KLINE subscription (chart-pane-only, per (symbol, timeframe)) ──
    const existingKline = klineSubscriptions.get(key);
    if (existingKline) {
      existingKline.refCount += 1;
    } else {
      const provider = getProvider("crypto");
      if (provider) {
        let bybitSymbol: string;
        try {
          bybitSymbol = toBybitSymbol(lucianSymbol);
        } catch {
          get().setStatus(lucianSymbol, "setup-required");
          return;
        }

        // Initial historical fetch + 24h ticker (best-effort, non-blocking).
        void (async () => {
          try {
            const candles = await provider.getCandles(bybitSymbol, tf, 200);
            get().setCandles(key, candles);
            get().setStatus(lucianSymbol, "live");
          } catch (err) {
            // HONEST failure — do NOT fabricate reference candles for crypto.
            console.error(
              `[markets] Bybit historical fetch failed for ${lucianSymbol} ${lucianTimeframe}:`,
              err,
            );
            get().setStatus(lucianSymbol, "disconnected");
          }
        })();
        void get().refreshTicker(lucianSymbol);

        const unsubscribeKline = provider.subscribeKline(
          bybitSymbol,
          tf,
          (candle) => get().upsertCandle(key, candle),
          (status) => {
            if (status.kind === "error" || status.kind === "closed") {
              const have = get().candlesByKey.get(key);
              if (!have || have.length === 0) {
                get().setStatus(lucianSymbol, "disconnected");
              }
            } else if (status.kind === "open") {
              const cur = get().statusBySymbol.get(lucianSymbol);
              if (cur !== "live") get().setStatus(lucianSymbol, "live");
            }
          },
        );
        klineSubscriptions.set(key, {
          refCount: 1,
          bybitSymbol,
          timeframe: tf,
          unsubscribeKline,
        });
      }
    }

    // ── PRICE subscription (shared with open positions + pending orders) ──
    // Mark as connecting immediately so the UI can show a transition.
    get().setStatus(lucianSymbol, "live");
    ensurePriceSubscription(lucianSymbol);
  },

  unsubscribePane: (lucianSymbol, lucianTimeframe) => {
    if (!isSupportedCrypto(lucianSymbol)) return;
    // Release the kline subscription (chart-pane-only).
    const key = paneKey(lucianSymbol, lucianTimeframe);
    const ksub = klineSubscriptions.get(key);
    if (ksub) {
      ksub.refCount -= 1;
      if (ksub.refCount <= 0) {
        ksub.unsubscribeKline();
        klineSubscriptions.delete(key);
      }
    }
    // Release ONE refcount on the shared price subscription. If open
    // positions or pending orders still need this symbol's price stream,
    // the WebSocket stays open. This is the critical Phase 3 fix.
    releasePriceSubscription(lucianSymbol);
    // Note: we deliberately KEEP the cached candles + last-known price so
    // the user can switch back to this symbol quickly. The status stays
    // at `live` because the data we have is still valid (just stale).
  },

  retryPane: async (lucianSymbol, lucianTimeframe) => {
    if (!isSupportedCrypto(lucianSymbol)) return;
    const key = paneKey(lucianSymbol, lucianTimeframe);
    const provider = getProvider("crypto");
    if (!provider) return;
    const tf = LUCIAN_TF_TO_PROVIDER[lucianTimeframe];
    const bybitSymbol = toBybitSymbol(lucianSymbol);
    get().setStatus(lucianSymbol, "live"); // optimistic — show "retrying"
    try {
      const candles = await provider.getCandles(bybitSymbol, tf, 200);
      get().setCandles(key, candles);
      get().setStatus(lucianSymbol, "live");
    } catch (err) {
      console.error(`[markets] Bybit retry failed for ${lucianSymbol}:`, err);
      get().setStatus(lucianSymbol, "disconnected");
    }
  },

  riskRules: typeof window !== "undefined" ? loadRiskRules() : DEFAULT_RISK_RULES,
  updateRiskRules: (rules) => {
    saveRiskRules(rules);
    set({ riskRules: rules });
  },

  account: null,
  refreshAccount: () => {
    const prices = get().prices;
    const account = getAccountState(prices);
    set({ account });
  },

  positions: typeof window !== "undefined" ? getOpenPositions() : [],
  pendingOrders: typeof window !== "undefined" ? getPendingOrders() : [],
  closedPositions: typeof window !== "undefined" ? getClosedPositions() : [],

  refreshTrading: () => {
    // Read fresh state from the paper-trading engine.
    const positions = getOpenPositions();
    const pendingOrders = getPendingOrders();
    const closedPositions = getClosedPositions();
    set({
      positions,
      pendingOrders,
      closedPositions,
      account: getAccountState(get().prices),
    });
    // Refresh operation history so newly-recorded entries (open/close/
    // pending/trigger/reject/reset) appear in the Operation History drawer.
    get().refreshHistory();
    // ── Background account-price subscriptions ──
    // Ensure every symbol with an open position or pending order has an
    // active price stream — even if that symbol is NOT currently visible
    // in any chart pane. This is the critical Phase 3 fix: an open BTC
    // trade keeps receiving live P/L / SL/TP / pending-trigger updates
    // even when the user switches the chart to ETH.
    const wantedSymbols = new Set<string>();
    for (const p of positions) wantedSymbols.add(p.symbol);
    for (const o of pendingOrders) wantedSymbols.add(o.symbol);
    // Subscribe to any wanted symbol that isn't already subscribed.
    for (const sym of wantedSymbols) {
      const sub = priceSubscriptions.get(sym);
      if (!sub) {
        // No existing subscription — open one. The refcount starts at 1
        // (representing the account-level consumer). If a chart pane is
        // also displaying this symbol, it adds its own refcount via
        // subscribePane → ensurePriceSubscription.
        ensurePriceSubscription(sym);
      }
    }
    // Unsubscribe from symbols that no longer have any position OR pending
    // order AND aren't visible in any chart pane.
    for (const sym of Array.from(priceSubscriptions.keys())) {
      if (!wantedSymbols.has(sym)) {
        // Check if any visible chart pane is displaying this symbol.
        const inPane = get().paneStates.some((p) => p.symbol === sym);
        if (!inPane) {
          // Force-close: release all refcounts the account-level system
          // added (typically 1). If a chart pane was holding the symbol,
          // it would still be in `inPane=true` branch and we'd skip.
          const sub = priceSubscriptions.get(sym);
          if (sub) {
            // Drop the account-level refcount only. If the chart pane
            // is still displaying this symbol, inPane would be true and
            // we wouldn't reach here. So it's safe to fully release.
            releasePriceSubscription(sym);
          }
        }
      }
    }
  },

  placeMarketOrder: (symbol, side, entryPrice, volume, stopLoss = 0, takeProfit = 0) => {
    if (get().accountMode !== "paper") {
      return { success: false, error: "Live orders require the Bybit preview and confirmation flow. Switch to Virtual until Bybit is connected and live trading is enabled." };
    }
    const rules = get().riskRules;
    const result = openPosition(
      symbol,
      side,
      entryPrice,
      volume,
      stopLoss,
      takeProfit,
      rules,
    );
    get().refreshTrading();
    return result.success
      ? { success: true }
      : { success: false, error: result.error };
  },

  placePending: (symbol, side, orderType, price, volume, stopLoss = 0, takeProfit = 0) => {
    if (get().accountMode !== "paper") {
      return { success: false, error: "Live pending orders are locked until the Bybit confirmation UI is enabled." };
    }
    const rules = get().riskRules;
    const result = placePendingOrder(
      symbol,
      side,
      orderType,
      price,
      volume,
      stopLoss,
      takeProfit,
      rules,
    );
    get().refreshTrading();
    return result.success
      ? { success: true }
      : { success: false, error: result.error };
  },

  closeMatching: (filter) => {
    const prices = get().prices;
    const exitBySymbol = new Map<string, number>();
    for (const pos of get().positions) {
      if (!exitBySymbol.has(pos.symbol)) {
        const p = prices.get(pos.symbol);
        if (p !== undefined) exitBySymbol.set(pos.symbol, p);
      }
    }
    const matching = get().positions.filter((p) => {
      switch (filter) {
        case "all":
          return true;
        case "profitable":
          return p.unrealizedPnl > 0;
        case "losing":
          return p.unrealizedPnl < 0;
        case "long":
          return p.side === "buy";
        case "short":
          return p.side === "sell";
        default:
          return false;
      }
    });
    const ids = matching.map((p) => p.id);
    const result = closePositionsByIds(ids, exitBySymbol);
    get().refreshTrading();
    return result;
  },

  cancelPending: (orderId) => {
    cancelPendingOrder(orderId);
    get().refreshTrading();
  },

  leftPanelMode: "instruments",
  setLeftPanelMode: (m) => set({ leftPanelMode: m }),
  setToggleInstrumentsHandler: (fn) => set({ onToggleInstruments: fn }),

  initialized: false,
  initialize: () => {
    if (get().initialized) return;
    let savedMode: MarketsState["accountMode"] = "paper";
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("lucian-trading-mode");
      if (stored === "bybit_testnet" || stored === "bybit_live" || stored === "paper") savedMode = stored;
      else if (stored === "real") savedMode = "bybit_testnet";
    }
    set({ initialized: true, accountMode: savedMode, mode: savedMode });
    void get().refreshInstruments();
    // Seed account/positions on first init so the bottom panel isn't empty.
    get().refreshTrading();
    void syncPaperAccountFromCloud().then(() => get().refreshTrading());
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────

/** Map a Bybit API symbol (BTCUSDT) back to its LUCIAN equivalent (BTCUSD). */
function bybitToLucian(bybitSymbol: string): string | null {
  if (!bybitSymbol.endsWith("USDT")) return null;
  const base = bybitSymbol.slice(0, -"USDT".length);
  // Kept inline to avoid a circular import with
  // symbol-mapping.ts (which imports from catalog.ts which is fine).
  // Inline the check using the same CRYPTO_BASES set.
  const CRYPTO_BASES = new Set([
    "BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "AVAX", "DOT", "LINK",
    "LTC", "TRX", "ATOM", "NEAR", "MATIC", "APT", "FIL", "ARB", "OP", "INJ",
    "BCH", "AAVE", "ALGO", "UNI", "ETC", "AXS", "MANA", "ZEC", "IOTA", "ICP",
    "LRC", "DASH", "GRT",
  ]);
  if (!CRYPTO_BASES.has(base)) return null;
  return `${base}USD`;
}

// ── Account refresh throttle ─────────────────────────────────────────
//
// Live price ticks can fire many times per second. Re-running
// `refreshTrading()` synchronously on every tick would cause the bottom
// panel + account strip to re-render dozens of times per second, hurting
// performance. We coalesce into a single refresh per animation frame.

let accountRefreshScheduled = false;
function scheduleAccountRefresh() {
  if (accountRefreshScheduled) return;
  accountRefreshScheduled = true;
  if (typeof window === "undefined" || typeof requestAnimationFrame === "undefined") {
    // SSR or no rAF — refresh immediately.
    useMarketsStore.getState().refreshTrading();
    accountRefreshScheduled = false;
    return;
  }
  requestAnimationFrame(() => {
    accountRefreshScheduled = false;
    useMarketsStore.getState().refreshTrading();
  });
}

// ── Derived selector: active-pane context snapshot ──────────────────
//
// OrderDetails + Intelligence panels need the symbol/timeframe/prices of
// the active chart pane. We compute a snapshot via this helper so callers
// can `useMarketsStore(useActiveContext)` and re-render only when the
// values they care about actually change.

export function useActiveContext(): ActiveContextSnapshot {
  return useMarketsStore((s) => {
    const pane = s.paneStates[s.activePaneIndex] ?? s.paneStates[0];
    if (!pane) {
      return {
        symbol: "BTCUSD",
        timeframe: "M1" as LucianTimeframe,
        bid: 0,
        ask: 0,
        changePct: null,
        status: "setup-required" as DataStatus,
        live: false,
      };
    }
    const inst = getInstrumentBySymbol(pane.symbol);
    const livePrice = s.prices.get(pane.symbol);
    const ticker = s.tickers.get(pane.symbol);
    const bid = ticker?.bidPrice ?? livePrice ?? inst?.bid ?? 0;
    const ask = ticker?.askPrice ?? livePrice ?? inst?.ask ?? 0;
    const changePct = ticker?.priceChangePercent ?? inst?.changePct ?? null;
    const status = s.statusBySymbol.get(pane.symbol) ??
      (inst ? (inst.marketOpen ? "live" as DataStatus : "setup-required" as DataStatus) : "setup-required" as DataStatus);
    return {
      symbol: pane.symbol,
      timeframe: pane.timeframe,
      bid,
      ask,
      changePct,
      status,
      live: isSupportedCrypto(pane.symbol),
    };
  });
}

// ── Phase 13: News Markets widget helper ──────────────────────────────────
//
// The News Feed page has a small Markets widget that needs to display
// price + change for a fixed set of instruments (BTCUSD, ETHUSD, etc.).
// We expose a SINGLE entry point that:
//
//   1. Subscribes to price streams for the given symbols (refcounted —
//      multiple widget instances share ONE stream per symbol).
//   2. Triggers a one-shot ticker refresh for each symbol.
//   3. Returns a cleanup function that releases all subscriptions.
//
// This reuses the SAME shared LUCIAN Markets service — there is no
// second Bybit WebSocket connection. Phase 13 requirement.
//
// For NON-crypto symbols (XAUUSD, NAS100, etc.) there is no live
// provider configured; the catalog's snapshot price is used as a
// fallback display value (the same behavior the chart workspace uses
// before the first live tick arrives).

/**
 * Subscribe the News Markets widget to live prices for the given symbols.
 *
 * Returns a cleanup function that releases ALL the subscriptions. The
 * caller MUST call cleanup on unmount to avoid leaking WebSocket refs.
 *
 * @param symbols  LUCIAN symbols (e.g. ["BTCUSD", "ETHUSD"]).
 */
export function subscribeNewsMarkets(symbols: string[]): () => void {
  const cleanups: Array<() => void> = [];
  for (const sym of symbols) {
    if (!isSupportedCrypto(sym)) continue;
    ensurePriceSubscription(sym);
    cleanups.push(() => releasePriceSubscription(sym));
    // Trigger a one-shot ticker refresh so the 24h change percent is
    // populated even if the user hasn't visited the Markets page yet.
    void useMarketsStore.getState().refreshTicker(sym);
  }
  return () => {
    for (const cleanup of cleanups) {
      try { cleanup(); } catch { /* ignore — already unsubscribed */ }
    }
  };
}

/**
 * Read a snapshot of (price, changePct) for a LUCIAN symbol.
 *
 * For crypto symbols with a live subscription, returns the latest trade
 * price + 24h ticker change. For non-crypto symbols (forex / metals /
 * indices / energies), returns the catalog's snapshot bid/ask average +
 * snapshot changePct — clearly marked as "reference" by the caller.
 */
export function readNewsMarketSnapshot(symbol: string): {
  symbol: string;
  price: number | null;
  changePct: number | null;
  live: boolean;
} {
  const store = useMarketsStore.getState();
  const livePrice = store.prices.get(symbol);
  const ticker = store.tickers.get(symbol);
  const inst = getInstrumentBySymbol(symbol);
  if (livePrice !== undefined || ticker) {
    return {
      symbol,
      price: ticker?.lastPrice ?? livePrice ?? null,
      changePct: ticker?.priceChangePercent ?? inst?.changePct ?? null,
      live: true,
    };
  }
  if (inst) {
    return {
      symbol,
      price: (inst.bid + inst.ask) / 2,
      changePct: inst.changePct,
      live: false,
    };
  }
  return { symbol, price: null, changePct: null, live: false };
}
