// Centralized LUCIAN ↔ Bybit symbol mapping.
//
// LUCIAN's instrument catalog uses quote-suffix symbols in the form `BTCUSD`
// (and `BTCUSD.Daily` for the daily variant). Bybit's V5 API uses USDT
// pairs (`BTCUSDT`). This module is the SINGLE source of truth for that
// conversion so individual components never sprinkle `.replace("USD","USDT")`
// calls throughout the codebase.
//
// Rules:
//   - `BTCUSD`           → `BTCUSDT`
//   - `BTCUSD.Daily`     → `BTCUSDT`  (Daily variants map to the same Bybit pair)
//   - `ETHUSD`           → `ETHUSDT`
//   - `SOLUSD`           → `SOLUSDT`
//   - non-crypto (EURUSD, XAUUSD, NAS100, …) → null (no Bybit equivalent)
//
// The list of crypto bases is intentionally aligned with the symbols in the
// instrument catalog (`@/lib/markets/catalog.ts`). Add new bases here when
// new crypto instruments are added to the catalog.

import { INSTRUMENT_CATALOG } from "@/lib/markets/catalog";

/**
 * Crypto bases that Bybit's public USDT market supports. Anything in the
 * catalog whose base matches one of these is treated as a LIVE crypto symbol.
 *
 * Keep this list in sync with the crypto rows in `catalog.ts`.
 */
export const CRYPTO_BASES: ReadonlySet<string> = new Set([
  "BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "DOGE", "AVAX", "DOT", "LINK",
  "LTC", "TRX", "ATOM", "NEAR", "MATIC", "APT", "FIL", "ARB", "OP", "INJ",
  "BCH", "AAVE", "ALGO", "UNI", "ETC", "AXS", "MANA", "ZEC", "IOTA", "ICP",
  "LRC", "DASH", "GRT",
]);

/**
 * Returns the LUCIAN catalog base currency (e.g. `BTC` for `BTCUSD` or
 * `BTCUSD.Daily`). Returns the cleaned input when no known quote suffix is
 * matched (so non-forex/crypto symbols like `NAS100` round-trip unchanged).
 */
export function getLucianBase(symbol: string): string {
  // Strip ".Daily" suffix first.
  const clean = symbol.replace(/\.Daily$/i, "");
  const QUOTE_CODES = ["USDT", "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "MXN", "ZAR"];
  for (const q of QUOTE_CODES) {
    if (clean.length > q.length && clean.endsWith(q)) {
      return clean.slice(0, -q.length);
    }
  }
  return clean;
}

/**
 * True when the LUCIAN symbol is a supported Bybit USDT crypto pair.
 * Used by the markets store + UI to decide between LIVE data and REFERENCE data.
 */
export function isSupportedCrypto(symbol: string): boolean {
  return CRYPTO_BASES.has(getLucianBase(symbol));
}

/**
 * Convert a LUCIAN symbol into the Bybit API symbol.
 *   BTCUSD       → BTCUSDT
 *   BTCUSD.Daily → BTCUSDT
 *   ETHUSD       → ETHUSDT
 * Throws if the symbol is not a supported crypto pair — callers should check
 * `isSupportedCrypto` first when handling unknown input.
 */
export function toBybitSymbol(lucianSymbol: string): string {
  const base = getLucianBase(lucianSymbol);
  if (!CRYPTO_BASES.has(base)) {
    throw new Error(
      `toBybitSymbol: ${lucianSymbol} is not a supported Bybit USDT pair`,
    );
  }
  return `${base}USDT`;
}

/**
 * Reverse mapping: given a Bybit API symbol like `BTCUSDT`, return the
 * canonical LUCIAN symbol (`BTCUSD`). Useful when consuming the Bybit
 * provider's `listInstruments()` and we want to merge the result with the
 * LUCIAN catalog metadata.
 */
export function fromBybitSymbol(bybitSymbol: string): string | null {
  if (!bybitSymbol.endsWith("USDT")) return null;
  const base = bybitSymbol.slice(0, -"USDT".length);
  if (!CRYPTO_BASES.has(base)) return null;
  return `${base}USD`;
}

/**
 * Lazy-built lookup: every LUCIAN catalog symbol that has a real Bybit
 * equivalent. Used by the markets store to seed the LIVE instrument set.
 */
export const LIVE_CRYPTO_LUCIAN_SYMBOLS: string[] = INSTRUMENT_CATALOG
  .filter((i) => isSupportedCrypto(i.symbol))
  .map((i) => i.symbol);
