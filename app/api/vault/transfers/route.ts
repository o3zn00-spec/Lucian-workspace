// LUCIAN Vault API — Internal transfer.
// POST /api/vault/transfers
//
// An internal transfer moves money between two LUCIAN-owned accounts.
// Money NEVER leaves the LUCIAN financial environment.
//
// Valid transfer types:
//   - vault → trading (fund brokerage from Vault cash)
//   - vault → brokerage (alias for trading)
//   - trading → vault (withdraw from brokerage to Vault cash)
//
// Balanced accounting movement:
//
//   vault → trading:   cash-available  →  trading-cash
//   trading → vault:   trading-cash    →  cash-available
//
// debit and credit are ALWAYS distinct. The same-account bug is
// structurally impossible here.

import { NextResponse } from "next/server";
import { getBrokerProvider, ProviderStubError } from "@/lib/vault/providers";
import { validateAmount, getIdempotencyKey, apiError } from "@/lib/vault/validation";
import { requireLedgerOr503, handleError } from "@/lib/vault/api-helpers";
import { IdempotencyConflictError } from "@/lib/vault/ledger-db";
import { LedgerAccountType } from "@/lib/vault/accounts";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  // 0. PHASE 16 FINAL: require the authenticated user. Transfers are
  //    user-owned writes — ownerUserId comes from the session.
  let userId: string;
  try {
    userId = await requireVaultOwner();
  } catch {
    return unauthorizedVaultResponse();
  }

  const idemResult = getIdempotencyKey(req);
  if (!idemResult.ok) return apiError(idemResult.error, 400);
  const idempotencyKey = idemResult.value;

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

  // Accept either `from` or `direction`. `from` is the source account.
  const fromRaw = typeof body.from === "string" ? body.from : "vault";
  const to = typeof body.to === "string" ? body.to : "";

  // Map source/destination to internal ledger accounts.
  const fromAccount = mapAccount(fromRaw);
  const toAccount = mapAccount(to);
  if (!fromAccount || !toAccount) {
    return apiError(
      "Transfer source/destination must be 'vault', 'trading', or 'brokerage'.",
      400,
    );
  }
  if (fromAccount === toAccount) {
    return apiError(
      "Source and destination must be different accounts. Same-account transfers are forbidden by the LUCIAN accounting model.",
      400,
    );
  }

  // Validate supported direction.
  if (
    !(fromAccount === "cash-available" && toAccount === "trading-cash") &&
    !(fromAccount === "trading-cash" && toAccount === "cash-available")
  ) {
    return apiError(
      "Unsupported transfer direction. Supported: vault→trading, trading→vault.",
      400,
    );
  }

  const ledgerOr503 = requireLedgerOr503();
  if (!ledgerOr503.ok) return ledgerOr503.response;
  const ledger = ledgerOr503.ledger;

  try {
    const existing = await ledger.checkIdempotency(idempotencyKey, body, userId);
    if (existing) {
      return NextResponse.json(existing.response, { status: existing.status });
    }
  } catch (err) {
    if (err instanceof IdempotencyConflictError) return handleError(err);
    throw err;
  }

  // Validate sufficient funds in the source account — scoped per-user.
  const fundsCheck = await ledger.validateSufficientFunds(fromAccount, amount, userId);
  if (!fundsCheck.ok) {
    return apiError(fundsCheck.error!, 400);
  }

  try {
    // For Vault→Brokerage transfers, the broker provider must be
    // configured AND wired up (no stub). For Trading→Vault, same.
    const provider = getBrokerProvider();
    let providerTxId: string | undefined;
    let initialStatus: "pending" | "processing" | "completed" = "pending";

    if (!provider.isConfigured()) {
      return apiError(
        "Broker (Alpaca) not configured. Set BROKER_API_KEY and BROKER_API_SECRET.",
        503, "provider_not_configured",
      );
    }
    try {
      const result = fromAccount === "cash-available"
        ? await provider.initiateFunding({ amount, idempotencyKey })
        : await provider.initiateWithdrawal({ amount, idempotencyKey });
      providerTxId = result.providerTransactionId;
      initialStatus = result.status === "completed" ? "completed" : result.status === "failed" ? "pending" : "pending";
    } catch (err) {
      if (err instanceof ProviderStubError) {
        return apiError(err.message, 503, "provider_stub");
      }
      throw err;
    }

    // Write VaultTransaction — OWNED by userId.
    const lucianTxId = `tf_${idempotencyKey}`;
    const tx = await ledger.createTransaction({
      lucianTxId,
      type: "internal-transfer",
      status: initialStatus,
      currency,
      amount,
      source: fromRaw,
      destination: to,
      provider: "alpaca",
      providerTransactionId: providerTxId,
      idempotencyKey,
      ownerUserId: userId,
      metadata: { from: fromRaw, to, transactionId: undefined },
    });

    // Write ledger entry — DISTINCT debit/credit accounts. OWNED by userId.
    const entry = await ledger.appendEntry({
      idempotencyKey,
      providerTransactionId: providerTxId,
      type: "internal-transfer",
      status: initialStatus,
      debitAccount: fromAccount,
      creditAccount: toAccount,
      amount,
      source: fromRaw,
      destination: to,
      provider: "alpaca",
      metadata: { from: fromRaw, to, transactionId: tx.id },
      transactionId: tx.id,
      ownerUserId: userId,
    });

    const response = {
      transactionId: lucianTxId,
      ledgerEntryId: entry.id,
      providerTransactionId: providerTxId,
      status: initialStatus,
      message: "Transfer requested. Pending provider confirmation.",
    };

    await ledger.recordIdempotency(idempotencyKey, body, response, 200, undefined, userId);
    return NextResponse.json(response);
  } catch (err) {
    return handleError(err);
  }
}

function mapAccount(s: string): LedgerAccountType | null {
  if (s === "vault") return "cash-available";
  if (s === "trading" || s === "brokerage") return "trading-cash";
  return null;
}
