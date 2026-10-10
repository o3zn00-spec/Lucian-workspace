export type AutonomousPlan = {
  mode: "bybit_live" | "bybit_testnet"; symbols: string[]; capital: string;
  maxOrder: string; maxLoss: string; maxRiskPerTrade: string;
  maxTrades: number; reviewMinutes: number; durationHours: number;
  maxModelCalls: number; slippageBps: number; strategy: string;
};
export type AutonomousDecision = { action: "hold" | "buy" | "sell"; rationale: string; symbol?: string; quantity?: string; stopPrice?: string; takeProfit?: string };
export class AutonomousError extends Error { constructor(message: string, public status = 400) { super(message); } }
export const decimal = (raw: unknown, zero = false): bigint => {
  if (typeof raw !== "string" || !/^\d{1,12}(\.\d{1,12})?$/.test(raw)) throw new AutonomousError("Invalid decimal amount.");
  const [whole, part = ""] = raw.split("."); const n = BigInt(whole) * 1000000000000n + BigInt(part.padEnd(12, "0"));
  if (n < 0n || !zero && n === 0n) throw new AutonomousError("Positive amount required."); return n;
};
export const formatDecimal = (n: bigint) => { if (n < 0n) throw new AutonomousError("Negative quantity."); return `${n / 1000000000000n}.${(n % 1000000000000n).toString().padStart(12, "0")}`.replace(/\.?0+$/, ""); };
export const moneyCents = (raw: unknown) => {
  if (typeof raw !== "string" || !/^\d{1,9}(\.\d{1,2})?$/.test(raw)) throw new AutonomousError("Use USDT amounts with at most two decimals.");
  const n = Number(raw) * 100; const cents = Math.round(n); if (!Number.isSafeInteger(cents) || cents <= 0) throw new AutonomousError("Positive capital and limits required."); return cents;
};
export function validateAutonomousPlan(raw: unknown): AutonomousPlan {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AutonomousError("Choose session rules.");
  const p = raw as AutonomousPlan;
  if (Object.keys(p).sort().join(",") !== "capital,durationHours,maxLoss,maxModelCalls,maxOrder,maxRiskPerTrade,maxTrades,mode,reviewMinutes,slippageBps,strategy,symbols") throw new AutonomousError("Unexpected session rule fields.");
  if (!["bybit_live", "bybit_testnet"].includes(p.mode) || !Array.isArray(p.symbols) || !p.symbols.length || p.symbols.length > 10 || new Set(p.symbols).size !== p.symbols.length || p.symbols.some(s => typeof s !== "string" || !/^[A-Z0-9]{2,16}USDT$/.test(s))) throw new AutonomousError("Choose unique Bybit USDT Spot symbols.");
  const capital = moneyCents(p.capital), order = moneyCents(p.maxOrder), loss = moneyCents(p.maxLoss), risk = moneyCents(p.maxRiskPerTrade);
  if (order > capital || loss > capital || risk > loss) throw new AutonomousError("Order and loss limits must fit capital; trade risk must fit the loss limit.");
  for (const [n, min, max] of [[p.maxTrades, 1, 10000], [p.reviewMinutes, 1, 1440], [p.durationHours, 1, 168], [p.maxModelCalls, 1, 10000], [p.slippageBps, 1, 500]]) if (!Number.isInteger(n) || n < min || n > max) throw new AutonomousError("Session counts, interval, duration or slippage allowance are invalid.");
  if (typeof p.strategy !== "string" || !p.strategy.trim() || p.strategy.length > 3000) throw new AutonomousError("Describe the trading strategy.");
  return { ...p, symbols: [...p.symbols], strategy: p.strategy.trim() };
}
export function parseAutonomousDecision(raw: string): AutonomousDecision {
  if (raw.length > 5000) throw new AutonomousError("Model decision too large.");
  const d = JSON.parse(raw) as AutonomousDecision;
  if (!d || typeof d !== "object" || Array.isArray(d) || !["buy", "sell", "hold"].includes(d.action) || typeof d.rationale !== "string" || !d.rationale.trim() || d.rationale.length > 1500) throw new AutonomousError("Invalid structured trading decision.");
  const keys = d.action === "buy" ? "action,quantity,rationale,stopPrice,symbol,takeProfit" : d.action === "sell" ? "action,rationale,symbol" : "action,rationale";
  if (Object.keys(d).sort().join(",") !== keys) throw new AutonomousError("Unexpected model decision fields.");
  if (d.action !== "hold" && !/^[A-Z0-9]{2,16}USDT$/.test(d.symbol ?? "")) throw new AutonomousError("Invalid decision symbol.");
  if (d.action === "buy") { decimal(d.quantity); decimal(d.stopPrice); decimal(d.takeProfit); }
  return d;
}
export function evaluateAutonomousEntry(p: AutonomousPlan, d: AutonomousDecision, q: { ask: string; bid: string; step: string; tick: string; minQty: string; minNotional: string; fee: string; atMs: number }, cash: number, realized: number, trades: number, now = Date.now()) {
  validateAutonomousPlan(p);
  if (d.action !== "buy" || !p.symbols.includes(d.symbol!) || trades >= p.maxTrades || realized <= -moneyCents(p.maxLoss)) throw new AutonomousError("Entry exceeds approved session symbols, trade count or loss limit.");
  if (!Number.isSafeInteger(q.atMs) || q.atMs > now + 1000 || now - q.atMs > 10000) throw new AutonomousError("Fresh exchange quote required.");
  const qty = decimal(d.quantity), ask = decimal(q.ask), bid = decimal(q.bid), stop = decimal(d.stopPrice), target = decimal(d.takeProfit), step = decimal(q.step), tick = decimal(q.tick), fee = decimal(q.fee, true), scale = 1000000000000n;
  if (bid > ask || stop >= bid || target <= ask || qty % step !== 0n || stop % tick !== 0n || target % tick !== 0n || qty < decimal(q.minQty) || qty * ask < decimal(q.minNotional) * scale || fee > scale / 10n) throw new AutonomousError("Entry size, stop, target or exchange increments are invalid.");
  const protectedQty = (qty * (scale - fee) / scale) / step * step;
  if (protectedQty < decimal(q.minQty) || protectedQty * stop < decimal(q.minNotional) * scale) throw new AutonomousError("Fee-adjusted holding must support the exchange's minimum protective exit size.");
  const ceil = (n: bigint, divisor: bigint) => (n + divisor - 1n) / divisor;
  const debit = ceil(qty * ask * 100n * BigInt(10000 + p.slippageBps) * (scale + fee), scale ** 3n * 10000n);
  const proceeds = protectedQty * stop * 100n * BigInt(10000 - p.slippageBps) * (scale - fee) / (scale ** 3n * 10000n);
  const risk = Number(debit - proceeds);
  if (!Number.isSafeInteger(cash) || !Number.isSafeInteger(realized) || debit > BigInt(Math.min(cash, moneyCents(p.maxOrder))) || risk > moneyCents(p.maxRiskPerTrade) || risk + Math.max(0, -realized) > moneyCents(p.maxLoss)) throw new AutonomousError("Entry including fees/slippage exceeds approved cash, order or risk limits.");
  return { debitCents: Number(debit), riskCents: risk };
}
export type ExecutionFill = { execQty: unknown; execPrice: unknown; execFee: unknown; feeCurrency: unknown };
export function fillTotals(fills: ExecutionFill[], symbol: string, side: "buy" | "sell") {
  const scale = 1000000000000n, base = symbol.slice(0, -4); let quantity = 0n, quote = 0n;
  for (const f of fills) {
    const q = decimal(f.execQty), price = decimal(f.execPrice);
    if (typeof f.execFee !== "string" || !/^-?\d+(\.\d{1,12})?$/.test(f.execFee)) throw new AutonomousError("Unknown execution fee.");
    const negative = f.execFee.startsWith("-"), fee = decimal(negative ? f.execFee.slice(1) : f.execFee, true) * (negative ? -1n : 1n);
    if (f.feeCurrency !== base && f.feeCurrency !== "USDT") throw new AutonomousError("Fee currency cannot be accounted to this Spot session.");
    quantity += q + (f.feeCurrency === base ? (side === "buy" ? -fee : fee) : 0n);
    quote += q * price / scale + (f.feeCurrency === "USDT" ? (side === "buy" ? fee : -fee) : 0n);
  }
  if (quantity < 0n || quote < 0n) throw new AutonomousError("Invalid net execution totals.");
  const cents = Number(side === "buy" ? (quote * 100n + scale - 1n) / scale : quote * 100n / scale);
  if (!Number.isSafeInteger(cents)) throw new AutonomousError("Execution totals exceed precise accounting bounds.");
  return { quantity, quote, cents };
}
