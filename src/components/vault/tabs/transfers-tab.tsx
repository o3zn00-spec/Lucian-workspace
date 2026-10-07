"use client";

// Vault Transfers tab — clearly distinguishes:
//   BUDGET ALLOCATION  (LUCIAN bookkeeping, internal)
//   ACTUAL TRANSFER    (real provider-backed movement)
//
// Withdrawal is NOT an internal transfer — money leaves the LUCIAN
// financial environment. Withdrawals live in the Withdraw modal.

import { useEffect, useState } from "react";
import {
  ArrowLeftRight, Wallet, TrendingUp, AlertCircle, Plus, Minus, ArrowRight,
} from "lucide-react";
import { useVaultStore, formatMoney } from "@/store/vault";
import { VaultCard, VaultCardHeader, VaultCardBody, VaultEmptyState, ProviderNotConnectedBanner } from "../primitives";
import { Button } from "@/components/ui-devspace/button";
import { Input } from "@/components/ui-devspace/input";
import { Label } from "@/components/ui-devspace/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui-devspace/select";
import { toast } from "@/hooks/use-toast";
import { useVaultSync } from "@/components/vault/vault-sync-context";
import { cn } from "@/lib/utils";

export function TransfersTab() {
  const [tab, setTab] = useState<"budget" | "actual">("budget");

  return (
    <div className="space-y-5">
      <div className="flex gap-1 rounded-md border border-line-muted bg-inset/40 p-1 themed">
        <button
          onClick={() => setTab("budget")}
          className={cn(
            "flex-1 rounded px-3 py-1.5 text-[12px] font-medium transition-colors themed",
            tab === "budget" ? "bg-surface text-fg" : "text-fg-muted hover:text-fg",
          )}
        >
          Budget Allocation
        </button>
        <button
          onClick={() => setTab("actual")}
          className={cn(
            "flex-1 rounded px-3 py-1.5 text-[12px] font-medium transition-colors themed",
            tab === "actual" ? "bg-surface text-fg" : "text-fg-muted hover:text-fg",
          )}
        >
          Actual Transfer
        </button>
      </div>

      {tab === "budget" ? <BudgetAllocationSection /> : <ActualTransferSection />}
    </div>
  );
}

