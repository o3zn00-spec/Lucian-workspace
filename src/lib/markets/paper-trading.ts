// Paper Trading Engine — Phase 2.
//
// Uses REAL market data (from the provider) but VIRTUAL money. No real
// financial consequences. Positions, orders, and P/L are persisted to
// localStorage so they survive page refreshes.
//
// ── Phase 2 accounting model ──────────────────────────────────────
//
// Old (Phase 1) behavior: opening a position debited the FULL notional
//   (entryPrice × quantity) from balance. This is spot-purchase math,
//   not leveraged trading math.
//
// New (Phase 2) behavior: opening a position reserves only the
//   `requiredMargin` (notional / leverage). Balance is unchanged at
//   open time. Floating P/L flows into Equity = Balance + Floating P/L.
//   Free Margin = Equity - Used Margin. On close, the realized P/L
//   is applied to Balance and the reserved margin is released.
//
// ── P/L math ─────────────────────────────────────────────────────
//
// Each position carries a snapshot of its `units`, `assetClass`, and
// `contractSize` so P/L math uses the correct contract multiplier
// even if the spec table changes later. The math is centralized in
// `instrument-spec.ts → pnlForPriceMove()`.
//
// ── SL/TP + pending triggers ──────────────────────────────────────
//
// `updateUnrealizedPnl(prices)` is called by the markets store on
// every live tick. It now also evaluates SL/TP triggers for every
// open position and pending-order triggers for every pending order.
// Triggers fire exactly once via the `closed` / `triggered` flags.

import type {
  AssetClass,
  ClosedPosition,
  OperationHistoryEntry,
  OrderSide,
  PendingOrder,
  Position,
  RiskRules,
} from "./types";
import type { RiskCheckResult, OrderType } from "./types";
import { checkRisk } from "./risk-engine";
import {
  getSpecForSymbol,
  requiredMargin as calcRequiredMargin,
  unitsForVolume,
  pnlForPriceMove,
} from "./instrument-spec";
import { getInstrumentBySymbol } from "./catalog";

const STORAGE_KEY = "lucian-markets-paper-account";
const HISTORY_KEY = "lucian-markets-operation-history";
const SCHEMA_VERSION = 2; // bump when the persisted shape changes
const DEFAULT_STARTING_BALANCE = 1000; // $1,000 virtual USD
const MAX_HISTORY_ENTRIES = 500; // bound to avoid unbounded localStorage growth

export interface PaperAccountData {
  /** Schema version — used by the migration path in `loadData()`. */
  schemaVersion: number;
  startingBalance: number;
  balance: number;
  positions: Position[];
  closedPositions: ClosedPosition[];
  pendingOrders: PendingOrder[];
  dailyLossAmount: number;
  dailyLossResetAt: number;
  weeklyLossAmount: number;
  weeklyLossResetAt: number;
  consecutiveLosses: number;
  lastLossAt: number;
}

function defaultData(): PaperAccountData {
  return {
    schemaVersion: SCHEMA_VERSION,
    startingBalance: DEFAULT_STARTING_BALANCE,
    balance: DEFAULT_STARTING_BALANCE,
    positions: [],
    closedPositions: [],
    pendingOrders: [],
    dailyLossAmount: 0,
    dailyLossResetAt: Date.now() + 24 * 60 * 60 * 1000,
    weeklyLossAmount: 0,
    weeklyLossResetAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    consecutiveLosses: 0,
    lastLossAt: 0,
  };
}

export function loadData(): PaperAccountData {
  if (typeof window === "undefined") return defaultData();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<PaperAccountData>;
      return migrateData(parsed);
    }
  } catch {
    // storage unavailable
  }
  return defaultData();
}

/**
 * Migrate older persisted shapes to the current schema. Returns a
 * fully-valid PaperAccountData regardless of input shape.
 *
 * - v1 (Phase 1): positions had `quantity` + `entryValue`, no
 *   `requiredMargin` / `units` / `closed`. Pending orders had `type`
 *   ("limit"/"stop") instead of `orderType`.
 * - v2 (Phase 2): current shape — see {@link Position} + {@link PendingOrder}.
 *
 * For v1 positions, we derive `requiredMargin` from the stored
 * `entryValue` using the spec's default leverage for that asset
 * class. We also flip `closed: false` so they keep updating. We do
 * NOT auto-close old positions — they should keep receiving live
 * P/L updates under the new accounting model.
 */
