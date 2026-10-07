// LUCIAN Markets — Centralized Instrument Specifications.
//
// ONE source of truth for per-asset-class trading rules: contract size,
// lot/volume constraints, tick/pip sizes, leverage, and P/L math. UI
// components and the paper-trading engine both consult this module so
// the volume stepper, margin display, and P/L calculation can never
// drift apart.
//
// These are PAPER-TRADING specifications — sensible defaults chosen so
// the virtual account behaves like a real leveraged trading terminal.
// They are NOT real broker contract specs (no real broker is connected
// in Phase 2). Adding a real broker later means swapping these specs
// for the broker's contract table — the calculation helpers below
// remain unchanged.

import type { AssetClass } from "./types";
import { getInstrumentBySymbol } from "./catalog";
import { isSupportedCrypto } from "./symbol-mapping";

/**
 * Per-asset-class trading specification.
 *
 * `contractSize` is the unit multiplier per 1.00 lot. For forex majors
 * it's 100,000 (1 standard lot = 100,000 base currency units). For
 * crypto it's 1 (1 lot = 1 coin). For metals (XAU) it's 100 oz per lot.
 */
export interface InstrumentSpec {
  /** Asset class this spec applies to. */
  assetClass: AssetClass;
  /** Units per 1.00 lot. Forex=100_000, Crypto=1, Metals=100, Indices=1, Stocks=1, Energies=100. */
  contractSize: number;
  /** Minimum tradeable volume in lots. */
  minVolume: number;
  /** Maximum tradeable volume in lots. */
  maxVolume: number;
  /** Volume step (smallest increment). */
  volumeStep: number;
  /** Tick size — smallest price movement. */
  tickSize: number;
  /** Pip size where applicable (forex/metals). null for assets without pips. */
  pipSize: number | null;
  /** Default leverage for this asset class (1 = no leverage). */
  leverage: number;
  /** Decimal places for price display. */
  pricePrecision: number;
}

/**
 * Per-asset-class defaults. Individual instruments can override fields
 * via {@link getSpecForSymbol} which merges catalog metadata with the
 * class default.
 */
export const ASSET_CLASS_SPECS: Record<AssetClass, InstrumentSpec> = {
  forex: {
    assetClass: "forex",
    contractSize: 100_000, // 1 lot = 100,000 base currency units
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.00001,
    pipSize: 0.0001, // 1 pip = 0.0001 for non-JPY pairs
    leverage: 30,
    pricePrecision: 5,
  },
  crypto: {
    assetClass: "crypto",
    contractSize: 1, // 1 lot = 1 coin
    minVolume: 0.01,
    maxVolume: 1000,
    volumeStep: 0.01,
    tickSize: 0.01,
    pipSize: null, // crypto uses tick, not pip
    leverage: 5,
    pricePrecision: 2,
  },
  metals: {
    assetClass: "metals",
    contractSize: 100, // 1 lot = 100 oz (XAU/USD standard)
    minVolume: 0.01,
    maxVolume: 50,
    volumeStep: 0.01,
    tickSize: 0.01,
    pipSize: 0.1,
    leverage: 20,
    pricePrecision: 2,
  },
  indices: {
    assetClass: "indices",
    contractSize: 1, // 1 lot = 1 index point × $1
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.1,
    pipSize: null,
    leverage: 10,
    pricePrecision: 1,
  },
  stocks: {
    assetClass: "stocks",
    contractSize: 1, // 1 lot = 1 share
    minVolume: 0.01,
    maxVolume: 10000,
    volumeStep: 0.01,
    tickSize: 0.01,
    pipSize: null,
    leverage: 5,
    pricePrecision: 2,
  },
  energies: {
    assetClass: "energies",
    contractSize: 100, // 1 lot = 100 barrels (WTI/Brent standard)
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.01,
    pipSize: null,
    leverage: 10,
    pricePrecision: 2,
  },
  commodities: {
    assetClass: "commodities",
    contractSize: 100,
    minVolume: 0.01,
    maxVolume: 100,
    volumeStep: 0.01,
    tickSize: 0.01,
    pipSize: null,
    leverage: 10,
    pricePrecision: 2,
  },
};

/**
 * Resolve the InstrumentSpec for a given LUCIAN catalog symbol.
 *
 * Merges the asset-class default with any per-instrument overrides
 * from the catalog (currently `pricePrecision` is the only field the
 * catalog controls; everything else comes from the class default).
 *
 * Falls back to a sane default (forex-like) if the symbol is unknown.
 */
