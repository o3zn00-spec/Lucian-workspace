"use client";

// Vault Activity tab — unified financial ledger / timeline.
//
// Every entry supports:
//   - internal transaction ID
//   - provider transaction ID (when provider-backed)
//   - type, asset/currency, amount
//   - status, timestamp
//   - source, destination, provider
//   - metadata

import { useState, useMemo } from "react";
import {
  ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, Wallet,
  TrendingUp, Bitcoin, Shield, Clock, Search, Filter, ChevronDown,
} from "lucide-react";
import {
  useVaultStore, formatMoney, type VaultTransactionType, type VaultTransactionStatus,
} from "@/store/vault";
import { VaultCard, VaultCardHeader, VaultCardBody, StatusPill, VaultEmptyState } from "../primitives";
import { cn } from "@/lib/utils";

const TYPE_FILTERS: { id: VaultTransactionType | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "card-deposit", label: "Card Deposits" },
  { id: "bank-deposit", label: "Bank Deposits" },
  { id: "crypto-deposit", label: "Crypto Deposits" },
  { id: "bank-withdrawal", label: "Bank Withdrawals" },
  { id: "card-withdrawal", label: "Card Withdrawals" },
  { id: "crypto-withdrawal", label: "Crypto Withdrawals" },
  { id: "local-transfer", label: "Local Transfers" },
  { id: "internal-transfer", label: "Internal Transfers" },
  { id: "brokerage-trade", label: "Brokerage Trades" },
  { id: "auto-fund", label: "Auto Fund" },
  { id: "pool-allocation", label: "Budget Allocations" },
];

export function ActivityTab({ highlightTxId }: { highlightTxId: string | null }) {
  const store = useVaultStore();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<VaultTransactionType | "all">("all");
  const [showFilters, setShowFilters] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let txs = store.transactions;
    if (typeFilter !== "all") {
      txs = txs.filter((t) => t.type === typeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      txs = txs.filter((t) =>
        t.description.toLowerCase().includes(q) ||
        t.from.toLowerCase().includes(q) ||
        t.to.toLowerCase().includes(q) ||
        (t.providerTransactionId ?? "").toLowerCase().includes(q) ||
        (t.provider ?? "").toLowerCase().includes(q)
      );
    }
    return txs;
  }, [store.transactions, typeFilter, search]);

  return (
    <div className="space-y-4">
      <VaultCard>
        <VaultCardHeader
          title="Activity"
          subtitle="Unified financial ledger · All money movement"
          icon={<Clock className="h-4 w-4" />}
        />
        <VaultCardBody>
          {/* Search + filter */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search activity..."
                className="h-9 w-full rounded-md border border-line-muted bg-surface pl-9 pr-3 text-[12px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)] themed"
              />
            </div>
            <button
              onClick={() => setShowFilters((s) => !s)}
              className="flex items-center gap-1.5 rounded-md border border-line-muted bg-surface px-3 py-1.5 text-[12px] text-fg-muted hover:text-fg themed"
            >
              <Filter className="h-3.5 w-3.5" />
              {TYPE_FILTERS.find((f) => f.id === typeFilter)?.label}
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>

          {showFilters && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TYPE_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => { setTypeFilter(f.id); setShowFilters(false); }}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[10.5px] font-medium transition-colors themed",
                    typeFilter === f.id
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "border-line-muted bg-surface text-fg-muted hover:text-fg",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </VaultCardBody>
      </VaultCard>

      <VaultCard>
        <VaultCardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <VaultEmptyState
                title="No activity found"
                description={search || typeFilter !== "all"
                  ? "Try a different filter or search term."
                  : "Deposit, withdraw, transfer, or trade to see activity here."}
                icon={<Clock className="h-6 w-6" />}
              />
            </div>
          ) : (
            <div className="divide-y divide-line-muted">
              {filtered.map((tx) => (
                <div
                  key={tx.id}
                  className={cn(
                    "px-4 py-3 transition-colors themed sm:px-5",
                    highlightTxId === tx.id && "bg-[var(--accent)]/5",
                  )}
                >
                  <button
                    onClick={() => setExpandedId(expandedId === tx.id ? null : tx.id)}
                    className="flex w-full items-center gap-3 text-left"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-inset text-fg-muted">
                      <ActivityIcon type={tx.type} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12.5px] font-medium text-fg truncate">{tx.description}</span>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-fg-muted">
                        <span>{new Date(tx.timestamp).toLocaleString()}</span>
                        {tx.provider && <span>· {tx.provider}</span>}
                        {tx.asset && <span>· {tx.asset}</span>}
                        {tx.network && <span>· {tx.network}</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={cn(
                        "font-mono text-[13px] font-semibold",
                        tx.amount > 0 ? "text-emerald-400" : "text-fg",
                      )}>
                        {tx.amount > 0 ? "+" : tx.amount < 0 ? "" : ""}{formatMoney(Math.abs(tx.amount), tx.currency)}
                      </span>
                      <StatusPill status={tx.status} />
                    </div>
                  </button>

                  {expandedId === tx.id && (
                    <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 rounded-md border border-line-muted bg-inset/40 p-3 text-[11px] sm:grid-cols-2 lg:grid-cols-3 themed">
                      <DetailField label="Internal Tx ID" value={tx.id} mono />
                      <DetailField label="Type" value={tx.type} />
                      <DetailField label="Status" value={tx.status} />
                      <DetailField label="Amount" value={formatMoney(tx.amount, tx.currency)} mono />
                      <DetailField label="Currency" value={tx.currency} />
                      <DetailField label="Timestamp" value={new Date(tx.timestamp).toISOString()} mono />
                      <DetailField label="From" value={tx.from} />
                      <DetailField label="To" value={tx.to} />
                      {tx.providerTransactionId && (
                        <DetailField label="Provider Tx ID" value={tx.providerTransactionId} mono />
                      )}
                      {tx.provider && (
                        <DetailField label="Provider" value={tx.provider} />
                      )}
                      {tx.asset && <DetailField label="Asset" value={tx.asset} />}
                      {tx.network && <DetailField label="Network" value={tx.network} />}
                      {tx.source && <DetailField label="Source" value={tx.source} />}
                      {tx.destination && <DetailField label="Destination" value={tx.destination} />}
                      {tx.metadata && Object.keys(tx.metadata).length > 0 && (
                        <DetailField label="Metadata" value={JSON.stringify(tx.metadata)} mono />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </VaultCardBody>
      </VaultCard>
    </div>
  );
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-wider text-fg-faint">{label}</div>
      <div className={cn("mt-0.5 text-fg break-all", mono && "font-mono text-[10.5px]")}>{value}</div>
    </div>
  );
}

function ActivityIcon({ type }: { type: string }) {
  if (type.includes("deposit")) return <ArrowDownToLine className="h-4 w-4" />;
  if (type.includes("withdrawal")) return <ArrowUpFromLine className="h-4 w-4" />;
  if (type.includes("transfer")) return <ArrowLeftRight className="h-4 w-4" />;
  if (type.includes("allocation")) return <Wallet className="h-4 w-4" />;
  if (type.includes("trade") || type.includes("brokerage")) return <TrendingUp className="h-4 w-4" />;
  if (type.includes("crypto")) return <Bitcoin className="h-4 w-4" />;
  if (type.includes("security")) return <Shield className="h-4 w-4" />;
  if (type.includes("auto-fund")) return <ArrowDownToLine className="h-4 w-4" />;
  return <Clock className="h-4 w-4" />;
}
