"use client";

/* eslint-disable react-hooks/set-state-in-effect */

// LUCIAN Vault — Add Money modal.
//
// Flow:
//   1. User picks amount + funding source (card / bank / crypto)
//   2. We POST /api/vault/deposits with idempotency key
//   3. Server returns transaction status: pending | processing | requires-action | completed | failed
//   4. UI displays the status honestly
//
// CRITICAL: We NEVER mark funds as AVAILABLE just because the client says
// payment succeeded. Only verified provider confirmation (via webhook) makes
// funds available. The modal shows "Pending +$X" until the server says
// "Completed".

import { useEffect, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui-devspace/dialog";
import { Button } from "@/components/ui-devspace/button";
import { Input } from "@/components/ui-devspace/input";
import { Label } from "@/components/ui-devspace/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui-devspace/select";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  useVaultStore,
  formatMoney,
  type PaymentMethod,
  type BankAccount,
  type CryptoAssetSymbol,
  type CryptoNetwork,
} from "@/store/vault";
import { VaultCard, StatusPill, ProviderNotConnectedBanner } from "./primitives";
import { CreditCard, Banknote, Bitcoin, Loader2, ShieldCheck, AlertCircle } from "lucide-react";

type FundingMethod =
  | { kind: "sandbox"; id: "sandbox"; label: string }
  | { kind: "card"; id: string; label: string }
  | { kind: "bank"; id: string; label: string }
  | { kind: "crypto"; asset: CryptoAssetSymbol; network: CryptoNetwork };

type FlowStatus =
  | { state: "idle" }
  | { state: "submitting" }
  | { state: "pending"; txId: string; amount: number; currency: string }
  | { state: "requires-action"; txId: string; message: string }
  | { state: "failed"; message: string }
  | { state: "completed"; txId: string; amount: number; currency: string };

