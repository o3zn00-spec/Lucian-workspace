import "server-only";
import { db } from "@/lib/db";
import { bybitRequest, getBybitConfig } from "./client";
import { readCompleteBybitList } from "./pagination";
import { reconcileTerminalOrder } from "./reconciliation";

type Row = Record<string, unknown>;
export type ProtectionReview = {
  observedAt: string; symbol: string; entryStatus: string;
  requestedStopLoss: string | null; requestedTakeProfit: string | null;
  protectionVerified: false; exitVerified: false;
  status: "entry_unfilled" | "review_required";
  reason: string; candidates: Array<{ orderId: string; side: string; status: string; quantity: string; triggerPrice: string; stopOrderType: string; parentOrderLinkId: string | null }>;
};
// Evidence only. Spot currently has no documented parent link for attached
// exits. Similar price/quantity is never sufficient proof of ownership/coverage.
export async function reviewOrderProtection(userId: string, intentId: string): Promise<ProtectionReview> {
  let intent = await db.liveTradeIntent.findFirst({ where: { id: intentId, userId, initiatedBy: "user" } });
  if (!intent || !intent.providerOrderId || !["spot", "linear"].includes(intent.category) || !["bybit_live", "bybit_testnet"].includes(intent.tradingMode)) throw Error("Choose an acknowledged owner exchange order.");
  if (["executing", "submitted", "reconciliation_required", "partially_filled", "exchange_open", "cancelled_with_fills"].includes(intent.state)) {
    await reconcileTerminalOrder(userId, intentId);
    intent = await db.liveTradeIntent.findFirst({ where: { id: intentId, userId, initiatedBy: "user" } });
    if (!intent) throw Error("Owner reservation changed during review.");
  }
  const config = await getBybitConfig(userId);
  if (!config.configured || config.environment !== (intent.tradingMode === "bybit_live" ? "mainnet" : "testnet")) throw Error("Exchange connection does not match the owner reservation.");
  const page = await readCompleteBybitList<Row>(async cursor => {
    const response = await bybitRequest<{ category?: string; list?: Row[]; nextPageCursor?: string }>(userId, "/v5/order/realtime", {
      query: { category: intent.category, symbol: intent.productId, openOnly: 0, limit: 50, ...(cursor ? { cursor } : {}) },
    }, config);
    if (response.category !== intent.category || !Array.isArray(response.list) || response.list.length > 50) throw Error("Protective order records are malformed or mismatched.");
    return response;
  }, "Protective orders");
  const candidates: ProtectionReview["candidates"] = [];
  const seen = new Set<string>();
  for (const order of page.list ?? []) {
    if (order.symbol !== intent.productId || typeof order.orderId !== "string" || !order.orderId || seen.has(order.orderId)) throw Error("Protective order identity is invalid or duplicated.");
    seen.add(order.orderId);
    if (order.orderId === intent.providerOrderId || !["New", "Untriggered", "Triggered", "PartiallyFilled"].includes(String(order.orderStatus))) continue;
    if (!["Buy", "Sell"].includes(String(order.side)) || typeof order.qty !== "string" || !/^\d+(\.\d+)?$/.test(order.qty) || !Number.isFinite(Number(order.qty)) || Number(order.qty) <= 0) throw Error("Protective order quantity is unavailable.");
    if (!order.stopOrderType && (!order.triggerPrice || order.triggerPrice === "0")) continue;
    candidates.push({
      orderId: order.orderId, side: String(order.side), status: String(order.orderStatus), quantity: order.qty,
      triggerPrice: typeof order.triggerPrice === "string" ? order.triggerPrice : "",
      stopOrderType: typeof order.stopOrderType === "string" ? order.stopOrderType : "",
      parentOrderLinkId: typeof order.parentOrderLinkId === "string" && order.parentOrderLinkId ? order.parentOrderLinkId : null,
    });
    if (candidates.length > 100) throw Error("Protective order evidence exceeds this bounded review.");
  }
  const execution = intent.execution && typeof intent.execution === "object" && !Array.isArray(intent.execution) ? intent.execution : {};
  const matched = execution.reconciliation;
  const report = matched && typeof matched === "object" && !Array.isArray(matched) ? matched : {};
  const unfilled = report.cumExecQty === "0" && report.status === "New";
  const result: ProtectionReview = {
    observedAt: new Date().toISOString(), symbol: intent.productId, entryStatus: String(report.status ?? intent.state),
    requestedStopLoss: intent.stopLoss?.toString() ?? null, requestedTakeProfit: intent.takeProfit?.toString() ?? null,
    protectionVerified: false, exitVerified: false, status: unfilled ? "entry_unfilled" : "review_required", candidates,
    reason: unfilled ? "Entry is recorded as unfilled. Requested stop/target fields and candidate orders do not verify future protective exits."
      : "Verify exact protective order identity, remaining quantity and fills before treating exposure as protected. Candidate orders alone are not proof of coverage or an exit.",
  };
  await db.tradingAuditEvent.create({ data: { userId, intentId, symbol: intent.productId, tradingMode: intent.tradingMode, action: "order.protection.review", status: result.status, details: { ...result, financialWrites: 0 } } });
  return result;
}
