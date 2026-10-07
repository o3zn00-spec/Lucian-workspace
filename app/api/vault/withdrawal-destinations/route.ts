// LUCIAN Vault API — Withdrawal destinations.
// GET  /api/vault/withdrawal-destinations   — list destinations
// POST /api/vault/withdrawal-destinations   — add a destination
//
// New destinations have a security delay before they can be used.
// The delay length is read from VaultSecuritySettings.
//
// DB-backed: destinations are persisted in the WithdrawalDestination
// table. When the database is unavailable, GET returns an empty list
// and POST returns 503.

import { NextResponse } from "next/server";
import { validateDestinationType, validateCryptoAddress, apiError } from "@/lib/vault/validation";
import { db } from "@/lib/db";
import { isDatabaseAvailable } from "@/lib/vault/ledger-db";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function maskAddress(addr: string | null | undefined): string | undefined {
  if (!addr) return undefined;
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

export async function GET() {
  // Phase 16: ownership scoping.
  let userId: string;
  try {
    userId = await requireVaultOwner();
  } catch {
    return unauthorizedVaultResponse();
  }

  if (!isDatabaseAvailable()) {
    return NextResponse.json({
      destinations: [],
      databaseAvailable: false,
      message: "Database unavailable — withdrawal destinations cannot be persisted.",
    });
  }

  const destinations = await db.withdrawalDestination.findMany({
    where: { ownerUserId: userId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    destinations: destinations.map((d) => ({
      id: d.id,
      type: d.type,
      referenceId: d.referenceId ?? undefined,
      label: d.label,
      asset: d.asset,
      network: d.network ?? undefined,
      address: maskAddress(d.address),
      approved: d.approved,
      approvedAt: d.approvedAt ? d.approvedAt.getTime() : undefined,
      addedAt: d.createdAt.getTime(),
    })),
    databaseAvailable: true,
  });
}

export async function POST(req: Request) {
  // Phase 16: ownership scoping + stamp ownerUserId on creation.
  let userId: string;
  try {
    userId = await requireVaultOwner();
  } catch {
    return unauthorizedVaultResponse();
  }

  if (!isDatabaseAvailable()) {
    return apiError(
      "Database unavailable. Withdrawal destinations require a Postgres DATABASE_URL.",
      503, "database_required",
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const typeResult = validateDestinationType(body.type);
  if (!typeResult.ok) return apiError(typeResult.error, 400);
  const type = typeResult.value;

  const label = typeof body.label === "string" ? body.label : "";
  if (!label) return apiError("Label is required.", 400);

  let asset = "USD";
  let network: string | undefined;
  let address: string | undefined;
  let referenceId: string | undefined;

  if (type === "crypto") {
    asset = typeof body.asset === "string" ? body.asset : "";
    network = typeof body.network === "string" ? body.network : "";
    if (!asset || !network) return apiError("Asset and network required for crypto destination.", 400);
    const addrResult = validateCryptoAddress(body.address);
    if (!addrResult.ok) return apiError(addrResult.error, 400);
    address = addrResult.value;
  } else {
    referenceId = typeof body.referenceId === "string" ? body.referenceId : "";
    if (!referenceId) return apiError("Reference ID required for bank/card destination.", 400);
  }

  // Read the security delay from VaultSecuritySettings (default 24h).
  // Phase 16: scope the settings lookup by ownerUserId (when the user
  // has no row, fall back to the shared default).
  const settings = await db.vaultSecuritySettings.findFirst({
    where: { OR: [{ ownerUserId: userId }, { id: "default", ownerUserId: null }] },
  });
  const delayHours = settings?.newDestinationDelayHours ?? 24;
  const approvedAt = new Date(Date.now() + delayHours * 60 * 60 * 1000);

  const destination = await db.withdrawalDestination.create({
    data: {
      type,
      referenceId,
      label,
      asset,
      network,
      address,
      approved: false,
      approvedAt,
      // Phase 16: stamp the authenticated user as the owner.
      ownerUserId: userId,
    },
  });

  return NextResponse.json({
    id: destination.id,
    approved: false,
    approvedAt: approvedAt.getTime(),
    message: `Destination added. Withdrawals will be blocked until ${approvedAt.toLocaleString()} (security delay of ${delayHours}h).`,
  });
}
