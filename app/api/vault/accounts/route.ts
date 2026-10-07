// LUCIAN Vault API — Accounts.
// GET /api/vault/accounts
//
// Returns provider-verified accounts OWNED BY THE AUTHENTICATED USER.
// Manual accounts are stored in the client Zustand store (they are
// self-reported) and are NOT returned by this endpoint — the client
// merges them in.
//
// Phase 16 ownership:
//   - All provider-verified VaultAccount rows are scoped by ownerUserId.
//   - userId is derived from the authenticated session, never the body.
//   - One user cannot see another user's accounts.
//   - Pre-existing rows (created before Phase 16) have ownerUserId=NULL
//     and are intentionally excluded from per-user queries — they're
//     considered legacy / unclaimed and are not shown to anyone.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isAnyProviderConnected } from "@/lib/vault/providers";
import { isDatabaseAvailable } from "@/lib/vault/ledger-db";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  // Phase 16: derive userId from the authenticated session.
  let userId: string;
  try {
    userId = await requireVaultOwner();
  } catch {
    return unauthorizedVaultResponse();
  }

  const providerConnected = isAnyProviderConnected();
  const databaseAvailable = isDatabaseAvailable();

  if (!databaseAvailable) {
    return NextResponse.json({
      providerAccounts: [],
      manualAccounts: [],
      providerConnected,
      databaseAvailable: false,
      message: "Database unavailable. Only manual (self-reported) accounts are available.",
    });
  }

  // Phase 16: scope by ownerUserId — only this user's provider accounts.
  const providerAccounts = await db.vaultAccount.findMany({
    where: { source: "provider", ownerUserId: userId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    providerAccounts: providerAccounts.map((a) => ({
      id: a.id,
      label: a.label,
      type: a.type,
      source: "provider",
      provider: a.provider,
      maskedId: a.maskedId,
      currency: a.currency,
      depositEligible: a.depositEligible,
      withdrawalEligible: a.withdrawalEligible,
      note: a.note,
      createdAt: a.createdAt.getTime(),
      updatedAt: a.updatedAt.getTime(),
    })),
    manualAccounts: [],
    providerConnected,
    databaseAvailable: true,
    message: providerConnected
      ? undefined
      : "Provider not connected. Only manual (self-reported) accounts are available.",
  });
}
