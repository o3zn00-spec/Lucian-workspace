import { NextResponse } from "next/server";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";
import { listBybitOrders } from "@/lib/bybit/trading";
import { previewTerminalOrder } from "@/lib/bybit/terminal";
import { executeObservedOrder } from "@/lib/bybit/observed-execution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  let userId: string;
  try { userId = await requireVaultOwner(); } catch { return unauthorizedVaultResponse(); }
  try {
    if ((process.env.TRADING_MODE ?? "sandbox") !== "live") {
      return NextResponse.json({ mode: "sandbox", orders: [], message: "Live exchange orders are disabled." });
    }
    void userId;
    return NextResponse.json(await listBybitOrders(userId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load orders." }, { status: 400 });
  }
}

export async function POST(req: Request) {
  let userId: string;
  try { userId = await requireVaultOwner(); } catch { return unauthorizedVaultResponse(); }
  try {
    const body = await req.json() as Record<string, unknown>;
    if (body.confirmed === true && typeof body.intentId === "string") {
      return NextResponse.json(await executeObservedOrder(userId, body));
    }
    return NextResponse.json(await previewTerminalOrder(userId, body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Order failed." }, { status: 400 });
  }
}
