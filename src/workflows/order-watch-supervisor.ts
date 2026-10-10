import { sleep } from "workflow";
import { start } from "workflow/api";
import { orderWatchWorkflow } from "./order-watch";

async function supervise(userId: string, intentId: string, token: string) {
  "use step";
  const { recoverOrderWatch, recordOrderWatch } = await import("@/lib/bybit/order-watch");
  const claim = await recoverOrderWatch(userId, intentId, token);
  if (claim.claimed && claim.state) {
    try {
      const run = await start(orderWatchWorkflow, [userId, intentId, claim.state.generation], { region: "cpt1" });
      await recordOrderWatch(userId, intentId, claim.state.generation, run.runId);
      console.info("Read-only order observer recovered.");
    } catch {
      await recordOrderWatch(userId, intentId, claim.state.generation, null);
      console.warn("Read-only observer recovery dispatch unavailable.");
    }
  }
  return { done: claim.done };
}
async function record(userId: string, intentId: string, token: string, runId: string) {
  "use step";
  const { recordWatchSupervisor } = await import("@/lib/bybit/order-watch");
  await recordWatchSupervisor(userId, intentId, token, runId);
}
export async function orderWatchSupervisor(userId: string, intentId: string, token: string): Promise<void> {
  "use workflow";
  for (let cycle = 0; cycle < 60; cycle++) {
    await sleep("3m");
    if ((await supervise(userId, intentId, token)).done) return;
  }
  const next = await start(orderWatchSupervisor, [userId, intentId, token], { region: "cpt1" });
  await record(userId, intentId, token, next.runId);
}
