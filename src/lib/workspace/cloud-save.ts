import { Prisma, type PrismaClient } from "@prisma/client";
import type { validateCloudSnapshot } from "./cloud-validation";

/** A stale device must never replace a newer cloud snapshot. */
export async function saveCloudSnapshot(
  client: PrismaClient,
  userId: string,
  id: string,
  expected: number | null,
  snapshot: ReturnType<typeof validateCloudSnapshot>,
) {
  const data = { project: snapshot.project as unknown as Prisma.InputJsonValue, contents: snapshot.contents };
  const existing = await client.cloudWorkspaceProject.findUnique({ where: { id } });
  if (existing && existing.userId !== userId) return { status: 404, error: "Project not found." } as const;
  if (!existing) {
    if (expected !== null) return { status: 409, error: "Project no longer exists. Reload before saving." } as const;
    try {
      return { status: 200, row: await client.cloudWorkspaceProject.create({ data: { id, userId, ...data } }) } as const;
    } catch (error) {
      // Another tab may have created this id after our read. Never upsert over it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { status: 409, error: "Project changed in another tab or device." } as const;
      }
      throw error;
    }
  }
  if (expected === null || expected !== existing.revision) {
    return { status: 409, error: "Project changed in another tab or device.", current: existing } as const;
  }
  return client.$transaction(async (tx) => {
    const saved = await tx.cloudWorkspaceProject.updateMany({
      where: { id, userId, revision: expected },
      data: { ...data, revision: { increment: 1 } },
    });
    if (saved.count !== 1) {
      return { status: 409, error: "Project changed in another tab or device.",
        current: await tx.cloudWorkspaceProject.findFirst({ where: { id, userId } }) } as const;
    }
    return { status: 200, row: await tx.cloudWorkspaceProject.findFirstOrThrow({ where: { id, userId } }) } as const;
  });
}
