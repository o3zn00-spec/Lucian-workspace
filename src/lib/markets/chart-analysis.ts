import type { Candle } from "./types";
/** Descriptive levels from closed exchange candles, never a trade signal. */
export function analyzeCandles(candles: Candle[], intervalSeconds: number, nowSeconds: number) {
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return null;
  const closed = candles.filter(c => c.time + intervalSeconds <= nowSeconds).slice(-60);
  if (closed.length < 20 || closed.some((c, i) => ![c.time,c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite) || c.low <= 0 || c.high < Math.max(c.open,c.close,c.low) || c.low > Math.min(c.open,c.close) || c.volume < 0 || (i > 0 && c.time - closed[i-1].time !== intervalSeconds))) return null;
  const latest = closed.at(-1)!;
  const previous = closed.slice(0,-1);
  const support = Math.min(...previous.map(c => c.low)), resistance = Math.max(...previous.map(c => c.high));
  const mean = closed.slice(-20).reduce((s,c) => s+c.close,0)/20;
  return { support, resistance, mean, from: closed[0].time, through: latest.time, count: closed.length,
    stale: nowSeconds > latest.time + intervalSeconds * 3,
    position: latest.close > resistance ? "Closed above the previous range" : latest.close < support ? "Closed below the previous range" : "Inside the previous range" };
}
