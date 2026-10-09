import { sleep } from "workflow";
import { start } from "workflow/api";
async function cycle(userId: string, id: string, generation: string) {
  "use step";
  const { tickLiveReview } = await import("@/lib/assistant/live-review-runtime");
  return tickLiveReview(userId, id, generation);
}
async function record(userId: string, id: string, generation: string, runId: string) {
  "use step";
  const { recordLiveReviewRun } = await import("@/lib/assistant/live-review-runtime");
  await recordLiveReviewRun(userId, id, generation, runId);
}
export async function liveReviewWorkflow(userId: string, id: string, generation: string): Promise<void> {
  "use workflow";
  for (let i = 0; i < 60; i++) {
    if ((await cycle(userId, id, generation)).done) return;
    await sleep("60s");
  }
  if ((await cycle(userId, id, generation)).done) return;
  const child = await start(liveReviewWorkflow, [userId, id, generation], { region: "cpt1" });
  await record(userId, id, generation, child.runId);
}
