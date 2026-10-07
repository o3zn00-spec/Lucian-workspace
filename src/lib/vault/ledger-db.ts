// LUCIAN Vault — Durable, database-backed ledger service.
//
// This is the AUTHORITATIVE financial ledger. It writes to Postgres via
// Prisma. It NEVER stores authoritative money in process-memory.
//
// DESIGN INVARIANTS (enforced here, not just promised):
//
// 1. Every ledger entry has DISTINCT debit and credit accounts
//    (assertDistinctAccounts at the type layer + a database CHECK-style
//    guard in the write path).
//
// 2. Every ledger entry has a UNIQUE idempotencyKey. Duplicate writes
//    return the original instead of creating a second entry.
//
// 3. Provider event IDs are deduplicated via the ProcessedProviderEvent
//    table — a second webhook for the same event is a no-op.
//
// 4. Balances are DERIVED by summing ledger entries. They are NEVER
//    stored as mutable state. (VaultAccount.balance is a display cache
//    only; the balances API ignores it.)
//
// 5. All money is integer minor units (BigInt). NO floating point.
//
// 6. Provider-backed operations require a Postgres DATABASE_URL. If
//    the database is unavailable, this service throws
//    `DatabaseUnavailableError` and the API layer returns 503.
//
// 7. Status transitions are validated against transitions.ts. The
//    webhook pipeline cannot, e.g., transition `failed → completed`.

import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { Money, fromMinor, add, subtract, gte, toDecimal } from "./money";
import {
  LedgerAccountType,
  assertDistinctAccounts,
} from "./accounts";
import {
  TransactionStatus,
  isAllowedTransition,
  normalizeProviderStatus,
  InvalidTransitionError,
} from "./transitions";

export type LedgerEntryType =
  | "deposit"
  | "withdrawal"
  | "internal-transfer"
  | "trade"
  | "fee"
  | "adjustment"
  | "reservation"
  | "release"
  | "settlement";

/** Public-facing ledger entry shape (returned to API routes). */
export interface LedgerEntry {
  id: string;
  idempotencyKey: string;
  providerEventId?: string;
  providerTransactionId?: string;
  type: LedgerEntryType;
  status: TransactionStatus;
  debitAccount: LedgerAccountType;
  creditAccount: LedgerAccountType;
  amount: Money;
  timestamp: number;
  source: string;
  destination: string;
  provider?: string;
  asset?: string;
  network?: string;
  metadata?: Record<string, unknown>;
  transactionId?: string;
}

export interface IdempotencyRecord {
  key: string;
  requestHash: string;
  response: unknown;
  status: number;
  createdAt: number;
  expiresAt: number;
}

export interface ProcessedProviderEvent {
  provider: string;
  eventId: string;
  eventType?: string;
  ledgerEntryIds: string[];
  transactionId?: string;
  processedAt: number;
}

/* ── Errors ── */

export class DatabaseUnavailableError extends Error {
  constructor(message = "Database unavailable — provider-backed Vault operations require DATABASE_URL pointing to a Postgres database.") {
    super(message);
    this.name = "DatabaseUnavailableError";
  }
}

export class IdempotencyConflictError extends Error {
  constructor(key: string) {
    super(`Idempotency key ${key} was used with a different request body. Rejecting — key reuse with different payload is forbidden.`);
    this.name = "IdempotencyConflictError";
  }
}

export class DuplicateProviderEventError extends Error {
  constructor(
    message: string,
    public readonly existing: ProcessedProviderEvent,
  ) {
    super(message);
    this.name = "DuplicateProviderEventError";
  }
}

export class TransactionNotFoundError extends Error {
  constructor(id: string) {
    super(`Vault transaction ${id} not found.`);
    this.name = "TransactionNotFoundError";
  }
}

/* ── Internal helpers ── */

