"use client";

// Vault Money tab — the main financial gateway.
//
// Structure:
//   [ Add Money ]  [ Withdraw ]  [ Transfer ]
//   PAYMENT METHODS  (cards — never store PAN/CVV, only safe refs)
//   BANK ACCOUNTS
//   CRYPTO
//   WITHDRAWAL DESTINATIONS
//   AUTO FUND (with idempotency protection)

import { useState } from "react";
import {
  ArrowDownToLine, ArrowUpFromLine, ArrowLeftRight, Plus,
  CreditCard, Banknote, Bitcoin, Trash2, Zap, ShieldCheck, AlertCircle,
} from "lucide-react";
import {
  useVaultStore, formatMoney, type PaymentMethod, type BankAccount, type CryptoWallet,
} from "@/store/vault";
import { VaultCard, VaultCardHeader, VaultCardBody, CardBrandBadge, SourceBadge, ProviderNotConnectedBanner, VaultEmptyState } from "../primitives";
import { Button } from "@/components/ui-devspace/button";
import { Switch } from "@/components/ui-devspace/switch";
import { Input } from "@/components/ui-devspace/input";
import { Label } from "@/components/ui-devspace/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui-devspace/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui-devspace/dialog";
import { toast } from "@/hooks/use-toast";
import { useVaultSync } from "@/components/vault/vault-sync-context";
import { BybitMoneyCenter } from "@/components/vault/bybit-money-center";

