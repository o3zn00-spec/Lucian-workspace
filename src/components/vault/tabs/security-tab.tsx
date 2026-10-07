"use client";

// Vault Security tab — financial security controls.
//
// Includes:
//   - Require withdrawal verification
//   - 2FA requirement (placeholder/hook until auth exists)
//   - New destination delay
//   - Daily fiat withdrawal limit
//   - Daily crypto withdrawal limit
//   - Large transaction alert
//   - Crypto address allowlist
//   - New-device withdrawal restriction
//   - Auto Fund limits
//   - Mask sensitive balances

import { useState } from "react";
import {
  Shield, Lock, Clock, AlertCircle, Plus, Trash2, Smartphone, Eye, Key, Fingerprint,
} from "lucide-react";
import { useVaultStore } from "@/store/vault";
import { useVaultSync } from "@/components/vault/vault-sync-context";
import { VaultCard, VaultCardHeader, VaultCardBody, ProviderNotConnectedBanner, VaultEmptyState } from "../primitives";
import { Button } from "@/components/ui-devspace/button";
import { Input } from "@/components/ui-devspace/input";
import { Label } from "@/components/ui-devspace/label";
import { Switch } from "@/components/ui-devspace/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui-devspace/dialog";
import { toast } from "@/hooks/use-toast";

