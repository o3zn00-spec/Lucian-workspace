import { NextResponse } from "next/server";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";
import { executeBybitWithdrawal, listWithdrawalHistory, previewBybitWithdrawal } from "@/lib/bybit/transfers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  let ownerUserId: string;
  try { ownerUserId = await requireVaultOwner(); } catch { return unauthorizedVaultResponse(); }
  try { return NextResponse.json(await listWithdrawalHistory(ownerUserId)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load Bybit withdrawals." }, { status: 400 }); }
}

export async function POST(request: Request) {
  let ownerUserId: string;
  try { ownerUserId = await requireVaultOwner(); } catch { return unauthorizedVaultResponse(); }
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.confirmed === true) return NextResponse.json(await executeBybitWithdrawal(ownerUserId, body), { status: 201 });
    return NextResponse.json(await previewBybitWithdrawal(ownerUserId, body), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to process the Bybit withdrawal." }, { status: 400 });
  }
}
