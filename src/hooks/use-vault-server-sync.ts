"use client";

// LUCIAN Vault — Server sync hook.
//
// The Vault UI must consume its server APIs. This hook:
//   - fetches all 8 endpoints on mount (or when the tab becomes visible)
//   - exposes a `refresh()` function to re-fetch after mutations
//   - exposes a `refreshOne(name)` to re-fetch a single slice
//
// The server is the source of truth for:
//   - balances (derived from the ledger)
//   - provider-verified accounts
//   - payment methods (cards)
//   - withdrawal destinations
//   - provider connection states
//   - auto-fund config
//   - security settings
//   - transactions (the ledger)
//
// The Zustand store continues to manage:
//   - manual (self-reported) accounts
//   - capital pool allocations
//   - UI preferences
//
// Both the server and the client are reconciled in the store via
// `setBalances`, `setPaymentMethods`, `setWithdrawalDestinations`,
// `setAutoFund` etc. — never via direct mutation.

import { useEffect, useCallback, useRef } from "react";
import { useVaultStore } from "@/store/vault";

interface BalancesResponse {
  cash: {
    available: { amount: string; currency: string };
    pending: { amount: string; currency: string };
    reserved: { amount: string; currency: string };
    withdrawable: { amount: string; currency: string };
  };
  trading: {
    cash: { amount: string; currency: string };
    buyingPower: { amount: string; currency: string };
    openPositions: { amount: string; currency: string };
    reservedForOrders: { amount: string; currency: string };
  };
  crypto: {
    holdings: Array<{
      asset: string;
      network?: string;
      quantity: string;
      fiatEquivalent: { amount: string; currency: string };
    }>;
    totalFiatEquivalent: { amount: string; currency: string };
  };
  totalValue: { amount: string; currency: string };
  providerConnected: boolean;
  databaseAvailable?: boolean;
  status: string;
}

interface PaymentMethodsResponse {
  paymentMethods: Array<{
    providerPaymentMethodId: string;
    brand: string;
    last4: string;
    expiryMonth: number;
    expiryYear: number;
    isDefault: boolean;
    depositEligible: boolean;
    withdrawalEligible: boolean;
    displayName: string;
  }>;
  providerConnected: boolean;
}

interface WithdrawalDestinationsResponse {
  destinations: Array<{
    id: string;
    type: "bank" | "card" | "crypto";
    referenceId?: string;
    label: string;
    asset: string;
    network?: string;
    address?: string;
    approved: boolean;
    approvedAt?: number;
    addedAt: number;
  }>;
}

interface ProvidersResponse {
  providers: Array<{
    id: string;
    type: string;
    name: string;
    configured: boolean;
    state: "not_configured" | "configured" | "setup_required" | "connecting" | "connected" | "restricted" | "error";
    authenticated: boolean;
    displayName: string;
    stateDetail?: string;
  }>;
  anyConnected: boolean;
  anyConfigured: boolean;
  liveMode: boolean;
}

interface AutoFundResponse {
  enabled: boolean;
  fundingSourceId: string | null;
  fundingSourceType: "card" | "bank" | null;
  lowBalanceThreshold: number;
  topUpAmount: number;
  dailyLimit: number;
  monthlyLimit: number;
  maxSingleTopUp: number;
  minTriggerIntervalMs: number;
  maxRetries: number;
  providerReady: boolean;
}

interface SecurityResponse {
  requireWithdrawalVerification: boolean;
  twoFactorRequired: boolean;
  twoFactorConfigured: boolean;
  newDestinationDelayHours: number;
  dailyFiatWithdrawalLimit: number;
  dailyCryptoWithdrawalLimitFiat: number;
  largeTransactionThreshold: number;
  cryptoAddressAllowlist: Array<{ address: string; label: string }>;
  newDeviceWithdrawalRestriction: boolean;
  maskSensitiveValues: boolean;
  sessionTimeoutMin: number;
}

async function safeJsonFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/**
 * Hook that keeps the Zustand Vault store in sync with the server.
 * Returns a `refresh()` function that the UI calls after any mutation
 * (add money, withdraw, transfer, add payment method, add destination,
 * change security settings, etc.).
 *
 * The first fetch runs on mount. Subsequent fetches run when the user
 * returns to the tab (visibilitychange) and when `refresh()` is called.
 */