function rowToEntry(row: {
  id: string;
  idempotencyKey: string;
  providerEventId: string | null;
  providerTxId: string | null;
  type: string;
  status: string;
  debitAccount: string;
  creditAccount: string;
  amount: bigint;
  currency: string;
  source: string;
  destination: string;
  provider: string | null;
  asset: string | null;
  network: string | null;
  metadata: unknown;
  transactionId: string | null;
  timestamp: Date;
}): LedgerEntry {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    providerEventId: row.providerEventId ?? undefined,
    providerTransactionId: row.providerTxId ?? undefined,
    type: row.type as LedgerEntryType,
    status: row.status as TransactionStatus,
    debitAccount: row.debitAccount as LedgerAccountType,
    creditAccount: row.creditAccount as LedgerAccountType,
    amount: fromMinor(row.amount, row.currency),
    timestamp: row.timestamp.getTime(),
    source: row.source,
    destination: row.destination,
    provider: row.provider ?? undefined,
    asset: row.asset ?? undefined,
    network: row.network ?? undefined,
    metadata: (row.metadata as Record<string, unknown> | null) ?? undefined,
    transactionId: row.transactionId ?? undefined,
  };
}

async function sha256Hex(input: string): Promise<string> {
  // Use the Web Crypto API (available in Node 18+ and on Vercel).
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ── Public ledger service ── */

export class VaultLedgerService {
  /**
   * Append a ledger entry. Enforces:
   *   - debit !== credit
   *   - unique idempotencyKey (returns existing on duplicate)
   *   - providerEventId deduplication (if provided)
   *   - amount > 0
   *   - linked transaction (if transactionId provided) must exist and
   *     be in a state that allows the implied status
   *
   * Runs inside a Prisma transaction so the entry + (optional) processed
   * event + (optional) transaction update commit atomically.
   */
  async appendEntry(input: {
    idempotencyKey: string;
    providerEventId?: string;
    providerTransactionId?: string;
    type: LedgerEntryType;
    status: TransactionStatus;
    debitAccount: LedgerAccountType;
    creditAccount: LedgerAccountType;
    amount: Money;
    source: string;
    destination: string;
    provider?: string;
    asset?: string;
    network?: string;
    metadata?: Record<string, unknown>;
    transactionId?: string;
    ownerUserId?: string;
  }): Promise<LedgerEntry> {
    // Type-layer guard against the same-account bug.
    assertDistinctAccounts(input.debitAccount, input.creditAccount);

    if (input.amount.amount <= 0n) {
      throw new Error("Ledger entry amount must be positive (minor units).");
    }
    if (!input.idempotencyKey) {
      throw new Error("idempotencyKey is required for every ledger entry.");
    }

    return await db.$transaction(async (tx) => {
      // 1. Idempotency: if a ledger entry with this (ownerUserId, key)
      //    already exists, return it as-is. When ownerUserId is null
      //    (webhook / system path), we look up by idempotencyKey only
      //    (NULL != NULL under SQL semantics, so the unique constraint
      //    doesn't actually dedupe NULL-owner rows — that's fine because
      //    webhooks have their own canonical dedupe via ProcessedProviderEvent
      //    keyed by (provider, eventId)).
      let existing;
      if (input.ownerUserId) {
        existing = await tx.ledgerEntry.findUnique({
          where: {
            ownerUserId_idempotencyKey: {
              ownerUserId: input.ownerUserId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
      } else {
        existing = await tx.ledgerEntry.findFirst({
          where: { idempotencyKey: input.idempotencyKey, ownerUserId: null },
        });
      }
      if (existing) {
        return rowToEntry(existing);
      }

      // 2. Provider event deduplication (optional).
      if (input.provider && input.providerEventId) {
        const existingEvent = await tx.processedProviderEvent.findUnique({
          where: {
            provider_eventId: {
              provider: input.provider,
              eventId: input.providerEventId,
            },
          },
        });
        if (existingEvent) {
          throw new DuplicateProviderEventError(
            `Provider event ${input.provider}:${input.providerEventId} already processed`,
            {
              provider: existingEvent.provider,
              eventId: existingEvent.eventId,
              eventType: existingEvent.eventType ?? undefined,
              ledgerEntryIds: existingEvent.ledgerEntryIds,
              transactionId: existingEvent.transactionId ?? undefined,
              processedAt: existingEvent.processedAt.getTime(),
            },
          );
        }
      }

      // 3. If a transaction link is provided, validate that the implied
      //    status transition is allowed.
      if (input.transactionId) {
        const txRow = await tx.vaultTransaction.findUnique({
          where: { id: input.transactionId },
        });
        if (!txRow) {
          throw new TransactionNotFoundError(input.transactionId);
        }
        // The transaction's status moves to this entry's status.
        const from = txRow.status as TransactionStatus;
        const to = input.status;
        if (!isAllowedTransition(from, to)) {
          throw new InvalidTransitionError(from, to);
        }
      }

      // 4. Write the ledger entry.
      const created = await tx.ledgerEntry.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          providerEventId: input.providerEventId,
          providerTxId: input.providerTransactionId,
          type: input.type,
          status: input.status,
          debitAccount: input.debitAccount,
          creditAccount: input.creditAccount,
          amount: input.amount.amount,
          currency: input.amount.currency,
          source: input.source,
          destination: input.destination,
          provider: input.provider,
          asset: input.asset,
          network: input.network,
          metadata:
            input.metadata === undefined
              ? Prisma.DbNull
              : (input.metadata as Prisma.InputJsonValue),
          transactionId: input.transactionId,
          ownerUserId: input.ownerUserId,
        },
      });

      // 5. Mark provider event as processed (if provided).
      if (input.provider && input.providerEventId) {
        await tx.processedProviderEvent.create({
          data: {
            provider: input.provider,
            eventId: input.providerEventId,
            eventType: null,
            ledgerEntryIds: [created.id],
            transactionId: input.transactionId,
            rawPayloadHash: "", // populated by the webhook layer with the actual payload hash
            ownerUserId: input.ownerUserId,
          },
        });
      }

      // 6. Update the linked transaction status (if provided).
      if (input.transactionId) {
        await tx.vaultTransaction.update({
          where: { id: input.transactionId },
          data: {
            status: input.status,
            providerTransactionId: input.providerTransactionId ?? undefined,
            providerEventId: input.providerEventId ?? undefined,
          },
        });
      }

      return rowToEntry(created);
    });
  }

  /**
   * Derive the current balance for an account type from ledger entries.
   * This is the ONLY way authoritative balances are computed.
   *
   * `completed` entries affect the balance directly.
   * `pending` / `processing` / `requires-action` / `requested` entries
   * affect pendingInflow or pendingOutflow (not the settled balance).
   * `failed` / `cancelled` entries are ignored (no movement).
   *
   * PHASE 16 OWNERSHIP: when `ownerUserId` is provided, only ledger
   * entries tagged with that owner are summed. This is the canonical
   * way to scope balances per-user — without it, balances are SHARED
   * across all users (a critical Phase 16 ownership bug).
   */
  async deriveBalance(
    account: LedgerAccountType,
    currency: string,
    ownerUserId?: string,
  ): Promise<{
    account: LedgerAccountType;
    balance: Money;
    pendingInflow: Money;
    pendingOutflow: Money;
  }> {
    // Owner-scoped where clause. When ownerUserId is provided, entries
    // with a NULL ownerUserId are EXCLUDED (they're legacy/unclaimed).
    // When ownerUserId is undefined (only used by the webhook pipeline
    // for global idempotency checks), all entries are summed.
    const ownerWhere = ownerUserId
      ? { ownerUserId }
      : {};

    // Sum settled (completed) entries affecting this account.
    const completedCredit = await db.ledgerEntry.aggregate({
      where: {
        creditAccount: account,
        currency,
        status: "completed",
        ...ownerWhere,
      },
      _sum: { amount: true },
    });
    const completedDebit = await db.ledgerEntry.aggregate({
      where: {
        debitAccount: account,
        currency,
        status: "completed",
        ...ownerWhere,
      },
      _sum: { amount: true },
    });

    // Sum pending entries (any non-terminal status).
    const pendingCredit = await db.ledgerEntry.aggregate({
      where: {
        creditAccount: account,
        currency,
        status: { in: ["requested", "pending", "processing", "requires-action"] },
        ...ownerWhere,
      },
      _sum: { amount: true },
    });
    const pendingDebit = await db.ledgerEntry.aggregate({
      where: {
        debitAccount: account,
        currency,
        status: { in: ["requested", "pending", "processing", "requires-action"] },
        ...ownerWhere,
      },
      _sum: { amount: true },
    });

    const balance = subtract(
      fromMinor(completedCredit._sum.amount ?? 0n, currency),
      fromMinor(completedDebit._sum.amount ?? 0n, currency),
    );
    const pendingInflow = fromMinor(pendingCredit._sum.amount ?? 0n, currency);
    const pendingOutflow = fromMinor(pendingDebit._sum.amount ?? 0n, currency);

    return { account, balance, pendingInflow, pendingOutflow };
  }

  /**
   * Get all entries (for activity timeline). Sorted newest-first.
   * PHASE 16: pass `ownerUserId` to scope by user; otherwise all
   * entries across all users are returned (only used by the webhook
   * pipeline which resolves ownership separately).
   */
  async getEntries(filter?: {
    type?: LedgerEntryType;
    status?: TransactionStatus;
    provider?: string;
    since?: number;
    limit?: number;
    ownerUserId?: string;
  }): Promise<LedgerEntry[]> {
    const where: import("@prisma/client").Prisma.LedgerEntryWhereInput = {};
    if (filter?.type) where.type = filter.type;
    if (filter?.status) where.status = filter.status;
    if (filter?.provider) where.provider = filter.provider;
    if (filter?.since) where.timestamp = { gte: new Date(filter.since) };
    if (filter?.ownerUserId) where.ownerUserId = filter.ownerUserId;

    const rows = await db.ledgerEntry.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: filter?.limit ?? 100,
    });
    return rows.map(rowToEntry);
  }

  /**
   * Validate that an account has sufficient settled balance for a debit.
   * Withdrawable = cash-available − cash-reserved.
   * PHASE 16: pass `ownerUserId` to scope by user.
   */
  async validateSufficientFunds(
    account: LedgerAccountType,
    amount: Money,
    ownerUserId?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (amount.amount <= 0n) {
      return { ok: false, error: "Amount must be positive." };
    }
    const { balance } = await this.deriveBalance(account, amount.currency, ownerUserId);
    if (!gte(balance, amount)) {
      return {
        ok: false,
        error: `Insufficient ${account}. Available: ${toDecimal(balance)} ${balance.currency}, requested: ${toDecimal(amount)} ${amount.currency}.`,
      };
    }
    return { ok: true };
  }

  /* ── Idempotency (DB-backed) ── */

  /**
   * Check if an idempotency key has already been used by THIS user.
   * If used with the SAME request hash → return the cached record.
   * If used with a DIFFERENT request hash → throw IdempotencyConflictError.
   * If expired or absent → return null.
   *
   * Phase 16 FINAL: idempotency is user-scoped. Two different users
   * may safely submit the same client-side key — their records live
   * in independent rows (compound unique on (ownerUserId, key)).
   */
  async checkIdempotency(
    key: string,
    requestBody?: unknown,
    ownerUserId?: string,
  ): Promise<IdempotencyRecord | null> {
    // Look up by the compound unique constraint when ownerUserId is
    // provided (user-initiated operation). Otherwise fall back to a
    // findFirst by key alone (system / webhook path).
    let row;
    if (ownerUserId) {
      row = await db.idempotencyRecord.findUnique({
        where: { ownerUserId_key: { ownerUserId, key } },
      });
    } else {
      row = await db.idempotencyRecord.findFirst({
        where: { key, ownerUserId: null },
      });
    }
    if (!row) return null;

    // Expired? Treat as absent.
    if (row.expiresAt.getTime() < Date.now()) {
      // Best-effort delete — ignore errors if the row was already
      // deleted by a concurrent process.
      if (ownerUserId) {
        await db.idempotencyRecord
          .delete({ where: { ownerUserId_key: { ownerUserId, key } } })
          .catch(() => {});
      } else {
        await db.idempotencyRecord.delete({ where: { id: row.id } }).catch(() => {});
      }
      return null;
    }

    // If a request body is provided, verify it matches the original hash.
    if (requestBody !== undefined) {
      const currentHash = await sha256Hex(JSON.stringify(requestBody ?? null));
      if (currentHash !== row.requestHash) {
        throw new IdempotencyConflictError(key);
      }
    }

    return {
      key: row.key,
      requestHash: row.requestHash,
      response: row.response,
      status: row.status,
      createdAt: row.createdAt.getTime(),
      expiresAt: row.expiresAt.getTime(),
    };
  }

  /**
   * Persist an idempotency record. TTL is 24h by default.
   * If the (ownerUserId, key) already exists with the same requestHash,
   * this is a no-op (the original record is preserved).
   *
   * Phase 16 FINAL: records are user-scoped. The compound unique
   * constraint (ownerUserId, key) makes the same key under different
   * users independent.
   */
  async recordIdempotency(
    key: string,
    requestBody: unknown,
    response: unknown,
    status: number,
    ttlMs: number = 24 * 60 * 60 * 1000,
    ownerUserId?: string,
  ): Promise<void> {
    const requestHash = await sha256Hex(JSON.stringify(requestBody ?? null));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);

    if (ownerUserId) {
      // User-scoped path — use the compound unique constraint.
      await db.idempotencyRecord.upsert({
        where: { ownerUserId_key: { ownerUserId, key } },
        create: {
          ownerUserId,
          key,
          requestHash,
          response: response as import("@prisma/client").Prisma.InputJsonValue,
          status,
          createdAt: now,
          expiresAt,
        },
        update: {}, // no-op — preserve the original record
      });
    } else {
      // System / webhook path — no owner scope. We use findFirst + create
      // because the compound unique constraint treats NULL ownerUserId as
      // distinct (NULL != NULL), so upsert wouldn't dedupe correctly.
      const existing = await db.idempotencyRecord.findFirst({
        where: { key, ownerUserId: null },
        select: { id: true, requestHash: true },
      });
      if (existing) {
        // Same key + same request hash → no-op.
        if (existing.requestHash === requestHash) return;
        // Same key + different request hash → conflict.
        throw new IdempotencyConflictError(key);
      }
      await db.idempotencyRecord.create({
        data: {
          ownerUserId: null,
          key,
          requestHash,
          response: response as import("@prisma/client").Prisma.InputJsonValue,
          status,
          createdAt: now,
          expiresAt,
        },
      });
    }
  }

  /* ── Processed provider events (DB-backed) ── */

  async isProviderEventProcessed(
    provider: string,
    eventId: string,
  ): Promise<ProcessedProviderEvent | null> {
    const row = await db.processedProviderEvent.findUnique({
      where: {
        provider_eventId: { provider, eventId },
      },
    });
    if (!row) return null;
    return {
      provider: row.provider,
      eventId: row.eventId,
      eventType: row.eventType ?? undefined,
      ledgerEntryIds: row.ledgerEntryIds,
      transactionId: row.transactionId ?? undefined,
      processedAt: row.processedAt.getTime(),
    };
  }

  /* ── Vault transactions ── */

  /**
   * Create a new VaultTransaction. This is the user-facing record of a
   * financial intent. It links to one or more LedgerEntry rows via
   * `transactionId`.
   */
  async createTransaction(input: {
    lucianTxId: string;
    type: LedgerEntryType;
    status: TransactionStatus;
    currency: string;
    amount: Money;
    source: string;
    destination: string;
    provider?: string;
    providerTransactionId?: string;
    providerEventId?: string;
    idempotencyKey?: string;
    ownerUserId?: string;
    accountId?: string;
    asset?: string;
    network?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string; lucianTxId: string }> {
    const created = await db.vaultTransaction.create({
      data: {
        lucianTxId: input.lucianTxId,
        type: input.type,
        status: input.status,
        currency: input.currency,
        asset: input.asset,
        network: input.network,
        amount: input.amount.amount,
        source: input.source,
        destination: input.destination,
        provider: input.provider,
        providerTransactionId: input.providerTransactionId,
        providerEventId: input.providerEventId,
        idempotencyKey: input.idempotencyKey,
        userId: input.ownerUserId,
        accountId: input.accountId,
        metadata:
          input.metadata === undefined
            ? Prisma.DbNull
            : (input.metadata as Prisma.InputJsonValue),
      },
    });
    return { id: created.id, lucianTxId: created.lucianTxId };
  }

  /**
   * Find a VaultTransaction by its public lucianTxId.
   * Returns userId so webhook callers can resolve the original owner.
   */
  async getTransactionByLucianId(lucianTxId: string): Promise<{
    id: string;
    lucianTxId: string;
    type: string;
    status: TransactionStatus;
    currency: string;
    amount: bigint;
    provider: string | null;
    providerTransactionId: string | null;
    providerEventId: string | null;
    userId: string | null;
  } | null> {
    const row = await db.vaultTransaction.findUnique({
      where: { lucianTxId },
    });
    if (!row) return null;
    return {
      id: row.id,
      lucianTxId: row.lucianTxId,
      type: row.type,
      status: row.status as TransactionStatus,
      currency: row.currency,
      amount: row.amount,
      provider: row.provider,
      providerTransactionId: row.providerTransactionId,
      providerEventId: row.providerEventId,
      userId: row.userId,
    };
  }

  /**
   * Find a VaultTransaction by its provider transaction ID. Used by the
   * webhook pipeline to locate the original transaction for an event
   * and resolve its ownerUserId (so webhook-driven ledger entries are
   * owned by the correct user, NOT a global/default user).
   */
  async getTransactionByProviderTxId(
    provider: string,
    providerTransactionId: string,
  ): Promise<{
    id: string;
    lucianTxId: string;
    type: string;
    status: TransactionStatus;
    currency: string;
    amount: bigint;
    provider: string | null;
    providerTransactionId: string | null;
    providerEventId: string | null;
    userId: string | null;
  } | null> {
    const row = await db.vaultTransaction.findFirst({
      where: { provider, providerTransactionId },
    });
    if (!row) return null;
    return {
      id: row.id,
      lucianTxId: row.lucianTxId,
      type: row.type,
      status: row.status as TransactionStatus,
      currency: row.currency,
      amount: row.amount,
      provider: row.provider,
      providerTransactionId: row.providerTransactionId,
      providerEventId: row.providerEventId,
      userId: row.userId,
    };
  }

  /**
   * Update a VaultTransaction's status. Validates the transition.
   */
  async updateTransactionStatus(
    transactionId: string,
    newStatus: TransactionStatus,
    providerEventId?: string,
  ): Promise<void> {
    await db.$transaction(async (tx) => {
      const row = await tx.vaultTransaction.findUnique({ where: { id: transactionId } });
      if (!row) throw new TransactionNotFoundError(transactionId);
      const from = row.status as TransactionStatus;
      if (!isAllowedTransition(from, newStatus)) {
        throw new InvalidTransitionError(from, newStatus);
      }
      await tx.vaultTransaction.update({
        where: { id: transactionId },
        data: {
          status: newStatus,
          providerEventId: providerEventId ?? row.providerEventId,
        },
      });
    });
  }

  /**
   * Record a ProcessedProviderEvent row directly (used by the webhook
   * pipeline when an event does NOT change the ledger — e.g. an event
   * type we acknowledge but don't act on).
   */
  async recordProcessedProviderEvent(input: {
    provider: string;
    eventId: string;
    eventType?: string;
    ledgerEntryIds?: string[];
    transactionId?: string;
    rawPayloadHash?: string;
    ownerUserId?: string;
  }): Promise<void> {
    try {
      await db.processedProviderEvent.create({
        data: {
          provider: input.provider,
          eventId: input.eventId,
          eventType: input.eventType,
          ledgerEntryIds: input.ledgerEntryIds ?? [],
          transactionId: input.transactionId,
          rawPayloadHash: input.rawPayloadHash ?? "",
          ownerUserId: input.ownerUserId,
        },
      });
    } catch (err) {
      // Unique constraint violation = already processed. That's fine.
      if (err && typeof err === "object" && "code" in err && err.code === "P2002") {
        return;
      }
      throw err;
    }
  }
}

