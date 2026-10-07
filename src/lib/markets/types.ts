// LUCIAN Market Terminal — core domain types.
//
// These types describe market instruments, candle data, ticker data,
// and the provider-adapter architecture that lets LUCIAN connect to
// multiple data sources (Bybit for crypto, future providers for
// forex/stocks/indices) without being permanently tied to one.

/** Asset class / market category. */
export type AssetClass =
  | "crypto"
  | "forex"
  | "stocks"
  | "indices"
  | "metals"
  | "energies"
  | "commodities";

/** A tradeable instrument. */
export interface Instrument {
  /** Stable symbol, e.g. "BTCUSDT" or "EUR/USD". */
  symbol: string;
  /** Display name, e.g. "Bitcoin / Tether". */
  name: string;
  /** Asset class. */
  assetClass: AssetClass;
  /** Base asset, e.g. "BTC". */
  base: string;
  /** Quote asset, e.g. "USDT". */
  quote: string;
  /** Price precision (decimal places). */
  pricePrecision: number;
  /** Quantity precision (decimal places). */
  quantityPrecision: number;
}

/** OHLCV candle. */
export interface Candle {
  /** Open time as a UTC timestamp in seconds (for lightweight-charts). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** 24-hour ticker statistics. */
export interface Ticker {
  symbol: string;
  /** Last traded price. */
  lastPrice: number;
  /** Price change over 24h (absolute). */
  priceChange: number;
  /** Price change percent over 24h. */
  priceChangePercent: number;
  /** Highest price in 24h. */
  highPrice: number;
  /** Lowest price in 24h. */
  lowPrice: number;
  /** Total traded volume in base asset. */
  volume: number;
  /** Total traded volume in quote asset. */
  quoteVolume: number;
  /** Best bid price. */
  bidPrice: number;
  /** Best ask price. */
  askPrice: number;
}

/** Real-time price update (from WebSocket). */
export interface PriceUpdate {
  symbol: string;
  price: number;
  /** Timestamp in seconds. */
  time: number;
}

/** Supported chart timeframes. */
export type Timeframe = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w";

/** Data connection status — always tells the truth. */
export type DataStatus = "live" | "delayed" | "disconnected" | "setup-required";

/** Order side. */
export type OrderSide = "buy" | "sell";

/**
 * Order type.
 *
 * Phase 2 splits the legacy vague `"limit" | "stop"` into four explicit
 * pending-order types so the UI label always matches what the engine
 * stores and the trigger direction is unambiguous:
 *
 *   - `"buy_limit"`  — buy when price FALLS to or below entry
 *   - `"buy_stop"`   — buy when price RISES to or above entry
 *   - `"sell_limit"` — sell when price RISES to or above entry
 *   - `"sell_stop"`  — sell when price FALLS to or below entry
 *
 * `"market"` is the only non-pending type — it executes immediately
 * at the current quote.
 */
export type OrderType = "market" | "buy_limit" | "buy_stop" | "sell_limit" | "sell_stop";

/**
 * An open position in paper trading.
 *
 * Phase 2 fixes the accounting model: balance is no longer debited by
 * the full notional trade value. Instead, `requiredMargin` is reserved
 * (the leveraged margin) and the full notional exposure is recorded as
 * `units` so P/L math uses the correct contract size.
 */
export interface Position {
  id: string;
  symbol: string;
  side: OrderSide;
  /** Entry price (the price at which the position was opened). */
  entryPrice: number;
  /** Volume in lots (e.g. 0.01 = minimum forex lot). */
  volume: number;
  /** Underlying units (volume × contractSize). Captured at open time
   *  so P/L math doesn't depend on the spec being unchanged later. */
  units: number;
  /** Required margin reserved for this position (quote-currency dollars). */
  requiredMargin: number;
  /** Asset class snapshot — needed for P/L math even after the spec
   *  table changes (e.g. crypto leverage raised from 5x to 10x shouldn't
   *  retroactively alter historical positions). */
  assetClass: AssetClass;
  /** Contract size snapshot at open time. */
  contractSize: number;
  /** Stop-loss price (0 = not set). */
  stopLoss: number;
  /** Take-profit price (0 = not set). */
  takeProfit: number;
  /** Open timestamp (ms). */
  openedAt: number;
  /** Current unrealized P/L (updated live from market data). */
  unrealizedPnl: number;
  /** True once SL/TP has closed this position. Prevents double-close
   *  if a duplicate tick arrives before the close propagates. */
  closed: boolean;
}

/** A closed position with realized P/L. */
export interface ClosedPosition {
  id: string;
  symbol: string;
  side: OrderSide;
  entryPrice: number;
  exitPrice: number;
  volume: number;
  units: number;
  assetClass: AssetClass;
  contractSize: number;
  realizedPnl: number;
  openedAt: number;
  closedAt: number;
  /** Why the position was closed: "manual" | "stop_loss" | "take_profit" | "liquidation". */
  closeReason: "manual" | "stop_loss" | "take_profit" | "liquidation";
}

/**
 * A pending order waiting to trigger.
 *
 * Phase 2 introduces explicit `orderType` matching the four-card UI
 * so the trigger direction is unambiguous. The legacy `type` field is
 * kept for backward-compat with the persistence layer's migration path.
 */
export interface PendingOrder {
  id: string;
  symbol: string;
  side: OrderSide;
  /** Canonical Phase 2 order type. */
  orderType: Exclude<OrderType, "market">;
  /** Trigger price (the entry the user wants). */
  price: number;
  volume: number;
  units: number;
  assetClass: AssetClass;
  contractSize: number;
  requiredMargin: number;
  stopLoss: number;
  takeProfit: number;
  createdAt: number;
  /** True once this pending order has triggered. Prevents double-trigger. */
  triggered: boolean;
}

/** Account state. */
export interface AccountState {
  /** PAPER or REAL. */
  mode: "paper" | "real";
  /** Starting balance. */
  startingBalance: number;
  /** Current balance (cash, not including open positions). */
  balance: number;
  /** Equity = balance + floating P/L. */
  equity: number;
  /** Margin used by open positions. */
  margin: number;
  /** Free margin = equity - margin. */
  freeMargin: number;
  /** Margin level = (equity / margin) * 100, or 0 if no margin. */
  marginLevel: number;
  /** Total floating P/L (sum of unrealized P/L across positions). */
  floatingPnl: number;
}

/**
 * A history entry for the Operation History drawer. Captures every
 * meaningful Virtual-account event so the trader has a complete audit
 * trail of what happened — including events that DON'T produce a
 * ClosedPosition (pending-order rejections, account resets, etc.).
 */
export interface OperationHistoryEntry {
  /** Stable unique ID. */
  id: string;
  /** Wall-clock time the event occurred (ms since epoch). */
  timestamp: number;
  /** What kind of event this is. */
  kind:
    | "position_opened"
    | "position_closed_manual"
    | "position_closed_stop_loss"
    | "position_closed_take_profit"
    | "pending_placed"
    | "pending_triggered"
    | "pending_cancelled"
    | "pending_rejected"
    | "account_reset";
  /** LUCIAN symbol the event relates to (null for account-wide events). */
  symbol: string | null;
  /** Order side if applicable (null for account-wide events). */
  side: OrderSide | null;
  /** Volume in lots if applicable. */
  volume: number | null;
  /** Price if applicable (entry, exit, or trigger price). */
  price: number | null;
  /** Realized P/L in dollars if applicable (close events). */
  realizedPnl: number | null;
  /** Human-readable detail (e.g. rejection reason). */
  detail: string;
}

/** Risk rule configuration. */
export interface RiskRules {
  /** Max risk per trade as % of equity (0 = disabled). */
  maxRiskPerTrade: number;
  /** Max position size in quote currency (0 = disabled). */
  maxPositionSize: number;
  /** Max daily loss as % of equity (0 = disabled). */
  maxDailyLoss: number;
  /** Max weekly loss as % of equity (0 = disabled). */
  maxWeeklyLoss: number;
  /** Max simultaneous open positions (0 = unlimited). */
  maxOpenPositions: number;
  /** Max leverage (0 = disabled / 1x only). */
  maxLeverage: number;
  /** Allowed asset classes (empty = all). */
  allowedAssetClasses: AssetClass[];
  /** Trading cooldown in minutes after a loss (0 = disabled). */
  tradingCooldownMin: number;
  /** Loss-streak protection: pause after N consecutive losses (0 = disabled). */
  lossStreakProtection: number;
}

/** Result of a risk check. */
export interface RiskCheckResult {
  passed: boolean;
  /** Why it failed (when passed=false). */
  reason?: string;
  /** Which rule was violated. */
  rule?: string;
}

/** Watchlist entry. */
export interface WatchlistEntry {
  symbol: string;
  name: string;
  assetClass: AssetClass;
}