/* ── Budget Allocation ── */
function BudgetAllocationSection() {
  const store = useVaultStore();
  const [selectedPool, setSelectedPool] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"allocate" | "deallocate">("allocate");

  const available = store.getAvailableCapital();
  const totalAllocated = store.getAllocatedCapital();

  function handleSubmit() {
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ title: "Invalid amount", variant: "destructive" });
      return;
    }
    if (!selectedPool) {
      toast({ title: "Select a budget", variant: "destructive" });
      return;
    }
    const result = mode === "allocate"
      ? store.allocateToPool(selectedPool, amt)
      : store.deallocateFromPool(selectedPool, amt);
    if (!result.success) {
      toast({ title: "Allocation failed", description: result.error, variant: "destructive" });
      return;
    }
    toast({
      title: mode === "allocate" ? "Allocated" : "Deallocated",
      description: `${formatMoney(amt, available.currency)} ${mode === "allocate" ? "allocated to" : "deallocated from"} ${store.allocations.find((p) => p.id === selectedPool)?.label}.`,
    });
    setAmount("");
  }

  return (
    <div className="space-y-5">
      
      <VaultCard>
        <VaultCardHeader
          title="Budget Allocation"
          subtitle="Internal LUCIAN bookkeeping · NOT real provider transfers"
          icon={<Wallet className="h-4 w-4" />}
        />
        <VaultCardBody>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-md border border-line-muted bg-surface p-3 themed">
              <div className="text-[10px] uppercase tracking-wider text-fg-faint">Total Capital</div>
              <div className="mt-1 font-mono text-[14px] font-semibold text-fg">{formatMoney(available.available + totalAllocated, available.currency)}</div>
            </div>
            <div className="rounded-md border border-line-muted bg-surface p-3 themed">
              <div className="text-[10px] uppercase tracking-wider text-fg-faint">Allocated</div>
              <div className="mt-1 font-mono text-[14px] font-semibold text-fg">{formatMoney(totalAllocated, available.currency)}</div>
            </div>
            <div className="rounded-md border border-line-muted bg-surface p-3 themed">
              <div className="text-[10px] uppercase tracking-wider text-fg-faint">Available</div>
              <div className="mt-1 font-mono text-[14px] font-semibold text-emerald-400">{formatMoney(available.available, available.currency)}</div>
            </div>
            <div className="rounded-md border border-line-muted bg-surface p-3 themed">
              <div className="text-[10px] uppercase tracking-wider text-fg-faint">Mixed Currencies</div>
              <div className="mt-1 font-mono text-[14px] font-semibold text-fg">{available.mixed ? "Yes" : "No"}</div>
            </div>
          </div>

          <div className="mt-4 flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 p-2.5">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
            <p className="text-[10.5px] leading-relaxed text-amber-200/80">
              Budget allocations are <span className="font-semibold">internal bookkeeping</span>. They do NOT move real money between accounts. Use <span className="font-semibold">Actual Transfer</span> for provider-backed movements.
            </p>
          </div>
        </VaultCardBody>
      </VaultCard>

      <VaultCard>
        <VaultCardHeader title="Allocate / Deallocate" />
        <VaultCardBody>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Budget</Label>
              <Select value={selectedPool} onValueChange={setSelectedPool}>
                <SelectTrigger className="mt-1.5 w-full"><SelectValue placeholder="Select budget" /></SelectTrigger>
                <SelectContent>
                  {store.allocations.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label} ({formatMoney(p.allocated, available.currency)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Amount</Label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="mt-1.5 font-mono text-[12px]"
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              variant={mode === "allocate" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("allocate")}
              className={mode !== "allocate" ? "border-line-muted" : ""}
            >
              <Plus className="h-3.5 w-3.5" />
              Allocate
            </Button>
            <Button
              variant={mode === "deallocate" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("deallocate")}
              className={mode !== "deallocate" ? "border-line-muted" : ""}
            >
              <Minus className="h-3.5 w-3.5" />
              Deallocate
            </Button>
            <Button onClick={handleSubmit} className="ml-auto">Apply</Button>
          </div>
        </VaultCardBody>
      </VaultCard>

      <VaultCard>
        <VaultCardHeader title="Budgets" />
        <VaultCardBody>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {store.allocations.map((p) => (
              <div key={p.id} className="rounded-md border border-line-muted bg-surface p-3 themed">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-fg">{p.label}</span>
                  {p.feedsMarkets && (
                    <span className="rounded border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--accent)]">
                      Markets
                    </span>
                  )}
                </div>
                <div className="mt-1 font-mono text-[14px] font-semibold text-fg">
                  {formatMoney(p.allocated, available.currency)}
                </div>
                {p.cap > 0 && (
                  <div className="mt-1 text-[10px] text-fg-faint">
                    Cap: {formatMoney(p.cap, available.currency)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </VaultCardBody>
      </VaultCard>
    </div>
  );
}







/* ── Actual Transfer ── */
function ActualTransferSection() {
  const store = useVaultStore();
  const providerConnected = store.balances.providerConnected;
  const sync = useVaultSync();
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [destinationType, setDestinationType] = useState<"internal" | "trading" | "brokerage">("internal");

  // Internal same-currency transfers between manual accounts work without a provider.
  // Anything involving provider accounts requires provider confirmation.
  const manualAccounts = store.accounts.filter((a) => a.source === "manual");

  async function handleSubmit() {
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ title: "Invalid amount", variant: "destructive" });
      return;
    }
    if (destinationType === "internal") {
      if (!fromId || !toId) {
        toast({ title: "Select accounts", variant: "destructive" });
        return;
      }
      const result = store.localTransfer(fromId, toId, amt);
      if (!result.success) {
        toast({ title: "Transfer failed", description: result.error, variant: "destructive" });
        return;
      }
      toast({ title: "Transfer completed", description: "Local transfer between manual accounts." });
      setAmount("");
    } else {
      // Provider-backed transfer (Vault → Trading, Vault → Brokerage, etc.)
      if (!providerConnected) {
        toast({
          title: "Provider required",
          description: "Real transfers to trading or brokerage accounts require a connected provider.",
          variant: "destructive",
        });
        return;
      }
      try {
        const res = await fetch("/api/vault/transfers", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `tf_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
          },
          body: JSON.stringify({
            amount: Math.round(amt * 100),
            currency: "USD",
            from: fromId || "vault",
            to: destinationType,
            type: destinationType,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast({ title: "Transfer failed", description: data.error, variant: "destructive" });
          return;
        }
        toast({ title: "Transfer requested", description: "Pending provider confirmation." });
        void sync.refresh();
        setAmount("");
      } catch {
        toast({ title: "Network error", variant: "destructive" });
      }
    }
  }

  return (
    <div className="space-y-5">
      {!providerConnected && (
        <ProviderNotConnectedBanner message="Local transfers between same-currency manual accounts work without a provider. Transfers to/from provider accounts (Trading, Brokerage) require a connected provider." />
      )}

      <VaultCard>
        <VaultCardHeader
          title="Actual Transfer"
          subtitle="Real provider-backed movement of funds"
          icon={<ArrowLeftRight className="h-4 w-4" />}
        />
        <VaultCardBody>
          <div className="space-y-3">
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Transfer type</Label>
              <Select value={destinationType} onValueChange={(v) => setDestinationType(v as typeof destinationType)}>
                <SelectTrigger className="mt-1.5 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">Vault → Vault (manual accounts)</SelectItem>
                  <SelectItem value="trading">Vault → Trading</SelectItem>
                  <SelectItem value="brokerage">Vault → Brokerage</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {destinationType === "internal" ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-[11px] uppercase tracking-wider text-fg-muted">From</Label>
                    <Select value={fromId} onValueChange={setFromId}>
                      <SelectTrigger className="mt-1.5 w-full"><SelectValue placeholder="Select source" /></SelectTrigger>
                      <SelectContent>
                        {manualAccounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.label} ({formatMoney(a.balance, a.currency)})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[11px] uppercase tracking-wider text-fg-muted">To</Label>
                    <Select value={toId} onValueChange={setToId}>
                      <SelectTrigger className="mt-1.5 w-full"><SelectValue placeholder="Select destination" /></SelectTrigger>
                      <SelectContent>
                        {manualAccounts.filter((a) => a.id !== fromId).map((a) => (
                          <SelectItem key={a.id} value={a.id}>{a.label} ({formatMoney(a.balance, a.currency)})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-md border border-line-muted bg-inset/40 p-3 themed">
                <div className="flex items-center gap-2 text-[11px] text-fg-muted">
                  <span className="rounded border border-line-muted px-1.5 py-0.5">Vault</span>
                  <ArrowRight className="h-3 w-3" />
                  <span className="rounded border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-1.5 py-0.5 text-[var(--accent)]">
                    {destinationType === "trading" ? "Trading" : "Brokerage"}
                  </span>
                </div>
                <p className="mt-2 text-[10.5px] text-fg-muted">
                  This transfer is provider-backed. The server will record a pending transfer and the provider will settle it.
                </p>
              </div>
            )}

            <div>
              <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Amount</Label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="mt-1.5 font-mono text-[12px]"
              />
            </div>

            <Button onClick={handleSubmit} className="w-full sm:w-auto">
              <ArrowLeftRight className="h-4 w-4" />
              {destinationType === "internal" ? "Transfer Now" : "Request Transfer"}
            </Button>
          </div>
        </VaultCardBody>
      </VaultCard>

      <VaultCard>
        <VaultCardHeader title="Important: Withdrawal is NOT an Internal Transfer" />
        <VaultCardBody>
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 themed">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            <p className="text-[11px] leading-relaxed text-amber-200/80">
              <span className="font-semibold">Withdrawal</span> means money leaves the connected LUCIAN financial environment entirely (to a bank, card, or external crypto wallet).
              <span className="font-semibold"> Internal Transfer</span> moves money between accounts within LUCIAN (e.g. Vault → Trading). Use the Withdraw button for outbound payments.
            </p>
          </div>
        </VaultCardBody>
      </VaultCard>
    </div>
  );
}
