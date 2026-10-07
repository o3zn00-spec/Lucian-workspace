// LUCIAN Markets — Technical indicators.
//
// Pure calculation functions for the Phase 3 chart indicators. Each
// indicator takes a candle array and a period and returns a series
// aligned to the input (with `period - 1` leading nulls where the
// value can't be computed yet).
//
// All indicators use REAL candle history from the Phase 1 markets store
// — no fabricated values.

import type { Candle } from "./types";

/**
 * Simple Moving Average. Returns one value per input candle; the first
 * `period - 1` entries are null because there isn't enough history yet.
 *
 *   SMA[t] = (close[t] + close[t-1] + ... + close[t-period+1]) / period
 */
export function sma(candles: Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (period <= 0 || candles.length < period) return out;
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Exponential Moving Average. Uses the standard smoothing factor
 * `k = 2 / (period + 1)`. The seed value is the SMA of the first
 * `period` closes.
 *
 *   EMA[t] = close[t] × k + EMA[t-1] × (1 − k)
 */
export function ema(candles: Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (period <= 0 || candles.length < period) return out;
  const k = 2 / (period + 1);
  // Seed with SMA of the first `period` closes.
  let seed = 0;
  for (let i = 0; i < period; i++) seed += candles[i].close;
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/**
 * Relative Strength Index. Uses Wilder's smoothing (the original
 * RSI formula). Returns one value per input candle; the first `period`
 * entries are null.
 *
 *   RS = avgGain / avgLoss
 *   RSI = 100 − 100 / (1 + RS)
 *
 * When avgLoss is 0 (all gains), RSI = 100. When avgGain is 0 (all
 * losses), RSI = 0.
 */
export function rsi(candles: Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (period <= 0 || candles.length < period + 1) return out;
  // Compute initial gains/losses.
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) avgGain += change;
    else avgLoss += -change;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : avgGain === 0 ? 0 : 100 - 100 / (1 + avgGain / avgLoss);
  // Wilder's smoothing for the rest.
  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : avgGain === 0 ? 0 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/**
 * Volume series — returns the raw volume per candle. Useful for the
 * volume histogram indicator. No calculation, just extraction.
 */
export function volumeSeries(candles: Candle[]): number[] {
  return candles.map((c) => c.volume);
}
