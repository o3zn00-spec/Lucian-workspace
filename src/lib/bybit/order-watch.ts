import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { isConfiguredOwnerEmail } from "@/lib/auth/owner-identity";
import { observeOrder } from "./order-observer";

const prefix = "_order_watch:";
const eligible = ["executing", "submitted", "reconciliation_required", "partially_filled", "exchange_open"];
type Watch = { generation: string; expiresAtMs: number; heartbeatMs: number; status: "starting" | "watching" | "ended" | "dispatch_failed"; runId: string | null; supervisionToken?: string; supervisorRunId?: string | null; recoveryAttempts?: number };
type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
const where = (userId: string, intentId: string) => ({ userId_key: { userId, key: prefix + intentId } });
const read = (value?: string): Watch | null => {
  if (!value) return null;
  try {
    const s = JSON.parse(value);
    if (!s || typeof s !== "object" || Array.isArray(s)) return null;
    const validTime = (t: unknown) => typeof t === "number" && Number.isSafeInteger(t) && t > 0 && t < 8640000000000000;
    const validId = (id: unknown) => typeof id === "string" && id.length > 0 && id.length <= 200;
    if (!validId(s.generation) || !(s.runId === null || validId(s.runId)) || !validTime(s.expiresAtMs) || !validTime(s.heartbeatMs) || !["starting", "watching", "ended", "dispatch_failed"].includes(s.status)) return null;
    if (s.supervisionToken !== undefined && !validId(s.supervisionToken) || s.supervisorRunId !== undefined && s.supervisorRunId !== null && !validId(s.supervisorRunId) || s.recoveryAttempts !== undefined && (!Number.isInteger(s.recoveryAttempts) || s.recoveryAttempts < 0 || s.recoveryAttempts > 8)) return null;
    return s as Watch;
  } catch { return null; }
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
    const state: Watch = { generation: randomUUID(), expiresAtMs: now + 86400000, heartbeatMs: now, status: "starting", runId: null, supervisionToken: randomUUID(), supervisorRunId: null, recoveryAttempts: 0 };
    await save(tx, userId, intentId, state);
    return { claimed: true, state };
  });
}
// A separate read-only supervisor can replace a failed observer. It preserves
// the owner's original deadline, bounds retries and never starts a new order.
export async function recoverOrderWatch(userId: string, intentId: string, token: string) {
  return locked(userId, intentId, async tx => {
    const state = read((await tx.assistantMemory.findUnique({ where: where(userId, intentId) }))?.value);
    if (!state || state.supervisionToken !== token || state.status === "ended" || state.expiresAtMs <= Date.now()) return { done: true, claimed: false, state: null };
    const owner = await tx.user.findUnique({ where: { id: userId }, select: { email: true, status: true } });
    const intent = await tx.liveTradeIntent.findFirst({ where: { id: intentId, userId, initiatedBy: "user", state: { in: eligible } } });
    if (!intent || owner?.status !== "active" || !isConfiguredOwnerEmail(owner.email)) {
      state.status = "ended"; await save(tx, userId, intentId, state);
      return { done: true, claimed: false, state: null };
    }
    if (state.heartbeatMs > Date.now() - 180000 && state.status !== "dispatch_failed") return { done: false, claimed: false, state: null };
    if ((state.recoveryAttempts ?? 0) >= 8) return { done: true, claimed: false, state: null };
    state.generation = randomUUID(); state.heartbeatMs = Date.now(); state.status = "starting"; state.runId = null;
    state.recoveryAttempts = (state.recoveryAttempts ?? 0) + 1;
    await save(tx, userId, intentId, state);
    return { done: false, claimed: true, state };
  });
}
export async function recordWatchSupervisor(userId: string, intentId: string, token: string, runId: string) {
  return locked(userId, intentId, async tx => {
    const state = read((await tx.assistantMemory.findUnique({ where: where(userId, intentId) }))?.value);
    if (!state || state.supervisionToken !== token || state.status === "ended") return;
    state.supervisorRunId = runId; await save(tx, userId, intentId, state);
  });
}
export async function stopOrderWatch(userId: string, intentId: string) {
  return locked(userId, intentId, async tx => {
    const state = read((await tx.assistantMemory.findUnique({ where: where(userId, intentId) }))?.value);
    if (!state) return;
    state.generation = randomUUID(); state.supervisionToken = randomUUID(); state.status = "ended";
    await save(tx, userId, intentId, state);
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
    return [[row.key.slice(prefix.length), { status: active ? state.status : state.status === "ended" ? "ended" : "delayed", expiresAt: new Date(state.expiresAtMs).toISOString(), lastCheck: new Date(state.heartbeatMs).toISOString(), automaticRecovery: Boolean(state.supervisorRunId), recoveryAttempts: state.recoveryAttempts ?? 0 }]];
  }));
}