function migrateData(parsed: Partial<PaperAccountData>): PaperAccountData {
  const base = defaultData();
  const data: PaperAccountData = { ...base, ...parsed };

  // If the schema version is current and shape matches, no migration needed.
  if (parsed.schemaVersion === SCHEMA_VERSION && Array.isArray(parsed.positions)) {
    // Light validation pass — ensure every position has the Phase 2 fields.
    data.positions = (parsed.positions ?? []).map(migratePosition);
    data.closedPositions = (parsed.closedPositions ?? []).map(migrateClosedPosition);
    data.pendingOrders = (parsed.pendingOrders ?? []).map(migratePendingOrder);
    return data;
  }

  // v1 → v2 migration
  // Old positions used `quantity` (raw units, NOT lots) + `entryValue`.
  // We can't perfectly recover the original lot volume, but we CAN
  // preserve the trade by treating the stored `quantity` as `units`
  // (which it effectively was in Phase 1) and deriving the spec-aware
  // fields from the symbol.
  // Old startingBalance of 100000 was the legacy "demo" value — Phase 2
  // resets to $1,000 on first migration. We detect this explicitly.
  if (parsed.startingBalance === 100000) {
    return defaultData();
  }

  data.schemaVersion = SCHEMA_VERSION;
  data.positions = (parsed.positions ?? []).map(migratePosition);
  data.closedPositions = (parsed.closedPositions ?? []).map(migrateClosedPosition);
  data.pendingOrders = (parsed.pendingOrders ?? []).map(migratePendingOrder);
  return data;
}

/** Migrate a possibly-old Position shape to the current Phase 2 shape. */
function migratePosition(p: Partial<Position> & { symbol?: string; entryPrice?: number }): Position {
  const symbol = p.symbol ?? "";
  const inst = getInstrumentBySymbol(symbol);
  const assetClass: AssetClass = p.assetClass ?? inst?.assetClass ?? "forex";
  const spec = getSpecForSymbol(symbol);

  // Old Phase 1 stored `quantity` as raw units. Treat it as `units` so
  // historical P/L math still works. If `volume` is already set (Phase 2
  // shape), prefer that.
  const volume = p.volume ?? (p as Partial<Position> & { quantity?: number }).quantity ?? 0.01;
  const units = p.units ?? unitsForVolume(spec, volume);

  // Required margin: prefer stored value, else derive from entryValue/leverage
  // (Phase 1 stored entryValue = entryPrice × quantity).
  const entryValue = (p as Partial<Position> & { entryValue?: number }).entryValue;
  const requiredMargin =
    p.requiredMargin ??
    (entryValue !== undefined && spec.leverage > 0
      ? entryValue / spec.leverage
      : 0);

  return {
    id: p.id ?? `pos_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    symbol,
    side: p.side ?? "buy",
    entryPrice: p.entryPrice ?? 0,
    volume,
    units,
    requiredMargin,
    assetClass,
    contractSize: p.contractSize ?? spec.contractSize,
    stopLoss: p.stopLoss ?? 0,
    takeProfit: p.takeProfit ?? 0,
    openedAt: p.openedAt ?? Date.now(),
    unrealizedPnl: p.unrealizedPnl ?? 0,
    closed: p.closed ?? false,
  };
}

/** Migrate a possibly-old ClosedPosition shape to the current Phase 2 shape. */
function migrateClosedPosition(
  c: Partial<ClosedPosition> & { symbol?: string },
): ClosedPosition {
  const symbol = c.symbol ?? "";
  const inst = getInstrumentBySymbol(symbol);
  const assetClass: AssetClass = c.assetClass ?? inst?.assetClass ?? "forex";
  const spec = getSpecForSymbol(symbol);
  const volume = c.volume ?? (c as Partial<ClosedPosition> & { quantity?: number }).quantity ?? 0.01;
  const units = c.units ?? unitsForVolume(spec, volume);
  return {
    id: c.id ?? `closed_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    symbol,
    side: c.side ?? "buy",
    entryPrice: c.entryPrice ?? 0,
    exitPrice: c.exitPrice ?? 0,
    volume,
    units,
    assetClass,
    contractSize: c.contractSize ?? spec.contractSize,
    realizedPnl: c.realizedPnl ?? 0,
    openedAt: c.openedAt ?? Date.now(),
    closedAt: c.closedAt ?? Date.now(),
    closeReason: c.closeReason ?? "manual",
  };
}

