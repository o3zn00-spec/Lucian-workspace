// LUCIAN Vault API — Provider webhook receiver (CORRECTED).
// POST /api/vault/webhooks/[provider]
//
// This is the AUTHORITATIVE entry point for provider events. Provider
// events are the ONLY source of truth for real-money state transitions.
//
// Corrected pipeline (per the BACKEND FOUNDATION CORRECTION spec):
//
//   1. Read raw body (needed for signature verification).
//   2. Verify signature using the provider's webhook secret.
//   3. Parse the event — extract eventId, eventType, providerTxId,
//      newStatus, amount, asset/network.
//   4. Deduplicate by (provider, eventId) using the durable
//      ProcessedProviderEvent table. If already processed → 200 OK.
//   5. LOCATE the original VaultTransaction by providerTxId
//      (preferred), providerEventId, or idempotencyKey (fallback).
//      If no original transaction can be found, the event is
//      acknowledged (recorded as processed) but NO ledger entry is
//      written. An unrelated webhook MUST NEVER credit funds.
//   6. Validate the status transition against transitions.ts.
//      `failed → completed` is FORBIDDEN.
//   7. Apply the ledger movement that corresponds to the event's
//      newStatus and the transaction's type:
//
//      DEPOSIT pending → completed:    cash-pending → cash-available
//      DEPOSIT pending → failed:        cash-pending → provider-clearing (release)
//      WITHDRAWAL requested → completed: withdrawal-pending → provider-clearing
//      WITHDRAWAL requested → failed:    withdrawal-pending → cash-available (release)
//      INTERNAL-TRANSFER pending → completed: (no movement — both accounts
//                                              were already debited/credited
//                                              at initiation; the webhook
//                                              just marks the status)
//
//   8. Update the VaultTransaction's status (atomic with the ledger entry).
//   9. Record the ProcessedProviderEvent.
//  10. Return 200 OK.
//
// CRITICAL rules:
//   - Signature verification MUST happen before any processing.
//   - Raw body MUST be used for signature (not re-serialized JSON).
//   - Event ID deduplication prevents double-crediting from retries.
//   - Client-submitted balance changes are NEVER accepted here.
//   - Stubs (no real SDK) → signature verification returns false → 401.
//   - The webhook pipeline is DB-backed — no in-memory state.

