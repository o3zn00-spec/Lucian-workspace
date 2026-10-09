import { sleep } from "workflow";
import { start } from "workflow/api";
async function tick(userId: string, intentId: string, generation: string) {
  "use step";
  const { tickOrderWatch } = await import("@/lib/bybit/order-watch");
  return tickOrderWatch(userId, intentId, generation);
}
async function record(userId: string, intentId: string, generation: string, runId: string) {
  "use step";
  const { recordOrderWatch } = await import("@/lib/bybit/order-watch");
  await recordOrderWatch(userId, intentId, generation, runId);
}
export async function orderWatchWorkflow(userId: string, intentId: string, generation: string): Promise<void> {
  "use workflow";
  // Small replay logs; each generation has a fixed 24-hour server deadline.
  for (let cycle = 0; cycle < 60; cycle++) {
    if ((await tick(userId, intentId, generation)).done) return;
    await sleep("60s");
  }
  if ((await tick(userId, intentId, generation)).done) return;
  const child = await start(orderWatchWorkflow, [userId, intentId, generation], { region: "cpt1" });
  await record(userId, intentId, generation, child.runId);
}
