"use client";

/* eslint-disable react-hooks/set-state-in-effect */

// LUCIAN Vault — Real-Money Foundation.
//
// The Control Layer for LUCIAN's financial center.
// Provider-verified money is server-derived. Manual money is clearly labeled.
// No fake balances, no fake transactions, no fake provider connections.

import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { VaultDeepLinkReceiver } from "@/components/vault/vault-deep-link-receiver";
import { AddMoneyModal } from "@/components/vault/add-money-modal";
import { WithdrawModal } from "@/components/vault/withdraw-modal";
import { OverviewTab } from "@/components/vault/tabs/overview-tab";
import { MoneyTab } from "@/components/vault/tabs/money-tab";
import { AccountsTab } from "@/components/vault/tabs/accounts-tab";
import { BalancesTab } from "@/components/vault/tabs/balances-tab";
import { TransfersTab } from "@/components/vault/tabs/transfers-tab";
import { ActivityTab } from "@/components/vault/tabs/activity-tab";
import { AssetsTab } from "@/components/vault/tabs/assets-tab";
import { SecurityTab } from "@/components/vault/tabs/security-tab";
import {
  Plus, Eye, EyeOff, Settings as SettingsIcon, Lock, Unlock,
  ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight,
  LayoutGrid, Wallet, Landmark, Scale, Activity as ActivityIcon,
  Boxes, Shield,
} from "lucide-react";
import { useVaultStore, type VaultTab } from "@/store/vault";
import { useVaultServerSync } from "@/hooks/use-vault-server-sync";
import { VaultSyncProvider } from "@/components/vault/vault-sync-context";
import { Button } from "@/components/ui-devspace/button";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const TABS: { id: VaultTab; label: string; icon: typeof Plus }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "money", label: "Money", icon: Wallet },
  { id: "accounts", label: "Accounts", icon: Landmark },
  { id: "balances", label: "Balances", icon: Scale },
  { id: "transfers", label: "Transfers", icon: ArrowLeftRight },
  { id: "activity", label: "Activity", icon: ActivityIcon },
  { id: "assets", label: "Assets", icon: Boxes },
  { id: "security", label: "Security", icon: Shield },
];

export function VaultDashboard() {
  const store = useVaultStore();
  const serverSync = useVaultServerSync();
  const [tab, setTab] = useState<VaultTab>(store.settings.defaultView);
  const [addMoneyOpen, setAddMoneyOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [highlightTxId, setHighlightTxId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Mark hydrated after mount (avoids SSR/client mismatch)
  useEffect(() => {
    setHydrated(true);
  }, []);


  // Session timeout
  useEffect(() => {
    if (store.locked || !hydrated) return;
    const interval = setInterval(() => {
      const elapsed = Date.now() - store.lastActivityAt;
      const timeoutMs = store.settings.security.sessionTimeoutMin * 60 * 1000;
      if (elapsed > timeoutMs && !store.locked) {
        store.lockVault();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [store.locked, store.lastActivityAt, store.settings.security.sessionTimeoutMin, hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleActivity = useCallback(() => {
    store.touchActivity();
  }, [store]);

  const hideBalances = store.settings.hideBalances;
  const maskSensitive = store.settings.security.maskSensitiveValues;

  // Vault locked overlay
  if (store.locked && hydrated) {
    return (
      <div className="themed flex h-full items-center justify-center bg-canvas text-fg">
        <div className="max-w-sm rounded-lg border border-line-muted bg-surface p-6 text-center">
          <Lock className="mx-auto h-10 w-10 text-fg-faint" />
          <h2 className="mt-3 text-[15px] font-semibold text-fg">Vault Locked</h2>
          <p className="mt-1 text-[11px] text-fg-muted">
            Local privacy lock. Vault data stored in this browser is not encrypted by this lock.
          </p>
          <Button className="mt-4" onClick={() => store.unlockVault()}>
            <Unlock className="h-4 w-4" />
            Unlock
          </Button>
        </div>
      </div>
    );
  }

  return (
    <VaultSyncProvider>
      <div className="themed flex h-full min-h-0 flex-col bg-canvas text-fg" onClick={handleActivity}>
        <Suspense fallback={null}>
          <VaultDeepLinkReceiver
          onTab={(t) => setTab(t)}
          onSelectAccount={() => setTab("accounts")}
          onHighlightTransaction={(id) => {
            setTab("activity");
            setHighlightTxId(id);
            window.setTimeout(() => setHighlightTxId((cur) => (cur === id ? null : cur)), 5000);
          }}
        />
      </Suspense>

      {/* Header */}
      <div className="shrink-0 border-b border-line-muted px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-fg">Vault</h1>
            <p className="mt-0.5 text-[12px] text-fg-muted">
              Unified financial center · Provider-verified when connected
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => store.updateSettings({ hideBalances: !hideBalances })}>
              {hideBalances ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              <span className="ml-1.5 hidden sm:inline">{hideBalances ? "Show" : "Hide"}</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setTab("security")}>
              <SettingsIcon className="h-4 w-4" />
              <span className="ml-1.5 hidden sm:inline">Settings</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => store.lockVault()} title="Lock Vault">
              <Lock className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-3 flex flex-wrap gap-1 border-b border-line-muted/60">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-colors themed",
                  tab === t.id
                    ? "border-b-2 border-[var(--accent)] text-fg"
                    : "border-b-2 border-transparent text-fg-muted hover:text-fg",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          {tab === "overview" && (
            <OverviewTab
              hideBalances={hideBalances}
              maskSensitive={maskSensitive}
              onAddMoney={() => setAddMoneyOpen(true)}
              onWithdraw={() => setWithdrawOpen(true)}
              onTransfer={() => setTab("transfers")}
              onNavigate={setTab}
            />
          )}
          {tab === "money" && (
            <MoneyTab
              onAddMoney={() => setAddMoneyOpen(true)}
              onWithdraw={() => setWithdrawOpen(true)}
              onTransfer={() => setTab("transfers")}
            />
          )}
          {tab === "accounts" && <AccountsTab hideBalances={hideBalances} maskSensitive={maskSensitive} />}
          {tab === "balances" && <BalancesTab hideBalances={hideBalances} maskSensitive={maskSensitive} />}
          {tab === "transfers" && <TransfersTab />}
          {tab === "activity" && <ActivityTab highlightTxId={highlightTxId} />}
          {tab === "assets" && <AssetsTab hideBalances={hideBalances} maskSensitive={maskSensitive} />}
          {tab === "security" && <SecurityTab />}
        </div>
      </div>

      {/* Modals */}
      <AddMoneyModal
        open={addMoneyOpen}
        onClose={() => setAddMoneyOpen(false)}
        onComplete={() => { void serverSync.refresh(); }}
      />
      <WithdrawModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        onComplete={() => { void serverSync.refresh(); }}
      />
      </div>
    </VaultSyncProvider>
  );
}
