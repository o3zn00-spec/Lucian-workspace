import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { isConfiguredOwnerEmail } from "@/lib/auth/owner-identity";
import { observeOrder } from "./order-observer";

const prefix = "_order_watch:";
const eligible = ["executing", "submitted", "reconciliation_required", "partially_filled", "exchange_open"];
type Watch = { generation: string; expiresAtMs: number; heartbeatMs: number; status: "starting" | "watching" | "ended" | "dispatch_failed"; runId: string | null };
type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
const where = (userId: string, intentId: string) => ({ userId_key: { userId, key: prefix + intentId } });
const read = (value?: string): Watch | null => {
  if (!value) return null;
  try { const s = JSON.parse(value); return typeof s.generation === "string" && s.generation.length > 0 && (s.runId === null || typeof s.runId === "string") && Number.isSafeInteger(s.expiresAtMs) && s.expiresAtMs > 0 && s.expiresAtMs < 8640000000000000 && Number.isSafeInteger(s.heartbeatMs) && s.heartbeatMs > 0 && s.heartbeatMs < 8640000000000000 && ["starting", "watching", "ended", "dispatch_failed"].includes(s.status) ? s : null; } catch { return null; }
};
async function locked<T>(userId: string, intentId: string, fn: (tx: Tx) => Promise<T>) {
  return db.$transaction(async tx => { await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${prefix + userId + intentId}))::text`; return fn(tx); }, { maxWait: 5000, timeout: 10000 });
}
async function save(tx: Tx, userId: string, intentId: string, state: Watch) {
  return tx.assistantMemory.upsert({ where: where(userId, intentId), create: { userId, key: prefix + intentId, value: JSON.stringify(state) }, update: { value: JSON.stringify(state) } });
}
export async function claimOrderWatch(userId: string, intentId: string) {
  return locked(userId, intentId, async tx => {
    const intent = await tx.liveTradeIntent.findFirst({ where: { id: intentId, userId, initiatedBy: "user", state: { in: eligible } } });
    if (!intent || (intent.createdAt.getTime() > Date.now() || Date.now() - intent.createdAt.getTime() > 6 * 86400000)) throw Error("Choose a recent unresolved owner order.");
    const previous = read((await tx.assistantMemory.findUnique({ where: where(userId, intentId) }))?.value);
    const now = Date.now();
    if (previous && ["starting", "watching"].includes(previous.status) && previous.expiresAtMs > now && previous.heartbeatMs > now - 180000) return { claimed: false, state: previous };
    const state: Watch = { generation: randomUUID(), expiresAtMs: now + 86400000, heartbeatMs: now, status: "starting", runId: null };
    await save(tx, userId, intentId, state);
    return { claimed: true, state };
  });
}
export async function recordOrderWatch(userId: string, intentId: string, generation: string, runId: string | null) {
  return locked(userId, intentId, async tx => {
    const state = read((await tx.assistantMemory.findUnique({ where: where(userId, intentId) }))?.value);
    if (!state || state.generation !== generation || state.status === "ended") return;
    state.runId = runId; state.status = runId ? "watching" : "dispatch_failed";
    await save(tx, userId, intentId, state);
  });
}
// Only reads exchange records. It cannot submit, amend, cancel or close orders.
export async function tickOrderWatch(userId: string, intentId: string, generation: string) {
  const row = await db.assistantMemory.findUnique({ where: where(userId, intentId) });
  const initial = read(row?.value);
  if (!initial || initial.generation !== generation || ["ended", "dispatch_failed"].includes(initial.status)) return { done: true };
  const owner = await db.user.findUnique({ where: { id: userId }, select: { email: true, status: true } });
  const ended = initial.expiresAtMs <= Date.now() || owner?.status !== "active" || !isConfiguredOwnerEmail(owner.email);
  const result = ended ? { done: true } : await observeOrder(userId, intentId);
  await locked(userId, intentId, async tx => {
    const current = read((await tx.assistantMemory.findUnique({ where: where(userId, intentId) }))?.value);
    if (!current || current.generation !== generation) return;
    current.status = result.done ? "ended" : "watching"; current.heartbeatMs = Date.now();
    await save(tx, userId, intentId, current);
  });
  return result;
}

export async function orderWatchSummaries(userId: string, intentIds: string[]) {
  const rows = await db.assistantMemory.findMany({ where: { userId, key: { in: intentIds.slice(0, 20).map(id => prefix + id) } }, select: { key: true, value: true } });
  return Object.fromEntries(rows.flatMap(row => {
    const state = read(row.value); if (!state) return [];
    const active = ["starting", "watching"].includes(state.status) && state.expiresAtMs > Date.now() && state.heartbeatMs > Date.now() - 180000;
    return [[row.key.slice(prefix.length), { status: active ? state.status : state.status === "ended" ? "ended" : "delayed", expiresAt: new Date(state.expiresAtMs).toISOString(), lastCheck: new Date(state.heartbeatMs).toISOString() }]];
  }));
}
