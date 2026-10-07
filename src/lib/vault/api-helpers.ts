// LUCIAN Vault API — Shared helpers for Vault route handlers.
//
// Every Vault route that performs a provider-backed financial operation
// MUST:
//   1. Require the database (call requireLedgerOr503).
//   2. Validate idempotency via the DB-backed ledger service.
//   3. Reject client-submitted authoritative balances.
//
// This module centralizes those helpers so the routes stay short and
// consistent.

import { NextResponse } from "next/server";
import {
  VaultLedgerService,
  DatabaseUnavailableError,
  IdempotencyConflictError,
  DuplicateProviderEventError,
  InvalidTransitionError,
  tryGetLedgerService,
} from "@/lib/vault/ledger-db";

/**
 * Returns the ledger service, or responds 503 if the database is not
 * configured. Use this at the top of every provider-backed route.
 */
export function requireLedgerOr503():
  | { ok: true; ledger: VaultLedgerService }
  | { ok: false; response: NextResponse } {
  const ledger = tryGetLedgerService();
  if (!ledger) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Database unavailable. Provider-backed Vault operations require a Postgres DATABASE_URL (Neon / Supabase / etc.). " +
            "Manual (self-reported) accounts continue to work via the client store.",
          code: "database_required",
        },
        { status: 503 },
      ),
    };
  }
  return { ok: true, ledger };
}

/**
 * Map a ledger/provider error to an HTTP response. Centralizes the
 * error→status mapping so routes don't reinvent it.
 */
export function handleError(err: unknown): NextResponse {
  if (err instanceof DatabaseUnavailableError) {
    return NextResponse.json(
      { error: err.message, code: "database_required" },
      { status: 503 },
    );
  }
  if (err instanceof IdempotencyConflictError) {
    return NextResponse.json(
      { error: err.message, code: "idempotency_conflict" },
      { status: 409 },
    );
  }
  if (err instanceof DuplicateProviderEventError) {
    // Idempotent — return the original result, not an error.
    return NextResponse.json(
      {
        ok: true,
        message: "Provider event already processed.",
        ledgerEntryIds: err.existing.ledgerEntryIds,
        transactionId: err.existing.transactionId,
        duplicate: true,
      },
      { status: 200 },
    );
  }
  if (err instanceof InvalidTransitionError) {
    return NextResponse.json(
      { error: err.message, code: "invalid_transition" },
      { status: 409 },
    );
  }
  const message = err instanceof Error ? err.message : "Internal server error.";
  return NextResponse.json(
    { error: message, code: "internal_error" },
    { status: 500 },
  );
}
