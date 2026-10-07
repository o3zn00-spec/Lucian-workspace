"use client";

// Vault Accounts tab — splits accounts into:
//   CONNECTED / PROVIDER VERIFIED
//   MANUAL / SELF REPORTED
//
// Manual balances are never presented as provider-verified.

import { useState } from "react";
import {
  Plus, Landmark, Wallet, Bitcoin, TrendingUp, Edit3, Trash2,
  X, AlertCircle,
} from "lucide-react";
import {
  useVaultStore, formatMoney, type VaultAccountType, type ConnectedAccount,
} from "@/store/vault";
import { VaultCard, VaultCardHeader, VaultCardBody, SourceBadge, VaultEmptyState } from "../primitives";
import { Button } from "@/components/ui-devspace/button";
import { Input } from "@/components/ui-devspace/input";
import { Label } from "@/components/ui-devspace/label";
import { Textarea } from "@/components/ui-devspace/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui-devspace/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui-devspace/dialog";
import { toast } from "@/hooks/use-toast";

const CURRENCIES = ["USD", "EUR", "GBP", "JPY"];

const ACCOUNT_TYPES: { id: VaultAccountType; label: string }[] = [
  { id: "bank", label: "Bank" },
  { id: "card", label: "Card" },
  { id: "crypto-wallet", label: "Crypto Wallet" },
  { id: "brokerage", label: "Brokerage" },
  { id: "trading", label: "Trading" },
];

