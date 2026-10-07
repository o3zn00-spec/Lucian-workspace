// LUCIAN Markets — instruments catalog.
//
// The reference trading terminal shows ~100 instruments across forex,
// crypto, indices, metals, energies, and intraday CFD stocks. Each entry
// carries the exact price snapshot from the reference, so the panel
// looks identical to the source without inventing fake "live" data.
// Crypto symbols that the Bybit provider supports will overlay real
// prices via the markets store; everything else shows the snapshot.

import type { AssetClass, Instrument } from "./types";

/** UI category used by the filter chips. */
export type InstrumentCategory =
  | "favorites"
  | "all"
  | "forex"
  | "crypto"
  | "indices"
  | "metals"
  | "energies"
  | "intraday";

export interface CatalogInstrument extends Instrument {
  /** UI category shown in the filter chips. */
  category: Exclude<InstrumentCategory, "all" | "favorites">;
  /** Small text badge shown in the icon slot (e.g. "BTC", "EUR", "Au"). */
  badge: string;
  /** Whether the market is currently open. false → "Market closed". */
  marketOpen: boolean;
  /** Snapshot bid price (left column). */
  bid: number;
  /** Snapshot ask price (right column). */
  ask: number;
  /** 24h low (sub-label under bid). */
  low: number;
  /** 24h high (sub-label under ask). */
  high: number;
  /** 24h change percent. null = "Market closed" status. */
  changePct: number | null;
  /** Spread value shown as "S: X.X" after the change percent. */
  spread: number;
}

/** Helper to keep the row definitions terse. Order matches the
    reference screenshot top-to-bottom. */
type Row = [
  symbol: string,
  name: string,
  assetClass: AssetClass,
  category: CatalogInstrument["category"],
  badge: string,
  marketOpen: boolean,
  bid: number,
  low: number,
  ask: number,
  high: number,
  changePct: number | null,
  spread: number,
  pricePrecision: number,
];

