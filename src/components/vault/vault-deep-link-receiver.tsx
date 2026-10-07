"use client";

import { useEffect, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useVaultStore, type VaultTab } from "@/store/vault";

/**
 * Vault deep-link receiver — Real-Money Foundation.
 *
 * Supported deep links:
 *
 *   /vault?tab=accounts&account=<id>
 *     → opens the Accounts tab AND selects the exact account detail view
 *
 *   /vault?tab=activity&transaction=<id>
 *     → opens the Activity tab and highlights the target transaction
 *
 *   /vault?tab=<overview|money|accounts|balances|transfers|activity|assets|security>
 *     → opens the named tab with no further selection
 *
 * Privacy:
 *   - If the Vault is locked, the receiver does NOT unlock it. It just
 *     remembers the requested tab/account/transaction so that when the
 *     user unlocks, the destination appears.
 *
 * URL cleanup:
 *   - One-shot params (`account`, `transaction`) are stripped after being
 *     consumed, using router.replace so back/forward still work.
 *   - `tab` is left in place if the receiver set it.
 */
export function VaultDeepLinkReceiver({
  onTab,
  onSelectAccount,
  onHighlightTransaction,
}: {
  onTab: (t: VaultTab) => void;
  onSelectAccount: (id: string) => void;
  onHighlightTransaction: (id: string) => void;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const consumedAccountRef = useRef<string | null>(null);
  const consumedTxRef = useRef<string | null>(null);

  const locked = useVaultStore((s) => s.locked);
  const accounts = useVaultStore((s) => s.accounts);
  const transactions = useVaultStore((s) => s.transactions);

  useEffect(() => {
    if (locked) return;

    const tab = searchParams.get("tab") as VaultTab | null;
    const accountId = searchParams.get("account");
    const transactionId = searchParams.get("transaction");

    const VALID_TABS: VaultTab[] = [
      "overview", "money", "accounts", "balances", "transfers",
      "activity", "assets", "security",
    ];
    if (tab && VALID_TABS.includes(tab)) {
      onTab(tab);
    }

    if (accountId && consumedAccountRef.current !== accountId) {
      const acc = accounts.find((a) => a.id === accountId);
      if (acc) {
        consumedAccountRef.current = accountId;
        onSelectAccount(accountId);
      }
    }

    if (transactionId && consumedTxRef.current !== transactionId) {
      const tx = transactions.find((t) => t.id === transactionId);
      if (tx) {
        consumedTxRef.current = transactionId;
        onHighlightTransaction(transactionId);
      }
    }

    const next = new URLSearchParams(searchParams.toString());
    let changed = false;
    if (accountId && consumedAccountRef.current === accountId) {
      next.delete("account");
      changed = true;
    }
    if (transactionId && consumedTxRef.current === transactionId) {
      next.delete("transaction");
      changed = true;
    }
    if (changed) {
      const qs = next.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      router.replace(url);
    }
  }, [
    searchParams, router, pathname, locked, accounts, transactions,
    onTab, onSelectAccount, onHighlightTransaction,
  ]);

  return null;
}
