import "server-only";
import { start } from "workflow/api";
import { orderWatchSupervisor } from "@/workflows/order-watch-supervisor";
import { recordWatchSupervisor } from "./order-watch";

export async function launchWatchSupervisor(userId: string, intentId: string, state: { supervisionToken?: string }) {
  if (!state.supervisionToken) return;
  try {
    const run = await start(orderWatchSupervisor, [userId, intentId, state.supervisionToken], { region: "cpt1" });
    await recordWatchSupervisor(userId, intentId, state.supervisionToken, run.runId);
  } catch {
    // Acknowledged exchange submissions must never turn into retries when
    // read-only supervision is unavailable.
    console.warn("Read-only monitor supervision unavailable; manual recovery remains available.");
  }
}
