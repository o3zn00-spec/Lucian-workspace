import { NextResponse } from "next/server";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";
import { getReceiveAddress, listDepositHistory, listReceiveAddresses } from "@/lib/bybit/transfers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function owner(): Promise<string | Response> {
  try { return await requireVaultOwner(); } catch { return unauthorizedVaultResponse(); }
}

export async function GET() {
  const ownerUserId = await owner();
  if (ownerUserId instanceof Response) return ownerUserId;
  try {
    const [addresses, deposits] = await Promise.all([listReceiveAddresses(ownerUserId), listDepositHistory(ownerUserId)]);
    return NextResponse.json({ addresses, deposits });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load Bybit deposits." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const ownerUserId = await owner();
  if (ownerUserId instanceof Response) return ownerUserId;
  try {
    return NextResponse.json({ address: await getReceiveAddress(ownerUserId, await request.json() as Record<string, unknown>) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load a Bybit deposit address." }, { status: 400 });
  }
}
