// LUCIAN Vault API — Deposit initiation.
// POST /api/vault/deposits
//
// Initiates a deposit (Add Money flow). Returns the honest status from
// the provider. NEVER marks funds as available based on client-reported
// success — only verified provider confirmation (via webhook) settles
// funds from `cash-pending` into `cash-available`.
//
// Balanced accounting movement (when a real provider is configured and
// the database is available):
//
//   DEPOSIT INITIATED (provider confirms intent):
//     provider-clearing  →  cash-pending          (status=pending)
//
//   DEPOSIT SETTLED (webhook, see /api/vault/webhooks/[provider]):
//     cash-pending       →  cash-available        (status=completed)
//
//   DEPOSIT FAILED (webhook):
//     cash-pending       →  provider-clearing     (status=failed — release)
//
// The route writes a VaultTransaction (user-facing record) plus the
// initial LedgerEntry inside a single Prisma transaction. Both the
// transaction ID and ledger entry ID are durable.

import { NextResponse } from "next/server";
import {
  getPaymentProvider, getBankProvider,
  ProviderStubError,
} from "@/lib/vault/providers";
import { validateAmount, getIdempotencyKey, apiError } from "@/lib/vault/validation";
import { requireLedgerOr503, handleError } from "@/lib/vault/api-helpers";
import { IdempotencyConflictError } from "@/lib/vault/ledger-db";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  // 0. PHASE 16 FINAL: require the authenticated user. Every write
  //    must derive ownerUserId from the session — NEVER from the body.
  let userId: string;
  try {
    userId = await requireVaultOwner();
  } catch {
    return unauthorizedVaultResponse();
  }

  // 1. Validate idempotency key (header).
  const idemResult = getIdempotencyKey(req);
  if (!idemResult.ok) return apiError(idemResult.error, 400);
  const idempotencyKey = idemResult.value;

  // 2. Parse and validate body.
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const currency = typeof body.currency === "string" ? body.currency : "USD";
  const amountResult = validateAmount(body.amount, currency);
  if (!amountResult.ok) return apiError(amountResult.error, 400);
  const amount = amountResult.value;

  const method = body.method;
  if (method !== "card" && method !== "bank" && method !== "crypto") {
    return apiError("Method must be 'card', 'bank', or 'crypto'.", 400);
  }

  // 3. Require the database — provider-backed operations are NOT
  //    allowed without persistent storage.
  const ledgerOr503 = requireLedgerOr503();
  if (!ledgerOr503.ok) return ledgerOr503.response;
  const ledger = ledgerOr503.ledger;

  // 4. Durable idempotency check. Same key + same body → return cached.
  //    Same key + different body → 409 Conflict. Scoped by userId so
  //    the same idempotencyKey under two different users is independent.
  try {
    const existing = await ledger.checkIdempotency(idempotencyKey, body, userId);
    if (existing) {
      return NextResponse.json(existing.response, { status: existing.status });
    }
  } catch (err) {
    if (err instanceof IdempotencyConflictError) return handleError(err);
    throw err;
  }

  // 5. Route to the appropriate provider. Each branch:
  //    - Validates the method-specific input.
  //    - Rejects stub providers with a clear 503 (no fake transactions).
  //    - Calls the provider to initiate the deposit.
  //    - Writes a VaultTransaction + LedgerEntry (provider-clearing → cash-pending).
  try {
    let providerName: string;
    let providerTxId: string | undefined;
    let initialStatus: "pending" | "processing" | "requires-action" | "completed" | "failed" = "pending";
    let clientSecret: string | undefined;
    let nextActionUrl: string | undefined;
    let message: string | undefined;
    let source: string;
    let asset: string | undefined;
    let network: string | undefined;
    let depositAddress: string | undefined;

    if (method === "card") {
      const paymentMethodId = body.methodId;
      if (typeof paymentMethodId !== "string" || !paymentMethodId) {
        return apiError("Payment method ID required for card deposit.", 400);
      }
      const provider = getPaymentProvider();
      if (!provider.isConfigured()) {
        return apiError(
          "Stripe is not configured. Set STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.",
          503, "provider_not_configured",
        );
      }
      let result;
      try {
        result = await provider.initiateDeposit({
          amount, paymentMethodId, idempotencyKey,
          description: "LUCIAN Vault deposit",
        });
      } catch (err) {
        if (err instanceof ProviderStubError) {
          return apiError(err.message, 503, "provider_stub");
        }
        throw err;
      }
      providerName = "stripe";
      providerTxId = result.providerTransactionId;
      initialStatus = result.status === "completed" ? "completed" : result.status === "failed" ? "failed" : result.status === "requires-action" ? "requires-action" : result.status === "processing" ? "processing" : "pending";
      clientSecret = result.clientSecret;
      nextActionUrl = result.nextActionUrl;
      message = result.message;
      source = `card:${paymentMethodId}`;
    } else if (method === "bank") {
      const bankAccountId = body.methodId;
      if (typeof bankAccountId !== "string" || !bankAccountId) {
        return apiError("Bank account ID required for bank deposit.", 400);
      }
      const provider = getBankProvider();
      if (!provider.isConfigured()) {
        return apiError(
          "Plaid is not configured. Set BANK_PROVIDER_CLIENT_ID and BANK_PROVIDER_SECRET.",
          503, "provider_not_configured",
        );
      }
      let result;
      try {
        result = await provider.initiateDeposit({
          amount, bankAccountId, idempotencyKey,
        });
      } catch (err) {
        if (err instanceof ProviderStubError) {
          return apiError(err.message, 503, "provider_stub");
        }
        throw err;
      }
      providerName = "plaid";
      providerTxId = result.providerTransactionId;
      initialStatus = result.status === "completed" ? "completed" : result.status === "failed" ? "failed" : result.status === "requires-action" ? "requires-action" : result.status === "processing" ? "processing" : "pending";
      clientSecret = result.clientSecret;
      nextActionUrl = result.nextActionUrl;
      message = result.message;
      source = `bank:${bankAccountId}`;
    } else {
      // crypto
      const assetVal = typeof body.asset === "string" ? body.asset : "";
      const networkVal = typeof body.network === "string" ? body.network : "";
      if (!assetVal || !networkVal) {
        return apiError("Asset and network required for crypto deposit.", 400);
      }
      return apiError("Use the Bybit panel in Vault → Money to load a provider-verified deposit address for the selected wallet and chain.", 409, "use_bybit_deposit_flow");
    }

    // 6. Write VaultTransaction (user-facing record) — OWNED by userId.
    const lucianTxId = `dep_${idempotencyKey}`;
    const tx = await ledger.createTransaction({
      lucianTxId,
      type: "deposit",
      status: initialStatus,
      currency,
      amount,
      source,
      destination: "vault",
      provider: providerName,
      providerTransactionId: providerTxId,
      idempotencyKey,
      ownerUserId: userId,
      asset,
      network,
      metadata: { method, methodId: body.methodId, clientSecret },
    });

    // 7. Write the initial ledger entry (provider-clearing → cash-pending
    //    for pending deposits; provider-clearing → cash-available for
    //    instantly completed deposits). OWNED by userId — this is the
    //    critical scoping that makes balances per-user.
    //
    //    NOTE: debit and credit are ALWAYS distinct — the
    //    assertDistinctAccounts guard rejects same-account entries.
    const creditAccount = initialStatus === "completed" ? "cash-available" : "cash-pending";
    const entry = await ledger.appendEntry({
      idempotencyKey,
      providerTransactionId: providerTxId,
      type: "deposit",
      status: initialStatus,
      debitAccount: "provider-clearing",
      creditAccount,
      amount,
      source,
      destination: "vault",
      provider: providerName,
      asset,
      network,
      metadata: { method, methodId: body.methodId, clientSecret, transactionId: tx.id },
      transactionId: tx.id,
      ownerUserId: userId,
    });

    const response = {
      transactionId: lucianTxId,
      ledgerEntryId: entry.id,
      providerTransactionId: providerTxId,
      status: initialStatus,
      clientSecret,
      nextActionUrl,
      depositAddress,
      message,
    };

    // 8. Persist the idempotency record so a replay returns this exact response.
    await ledger.recordIdempotency(idempotencyKey, body, response, 200, undefined, userId);

    return NextResponse.json(response);
  } catch (err) {
    return handleError(err);
  }
}
