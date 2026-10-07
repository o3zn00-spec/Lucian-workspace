import { NextResponse } from "next/server";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";
import { getBybitConfig } from "@/lib/bybit/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const config = await getBybitConfig(await requireVaultOwner());
    return NextResponse.json({
      environment: config.environment,
      publicSpotWebSocket: `${config.publicWebSocketBase}/spot`,
      tickerTopicFormat: "tickers.{symbol}",
      privateUpdates: "server-poll",
      privateRefreshMs: 4000,
      note: "Public prices stream directly from Bybit. Authenticated orders, positions, and executions refresh through owner-only server routes so the API secret never reaches the browser.",
    });
  } catch {
    return unauthorizedVaultResponse();
  }
}
