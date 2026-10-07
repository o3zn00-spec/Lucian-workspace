// LUCIAN Vault API — Transactions (activity ledger).
// GET /api/vault/transactions
//
// Returns the unified financial ledger. Every entry supports:
//   internal transaction ID (lucianTxId)
//   provider transaction ID
//   provider event ID
//   idempotency key
//   type, status
//   currency / asset / network
//   amount, source, destination
//   provider, metadata
//
// The route prefers VaultTransaction rows (the user-facing records)
// and includes their linked LedgerEntry rows so the UI can render
// both the high-level intent and the underlying movements.
//
// If the database is unavailable, returns an empty list with a clear
// status — manual transactions remain available via the client store.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isDatabaseAvailable } from "@/lib/vault/ledger-db";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  // Phase 16: ownership scoping.
  let userId: string;
  try {
    userId = await requireVaultOwner();
  } catch {
    return unauthorizedVaultResponse();
  }

  if (!isDatabaseAvailable()) {
    return NextResponse.json({
      transactions: [],
      count: 0,
      databaseAvailable: false,
      message: "Database unavailable. Showing no provider-backed transactions. Manual transactions remain available in the client store.",
    });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const provider = url.searchParams.get("provider") ?? undefined;
  const limitStr = url.searchParams.get("limit") ?? "100";
  const limit = Math.min(1000, Math.max(1, parseInt(limitStr, 10)));

  // Phase 16: scope by userId (the VaultTransaction column is `userId`,
  // not `ownerUserId` — it's the legacy Phase 16 prep column on this table).
  const where: import("@prisma/client").Prisma.VaultTransactionWhereInput = {
    userId,
  };
  if (type) where.type = type;
  if (status) where.status = status;
  if (provider) where.provider = provider;

  const rows = await db.vaultTransaction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { ledgerEntries: { orderBy: { timestamp: "desc" } } },
  });

  return NextResponse.json({
    transactions: rows.map((t) => ({
      id: t.lucianTxId,
      internalId: t.id,
      type: t.type,
      status: t.status,
      amount: { amount: t.amount.toString(), currency: t.currency },
      asset: t.asset,
      network: t.network,
      provider: t.provider,
      providerTransactionId: t.providerTransactionId,
      providerEventId: t.providerEventId,
      idempotencyKey: t.idempotencyKey,
      source: t.source,
      destination: t.destination,
      createdAt: t.createdAt.getTime(),
      updatedAt: t.updatedAt.getTime(),
      metadata: t.metadata,
      ledgerEntries: t.ledgerEntries.map((e) => ({
        id: e.id,
        type: e.type,
        status: e.status,
        debitAccount: e.debitAccount,
        creditAccount: e.creditAccount,
        amount: { amount: e.amount.toString(), currency: e.currency },
        timestamp: e.timestamp.getTime(),
      })),
    })),
    count: rows.length,
    databaseAvailable: true,
  });
}