const ROWS: Row[] = [
  // ─── Forex majors & crosses ─────────────────────────────────────
  ["XAUUSD", "Gold / US Dollar", "metals", "metals", "Au", false, 4603.04, 4508.71, 4603.92, 4632.14, null, 0, 2],
  ["BTCUSD", "Bitcoin / US Dollar", "crypto", "crypto", "₿", true, 77128.25, 77023.10, 77156.56, 77431.00, 0.04, 283.1, 2],
  ["EURUSD", "Euro / US Dollar", "forex", "forex", "EUR", false, 1.16744, 1.16682, 1.16796, 1.17109, null, 0, 5],
  ["ETHUSD", "Ethereum / US Dollar", "crypto", "crypto", "Ξ", true, 2414.78, 2408.10, 2416.67, 2432.37, -0.29, 18.9, 2],
  ["USDJPY", "US Dollar / Japanese Yen", "forex", "forex", "JPY", false, 158.932, 158.344, 158.982, 159.124, null, 0, 3],
  ["GBPUSD", "British Pound / US Dollar", "forex", "forex", "GBP", false, 1.36385, 1.36177, 1.36486, 1.36749, null, 0, 5],
  ["NAS100", "US Nasdaq 100", "indices", "indices", "NDX", false, 29303.3, 29150.3, 29306.2, 29468.6, null, 0, 1],
  ["US30", "Dow Jones 30", "indices", "indices", "DJI", false, 53268.2, 52781.0, 53278.8, 53361.0, null, 0, 1],
  ["GBPJPY", "British Pound / Japanese Yen", "forex", "forex", "JPY", false, 216.800, 216.448, 216.987, 217.096, null, 0, 3],
  ["XTIUSD", "WTI Crude Oil", "energies", "energies", "WTI", false, 86.44, 85.58, 86.54, 87.26, null, 0, 2],
  ["AUDUSD", "Australian Dollar / US Dollar", "forex", "forex", "AUD", false, 0.71679, 0.71065, 0.71731, 0.71793, null, 0, 5],
  ["TSLA.Daily", "Tesla Inc. (Daily)", "stocks", "intraday", "TSL", false, 362.91, 346.88, 363.20, 366.33, null, 0, 2],
  ["XAGUSD", "Silver / US Dollar", "metals", "metals", "Ag", false, 68.964, 67.871, 69.053, 69.992, null, 0, 3],
  ["NVDA.Daily", "NVIDIA Corp. (Daily)", "stocks", "intraday", "NVD", false, 214.96, 214.48, 215.13, 218.63, null, 0, 2],
  ["USDCAD", "US Dollar / Canadian Dollar", "forex", "forex", "CAD", false, 1.37618, 1.37311, 1.37667, 1.37887, null, 0, 5],
  ["USDCHF", "US Dollar / Swiss Franc", "forex", "forex", "CHF", false, 0.80096, 0.79823, 0.80152, 0.80201, null, 0, 5],
  ["EURJPY", "Euro / Japanese Yen", "forex", "forex", "JPY", false, 185.589, 185.428, 185.686, 186.012, null, 0, 3],
  ["BTCUSD.Daily", "Bitcoin Daily", "crypto", "crypto", "₿", true, 77127.90, 77024.10, 77154.90, 77432.00, 0.04, 270.0, 2],
  ["XRPUSD", "Ripple / US Dollar", "crypto", "crypto", "XRP", true, 1.47662, 1.45972, 1.48028, 1.51156, 1.16, 36.6, 5],
  ["NZDUSD", "New Zealand Dollar / US Dollar", "forex", "forex", "NZD", false, 0.59737, 0.59387, 0.59801, 0.59872, null, 0, 5],
  ["XBRUSD", "Brent Crude Oil", "energies", "energies", "BRT", false, 94.11, 93.07, 94.22, 94.88, null, 0, 2],
  ["SOLUSD", "Solana / US Dollar", "crypto", "crypto", "SOL", true, 94.11, 93.34, 94.63, 96.33, 0.53, 5.2, 2],
  ["EURGBP", "Euro / British Pound", "forex", "forex", "EUR", false, 0.85551, 0.85551, 0.85611, 0.85757, null, 0, 5],
  ["AUDJPY", "Australian Dollar / Japanese Yen", "forex", "forex", "JPY", false, 113.965, 113.054, 114.025, 114.154, null, 0, 3],
  ["EURAUD", "Euro / Australian Dollar", "forex", "forex", "EUR", false, 1.62785, 1.62699, 1.62895, 1.64239, null, 0, 5],
  ["ETHUSD.Daily", "Ethereum Daily", "crypto", "crypto", "Ξ", true, 2414.85, 2408.20, 2416.70, 2432.52, -0.30, 18.5, 2],
  ["BCHUSD", "Bitcoin Cash / US Dollar", "crypto", "crypto", "BCH", true, 273.64, 271.96, 276.08, 278.83, -0.50, 24.4, 2],
  ["GBPAUD", "British Pound / Australian Dollar", "forex", "forex", "GBP", false, 1.90254, 1.89994, 1.90361, 1.91694, null, 0, 5],
  ["LTCUSD", "Litecoin / US Dollar", "crypto", "crypto", "LTC", true, 51.34, 51.20, 51.72, 52.59, -1.78, 3.8, 2],
  ["DOGEUSD", "Dogecoin / US Dollar", "crypto", "crypto", "DGE", true, 0.09116, 0.09101, 0.09184, 0.09372, -0.42, 6.8, 5],
  ["CHFJPY", "Swiss Franc / Japanese Yen", "forex", "forex", "JPY", false, 198.359, 198.196, 198.453, 198.998, null, 0, 3],
  ["SPX500", "S&P 500", "indices", "indices", "SPX", false, 7673.0, 7646.4, 7675.0, 7698.9, null, 0, 1],
  ["EURNZD", "Euro / New Zealand Dollar", "forex", "forex", "EUR", false, 1.95264, 1.95105, 1.95417, 1.96513, null, 0, 5],
  ["GBPCAD", "British Pound / Canadian Dollar", "forex", "forex", "GBP", false, 1.87776, 1.87402, 1.87860, 1.88009, null, 0, 5],
  ["EURCHF", "Euro / Swiss Franc", "forex", "forex", "EUR", false, 0.93535, 0.93406, 0.93593, 0.93624, null, 0, 5],
  ["EURCAD", "Euro / Canadian Dollar", "forex", "forex", "EUR", false, 1.60708, 1.60532, 1.60770, 1.61061, null, 0, 5],
  ["NZDJPY", "New Zealand Dollar / Japanese Yen", "forex", "forex", "JPY", false, 94.989, 94.443, 95.083, 95.153, null, 0, 3],
  ["CADJPY", "Canadian Dollar / Japanese Yen", "forex", "forex", "JPY", false, 115.448, 115.204, 115.512, 115.575, null, 0, 3],
  ["GBPNZD", "British Pound / New Zealand Dollar", "forex", "forex", "GBP", false, 2.28101, 2.27917, 2.28328, 2.29370, null, 0, 5],
  ["GBPCHF", "British Pound / Swiss Franc", "forex", "forex", "GBP", false, 1.09278, 1.09024, 1.09384, 1.09351, null, 0, 5],
  ["JPN225", "Nikkei 225", "indices", "indices", "N225", false, 65960, 65165, 66017, 66439, null, 0, 0],
  ["USDMXN", "US Dollar / Mexican Peso", "forex", "forex", "MXN", false, 16.9119, 16.8831, 16.9232, 16.9657, null, 0, 4],
  ["BNBUSD", "BNB / US Dollar", "crypto", "crypto", "BNB", true, 692.85, 691.44, 694.85, 699.75, -0.22, 20.0, 2],
  ["AUDCAD", "Australian Dollar / Canadian Dollar", "forex", "forex", "AUD", false, 0.98633, 0.97914, 0.98787, 0.98793, null, 0, 5],
  ["XRPUSD.Daily", "Ripple Daily", "crypto", "crypto", "XRP", true, 1.47662, 1.45972, 1.48028, 1.51157, 1.16, 36.6, 5],
  ["GER40", "DAX 40", "indices", "indices", "DAX", false, 26123.2, 25974.0, 26132.2, 26171.8, null, 0, 1],
  ["USDZAR", "US Dollar / South African Rand", "forex", "forex", "ZAR", false, 16.06120, 15.98480, 16.09018, 16.11665, null, 0, 5],
  ["NAS100.Daily", "Nasdaq 100 Daily", "indices", "indices", "NDX", false, 29306.7, 29150.5, 29309.2, 29468.8, null, 0, 1],
  ["XNGUSD", "Natural Gas / US Dollar", "energies", "energies", "XNG", false, 2.778, 2.745, 2.843, 2.808, null, 0, 3],
  ["AUDNZD", "Australian Dollar / New Zealand Dollar", "forex", "forex", "AUD", false, 1.19861, 1.19478, 1.20041, 1.19993, null, 0, 5],
  ["AUDCHF", "Australian Dollar / Swiss Franc", "forex", "forex", "AUD", false, 0.57438, 0.56869, 0.57477, 0.57500, null, 0, 5],
  ["CADCHF", "Canadian Dollar / Swiss Franc", "forex", "forex", "CAD", false, 0.58178, 0.57994, 0.58238, 0.58234, null, 0, 5],
  ["ADAUSD", "Cardano / US Dollar", "crypto", "crypto", "ADA", true, 0.2202, 0.2197, 0.2243, 0.2269, -1.65, 4.1, 4],
  ["NZDCAD", "New Zealand Dollar / Canadian Dollar", "forex", "forex", "CAD", false, 0.82275, 0.81848, 0.82344, 0.82400, null, 0, 5],
  ["AAVEUSD", "Aave / US Dollar", "crypto", "crypto", "AAV", true, 123.92, 123.03, 124.62, 127.05, -1.71, 7.0, 2],
  ["NZDCHF", "New Zealand Dollar / Swiss Franc", "forex", "forex", "CHF", false, 0.47868, 0.47467, 0.47926, 0.47928, null, 0, 5],
  ["BCHUSD.Daily", "Bitcoin Cash Daily", "crypto", "crypto", "BCH", true, 273.74, 272.06, 275.98, 278.93, -0.50, 22.4, 2],
  ["SOLUSD.Daily", "Solana Daily", "crypto", "crypto", "SOL", true, 94.16, 93.39, 94.59, 96.38, 0.53, 4.3, 2],
  ["US30.Daily", "Dow Jones 30 Daily", "indices", "indices", "DJI", false, 53269.8, 52781.8, 53272.3, 53361.8, null, 0, 1],
  ["ALGOUSD", "Algorand / US Dollar", "crypto", "crypto", "ALG", true, 0.0876, 0.0874, 0.0961, 0.0900, -0.79, 8.5, 4],
  ["UNIUSD", "Uniswap / US Dollar", "crypto", "crypto", "UNI", true, 4.169, 4.154, 4.249, 4.336, -2.09, 8.0, 3],
  ["ETCUSD", "Ethereum Classic / US Dollar", "crypto", "crypto", "ETC", true, 7.745, 7.730, 7.845, 7.950, -1.29, 10.0, 3],
  ["TRXUSD", "TRON / US Dollar", "crypto", "crypto", "TRX", true, 0.34441, 0.34385, 0.34468, 0.34564, 0.06, 2.7, 5],
  ["LTCUSD.Daily", "Litecoin Daily", "crypto", "crypto", "LTC", true, 51.35, 51.21, 51.70, 52.60, -1.78, 3.5, 2],
  ["AVAXUSD", "Avalanche / US Dollar", "crypto", "crypto", "AVX", true, 7.343, 7.325, 7.548, 7.472, -0.66, 20.5, 3],
  ["ATOMUSD", "Cosmos / US Dollar", "crypto", "crypto", "ATM", true, 1.506, 1.502, 1.608, 1.537, -1.44, 10.2, 3],
  ["EURMXN", "Euro / Mexican Peso", "forex", "forex", "MXN", false, 19.7451, 19.7244, 19.7651, 19.8022, null, 0, 4],
  ["GBPZAR", "British Pound / South African Rand", "forex", "forex", "ZAR", false, 21.83474, 21.79900, 21.86474, 21.97499, null, 0, 5],
  ["DOTUSD", "Polkadot / US Dollar", "crypto", "crypto", "DOT", true, 0.867, 0.866, 0.951, 0.890, -1.37, 8.4, 3],
  ["UK100", "FTSE 100", "indices", "indices", "FTSE", false, 10808.1, 10727.3, 10819.4, 10836.9, null, 0, 1],
  ["EURZAR", "Euro / South African Rand", "forex", "forex", "ZAR", false, 18.68030, 18.66583, 18.71930, 18.82673, null, 0, 5],
  ["AXSUSD", "Axie Infinity / US Dollar", "crypto", "crypto", "AXS", true, 0.72, 0.72, 1.23, 0.77, -4.00, 5.1, 2],
  ["MANAUSD", "Decentraland / US Dollar", "crypto", "crypto", "MNA", true, 0.0635, 0.0634, 0.0835, 0.0670, -1.70, 20.0, 4],
  ["GBPMXN", "British Pound / Mexican Peso", "forex", "forex", "MXN", false, 23.0675, 23.0252, 23.0876, 23.1154, null, 0, 4],
  ["SPX500.Daily", "S&P 500 Daily", "indices", "indices", "SPX", false, 7672.7, 7646.4, 7674.7, 7698.9, null, 0, 1],
  ["ZECUSD", "Zcash / US Dollar", "crypto", "crypto", "ZEC", true, 793.00, 783.57, 794.00, 806.27, -1.05, 10.0, 2],
  ["NEARUSD", "NEAR Protocol / US Dollar", "crypto", "crypto", "NEAR", true, 1.817, 1.813, 1.916, 1.870, -0.16, 9.9, 3],
  ["IOTAUSD", "IOTA / US Dollar", "crypto", "crypto", "IOT", true, 0.0425, 0.0422, 0.0471, 0.0443, -0.23, 4.6, 4],
  ["ICPUSD", "Internet Computer / US Dollar", "crypto", "crypto", "ICP", false, 2.370, 2.291, 2.548, 2.410, null, 0, 3],
  ["XTIUSD.Daily", "WTI Crude Oil Daily", "energies", "energies", "WTI", false, 86.48, 85.60, 86.56, 87.28, null, 0, 2],
  ["LINKUSD", "Chainlink / US Dollar", "crypto", "crypto", "LNK", true, 11.480, 11.442, 11.568, 11.678, -1.08, 8.8, 3],
  ["GRTUSD", "The Graph / US Dollar", "crypto", "crypto", "GRT", true, 0.0146, 0.0146, 0.0173, 0.0150, -2.01, 2.7, 4],
  ["FILUSD", "Filecoin / US Dollar", "crypto", "crypto", "FIL", true, 0.614, 0.612, 0.891, 0.633, -1.60, 27.7, 3],
  ["AUS200", "S&P/ASX 200", "indices", "indices", "ASX", false, 9069.7, 9017.3, 9085.8, 9086.4, null, 0, 1],
  ["XBRUSD.Daily", "Brent Crude Oil Daily", "energies", "energies", "BRT", false, 94.14, 93.09, 94.23, 94.90, null, 0, 2],
  ["DASHUSD", "Dash / US Dollar", "crypto", "crypto", "DSH", true, 41.44, 40.50, 41.68, 42.74, 1.30, 2.4, 2],
  ["FRA40", "CAC 40", "indices", "indices", "CAC", false, 8473.3, 8442.1, 8482.6, 8494.9, null, 0, 1],
  ["EUSTX50", "Euro Stoxx 50", "indices", "indices", "SX5E", false, 6458.8, 6418.8, 6468.4, 6474.0, null, 0, 1],
  ["ESP35", "IBEX 35", "indices", "indices", "IBX", false, 19934.0, 19825.0, 19959.0, 20000.0, null, 0, 1],
  ["NFLX.Daily", "Netflix Inc. (Daily)", "stocks", "intraday", "NFL", false, 79.54, 79.10, 79.71, 80.40, null, 0, 2],
  ["AMZN.Daily", "Amazon.com (Daily)", "stocks", "intraday", "AMZ", false, 258.68, 256.98, 258.89, 260.97, null, 0, 2],
  ["AAPL.Daily", "Apple Inc. (Daily)", "stocks", "intraday", "AAP", false, 309.84, 306.94, 310.09, 312.09, null, 0, 2],
  ["GOOGL.Daily", "Alphabet Inc. (Daily)", "stocks", "intraday", "GGL", false, 344.93, 340.19, 345.40, 345.97, null, 0, 2],
  ["META.Daily", "Meta Platforms (Daily)", "stocks", "intraday", "MTA", false, 549.91, 543.10, 550.18, 553.73, null, 0, 2],
  ["BABA.Daily", "Alibaba Group (Daily)", "stocks", "intraday", "BAB", false, 119.67, 119.16, 119.84, 125.48, null, 0, 2],
  ["MMM.Daily", "3M Co. (Daily)", "stocks", "intraday", "MMM", false, 178.83, 178.18, 179.03, 180.85, null, 0, 2],
  ["MSFT.Daily", "Microsoft Corp. (Daily)", "stocks", "intraday", "MSF", false, 483.28, 478.39, 483.49, 486.26, null, 0, 2],
  ["AMD.Daily", "Adv. Micro Devices (Daily)", "stocks", "intraday", "AMD", false, 471.24, 461.53, 472.48, 476.35, null, 0, 2],
  ["SHOP.Daily", "Shopify Inc. (Daily)", "stocks", "intraday", "SHP", false, 149.14, 144.94, 149.34, 149.36, null, 0, 2],
  ["LRCUSD", "Loopring / US Dollar", "crypto", "crypto", "LRC", true, 0.0021, 0.0015, 0.0154, 0.0023, 23.53, 13.3, 4],
];

