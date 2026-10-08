import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { PaperPlanError, validatePaperPlan } from "./paper-policy";
const key = "_paper_session:plan";
export async function paperPlanSnapshot(userId: string) {
  const row = await db.assistantMemory.findUnique({ where: { userId_key: { userId, key } } });
  if (!row) return { plan: null, revision: null, status: "not_started", runtimeAvailable: false };
  try {
    const stored = JSON.parse(row.value);
    if (typeof stored.revision !== "string" || typeof stored.savedAt !== "string") throw Error("Invalid state");
    return { plan: validatePaperPlan(stored.plan), revision: stored.revision, savedAt: stored.savedAt, status: "draft", runtimeAvailable: false };
  } catch { throw new PaperPlanError("Saved plan is unreadable. It has not been replaced or started.", 503); }
}
export async function savePaperPlan(userId: string, body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new PaperPlanError("Invalid plan request.");
  const b = body as Record<string, unknown>;
  if (Object.keys(b).length !== 2 || !('plan' in b) || !('revision' in b) || !(b.revision === null || (typeof b.revision === "string" && b.revision.length <= 100))) throw new PaperPlanError("Invalid plan revision.");
  const plan = validatePaperPlan(b.plan);
  return db.$transaction(async tx => {
    const previous = await tx.assistantMemory.findUnique({ where: { userId_key: { userId, key } } });
    if (previous) {
      let stored;
      try { stored = JSON.parse(previous.value); } catch { throw new PaperPlanError("Saved plan is unreadable.",503); }
      if (stored.revision !== b.revision) throw new PaperPlanError("Plan changed elsewhere. Reload before saving.",409);
    } else if (b.revision !== null) throw new PaperPlanError("Plan changed elsewhere. Reload before saving.",409);
    const revision = randomUUID(), savedAt = new Date().toISOString();
    const value = JSON.stringify({ plan, revision, savedAt });
    if (previous) {
      const result = await tx.assistantMemory.updateMany({ where: { userId, key, value: previous.value }, data: { value } });
      if (result.count !== 1) throw new PaperPlanError("Plan changed elsewhere. Reload before saving.",409);
    } else {
      // Unique (owner,key) prevents concurrent first saves from overwriting.
      await tx.assistantMemory.create({ data: { userId, key, value } });
    }
    await tx.assistantActivity.create({ data: { userId, tool: "paper.plan.save", module: "markets", status: "completed", reason: "Owner saved a simulated spot plan. No session authorized or started; no financial action." } });
    return { plan, revision, savedAt, status: "draft", runtimeAvailable: false };
  });
}
