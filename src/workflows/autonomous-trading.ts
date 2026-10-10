import { sleep } from "workflow";
import { start } from "workflow/api";
async function cycle(userId: string, id: string, generation: string) {
  "use step";
  const { tickAutonomousSession } = await import("@/lib/bybit/autonomous-session");
  return tickAutonomousSession(userId, id, generation);
}
async function record(userId: string, id: string, generation: string, runId: string, supervisor = false) {
  "use step";
  const { recordAutonomousRun } = await import("@/lib/bybit/autonomous-session");
  await recordAutonomousRun(userId, id, generation, runId, supervisor);
}
export async function autonomousTradingWorkflow(userId: string, id: string, generation: string): Promise<void> {
  "use workflow";
  for (let i = 0; i < 60; i++) {
    const r = await cycle(userId, id, generation); if (r.done) return;
    await sleep(r.fast ? "10s" : "60s");
  }
  const child = await start(autonomousTradingWorkflow, [userId, id, generation], { region: "cpt1" });
  await record(userId, id, generation, child.runId);
}
async function supervise(userId: string, id: string) {
  "use step";
  const { recoverAutonomousSession, autonomousSnapshot, recordAutonomousRun } = await import("@/lib/bybit/autonomous-session");
  const state = await recoverAutonomousSession(userId, id);
  if (state) {
    try { const run = await start(autonomousTradingWorkflow, [userId, id, state.generation], { region: "cpt1" }); await recordAutonomousRun(userId, id, state.generation, run.runId); }
    catch { await recordAutonomousRun(userId, id, state.generation, null); }
  }
  const latest = await autonomousSnapshot(userId);
  return !latest.session || latest.session.id !== id || latest.session.status === "stopped";
}
export async function autonomousTradingSupervisor(userId: string, id: string): Promise<void> {
  "use workflow";
  for (let i = 0; i < 60; i++) { await sleep("3m"); if (await supervise(userId, id)) return; }
  const child = await start(autonomousTradingSupervisor, [userId, id], { region: "cpt1" });
  await recordSupervisor(userId, id, child.runId);
}
async function recordSupervisor(userId: string, id: string, runId: string) {
  "use step";
  const { recordAutonomousSupervisor } = await import("@/lib/bybit/autonomous-session");
  await recordAutonomousSupervisor(userId, id, runId);
}
