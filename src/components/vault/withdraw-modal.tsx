"use client";

/* eslint-disable react-hooks/set-state-in-effect */

// LUCIAN Vault — Withdraw modal.
//
// Supports:
//   - Bank withdrawal
//   - Eligible card withdrawal (provider capability determines eligibility)
//   - Crypto withdrawal (with network separation — never mix networks)
//
// Flow:
//   1. User picks amount + destination
//   2. We POST /api/vault/withdrawals with idempotency key
//   3. Server validates amount, capability, daily limits, security checks
//   4. Returns status: requested | pending | processing | completed | failed | cancelled
//
// Crypto shows: Asset, Network, Available, Destination address, Amount, Network fee, Recipient amount.

import { useEffect, useMemo, useRef, useState } from "react";
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
  formatCrypto,
  type WithdrawalDestination,
  type CryptoAssetSymbol,
  type CryptoNetwork,
} from "@/store/vault";
import { VaultCard, StatusPill, ProviderNotConnectedBanner } from "./primitives";
import {
  Banknote, CreditCard, Bitcoin, Loader2, AlertCircle, ShieldCheck, ArrowDown,
} from "lucide-react";

type FlowStatus =
  | { state: "idle" }
  | { state: "review"; amount: number; destination: WithdrawalDestination; fee: number; recipientAmount: number; estimatedArrival: string }
  | { state: "requested"; txId: string; amount: number; currency: string }
  | { state: "failed"; message: string }
  | { state: "completed"; txId: string; amount: number; currency: string };

