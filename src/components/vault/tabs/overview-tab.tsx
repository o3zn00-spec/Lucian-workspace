"use client";

// Vault Overview — the top-of-Vault financial summary.
//
// Hierarchy:
//   VAULT
//   TOTAL VALUE  $XX,XXX.XX
//   Available    $XX   Pending     $XX
//   Reserved     $XX   Withdrawable $XX
//   Trading      $XX   Crypto      $XX
//   [ Add Money ] [ Withdraw ] [ Transfer ]
//
//   CAPITAL ALLOCATION (Budget Allocations — NOT real transfers)
//   CONNECTED ACCOUNTS
//   RECENT ACTIVITY

import {
  ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, ChevronRight,
  Wallet, Landmark, Bitcoin, TrendingUp, Clock, Lock, Shield,
} from "lucide-react";
import { useVaultStore, formatMoney, type VaultTab } from "@/store/vault";
import { VaultCard, VaultCardHeader, VaultCardBody, VaultStat, SourceBadge, StatusPill, ProviderNotConnectedBanner, VaultEmptyState } from "../primitives";
import { Button } from "@/components/ui-devspace/button";
import { cn } from "@/lib/utils";

export function OverviewTab({
  hideBalances,
  maskSensitive,
  onAddMoney,
  onWithdraw,
  onTransfer,
  onNavigate,
}: {
  hideBalances: boolean;
  maskSensitive: boolean;
  onAddMoney: () => void;
  onWithdraw: () => void;
  onTransfer: () => void;
  onNavigate: (tab: VaultTab) => void;
}) {
  const store = useVaultStore();
  const balances = store.balances;
  const currency = balances.totalCurrency;
  const totalValue = balances.totalValue;
  const cash = balances.cash;
  const trading = balances.trading;
  const crypto = balances.crypto;
  const totalAllocated = store.getAllocatedCapital();
  const providerConnected = balances.providerConnected;
  const recentActivity = store.transactions.slice(0, 5);
  const connectedAccounts = store.accounts;

  const displayValue = hideBalances ? "••••••" : maskSensitive ? maskNum(totalValue) : formatMoney(totalValue, currency);

  return (
    <div className="space-y-5">
      {/* Total Value hero card */}
      <VaultCard>
        <VaultCardBody className="p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-faint">Total Value</div>
              <div className="mt-1 font-mono text-[34px] font-bold tracking-tight text-fg sm:text-[40px]">
                {displayValue}
              </div>
              {!providerConnected && (
                <div className="mt-2">
                  <ProviderNotConnectedBanner />
                </div>
              )}

              {/* Balance grid */}
              <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                <VaultStat label="Available" value={fmt(cash.available, currency, hideBalances, maskSensitive)} />
                <VaultStat label="Pending" value={fmt(cash.pending, currency, hideBalances, maskSensitive)} muted />
                <VaultStat label="Reserved" value={fmt(cash.reserved, currency, hideBalances, maskSensitive)} muted />
                <VaultStat label="Withdrawable" value={fmt(cash.withdrawable, currency, hideBalances, maskSensitive)} />
                <VaultStat label="Trading" value={fmt(trading.cash + trading.openPositions, currency, hideBalances, maskSensitive)} />
                <VaultStat label="Crypto" value={fmt(crypto.totalFiatEquivalent, currency, hideBalances, maskSensitive)} />
              </div>
            </div>

            {/* Primary actions */}
            <div className="flex shrink-0 flex-col gap-2 sm:w-[180px]">
              <Button onClick={onAddMoney} className="justify-start">
                <ArrowDownToLine className="h-4 w-4" />
                Add Money
              </Button>
              <Button variant="outline" onClick={onWithdraw} className="justify-start border-line-muted">
                <ArrowUpFromLine className="h-4 w-4" />
                Withdraw
              </Button>
              <Button variant="outline" onClick={onTransfer} className="justify-start border-line-muted">
                <ArrowLeftRight className="h-4 w-4" />
                Transfer
              </Button>
            </div>
          </div>
        </VaultCardBody>
      </VaultCard>

      {/* Capital Allocation */}
      <VaultCard>
        <VaultCardHeader
          title="Capital Allocation"
          subtitle="Budget allocations · Internal LUCIAN bookkeeping (not real transfers)"
          icon={<Wallet className="h-4 w-4" />}
          action={
            <Button variant="ghost" size="sm" onClick={() => onNavigate("transfers")}>
              Manage
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          }
        />
        <VaultCardBody>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {store.allocations.map((pool) => (
              <AllocationRow
                key={pool.id}
                label={pool.label}
                amount={pool.allocated}
                currency={currency}
                cap={pool.cap}
                hideBalances={hideBalances}
                maskSensitive={maskSensitive}
              />
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-line-muted pt-3">
            <span className="text-[11px] uppercase tracking-wider text-fg-faint">Total Allocated</span>
            <span className="font-mono text-[13px] font-semibold text-fg">
              {fmt(totalAllocated, currency, hideBalances, maskSensitive)}
            </span>
          </div>
        </VaultCardBody>
      </VaultCard>

      {/* Connected Accounts */}
      <VaultCard>
        <VaultCardHeader
          title="Connected Accounts"
          subtitle={`${connectedAccounts.length} account${connectedAccounts.length !== 1 ? "s" : ""}`}
          icon={<Landmark className="h-4 w-4" />}
          action={
            <Button variant="ghost" size="sm" onClick={() => onNavigate("accounts")}>
              View All
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          }
        />
        <VaultCardBody>
          {connectedAccounts.length === 0 ? (
            <VaultEmptyState
              title="No accounts yet"
              description="Add a manual account or connect a provider to see your accounts here."
              action={<Button size="sm" onClick={() => onNavigate("accounts")}><ChevronRight className="h-3.5 w-3.5" />Go to Accounts</Button>}
            />
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {connectedAccounts.slice(0, 6).map((acc) => (
                <button
                  key={acc.id}
                  onClick={() => onNavigate("accounts")}
                  className="flex items-center gap-3 rounded-md border border-line-muted bg-surface p-3 text-left transition-colors hover:bg-hover-bg themed"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-inset text-fg-muted">
                    {acc.type === "bank" && <Landmark className="h-4 w-4" />}
                    {acc.type === "card" && <Wallet className="h-4 w-4" />}
                    {acc.type === "crypto-wallet" && <Bitcoin className="h-4 w-4" />}
                    {acc.type === "brokerage" && <TrendingUp className="h-4 w-4" />}
                    {acc.type === "trading" && <TrendingUp className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-fg truncate">{acc.label}</div>
                    <div className="text-[10.5px] text-fg-muted">•••• {acc.maskedIdentifier}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[12px] font-semibold text-fg">
                      {fmt(acc.balance, acc.currency, hideBalances, maskSensitive)}
                    </div>
                    <div className="mt-0.5"><SourceBadge source={acc.source} /></div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </VaultCardBody>
      </VaultCard>

      {/* Recent Activity */}
      <VaultCard>
        <VaultCardHeader
          title="Recent Activity"
          subtitle="Unified financial ledger"
          icon={<Clock className="h-4 w-4" />}
          action={
            <Button variant="ghost" size="sm" onClick={() => onNavigate("activity")}>
              View All
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          }
        />
        <VaultCardBody>
          {recentActivity.length === 0 ? (
            <VaultEmptyState
              title="No activity yet"
              description="Deposit, withdraw, transfer, or trade to see activity here."
            />
          ) : (
            <div className="divide-y divide-line-muted">
              {recentActivity.map((tx) => {
                const positive = tx.type.includes("deposit") || tx.type === "local-transfer" && tx.amount > 0;
                return (
                  <div key={tx.id} className="flex items-center gap-3 py-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded bg-inset text-fg-muted">
                      <ActivityIcon type={tx.type} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-fg truncate">{tx.description}</div>
                      <div className="text-[10.5px] text-fg-muted">{new Date(tx.timestamp).toLocaleString()}</div>
                    </div>
                    <div className="text-right">
                      <div className={cn(
                        "font-mono text-[12px] font-semibold",
                        positive ? "text-emerald-400" : "text-fg",
                      )}>
                        {positive ? "+" : "-"}{formatMoney(tx.amount, tx.currency)}
                      </div>
                      <div className="mt-0.5"><StatusPill status={tx.status} /></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </VaultCardBody>
      </VaultCard>
    </div>
  );
}

function AllocationRow({
  label,
  amount,
  currency,
  cap,
  hideBalances,
  maskSensitive,
}: {
  label: string;
  amount: number;
  currency: string;
  cap: number;
  hideBalances: boolean;
  maskSensitive: boolean;
}) {
  const pct = cap > 0 ? Math.min(100, (amount / cap) * 100) : 0;
  return (
    <div className="rounded-md border border-line-muted bg-surface p-3 themed">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-fg">{label}</span>
        <span className="font-mono text-[12px] font-semibold text-fg">
          {fmt(amount, currency, hideBalances, maskSensitive)}
        </span>
      </div>
      {cap > 0 && (
        <div className="mt-2">
          <div className="h-1 overflow-hidden rounded-full bg-inset">
            <div
              className="h-full bg-[var(--accent)] transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 text-[9.5px] text-fg-faint">{pct.toFixed(0)}% of {formatMoney(cap, currency)} cap</div>
        </div>
      )}
    </div>
  );
}

function ActivityIcon({ type }: { type: string }) {
  if (type.includes("deposit")) return <ArrowDownToLine className="h-4 w-4" />;
  if (type.includes("withdrawal")) return <ArrowUpFromLine className="h-4 w-4" />;
  if (type.includes("transfer")) return <ArrowLeftRight className="h-4 w-4" />;
  if (type.includes("allocation")) return <Wallet className="h-4 w-4" />;
  if (type.includes("trade")) return <TrendingUp className="h-4 w-4" />;
  if (type.includes("security")) return <Shield className="h-4 w-4" />;
  return <Clock className="h-4 w-4" />;
}

function fmt(amount: number, currency: string, hide: boolean, mask: boolean): string {
  if (hide) return "••••••";
  if (mask) return maskNum(amount);
  return formatMoney(amount, currency);
}

function maskNum(amount: number): string {
  if (amount === 0) return "$0.00";
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(amount))));
  return `$${(amount / magnitude).toFixed(1)}K+`;
}