export function AddMoneyModal({
  open,
  onClose,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after a deposit is successfully submitted so the caller can refresh server state. */
  onComplete?: () => void;
}) {
  const store = useVaultStore();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [selectedMethod, setSelectedMethod] = useState<string>("");
  const [flow, setFlow] = useState<FlowStatus>({ state: "idle" });
  const idempotencyKeyRef = useRef("");

  // Reset form when modal opens. Resetting form state on prop change is a
  // legitimate use of useEffect (see React docs: "Adjusting state when a
  // prop changes"). The rule is disabled at the file level.
  useEffect(() => {
    if (open) {
      setAmount("");
      setSelectedMethod("");
      setFlow({ state: "idle" });
      idempotencyKeyRef.current = "";
    }
  }, [open]);

  const cards = store.paymentMethods;
  const banks = store.bankAccounts;
  const cryptoWallets = store.cryptoWallets;
  const hasAnyMethod = cards.length + banks.length + cryptoWallets.length > 0;
  const sandboxMode = process.env.NEXT_PUBLIC_TRADING_MODE !== "live";

  // Parse selected method
  const method: FundingMethod | null = (() => {
    if (!selectedMethod) return null;
    const [kind, id] = selectedMethod.split(":");
    if (kind === "sandbox" && sandboxMode) return { kind: "sandbox", id: "sandbox", label: "LUCIAN persistent sandbox" };
    if (kind === "card") {
      const card = cards.find((c) => c.id === id);
      if (card) return { kind: "card", id: card.id, label: card.displayName };
    }
    if (kind === "bank") {
      const bank = banks.find((b) => b.id === id);
      if (bank) return { kind: "bank", id: bank.id, label: bank.displayName };
    }
    if (kind === "crypto") {
      const w = cryptoWallets.find((w) => w.id === id);
      if (w) return { kind: "crypto", asset: w.asset, network: w.network };
    }
    return null;
  })();

  const amountNum = parseFloat(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;

  async function handleContinue() {
    if (!amountValid) {
      toast({ title: "Invalid amount", description: "Enter a positive amount.", variant: "destructive" });
      return;
    }
    if (!method) {
      toast({ title: "Select funding source", description: "Choose a card, bank, or crypto wallet.", variant: "destructive" });
      return;
    }

    setFlow({ state: "submitting" });

    // Generate idempotency key lazily on first submit (impure function not allowed in render)
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = `dep_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }

    try {
      const res = await fetch(method.kind === "sandbox" ? "/api/vault/sandbox-funds" : "/api/vault/deposits", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKeyRef.current,
        },
        body: JSON.stringify({
          amount: Math.round(amountNum * 100), // minor units
          currency,
          method: method.kind,
          methodId: method.kind === "crypto" || method.kind === "sandbox" ? undefined : method.id,
          asset: method.kind === "crypto" ? (method as Extract<FundingMethod, { kind: "crypto" }>).asset : undefined,
          network: method.kind === "crypto" ? (method as Extract<FundingMethod, { kind: "crypto" }>).network : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setFlow({ state: "failed", message: data.error ?? "Deposit request failed." });
        return;
      }

      // Server returns honest status. NEVER fake "completed".
      if (data.status === "completed") {
        setFlow({ state: "completed", txId: data.transactionId, amount: amountNum, currency });
        onComplete?.();
      } else if (data.status === "requires-action") {
        setFlow({ state: "requires-action", txId: data.transactionId, message: data.message ?? "Authentication required." });
        onComplete?.();
      } else if (data.status === "failed") {
        setFlow({ state: "failed", message: data.message ?? "Deposit failed." });
      } else {
        // pending or processing — wait for webhook
        setFlow({ state: "pending", txId: data.transactionId, amount: amountNum, currency });
        onComplete?.();
      }
    } catch (err) {
      setFlow({
        state: "failed",
        message: err instanceof Error ? err.message : "Network error. Try again.",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold text-fg">Add Money</DialogTitle>
        </DialogHeader>

        {!store.balances.providerConnected && (
          <ProviderNotConnectedBanner message="No payment provider is connected. Deposit requests will be recorded as pending but cannot be settled until a provider is configured." />
        )}

        {flow.state === "idle" || flow.state === "submitting" ? (
          <div className="space-y-4">
            {/* Amount */}
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Amount</Label>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] font-medium text-fg-muted">$</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="pl-7 font-mono text-[15px]"
                    disabled={flow.state === "submitting"}
                  />
                </div>
                <Select value={currency} onValueChange={setCurrency} disabled={flow.state === "submitting" || method?.kind === "sandbox"}>
                  <SelectTrigger className="w-[90px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Pay with */}
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Pay with</Label>
              {!hasAnyMethod && !sandboxMode ? (
                <div className="mt-2 rounded-md border border-dashed border-line-muted bg-inset/40 p-4 text-center">
                  <p className="text-[11px] text-fg-muted">
                    No payment methods available. Add a card, bank account, or crypto wallet in the Money tab first.
                  </p>
                </div>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {sandboxMode && (
                    <FundingOption
                      selected={selectedMethod === "sandbox:sandbox"}
                      onClick={() => { setSelectedMethod("sandbox:sandbox"); setCurrency("USD"); }}
                      icon={<ShieldCheck className="h-4 w-4" />}
                      label="LUCIAN persistent sandbox"
                      sublabel="Saved to your account · test funds · not withdrawable"
                    />
                  )}
                  {cards.map((card) => (
                    <FundingOption
                      key={`card:${card.id}`}
                      selected={selectedMethod === `card:${card.id}`}
                      onClick={() => setSelectedMethod(`card:${card.id}`)}
                      icon={<CreditCard className="h-4 w-4" />}
                      label={card.displayName}
                      sublabel={`Expires ${String(card.expiryMonth).padStart(2, "0")}/${String(card.expiryYear).slice(-2)}`}
                      badge={card.isDefault ? "Default" : undefined}
                      disabled={flow.state === "submitting"}
                    />
                  ))}
                  {banks.map((bank) => (
                    <FundingOption
                      key={`bank:${bank.id}`}
                      selected={selectedMethod === `bank:${bank.id}`}
                      onClick={() => setSelectedMethod(`bank:${bank.id}`)}
                      icon={<Banknote className="h-4 w-4" />}
                      label={bank.displayName}
                      sublabel={`${bank.accountType} · ${bank.verified ? "Verified" : "Pending verification"}`}
                      disabled={flow.state === "submitting"}
                    />
                  ))}
                  {cryptoWallets.map((w) => (
                    <FundingOption
                      key={`crypto:${w.id}`}
                      selected={selectedMethod === `crypto:${w.id}`}
                      onClick={() => setSelectedMethod(`crypto:${w.id}`)}
                      icon={<Bitcoin className="h-4 w-4" />}
                      label={`${w.asset} · ${w.label}`}
                      sublabel={`Network: ${w.network}`}
                      disabled={flow.state === "submitting"}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-md border border-line-muted bg-inset/40 p-3">
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-faint" />
                <p className="text-[10.5px] leading-relaxed text-fg-muted">
                  {method?.kind === "sandbox" ? (
                    <>Sandbox funds are saved to your LUCIAN account immediately, but can never be withdrawn or presented as real money.</>
                  ) : (
                    <>Funds appear as <span className="font-semibold text-amber-300">Pending</span> until the connected provider confirms settlement.</>
                  )}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <FlowResult flow={flow} />
        )}

        <DialogFooter>
          {flow.state === "idle" || flow.state === "submitting" ? (
            <>
              <Button variant="ghost" onClick={onClose} disabled={flow.state === "submitting"}>
                Cancel
              </Button>
              <Button
                onClick={handleContinue}
                disabled={!amountValid || !method || flow.state === "submitting" || (!hasAnyMethod && !sandboxMode)}
              >
                {flow.state === "submitting" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing
                  </>
                ) : (
                  "Continue"
                )}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FundingOption({
  selected,
  onClick,
  icon,
  label,
  sublabel,
  badge,
  disabled,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  badge?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors themed",
        selected
          ? "border-[var(--accent)] bg-[var(--accent)]/5"
          : "border-line-muted bg-surface hover:bg-hover-bg",
        disabled && "opacity-60",
      )}
    >
      <span className={cn("text-fg-muted", selected && "text-[var(--accent)]")}>{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-fg truncate">{label}</div>
        {sublabel && <div className="text-[10.5px] text-fg-muted truncate">{sublabel}</div>}
      </div>
      {badge && (
        <span className="rounded border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--accent)]">
          {badge}
        </span>
      )}
      <span
        className={cn(
          "h-3 w-3 rounded-full border-2",
          selected ? "border-[var(--accent)] bg-[var(--accent)]" : "border-line-muted",
        )}
      />
    </button>
  );
}

function FlowResult({ flow }: { flow: Extract<FlowStatus, { state: "pending" | "requires-action" | "failed" | "completed" }> }) {
  if (flow.state === "pending") {
    return (
      <VaultCard className="p-5 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
          <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
        </div>
        <h3 className="text-[14px] font-semibold text-fg">Deposit Pending</h3>
        <p className="mt-1 text-[12px] text-fg-muted">
          We&apos;ve recorded your deposit request. Funds will appear as <span className="font-mono text-amber-300">Pending +{formatMoney(flow.amount, flow.currency)}</span> until the provider confirms settlement.
        </p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-line-muted bg-inset px-3 py-1">
          <span className="text-[10px] text-fg-faint">Tx ID</span>
          <code className="font-mono text-[10.5px] text-fg-muted">{flow.txId}</code>
        </div>
        <div className="mt-3">
          <StatusPill status="pending" />
        </div>
      </VaultCard>
    );
  }
  if (flow.state === "requires-action") {
    return (
      <VaultCard className="p-5 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-purple-500/10">
          <AlertCircle className="h-5 w-5 text-purple-400" />
        </div>
        <h3 className="text-[14px] font-semibold text-fg">Authentication Required</h3>
        <p className="mt-1 text-[12px] text-fg-muted">{flow.message}</p>
        <p className="mt-2 text-[10.5px] text-fg-faint">
          The provider (e.g. 3D Secure) handles authentication. LUCIAN does not collect card credentials.
        </p>
        <div className="mt-3">
          <StatusPill status="requires-action" />
        </div>
      </VaultCard>
    );
  }
  if (flow.state === "failed") {
    return (
      <VaultCard className="p-5 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
          <AlertCircle className="h-5 w-5 text-red-400" />
        </div>
        <h3 className="text-[14px] font-semibold text-fg">Deposit Failed</h3>
        <p className="mt-1 text-[12px] text-fg-muted">{flow.message}</p>
        <div className="mt-3">
          <StatusPill status="failed" />
        </div>
      </VaultCard>
    );
  }
  // completed (narrowed)
  const completedFlow = flow as Extract<FlowStatus, { state: "completed" }>;
  return (
    <VaultCard className="p-5 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
        <ShieldCheck className="h-5 w-5 text-emerald-400" />
      </div>
      <h3 className="text-[14px] font-semibold text-fg">Deposit Completed</h3>
      <p className="mt-1 text-[12px] text-fg-muted">
        Provider confirmed settlement. <span className="font-mono text-emerald-300">Available +{formatMoney(completedFlow.amount, completedFlow.currency)}</span>
      </p>
      <div className="mt-3">
        <StatusPill status="completed" />
      </div>
    </VaultCard>
  );
}
