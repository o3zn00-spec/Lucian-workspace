import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { saveCloudSnapshot } from "../src/lib/workspace/cloud-save";
import { validateCloudSnapshot } from "../src/lib/workspace/cloud-validation";

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/lucian_restoration_dev_20261007", "Named local test database required");
  const client = new PrismaClient();
  const owner = randomUUID(), foreign = randomUUID(), id = randomUUID(), fresh = randomUUID();
  const snapshot = (content: string) => validateCloudSnapshot({ project: { id, name: "Concurrent save fixture", files: [] }, contents: { "index.ts": content } });
  try {
    for (const userId of [owner, foreign]) await client.user.create({ data: { id: userId, email: `${userId}@fixture.invalid`, username: userId } });
    assert.equal((await saveCloudSnapshot(client, owner, id, null, snapshot("original"))).status, 200);
    assert.equal((await saveCloudSnapshot(client, foreign, id, 1, snapshot("foreign"))).status, 404);
    assert.equal((await saveCloudSnapshot(client, owner, id, null, snapshot("missing revision"))).status, 409);
    const results = await Promise.all(["tab one", "tab two"].map(content => saveCloudSnapshot(client, owner, id, 1, snapshot(content))));
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
    const row = await client.cloudWorkspaceProject.findUniqueOrThrow({ where: { id } });
    assert.equal(row.revision, 2);
    assert(["tab one", "tab two"].includes((row.contents as Record<string, string>)["index.ts"]));
    assert.equal((await saveCloudSnapshot(client, owner, id, 1, snapshot("stale retry"))).status, 409);
    await client.cloudWorkspaceProject.delete({ where: { id } });
    assert.equal((await saveCloudSnapshot(client, owner, id, 2, snapshot("resurrect"))).status, 409);
    const createSnapshot = { ...snapshot("create race"), project: { ...snapshot("create race").project, id: fresh } };
    const creates = await Promise.all([1, 2].map(() => saveCloudSnapshot(client, owner, fresh, null, createSnapshot)));
    assert.deepEqual(creates.map(r => r.status).sort(), [200, 409]);
    console.log("PASS actual PostgreSQL concurrent saves/creates, owner isolation, stale/missing revision and deleted-project protection.");
  } finally {
    await client.user.deleteMany({ where: { id: { in: [owner, foreign] } } });
    await client.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
