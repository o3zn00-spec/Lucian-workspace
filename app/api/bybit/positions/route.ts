import { NextResponse } from "next/server";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";
import { listBybitPositions } from "@/lib/bybit/trading";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  let ownerUserId: string;
  try { ownerUserId = await requireVaultOwner(); } catch { return unauthorizedVaultResponse(); }
  try { return NextResponse.json({ positions: await listBybitPositions(ownerUserId) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load Bybit positions." }, { status: 400 }); }
}
