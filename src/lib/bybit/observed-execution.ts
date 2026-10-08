import "server-only";
import { start } from "workflow/api";
import { db } from "@/lib/db";
import { orderObserverWorkflow } from "@/workflows/order-observer";
import { executeTerminalOrder } from "./terminal";

async function launchObserver(userId: string, intentId: string) {
  try {
    const intent = await db.liveTradeIntent.findFirst({ where: { id: intentId, userId, initiatedBy: "user", state: { in: ["submitted", "reconciliation_required"] } } });
    if (!intent) return;
    const run = await start(orderObserverWorkflow, [userId, intentId], { region: "cpt1" });
    await db.tradingAuditEvent.create({ data: { userId, intentId, symbol: intent.productId, tradingMode: intent.tradingMode, action: "order.observer.start", status: "started", details: { runId: run.runId, financialWrites: 0 } } });
  } catch {
    // A worker start failure must never turn a submitted order into a retry.
    console.error("Exchange observer start unavailable; use manual reconciliation.");
  }
}

export async function executeObservedOrder(userId: string, input: Record<string, unknown>) {
  try {
    const result = await executeTerminalOrder(userId, input);
    await launchObserver(userId, result.intentId);
    return result;
  } catch (error) {
    // Ambiguous POSTs need the same read-only recovery as acknowledged orders.
    if (typeof input.intentId === "string") await launchObserver(userId, input.intentId).catch(() => undefined);
    throw error;
  }
}
