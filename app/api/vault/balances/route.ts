// LUCIAN Vault API — Balances (FINAL CORRECTED, user-owned).
// GET /api/vault/balances
//
// Returns the authoritative balances DERIVED from the server ledger,
// scoped to the authenticated user. The browser/client NEVER submits
// balance changes — balances are derived from provider-verified
// ledger entries only.
//
// PHASE 16 OWNERSHIP (FINAL): balances are scoped by `ownerUserId`.
// User A's ledger entries do NOT affect User B's balances. This is
// the canonical per-user boundary.
//
// If the database is unavailable, the route returns zeros with
// `providerConnected: false` and a clear status field, so the UI
// can still render (the "no provider connected" state).

import { NextResponse } from "next/server";
import { isAnyProviderConnected, getCryptoProvider } from "@/lib/vault/providers";
import { tryGetLedgerService } from "@/lib/vault/ledger-db";
import { fromMinor, add, subtract } from "@/lib/vault/money";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  // Phase 16 FINAL: derive userId from the authenticated session.
  // Every subsequent query is scoped by ownerUserId.
  let userId: string;
  try {
    userId = await requireVaultOwner();
  } catch {
    return unauthorizedVaultResponse();
  }

  const ledger = tryGetLedgerService();
  const providerConnected = isAnyProviderConnected();
  const currency = "USD";

  // Derive balances from the ledger if available; else zero.
  if (!ledger) {
    return NextResponse.json({
      cash: {
        available: { amount: "0", currency },
        pending: { amount: "0", currency },
        reserved: { amount: "0", currency },
        withdrawable: { amount: "0", currency },
      },
      trading: {
        cash: { amount: "0", currency },
        buyingPower: { amount: "0", currency },
        openPositions: { amount: "0", currency },
        reservedForOrders: { amount: "0", currency },
      },
      crypto: { holdings: [], totalFiatEquivalent: { amount: "0", currency } },
      totalValue: { amount: "0", currency },
      providerConnected,
      databaseAvailable: false,
      status: providerConnected ? "live" : "real-money-ready",
      message: "Database unavailable — provider-backed balances are not shown. Manual accounts remain available in the client store.",
    });
  }

  // PER-USER balances — pass ownerUserId so only this user's entries
  // are summed. User A's ledger does NOT affect User B's balances.
  const cashAvailable = await ledger.deriveBalance("cash-available", currency, userId);
  const sandboxCashAvailable = await ledger.deriveBalance("sandbox-cash-available", currency, userId);
  const cashPending = await ledger.deriveBalance("cash-pending", currency, userId);
  const cashReserved = await ledger.deriveBalance("cash-reserved", currency, userId);
  const tradingCash = await ledger.deriveBalance("trading-cash", currency, userId);
  const tradingBuyingPower = await ledger.deriveBalance("trading-buying-power", currency, userId);
  const tradingPositions = await ledger.deriveBalance("trading-positions", currency, userId);
  const tradingReservedOrders = await ledger.deriveBalance("trading-reserved", currency, userId);

  const withdrawable = subtract(cashAvailable.balance, cashReserved.balance);
  const displayedAvailable = add(cashAvailable.balance, sandboxCashAvailable.balance);

  // Crypto holdings (from provider when connected).
  let cryptoHoldings: Array<{
    asset: string;
    network: string;
    quantity: string;
    fiatEquivalent: { amount: string; currency: string };
  }> = [];
  try {
    const cryptoProvider = getCryptoProvider();
    if (cryptoProvider.isConfigured() && cryptoProvider.isAuthenticated()) {
      const balances = await cryptoProvider.getBalances();
      cryptoHoldings = balances.map((b) => ({
        asset: b.asset,
        network: b.network,
        quantity: b.quantity,
        fiatEquivalent: {
          amount: b.fiatEquivalent.amount.toString(),
          currency: b.fiatEquivalent.currency,
        },
      }));
    }
  } catch {
    // Provider not connected or stub — empty list.
  }

  const totalCashValue = add(add(displayedAvailable, cashPending.balance), cashReserved.balance);
  const totalTradingValue = add(tradingCash.balance, tradingPositions.balance);
  const totalCryptoValue = cryptoHoldings.reduce(
    (sum, h) => sum + BigInt(h.fiatEquivalent.amount),
    0n,
  );
  const totalValue = add(add(totalCashValue, totalTradingValue), fromMinor(totalCryptoValue, currency));

  return NextResponse.json({
    cash: {
      available: { amount: displayedAvailable.amount.toString(), currency: displayedAvailable.currency },
      sandboxAvailable: { amount: sandboxCashAvailable.balance.amount.toString(), currency: sandboxCashAvailable.balance.currency },
      pending: { amount: cashPending.balance.amount.toString(), currency: cashPending.balance.currency },
      reserved: { amount: cashReserved.balance.amount.toString(), currency: cashReserved.balance.currency },
      withdrawable: { amount: withdrawable.amount.toString(), currency: withdrawable.currency },
    },
    trading: {
      cash: { amount: tradingCash.balance.amount.toString(), currency: tradingCash.balance.currency },
      buyingPower: { amount: tradingBuyingPower.balance.amount.toString(), currency: tradingBuyingPower.balance.currency },
      openPositions: { amount: tradingPositions.balance.amount.toString(), currency: tradingPositions.balance.currency },
      reservedForOrders: { amount: tradingReservedOrders.balance.amount.toString(), currency: tradingReservedOrders.balance.currency },
    },
    crypto: {
      holdings: cryptoHoldings,
      totalFiatEquivalent: { amount: totalCryptoValue.toString(), currency },
    },
    totalValue: { amount: totalValue.amount.toString(), currency },
    providerConnected,
    databaseAvailable: true,
    status: providerConnected ? "live" : "real-money-ready",
  });
}
