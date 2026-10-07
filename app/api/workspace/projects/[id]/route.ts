import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/session";
import { validateCloudSnapshot } from "@/lib/workspace/cloud-validation";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Context) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const row = await db.cloudWorkspaceProject.findFirst({ where: { id, userId } });
    if (!row) return NextResponse.json({ error: "Project not found." }, { status: 404 });
    return NextResponse.json(row);
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}

export async function PUT(req: Request, { params }: Context) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    const body = await req.json();
    const snapshot = validateCloudSnapshot(body);
    if (snapshot.project.id !== id) return NextResponse.json({ error: "Project id mismatch." }, { status: 400 });
    const expected = Number(req.headers.get("if-match"));
    const existing = await db.cloudWorkspaceProject.findUnique({ where: { id } });
    if (existing && existing.userId !== userId) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }
    if (existing && Number.isInteger(expected) && expected > 0 && existing.revision !== expected) {
      return NextResponse.json({ error: "Project changed in another tab or device.", current: existing }, { status: 409 });
    }
    const row = await db.cloudWorkspaceProject.upsert({
      where: { id },
      create: { id, userId, project: snapshot.project as unknown as Prisma.InputJsonValue, contents: snapshot.contents },
      update: { project: snapshot.project as unknown as Prisma.InputJsonValue, contents: snapshot.contents, revision: { increment: 1 } },
    });
    return NextResponse.json(row);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save project.";
    const status = message === "Authentication required." ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_req: Request, { params }: Context) {
  try {
    const userId = await requireUserId();
    const { id } = await params;
    await db.cloudWorkspaceProject.deleteMany({ where: { id, userId } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}