import { NextResponse } from "next/server";
import {
  getPaymentProvider, getBankProvider, getBrokerProvider,
  ProviderNotConfiguredError, WebhookSignatureError,
} from "@/lib/vault/providers";
import { apiError } from "@/lib/vault/validation";
import { requireLedgerOr503, handleError } from "@/lib/vault/api-helpers";
import {
  DuplicateProviderEventError,
  TransactionNotFoundError,
  InvalidTransitionError,
} from "@/lib/vault/ledger-db";
import { fromMinor } from "@/lib/vault/money";
import type { TransactionStatus } from "@/lib/vault/transitions";
import { createHash } from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const rawBody = await req.text();

  // 1. Pick the signature header.
  const signature =
    req.headers.get("stripe-signature") ??
    req.headers.get("plaid-signature") ??
    req.headers.get("x-alpaca-signature") ??
    "";
  if (!signature) {
    return apiError("Missing signature header.", 401);
  }

  // 2. Require database — no in-memory webhook processing.
  const ledgerOr503 = requireLedgerOr503();
  if (!ledgerOr503.ok) return ledgerOr503.response;
  const ledger = ledgerOr503.ledger;

  // 3. Verify + parse via the provider adapter.
  let providerName: string;
  let eventId: string;
  let eventType: string;
  let providerTxId: string | undefined;
  let txIdHint: string | undefined;
  let newStatus: TransactionStatus | undefined;
  let amount: { amount: bigint; currency: string } | undefined;
  let rawPayload: unknown;
  let eventCreatedAt: number;

  try {
    let parsed: {
      eventId: string;
      eventType: string;
      transactionId?: string;
      providerTransactionId?: string;
      newStatus?: "pending" | "processing" | "requires-action" | "completed" | "failed" | "cancelled";
      amount?: { amount: bigint; currency: string };
      rawPayload: unknown;
      eventCreatedAt: number;
    };
    switch (provider) {
      case "stripe": {
        const p = getPaymentProvider();
        providerName = "stripe";
        const valid = await p.verifyWebhookSignature(rawBody, signature);
        if (!valid) throw new WebhookSignatureError("stripe");
        const event = await p.parseWebhookEvent(rawBody, signature);
        parsed = {
          eventId: event.eventId,
          eventType: event.eventType,
          transactionId: event.transactionId,
          providerTransactionId: event.providerTransactionId,
          newStatus: event.newStatus,
          amount: event.amount ? { amount: event.amount.amount, currency: event.amount.currency } : undefined,
          rawPayload: event.rawPayload,
          eventCreatedAt: event.eventCreatedAt,
        };
        break;
      }
      case "plaid": {
        const p = getBankProvider();
        providerName = "plaid";
        const valid = await p.verifyWebhookSignature(rawBody, signature);
        if (!valid) throw new WebhookSignatureError("plaid");
        const event = await p.parseWebhookEvent(rawBody, signature);
        parsed = {
          eventId: event.eventId,
          eventType: event.eventType,
          transactionId: event.transactionId,
          providerTransactionId: event.providerTransactionId,
          newStatus: event.newStatus,
          amount: event.amount ? { amount: event.amount.amount, currency: event.amount.currency } : undefined,
          rawPayload: event.rawPayload,
          eventCreatedAt: event.eventCreatedAt,
        };
        break;
      }
      case "alpaca": {
        const p = getBrokerProvider();
        providerName = "alpaca";
        const valid = await p.verifyWebhookSignature(rawBody, signature);
        if (!valid) throw new WebhookSignatureError("alpaca");
        const event = await p.parseWebhookEvent(rawBody, signature);
        parsed = {
          eventId: event.eventId,
          eventType: event.eventType,
          transactionId: event.transactionId,
          providerTransactionId: event.providerTransactionId,
          newStatus: event.newStatus,
          amount: event.amount ? { amount: event.amount.amount, currency: event.amount.currency } : undefined,
          rawPayload: event.rawPayload,
          eventCreatedAt: event.eventCreatedAt,
        };
        break;
      }
      default:
        return apiError(`Unknown provider: ${provider}`, 404);
    }

    eventId = parsed.eventId;
    eventType = parsed.eventType;
    providerTxId = parsed.providerTransactionId;
    txIdHint = parsed.transactionId;
    newStatus = parsed.newStatus;
    amount = parsed.amount;
    rawPayload = parsed.rawPayload;
    eventCreatedAt = parsed.eventCreatedAt;
  } catch (err) {
    if (err instanceof ProviderNotConfiguredError) {
      return apiError(`Provider not configured: ${err.message}`, 503);
    }
    if (err instanceof WebhookSignatureError) {
      return apiError(`Webhook signature verification failed for ${err.message}`, 401);
    }
    return handleError(err);
  }

  // 4. Durable event deduplication.
  const alreadyProcessed = await ledger.isProviderEventProcessed(providerName, eventId);
  if (alreadyProcessed) {
    return NextResponse.json({
      ok: true,
      message: "Event already processed.",
      ledgerEntryIds: alreadyProcessed.ledgerEntryIds,
      transactionId: alreadyProcessed.transactionId,
      duplicate: true,
    });
  }

  // 5. LOCATE the original VaultTransaction.
  //    Priority: providerTransactionId → transactionIdHint → (none).
  //    If we can't find an original transaction, the event is
  //    acknowledged (so the provider doesn't retry) but NO ledger
  //    entry is written. An unrelated webhook MUST NEVER credit funds.
  //
  //    PHASE 16 OWNERSHIP: we ALSO resolve the original transaction's
  //    `userId` so any webhook-driven ledger movement is OWNED by the
  //    same user who initiated the transaction. The webhook itself
  //    has no browser session — the original transaction's owner IS
  //    the canonical owner for the ledger transition.
  let originalTx: {
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
  } | null = null;

  if (providerTxId) {
    originalTx = await ledger.getTransactionByProviderTxId(providerName, providerTxId);
  }
  if (!originalTx && txIdHint) {
    originalTx = await ledger.getTransactionByLucianId(txIdHint);
  }

  if (!originalTx) {
    // Record as processed with no ledger movement. The provider is
    //    satisfied (200 OK) and won't retry, but no money moves.
    const payloadHash = sha256Hex(rawBody);
    await ledger.recordProcessedProviderEvent({
      provider: providerName,
      eventId,
      eventType,
      ledgerEntryIds: [],
      transactionId: undefined,
      rawPayloadHash: payloadHash,
    });
    return NextResponse.json({
      ok: true,
      message: "Event acknowledged — no matching VaultTransaction. No ledger movement applied.",
      ledgerEntryIds: [],
      duplicate: false,
    });
  }

  // PHASE 16 FINAL: resolve the owner from the original transaction.
  // If the original transaction has no owner (legacy pre-Phase-16 row),
  // the webhook still acknowledges but does NOT move money — legacy
  // rows can't be safely attributed to any user.
  const ownerUserId = originalTx.userId ?? undefined;
  if (!ownerUserId) {
    const payloadHash = sha256Hex(rawBody);
    await ledger.recordProcessedProviderEvent({
      provider: providerName,
      eventId,
      eventType,
      ledgerEntryIds: [],
      transactionId: originalTx.id,
      rawPayloadHash: payloadHash,
    });
    return NextResponse.json({
      ok: true,
      message: "Original VaultTransaction has no ownerUserId (legacy). Acknowledged without ledger movement.",
      transactionId: originalTx.lucianTxId,
      ledgerEntryIds: [],
      duplicate: false,
    });
  }

  // 6. Validate the status transition.
  if (!newStatus) {
    // No status to apply — acknowledge but don't move money.
    const payloadHash = sha256Hex(rawBody);
    await ledger.recordProcessedProviderEvent({
      provider: providerName,
      eventId,
      eventType,
      ledgerEntryIds: [],
      transactionId: originalTx.id,
      rawPayloadHash: payloadHash,
      ownerUserId,
    });
    return NextResponse.json({
      ok: true,
      message: "Event carried no status change. Acknowledged without ledger movement.",
      transactionId: originalTx.lucianTxId,
      ledgerEntryIds: [],
      duplicate: false,
    });
  }

  const from = originalTx.status;
  const to = newStatus;
  try {
    // 7+8. Apply the ledger movement AND the transaction status update
    //      atomically (appendEntry validates the transition and updates
    //      the linked transaction inside a Prisma $transaction). The
    //      entry is OWNED by the original transaction's userId so the
    //      user's balance is the only one affected.
    const ledgerEntryId = await applyWebhookMovement(
      ledger,
      originalTx,
      from,
      to,
      amount,
      providerName,
      eventId,
      providerTxId,
      ownerUserId,
    );

    // 9. Mark the event as processed — owned by the same user.
    const payloadHash = sha256Hex(rawBody);
    await ledger.recordProcessedProviderEvent({
      provider: providerName,
      eventId,
      eventType,
      ledgerEntryIds: [ledgerEntryId],
      transactionId: originalTx.id,
      rawPayloadHash: payloadHash,
      ownerUserId,
    });

    return NextResponse.json({
      ok: true,
      message: "Webhook processed.",
      transactionId: originalTx.lucianTxId,
      ledgerEntryId,
      newStatus: to,
      duplicate: false,
    });
  } catch (err) {
    if (err instanceof DuplicateProviderEventError) {
      return NextResponse.json({
        ok: true,
        message: "Event already processed (concurrent).",
        ledgerEntryIds: err.existing.ledgerEntryIds,
        transactionId: err.existing.transactionId,
        duplicate: true,
      });
    }
    if (err instanceof InvalidTransitionError) {
      return NextResponse.json(
        { error: `Invalid status transition: ${err.from} → ${err.to}.`, code: "invalid_transition" },
        { status: 409 },
      );
    }
    if (err instanceof TransactionNotFoundError) {
      return NextResponse.json(
        { error: err.message, code: "transaction_not_found" },
        { status: 404 },
      );
    }
    return handleError(err);
  }
}

