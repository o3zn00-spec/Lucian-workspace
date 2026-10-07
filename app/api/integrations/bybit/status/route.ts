import { NextResponse } from "next/server";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";
import { getBybitConnectionStatus } from "@/lib/bybit/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const ownerUserId = await requireVaultOwner();
    return NextResponse.json(await getBybitConnectionStatus(ownerUserId));
  } catch {
    return unauthorizedVaultResponse();
  }
}