/** Known quote currencies used to split forex/crypto pairs.
    Longest first so "USDT" wins over "USD" when matching. */
const QUOTE_CODES = ["USDT", "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "MXN", "ZAR"];

/** Extract the base currency / ticker prefix from a symbol.
    Examples:
      BTCUSD       → BTC
      BTCUSD.Daily → BTC
      EURUSD       → EUR
      USDJPY       → USD
      XAUUSD       → XAU
      XTIUSD       → XTI
      TSLA.Daily   → TSLA
      NAS100       → NAS100  (no quote-currency match → return whole)
      JPN225       → JPN225  */
function deriveBase(symbol: string): string {
  // Strip ".Daily" suffix first.
  const clean = symbol.replace(/\.Daily$/i, "");
  // Try matching each known quote currency at the end of the symbol.
  // Longest first so USDT is matched before USD.
  for (const q of QUOTE_CODES) {
    if (clean.length > q.length && clean.endsWith(q)) {
      return clean.slice(0, -q.length);
    }
  }
  return clean;
}

/** Materialized catalog (converted from terse row tuples). */
export const INSTRUMENT_CATALOG: CatalogInstrument[] = ROWS.filter(
  (r) => r[3] === "crypto",
).map(
  (r) => ({
    symbol: r[0],
    name: r[1],
    assetClass: r[2],
    category: r[3],
    badge: r[4],
    marketOpen: r[5],
    bid: r[6],
    low: r[7],
    ask: r[8],
    high: r[9],
    changePct: r[10],
    spread: r[11],
    pricePrecision: r[12],
    base: deriveBase(r[0]),
    quote: "USD",
    quantityPrecision: 2,
  }),
);

/** Filter the catalog by UI category. "all" returns everything;
    "favorites" returns an empty list (the panel will intersect this
    with the actual favorites set). */
export function filterByCategory(
  category: InstrumentCategory,
): CatalogInstrument[] {
  if (category === "all") return INSTRUMENT_CATALOG;
  if (category === "favorites") return INSTRUMENT_CATALOG; // caller filters
  return INSTRUMENT_CATALOG.filter((i) => i.category === category);
}

/** Look up a single instrument by its symbol. Returns null if not found. */
export function getInstrumentBySymbol(
  symbol: string,
): CatalogInstrument | null {
  return INSTRUMENT_CATALOG.find((i) => i.symbol === symbol) ?? null;
}