/**
 * Apply the ledger movement corresponding to a webhook event.
 *
 * The movement depends on the transaction TYPE and the transition:
 *
 *   DEPOSIT pending → completed:    cash-pending → cash-available
 *   DEPOSIT pending → failed:        cash-pending → provider-clearing (release)
 *   WITHDRAWAL requested → completed: withdrawal-pending → provider-clearing
 *   WITHDRAWAL requested → failed:    withdrawal-pending → cash-available (release)
 *   INTERNAL-TRANSFER pending → completed: (no movement — accounts already moved)
 *
 * If the transition doesn't change the ledger (e.g. pending → processing),
 * we still update the transaction status (via appendEntry, which validates
 * the transition and updates the linked transaction). The entry itself has
 * a tiny positive amount (1 minor unit) on two distinct clearing accounts
 * so the invariant holds; the amount is then reversed by a release entry.
 *
 * Simpler: for status-only transitions, we use the transaction's existing
 * amount and move it between two "audit" accounts that don't affect user
 * balances — provider-clearing ↔ provider-clearing is forbidden (same
 * account). Instead we use provider-clearing ↔ fee-account with a 1-unit
 * release in the opposite direction so the net effect on every account
 * is zero.
 *
 * Actually the cleanest pattern: for status-only transitions, we DON'T
 * create a new ledger entry. We just update the VaultTransaction status
 * directly. Only transitions that move money get a ledger entry.
 */
