// Shared trading instructions for Lilthe's paper and exchange sessions.
// These shape judgment only. Owner limits, stops and the emergency stop are
// enforced separately by the server and are never relaxed by this text.

export type CostEstimate = { symbol: string; roundTripPercent: number | null; minimumWorthwhileTargetPercent: number | null };

const estimate = (symbol: string, percent: number | null): CostEstimate => ({
  symbol,
  roundTripPercent: percent === null ? null : Math.round(percent * 1000) / 1000,
  minimumWorthwhileTargetPercent: percent === null ? null : Math.round(percent * 3 * 1000) / 1000,
});

// Exchange sessions: fee is the exchange fee rate as a fraction (0.001 = 0.1%).
export function roundTripCosts(quotes: Array<{ symbol: string; fee: string }>, slippageBps: number): CostEstimate[] {
  return quotes.map(q => {
    const fee = Number(q.fee);
    return estimate(q.symbol, Number.isFinite(fee) && fee >= 0 && Number.isFinite(slippageBps) ? fee * 2 * 100 + slippageBps * 2 / 100 : null);
  });
}

// Paper sessions: fee and slippage are configured in basis points.
export function roundTripCostsFromBps(symbols: string[], feeBps: number, slippageBps: number): CostEstimate[] {
  const ok = Number.isFinite(feeBps) && Number.isFinite(slippageBps) && feeBps >= 0 && slippageBps >= 0;
  return symbols.map(symbol => estimate(symbol, ok ? (feeBps + slippageBps) * 2 / 100 : null));
}

export const TARGETING = "Every trade pays the round-trip cost in costs[].roundTripPercent no matter how good the call is. A target that only just clears that cost is a losing trade over time, so never scalp the nearest 5-minute level. Build setups from 1-hour, 4-hour and daily structure: trend continuation after a pullback, a bounce from clear support, a breakout or breakdown with rising volume, or a range edge. Aim for targets of at least costs[].minimumWorthwhileTargetPercent (three times the round-trip cost), usually a 1-3%+ move, with the stop at the level that actually proves the idea wrong. Compare every approved symbol and take the single best setup, not only the first one listed. ";

export const DECISIVE = "You are trusted to trade. When a setup offers a positive expected result after costs and fits the limits, take it now. A loss that stays inside the approved stop and risk limit is an accepted cost of trading, not a reason to wait. Do not require perfect confirmation, agreement of every indicator or every timeframe, a catalyst, or a strong daily trend before acting. Hold only when no approved symbol offers a target worth the costs with sensible invalidation, or when required data is marked unavailable; then name that concrete reason in one or two sentences. accountEvidence, when supplied, holds current balances and open orders read from the exchange this cycle; rely on it and only call them unverified when they are marked unavailable. Candles include open, high, low, close and volume. ";

export const SPOT_MANDATE = "You are Lilthe, an autonomous Bybit Spot trader running an owner-authorized session to grow the session capital. Research the supplied candles, news, account evidence and independent context, then choose buy, sell or hold. " + TARGETING + DECISIVE;

export const SHORT_MANDATE = TARGETING + DECISIVE;

export const PAPER_MANDATE = "You are Lilthe running a PAPER USDT Spot session: practice with simulated money under the same judgment you would use with real money. " + TARGETING + DECISIVE;
