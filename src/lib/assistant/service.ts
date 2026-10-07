import "server-only";
import { db } from "@/lib/db";
import { ASSISTANT_CAPABILITIES, ASSISTANT_IDENTITY, ASSISTANT_MODULES, validateContext } from "./contracts";

export class AssistantError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new AssistantError(`Invalid ${name}.`);
  return value.trim();
}
async function ownedConversation(userId: string, id: unknown) {
  const conversation = await db.assistantConversation.findFirst({ where: { id: text(id, "conversation", 100), userId, deletedAt: null } });
  if (!conversation) throw new AssistantError("Conversation unavailable.", 404);
  return conversation;
}

export async function assistantSnapshot(userId: string, id?: string | null) {
  const profile = await db.assistantProfile.findUnique({ where: { userId } });
  const activeId = id ?? profile?.activeConversationId;
  const conversation = activeId ? await ownedConversation(userId, activeId) : null;
  const [conversations, recentMessages, memories, activity] = await Promise.all([
    db.assistantConversation.findMany({ where: { userId, deletedAt: null }, orderBy: { updatedAt: "desc" }, take: 100 }),
    conversation ? db.assistantMessage.findMany({ where: { conversationId: conversation.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 }) : [],
    db.assistantMemory.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 50 }),
    db.assistantActivity.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return { identity: ASSISTANT_IDENTITY, providerStatus: "not_connected", profile, conversation,
    conversations, messages: recentMessages.reverse(), memories, activity,
    modules: ASSISTANT_MODULES, capabilities: ASSISTANT_CAPABILITIES };
}

export async function assistantCommand(userId: string, body: Record<string, unknown>) {
  const action = body.action;
  if (action === "create") {
    const id = text(body.id, "conversation id", 100);
    const title = text(body.title, "title", 120);
    return db.$transaction(async tx => {
      const existing = await tx.assistantConversation.findUnique({ where: { id } });
      if (existing && existing.userId !== userId) throw new AssistantError("Conversation unavailable.", 404);
      const conversation = await tx.assistantConversation.upsert({ where: { id }, create: { id, userId, title }, update: {} });
      if (conversation.userId !== userId) throw new AssistantError("Conversation unavailable.", 404);
      await tx.assistantProfile.upsert({ where: { userId }, create: { userId, activeConversationId: id }, update: { activeConversationId: id } });
      return { conversation };
    });
  }
  if (action === "selection") {
    const provider = body.provider == null ? null : text(body.provider, "provider", 100);
    const model = body.model == null ? null : text(body.model, "model", 150);
    if ((provider === null) !== (model === null)) throw new AssistantError("Provider and model must be selected together.");
    // Selection is only a preference. C05 must validate credentials/capabilities.
    return { profile: await db.assistantProfile.upsert({ where: { userId }, create: { userId, selectedProvider: provider, selectedModel: model }, update: { selectedProvider: provider, selectedModel: model } }), validated: false };
  }
  if (action === "memory") {
    const key = text(body.key, "memory key", 80);
    const value = text(body.value, "memory value", 1500);
    // Explicit owner-entered memory only; no automatic extraction or model writes.
    return { memory: await db.assistantMemory.upsert({ where: { userId_key: { userId, key } }, create: { userId, key, value }, update: { value } }) };
  }
  const conversation = await ownedConversation(userId, body.conversationId);
  if (action === "activate") {
    return { profile: await db.assistantProfile.upsert({ where: { userId }, create: { userId, activeConversationId: conversation.id }, update: { activeConversationId: conversation.id } }) };
  }
  let context;
  try { context = validateContext(body.context); } catch (error) { throw new AssistantError((error as Error).message); }
  if (action === "message") {
    const requestId = text(body.requestId, "request id", 100);
    const content = text(body.content, "message", 16000);
    return db.$transaction(async tx => {
      const message = await tx.assistantMessage.upsert({ where: { conversationId_requestId: { conversationId: conversation.id, requestId } },
        create: { conversationId: conversation.id, requestId, content, role: "user", ...context }, update: {} });
      if (message.content !== content || message.module !== context.module || message.recordId !== context.recordId) throw new AssistantError("Retry id already belongs to a different message.", 409);
      await tx.assistantConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
      return { message, providerStatus: "not_connected" };
    });
  }
  if (action === "tool") {
    const tool = text(body.tool, "tool", 100);
    const capability = ASSISTANT_CAPABILITIES.find(c => c.id === tool);
    const allowed = capability?.available === true;
    const reason = allowed ? "Owner-authorized app utility." : capability?.description ?? "Unknown tool; access denied.";
    const event = await db.assistantActivity.create({ data: { userId, conversationId: conversation.id, tool, module: context.module, status: allowed ? "completed" : "denied", reason } });
    if (!allowed) return { allowed: false, event };
    return { allowed: true, event, result: tool === "app.navigate" ? ASSISTANT_MODULES.find(m => m.id === context.module) : { modules: ASSISTANT_MODULES, capabilities: ASSISTANT_CAPABILITIES } };
  }
  throw new AssistantError("Unknown assistant action.");
}