/** Migrate a possibly-old PendingOrder shape to the current Phase 2 shape. */
function migratePendingOrder(
  o: Partial<PendingOrder> & { symbol?: string; side?: OrderSide; price?: number },
): PendingOrder {
  const symbol = o.symbol ?? "";
  const inst = getInstrumentBySymbol(symbol);
  const assetClass: AssetClass = o.assetClass ?? inst?.assetClass ?? "forex";
  const spec = getSpecForSymbol(symbol);
  const volume = o.volume ?? (o as Partial<PendingOrder> & { quantity?: number }).quantity ?? 0.01;
  const units = o.units ?? unitsForVolume(spec, volume);
  const price = o.price ?? 0;
  const requiredMargin = o.requiredMargin ?? calcRequiredMargin(spec, volume, price || inst?.bid || 1);

  // Translate legacy `type: "limit" | "stop"` + `side` to the new
  // explicit `orderType` enum.
  const legacyType = (o as Partial<PendingOrder> & { type?: string }).type;
  let orderType: PendingOrder["orderType"];
  if (o.orderType) {
    orderType = o.orderType;
  } else if (legacyType === "limit") {
    orderType = o.side === "buy" ? "buy_limit" : "sell_limit";
  } else if (legacyType === "stop") {
    orderType = o.side === "buy" ? "buy_stop" : "sell_stop";
  } else {
    // Sensible default for unrecognized shapes
    orderType = o.side === "buy" ? "buy_limit" : "sell_limit";
  }

  return {
    id: o.id ?? `pnd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    symbol,
    side: o.side ?? "buy",
    orderType,
    price,
    volume,
    units,
    assetClass,
    contractSize: o.contractSize ?? spec.contractSize,
    requiredMargin,
    stopLoss: o.stopLoss ?? 0,
    takeProfit: o.takeProfit ?? 0,
    createdAt: o.createdAt ?? Date.now(),
    triggered: o.triggered ?? false,
  };
}

export function saveData(data: PaperAccountData): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    scheduleCloudTradingSave();
  } catch {
    // storage unavailable
  }
}

// ---------------------------------------------------------------------------
// Operation history — separate localStorage key so it survives account
// resets (a reset clears positions/orders but keeps the audit trail).
// ---------------------------------------------------------------------------

function loadHistory(): OperationHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as OperationHistoryEntry[] : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: OperationHistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    // Bound to MAX_HISTORY_ENTRIES — drop the oldest beyond the cap.
    const trimmed = entries.length > MAX_HISTORY_ENTRIES
      ? entries.slice(0, MAX_HISTORY_ENTRIES)
      : entries;
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    scheduleCloudTradingSave();
  } catch {
    // storage unavailable
  }
}

let cloudSaveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleCloudTradingSave(): void {
  if (typeof window === "undefined" || process.env.NEXT_PUBLIC_TRADING_CLOUD_SYNC_ENABLED === "false") return;
  if (cloudSaveTimer) clearTimeout(cloudSaveTimer);
  cloudSaveTimer = setTimeout(() => {
    cloudSaveTimer = null;
    void fetch("/api/trading/sandbox", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: loadData(), history: loadHistory() }),
    }).catch(() => undefined);
  }, 700);
}

/** Hydrate the paper account from authenticated cloud storage. On a user's
 * first visit, upload the existing local account so no work is discarded. */
export async function syncPaperAccountFromCloud(): Promise<boolean> {
  if (typeof window === "undefined" || process.env.NEXT_PUBLIC_TRADING_CLOUD_SYNC_ENABLED === "false") return false;
  try {
    const response = await fetch("/api/trading/sandbox", { cache: "no-store" });
    if (!response.ok) return false;
    const payload = await response.json() as { account?: { state: PaperAccountData; history: OperationHistoryEntry[] } | null };
    if (payload.account) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrateData(payload.account.state)));
      localStorage.setItem(HISTORY_KEY, JSON.stringify(payload.account.history ?? []));
      return true;
    }
    scheduleCloudTradingSave();
    return false;
  } catch {
    return false;
  }
}

/**
 * Append an entry to the operation history. Entries are stored newest-first
 * so the Operation History drawer can render them top-down without sorting.
 */
export function addHistoryEntry(entry: Omit<OperationHistoryEntry, "id" | "timestamp">): void {
  const full: OperationHistoryEntry = {
    id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    ...entry,
  };
  const entries = loadHistory();
  entries.unshift(full);
  saveHistory(entries);
}

/** Read the full operation history (newest-first). */
export function getOperationHistory(): OperationHistoryEntry[] {
  return loadHistory();
}

/** Clear all operation history entries. Used by `resetPaperAccount`. */
export function clearOperationHistory(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Clean exported API for balance adjustments
// ---------------------------------------------------------------------------

/** Add funds to the virtual account balance. */
export function depositVirtual(amount: number): void {
  if (amount <= 0) return;
  const data = loadData();
  data.balance += amount;
  saveData(data);
}

/** Remove funds from the virtual account balance (if sufficient). */
export function withdrawVirtual(amount: number): boolean {
  if (amount <= 0) return false;
  const data = loadData();
  if (data.balance < amount) return false;
  data.balance -= amount;
  saveData(data);
  return true;
}

/** Get the current virtual balance. */
export function getVirtualBalance(): number {
  return loadData().balance;
}

// ---------------------------------------------------------------------------
// Position management
// ---------------------------------------------------------------------------

function genId(): string {
  return `pos_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Open a new market position.
 *
 * Phase 2 accounting: the FULL NOTIONAL is NOT debited from balance.
 * Instead, `requiredMargin = notional / leverage` is reserved and
 * stored on the position. Balance is only touched at close time when
 * realized P/L is applied.
 *
 * Risk rules are checked first; if any rule fails, the position is
 * rejected with a LUCIAN-formatted error message and NO state changes.
 */
export function openPosition(
  symbol: string,
  side: OrderSide,
  entryPrice: number,
  volume: number,
  stopLoss: number = 0,
  takeProfit: number = 0,
  riskRules: RiskRules,
): { success: boolean; position?: Position; error?: string } {
  const data = loadData();
  const spec = getSpecForSymbol(symbol);
  const units = unitsForVolume(spec, volume);
  const margin = calcRequiredMargin(spec, volume, entryPrice);

  // Compute current equity for risk checks.
  let floatingPnl = 0;
  let usedMargin = 0;
  for (const pos of data.positions) {
    floatingPnl += pos.unrealizedPnl;
    usedMargin += pos.requiredMargin;
  }
  const equity = data.balance + floatingPnl;
  const freeMargin = equity - usedMargin;

  // Risk check (maxOpenPositions, maxPositionSize, maxRiskPerTrade, etc.)
  const riskCheck = checkRisk({
    side,
    entryPrice,
    volume,
    stopLoss,
    equity,
    positions: data.positions,
    riskRules,
    dailyLossAmount: data.dailyLossAmount,
    weeklyLossAmount: data.weeklyLossAmount,
    consecutiveLosses: data.consecutiveLosses,
    lastLossAt: data.lastLossAt,
    symbol,
  });
  if (!riskCheck.passed) {
    return { success: false, error: riskCheck.reason };
  }

  // Phase 2: explicit free-margin check using the spec-derived
  // required margin. The risk engine's existing check uses
  // entryValue (notional) which is correct for max-position-size but
  // not for the actual margin reservation.
  if (margin > freeMargin) {
    return {
      success: false,
      error: `Insufficient free margin: required $${margin.toFixed(2)}, available $${freeMargin.toFixed(2)} (equity $${equity.toFixed(2)} − used margin $${usedMargin.toFixed(2)}).`,
    };
  }

  const position: Position = {
    id: genId(),
    symbol,
    side,
    entryPrice,
    volume,
    units,
    requiredMargin: margin,
    assetClass: spec.assetClass,
    contractSize: spec.contractSize,
    stopLoss,
    takeProfit,
    openedAt: Date.now(),
    unrealizedPnl: 0,
    closed: false,
  };
  data.positions.push(position);
  // NOTE: balance is NOT debited — only margin is reserved.
  saveData(data);
  addHistoryEntry({
    kind: "position_opened",
    symbol,
    side,
    volume,
    price: entryPrice,
    realizedPnl: null,
    detail: `${side.toUpperCase()} ${volume} ${symbol} @ ${entryPrice} — margin $${margin.toFixed(2)} reserved`,
  });
  return { success: true, position };
}

/**
 * Close a position at the given exit price. Realized P/L is computed
 * using the spec's contract-size-aware formula and applied to balance.
 * The reserved margin is released (implicitly — it's just not counted
 * any more since the position is removed from `positions[]`).
 *
 * Idempotent: if `closed` is already true on the position, this is a
 * no-op (returns success without re-applying P/L).
 */
export function closePosition(
  positionId: string,
  exitPrice: number,
  closeReason: ClosedPosition["closeReason"] = "manual",
): { success: boolean; closed?: ClosedPosition; error?: string } {
  const data = loadData();
  const idx = data.positions.findIndex((p) => p.id === positionId);
  if (idx < 0) return { success: false, error: "Position not found" };
  const pos = data.positions[idx];

  // Idempotency guard — once closed, never close again.
  if (pos.closed) {
    return { success: false, error: "Position already closed" };
  }

  const realizedPnl = pnlForPriceMove(
    {
      assetClass: pos.assetClass,
      contractSize: pos.contractSize,
      // The remaining spec fields aren't used by pnlForPriceMove.
      minVolume: 0, maxVolume: 0, volumeStep: 0.01, tickSize: 0, pipSize: null,
      leverage: 1, pricePrecision: 0,
    },
    pos.side,
    pos.volume,
    pos.entryPrice,
    exitPrice,
  );

  const closed: ClosedPosition = {
    id: pos.id,
    symbol: pos.symbol,
    side: pos.side,
    entryPrice: pos.entryPrice,
    exitPrice,
    volume: pos.volume,
    units: pos.units,
    assetClass: pos.assetClass,
    contractSize: pos.contractSize,
    realizedPnl,
    openedAt: pos.openedAt,
    closedAt: Date.now(),
    closeReason,
  };
  data.closedPositions.unshift(closed);
  // Apply realized P/L to balance. Margin is released by removing the
  // position from the array — no separate "release margin" step needed.
  data.balance += realizedPnl;

  if (realizedPnl < 0) {
    data.dailyLossAmount += Math.abs(realizedPnl);
    data.weeklyLossAmount += Math.abs(realizedPnl);
    data.consecutiveLosses += 1;
    data.lastLossAt = Date.now();
  } else {
    data.consecutiveLosses = 0;
  }

  data.positions.splice(idx, 1);
  saveData(data);
  const kind: OperationHistoryEntry["kind"] =
    closeReason === "stop_loss"
      ? "position_closed_stop_loss"
      : closeReason === "take_profit"
      ? "position_closed_take_profit"
      : "position_closed_manual";
  addHistoryEntry({
    kind,
    symbol: pos.symbol,
    side: pos.side,
    volume: pos.volume,
    price: exitPrice,
    realizedPnl,
    detail:
      closeReason === "stop_loss"
        ? `SL closed ${pos.side.toUpperCase()} ${pos.volume} ${pos.symbol} @ ${exitPrice} — P/L $${realizedPnl.toFixed(2)}`
        : closeReason === "take_profit"
        ? `TP closed ${pos.side.toUpperCase()} ${pos.volume} ${pos.symbol} @ ${exitPrice} — P/L $${realizedPnl.toFixed(2)}`
        : `Closed ${pos.side.toUpperCase()} ${pos.volume} ${pos.symbol} @ ${exitPrice} — P/L $${realizedPnl.toFixed(2)}`,
  });
  return { success: true, closed };
}

/**
 * Update unrealized P/L for every open position using the latest live
 * prices, and evaluate SL/TP triggers. Closes positions that hit SL/TP
 * exactly once (idempotent via the `closed` flag).
 *
 * Called by the markets store on every live price tick — keep it cheap.
 */
export function updateUnrealizedPnl(prices: Map<string, number>): void {
  const data = loadData();
  if (data.positions.length === 0) return;
  let changed = false;
  const toClose: Array<{ id: string; exitPrice: number; reason: ClosedPosition["closeReason"] }> = [];

  for (const pos of data.positions) {
    if (pos.closed) continue;
    const price = prices.get(pos.symbol);
    if (price === undefined) continue;

    // Use the spec snapshot on the position for P/L math.
    const realized = pnlForPriceMove(
      {
        assetClass: pos.assetClass,
        contractSize: pos.contractSize,
        minVolume: 0, maxVolume: 0, volumeStep: 0.01, tickSize: 0, pipSize: null,
        leverage: 1, pricePrecision: 0,
      },
      pos.side,
      pos.volume,
      pos.entryPrice,
      price,
    );
    pos.unrealizedPnl = realized;
    changed = true;

    // ── SL/TP evaluation ──
    if (pos.stopLoss > 0) {
      // BUY: SL triggers when price FALLS to or below SL.
      // SELL: SL triggers when price RISES to or above SL.
      if (pos.side === "buy" && price <= pos.stopLoss) {
        toClose.push({ id: pos.id, exitPrice: pos.stopLoss, reason: "stop_loss" });
        pos.closed = true;
        continue;
      }
      if (pos.side === "sell" && price >= pos.stopLoss) {
        toClose.push({ id: pos.id, exitPrice: pos.stopLoss, reason: "stop_loss" });
        pos.closed = true;
        continue;
      }
    }
    if (pos.takeProfit > 0) {
      // BUY: TP triggers when price RISES to or above TP.
      // SELL: TP triggers when price FALLS to or below TP.
      if (pos.side === "buy" && price >= pos.takeProfit) {
        toClose.push({ id: pos.id, exitPrice: pos.takeProfit, reason: "take_profit" });
        pos.closed = true;
        continue;
      }
      if (pos.side === "sell" && price <= pos.takeProfit) {
        toClose.push({ id: pos.id, exitPrice: pos.takeProfit, reason: "take_profit" });
        pos.closed = true;
        continue;
      }
    }
  }

  if (changed) saveData(data);

  // Close triggered positions AFTER the loop so we don't mutate the
  // positions array while iterating. Each close call re-loads fresh
  // data and applies realized P/L atomically.
  for (const { id, exitPrice, reason } of toClose) {
    closePosition(id, exitPrice, reason);
  }
}

/**
 * Evaluate pending orders against the latest live prices. Triggers
 * any pending order whose entry condition is met.
 *
 *   BUY LIMIT:  price falls to or below entry → buy at entry
 *   BUY STOP:   price rises to or above entry → buy at entry
 *   SELL LIMIT: price rises to or above entry → sell at entry
 *   SELL STOP:  price falls to or below entry → sell at entry
 *
 * Idempotent: once `triggered` is true, the order never fires again.
 * Risk + free-margin checks run before the position opens; if they
 * fail, the pending order is removed (NOT retried) so the trader
 * gets a clear signal rather than silent rejection.
 *
 * Called by the markets store on every live price tick.
 */
export function evaluatePendingTriggers(
  prices: Map<string, number>,
  riskRules: RiskRules,
): void {
  const data = loadData();
  if (data.pendingOrders.length === 0) return;

  const toTrigger: PendingOrder[] = [];
  for (const o of data.pendingOrders) {
    if (o.triggered) continue;
    const price = prices.get(o.symbol);
    if (price === undefined) continue;
    const hit = (() => {
      switch (o.orderType) {
        case "buy_limit":  return price <= o.price;
        case "buy_stop":   return price >= o.price;
        case "sell_limit": return price >= o.price;
        case "sell_stop":  return price <= o.price;
        default:           return false;
      }
    })();
    if (hit) {
      o.triggered = true;
      toTrigger.push(o);
    }
  }
  if (toTrigger.length === 0) return;

  // Persist the `triggered` flag so a duplicate tick can't re-fire.
  saveData(data);

  for (const o of toTrigger) {
    // Try to open the position at the pending entry price. SL/TP carry
    // over from the pending order.
    const result = openPosition(
      o.symbol,
      o.side,
      o.price,
      o.volume,
      o.stopLoss,
      o.takeProfit,
      riskRules,
    );
    if (result.success) {
      addHistoryEntry({
        kind: "pending_triggered",
        symbol: o.symbol,
        side: o.side,
        volume: o.volume,
        price: o.price,
        realizedPnl: null,
        detail: `${o.orderType.replace("_", " ")} triggered → opened ${o.side.toUpperCase()} ${o.volume} ${o.symbol} @ ${o.price}`,
      });
    } else {
      // Phase 3: do NOT silently make the rejected pending order
      // disappear. Record it in operation history with the rejection
      // reason so the trader can see exactly why it didn't fill.
      // (openPosition already wrote no position_opened entry on success;
      // here we write a pending_rejected entry on failure.)
      addHistoryEntry({
        kind: "pending_rejected",
        symbol: o.symbol,
        side: o.side,
        volume: o.volume,
        price: o.price,
        realizedPnl: null,
        detail: `${o.orderType.replace("_", " ")} on ${o.symbol} @ ${o.price} triggered but was rejected: ${result.error ?? "unknown reason"}`,
      });
    }
    cancelPendingOrder(o.id);
  }
}

export function getAccountState(prices?: Map<string, number>): {
  mode: "paper" | "real";
  startingBalance: number;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  floatingPnl: number;
} {
  const data = loadData();

  const now = Date.now();
  if (now > data.dailyLossResetAt) {
    data.dailyLossAmount = 0;
    data.dailyLossResetAt = now + 24 * 60 * 60 * 1000;
  }
  if (now > data.weeklyLossResetAt) {
    data.weeklyLossAmount = 0;
    data.weeklyLossResetAt = now + 7 * 24 * 60 * 60 * 1000;
  }

  let floatingPnl = 0;
  let margin = 0;
  for (const pos of data.positions) {
    // If a live price map is provided, recompute P/L on the fly so
    // account metrics stay current between ticks (e.g. when reading
    // immediately after a price update but before the next rAF
    // coalesced refresh).
    if (prices) {
      const price = prices.get(pos.symbol);
      if (price !== undefined) {
        pos.unrealizedPnl = pnlForPriceMove(
          {
            assetClass: pos.assetClass,
            contractSize: pos.contractSize,
            minVolume: 0, maxVolume: 0, volumeStep: 0.01, tickSize: 0, pipSize: null,
            leverage: 1, pricePrecision: 0,
          },
          pos.side,
          pos.volume,
          pos.entryPrice,
          price,
        );
      }
    }
    floatingPnl += pos.unrealizedPnl;
    margin += pos.requiredMargin;
  }

  const equity = data.balance + floatingPnl;
  const freeMargin = equity - margin;
  const marginLevel = margin > 0 ? (equity / margin) * 100 : 0;

  return {
    mode: "paper",
    startingBalance: data.startingBalance,
    balance: data.balance,
    equity,
    margin,
    freeMargin,
    marginLevel,
    floatingPnl,
  };
}

export function getOpenPositions(): Position[] {
  return loadData().positions;
}

export function getClosedPositions(): ClosedPosition[] {
  return loadData().closedPositions;
}

export function getPendingOrders(): PendingOrder[] {
  return loadData().pendingOrders;
}

/** Cancel a pending order by its ID. Returns true if removed. */
export function cancelPendingOrder(orderId: string): boolean {
  const data = loadData();
  const idx = data.pendingOrders.findIndex((o) => o.id === orderId);
  if (idx < 0) return false;
  const cancelled = data.pendingOrders[idx];
  data.pendingOrders.splice(idx, 1);
  saveData(data);
  // Only record a cancellation if the order wasn't already triggered
  // (a triggered order is removed by `evaluatePendingTriggers` after it
  // opens a position or is rejected — those have their own history kinds).
  if (!cancelled.triggered) {
    addHistoryEntry({
      kind: "pending_cancelled",
      symbol: cancelled.symbol,
      side: cancelled.side,
      volume: cancelled.volume,
      price: cancelled.price,
      realizedPnl: null,
      detail: `Cancelled ${cancelled.orderType.replace("_", " ")} on ${cancelled.symbol} @ ${cancelled.price}`,
    });
  }
  return true;
}

/**
 * Place a new pending order. Risk rules + free-margin are checked up
 * front so we don't queue orders that can never trigger.
 */
export function placePendingOrder(
  symbol: string,
  side: OrderSide,
  orderType: Exclude<OrderType, "market">,
  price: number,
  volume: number,
  stopLoss: number = 0,
  takeProfit: number = 0,
  riskRules?: RiskRules,
): { success: boolean; order?: PendingOrder; error?: string } {
  const data = loadData();
  const spec = getSpecForSymbol(symbol);
  const units = unitsForVolume(spec, volume);
  const margin = calcRequiredMargin(spec, volume, price);

  if (riskRules) {
    let floatingPnl = 0;
    let usedMargin = 0;
    for (const pos of data.positions) {
      floatingPnl += pos.unrealizedPnl;
      usedMargin += pos.requiredMargin;
    }
    const equity = data.balance + floatingPnl;
    const freeMargin = equity - usedMargin;

    const riskCheck = checkRisk({
      side,
      entryPrice: price,
      volume,
      stopLoss,
      equity,
      positions: data.positions,
      riskRules,
      dailyLossAmount: data.dailyLossAmount,
      weeklyLossAmount: data.weeklyLossAmount,
      consecutiveLosses: data.consecutiveLosses,
      lastLossAt: data.lastLossAt,
      symbol,
    });
    if (!riskCheck.passed) {
      return { success: false, error: riskCheck.reason };
    }
    if (margin > freeMargin) {
      return {
        success: false,
        error: `Insufficient free margin: required $${margin.toFixed(2)}, available $${freeMargin.toFixed(2)}.`,
      };
    }
  }

  const order: PendingOrder = {
    id: `pnd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    symbol,
    side,
    orderType,
    price,
    volume,
    units,
    assetClass: spec.assetClass,
    contractSize: spec.contractSize,
    requiredMargin: margin,
    stopLoss,
    takeProfit,
    createdAt: Date.now(),
    triggered: false,
  };
  data.pendingOrders.push(order);
  saveData(data);
  addHistoryEntry({
    kind: "pending_placed",
    symbol,
    side,
    volume,
    price,
    realizedPnl: null,
    detail: `Placed ${orderType.replace("_", " ")} ${side.toUpperCase()} ${volume} ${symbol} @ ${price}`,
  });
  return { success: true, order };
}

/** Close a list of positions by id at given exit prices (Map by symbol).
    Returns the number actually closed. */
export function closePositionsByIds(
  positionIds: string[],
  exitPriceBySymbol: Map<string, number>,
): { closed: number; realizedPnl: number } {
  let closed = 0;
  let totalPnl = 0;
  for (const id of positionIds) {
    const pos = loadData().positions.find((p) => p.id === id);
    if (!pos) continue;
    const exit = exitPriceBySymbol.get(pos.symbol);
    if (exit === undefined) continue;
    const result = closePosition(id, exit, "manual");
    if (result.success && result.closed) {
      closed += 1;
      totalPnl += result.closed.realizedPnl;
    }
  }
  return { closed, realizedPnl: totalPnl };
}

export function resetPaperAccount(): void {
  saveData(defaultData());
  addHistoryEntry({
    kind: "account_reset",
    symbol: null,
    side: null,
    volume: null,
    price: null,
    realizedPnl: null,
    detail: `Virtual account reset to $${DEFAULT_STARTING_BALANCE.toFixed(2)}`,
  });
}