export function getSpecForSymbol(symbol: string): InstrumentSpec {
  const inst = getInstrumentBySymbol(symbol);
  if (!inst) {
    return { ...ASSET_CLASS_SPECS.forex };
  }
  const base = { ...ASSET_CLASS_SPECS[inst.assetClass] };
  // Catalog controls display precision (some symbols like JPY pairs
  // have precision 3 instead of 5).
  base.pricePrecision = inst.pricePrecision;
  // Crypto specs come from the live provider (Bybit). The catalog's
  // snapshot bid/ask is used as the price-fallback before the first
  // live tick — the spec itself doesn't depend on the snapshot.
  void isSupportedCrypto; // referenced for documentation — kept import live
  return base;
}

/* ── Pure calculation helpers ──────────────────────────────────────
   These are the ONLY functions the paper-trading engine and UI use to
   convert between volume, units, notional, margin, and P/L. Centralizing
   them here means a spec change (e.g. raising crypto leverage from 5x
   to 10x) propagates everywhere without touching call sites. */

/**
 * Convert a volume in lots into the actual number of underlying units
 * the position represents.
 *   Forex:  0.10 lots × 100,000 = 10,000 base currency units
 *   Crypto: 0.10 lots × 1       = 0.10 coins
 *   Metals: 0.10 lots × 100     = 10 oz
 */
export function unitsForVolume(spec: InstrumentSpec, volume: number): number {
  return volume * spec.contractSize;
}

/**
 * Notional exposure = units × price.
 * This is the total market value of the position — NOT the margin
 * required to open it.
 */
export function notionalValue(spec: InstrumentSpec, volume: number, price: number): number {
  return unitsForVolume(spec, volume) * price;
}

/**
 * Required margin to open a position of the given volume at the given
 * price. Equals notional / leverage.
 *
 *   Crypto, 0.10 lots BTC @ $77,000, 5x leverage:
 *     notional = 0.10 × 1 × 77000 = $7,700
 *     required margin = 7700 / 5 = $1,540
 */
export function requiredMargin(spec: InstrumentSpec, volume: number, price: number): number {
  if (spec.leverage <= 0) return notionalValue(spec, volume, price);
  return notionalValue(spec, volume, price) / spec.leverage;
}

/**
 * Dollar value of a single pip movement for a position of the given
 * units. For non-pip assets (crypto/indices/stocks), this returns the
 * dollar value of a single tick instead.
 *
 *   Forex, 10,000 units EUR/USD: 1 pip = $1.00 (10,000 × 0.0001)
 *   Crypto, 0.10 BTC:            1 tick ($0.01) = $0.001
 */
export function pipValuePerUnit(spec: InstrumentSpec): number {
  return spec.pipSize ?? spec.tickSize;
}

/**
 * Calculate the signed P/L for a position given its entry price and
 * the current market price. Correctly handles BUY (long) vs SELL
 * (short) direction and uses the contract size so cross-asset P/L is
 * always in quote-currency dollars.
 *
 *   BUY  0.10 BTC @ 77000, now 77500 → +0.10 × (77500−77000) = +$50
 *   SELL 0.10 BTC @ 77000, now 77500 → +0.10 × (77000−77500) = −$50
 *   BUY  0.10 EUR/USD @ 1.1000, now 1.1050 → 10,000 × 0.0050 = +$50
 */
export function pnlForPriceMove(
  spec: InstrumentSpec,
  side: "buy" | "sell",
  volume: number,
  entryPrice: number,
  currentPrice: number,
): number {
  const units = unitsForVolume(spec, volume);
  const move = side === "buy"
    ? currentPrice - entryPrice
    : entryPrice - currentPrice;
  return units * move;
}

/**
 * Validate that a volume is within the spec's constraints. Returns the
 * normalized volume (snapped to the volume step) or an error message.
 *
 * Used by the Order Details volume stepper so the user cannot submit
 * an invalid trade.
 */
export function validateVolume(
  spec: InstrumentSpec,
  volume: number,
): { ok: true; volume: number } | { ok: false; error: string } {
  if (!Number.isFinite(volume) || volume <= 0) {
    return { ok: false, error: "Volume must be a positive number." };
  }
  if (volume < spec.minVolume) {
    return {
      ok: false,
      error: `Volume below minimum (${spec.minVolume} lots) for this asset.`,
    };
  }
  if (volume > spec.maxVolume) {
    return {
      ok: false,
      error: `Volume above maximum (${spec.maxVolume} lots) for this asset.`,
    };
  }
  // Snap to volume step (rounded to step's decimal places to avoid
  // floating-point dust like 0.0100000001).
  const stepDecimals = (String(spec.volumeStep).split(".")[1] ?? "").length;
  const snapped = Number(volume.toFixed(stepDecimals));
  return { ok: true, volume: snapped };
}

/**
 * Pretty-print a volume using the spec's step precision. Used by the
 * volume stepper display so 0.01 lots shows as "0.01" not "0.0100000".
 */
export function formatVolume(spec: InstrumentSpec, volume: number): string {
  const stepDecimals = (String(spec.volumeStep).split(".")[1] ?? "").length;
  return volume.toFixed(Math.max(2, stepDecimals));
}
