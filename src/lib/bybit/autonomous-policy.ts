export type ShortPositionSettings = { leverage: string; positionIdx: 0 | 2; autoAddMargin: 0 | 1 };
export type ShortAccountSettings = { marginMode: "ISOLATED_MARGIN" | "REGULAR_MARGIN"; positions: Record<string, ShortPositionSettings> };
export type AutonomousPlan = {
  product?: "spot" | "linear_short";
  shortSettings?: ShortAccountSettings;
  mode: "bybit_live" | "bybit_testnet"; symbols: string[]; capital: string;
  maxOrder: string; maxLoss: string; maxRiskPerTrade: string;
  maxTrades: number; reviewMinutes: number; durationHours: number;
  webResearch?: boolean; maxModelCalls: number; slippageBps: number; strategy: string;
};
export type AutonomousDecision = { action: "hold" | "buy" | "sell" | "short" | "cover"; rationale: string; symbol?: string; quantity?: string; stopPrice?: string; takeProfit?: string };
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
  if (Object.keys(p).filter(k => k !== "webResearch" && k !== "product" && k !== "shortSettings").sort().join(",") !== "capital,durationHours,maxLoss,maxModelCalls,maxOrder,maxRiskPerTrade,maxTrades,mode,reviewMinutes,slippageBps,strategy,symbols") throw new AutonomousError("Unexpected session rule fields.");
  if (!["bybit_live", "bybit_testnet"].includes(p.mode) || !Array.isArray(p.symbols) || !p.symbols.length || p.symbols.length > 10 || new Set(p.symbols).size !== p.symbols.length || p.symbols.some(s => typeof s !== "string" || !/^[A-Z0-9]{2,16}USDT$/.test(s))) throw new AutonomousError("Choose unique Bybit USDT symbols.");
  if (p.product !== undefined && !["spot", "linear_short"].includes(p.product)) throw new AutonomousError("Choose Spot or USDT perpetual shorts.");
  if (p.shortSettings !== undefined) validateShortSettings(p.shortSettings, p);
  const capital = moneyCents(p.capital), order = moneyCents(p.maxOrder), loss = moneyCents(p.maxLoss), risk = moneyCents(p.maxRiskPerTrade);
  if ((p.product !== "linear_short" && order > capital) || loss > capital || risk > loss) throw new AutonomousError("Order and loss limits must fit capital; trade risk must fit the loss limit.");
  for (const [n, min, max] of [[p.maxTrades, 1, 10000], [p.reviewMinutes, 1, 1440], [p.durationHours, 1, 168], [p.maxModelCalls, 1, 10000], [p.slippageBps, 1, 500]]) if (!Number.isInteger(n) || n < min || n > max) throw new AutonomousError("Session counts, interval, duration or slippage allowance are invalid.");
  if (p.product === "linear_short" && p.durationHours > 144) throw new AutonomousError("Short sessions are limited to six days so all order history remains reconcilable.");
  if (p.webResearch !== undefined && typeof p.webResearch !== "boolean") throw new AutonomousError("Web research must be enabled or disabled explicitly.");
  if (p.webResearch && p.maxModelCalls < 2) throw new AutonomousError("Web research needs at least two model calls per review.");
  if (typeof p.strategy !== "string" || !p.strategy.trim() || p.strategy.length > 3000) throw new AutonomousError("Describe the trading strategy.");
  return { ...p, symbols: [...p.symbols], strategy: p.strategy.trim() };
}
export function validateShortSettings(value: ShortAccountSettings, p: Pick<AutonomousPlan, "product" | "symbols">) {
  if (p.product !== "linear_short" || !value || Object.keys(value).sort().join(",") !== "marginMode,positions" || !["ISOLATED_MARGIN", "REGULAR_MARGIN"].includes(value.marginMode) || !value.positions || Array.isArray(value.positions) || Object.keys(value.positions).sort().join(",") !== [...p.symbols].sort().join(",")) throw new AutonomousError("Invalid reviewed short account settings.");
  for (const v of Object.values(value.positions)) {
    if (!v || Object.keys(v).sort().join(",") !== "autoAddMargin,leverage,positionIdx" || ![0, 2].includes(v.positionIdx) || ![0, 1].includes(v.autoAddMargin) || decimal(v.leverage) < 1000000000000n || decimal(v.leverage) > 1000000000000000n) throw new AutonomousError("Invalid reviewed leverage or position mode.");
  }
}
// Old grants retain exactly their original Isolated/1x/one-way authority.
export function shortSettingsFor(p: AutonomousPlan, symbol: string): ShortPositionSettings {
  if (!p.symbols.includes(symbol)) throw new AutonomousError("Symbol is outside this session.");
  return p.shortSettings?.positions[symbol] ?? { leverage: "1", positionIdx: 0, autoAddMargin: 0 };
}
export function shortAccountFor(p: AutonomousPlan): ShortAccountSettings {
  return p.shortSettings ?? { marginMode: "ISOLATED_MARGIN", positions: Object.fromEntries(p.symbols.map(symbol => [symbol, shortSettingsFor(p, symbol)])) };
}

