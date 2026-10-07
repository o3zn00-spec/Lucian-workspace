"use client";

// Vault Balances tab — real financial balance hierarchy.
//
// CASH       — Available / Pending / Reserved / Withdrawable
// TRADING    — Cash / Buying Power / Open Positions / Reserved for Orders
// CRYPTO     — BTC / ETH / USDC / etc. (quantity separated from fiat equivalent)
//
// Crypto value is NEVER added into Available Cash.
// It may contribute to Total Value, but cash and crypto remain distinct.

import { Banknote, TrendingUp, Bitcoin, AlertCircle } from "lucide-react";
import { useVaultStore, formatMoney, formatCrypto } from "@/store/vault";
import { VaultCard, VaultCardHeader, VaultCardBody, VaultStat, ProviderNotConnectedBanner, VaultEmptyState } from "../primitives";

export function BalancesTab({
  hideBalances,
  maskSensitive,
}: {
  hideBalances: boolean;
  maskSensitive: boolean;
}) {
  const store = useVaultStore();
  const balances = store.balances;
  const cash = balances.cash;
  const trading = balances.trading;
  const crypto = balances.crypto;
  const providerConnected = balances.providerConnected;

  function fmt(amount: number, currency: string): string {
    if (hideBalances) return "••••••";
    if (maskSensitive) return maskNum(amount);
    return formatMoney(amount, currency);
  }

  return (
    <div className="space-y-5">
      {!providerConnected && <ProviderNotConnectedBanner />}

      {/* CASH */}
      <VaultCard>
        <VaultCardHeader
          title="Cash"
          subtitle="Fiat balances · Provider-derived when connected"
          icon={<Banknote className="h-4 w-4" />}
        />
        <VaultCardBody>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <VaultStat label="Available" value={fmt(cash.available, cash.currency)} />
            <VaultStat label="Pending" value={fmt(cash.pending, cash.currency)} muted />
            <VaultStat label="Reserved" value={fmt(cash.reserved, cash.currency)} muted />
            <VaultStat label="Withdrawable" value={fmt(cash.withdrawable, cash.currency)} />
          </div>
          <div className="mt-4 flex items-start gap-1.5 rounded border border-line-muted bg-inset/40 p-2.5">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-fg-faint" />
            <p className="text-[10.5px] leading-relaxed text-fg-muted">
              <span className="font-semibold">Pending</span> funds have been initiated but not yet settled by the provider.
              <span className="font-semibold"> Reserved</span> funds are locked for open orders or holds.
              <span className="font-semibold"> Withdrawable</span> is what can actually be moved out.
            </p>
          </div>
        </VaultCardBody>
      </VaultCard>

      {/* TRADING */}
      <VaultCard>
        <VaultCardHeader
          title="Trading"
          subtitle="Brokerage / virtual trading balances"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <VaultCardBody>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <VaultStat label="Cash" value={fmt(trading.cash, trading.currency)} />
            <VaultStat label="Buying Power" value={fmt(trading.buyingPower, trading.currency)} />
            <VaultStat label="Open Positions" value={fmt(trading.openPositions, trading.currency)} muted />
            <VaultStat label="Reserved for Orders" value={fmt(trading.reservedForOrders, trading.currency)} muted />
          </div>
        </VaultCardBody>
      </VaultCard>

      {/* CRYPTO */}
      <VaultCard>
        <VaultCardHeader
          title="Crypto"
          subtitle="Crypto holdings · Quantity separated from fiat equivalent"
          icon={<Bitcoin className="h-4 w-4" />}
        />
        <VaultCardBody>
          {crypto.holdings.length === 0 ? (
            <VaultEmptyState
              title="No crypto holdings"
              description="Crypto balances appear here when a crypto provider is connected. Crypto value is never added to Available Cash."
            />
          ) : (
            <>
              <div className="space-y-2">
                {crypto.holdings.map((h) => (
                  <div
                    key={`${h.asset}-${h.currency}`}
                    className="flex items-center justify-between rounded-md border border-line-muted bg-surface p-3 themed"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-inset text-fg-muted">
                        <Bitcoin className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-[12.5px] font-medium text-fg">{h.asset}</div>
                        <div className="font-mono text-[12px] text-fg-muted">{formatCrypto(h.quantity, h.asset)}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[13px] font-semibold text-fg">
                        ≈ {fmt(h.fiatEquivalent, h.currency)}
                      </div>
                      <div className="text-[10px] text-fg-faint">{h.currency}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-line-muted pt-3">
                <span className="text-[11px] uppercase tracking-wider text-fg-faint">Total Crypto Value</span>
                <span className="font-mono text-[14px] font-semibold text-fg">
                  {fmt(crypto.totalFiatEquivalent, crypto.currency)}
                </span>
              </div>
            </>
          )}
          <div className="mt-4 flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 p-2.5">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
            <p className="text-[10.5px] leading-relaxed text-amber-200/80">
              Crypto value contributes to <span className="font-semibold">Total Value</span> but is never merged into <span className="font-semibold">Available Cash</span>. Cash and crypto remain distinct.
            </p>
          </div>
        </VaultCardBody>
      </VaultCard>

      {/* Total Value */}
      <VaultCard>
        <VaultCardHeader title="Total Value" subtitle="Cash + Trading + Crypto (fiat equivalent)" />
        <VaultCardBody>
          <div className="font-mono text-[28px] font-bold tracking-tight text-fg">
            {fmt(balances.totalValue, balances.totalCurrency)}
          </div>
          <div className="mt-2 text-[10.5px] text-fg-muted">
            Cash {fmt(cash.available + cash.pending + cash.reserved, cash.currency)} · Trading {fmt(trading.cash + trading.openPositions, trading.currency)} · Crypto {fmt(crypto.totalFiatEquivalent, crypto.currency)}
          </div>
        </VaultCardBody>
      </VaultCard>
    </div>
  );
}

function maskNum(amount: number): string {
  if (amount === 0) return "$0.00";
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(amount))));
  return `$${(amount / magnitude).toFixed(1)}K+`;
}
