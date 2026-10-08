import { cents, validatePaperPlan, type PaperPlan } from "./paper-policy";

/** Pure paper-entry calculation. A future server runner must supply locked,
 * owner-authorized ledger/market snapshots; model arguments are never authority.
 * This does not execute orders, grant access, or guarantee a stop fill price. */
export type PaperRiskState = {
  status: "draft" | "running" | "paused" | "stopped";
  authorized: boolean; emergencyStop: boolean; startedAtMs: number;
  snapshotAtMs: number; cashCents: number; exposureCents: number;
  equityCents: number; openRiskCents: number; ordersPlaced: number;
  positionSymbols: string[];
};
export type PaperEntry = { symbol: string; quantity: string; stopPrice: string };
export type PaperQuote = {
  symbol: string; bid: string; ask: string; observedAtMs: number;
  instrumentVerified: boolean; quantityStep: string; minQuantity: string;
  minNotional: string;
};
export type PaperRiskResult =
  | { allowed: false; reason: string }
  | { allowed: true; notionalCents: number; entryFeeCents: number;
      debitCents: number; stopProceedsCents: number; riskCents: number };
const SCALE = 100000000n;
export const fixedPaperDecimal = (value: unknown): bigint => {
  if (typeof value !== "string" || !/^\d{1,12}(\.\d{1,8})?$/.test(value)) throw Error("Invalid fixed decimal.");
  const [whole, fraction = ""] = value.split(".");
  const result = BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, "0"));
  if (result <= 0n) throw Error("Positive decimal required.");
  return result;
};
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
const money = (n: bigint): number => {
  if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("Amount out of range.");
  return Number(n);
};

/** Conservative BUY estimate: round debits up and stop proceeds down in cents.
 * Loss budget includes current equity drawdown plus existing and new stop risk.
 * Fees/slippage are owner simulation assumptions, not exchange guarantees. */
export function evaluatePaperEntry(planInput: PaperPlan, state: PaperRiskState, entry: PaperEntry, quote: PaperQuote, nowMs: number): PaperRiskResult {
  const reject = (reason: string): PaperRiskResult => ({ allowed: false, reason });
  try {
    const plan = validatePaperPlan(planInput);
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) return reject("Invalid evaluation time.");
    if (state.status !== "running" || state.authorized !== true || state.emergencyStop !== false) return reject("Session is not authorized and running, or emergency stop is active.");
    const fields = [state.startedAtMs, state.snapshotAtMs, state.cashCents, state.exposureCents, state.equityCents, state.openRiskCents, state.ordersPlaced, quote.observedAtMs];
    if (fields.some(value => !Number.isSafeInteger(value) || value < 0)) return reject("Invalid ledger or quote snapshot.");
    if (state.startedAtMs > nowMs || nowMs - state.startedAtMs >= plan.durationHours * 3600000) return reject("Session has expired or has an invalid start time.");
    if ([state.snapshotAtMs, quote.observedAtMs].some(time => time > nowMs || nowMs - time > plan.maxDataAgeSeconds * 1000)) return reject("Ledger or quote is stale or future-dated.");
    if (!Array.isArray(state.positionSymbols) || state.positionSymbols.some(symbol => typeof symbol !== "string" || !plan.symbols.includes(symbol)) || new Set(state.positionSymbols).size !== state.positionSymbols.length) return reject("Invalid position snapshot.");
    if (!plan.symbols.includes(entry.symbol) || quote.symbol !== entry.symbol || quote.instrumentVerified !== true) return reject("Symbol is not allowed or instrument is unverified.");
    if (state.ordersPlaced >= plan.maxOrders) return reject("Order count limit reached.");
    if (state.positionSymbols.length > plan.maxPositions || (!state.positionSymbols.includes(entry.symbol) && state.positionSymbols.length >= plan.maxPositions)) return reject("Position count limit reached.");
    const quantity = fixedPaperDecimal(entry.quantity), step = fixedPaperDecimal(quote.quantityStep), minimum = fixedPaperDecimal(quote.minQuantity);
    const bid = fixedPaperDecimal(quote.bid), ask = fixedPaperDecimal(quote.ask), stop = fixedPaperDecimal(entry.stopPrice);
    if (bid > ask || stop >= bid) return reject("Quote is crossed or stop is not below the bid.");
    if (quantity < minimum || quantity % step !== 0n) return reject("Quantity is below minimum or does not match instrument step.");
    const denominator = SCALE * SCALE;
    const rawNotional = quantity * ask * 100n;
    if (quantity * ask < fixedPaperDecimal(quote.minNotional) * SCALE) return reject("Order is below instrument minimum notional.");
    const notionalCents = money(ceil(rawNotional, denominator));
    const slippedCents = ceil(rawNotional * BigInt(10000 + plan.slippageBps), denominator * 10000n);
    const entryFeeCents = money(ceil(slippedCents * BigInt(plan.feeBps), 10000n));
    const debitCents = money(slippedCents + BigInt(entryFeeCents));
    const exitGross = quantity * stop * 100n * BigInt(10000 - plan.slippageBps) / (denominator * 10000n);
    const exitFee = ceil(exitGross * BigInt(plan.feeBps), 10000n);
    const stopProceedsCents = money(exitGross - exitFee);
    const riskCents = debitCents - stopProceedsCents;
    const capital = cents(plan.capital), maxLoss = cents(plan.maxLoss);
    const drawdown = Math.max(0, capital - state.equityCents);
    if (drawdown >= maxLoss) return reject("Session loss limit reached.");
    if (debitCents > cents(plan.maxOrder)) return reject("Order limit exceeded including simulated costs.");
    if (debitCents > state.cashCents) return reject("Insufficient paper cash including simulated costs.");
    if (BigInt(state.exposureCents) + BigInt(debitCents) > BigInt(cents(plan.maxExposure))) return reject("Exposure limit exceeded including simulated costs.");
    if (riskCents > cents(plan.maxRiskPerTrade)) return reject("Per-trade risk limit exceeded.");
    if (BigInt(drawdown) + BigInt(state.openRiskCents) + BigInt(riskCents) > BigInt(maxLoss)) return reject("Remaining session loss budget exceeded.");
    return { allowed: true, notionalCents, entryFeeCents, debitCents, stopProceedsCents, riskCents };
  } catch {
    return reject("Invalid paper policy, ledger, quantity or market data.");
  }
}
