import "server-only";
import { db } from "@/lib/db";

// Owner-controlled settings share the existing owner-scoped key/value table.
// They are never model memory and cannot be changed through memory endpoints.
export const TOOL_PERMISSION_PREFIX = "_tool_permission:";
const key = `${TOOL_PERMISSION_PREFIX}saved.read`;
const tradingKey = `${TOOL_PERMISSION_PREFIX}trading.read`;
export async function tradingReadAllowed(userId: string) {
  return (await db.assistantMemory.findUnique({ where: { userId_key: { userId, key: tradingKey } } }))?.value === "allow";
}
export async function savedReadAllowed(userId: string) {
  return (await db.assistantMemory.findUnique({ where: { userId_key: { userId, key } } }))?.value === "allow";
}
export async function toolAccessSnapshot(userId: string) {
  const [savedRead, tradingRead, activity] = await Promise.all([
    savedReadAllowed(userId),
    tradingReadAllowed(userId),
    db.assistantActivity.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 30,
      select: { id: true, tool: true, module: true, status: true, reason: true, createdAt: true } }),
  ]);
  return { savedRead, tradingRead, activity };
}
export async function setSavedRead(userId: string, allow: boolean) {
  await db.$transaction(async tx => {
    await tx.assistantMemory.upsert({ where: { userId_key: { userId, key } },
      create: { userId, key, value: allow ? "allow" : "deny" }, update: { value: allow ? "allow" : "deny" } });
    await tx.assistantActivity.create({ data: { userId, tool: "permission.saved.read", module: "economic-agent", status: "completed",
      reason: allow ? "Owner enabled cloud saved-item title reads." : "Owner revoked cloud saved-item title reads." } });
  });
}

export async function setTradingRead(userId: string, allow: boolean) {
  await db.$transaction(async tx => {
    await tx.assistantMemory.upsert({ where: { userId_key: { userId, key: tradingKey } },
      create: { userId, key: tradingKey, value: allow ? "allow" : "deny" }, update: { value: allow ? "allow" : "deny" } });
    await tx.assistantActivity.create({ data: { userId, tool: "permission.trading.read", module: "markets", status: "completed",
      reason: allow ? "Owner enabled Bybit Unified balance reads." : "Owner revoked Bybit Unified balance reads." } });
  });
}
