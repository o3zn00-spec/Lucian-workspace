import "server-only";
import { createHash } from "node:crypto";
import { bybitPublicRequest, bybitRequest, getBybitConfig } from "./client";
import { decimal, formatDecimal, signedDecimal } from "./autonomous-policy";
export const connectionIdentity = (c: Awaited<ReturnType<typeof getBybitConfig>>) => createHash("sha256").update(JSON.stringify([c.environment, c.apiKey, c.apiSecret])).digest("hex");
type Rows = { list?: Array<Record<string, unknown>> };
export async function autonomousQuote(userId: string, symbol: string, category: "spot" | "linear" = "spot") {
  const config = await getBybitConfig(userId);
  const [instrument, ticker, rates] = await Promise.all([
    bybitPublicRequest<Rows>(config.environment, "/v5/market/instruments-info", { category, symbol }),
    bybitPublicRequest<Rows>(config.environment, "/v5/market/tickers", { category, symbol }),
    bybitRequest<Rows>(userId, "/v5/account/fee-rate", { query: { category, symbol } }, config),
  ]);
  const one = (r: Rows) => { if (!Array.isArray(r.list) || r.list.length !== 1 || r.list[0].symbol !== symbol) throw Error("Incomplete instrument, quote or fee data."); return r.list[0]; };
  const i = one(instrument), t = one(ticker), f = one(rates);
  if (i.status !== "Trading" || i.quoteCoin !== "USDT" || category === "linear" && (i.settleCoin !== "USDT" || i.contractType !== "LinearPerpetual")) throw Error("Spot instrument is not trading.");
  const lot = i.lotSizeFilter as Record<string, string>, price = i.priceFilter as Record<string, string>;
  const q = { ask: t.ask1Price as string, bid: t.bid1Price as string, last: t.lastPrice as string, ...(category === "linear" ? { mark: t.markPrice as string } : {}), step: category === "linear" ? lot.qtyStep : lot.basePrecision, tick: price.tickSize, minQty: lot.minOrderQty, minNotional: category === "linear" ? lot.minNotionalValue : lot.minOrderAmt, fee: f.takerFeeRate as string, atMs: Date.now() };
  for (const v of [q.ask, q.bid, q.last, q.step, q.tick, q.minQty, q.minNotional]) decimal(v); decimal(q.fee, true);
  if (category === "linear") decimal(q.mark);
  // Funding is advisory evidence, never fabricated as zero when unavailable.
  let funding: { rate: string; nextAtMs: number } | null = null;
  if (category === "linear") {
    try {
      signedDecimal(t.fundingRate);
      const nextAtMs = Number(t.nextFundingTime);
      if (Number.isSafeInteger(nextAtMs) && nextAtMs > Date.now()) funding = { rate: String(t.fundingRate), nextAtMs };
    } catch { /* Explicitly unavailable; protective order quotes remain usable. */ }
  }
  return { ...q, ...(category === "linear" ? { funding } : {}) };
}
export async function autonomousWallet(userId: string) {
  const data = await bybitRequest<{ list?: Array<{ accountType: string; coin: Array<{ coin: string; walletBalance: string; locked: string; spotBorrow?: string }> }> }>(userId, "/v5/account/wallet-balance", { query: { accountType: "UNIFIED" } });
  if (!data.list || data.list.length !== 1 || data.list[0].accountType !== "UNIFIED" || !Array.isArray(data.list[0].coin)) throw Error("Unified wallet unavailable.");
  const coins = data.list[0].coin;
  if (new Set(coins.map(c => c.coin)).size !== coins.length) throw Error("Ambiguous wallet.");
  return coins.map(c => { const wallet = decimal(c.walletBalance, true), locked = decimal(c.locked, true), borrowed = decimal(c.spotBorrow ?? "0", true); if (locked + borrowed > wallet) throw Error("Wallet liabilities unavailable."); return { coin: c.coin, total: wallet, available: wallet - locked - borrowed }; });
}

// Read-only Spot account evidence for the decision model: current holdings of
// session symbols, available USDT and open orders. A failed read is reported
// as unavailable instead of blocking research or being guessed.
export async function spotAccountEvidence(userId: string, symbols: string[]) {
  const observedAtMs = Date.now();
  const coins = new Set(symbols.map(s => s.slice(0, -4)));
  let wallet: { availableUSDT: string; holdings: Array<{ coin: string; total: string; available: string }> } | { unavailable: string };
  try {
    const rows = await autonomousWallet(userId), usdt = rows.find(c => c.coin === "USDT");
    wallet = { availableUSDT: formatDecimal(usdt?.available ?? 0n), holdings: rows.filter(c => coins.has(c.coin) && c.total > 0n).map(c => ({ coin: c.coin, total: formatDecimal(c.total), available: formatDecimal(c.available) })) };
  } catch { wallet = { unavailable: "Wallet balance read failed this cycle." }; }
  let openOrders: Array<Record<string, string>> | { unavailable: string };
  try {
    const data = await bybitRequest<Rows>(userId, "/v5/order/realtime", { query: { category: "spot", openOnly: 0, limit: 50 } });
    if (!Array.isArray(data.list)) throw Error("Open orders unavailable.");
    openOrders = data.list.filter(o => symbols.includes(String(o.symbol))).slice(0, 20).map(o => ({ symbol: String(o.symbol), side: String(o.side), orderType: String(o.orderType), price: String(o.price ?? ""), triggerPrice: String(o.triggerPrice ?? ""), qty: String(o.qty ?? ""), leavesQty: String(o.leavesQty ?? ""), status: String(o.orderStatus ?? "") }));
  } catch { openOrders = { unavailable: "Open-order read failed this cycle." }; }
  return { observedAtMs, wallet, openOrders, note: "Read-only account evidence. Holdings of session symbols that existed before this session are not owned by the session and must not be sold by it." };
}
