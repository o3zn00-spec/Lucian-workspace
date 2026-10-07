import { NextResponse } from "next/server";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";
import { bybitTransferSettings, listWalletAccounts } from "@/lib/bybit/transfers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  let ownerUserId: string;
  try { ownerUserId = await requireVaultOwner(); } catch { return unauthorizedVaultResponse(); }
  try {
    const settings = await bybitTransferSettings(ownerUserId);
    if (!settings.configured) return NextResponse.json({ error: "Bybit is not configured." }, { status: 503 });
    return NextResponse.json({ accounts: await listWalletAccounts(ownerUserId), settings });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load Bybit wallets." }, { status: 400 });
  }
}