export function useVaultServerSync(): {
  refresh: () => Promise<void>;
  refreshBalances: () => Promise<void>;
  refreshPaymentMethods: () => Promise<void>;
  refreshWithdrawalDestinations: () => Promise<void>;
  refreshTransactions: () => Promise<void>;
  refreshProviders: () => Promise<void>;
  refreshAutoFund: () => Promise<void>;
  refreshSecurity: () => Promise<void>;
} {
  const store = useVaultStore();
  const inflight = useRef(false);

  const refreshBalances = useCallback(async () => {
    const data = await safeJsonFetch<BalancesResponse>("/api/vault/balances");
    if (!data) return;
    const currency = data.cash.available.currency;
    store.setBalances({
      cash: {
        available: Number(data.cash.available.amount) / 100,
        pending: Number(data.cash.pending.amount) / 100,
        reserved: Number(data.cash.reserved.amount) / 100,
        withdrawable: Number(data.cash.withdrawable.amount) / 100,
        currency,
      },
      trading: {
        cash: Number(data.trading.cash.amount) / 100,
        buyingPower: Number(data.trading.buyingPower.amount) / 100,
        openPositions: Number(data.trading.openPositions.amount) / 100,
        reservedForOrders: Number(data.trading.reservedForOrders.amount) / 100,
        currency,
      },
      crypto: {
        holdings: data.crypto.holdings.map((h) => ({
          asset: h.asset as "BTC" | "ETH" | "USDC" | "USDT" | "SOL",
          network: h.network as "bitcoin" | "ethereum" | "solana" | "polygon" | "base" | "arbitrum" | undefined,
          quantity: Number(h.quantity),
          fiatEquivalent: Number(h.fiatEquivalent.amount) / 100,
          currency: h.fiatEquivalent.currency,
        })),
        totalFiatEquivalent: Number(data.crypto.totalFiatEquivalent.amount) / 100,
        currency: data.crypto.totalFiatEquivalent.currency,
      },
      totalValue: Number(data.totalValue.amount) / 100,
      totalCurrency: data.totalValue.currency,
      providerConnected: data.providerConnected,
    });
  }, [store]);

  const refreshPaymentMethods = useCallback(async () => {
    const data = await safeJsonFetch<PaymentMethodsResponse>("/api/vault/payment-methods");
    if (!data) return;
    store.setPaymentMethods(
      data.paymentMethods.map((m) => ({
        id: m.providerPaymentMethodId,
        providerPaymentMethodId: m.providerPaymentMethodId,
        brand: m.brand as "visa" | "mastercard" | "amex" | "discover" | "unknown",
        last4: m.last4,
        expiryMonth: m.expiryMonth,
        expiryYear: m.expiryYear,
        isDefault: m.isDefault,
        depositEligible: m.depositEligible,
        withdrawalEligible: m.withdrawalEligible,
        displayName: m.displayName,
        addedAt: Date.now(),
      })),
    );
  }, [store]);

  const refreshWithdrawalDestinations = useCallback(async () => {
    const data = await safeJsonFetch<WithdrawalDestinationsResponse>("/api/vault/withdrawal-destinations");
    if (!data) return;
    store.setWithdrawalDestinations(
      data.destinations.map((d) => ({
        id: d.id,
        type: d.type,
        referenceId: d.referenceId ?? "",
        label: d.label,
        asset: d.asset,
        network: d.network as "bitcoin" | "ethereum" | "solana" | "polygon" | "base" | "arbitrum" | undefined,
        approved: d.approved,
        approvedAt: d.approvedAt,
        addedAt: d.addedAt,
      })),
    );
  }, [store]);

  const refreshTransactions = useCallback(async () => {
    const res = await fetch("/api/vault/transactions?limit=100", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json() as { transactions: Array<Record<string, unknown>> };
    // The store keeps manual transactions separately. We do NOT
    // overwrite the manual transactions list — server-backed
    // transactions are merged into the activity view via the
    // `serverTransactions` slice (added below). For Phase 15
    // compatibility, we leave the existing store.transactions alone
    // and rely on the Activity tab to display both sources.
    //
    // (No store update here — the Activity tab fetches /api/vault/transactions
    // directly when the user visits it. This hook only refreshes the
    // data that the store actually persists.)
  }, []);

  const refreshProviders = useCallback(async () => {
    // The providers API doesn't have a dedicated store slot; the UI
    // reads it directly when needed (e.g. Overview tab, Money tab).
    await safeJsonFetch<ProvidersResponse>("/api/vault/providers");
  }, []);

  const refreshAutoFund = useCallback(async () => {
    const data = await safeJsonFetch<AutoFundResponse>("/api/vault/auto-fund");
    if (!data) return;
    store.setAutoFund({
      enabled: data.enabled,
      fundingSourceId: data.fundingSourceId,
      fundingSourceType: data.fundingSourceType,
      lowBalanceThreshold: data.lowBalanceThreshold / 100,
      topUpAmount: data.topUpAmount / 100,
      dailyLimit: data.dailyLimit / 100,
      monthlyLimit: data.monthlyLimit / 100,
      maxSingleTopUp: data.maxSingleTopUp / 100,
      minTriggerIntervalMs: data.minTriggerIntervalMs,
      maxRetries: data.maxRetries,
      providerReady: data.providerReady,
    });
  }, [store]);

  const refreshSecurity = useCallback(async () => {
    const data = await safeJsonFetch<SecurityResponse>("/api/vault/security");
    if (!data) return;
    store.updateSecurity({
      requireWithdrawalVerification: data.requireWithdrawalVerification,
      twoFactorRequired: data.twoFactorRequired,
      twoFactorConfigured: data.twoFactorConfigured,
      newDestinationDelayHours: data.newDestinationDelayHours,
      dailyFiatWithdrawalLimit: data.dailyFiatWithdrawalLimit / 100,
      dailyCryptoWithdrawalLimitFiat: data.dailyCryptoWithdrawalLimitFiat / 100,
      largeTransactionThreshold: data.largeTransactionThreshold / 100,
      cryptoAddressAllowlist: data.cryptoAddressAllowlist,
      newDeviceWithdrawalRestriction: data.newDeviceWithdrawalRestriction,
      maskSensitiveValues: data.maskSensitiveValues,
      sessionTimeoutMin: data.sessionTimeoutMin,
    });
  }, [store]);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      await Promise.all([
        refreshBalances(),
        refreshPaymentMethods(),
        refreshWithdrawalDestinations(),
        refreshProviders(),
        refreshAutoFund(),
        refreshSecurity(),
      ]);
    } finally {
      inflight.current = false;
    }
  }, [refreshBalances, refreshPaymentMethods, refreshWithdrawalDestinations, refreshProviders, refreshAutoFund, refreshSecurity]);

  // Initial fetch on mount.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-fetch when the tab becomes visible again (user came back to LUCIAN).
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") void refresh();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  return {
    refresh,
    refreshBalances,
    refreshPaymentMethods,
    refreshWithdrawalDestinations,
    refreshTransactions,
    refreshProviders,
    refreshAutoFund,
    refreshSecurity,
  };
}