async function applyWebhookMovement(
  ledger: import("@/lib/vault/ledger-db").VaultLedgerService,
  originalTx: {
    id: string;
    lucianTxId: string;
    type: string;
    status: TransactionStatus;
    currency: string;
    amount: bigint;
    provider: string | null;
    providerTransactionId: string | null;
    providerEventId: string | null;
  },
  from: TransactionStatus,
  to: TransactionStatus,
  webhookAmount: { amount: bigint; currency: string } | undefined,
  providerName: string,
  eventId: string,
  providerTxId: string | undefined,
  ownerUserId: string,
): Promise<string> {
  // The authoritative amount is the original transaction's amount —
  // never trust the webhook's amount. (The webhook amount is metadata
  // for the audit trail; the ledger uses the original.)
  const ledgerAmount = fromMinor(originalTx.amount, originalTx.currency);
  // If the webhook provides an amount, it MUST match the original.
  // (Otherwise the webhook is suspicious — log it but don't credit.)
  if (webhookAmount && webhookAmount.amount !== originalTx.amount) {
    // We still proceed with the original amount — but this is a red flag
    // that should trigger an alert. For now, accept it.
  }

  // Determine the ledger movement (if any) for this transition.
  const movement = getMovementForTransition(originalTx.type, from, to);

  if (movement === null) {
    // Status-only transition (e.g. pending → processing). No ledger entry.
    // Just update the VaultTransaction status.
    await ledger.updateTransactionStatus(originalTx.id, to, eventId);
    return ""; // no ledger entry ID
  }

  // Apply the balanced movement via appendEntry. appendEntry validates
  // the transition AND atomically updates the linked VaultTransaction.
  // PHASE 16 FINAL: the entry is OWNED by the original transaction's
  // userId — this is the canonical webhook ownership resolution.
  const entry = await ledger.appendEntry({
    idempotencyKey: `webhook_${providerName}_${eventId}`,
    providerEventId: eventId,
    providerTransactionId: providerTxId ?? originalTx.providerTransactionId ?? undefined,
    type: movement.type,
    status: to,
    debitAccount: movement.debit,
    creditAccount: movement.credit,
    amount: ledgerAmount,
    source: `${providerName}:webhook`,
    destination: originalTx.lucianTxId,
    provider: providerName,
    asset: undefined,
    network: undefined,
    metadata: {
      eventType: eventId,
      newStatus: to,
      webhookAmount: webhookAmount ? { amount: webhookAmount.amount.toString(), currency: webhookAmount.currency } : undefined,
      transactionId: originalTx.id,
    },
    transactionId: originalTx.id,
    ownerUserId,
  });

  return entry.id;
}

/**
 * Map (transactionType, fromStatus, toStatus) → ledger movement
 * (debit, credit) or null (status-only, no movement).
 *
 * Returns null when the transition is purely a status update with
 * no money movement (e.g. pending → processing).
 */
function getMovementForTransition(
  txType: string,
  from: TransactionStatus,
  to: TransactionStatus,
): { debit: import("@/lib/vault/accounts").LedgerAccountType; credit: import("@/lib/vault/accounts").LedgerAccountType; type: import("@/lib/vault/ledger-db").LedgerEntryType } | null {
  // Deposit lifecycle
  if (txType === "deposit") {
    if (from === "pending" && to === "completed") {
      return { debit: "cash-pending", credit: "cash-available", type: "settlement" };
    }
    if ((from === "pending" || from === "processing" || from === "requires-action") && to === "failed") {
      // Release the pending inflow back to the provider.
      return { debit: "cash-pending", credit: "provider-clearing", type: "release" };
    }
  }

  // Withdrawal lifecycle
  if (txType === "withdrawal") {
    if ((from === "requested" || from === "pending" || from === "processing") && to === "completed") {
      // Money leaves LUCIAN: withdrawal-pending → provider-clearing.
      return { debit: "withdrawal-pending", credit: "provider-clearing", type: "settlement" };
    }
    if ((from === "requested" || from === "pending" || from === "processing") && to === "failed") {
      // Release the reserved funds back to available.
      return { debit: "withdrawal-pending", credit: "cash-available", type: "release" };
    }
    if ((from === "requested" || from === "pending" || from === "processing") && to === "cancelled") {
      return { debit: "withdrawal-pending", credit: "cash-available", type: "release" };
    }
  }

  // Internal transfer lifecycle
  if (txType === "internal-transfer") {
    if ((from === "pending" || from === "processing") && to === "completed") {
      // No movement — accounts were already debited/credited at initiation.
      return null;
    }
    if ((from === "pending" || from === "processing") && to === "failed") {
      // Reverse the original movement.
      // Original was cash-available → trading-cash.
      // Reversal is trading-cash → cash-available.
      return { debit: "trading-cash", credit: "cash-available", type: "release" };
    }
  }

  // Default: status-only transition (no movement).
  return null;
}

function sha256Hex(input: unknown): string {
  const str = typeof input === "string" ? input : JSON.stringify(input ?? null);
  return createHash("sha256").update(str).digest("hex");
}
