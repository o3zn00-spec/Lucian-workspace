"use client";

// LUCIAN Vault — Server-sync context.
//
// Allows deep sub-components (e.g. AddCardButton, AddDestinationButton,
// AutoFundSection, SecurityTab) to trigger a server refresh without
// prop drilling. The VaultDashboard sets up the context once and any
// child can call `useVaultSync()` to get a `refresh()` function.
//
// This is OPTIONAL for sub-components — the dashboard's mount-time
// and visibility-change fetches already keep the store reasonably
// fresh. Sub-components only need to call `refresh()` after a
// successful mutation to make the new state visible immediately.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useVaultServerSync } from "@/hooks/use-vault-server-sync";

type RefreshFn = () => Promise<void>;

const VaultSyncContext = createContext<{
  refresh: RefreshFn;
  refreshBalances: RefreshFn;
  refreshPaymentMethods: RefreshFn;
  refreshWithdrawalDestinations: RefreshFn;
  refreshTransactions: RefreshFn;
  refreshProviders: RefreshFn;
  refreshAutoFund: RefreshFn;
  refreshSecurity: RefreshFn;
} | null>(null);

export function VaultSyncProvider({ children }: { children: ReactNode }) {
  const sync = useVaultServerSync();
  const value = useMemo(() => ({
    refresh: sync.refresh,
    refreshBalances: sync.refreshBalances,
    refreshPaymentMethods: sync.refreshPaymentMethods,
    refreshWithdrawalDestinations: sync.refreshWithdrawalDestinations,
    refreshTransactions: sync.refreshTransactions,
    refreshProviders: sync.refreshProviders,
    refreshAutoFund: sync.refreshAutoFund,
    refreshSecurity: sync.refreshSecurity,
  }), [
    sync.refresh,
    sync.refreshBalances,
    sync.refreshPaymentMethods,
    sync.refreshWithdrawalDestinations,
    sync.refreshTransactions,
    sync.refreshProviders,
    sync.refreshAutoFund,
    sync.refreshSecurity,
  ]);
  return (
    <VaultSyncContext.Provider value={value}>
      {children}
    </VaultSyncContext.Provider>
  );
}

/**
 * Get the server-sync refresh functions. Returns a no-op if used
 * outside of <VaultSyncProvider> — so sub-components are safe to call
 * `useVaultSync().refresh()` without checking.
 */
export function useVaultSync() {
  const ctx = useContext(VaultSyncContext);
  if (!ctx) {
    // No provider — return no-op refreshers so sub-components don't crash.
    const noop: RefreshFn = async () => {};
    return {
      refresh: noop,
      refreshBalances: noop,
      refreshPaymentMethods: noop,
      refreshWithdrawalDestinations: noop,
      refreshTransactions: noop,
      refreshProviders: noop,
      refreshAutoFund: noop,
      refreshSecurity: noop,
    };
  }
  return ctx;
}
