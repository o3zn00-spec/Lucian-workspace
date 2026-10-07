// LUCIAN Vault / Settings — System status probe.
// GET /api/health/system-status
//
// Reports the REAL status of LUCIAN subsystems that can be checked
// from the server. No secrets are exposed; only boolean / state fields.
//
// CRITICAL HONESTY RULE:
//   - A subsystem is labeled "module available" when the code module
//     exists and is mounted. This does NOT mean an external service
//     was contacted.
//   - A subsystem is labeled "configured" when an API key / DATABASE_URL
//     is present in the server environment. This does NOT mean the key
//     is valid or the database is reachable.
//   - A subsystem is labeled "connected" / "reachable" ONLY when an
//     actual probe (network request) succeeded.
//
// Returned fields:
//   - marketsProvider:  "module_available" — the markets module is
//                       client-only; no server probe is performed here.
//   - aiProviders:      per-provider { configured: boolean } — env var
//                       presence only; NOT a reachability check.
//   - indexedDb:        "client_capability" — checked client-side.
//   - webContainer:     "client_capability" — checked client-side.
//   - githubImport:     "module_available" — the route exists; no
//                       network probe is performed unless the user
//                       actually imports a repo.
//   - browser:          "module_available" — the browser module exists.
//   - vaultDatabase:    { configured: boolean } — DATABASE_URL presence
//                       only; NOT a connection test.
//   - vaultProviders:   per-provider { state, configured, detail } —
//                       honest state from the provider index.
//   - buildInfo:        { version, nodeEnv, timestamp }
//
// This endpoint is the SINGLE source of truth for server-side status.
// The Settings "About & Diagnostics" section reads from here.

import { NextResponse } from "next/server";
import { isDatabaseAvailable } from "@/lib/vault/ledger-db";
import { getAllProviderConnections } from "@/lib/vault/providers";
import { requireOwnerId } from "@/lib/auth/owner";
import {
  isGoogleConfigured,
  isAuthSecretConfigured,
  isAuthDatabaseConfigured,
} from "@/lib/auth/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  let ownerUserId: string;
  try { ownerUserId = await requireOwnerId(); }
  catch {
    return NextResponse.json({ ok: false, error: "Owner authorization required." }, { status: 403 });
  }
  const vaultConnections = getAllProviderConnections();

  const databaseConfigured = isDatabaseAvailable();

  // Phase 16: honest auth infrastructure status — used by Settings →
  // About to render the auth/database/Google/email status pills.
  const auth = {
    database: isAuthDatabaseConfigured(),   // DATABASE_URL present
    secret: isAuthSecretConfigured(),       // AUTH_SECRET present
    google: isGoogleConfigured(),           // GOOGLE_CLIENT_ID + SECRET present
    email: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS),
  };

  const buildInfo = {
    version: process.env.npm_package_version ?? "0.0.0",
    nodeEnv: process.env.NODE_ENV ?? "development",
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json({
    marketsProvider: "module_available",
    indexedDb: "client_capability",
    webContainer: "client_capability",
    githubImport: "module_available",
    browser: "module_available",
    vaultDatabase: { configured: databaseConfigured },
    vaultProviders: vaultConnections.map((c) => ({
      name: c.name,
      type: c.type,
      state: c.state,
      configured: c.configured,
      detail: c.stateDetail ?? null,
    })),
    auth,
    buildInfo,
  });
}
