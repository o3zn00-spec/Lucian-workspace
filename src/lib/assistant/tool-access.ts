import "server-only";
import { db } from "@/lib/db";

// Owner-controlled settings share the existing owner-scoped key/value table.
// They are never model memory and cannot be changed through memory endpoints.
export const TOOL_PERMISSION_PREFIX = "_tool_permission:";
const key = `${TOOL_PERMISSION_PREFIX}saved.read`;
const activityKey = `${TOOL_PERMISSION_PREFIX}trading.activity.read`;
export async function tradingActivityReadAllowed(userId: string) {
  return (await db.assistantMemory.findUnique({ where: { userId_key: { userId, key: activityKey } } }))?.value === "allow";
}
const tradingKey = `${TOOL_PERMISSION_PREFIX}trading.read`;
export async function tradingReadAllowed(userId: string) {
  return (await db.assistantMemory.findUnique({ where: { userId_key: { userId, key: tradingKey } } }))?.value === "allow";
}
export async function savedReadAllowed(userId: string) {
  return (await db.assistantMemory.findUnique({ where: { userId_key: { userId, key } } }))?.value === "allow";
}
export async function toolAccessSnapshot(userId: string) {
  const permissionKeys = ["saved.read", "trading.read", "trading.activity.read", "records.read", "workspace.read"];
  const [permissions, activity] = await Promise.all([
    db.assistantMemory.findMany({ where: { userId, key: { in: permissionKeys.map(tool => `${TOOL_PERMISSION_PREFIX}${tool}`) } },
      take: 5, select: { key: true, value: true } }),
    db.assistantActivity.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 30,
      select: { id: true, tool: true, module: true, status: true, reason: true, createdAt: true } }),
  ]);
  const allowed = (tool: string) => permissions.some(permission => permission.key === `${TOOL_PERMISSION_PREFIX}${tool}` && permission.value === "allow");
  return { savedRead: allowed("saved.read"), tradingRead: allowed("trading.read"), tradingActivityRead: allowed("trading.activity.read"),
    recordsRead: allowed("records.read"), workspaceRead: allowed("workspace.read"), activity };
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

export async function setTradingActivityRead(userId: string, allow: boolean) {
  await db.$transaction(async tx => {
    await tx.assistantMemory.upsert({ where: { userId_key: { userId, key: activityKey } },
      create: { userId, key: activityKey, value: allow ? "allow" : "deny" }, update: { value: allow ? "allow" : "deny" } });
    await tx.assistantActivity.create({ data: { userId, tool: "permission.trading.activity.read", module: "markets", status: "completed",
      reason: allow ? "Owner enabled bounded Bybit order/position reads." : "Owner revoked Bybit order/position reads." } });
  });
}

export async function recordsReadAllowed(userId: string) { return (await db.assistantMemory.findUnique({ where: { userId_key: { userId, key: `${TOOL_PERMISSION_PREFIX}records.read` } } }))?.value === "allow"; }
export async function workspaceReadAllowed(userId: string) { return (await db.assistantMemory.findUnique({ where: { userId_key: { userId, key: `${TOOL_PERMISSION_PREFIX}workspace.read` } } }))?.value === "allow"; }
export async function setRecordToolRead(userId: string, tool: "records.read" | "workspace.read", allow: boolean) {
  const key = `${TOOL_PERMISSION_PREFIX}${tool}`;
  await db.$transaction(async tx => {
    await tx.assistantMemory.upsert({ where: { userId_key: { userId, key } }, create: { userId, key, value: allow ? "allow" : "deny" }, update: { value: allow ? "allow" : "deny" } });
    await tx.assistantActivity.create({ data: { userId, tool: `permission.${tool}`, module: tool === "workspace.read" ? "dev-workspace" : "economic-agent", status: "completed", reason: `Owner ${allow ? "enabled" : "revoked"} bounded ${tool} access.` } });
  });
}
