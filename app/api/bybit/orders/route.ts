import { NextResponse } from "next/server";
import { requireOwnerId } from "@/lib/auth/owner";
import { cancelTerminalOrder, previewTerminalOrder } from "@/lib/bybit/terminal";
import { executeObservedOrder } from "@/lib/bybit/observed-execution";
import { listBybitOrders } from "@/lib/bybit/trading";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try { return NextResponse.json(await listBybitOrders(await requireOwnerId())); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load Bybit orders." }, { status: 400 }); }
}

export async function POST(request: Request) {
  try {
    const ownerUserId = await requireOwnerId();
    const body = await request.json() as Record<string, unknown>;
    if (body.confirmed === true) return NextResponse.json(await executeObservedOrder(ownerUserId, body));
    return NextResponse.json(await previewTerminalOrder(ownerUserId, body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Bybit order failed." }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  try { return NextResponse.json(await cancelTerminalOrder(await requireOwnerId(), await request.json() as Record<string, unknown>)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to cancel the Bybit order." }, { status: 400 }); }
}
