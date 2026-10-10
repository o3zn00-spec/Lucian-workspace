import "server-only";
import { createHash } from "node:crypto";
import { bybitPublicRequest, bybitRequest, getBybitConfig } from "./client";
import { decimal } from "./autonomous-policy";
export const connectionIdentity = (c: Awaited<ReturnType<typeof getBybitConfig>>) => createHash("sha256").update(JSON.stringify([c.environment, c.apiKey, c.apiSecret])).digest("hex");
type Rows = { list?: Array<Record<string, unknown>> };
export async function autonomousQuote(userId: string, symbol: string) {
  const config = await getBybitConfig(userId);
  const [instrument, ticker, rates] = await Promise.all([
    bybitPublicRequest<Rows>(config.environment, "/v5/market/instruments-info", { category: "spot", symbol }),
    bybitPublicRequest<Rows>(config.environment, "/v5/market/tickers", { category: "spot", symbol }),
    bybitRequest<Rows>(userId, "/v5/account/fee-rate", { query: { category: "spot", symbol } }, config),
  ]);
  const one = (r: Rows) => { if (!Array.isArray(r.list) || r.list.length !== 1 || r.list[0].symbol !== symbol) throw Error("Incomplete instrument, quote or fee data."); return r.list[0]; };
  const i = one(instrument), t = one(ticker), f = one(rates);
  if (i.status !== "Trading" || i.quoteCoin !== "USDT") throw Error("Spot instrument is not trading.");
  const lot = i.lotSizeFilter as Record<string, string>, price = i.priceFilter as Record<string, string>;
  const q = { ask: t.ask1Price as string, bid: t.bid1Price as string, last: t.lastPrice as string, step: lot.basePrecision, tick: price.tickSize, minQty: lot.minOrderQty, minNotional: lot.minOrderAmt, fee: f.takerFeeRate as string, atMs: Date.now() };
  for (const v of [q.ask, q.bid, q.last, q.step, q.tick, q.minQty, q.minNotional]) decimal(v); decimal(q.fee, true);
  return q;
}
export async function autonomousWallet(userId: string) {
  const data = await bybitRequest<{ list?: Array<{ accountType: string; coin: Array<{ coin: string; walletBalance: string; locked: string; spotBorrow?: string }> }> }>(userId, "/v5/account/wallet-balance", { query: { accountType: "UNIFIED" } });
  if (!data.list || data.list.length !== 1 || data.list[0].accountType !== "UNIFIED" || !Array.isArray(data.list[0].coin)) throw Error("Unified wallet unavailable.");
  const coins = data.list[0].coin;
  if (new Set(coins.map(c => c.coin)).size !== coins.length) throw Error("Ambiguous wallet.");
  return coins.map(c => { const wallet = decimal(c.walletBalance, true), locked = decimal(c.locked, true), borrowed = decimal(c.spotBorrow ?? "0", true); if (locked + borrowed > wallet) throw Error("Wallet liabilities unavailable."); return { coin: c.coin, total: wallet, available: wallet - locked - borrowed }; });
}