export function MoneyTab({
  onAddMoney,
  onWithdraw,
  onTransfer,
}: {
  onAddMoney: () => void;
  onWithdraw: () => void;
  onTransfer: () => void;
}) {
  const store = useVaultStore();
  return (
    <div className="space-y-5">
      {/* Top action bar */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Button onClick={onAddMoney} size="lg" className="justify-center">
          <ArrowDownToLine className="h-4 w-4" />
          Add Money
        </Button>
        <Button variant="outline" onClick={onWithdraw} size="lg" className="justify-center border-line-muted">
          <ArrowUpFromLine className="h-4 w-4" />
          Withdraw
        </Button>
        <Button variant="outline" onClick={onTransfer} size="lg" className="justify-center border-line-muted">
          <ArrowLeftRight className="h-4 w-4" />
          Transfer
        </Button>
      </div>

      {/* Live Bybit balances, deposits, withdrawals and trading activity. Server ownership, password
          verification, confirmation text, limits, and kill switches are
          enforced independently of this client UI. */}
      <BybitMoneyCenter />

      {/* Payment Methods */}
      <VaultCard>
        <VaultCardHeader
          title="Payment Methods"
          subtitle="Cards · Provider-stored references only (no PAN/CVV)"
          icon={<CreditCard className="h-4 w-4" />}
          action={<AddCardButton />}
        />
        <VaultCardBody>
          {store.paymentMethods.length === 0 ? (
            <VaultEmptyState
              title="No payment methods"
              description="Add a card to enable fast deposits. Card credentials are collected by the payment provider, never by LUCIAN."
              action={<AddCardButton />}
            />
          ) : (
            <div className="space-y-2">
              {store.paymentMethods.map((m) => (
                <PaymentMethodRow key={m.id} method={m} />
              ))}
            </div>
          )}
        </VaultCardBody>
      </VaultCard>

      {/* Bank Accounts */}
      <VaultCard>
        <VaultCardHeader
          title="Bank Accounts"
          subtitle="Linked bank accounts · Provider-verified"
          icon={<Banknote className="h-4 w-4" />}
          action={<LinkBankButton />}
        />
        <VaultCardBody>
          {store.bankAccounts.length === 0 ? (
            <VaultEmptyState
              title="No bank accounts linked"
              description="Link a bank account to enable bank deposits and withdrawals."
              action={<LinkBankButton />}
            />
          ) : (
            <div className="space-y-2">
              {store.bankAccounts.map((b) => (
                <BankAccountRow key={b.id} bank={b} />
              ))}
            </div>
          )}
        </VaultCardBody>
      </VaultCard>

      {/* Crypto */}
      <VaultCard>
        <VaultCardHeader
          title="Crypto"
          subtitle="Wallets and supported assets"
          icon={<Bitcoin className="h-4 w-4" />}
          action={<DepositCryptoButton />}
        />
        <VaultCardBody>
          {store.cryptoWallets.length === 0 ? (
            <VaultEmptyState
              title="No crypto wallets"
              description="Add a wallet address for BTC, ETH, USDC and more. Each network is treated separately."
              action={<DepositCryptoButton />}
            />
          ) : (
            <div className="space-y-2">
              {store.cryptoWallets.map((w) => (
                <CryptoWalletRow key={w.id} wallet={w} />
              ))}
            </div>
          )}
        </VaultCardBody>
      </VaultCard>

      {/* Withdrawal Destinations */}
      <VaultCard>
        <VaultCardHeader
          title="Withdrawal Destinations"
          subtitle="Where money can be sent to leave LUCIAN"
          icon={<ArrowUpFromLine className="h-4 w-4" />}
          action={<AddDestinationButton />}
        />
        <VaultCardBody>
          {store.withdrawalDestinations.length === 0 ? (
            <VaultEmptyState
              title="No withdrawal destinations"
              description="Add a bank, eligible card, or crypto wallet as a withdrawal destination. New destinations have a security delay before they can be used."
              action={<AddDestinationButton />}
            />
          ) : (
            <div className="space-y-2">
              {store.withdrawalDestinations.map((d) => (
                <div key={d.id} className="flex items-center gap-3 rounded-md border border-line-muted bg-surface p-3 themed">
                  <div className="flex h-8 w-8 items-center justify-center rounded bg-inset text-fg-muted">
                    {d.type === "bank" && <Banknote className="h-4 w-4" />}
                    {d.type === "card" && <CreditCard className="h-4 w-4" />}
                    {d.type === "crypto" && <Bitcoin className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-fg truncate">{d.label}</div>
                    <div className="text-[10.5px] text-fg-muted">
                      {d.type === "crypto" ? `${d.asset} · ${d.network}` : d.type}
                      {!d.approved && " · Pending approval"}
                    </div>
                  </div>
                  <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium uppercase ${
                    d.approved ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  }`}>
                    {d.approved ? "Approved" : "Pending"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </VaultCardBody>
      </VaultCard>

      {/* Auto Fund */}
      <AutoFundSection />
    </div>
  );
}

/* ── Payment method row ── */
function PaymentMethodRow({ method }: { method: PaymentMethod }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-line-muted bg-surface p-3 themed">
      <div className="flex h-8 w-8 items-center justify-center rounded bg-inset text-fg-muted">
        <CreditCard className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-fg">{method.displayName}</span>
          {method.isDefault && (
            <span className="rounded border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--accent)]">
              Default
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[10.5px] text-fg-muted">
          Expires {String(method.expiryMonth).padStart(2, "0")}/{String(method.expiryYear).slice(-2)}
          {!method.depositEligible && " · Deposits disabled"}
          {!method.withdrawalEligible && " · Withdrawals disabled"}
        </div>
      </div>
      <CardBrandBadge brand={method.brand} />
    </div>
  );
}

/* ── Bank account row ── */
function BankAccountRow({ bank }: { bank: BankAccount }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-line-muted bg-surface p-3 themed">
      <div className="flex h-8 w-8 items-center justify-center rounded bg-inset text-fg-muted">
        <Banknote className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-fg">{bank.displayName}</div>
        <div className="text-[10.5px] text-fg-muted capitalize">
          {bank.accountType} · {bank.verified ? "Verified" : "Pending verification"}
        </div>
      </div>
      <SourceBadge source="provider" />
    </div>
  );
}

/* ── Crypto wallet row ── */
function CryptoWalletRow({ wallet }: { wallet: CryptoWallet }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-line-muted bg-surface p-3 themed">
      <div className="flex h-8 w-8 items-center justify-center rounded bg-inset text-fg-muted">
        <Bitcoin className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-fg">{wallet.label}</div>
        <div className="text-[10.5px] text-fg-muted">
          {wallet.asset} · {wallet.network} · <code className="font-mono">{wallet.address.slice(0, 8)}…{wallet.address.slice(-6)}</code>
        </div>
      </div>
      {wallet.isWithdrawalDestination && (
        <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-400">
          Withdrawal OK
        </span>
      )}
    </div>
  );
}

/* ── Add Card button + modal ── */
function AddCardButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="border-line-muted">
        <Plus className="h-3.5 w-3.5" />
        Add Card
      </Button>
      <AddCardModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function AddCardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useVaultStore();
  const [submitting, setSubmitting] = useState(false);
  const sync = useVaultSync();

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const res = await fetch("/api/vault/payment-methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "card" }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Cannot add card", description: data.error ?? "Provider not connected.", variant: "destructive" });
        return;
      }
      toast({ title: "Card setup requested", description: "Complete card entry via the provider's secure form." });
      void sync.refreshPaymentMethods();
      onClose();
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold text-fg">Add Card</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <ProviderNotConnectedBanner message="Cards are added through the payment provider's secure form (e.g. Stripe Elements). LUCIAN never sees or stores your full card number or CVV." />
          <div className="rounded-md border border-line-muted bg-inset/40 p-3">
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-faint" />
              <p className="text-[10.5px] leading-relaxed text-fg-muted">
                We store only: brand, last 4 digits, expiry, and a provider reference ID. Sensitive data is tokenized by the provider.
              </p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Requesting…" : "Begin Setup"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Link Bank button + modal ── */
function LinkBankButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="border-line-muted">
        <Plus className="h-3.5 w-3.5" />
        Link Bank
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-semibold text-fg">Link Bank Account</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <ProviderNotConnectedBanner message="Bank linking requires a bank provider (e.g. Plaid). Linking is done through the provider's secure flow — LUCIAN does not collect bank credentials." />
            <div className="rounded-md border border-line-muted bg-inset/40 p-3">
              <p className="text-[10.5px] leading-relaxed text-fg-muted">
                After linking, the provider returns a tokenized bank account reference. We verify via micro-deposits or instant verification before enabling withdrawals.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => { toast({ title: "Provider not connected", description: "Bank linking requires a configured provider." }); setOpen(false); }}>
              Begin Linking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Deposit Crypto button + modal ── */
function DepositCryptoButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="border-line-muted">
        <Plus className="h-3.5 w-3.5" />
        Deposit Crypto
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-semibold text-fg">Deposit Crypto</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <ProviderNotConnectedBanner message="Crypto deposits require a configured crypto provider with deposit addresses. Until then, deposit addresses shown here are illustrative only." />
            <div className="rounded-md border border-line-muted bg-inset/40 p-3">
              <p className="text-[10.5px] leading-relaxed text-fg-muted">
                Each asset/network pair has its own deposit address. Sending BTC to an ETH address will result in permanent loss. Always verify the network before sending.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["BTC", "ETH", "USDC", "SOL"] as const).map((asset) => (
                <div key={asset} className="rounded-md border border-line-muted p-2.5 themed">
                  <div className="text-[11px] font-semibold text-fg">{asset}</div>
                  <div className="mt-1 text-[10px] text-fg-muted">Provider not connected</div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Add Destination button + modal ── */
function AddDestinationButton() {
  const [open, setOpen] = useState(false);
  const store = useVaultStore();
  const sync = useVaultSync();
  const [type, setType] = useState<"bank" | "card" | "crypto">("bank");
  const [referenceId, setReferenceId] = useState("");
  const [label, setLabel] = useState("");
  const [cryptoAddress, setCryptoAddress] = useState("");
  const [cryptoAsset, setCryptoAsset] = useState<"BTC" | "ETH" | "USDC" | "SOL">("BTC");
  const [cryptoNetwork, setCryptoNetwork] = useState<"bitcoin" | "ethereum" | "solana" | "polygon" | "base" | "arbitrum">("bitcoin");

  async function handleAdd() {
    if (type === "crypto") {
      if (!cryptoAddress || !cryptoAsset || !cryptoNetwork) {
        toast({ title: "Missing fields", description: "Enter address, asset, and network.", variant: "destructive" });
        return;
      }
      if (!/^0x[a-fA-F0-9]{40}$|^bc1[a-zA-HJ-NP-Z0-9]{25,62}$|^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(cryptoAddress)) {
        toast({ title: "Invalid address", description: "Address does not match the selected network format.", variant: "destructive" });
        return;
      }
    }

    try {
      const res = await fetch("/api/vault/withdrawal-destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          referenceId: type === "crypto" ? undefined : referenceId,
          label: type === "crypto" ? `${cryptoAsset} Wallet ${cryptoAddress.slice(0, 6)}…${cryptoAddress.slice(-4)}` : label,
          asset: type === "crypto" ? cryptoAsset : "USD",
          network: type === "crypto" ? cryptoNetwork : undefined,
          address: type === "crypto" ? cryptoAddress : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Cannot add destination", description: data.error ?? "Try again.", variant: "destructive" });
        return;
      }
      toast({ title: "Destination added", description: "New destinations have a 24-hour security delay before withdrawals are allowed." });
      void sync.refreshWithdrawalDestinations();
      setOpen(false);
      setReferenceId("");
      setLabel("");
      setCryptoAddress("");
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="border-line-muted">
        <Plus className="h-3.5 w-3.5" />
        Add Destination
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-semibold text-fg">Add Withdrawal Destination</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                <SelectTrigger className="mt-1.5 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank">Bank Account</SelectItem>
                  <SelectItem value="card">Eligible Card</SelectItem>
                  <SelectItem value="crypto">Crypto Wallet</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {type === "crypto" ? (
              <>
                <div>
                  <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Asset</Label>
                  <Select value={cryptoAsset} onValueChange={(v) => setCryptoAsset(v as typeof cryptoAsset)}>
                    <SelectTrigger className="mt-1.5 w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BTC">BTC</SelectItem>
                      <SelectItem value="ETH">ETH</SelectItem>
                      <SelectItem value="USDC">USDC</SelectItem>
                      <SelectItem value="SOL">SOL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Network</Label>
                  <Select value={cryptoNetwork} onValueChange={(v) => setCryptoNetwork(v as typeof cryptoNetwork)}>
                    <SelectTrigger className="mt-1.5 w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bitcoin">Bitcoin</SelectItem>
                      <SelectItem value="ethereum">Ethereum</SelectItem>
                      <SelectItem value="solana">Solana</SelectItem>
                      <SelectItem value="polygon">Polygon</SelectItem>
                      <SelectItem value="base">Base</SelectItem>
                      <SelectItem value="arbitrum">Arbitrum</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Wallet address</Label>
                  <Input
                    value={cryptoAddress}
                    onChange={(e) => setCryptoAddress(e.target.value)}
                    placeholder="0x… or bc1…"
                    className="mt-1.5 font-mono text-[12px]"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Reference</Label>
                  <Input
                    value={referenceId}
                    onChange={(e) => setReferenceId(e.target.value)}
                    placeholder={type === "bank" ? "Select from linked banks" : "Select from eligible cards"}
                    className="mt-1.5 text-[12px]"
                  />
                </div>
                <div>
                  <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Label</Label>
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="e.g. Chase •••• 0921"
                    className="mt-1.5 text-[12px]"
                  />
                </div>
              </>
            )}

            <div className="flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 p-2">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
              <p className="text-[10px] text-amber-200/80">
                New destinations are subject to a {store.settings.security.newDestinationDelayHours}-hour security delay before withdrawals are enabled.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd}>Add Destination</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ── Auto Fund section ── */
function AutoFundSection() {
  const store = useVaultStore();
  const sync = useVaultSync();
  const config = store.autoFund;

  return (
    <VaultCard>
      <VaultCardHeader
        title="Auto Fund"
        subtitle="Automatically top up when balance is low"
        icon={<Zap className="h-4 w-4" />}
        action={
          <Switch
            checked={config.enabled}
            onCheckedChange={async (checked) => {
              if (checked && !config.providerReady) {
                toast({
                  title: "Provider setup required",
                  description: "Auto Fund cannot be enabled until a payment provider is connected.",
                  variant: "destructive",
                });
                return;
              }
              // Persist the change to the server.
              try {
                const res = await fetch("/api/vault/auto-fund", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ enabled: checked }),
                });
                if (!res.ok) {
                  const data = await res.json().catch(() => ({}));
                  toast({ title: "Auto Fund update failed", description: data.error ?? "Try again.", variant: "destructive" });
                  return;
                }
                void sync.refreshAutoFund();
              } catch {
                toast({ title: "Network error", variant: "destructive" });
              }
            }}
          />
        }
      />
      <VaultCardBody>
        {!config.providerReady && (
          <div className="mb-3">
            <ProviderNotConnectedBanner message="Auto Fund architecture is ready, but real execution requires a connected payment provider. Enabling will be rejected until provider setup is complete." />
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <AutoFundField
            label="When Available falls below"
            value={formatMoney(config.lowBalanceThreshold, "USD")}
          />
          <AutoFundField
            label="Add"
            value={formatMoney(config.topUpAmount, "USD")}
          />
          <AutoFundField
            label="Daily limit"
            value={formatMoney(config.dailyLimit, "USD")}
          />
          <AutoFundField
            label="Monthly limit"
            value={formatMoney(config.monthlyLimit, "USD")}
          />
          <AutoFundField
            label="Max single top-up"
            value={formatMoney(config.maxSingleTopUp, "USD")}
          />
          <AutoFundField
            label="Minimum trigger interval"
            value={`${(config.minTriggerIntervalMs / (60 * 1000)).toFixed(0)} minutes`}
          />
          <AutoFundField
            label="Failure retry limit"
            value={`${config.maxRetries} retries`}
          />
          <AutoFundField
            label="Funding source"
            value={
              config.fundingSourceId
                ? config.fundingSourceType === "card"
                  ? store.paymentMethods.find((m) => m.id === config.fundingSourceId)?.displayName ?? "—"
                  : store.bankAccounts.find((b) => b.id === config.fundingSourceId)?.displayName ?? "—"
                : "Not set"
            }
          />
        </div>

        <div className="mt-4 flex items-start gap-1.5 rounded border border-line-muted bg-inset/40 p-3">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-faint" />
          <p className="text-[10.5px] leading-relaxed text-fg-muted">
            Auto Fund uses idempotency protection to prevent duplicate charges from webhook loops or retries. Each top-up has a unique idempotency key and a minimum trigger interval.
          </p>
        </div>
      </VaultCardBody>
    </VaultCard>
  );
}

function AutoFundField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line-muted bg-surface p-3 themed">
      <div className="text-[10px] uppercase tracking-wider text-fg-faint">{label}</div>
      <div className="mt-1 font-mono text-[13px] font-medium text-fg">{value}</div>
    </div>
  );
}
