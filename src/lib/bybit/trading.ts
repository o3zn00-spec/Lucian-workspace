import "server-only";

import { db } from "@/lib/db";
import { bybitRequest } from "@/lib/bybit/client";




function maxOrderQuote(): number {
  return Math.max(1, Number(process.env.MAX_LIVE_ORDER_QUOTE ?? "50"));
}









export async function getTradingProfile(userId: string) {
  return db.tradingAgentProfile.upsert({ where: { userId }, create: { userId, maxOrderUsd: maxOrderQuote() }, update: {} });
}







export async function listBybitOrders(userId: string) {
  const [open, history] = await Promise.all([
    bybitRequest<{ list?: Array<Record<string, string>> }>(userId, "/v5/order/realtime", { query: { category: "spot", openOnly: 0, limit: 50 } }),
    bybitRequest<{ list?: Array<Record<string, string>> }>(userId, "/v5/order/history", { query: { category: "spot", limit: 50 } }),
  ]);
  return { open: open.list ?? [], history: history.list ?? [] };
}

export async function listBybitPositions(userId: string) {
  const result = await bybitRequest<{ list?: Array<Record<string, string>> }>(userId, "/v5/position/list", { query: { category: "linear", settleCoin: "USDT", limit: 50 } });
  return result.list ?? [];
}

export async function listBybitTrades(userId: string) {
  const result = await bybitRequest<{ list?: Array<Record<string, string>> }>(userId, "/v5/execution/list", { query: { category: "spot", limit: 100 } });
  return result.list ?? [];
}
