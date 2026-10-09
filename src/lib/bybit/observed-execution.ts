import "server-only";
import { start } from "workflow/api";
import { db } from "@/lib/db";
import { orderWatchWorkflow } from "@/workflows/order-watch";
import { claimOrderWatch, recordOrderWatch } from "./order-watch";
import { executeTerminalOrder } from "./terminal";

async function launchObserver(userId: string, intentId: string) {
  try {
    const intent = await db.liveTradeIntent.findFirst({ where: { id: intentId, userId, initiatedBy: "user", state: { in: ["executing", "submitted", "reconciliation_required", "partially_filled", "exchange_open"] } } });
    if (!intent) return;
    const claim = await claimOrderWatch(userId, intentId);
    if (!claim.claimed) return;
    let run;
    try {
      run = await start(orderWatchWorkflow, [userId, intentId, claim.state.generation], { region: "cpt1" });
    } catch {
      await recordOrderWatch(userId, intentId, claim.state.generation, null).catch(() => undefined);
      throw Error("Monitor dispatch unavailable.");
    }
    await recordOrderWatch(userId, intentId, claim.state.generation, run.runId);
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
