import "server-only";
import { db } from "@/lib/db";
import { reconcileTerminalOrder } from "./reconciliation";

const pending = ["executing", "submitted", "reconciliation_required", "partially_filled", "exchange_open", "cancelled_with_fills"];

// This worker has no exchange mutation capability. Unknown records preserve
// the reservation; they never imply that submission failed or permit a retry.
export async function observeOrder(userId: string, intentId: string, final = false) {
  const intent = await db.liveTradeIntent.findFirst({ where: { id: intentId, userId, initiatedBy: "user" } });
  if (!intent || !pending.includes(intent.state)) return { done: true };
  let state = intent.state, resolved = false, checked = false;
  try {
    const result = await reconcileTerminalOrder(userId, intentId);
    state = result.state;
    resolved = result.resolved;
    checked = true;
  } catch {
    // Do not persist provider errors that could contain credentials. A later
    // read retries reconciliation, not the financial action.
  }
  const done = resolved || state === "cancelled_with_fills" || final;
  await db.tradingAuditEvent.create({ data: {
    userId, intentId, symbol: intent.productId, tradingMode: intent.tradingMode,
    action: "order.observer", status: resolved ? "resolved" : done ? "review_required" : checked ? "watching" : "read_unavailable",
    details: { state, checked, protectionVerified: false, final, financialWrites: 0 },
  } });
  return { done };
}