/* ── Singleton accessor with database availability guard ── */

let _service: VaultLedgerService | null = null;

/**
 * Get the ledger service. Throws DatabaseUnavailableError if the
 * database is not configured (no DATABASE_URL or wrong provider).
 *
 * API routes should call `requireLedger()` and catch
 * `DatabaseUnavailableError` → return 503.
 */
export function getLedgerService(): VaultLedgerService {
  if (!isDatabaseAvailable()) {
    throw new DatabaseUnavailableError();
  }
  if (!_service) _service = new VaultLedgerService();
  return _service;
}

/**
 * Check whether the database is available for provider-backed operations.
 * Returns false if DATABASE_URL is unset OR points to a SQLite file:
 * SQLite is forbidden by the Vault architecture (Vercel/serverless).
 */
export function isDatabaseAvailable(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  // Reject SQLite-style URLs — Postgres only.
  if (url.startsWith("file:")) return false;
  // Reject the placeholder.
  if (url.includes("YOUR_") || url.includes("placeholder")) return false;
  return true;
}

/**
 * Convenience helper for API routes. Returns either the service or null.
 */
export function tryGetLedgerService(): VaultLedgerService | null {
  if (!isDatabaseAvailable()) return null;
  return getLedgerService();
}

// Re-export transition utilities for API/webhook callers.
export {
  isAllowedTransition,
  normalizeProviderStatus,
  InvalidTransitionError,
} from "./transitions";
export type { TransactionStatus } from "./transitions";
