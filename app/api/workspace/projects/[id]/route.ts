import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/session";
import { validateCloudSnapshot } from "@/lib/workspace/cloud-validation";
import { saveCloudSnapshot } from "@/lib/workspace/cloud-save";

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
    const match = req.headers.get("if-match");
    const expected = match === null ? null : Number(match);
    if (expected !== null && (!Number.isSafeInteger(expected) || expected < 1)) {
      return NextResponse.json({ error: "Invalid project revision." }, { status: 400 });
    }
    const result = await saveCloudSnapshot(db, userId, id, expected, snapshot);
    return result.status === 200 ? NextResponse.json(result.row) : NextResponse.json(result, { status: result.status });
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
