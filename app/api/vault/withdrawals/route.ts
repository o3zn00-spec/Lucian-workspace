// LUCIAN Vault API — Withdrawal initiation.
// POST /api/vault/withdrawals
//
// Initiates a withdrawal. Money LEAVES the LUCIAN financial environment.
//
// Balanced accounting movement:
//
//   WITHDRAWAL REQUESTED (this route):
//     cash-available      →  withdrawal-pending     (status=requested)
//
//   WITHDRAWAL PROCESSING (provider confirms, webhook):
//     (no movement — status transition only: requested → processing)
//
//   WITHDRAWAL COMPLETED (webhook):
//     withdrawal-pending  →  provider-clearing       (status=completed)
//
//   WITHDRAWAL FAILED (webhook):
//     withdrawal-pending  →  cash-available          (status=failed — release)
//
// The `validateWithdrawal` helper enforces ALL server-side withdrawal
// security rules BEFORE any ledger entry is written.

import { NextResponse } from "next/server";
import {
  getPaymentProvider, getBankProvider,
  ProviderStubError,
} from "@/lib/vault/providers";
import {
  validateAmount, validateDestinationType, validateCryptoAddress,
  getIdempotencyKey, apiError,
} from "@/lib/vault/validation";
import { requireLedgerOr503, handleError } from "@/lib/vault/api-helpers";
import { IdempotencyConflictError } from "@/lib/vault/ledger-db";
import { validateWithdrawal } from "@/lib/vault/withdrawal-validation";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  // 0. PHASE 16 FINAL: require the authenticated user. Withdrawals
  //    are user-owned writes — ownerUserId comes from the session.
  let userId: string;
  try {
    userId = await requireVaultOwner();
  } catch {
    return unauthorizedVaultResponse();
  }

  // 1. Idempotency header.
  const idemResult = getIdempotencyKey(req);
  if (!idemResult.ok) return apiError(idemResult.error, 400);
  const idempotencyKey = idemResult.value;

  // 2. Body + amount + destinationType.
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

  const destTypeResult = validateDestinationType(body.destinationType);
  if (!destTypeResult.ok) return apiError(destTypeResult.error, 400);
  const destinationType = destTypeResult.value;

  const destinationId = body.destinationId;
  if (typeof destinationId !== "string" || !destinationId) {
    return apiError("Destination ID required.", 400);
  }

  // 3. Crypto-specific fields.
  let asset: string | undefined;
  let network: string | undefined;
  let address: string | undefined;
  if (destinationType === "crypto") {
    asset = typeof body.asset === "string" ? body.asset : "";
    network = typeof body.network === "string" ? body.network : "";
    const addressResult = validateCryptoAddress(body.address);
    if (!asset || !network) return apiError("Asset and network required for crypto withdrawal.", 400);
    if (!addressResult.ok) return apiError(addressResult.error, 400);
    address = addressResult.value;
  }

  // 4. Database required.
  const ledgerOr503 = requireLedgerOr503();
  if (!ledgerOr503.ok) return ledgerOr503.response;
  const ledger = ledgerOr503.ledger;

  // 5. Durable idempotency. Scoped by userId — same key under two
  //    different users is independent.
  try {
    const existing = await ledger.checkIdempotency(idempotencyKey, body, userId);
    if (existing) {
      return NextResponse.json(existing.response, { status: existing.status });
    }
  } catch (err) {
    if (err instanceof IdempotencyConflictError) return handleError(err);
    throw err;
  }

  // 6. Run ALL server-side withdrawal checks. Pass ownerUserId so
  //    balances + daily limits are scoped per-user.
  const check = await validateWithdrawal(ledger, {
    amount,
    destinationId,
    destinationType,
    asset,
    network,
    address,
    ownerUserId: userId,
  });
  if (!check.ok) {
    return NextResponse.json(
      { error: check.error, code: check.code },
      { status: check.status ?? 400 },
    );
  }

  // 7. Route to the provider. Stub providers throw ProviderStubError
  //    → 503. We NEVER write a fake ledger entry.
  try {
    let providerName: string;
    let providerTxId: string | undefined;
    let initialStatus: "requested" | "pending" | "processing" | "completed" | "failed" = "requested";
    let message: string | undefined;
    let estimatedArrival: number | undefined;
    let fee: { amount: bigint; currency: string } | undefined;

    if (destinationType === "card") {
      const provider = getPaymentProvider();
      if (!provider.isConfigured()) {
        return apiError("Stripe not configured.", 503, "provider_not_configured");
      }
      if (!provider.initiateCardPayout) {
        return apiError("Card payouts not supported by this provider.", 400);
      }
      let result;
      try {
        result = await provider.initiateCardPayout({
          amount, paymentMethodId: destinationId, idempotencyKey,
        });
      } catch (err) {
        if (err instanceof ProviderStubError) return apiError(err.message, 503, "provider_stub");
        throw err;
      }
      providerName = "stripe";
      providerTxId = result.providerTransactionId;
      initialStatus = mapProviderStatus(result.status);
      message = result.message;
      estimatedArrival = result.estimatedArrival;
      fee = result.fee ? { amount: result.fee.amount, currency: result.fee.currency } : undefined;
    } else if (destinationType === "bank") {
      const provider = getBankProvider();
      if (!provider.isConfigured()) {
        return apiError("Plaid not configured.", 503, "provider_not_configured");
      }
      let result;
      try {
        result = await provider.initiateWithdrawal({
          amount, bankAccountId: destinationId, idempotencyKey,
        });
      } catch (err) {
        if (err instanceof ProviderStubError) return apiError(err.message, 503, "provider_stub");
        throw err;
      }
      providerName = "plaid";
      providerTxId = result.providerTransactionId;
      initialStatus = mapProviderStatus(result.status);
      message = result.message;
      estimatedArrival = result.estimatedArrival;
      fee = result.fee ? { amount: result.fee.amount, currency: result.fee.currency } : undefined;
    } else {
      return apiError("Use the Bybit panel in Vault → Money. Its preview, password, exact confirmation phrase, allowlist, and server limit are mandatory.", 409, "use_bybit_withdrawal_flow");
    }

    // 8. Write VaultTransaction — OWNED by userId.
    const lucianTxId = `wd_${idempotencyKey}`;
    const dest = `${destinationType}:${destinationId}`;
    const tx = await ledger.createTransaction({
      lucianTxId,
      type: "withdrawal",
      status: initialStatus,
      currency,
      amount,
      source: "vault",
      destination: dest,
      provider: providerName,
      providerTransactionId: providerTxId,
      idempotencyKey,
      ownerUserId: userId,
      asset,
      network,
      metadata: { destinationType, destinationId, fee, estimatedArrival },
    });

    // 9. Write ledger entry (cash-available → withdrawal-pending).
    //    debit and credit are DISTINCT — the same-account bug is
    //    structurally impossible here. OWNED by userId — balances
    //    are derived per-user from this ownership tag.
    const entry = await ledger.appendEntry({
      idempotencyKey,
      providerTransactionId: providerTxId,
      type: "withdrawal",
      status: initialStatus,
      debitAccount: "cash-available",
      creditAccount: "withdrawal-pending",
      amount,
      source: "vault",
      destination: dest,
      provider: providerName,
      asset,
      network,
      metadata: { destinationType, destinationId, fee, transactionId: tx.id },
      transactionId: tx.id,
      ownerUserId: userId,
    });

    const response = {
      transactionId: lucianTxId,
      ledgerEntryId: entry.id,
      providerTransactionId: providerTxId,
      status: initialStatus,
      message,
      estimatedArrival,
      fee,
    };

    await ledger.recordIdempotency(idempotencyKey, body, response, 200, undefined, userId);
    return NextResponse.json(response);
  } catch (err) {
    return handleError(err);
  }
}

function mapProviderStatus(s: "requested" | "pending" | "processing" | "completed" | "failed"): "requested" | "pending" | "processing" | "completed" | "failed" {
  return s;
}