export function SecurityTab() {
  const store = useVaultStore();
  const sync = useVaultSync();
  const security = store.settings.security;

  /**
   * Persist a security-settings patch to the server, then refresh the
   * local cache from the server response. Falls back to local-only
   * update if the server is unavailable.
   */
  async function persistSecurityPatch(patch: Partial<typeof security>) {
    // Optimistic local update so the UI feels responsive.
    store.updateSecurity(patch);
    try {
      const res = await fetch("/api/vault/security", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({ title: "Security update failed", description: data.error ?? "Server rejected the update.", variant: "destructive" });
        // Revert by refreshing from server.
        void sync.refreshSecurity();
        return;
      }
      void sync.refreshSecurity();
    } catch {
      toast({ title: "Network error — security update may not be persisted", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-5">
      {/* Auth status banner */}
      <VaultCard>
        <VaultCardHeader
          title="Security Status"
          subtitle="Account-level security for real-money operations"
          icon={<Shield className="h-4 w-4" />}
        />
        <VaultCardBody>
          {!security.twoFactorConfigured && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 themed">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
              <div className="flex-1">
                <p className="text-[11.5px] font-semibold text-amber-200">Requires account security setup</p>
                <p className="mt-0.5 text-[10.5px] text-amber-200/80">
                  Two-factor authentication is not yet configured. Until 2FA is enabled via the authentication system, real-money withdrawals may be blocked or require additional verification.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="border-amber-500/30 text-amber-200"
                onClick={() => toast({ title: "Auth Phase 16 required", description: "2FA setup will be available when the authentication system is configured." })}
              >
                Set Up 2FA
              </Button>
            </div>
          )}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <SecurityStatusCard
              label="2FA"
              status={security.twoFactorConfigured ? "Enabled" : "Not Set"}
              ok={security.twoFactorConfigured}
              icon={<Smartphone className="h-4 w-4" />}
            />
            <SecurityStatusCard
              label="Withdrawal Verification"
              status={security.requireWithdrawalVerification ? "Required" : "Optional"}
              ok={security.requireWithdrawalVerification}
              icon={<Key className="h-4 w-4" />}
            />
            <SecurityStatusCard
              label="New-Device Lock"
              status={security.newDeviceWithdrawalRestriction ? "Active" : "Disabled"}
              ok={security.newDeviceWithdrawalRestriction}
              icon={<Fingerprint className="h-4 w-4" />}
            />
          </div>
        </VaultCardBody>
      </VaultCard>

      {/* Withdrawal security */}
      <VaultCard>
        <VaultCardHeader
          title="Withdrawal Security"
          subtitle="Controls applied to all withdrawal requests"
          icon={<Lock className="h-4 w-4" />}
        />
        <VaultCardBody>
          <div className="space-y-3">
            <SecurityToggle
              label="Require withdrawal verification"
              description="Each withdrawal requires explicit user verification before submission."
              checked={security.requireWithdrawalVerification}
              onChange={(v) => persistSecurityPatch({ requireWithdrawalVerification: v })}
            />
            <SecurityToggle
              label="New-device withdrawal restriction"
              description="Block withdrawals from unrecognized devices until verified."
              checked={security.newDeviceWithdrawalRestriction}
              onChange={(v) => persistSecurityPatch({ newDeviceWithdrawalRestriction: v })}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <NumberField
                label="New destination delay (hours)"
                value={security.newDestinationDelayHours}
                onChange={(v) => persistSecurityPatch({ newDestinationDelayHours: Math.max(0, v) })}
                icon={<Clock className="h-3.5 w-3.5" />}
              />
              <NumberField
                label="Large transaction alert threshold"
                value={security.largeTransactionThreshold}
                onChange={(v) => persistSecurityPatch({ largeTransactionThreshold: Math.max(0, v) })}
                prefix="$"
              />
              <NumberField
                label="Daily fiat withdrawal limit"
                value={security.dailyFiatWithdrawalLimit}
                onChange={(v) => persistSecurityPatch({ dailyFiatWithdrawalLimit: Math.max(0, v) })}
                prefix="$"
              />
              <NumberField
                label="Daily crypto withdrawal limit (fiat eq.)"
                value={security.dailyCryptoWithdrawalLimitFiat}
                onChange={(v) => persistSecurityPatch({ dailyCryptoWithdrawalLimitFiat: Math.max(0, v) })}
                prefix="$"
              />
            </div>
          </div>
        </VaultCardBody>
      </VaultCard>

      {/* Crypto allowlist */}
      <VaultCard>
        <VaultCardHeader
          title="Crypto Address Allowlist"
          subtitle="Approved withdrawal addresses for crypto"
          icon={<Shield className="h-4 w-4" />}
          action={<AddAddressButton />}
        />
        <VaultCardBody>
          {security.cryptoAddressAllowlist.length === 0 ? (
            <VaultEmptyState
              title="No allowlisted addresses"
              description="When the allowlist is populated, only these addresses can receive crypto withdrawals."
              icon={<Shield className="h-6 w-6" />}
            />
          ) : (
            <div className="space-y-2">
              {security.cryptoAddressAllowlist.map((entry, idx) => (
                <div key={idx} className="flex items-center gap-3 rounded-md border border-line-muted bg-surface p-3 themed">
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-fg">{entry.label}</div>
                    <code className="block font-mono text-[10.5px] text-fg-muted truncate">{entry.address}</code>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-red-400"
                    onClick={() => {
                      const next = security.cryptoAddressAllowlist.filter((_, i) => i !== idx);
                      void persistSecurityPatch({ cryptoAddressAllowlist: next });
                      toast({ title: "Address removed" });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </VaultCardBody>
      </VaultCard>

      {/* Display security */}
      <VaultCard>
        <VaultCardHeader
          title="Display Security"
          subtitle="Privacy controls for the Vault UI"
          icon={<Eye className="h-4 w-4" />}
        />
        <VaultCardBody>
          <div className="space-y-3">
            <SecurityToggle
              label="Mask sensitive balances"
              description="Replace exact balance values with rough magnitudes (e.g. $12K+)."
              checked={security.maskSensitiveValues}
              onChange={(v) => persistSecurityPatch({ maskSensitiveValues: v })}
            />
            <NumberField
              label="Session timeout (minutes)"
              value={security.sessionTimeoutMin}
              onChange={(v) => persistSecurityPatch({ sessionTimeoutMin: Math.max(1, v) })}
              icon={<Clock className="h-3.5 w-3.5" />}
            />
          </div>
        </VaultCardBody>
      </VaultCard>

      {/* Auto Fund limits */}
      <VaultCard>
        <VaultCardHeader
          title="Auto Fund Limits"
          subtitle="Safety limits applied to automated top-ups"
          icon={<AlertCircle className="h-4 w-4" />}
        />
        <VaultCardBody>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NumberField
              label="Daily limit"
              value={store.autoFund.dailyLimit}
              onChange={(v) => store.setAutoFund({ ...store.autoFund, dailyLimit: Math.max(0, v) })}
              prefix="$"
            />
            <NumberField
              label="Monthly limit"
              value={store.autoFund.monthlyLimit}
              onChange={(v) => store.setAutoFund({ ...store.autoFund, monthlyLimit: Math.max(0, v) })}
              prefix="$"
            />
            <NumberField
              label="Max single top-up"
              value={store.autoFund.maxSingleTopUp}
              onChange={(v) => store.setAutoFund({ ...store.autoFund, maxSingleTopUp: Math.max(0, v) })}
              prefix="$"
            />
            <NumberField
              label="Failure retry limit"
              value={store.autoFund.maxRetries}
              onChange={(v) => store.setAutoFund({ ...store.autoFund, maxRetries: Math.max(0, v) })}
            />
          </div>
          <div className="mt-3 flex items-start gap-1.5 rounded border border-line-muted bg-inset/40 p-2.5">
            <Shield className="mt-0.5 h-3 w-3 shrink-0 text-fg-faint" />
            <p className="text-[10.5px] leading-relaxed text-fg-muted">
              Auto Fund uses idempotency keys for every top-up. Duplicate webhooks or retry loops cannot cause duplicate charges.
            </p>
          </div>
        </VaultCardBody>
      </VaultCard>
    </div>
  );
}

function SecurityStatusCard({ label, status, ok, icon }: { label: string; status: string; ok: boolean; icon: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line-muted bg-surface p-3 themed">
      <div className="flex items-center gap-2">
        <span className={ok ? "text-emerald-400" : "text-amber-400"}>{icon}</span>
        <span className="text-[11px] font-medium text-fg">{label}</span>
      </div>
      <div className={`mt-1 text-[12px] font-semibold ${ok ? "text-emerald-400" : "text-amber-400"}`}>
        {status}
      </div>
    </div>
  );
}

function SecurityToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-line-muted bg-surface p-3 themed">
      <div className="flex-1">
        <div className="text-[12px] font-medium text-fg">{label}</div>
        <div className="mt-0.5 text-[10.5px] text-fg-muted">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  prefix,
  icon,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-[11px] uppercase tracking-wider text-fg-muted">{label}</Label>
      <div className="relative mt-1.5">
        {prefix && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-fg-muted">{prefix}</span>
        )}
        {icon && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted">{icon}</span>
        )}
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className={`${(prefix || icon) ? "pl-7" : ""} font-mono text-[12px]`}
        />
      </div>
    </div>
  );
}

function AddAddressButton() {
  const store = useVaultStore();
  const sync = useVaultSync();
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");

  async function handleAdd() {
    if (!address.trim()) {
      toast({ title: "Address required", variant: "destructive" });
      return;
    }
    if (!label.trim()) {
      toast({ title: "Label required", variant: "destructive" });
      return;
    }
    const next = [...store.settings.security.cryptoAddressAllowlist, { address: address.trim(), label: label.trim() }];
    try {
      const res = await fetch("/api/vault/security", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cryptoAddressAllowlist: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({ title: "Could not add to allowlist", description: data.error ?? "Try again.", variant: "destructive" });
        return;
      }
      toast({ title: "Address added to allowlist" });
      void sync.refreshSecurity();
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    }
    setAddress("");
    setLabel("");
    setOpen(false);
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="border-line-muted">
        <Plus className="h-3.5 w-3.5" />
        Add Address
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-semibold text-fg">Add to Allowlist</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Label</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. BTC Cold Wallet" className="mt-1.5 text-[12px]" />
            </div>
            <div>
              <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Address</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="0x… or bc1…" className="mt-1.5 font-mono text-[11px]" />
            </div>
            <div className="flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 p-2">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
              <p className="text-[10px] text-amber-200/80">
                Allowlisted addresses still require the new-destination security delay before they can be used.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
