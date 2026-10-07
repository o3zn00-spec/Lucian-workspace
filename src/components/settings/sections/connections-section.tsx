"use client";

/* LUCIAN Settings — Connections section.
 *
 * Global external-service status center. Status only — actual
 * provider linking / configuration lives inside each module
 * (AI config, Vault, DevWorkspace).
 *
 * Vault provider state uses the honest model:
 *   not_configured → setup_required → configured → connected
 * Stub adapters NEVER show "connected" just from env keys.
 *
 * DATABASE_URL is NEVER exposed — only its availability is reported.
 */

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, Save, Trash2 } from "lucide-react";
import {
  SettingsGroup, SettingsRow, SettingsSectionHeader, StatusPill,
} from "@/components/settings/primitives";






interface VaultProvidersResult {
  stripe: { state: string; configured: boolean; detail: string };
  plaid: { state: string; configured: boolean; detail: string };
  bybit: { state: string; configured: boolean; detail: string; environment?: string };
  alpaca: { state: string; configured: boolean; detail: string };
  database: { configured: boolean };
}

export function ConnectionsSection() {
  
  const [vault, setVault] = useState<VaultProvidersResult | null>(null);

  

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/vault/providers", { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) { setVault(null); return; }
        const data = (await res.json()) as {
          providers: Array<{ id: string; name: string; type: string; configured: boolean; state: string; stateDetail?: string; environment?: string }>;
        };
        const byId = Object.fromEntries(data.providers.map((p) => [p.name, p]));
        setVault({
          stripe: { state: byId.stripe?.state ?? "not_configured", configured: byId.stripe?.configured ?? false, detail: byId.stripe?.stateDetail ?? "" },
          plaid: { state: byId.plaid?.state ?? "not_configured", configured: byId.plaid?.configured ?? false, detail: byId.plaid?.stateDetail ?? "" },
          bybit: { state: byId.bybit?.state ?? "not_configured", configured: byId.bybit?.configured ?? false, detail: byId.bybit?.stateDetail ?? "", environment: byId.bybit?.environment },
          alpaca: { state: byId.alpaca?.state ?? "not_configured", configured: byId.alpaca?.configured ?? false, detail: byId.alpaca?.stateDetail ?? "" },
          database: { configured: false }, // probed separately
        });

        // Probe database availability separately (it's not in the providers list).
        const dbRes = await fetch("/api/vault/balances", { cache: "no-store" });
        if (cancelled) return;
        if (dbRes.ok) {
          const dbData = (await dbRes.json()) as { databaseAvailable?: boolean };
          setVault((v) => v ? { ...v, database: { configured: dbData.databaseAvailable === true } } : v);
        }
      } catch {
        if (!cancelled) setVault(null);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <SettingsSectionHeader
        title="Connections"
        subtitle="Status of every external service LUCIAN can talk to. Status only — actual setup lives inside each module."
      />

      <OwnerCredentialsGroup />

      

      <SettingsGroup title="Development">
        <SettingsRow title="GitHub Public Import" description="Import a public GitHub repository as a DevWorkspace project. No authentication required.">
          <StatusPill status="ready" label="Available" />
        </SettingsRow>
        <SettingsRow title="GitHub Account" description="Private repository access requires GitHub account authentication.">
          <StatusPill status="setup_required" label="Authentication not configured" />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Market / Data">
        <SettingsRow title="Markets data provider" description="The markets data provider used by the Markets module.">
          <StatusPill status="ready" label="Available" />
        </SettingsRow>
        <SettingsRow title="News / data providers" description="News, sports, weather, and watchlist-match providers.">
          <StatusPill status="ready" label="Available" />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Vault / Finance">
        <SettingsRow
          title="Stripe"
          description="Vault payment provider (card deposits / payouts). Honest state from the Vault adapter."
        >
          <VaultStatusPill state={vault?.stripe.state ?? "not_configured"} detail={vault?.stripe.detail} />
        </SettingsRow>
        <SettingsRow
          title="Plaid"
          description="Vault bank provider (ACH deposits / withdrawals)."
        >
          <VaultStatusPill state={vault?.plaid.state ?? "not_configured"} detail={vault?.plaid.detail} />
        </SettingsRow>
        <SettingsRow
          title="Bybit"
          description={`Vault exchange for balances, deposits, withdrawals, orders and positions${vault?.bybit.environment ? ` · ${vault.bybit.environment}` : ""}.`}
        >
          <VaultStatusPill state={vault?.bybit.state ?? "not_configured"} detail={vault?.bybit.detail} />
        </SettingsRow>
        <SettingsRow
          title="Alpaca"
          description="Vault broker provider (trading / funding)."
        >
          <VaultStatusPill state={vault?.alpaca.state ?? "not_configured"} detail={vault?.alpaca.detail} />
        </SettingsRow>
        <SettingsRow
          title="Database / Neon"
          description="Postgres connection for the Vault financial ledger. The DATABASE_URL value is never exposed."
        >
          {vault?.database.configured
            ? <StatusPill status="configured" label="Database configured" />
            : <StatusPill status="not_configured" label="Database not configured" />}
        </SettingsRow>
        <div className="py-2 text-[11px] text-fg-muted">
          Stub Vault providers never display &quot;Connected&quot; — they show &quot;Integration required&quot; until the real SDK is installed AND the user completes the provider-side link flow. API keys alone do NOT enable a stub provider.
        </div>
      </SettingsGroup>
    </div>
  );
}

