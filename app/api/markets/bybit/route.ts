import { NextResponse } from "next/server";
import { requireOwnerId } from "@/lib/auth/owner";
import { bybitPublicRequest } from "@/lib/bybit/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Fixed public-data endpoints only: never forward a caller-supplied URL or key.
export async function GET(request: Request) {
  try { await requireOwnerId(); } catch {
    return NextResponse.json({ error: "Sign in to read market data." }, { status: 401 });
  }
  const query = new URL(request.url).searchParams;
  const kind = query.get("kind");
  const symbol = query.get("symbol") ?? "";
  const interval = query.get("interval") ?? "1";
  const limit = Number(query.get("limit") ?? "200");
  if (!/^[A-Z0-9]{2,20}USDT$/.test(symbol) || !["kline", "tickers"].includes(kind ?? "") ||
      !["1", "5", "15", "30", "60", "240", "D", "W"].includes(interval) ||
      !Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return NextResponse.json({ error: "Invalid market data request." }, { status: 400 });
  }
  try {
    const result = await bybitPublicRequest("mainnet", kind === "kline" ? "/v5/market/kline" : "/v5/market/tickers",
      { category: "spot", symbol, ...(kind === "kline" ? { interval, limit } : {}) });
    return NextResponse.json({ retCode: 0, result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Bybit market data is temporarily unavailable." }, { status: 502 });
  }
}
