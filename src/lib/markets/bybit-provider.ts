"use client";

import type { AssetClass, Candle, DataStatus, Instrument, PriceUpdate, Ticker, Timeframe } from "./types";
import type { MarketDataProvider } from "./provider";

const REST_BASE = "/api/markets/bybit";
const WS_BASE = "wss://stream.bybit.com/v5/public/spot";
const INTERVAL: Record<Timeframe, string> = { "1m": "1", "5m": "5", "15m": "15", "30m": "30", "1h": "60", "4h": "240", "1d": "D", "1w": "W" };

const POPULAR = [
  ["BTC", "Bitcoin"], ["ETH", "Ethereum"], ["BNB", "BNB"], ["SOL", "Solana"],
  ["XRP", "XRP"], ["ADA", "Cardano"], ["DOGE", "Dogecoin"], ["AVAX", "Avalanche"],
  ["DOT", "Polkadot"], ["LINK", "Chainlink"], ["LTC", "Litecoin"], ["TRX", "TRON"],
] as const;

type Status = (status: { kind: "connecting" | "open" | "closed" | "error"; message?: string }) => void;

async function envelope<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  const payload = await response.json() as { retCode?: number; retMsg?: string; error?: string; result?: T };
  if (!response.ok || payload.retCode !== 0 || !payload.result) throw new Error(payload.error || payload.retMsg || `Bybit market-data request failed (${response.status}).`);
  return payload.result;
}

export const BybitProvider: MarketDataProvider = {
  id: "bybit-public",
  label: "Bybit (Crypto)",
  assetClass: "crypto" as AssetClass,
  configured: true,
  status: "live" as DataStatus,
  statusLabel: "Live",

  async listInstruments(): Promise<Instrument[]> {
    return POPULAR.map(([base, name]) => ({ symbol: `${base}USDT`, name: `${name} / Tether`, assetClass: "crypto", base, quote: "USDT", pricePrecision: 2, quantityPrecision: 6 }));
  },

  async getCandles(symbol, timeframe, limit): Promise<Candle[]> {
    const result = await envelope<{ list?: string[][] }>(`${REST_BASE}?kind=kline&symbol=${encodeURIComponent(symbol)}&interval=${INTERVAL[timeframe]}&limit=${Math.min(1000, limit)}`);
    if (!Array.isArray(result.list) || result.list.length === 0) throw new Error("Bybit returned no chart candles.");
    return result.list.map((row) => {
      const values = row.slice(0, 6).map(Number);
      const [start, open, high, low, close, volume] = values;
      if (values.length !== 6 || values.some((n) => !Number.isFinite(n)) || start <= 0 || Math.min(open, high, low, close) <= 0 || volume < 0 || high < Math.max(open, close, low) || low > Math.min(open, close, high)) throw new Error("Bybit returned malformed chart candles.");
      return { time: Math.floor(start / 1000), open, high, low, close, volume };
    }).reverse();
  },

  async getTicker(symbol): Promise<Ticker | null> {
    const result = await envelope<{ list?: Array<Record<string, string>> }>(`${REST_BASE}?kind=tickers&symbol=${encodeURIComponent(symbol)}`);
    const row = result.list?.[0];
    if (!row) return null;
    const last = Number(row.lastPrice);
    const previous = Number(row.prevPrice24h);
    return { symbol, lastPrice: last, priceChange: last - previous, priceChangePercent: Number(row.price24hPcnt) * 100, highPrice: Number(row.highPrice24h), lowPrice: Number(row.lowPrice24h), volume: Number(row.volume24h), quoteVolume: Number(row.turnover24h), bidPrice: Number(row.bid1Price), askPrice: Number(row.ask1Price) };
  },

  subscribePrice(symbol: string, callback: (update: PriceUpdate) => void, onStatus?: Status) {
    onStatus?.({ kind: "connecting" });
    const ws = new WebSocket(WS_BASE);
    ws.onopen = () => { onStatus?.({ kind: "open" }); ws.send(JSON.stringify({ op: "subscribe", args: [`publicTrade.${symbol}`] })); };
    ws.onmessage = (event) => { try { const message = JSON.parse(event.data) as { topic?: string; data?: Array<{ p?: string; T?: number }> }; const trade = message.data?.at(-1); if (trade?.p) callback({ symbol, price: Number(trade.p), time: Math.floor(Number(trade.T ?? Date.now()) / 1000) }); } catch { /* ignore malformed stream frames */ } };
    ws.onerror = () => onStatus?.({ kind: "error", message: "Bybit public WebSocket error" });
    ws.onclose = () => onStatus?.({ kind: "closed" });
    return () => { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; if (ws.readyState < 2) ws.close(); };
  },

  subscribeKline(symbol: string, timeframe: Timeframe, callback: (candle: Candle) => void, onStatus?: Status) {
    onStatus?.({ kind: "connecting" });
    const ws = new WebSocket(WS_BASE);
    ws.onopen = () => { onStatus?.({ kind: "open" }); ws.send(JSON.stringify({ op: "subscribe", args: [`kline.${INTERVAL[timeframe]}.${symbol}`] })); };
    ws.onmessage = (event) => { try { const message = JSON.parse(event.data) as { data?: Array<Record<string, string | number>> }; const row = message.data?.[0]; if (row) callback({ time: Math.floor(Number(row.start) / 1000), open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume) }); } catch { /* ignore malformed stream frames */ } };
    ws.onerror = () => onStatus?.({ kind: "error", message: "Bybit public WebSocket error" });
    ws.onclose = () => onStatus?.({ kind: "closed" });
    return () => { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; if (ws.readyState < 2) ws.close(); };
  },
};
