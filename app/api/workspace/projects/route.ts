import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const userId = await requireUserId();
    const rows = await db.cloudWorkspaceProject.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { id: true, project: true, revision: true, updatedAt: true },
    });
    return NextResponse.json({ projects: rows });
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}
