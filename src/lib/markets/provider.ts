// LUCIAN Market Terminal — provider adapter architecture.
//
// LUCIAN is NOT permanently tied to one data company. Each asset class
// can have its own provider. When a provider requires API credentials
// that aren't configured, the UI honestly shows "Setup Required".
//
// Currently implemented:
//   CryptoProvider → Bybit V5 public API (real-time, no auth)
//
// Architecture-ready but NOT implemented (requires paid API keys):
//   ForexProvider, EquitiesProvider, IndicesProvider, MetalsProvider,
//   EnergiesProvider, CommoditiesProvider

import type {
  AssetClass,
  Candle,
  DataStatus,
  Instrument,
  PriceUpdate,
  Ticker,
  Timeframe,
} from "./types";

/** Interface that every market-data provider implements. */
export interface MarketDataProvider {
  /** Stable provider ID. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Asset class this provider serves. */
  assetClass: AssetClass;
  /** True when the provider is actually configured and able to call out. */
  configured: boolean;
  /** Data status — live, delayed, disconnected, or setup-required. */
  status: DataStatus;
  /** Honest explanation of the data quality. */
  statusLabel: string;

  /** List instruments available from this provider. */
  listInstruments(): Promise<Instrument[]>;

  /** Fetch historical candles. */
  getCandles(
    symbol: string,
    timeframe: Timeframe,
    limit: number,
  ): Promise<Candle[]>;

  /** Fetch the 24h ticker for a symbol. */
  getTicker(symbol: string): Promise<Ticker | null>;

  /** Subscribe to live price updates. Returns an unsubscribe function.
   *
   *  Optionally pass `onStatus` to receive WebSocket connection lifecycle
   *  events (connecting / open / closed / error) so the caller can flip
   *  the symbol's DataStatus between `live` and `disconnected` without
   *  polling the connection.
   */
  subscribePrice(
    symbol: string,
    callback: (update: PriceUpdate) => void,
    onStatus?: (status: { kind: "connecting" | "open" | "closed" | "error"; message?: string }) => void,
  ): () => void;

  /** Subscribe to live kline updates (candle-by-candle). Returns an
   *  unsubscribe function. `onStatus` works the same as in `subscribePrice`.
   */
  subscribeKline(
    symbol: string,
    timeframe: Timeframe,
    callback: (candle: Candle) => void,
    onStatus?: (status: { kind: "connecting" | "open" | "closed" | "error"; message?: string }) => void,
  ): () => void;
}

/** Registry of providers by asset class. */
const providers = new Map<AssetClass, MarketDataProvider>();

/** Register a provider for an asset class. */
export function registerProvider(provider: MarketDataProvider): void {
  providers.set(provider.assetClass, provider);
}

/** Get the provider for a given asset class (or null). */
export function getProvider(assetClass: AssetClass): MarketDataProvider | null {
  return providers.get(assetClass) ?? null;
}

/** Get all registered providers. */
export function getAllProviders(): MarketDataProvider[] {
  return Array.from(providers.values());
}

/** Get the provider for a given instrument symbol (by matching its asset class). */
export function getProviderForInstrument(instrument: Instrument): MarketDataProvider | null {
  return getProvider(instrument.assetClass);
}

/** Not-yet-implemented providers — these show "Setup Required" in the UI. */
export interface UnconfiguredProvider {
  id: string;
  label: string;
  assetClass: AssetClass;
  status: DataStatus;
  statusLabel: string;
  reason: string;
}

export const UNCONFIGURED_PROVIDERS: UnconfiguredProvider[] = [
  {
    id: "forex-pending",
    label: "Forex (pending)",
    assetClass: "forex",
    status: "setup-required",
    statusLabel: "Setup Required",
    reason: "Forex data requires a paid API subscription (e.g. OANDA, FXCM). No provider is configured.",
  },
  {
    id: "stocks-pending",
    label: "Stocks (pending)",
    assetClass: "stocks",
    status: "setup-required",
    statusLabel: "Setup Required",
    reason: "Equities data requires a paid API subscription (e.g. Finnhub, Alpha Vantage). No provider is configured.",
  },
  {
    id: "indices-pending",
    label: "Indices (pending)",
    assetClass: "indices",
    status: "setup-required",
    statusLabel: "Setup Required",
    reason: "Index data requires a paid API subscription. No provider is configured.",
  },
  {
    id: "metals-pending",
    label: "Metals (pending)",
    assetClass: "metals",
    status: "setup-required",
    statusLabel: "Setup Required",
    reason: "Precious metals data requires a paid API subscription. No provider is configured.",
  },
  {
    id: "energies-pending",
    label: "Energies (pending)",
    assetClass: "energies",
    status: "setup-required",
    statusLabel: "Setup Required",
    reason: "Energy/commodity data requires a paid API subscription. No provider is configured.",
  },
];
