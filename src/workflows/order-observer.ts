import { sleep } from "workflow";

async function checkOrder(userId: string, intentId: string, final: boolean) {
  "use step";
  const { observeOrder } = await import("@/lib/bybit/order-observer");
  const result = await observeOrder(userId, intentId, final);
  console.info("Exchange observation completed", { done: result.done, final });
  return result;
}

export async function orderObserverWorkflow(userId: string, intentId: string) {
  "use workflow";
  // Fifteen minutes of durable reads; unresolved or partially cancelled orders
  // remain reserved for owner review. No automatic cancellation/resubmission.
  for (let cycle = 0; cycle < 61; cycle++) {
    if ((await checkOrder(userId, intentId, cycle === 60)).done) return;
    await sleep("15s");
  }
}