interface CredentialStatus {
  service: string;
  key: string;
  label: string;
  configured: boolean;
  updatedAt: string | null;
}

function OwnerCredentialsGroup() {
  const [credentials, setCredentials] = useState<CredentialStatus[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/owner/credentials", { cache: "no-store" });
      const data = await response.json() as { ok?: boolean; credentials?: CredentialStatus[] };
      if (response.ok && data.ok) setCredentials(data.credentials ?? []);
    } catch {
      setMessage("Credential status is unavailable.");
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(id);
  }, [load]);

  async function save(item: CredentialStatus) {
    const id = `${item.service}:${item.key}`;
    const value = values[id]?.trim();
    if (!value) return;
    setBusy(id);
    setMessage(null);
    try {
      const response = await fetch("/api/owner/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: item.service, key: item.key, value }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Credential was not saved.");
      setValues((current) => ({ ...current, [id]: "" }));
      setMessage(`${item.label} saved in encrypted owner storage.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Credential was not saved.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(item: CredentialStatus) {
    const id = `${item.service}:${item.key}`;
    setBusy(id);
    setMessage(null);
    try {
      const response = await fetch(`/api/owner/credentials?service=${encodeURIComponent(item.service)}&key=${encodeURIComponent(item.key)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Credential was not removed.");
      setMessage(`${item.label} removed.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Credential was not removed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsGroup title="Owner Credentials">
      <div className="mb-2 flex items-start gap-2 rounded-md border border-line bg-inset/40 px-3 py-2 text-[11px] text-fg-muted">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
        Bybit secrets are encrypted on the server with AES-256-GCM. Saved values are never returned to the browser.
      </div>
      {credentials.map((item) => {
        const id = `${item.service}:${item.key}`;
        return (
          <SettingsRow
            key={id}
            title={item.label}
            description={item.configured ? `Encrypted · updated ${item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "recently"}` : "Not stored"}
          >
            <div className="flex items-center gap-1.5">
              <input
                type={item.key === "environment" ? "text" : "password"}
                value={values[id] ?? ""}
                onChange={(event) => setValues((current) => ({ ...current, [id]: event.target.value }))}
                placeholder={item.key === "environment" ? "testnet or mainnet" : item.configured ? "Enter replacement" : "Enter secret"}
                autoComplete="off"
                className="w-40 rounded-md border border-line bg-inset px-2 py-1 text-[11px] text-fg outline-none focus:border-[var(--accent)]"
              />
              <button
                type="button"
                onClick={() => void save(item)}
                disabled={busy === id || !(values[id] ?? "").trim()}
                aria-label={`Save ${item.label}`}
                className="rounded-md border border-line bg-surface p-1.5 text-fg hover:bg-hover disabled:opacity-40"
              >
                {busy === id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              </button>
              {item.configured && (
                <button
                  type="button"
                  onClick={() => void remove(item)}
                  disabled={busy === id}
                  aria-label={`Remove ${item.label}`}
                  className="rounded-md border border-line bg-surface p-1.5 text-red-400 hover:bg-hover disabled:opacity-40"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          </SettingsRow>
        );
      })}
      {credentials.length === 0 && <div className="py-2 text-[11px] text-fg-muted">Credential storage requires the owner database and session.</div>}
      {message && <div className="py-2 text-[11px] text-fg-muted" role="status">{message}</div>}
    </SettingsGroup>
  );
}

/* ── Helpers ── */

function VaultStatusPill({ state, detail }: { state: string; detail?: string }) {
  switch (state) {
    case "connected":      return <StatusPill status="ready" label="Connected" />;
    case "configured":     return <StatusPill status="configured" label="Configured" />;
    case "setup_required": return <StatusPill status="setup_required" label="Integration required" />;
    case "connecting":     return <StatusPill status="configured" label="Connecting…" />;
    case "restricted":     return <StatusPill status="error" label="Restricted" />;
    case "error":          return <StatusPill status="error" label="Error" />;
    case "not_configured":
    default:               return <StatusPill status="not_configured" label={detail || "Not configured"} />;
  }
}
