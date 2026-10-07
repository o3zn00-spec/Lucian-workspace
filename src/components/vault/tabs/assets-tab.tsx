"use client";

// Vault Assets tab — renamed from Holdings.
//
// Structure:
//   Cash
//   Investments (AAPL, NVDA, etc.)
//   Crypto (BTC, ETH, USDC)
//   Other Provider Holdings
//   Total Value

import { Banknote, TrendingUp, Bitcoin, Boxes, AlertCircle } from "lucide-react";
import { useVaultStore, formatMoney, formatCrypto } from "@/store/vault";
import { VaultCard, VaultCardHeader, VaultCardBody, VaultStat, ProviderNotConnectedBanner, VaultEmptyState } from "../primitives";

export function AssetsTab({
  hideBalances,
  maskSensitive,
}: {
  hideBalances: boolean;
  maskSensitive: boolean;
}) {
  const store = useVaultStore();
  const balances = store.balances;
  const providerConnected = balances.providerConnected;

  function fmt(amount: number, currency: string): string {
    if (hideBalances) return "••••••";
    if (maskSensitive) return maskNum(amount);
    return formatMoney(amount, currency);
  }

  return (
    <div className="space-y-5">
      {!providerConnected && <ProviderNotConnectedBanner />}

      {/* Cash */}
      <VaultCard>
        <VaultCardHeader
          title="Cash"
          subtitle="Fiat available across accounts"
          icon={<Banknote className="h-4 w-4" />}
        />
        <VaultCardBody>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <VaultStat label="Available" value={fmt(balances.cash.available, balances.cash.currency)} />
            <VaultStat label="Pending" value={fmt(balances.cash.pending, balances.cash.currency)} muted />
            <VaultStat label="Reserved" value={fmt(balances.cash.reserved, balances.cash.currency)} muted />
            <VaultStat label="Withdrawable" value={fmt(balances.cash.withdrawable, balances.cash.currency)} />
          </div>
        </VaultCardBody>
      </VaultCard>

      {/* Investments */}
      <VaultCard>
        <VaultCardHeader
          title="Investments"
          subtitle="Stock / ETF / options positions"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <VaultCardBody>
          {providerConnected && balances.trading.openPositions > 0 ? (
            <div className="space-y-2">
              {/* Would be populated from brokerage provider */}
              <div className="rounded-md border border-line-muted bg-surface p-3 themed">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-fg">Open Positions</span>
                  <span className="font-mono text-[13px] font-semibold text-fg">
                    {fmt(balances.trading.openPositions, balances.trading.currency)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <VaultEmptyState
              title="No investment positions"
              description="Brokerage positions appear here when a broker provider is connected. Real positions are server-derived, never client-fabricated."
              icon={<TrendingUp className="h-6 w-6" />}
            />
          )}
        </VaultCardBody>
      </VaultCard>

      {/* Crypto */}
      <VaultCard>
        <VaultCardHeader
          title="Crypto"
          subtitle="Crypto holdings"
          icon={<Bitcoin className="h-4 w-4" />}
        />
        <VaultCardBody>
          {balances.crypto.holdings.length === 0 ? (
            <VaultEmptyState
              title="No crypto holdings"
              description="Crypto holdings appear here when a crypto provider is connected."
              icon={<Bitcoin className="h-6 w-6" />}
            />
          ) : (
            <div className="space-y-2">
              {balances.crypto.holdings.map((h) => (
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
                      <div className="font-mono text-[11px] text-fg-muted">{formatCrypto(h.quantity, h.asset)}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-[13px] font-semibold text-fg">
                      ≈ {fmt(h.fiatEquivalent, h.currency)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </VaultCardBody>
      </VaultCard>

      {/* Other Provider Holdings */}
      <VaultCard>
        <VaultCardHeader
          title="Other Provider Holdings"
          subtitle="Additional holdings from connected providers"
          icon={<Boxes className="h-4 w-4" />}
        />
        <VaultCardBody>
          <VaultEmptyState
            title="No other holdings"
            description="Additional holdings (e.g. real estate tokens, alternative assets) from connected providers will appear here."
            icon={<Boxes className="h-6 w-6" />}
          />
        </VaultCardBody>
      </VaultCard>

      {/* Total Value */}
      <VaultCard>
        <VaultCardHeader title="Total Value" subtitle="Cash + Investments + Crypto + Other" />
        <VaultCardBody>
          <div className="font-mono text-[32px] font-bold tracking-tight text-fg">
            {fmt(balances.totalValue, balances.totalCurrency)}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <TotalRow label="Cash" value={fmt(balances.cash.available + balances.cash.pending + balances.cash.reserved, balances.cash.currency)} />
            <TotalRow label="Investments" value={fmt(balances.trading.openPositions, balances.trading.currency)} />
            <TotalRow label="Crypto" value={fmt(balances.crypto.totalFiatEquivalent, balances.crypto.currency)} />
          </div>
          <div className="mt-4 flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 p-2.5">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
            <p className="text-[10.5px] leading-relaxed text-amber-200/80">
              Crypto value contributes to <span className="font-semibold">Total Value</span> but is never merged into <span className="font-semibold">Available Cash</span>. Cash and crypto remain distinct.
            </p>
          </div>
        </VaultCardBody>
      </VaultCard>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line-muted bg-surface p-3 themed">
      <div className="text-[10px] uppercase tracking-wider text-fg-faint">{label}</div>
      <div className="mt-1 font-mono text-[13px] font-semibold text-fg">{value}</div>
    </div>
  );
}

function maskNum(amount: number): string {
  if (amount === 0) return "$0.00";
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(amount))));
  return `$${(amount / magnitude).toFixed(1)}K+`;
}
