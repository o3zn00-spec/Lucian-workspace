import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/session";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function validSnapshot(value: unknown): value is { state: Record<string, unknown>; history: unknown[] } {
  if (!value || typeof value !== "object") return false;
  const body = value as { state?: unknown; history?: unknown };
  if (!body.state || typeof body.state !== "object" || Array.isArray(body.state)) return false;
  if (!Array.isArray(body.history) || body.history.length > 2_000) return false;
  const state = body.state as { balance?: unknown; positions?: unknown; pendingOrders?: unknown };
  return typeof state.balance === "number" && Number.isFinite(state.balance) && state.balance >= 0
    && Array.isArray(state.positions) && Array.isArray(state.pendingOrders);
}

export async function GET() {
  try {
    const userId = await requireUserId();
    const account = await db.tradingSandboxAccount.findUnique({ where: { userId } });
    return NextResponse.json({ account });
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}

export async function PUT(req: Request) {
  try {
    const userId = await requireUserId();
    const body = await req.json();
    if (!validSnapshot(body)) return NextResponse.json({ error: "Invalid trading snapshot." }, { status: 400 });
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "Trading snapshot is too large." }, { status: 413 });
    }
    const account = await db.tradingSandboxAccount.upsert({
      where: { userId },
      create: { userId, state: body.state as Prisma.InputJsonValue, history: body.history as Prisma.InputJsonValue },
      update: { state: body.state as Prisma.InputJsonValue, history: body.history as Prisma.InputJsonValue, revision: { increment: 1 } },
    });
    return NextResponse.json({ account });
  } catch {
    return NextResponse.json({ error: "Unable to save trading account." }, { status: 400 });
  }
}
