// LUCIAN Vault API — Provider connection status.
// GET /api/vault/providers
//
// Returns the HONEST connection state of all configured providers.
// This is the source of truth for whether real-money flows are
// available.
//
// Connection states (see src/lib/vault/providers/types.ts):
//   not_configured  → env vars missing
//   configured       → env vars present AND SDK installed
//   setup_required   → env vars present, but adapter is a stub OR
//                      user has not yet completed the link flow
//   connecting       → user is mid-flow (link modal open)
//   connected        → genuine provider-side link exists
//   restricted       → provider returned a restricted state
//   error            → provider-side error
//
// `liveMode` is true ONLY when at least one provider is `connected`.
// API keys alone do NOT enable a stub provider.

import { NextResponse } from "next/server";
import { getAllProviderConnections } from "@/lib/vault/providers";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";
import { getBybitConnectionStatus } from "@/lib/bybit/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  // Phase 16: require authentication. The provider connection state
  // itself is global (provider credentials are server-side env vars),
  // but only authenticated users should see Vault status.
  let ownerUserId: string;
  try {
    ownerUserId = await requireVaultOwner();
  } catch {
    return unauthorizedVaultResponse();
  }

  const bybit = await getBybitConnectionStatus(ownerUserId);
  const connections = getAllProviderConnections().map((connection) => connection.type === "crypto" ? bybit : connection);
  const anyConnected = connections.some((connection) => connection.state === "connected");
  const anyConfigured = connections.some((connection) => connection.configured);

  return NextResponse.json({
    providers: connections.map((c) => ({
      id: c.id,
      type: c.type,
      name: c.name,
      configured: c.configured,
      state: c.state,
      authenticated: c.authenticated,
      displayName: c.displayName,
      stateDetail: c.stateDetail,
      connectedAt: c.connectedAt,
      environment: "environment" in c ? c.environment : undefined,
    })),
    anyConnected,
    anyConfigured,
    liveMode: anyConnected,
    realMoneyReady: true,
    databaseRequiredForLive: true,
  });
}
