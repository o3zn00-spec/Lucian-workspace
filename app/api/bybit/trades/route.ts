import { NextResponse } from "next/server";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";
import { listBybitTrades } from "@/lib/bybit/trading";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  let ownerUserId: string;
  try { ownerUserId = await requireVaultOwner(); } catch { return unauthorizedVaultResponse(); }
  try { return NextResponse.json({ trades: await listBybitTrades(ownerUserId) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load Bybit trade history." }, { status: 400 }); }
}