export function WithdrawModal({
  open,
  onClose,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after a withdrawal is successfully submitted so the caller can refresh server state. */
  onComplete?: () => void;
}) {
  const store = useVaultStore();
  const [amount, setAmount] = useState("");
  const [selectedDest, setSelectedDest] = useState<string>("");
  const [flow, setFlow] = useState<FlowStatus>({ state: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKeyRef = useRef("");

  // Reset form when modal opens. Resetting form state on prop change is a
  // legitimate use of useEffect (see React docs: "Adjusting state when a
  // prop changes"). The rule is disabled at the file level.
  useEffect(() => {
    if (open) {
      setAmount("");
      setSelectedDest("");
      setFlow({ state: "idle" });
      setSubmitting(false);
      idempotencyKeyRef.current = "";
    }
  }, [open]);

  const destinations = store.withdrawalDestinations;
  const available = store.balances.cash.withdrawable;
  const availableCurrency = store.balances.cash.currency;

  const destination: WithdrawalDestination | null = useMemo(() => {
    if (!selectedDest) return null;
    return destinations.find((d) => d.id === selectedDest) ?? null;
  }, [selectedDest, destinations]);

  const amountNum = parseFloat(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const exceedsAvailable = amountValid && destination?.type !== "crypto" && amountNum > available;

  // Estimated fee — would come from provider in production
  const fee = useMemo(() => {
    if (!destination || !amountValid) return 0;
    if (destination.type === "bank") return 0;
    if (destination.type === "card") return amountNum * 0.015; // 1.5%
    if (destination.type === "crypto") return 0.00012; // BTC network fee placeholder
    return 0;
  }, [destination, amountValid, amountNum]);

  const recipientAmount = useMemo(() => {
    if (!amountValid) return 0;
    return Math.max(0, amountNum - fee);
  }, [amountValid, fee, amountNum]);

  const estimatedArrival = destination?.type === "crypto"
    ? "10-60 minutes (network confirmation)"
    : destination?.type === "bank"
      ? "1-3 business days"
      : "Instant to 24 hours";

  function handleReview() {
    if (!amountValid) {
      toast({ title: "Invalid amount", description: "Enter a positive amount.", variant: "destructive" });
      return;
    }
    if (!destination) {
      toast({ title: "Select destination", description: "Choose where to send funds.", variant: "destructive" });
      return;
    }
    if (exceedsAvailable) {
      toast({ title: "Insufficient balance", description: `Available to withdraw: ${formatMoney(available, availableCurrency)}`, variant: "destructive" });
      return;
    }
    if (!destination.approved) {
      toast({
        title: "Destination not approved",
        description: "New destinations require a security delay before withdrawals are allowed.",
        variant: "destructive",
      });
      return;
    }
    setFlow({
      state: "review",
      amount: amountNum,
      destination,
      fee,
      recipientAmount,
      estimatedArrival,
    });
  }

  async function handleConfirm() {
    if (flow.state !== "review") return;
    setSubmitting(true);

    // Generate idempotency key lazily on first submit
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = `wd_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }

    try {
      const res = await fetch("/api/vault/withdrawals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKeyRef.current,
        },
        body: JSON.stringify({
          amount: Math.round(flow.amount * 100),
          currency: availableCurrency,
          destinationId: flow.destination.id,
          destinationType: flow.destination.type,
          asset: flow.destination.type === "crypto" ? flow.destination.asset : undefined,
          network: flow.destination.network,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFlow({ state: "failed", message: data.error ?? "Withdrawal request failed." });
        return;
      }
      if (data.status === "completed") {
        setFlow({ state: "completed", txId: data.transactionId, amount: flow.amount, currency: availableCurrency });
        onComplete?.();
      } else if (data.status === "failed") {
        setFlow({ state: "failed", message: data.message ?? "Withdrawal failed." });
      } else {
        // requested or pending
        setFlow({ state: "requested", txId: data.transactionId, amount: flow.amount, currency: availableCurrency });
        onComplete?.();
      }
    } catch (err) {
      setFlow({
        state: "failed",
        message: err instanceof Error ? err.message : "Network error. Try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold text-fg">Withdraw</DialogTitle>
        </DialogHeader>

        {!store.balances.providerConnected && (
          <ProviderNotConnectedBanner message="No provider is connected. Withdrawal requests will be recorded but cannot be settled without provider integration." />
        )}

        {(flow.state === "idle") && (
          <div className="space-y-4">
            {/* Available */}
            <div className="rounded-md border border-line-muted bg-inset/40 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-fg-faint">Available to withdraw</div>
              <div className="mt-0.5 font-mono text-[18px] font-semibold text-fg">
                {formatMoney(available, availableCurrency)}
              </div>
            </div>

            {/* Amount */}
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Amount</Label>
              <div className="mt-1.5 relative">
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
                  disabled={submitting}
                />
              </div>
              {exceedsAvailable && (
                <p className="mt-1 text-[10.5px] text-red-400">Exceeds available balance.</p>
              )}
            </div>

            {/* Destination */}
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Destination</Label>
              {destinations.length === 0 ? (
                <div className="mt-2 rounded-md border border-dashed border-line-muted bg-inset/40 p-4 text-center">
                  <p className="text-[11px] text-fg-muted">
                    No withdrawal destinations configured. Add one in the Money tab.
                  </p>
                </div>
              ) : (
                <div className="mt-2 space-y-1.5">
                  {destinations.map((d) => {
                    const icon = d.type === "bank" ? <Banknote className="h-4 w-4" /> : d.type === "card" ? <CreditCard className="h-4 w-4" /> : <Bitcoin className="h-4 w-4" />;
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setSelectedDest(d.id)}
                        disabled={submitting}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors themed",
                          selectedDest === d.id
                            ? "border-[var(--accent)] bg-[var(--accent)]/5"
                            : "border-line-muted bg-surface hover:bg-hover-bg",
                        )}
                      >
                        <span className={cn("text-fg-muted", selectedDest === d.id && "text-[var(--accent)]")}>{icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-medium text-fg truncate">{d.label}</div>
                          <div className="text-[10.5px] text-fg-muted truncate">
                            {d.type === "crypto" ? `${d.asset} · ${d.network}` : d.type}
                            {!d.approved && " · Pending approval"}
                          </div>
                        </div>
                        <span
                          className={cn(
                            "h-3 w-3 rounded-full border-2",
                            selectedDest === d.id ? "border-[var(--accent)] bg-[var(--accent)]" : "border-line-muted",
                          )}
                        />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Crypto-specific info */}
            {destination?.type === "crypto" && (
              <VaultCard className="p-3">
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <div className="text-fg-faint">Asset</div>
                    <div className="font-medium text-fg">{destination.asset}</div>
                  </div>
                  <div>
                    <div className="text-fg-faint">Network</div>
                    <div className="font-medium text-fg capitalize">{destination.network}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-fg-faint">Destination address</div>
                    <code className="block font-mono text-[10.5px] text-fg-muted break-all">{destination.label}</code>
                  </div>
                  <div>
                    <div className="text-fg-faint">Network fee</div>
                    <div className="font-mono text-fg">{fee.toFixed(6)} {destination.asset}</div>
                  </div>
                  <div>
                    <div className="text-fg-faint">You receive</div>
                    <div className="font-mono text-emerald-300">{recipientAmount.toFixed(6)} {destination.asset}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 p-2">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
                  <p className="text-[10px] text-amber-200/80">
                    Crypto withdrawals are irreversible. Verify the network and address. {destination.asset} on {destination.network} cannot be mixed with other networks.
                  </p>
                </div>
              </VaultCard>
            )}
          </div>
        )}

        {flow.state === "review" && (
          <ReviewStep
            amount={flow.amount}
            destination={flow.destination}
            fee={flow.fee}
            recipientAmount={flow.recipientAmount}
            estimatedArrival={flow.estimatedArrival}
            currency={availableCurrency}
          />
        )}

        {(flow.state === "requested" || flow.state === "failed" || flow.state === "completed") && (
          <FlowResult flow={flow} />
        )}

        <DialogFooter>
          {(flow.state === "idle") && (
            <>
              <Button variant="ghost" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                onClick={handleReview}
                disabled={!amountValid || !destination || exceedsAvailable || submitting || destinations.length === 0}
              >
                Continue
              </Button>
            </>
          )}
          {flow.state === "review" && (
            <>
              <Button variant="ghost" onClick={() => setFlow({ state: "idle" })}>
                Back
              </Button>
              <Button onClick={handleConfirm} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Submitting
                  </>
                ) : (
                  "Confirm Withdrawal"
                )}
              </Button>
            </>
          )}
          {(flow.state === "requested" || flow.state === "failed" || flow.state === "completed") && (
            <Button variant="ghost" onClick={onClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewStep({
  amount,
  destination,
  fee,
  recipientAmount,
  estimatedArrival,
  currency,
}: {
  amount: number;
  destination: WithdrawalDestination;
  fee: number;
  recipientAmount: number;
  estimatedArrival: string;
  currency: string;
}) {
  return (
    <VaultCard className="p-4">
      <h3 className="text-[12px] font-semibold uppercase tracking-wider text-fg">Review Withdrawal</h3>
      <div className="mt-3 space-y-2 text-[12px]">
        <ReviewRow label="Amount" value={formatMoney(amount, currency)} />
        <ReviewRow label="Destination" value={destination.label} />
        <ReviewRow label="Type" value={destination.type === "crypto" ? `${destination.asset} (${destination.network})` : destination.type} />
        <ReviewRow label="Fee" value={destination.type === "crypto" ? `${fee.toFixed(6)} ${destination.asset}` : formatMoney(fee, currency)} />
        <ReviewRow label="Estimated arrival" value={estimatedArrival} />
        <div className="my-2 border-t border-line-muted" />
        <ReviewRow
          label="Recipient receives"
          value={destination.type === "crypto" ? `${recipientAmount.toFixed(6)} ${destination.asset}` : formatMoney(recipientAmount, currency)}
          highlight
        />
      </div>
      <div className="mt-3 flex items-start gap-1.5 rounded border border-line-muted bg-inset/40 p-2">
        <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-fg-faint" />
        <p className="text-[10px] text-fg-muted">
          Withdrawal requires provider confirmation. Funds will be marked <span className="font-semibold">Requested</span> until the provider processes the payout.
        </p>
      </div>
    </VaultCard>
  );
}

function ReviewRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-fg-muted">{label}</span>
      <span className={cn("font-mono", highlight ? "font-semibold text-emerald-300" : "text-fg")}>{value}</span>
    </div>
  );
}

function FlowResult({ flow }: { flow: Extract<FlowStatus, { state: "requested" | "failed" | "completed" }> }) {
  if (flow.state === "requested") {
    return (
      <VaultCard className="p-5 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-cyan-500/10">
          <ArrowDown className="h-5 w-5 text-cyan-400" />
        </div>
        <h3 className="text-[14px] font-semibold text-fg">Withdrawal Requested</h3>
        <p className="mt-1 text-[12px] text-fg-muted">
          We&apos;ve submitted your withdrawal request. <span className="font-mono text-cyan-300">-{formatMoney(flow.amount, flow.currency)}</span>
        </p>
        <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-line-muted bg-inset px-3 py-1">
          <span className="text-[10px] text-fg-faint">Tx ID</span>
          <code className="font-mono text-[10.5px] text-fg-muted">{flow.txId}</code>
        </div>
        <div className="mt-3">
          <StatusPill status="requested" />
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
        <h3 className="text-[14px] font-semibold text-fg">Withdrawal Failed</h3>
        <p className="mt-1 text-[12px] text-fg-muted">{flow.message}</p>
        <div className="mt-3">
          <StatusPill status="failed" />
        </div>
      </VaultCard>
    );
  }
  return (
    <VaultCard className="p-5 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
        <ShieldCheck className="h-5 w-5 text-emerald-400" />
      </div>
      <h3 className="text-[14px] font-semibold text-fg">Withdrawal Completed</h3>
      <p className="mt-1 text-[12px] text-fg-muted">
        Provider confirmed payout. <span className="font-mono text-emerald-300">-{formatMoney(flow.amount, flow.currency)}</span>
      </p>
      <div className="mt-3">
        <StatusPill status="completed" />
      </div>
    </VaultCard>
  );
}
