import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

async function main() {
// Opt-in integration test. Refuse every database except the named local sandbox.
const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert(["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname === "/lucian_restoration_dev_20261007", "Local restoration database required");
const base = process.env.ASSISTANT_TEST_ORIGIN ?? "http://127.0.0.1:43183";
assert(new URL(base).hostname === "127.0.0.1", "Loopback test host required");
const db = new PrismaClient();
const cookies = new Map<string, string>();
function receive(response: Response) {
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";")[0]; const separator = pair.indexOf("=");
    cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}
function cookieHeader() { return [...cookies].map(([key, value]) => `${key}=${value}`).join("; "); }
const anon = await fetch(base + "/api/assistant");
assert([401, 403].includes(anon.status), `Unexpected anonymous status: ${anon.status}`);
const csrfResponse = await fetch(base + "/api/auth/csrf"); receive(csrfResponse);
const { csrfToken } = await csrfResponse.json();
const login = await fetch(base + "/api/auth/callback/credentials", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader(), Origin: base }, body: new URLSearchParams({ csrfToken, username: process.env.LUCIAN_OWNER_EMAIL!, password: process.env.LUCIAN_OWNER_PASSWORD!, callbackUrl: base }) }); receive(login);
async function api(body?: Record<string, unknown>, query = "", origin = base) {
  const response = await fetch(base + "/api/assistant" + query, { method: body ? "POST" : "GET", headers: { Cookie: cookieHeader(), Origin: origin, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, data: await response.json() };
}
const initial = await api(); assert.equal(initial.status, 200);
const ownerId = (await db.user.findUniqueOrThrow({ where: { email: process.env.LUCIAN_OWNER_EMAIL } })).id;
const prior = await db.assistantProfile.findUnique({ where: { userId: ownerId } });
const id = randomUUID(), foreignId = randomUUID(), outsiderId = randomUUID(), memoryKey = `test-${id}`;
const context = { module: "home", recordId: null };
try {
  const created = await api({ action: "create", id, title: "Foundation integration test" }); assert.equal(created.status, 200);
  assert.equal((await api({ action: "create", id, title: "Retry" })).status, 200);
  const message = { action: "message", conversationId: id, requestId: randomUUID(), content: "Foundation test message", context };
  assert.equal((await api(message)).status, 200);
  assert.equal((await api(message)).status, 200);
  assert.equal((await api({ ...message, content: "Conflicting retry" })).status, 409);
  const state = await api(); assert.equal(state.data.messages.length, 1); assert.equal(state.data.messages[0].role, "user");
  assert.equal(state.data.providerStatus, "not_connected");
  for (const model of ["test-model-a", "test-model-b"]) {
    assert.equal((await api({ action: "selection", provider: "test-unverified", model })).status, 200);
    const after = await api(); assert.equal(after.data.conversation.id, id); assert.equal(after.data.messages.length, 1); assert.equal(after.data.identity.name, "Lilthe");
  }
  assert.equal((await api({ action: "memory", key: memoryKey, value: "Explicit disposable test preference" })).status, 200);
  assert((await api()).data.memories.some((m: { key: string }) => m.key === memoryKey));
  const deny = await api({ action: "tool", conversationId: id, context, tool: "trading.execute" });
  assert.equal(deny.data.allowed, false); assert.equal(deny.data.event.status, "denied");
  assert.equal((await api({ action: "tool", conversationId: id, context, tool: "unknown.tool" })).data.allowed, false);
  const navigate = await api({ action: "tool", conversationId: id, context: { module: "markets" }, tool: "app.navigate" });
  assert.equal(navigate.data.result.path, "/markets");
  assert.equal((await api({ ...message, context: { module: "not-real" } })).status, 400);
  assert.equal((await api({ ...message, content: "x".repeat(21000) })).status, 413);
  assert.equal((await api(message, "", "https://untrusted.example")).status, 403);
  await db.user.create({ data: { id: outsiderId, username: `test-${outsiderId}`, email: `${outsiderId}@example.test` } });
  await db.assistantConversation.create({ data: { id: foreignId, userId: outsiderId, title: "Other owner" } });
  assert.equal((await api(undefined, `?conversationId=${foreignId}`)).status, 404);
  for (const action of ["activate", "message", "tool"]) assert.equal((await api({ ...message, action, conversationId: foreignId, tool: "app.capabilities" })).status, 404);
  assert.equal((await api({ action: "create", id: foreignId, title: "Collision" })).status, 404);
  assert.equal((await api(undefined, `?conversationId=${id}`)).data.messages.length, 1);
  const exportResponse = await fetch(base + "/api/auth/export-data", { headers: { Cookie: cookieHeader() } });
  assert.equal(exportResponse.status, 200); const exported = await exportResponse.json();
  assert(exported.assistantConversations.some((c: { id: string }) => c.id === id));
  assert(!exported.assistantConversations.some((c: { id: string }) => c.id === foreignId));
  console.log("PASS: auth, ownership, retries/conflicts, persistence, model independence, memory, tool denial/audit, context validation, body limit, origin guard and export.");
} finally {
  await db.assistantActivity.deleteMany({ where: { userId: ownerId, conversationId: id } });
  await db.assistantMemory.deleteMany({ where: { userId: ownerId, key: memoryKey } });
  await db.assistantConversation.deleteMany({ where: { id, userId: ownerId } });
  await db.user.deleteMany({ where: { id: outsiderId } });
  if (prior) await db.assistantProfile.update({ where: { userId: ownerId }, data: { activeConversationId: prior.activeConversationId, selectedModel: prior.selectedModel, selectedProvider: prior.selectedProvider } });
  else await db.assistantProfile.deleteMany({ where: { userId: ownerId } });
  await db.$disconnect();
}

}
main().catch(error => {
  if (error?.code === "ERR_ASSERTION") console.error(error.message); console.error("Assistant foundation integration test failed. Inspect the local test server without exposing credentials."); process.exitCode = 1; });