export function parseAutonomousDecision(raw: string): AutonomousDecision {
  if (raw.length > 5000) throw new AutonomousError("Model decision too large.");
  const d = JSON.parse(raw) as AutonomousDecision;
  if (!d || typeof d !== "object" || Array.isArray(d) || !["buy", "sell", "short", "cover", "hold"].includes(d.action) || typeof d.rationale !== "string" || !d.rationale.trim() || d.rationale.length > 1500) throw new AutonomousError("Invalid structured trading decision.");
  const keys = ["buy", "short"].includes(d.action) ? "action,quantity,rationale,stopPrice,symbol,takeProfit" : ["sell", "cover"].includes(d.action) ? "action,rationale,symbol" : "action,rationale";
  if (Object.keys(d).sort().join(",") !== keys) throw new AutonomousError("Unexpected model decision fields.");
  if (d.action !== "hold" && !/^[A-Z0-9]{2,16}USDT$/.test(d.symbol ?? "")) throw new AutonomousError("Invalid decision symbol.");
  if (["buy", "short"].includes(d.action)) { decimal(d.quantity); decimal(d.stopPrice); decimal(d.takeProfit); }
  return d;
}
export function evaluateAutonomousEntry(p: AutonomousPlan, d: AutonomousDecision, q: { ask: string; bid: string; step: string; tick: string; minQty: string; minNotional: string; fee: string; atMs: number }, cash: number, realized: number, trades: number, now = Date.now()) {
  validateAutonomousPlan(p);
  if (p.product === "linear_short") return evaluateShortEntry(p, d, q, cash, realized, trades, now);
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

export const isShortPlan = (p: AutonomousPlan) => p.product === "linear_short";
export const sessionCategory = (p: AutonomousPlan): "spot" | "linear" => isShortPlan(p) ? "linear" : "spot";
export function evaluateShortEntry(p: AutonomousPlan, d: AutonomousDecision, q: {ask:string;bid:string;step:string;tick:string;minQty:string;minNotional:string;fee:string;atMs:number;mark?:string}, cash:number, realized:number, trades:number, now=Date.now()) {
  if (d.action !== "short" || !p.symbols.includes(d.symbol!) || trades >= p.maxTrades || realized <= -moneyCents(p.maxLoss)) throw new AutonomousError("Short entry exceeds reviewed session limits.");
  if (!Number.isSafeInteger(q.atMs) || q.atMs > now+1000 || now-q.atMs>10000) throw new AutonomousError("Fresh perpetual quote required.");
  const scale=1000000000000n, qty=decimal(d.quantity), ask=decimal(q.ask), bid=decimal(q.bid), stop=decimal(d.stopPrice), target=decimal(d.takeProfit), fee=decimal(q.fee,true);
  if (bid>ask || stop<=ask || target>=bid || qty%decimal(q.step)!==0n || stop%decimal(q.tick)!==0n || target%decimal(q.tick)!==0n || qty<decimal(q.minQty) || qty*bid<decimal(q.minNotional)*scale || fee>scale/10n) throw new AutonomousError("Invalid short size, stop, target or increments.");
  const ceil=(n:bigint,d:bigint)=>(n+d-1n)/d;
  const leverage = decimal(shortSettingsFor(p, d.symbol!).leverage);
  const mark = q.mark === undefined ? ask : decimal(q.mark);
  const basis = mark > ask ? mark : ask;
  const notional = ceil(qty*basis*100n*BigInt(10000+p.slippageBps), scale**2n*10000n);
  // Leverage reduces initial margin, never the approved gross order exposure.
  const initialMargin = ceil(notional*scale, leverage);
  const fees = ceil(notional*2n*fee, scale);
  const entry=qty*bid*100n*BigInt(10000-p.slippageBps)*(scale-fee)/(scale**3n*10000n);
  const cover=ceil(qty*stop*100n*BigInt(10000+p.slippageBps)*(scale+fee),scale**3n*10000n);
  const risk=cover-entry;
  const margin = initialMargin + fees;
  // Reserve adverse stop loss in addition to initial margin for new reviewed
  // leveraged sessions. Legacy sizing is unchanged for existing grants.
  const reserve = p.shortSettings ? margin + risk : margin;
  if (stop <= mark || ![cash,realized].every(Number.isSafeInteger) || reserve>BigInt(cash) || notional+fees>BigInt(moneyCents(p.maxOrder)) || risk>BigInt(moneyCents(p.maxRiskPerTrade)) || risk+BigInt(Math.max(0,-realized))>BigInt(moneyCents(p.maxLoss))) throw new AutonomousError("Short exposure, margin reserve, fees or stop risk exceed reviewed limits.");

  return {debitCents:Number(reserve),riskCents:Number(risk)};
}
export function linearFillTotals(fills: ExecutionFill[]) {
  const scale=1000000000000n;let quantity=0n,quote=0n,fees=0n;
  for(const f of fills){
    if(f.feeCurrency!=="USDT")throw new AutonomousError("Perpetual execution fee currency must be USDT.");
    quantity+=decimal(f.execQty);quote+=decimal(f.execQty)*decimal(f.execPrice)/scale;fees+=signedDecimal(f.execFee);
  }
  return {quantity,quote,fees};
}
export function signedDecimal(value:unknown){
  if(typeof value!=="string" || !/^-?\d{1,12}(\.\d{1,12})?$/.test(value))throw new AutonomousError("Invalid signed exchange amount.");
  return value.startsWith("-")?-decimal(value.slice(1),true):decimal(value,true);
}
export function floorCents(value:bigint){const n=value*100n,scale=1000000000000n;const result=Number(n>=0n?n/scale:-((-n+scale-1n)/scale));if(!Number.isSafeInteger(result))throw new AutonomousError("Accounting bounds exceeded.");return result;}