export function AccountsTab({
  hideBalances,
  maskSensitive,
}: {
  hideBalances: boolean;
  maskSensitive: boolean;
}) {
  const store = useVaultStore();
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const providerAccounts = store.accounts.filter((a) => a.source === "provider");
  const manualAccounts = store.accounts.filter((a) => a.source === "manual");

  function fmt(amount: number, currency: string) {
    if (hideBalances) return "••••••";
    if (maskSensitive) return maskNum(amount);
    return formatMoney(amount, currency);
  }

  return (
    <div className="space-y-5">
      {/* Provider-verified */}
      <VaultCard>
        <VaultCardHeader
          title="Connected"
          subtitle="Provider-verified accounts"
          icon={<Landmark className="h-4 w-4" />}
        />
        <VaultCardBody>
          {providerAccounts.length === 0 ? (
            <VaultEmptyState
              title="No provider-connected accounts"
              description="Connect a payment, bank, crypto, or brokerage provider to see verified accounts here. Until then, all accounts are manual."
              icon={<AlertCircle className="h-6 w-6" />}
            />
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {providerAccounts.map((acc) => (
                <AccountCard
                  key={acc.id}
                  account={acc}
                  displayBalance={fmt(acc.balance, acc.currency)}
                  onEdit={() => setEditId(acc.id)}
                  onDelete={() => setConfirmDeleteId(acc.id)}
                />
              ))}
            </div>
          )}
        </VaultCardBody>
      </VaultCard>

      {/* Manual / self-reported */}
      <VaultCard>
        <VaultCardHeader
          title="Manual"
          subtitle="Self-reported accounts · Not provider-verified"
          icon={<Wallet className="h-4 w-4" />}
          action={
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add Manual Account
            </Button>
          }
        />
        <VaultCardBody>
          {manualAccounts.length === 0 ? (
            <VaultEmptyState
              title="No manual accounts"
              description="Add a manual account to track self-reported balances. Manual accounts are clearly labeled and never appear as provider-verified."
              action={<Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-3.5 w-3.5" />Add Manual Account</Button>}
            />
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {manualAccounts.map((acc) => (
                <AccountCard
                  key={acc.id}
                  account={acc}
                  displayBalance={fmt(acc.balance, acc.currency)}
                  onEdit={() => setEditId(acc.id)}
                  onDelete={() => setConfirmDeleteId(acc.id)}
                />
              ))}
            </div>
          )}
        </VaultCardBody>
      </VaultCard>

      {/* Add modal */}
      <AddAccountModal open={addOpen} onClose={() => setAddOpen(false)} />
      {/* Edit modal */}
      {editId && (
        <EditAccountModal
          account={store.getAccountById(editId)!}
          open={!!editId}
          onClose={() => setEditId(null)}
        />
      )}
      {/* Delete confirm */}
      <Dialog open={!!confirmDeleteId} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-[14px] font-semibold text-fg">Remove Account</DialogTitle>
          </DialogHeader>
          <p className="text-[12px] text-fg-muted">
            This will remove the account from your Vault. Transaction history referencing this account will be preserved.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (confirmDeleteId) {
                  store.removeAccount(confirmDeleteId);
                  toast({ title: "Account removed" });
                  setConfirmDeleteId(null);
                }
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AccountCard({
  account,
  displayBalance,
  onEdit,
  onDelete,
}: {
  account: ConnectedAccount;
  displayBalance: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-md border border-line-muted bg-surface p-3 themed">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-inset text-fg-muted">
            {account.type === "bank" && <Landmark className="h-4 w-4" />}
            {account.type === "card" && <Wallet className="h-4 w-4" />}
            {account.type === "crypto-wallet" && <Bitcoin className="h-4 w-4" />}
            {account.type === "brokerage" && <TrendingUp className="h-4 w-4" />}
            {account.type === "trading" && <TrendingUp className="h-4 w-4" />}
          </div>
          <div>
            <div className="text-[12.5px] font-medium text-fg">{account.label}</div>
            <div className="text-[10.5px] text-fg-muted">•••• {account.maskedIdentifier}</div>
          </div>
        </div>
        <SourceBadge source={account.source} />
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-fg-faint">Balance</div>
          <div className="font-mono text-[16px] font-semibold text-fg">{displayBalance}</div>
        </div>
        {account.source === "manual" && (
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" onClick={onEdit} className="h-7 w-7">
              <Edit3 className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" onClick={onDelete} className="h-7 w-7 text-red-400 hover:text-red-500">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
      {account.provider && (
        <div className="mt-2 text-[10px] text-fg-faint">{account.provider}</div>
      )}
    </div>
  );
}

function AccountFormFields({
  values,
  onChange,
}: {
  values: {
    label: string;
    type: VaultAccountType;
    provider: string;
    maskedIdentifier: string;
    balance: string;
    currency: string;
    note: string;
  };
  onChange: (patch: Partial<typeof values>) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Label</Label>
        <Input
          value={values.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="e.g. Chase Checking"
          className="mt-1.5 text-[12px]"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Type</Label>
          <Select value={values.type} onValueChange={(v) => onChange({ type: v as VaultAccountType })}>
            <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ACCOUNT_TYPES.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Currency</Label>
          <Select value={values.currency} onValueChange={(v) => onChange({ currency: v })}>
            <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Institution / Provider (descriptive)</Label>
        <Input
          value={values.provider}
          onChange={(e) => onChange({ provider: e.target.value })}
          placeholder="e.g. Chase, Bybit, Fidelity"
          className="mt-1.5 text-[12px]"
        />
      </div>
      <div>
        <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Last 4 (mask)</Label>
        <Input
          value={values.maskedIdentifier}
          onChange={(e) => onChange({ maskedIdentifier: e.target.value })}
          placeholder="e.g. 0921"
          maxLength={6}
          className="mt-1.5 font-mono text-[12px]"
        />
      </div>
      <div>
        <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Self-reported balance</Label>
        <Input
          type="number"
          inputMode="decimal"
          value={values.balance}
          onChange={(e) => onChange({ balance: e.target.value })}
          placeholder="0.00"
          className="mt-1.5 font-mono text-[12px]"
        />
      </div>
      <div>
        <Label className="text-[11px] uppercase tracking-wider text-fg-muted">Note (optional)</Label>
        <Textarea
          value={values.note}
          onChange={(e) => onChange({ note: e.target.value })}
          placeholder="Any additional context"
          className="mt-1.5 text-[12px]"
          rows={2}
        />
      </div>
      <div className="flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/5 p-2">
        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
        <p className="text-[10px] text-amber-200/80">
          Manual accounts are self-reported and clearly labeled. They are never presented as provider-verified.
        </p>
      </div>
    </div>
  );
}

function AddAccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useVaultStore();
  const [values, setValues] = useState({
    label: "",
    type: "bank" as VaultAccountType,
    provider: "",
    maskedIdentifier: "",
    balance: "",
    currency: "USD",
    note: "",
  });

  function handleSubmit() {
    if (!values.label.trim()) {
      toast({ title: "Label required", variant: "destructive" });
      return;
    }
    const balance = parseFloat(values.balance) || 0;
    if (balance < 0) {
      toast({ title: "Invalid balance", description: "Balance cannot be negative.", variant: "destructive" });
      return;
    }
    store.addAccount({
      label: values.label.trim(),
      type: values.type,
      source: "manual",
      provider: values.provider.trim() || "Manual",
      maskedIdentifier: values.maskedIdentifier.trim() || "—",
      balance,
      currency: values.currency,
      note: values.note.trim() || undefined,
    });
    toast({ title: "Account added", description: "Manual account created." });
    setValues({ label: "", type: "bank", provider: "", maskedIdentifier: "", balance: "", currency: "USD", note: "" });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold text-fg">Add Manual Account</DialogTitle>
        </DialogHeader>
        <AccountFormFields values={values} onChange={(patch) => setValues((v) => ({ ...v, ...patch }))} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>Add Account</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditAccountModal({
  account,
  open,
  onClose,
}: {
  account: ConnectedAccount;
  open: boolean;
  onClose: () => void;
}) {
  const store = useVaultStore();
  const [values, setValues] = useState({
    label: account.label,
    type: account.type,
    provider: account.provider,
    maskedIdentifier: account.maskedIdentifier,
    balance: String(account.balance),
    currency: account.currency,
    note: account.note ?? "",
  });

  function handleSave() {
    if (!values.label.trim()) {
      toast({ title: "Label required", variant: "destructive" });
      return;
    }
    const balance = parseFloat(values.balance) || 0;
    if (balance < 0) {
      toast({ title: "Invalid balance", description: "Balance cannot be negative.", variant: "destructive" });
      return;
    }
    store.editAccount(account.id, {
      label: values.label.trim(),
      type: values.type,
      provider: values.provider.trim() || "Manual",
      maskedIdentifier: values.maskedIdentifier.trim() || "—",
      balance,
      currency: values.currency,
      note: values.note.trim() || undefined,
    });
    toast({ title: "Account updated" });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-[15px] font-semibold text-fg">Edit Account</DialogTitle>
        </DialogHeader>
        <AccountFormFields values={values} onChange={(patch) => setValues((v) => ({ ...v, ...patch }))} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function maskNum(amount: number): string {
  if (amount === 0) return "$0.00";
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(amount))));
  return `$${(amount / magnitude).toFixed(1)}K+`;
}
