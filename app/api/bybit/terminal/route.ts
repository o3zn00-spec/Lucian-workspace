import { NextResponse } from "next/server";
import { requireOwnerId } from "@/lib/auth/owner";
import { terminalSnapshot } from "@/lib/bybit/terminal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const userId = await requireOwnerId();
    const url = new URL(request.url);
    return NextResponse.json(await terminalSnapshot(userId, {
      mode: url.searchParams.get("mode"),
      symbol: url.searchParams.get("symbol") ?? "BTCUSDT",
      category: url.searchParams.get("category") ?? "spot",
    }));
  } catch (error) {
    return NextResponse.json({ connected: false, error: error instanceof Error ? error.message : "Unable to synchronize the Bybit terminal." }, { status: 400 });
  }
}
