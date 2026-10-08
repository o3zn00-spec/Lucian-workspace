export type PaperPlan = {
  mode: "paper"; exchange: "bybit"; category: "spot"; currency: "USDT"; leverage: 1;
  capital: string; maxOrder: string; maxExposure: string; maxLoss: string;
  maxRiskPerTrade: string; symbols: string[]; maxOrders: number; maxPositions: number;
  reviewMinutes: number; durationHours: number; maxDataAgeSeconds: number;
  feeBps: number; slippageBps: number; strategy: string; additionalRules: string;
};
export class PaperPlanError extends Error { constructor(message: string, public status = 400) { super(message); } }
const fail = (message: string): never => { throw new PaperPlanError(message); };
export function cents(value: unknown): number {
  if (typeof value !== "string" || !/^\d{1,7}(\.\d{1,2})?$/.test(value)) return fail("Amounts must be decimal strings with at most two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export function validatePaperPlan(value: unknown): PaperPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("A paper plan is required.");
  const p = value as Record<string, unknown>;
  const keys = ["mode", "exchange", "category", "currency", "leverage", "capital", "maxOrder", "maxExposure", "maxLoss", "maxRiskPerTrade", "symbols", "maxOrders", "maxPositions", "reviewMinutes", "durationHours", "maxDataAgeSeconds", "feeBps", "slippageBps", "strategy", "additionalRules"];
  if (Object.keys(p).length !== keys.length || Object.keys(p).some(key => !keys.includes(key))) return fail("Unknown or missing plan fields.");
  if (p.mode !== "paper" || p.exchange !== "bybit" || p.category !== "spot" || p.currency !== "USDT" || p.leverage !== 1) return fail("This setup supports simulated Bybit USDT spot only, without leverage.");
  const capital = cents(p.capital), exposure = cents(p.maxExposure), order = cents(p.maxOrder), loss = cents(p.maxLoss), risk = cents(p.maxRiskPerTrade);
  if (capital < 100 || capital > 100000000 || order <= 0 || exposure <= 0 || loss <= 0 || risk <= 0 || exposure > capital || order > exposure || loss > capital || risk > loss) return fail("Capital/risk limits conflict. Order ≤ exposure ≤ capital and per-trade risk ≤ loss limit ≤ capital.");
  for (const [key, min, max] of [["maxOrders",1,100],["maxPositions",1,10],["reviewMinutes",1,1440],["durationHours",1,168],["maxDataAgeSeconds",10,300],["feeBps",0,1000],["slippageBps",0,1000]] as const) {
    if (!Number.isInteger(p[key]) || (p[key] as number) < min || (p[key] as number) > max) return fail(`Invalid ${key}: choose ${min}–${max}.`);
  }
  if (!Array.isArray(p.symbols) || !p.symbols.length || p.symbols.length > 10 || p.symbols.some(s => typeof s !== "string" || !/^[A-Z0-9]{2,16}USDT$/.test(s)) || new Set(p.symbols).size !== p.symbols.length) return fail("Choose 1–10 unique USDT symbols, for example BTCUSDT.");
  if (typeof p.strategy !== "string" || !p.strategy.trim() || p.strategy.length > 500 || typeof p.additionalRules !== "string" || p.additionalRules.length > 1000) return fail("Enter a strategy (up to 500 characters) and optional rules (up to 1000).");
  return { ...p, strategy: p.strategy.trim(), additionalRules: p.additionalRules.trim() } as PaperPlan;
}
