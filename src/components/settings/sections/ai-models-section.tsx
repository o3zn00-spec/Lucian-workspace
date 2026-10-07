"use client";

/* LUCIAN Settings — AI & Models section.
 *
 * Uses the EXISTING shared AI config (`useSharedAIConfig`). Does NOT
 * create a duplicate AI configuration store. Settings reads/writes
 * the real store; the rest of LUCIAN reads from the same store.
 *
 * Sections:
 *   - Global AI Default (provider + model + Test Connection)
 *   - Capability Overrides (general / economic / coding)
 *   - Behavior (response style, context level, remember conversations,
 *     allow project context) — stored in useSettingsStore
 *   - Provider Status (configured state of each AI provider; never secrets)
 */

import { useCallback, useEffect, useState } from "react";
import { Sparkles, Check, Loader2, Trash2, RefreshCw } from "lucide-react";
import { useSharedAIConfig, PROVIDERS, getProviderInfo, type ProviderId, type InterfaceId } from "@/store/shared-ai-config";
import { useSettingsStore } from "@/store/settings";
import {
  SettingsGroup, SettingsRow, SettingsSectionHeader, StatusPill,
} from "@/components/settings/primitives";
import { Switch } from "@/components/ui-devspace/switch";
import { Input } from "@/components/ui-devspace/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui-devspace/select";
import { Button } from "@/components/ui-devspace/button";
import { toast } from "@/hooks/use-toast";

interface InterfaceMeta {
  id: InterfaceId;
  label: string;
  description: string;
}

const INTERFACES: InterfaceMeta[] = [
  { id: "lilith",            label: "Lilthe · General",  description: "General conversation and companionship capability." },
  { id: "economic-agent",   label: "Lilthe · Economic", description: "Economic analysis and research capability." },
  { id: "dev-workspace-agent", label: "Lilthe · Coding", description: "Coding capability with controlled project tools." },
];

export function AiModelsSection() {
  const shared = useSharedAIConfig();
  const aiBehavior = useSettingsStore((s) => s.aiBehavior);
  const setAIBehavior = useSettingsStore((s) => s.setAIBehavior);

  const [testing, setTesting] = useState(false);
  const [connectionResult, setConnectionResult] = useState("");
  const [memoryEntries, setMemoryEntries] = useState<{ id: string; scope: string; key: string; value: string }[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryKey, setMemoryKey] = useState("");
  const [memoryValue, setMemoryValue] = useState("");
  const [memoryScope, setMemoryScope] = useState("global");
  const [confirmClearMemory, setConfirmClearMemory] = useState(false);

  const loadMemory = useCallback(async () => {
    setMemoryLoading(true);
    try {
      const response = await fetch("/api/user/agent-memory", { credentials: "same-origin" });
      const data = await response.json() as { ok?: boolean; entries?: { id: string; scope: string; key: string; value: string }[]; error?: string };
      if (response.ok && data.ok) setMemoryEntries(data.entries ?? []);
      else if (response.status !== 401) toast({ title: "Memory unavailable", description: data.error ?? "Could not load Lilthe memory.", variant: "destructive" });
    } catch {
      toast({ title: "Memory unavailable", description: "Could not reach the memory service.", variant: "destructive" });
    } finally {
      setMemoryLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => { void loadMemory(); }, 0);
    return () => window.clearTimeout(id);
  }, [loadMemory]);

  async function saveMemory() {
    if (!memoryKey.trim() || !memoryValue.trim()) return;
    const response = await fetch("/api/user/agent-memory", {
      method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: memoryScope, key: memoryKey.trim(), value: memoryValue.trim() }),
    });
    const data = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || !data.ok) {
      toast({ title: "Memory not saved", description: data.error ?? "Sign in as the owner to manage persistent memory.", variant: "destructive" });
      return;
    }
    setMemoryKey("");
    setMemoryValue("");
    await loadMemory();
  }

  async function deleteMemory(id: string) {
    const response = await fetch(`/api/user/agent-memory?id=${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
    if (response.ok) setMemoryEntries((entries) => entries.filter((entry) => entry.id !== id));
  }

  async function clearMemory() {
    const response = await fetch("/api/user/agent-memory", { method: "DELETE", credentials: "same-origin" });
    if (response.ok) {
      setMemoryEntries([]);
      setConfirmClearMemory(false);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    setConnectionResult("");
    try {
      const res = await fetch("/api/economic-agent/test", {
        method: "POST",
        signal: AbortSignal.timeout(45_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: shared.globalProvider, model: shared.globalModel }),
      });
      const data = await res.json() as { success: boolean; message: string; reason?: string };
      setConnectionResult(`${data.message ?? "Connection test finished"}${data.reason ? ": " + data.reason : ""}`);
      if (data.success) {
        toast({ title: "Connection OK", description: `${shared.globalProvider} / ${shared.globalModel} responded successfully.` });
      } else {
        toast({
          title: "Connection failed",
          description: data.reason ?? data.message ?? "Provider is not reachable.",
          variant: "destructive",
        });
      }
    } catch {
      setConnectionResult("Connection check unavailable. Please retry when the service responds.");
      toast({ title: "Network error", description: "Could not reach the test endpoint.", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div>
      <SettingsSectionHeader
        title="AI & Models"
        subtitle="Configure LUCIAN's intelligence providers. API keys are encrypted on the server and are never shown here."
      />

      <SettingsGroup title="Global AI Default">
        <SettingsRow title="Provider" description="Default AI provider for all interfaces unless they have an override.">
          <Select
            value={shared.globalProvider}
            onValueChange={(v) => shared.setGlobalProvider(v as ProviderId)}
          >
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PROVIDERS.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow title="Model" description="Default model identifier.">
          <Input
            value={shared.globalModel}
            onChange={(e) => shared.setGlobalModel(e.target.value)}
            placeholder={getProviderInfo(shared.globalProvider).modelPlaceholder}
            className="w-56"
          />
        </SettingsRow>
        <SettingsRow title="Status" description="Server-side configured state of the current default provider.">
          <ProviderStatusPill provider={shared.globalProvider} />
        </SettingsRow>
        <SettingsRow title="Test Connection" description="Verify the configured AI provider is reachable. Never sends your API key to the browser.">
          <Button onClick={handleTestConnection} disabled={testing} size="sm" variant="outline">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {testing ? "Testing…" : "Test Connection"}
          </Button>
        </SettingsRow>
      </SettingsGroup>

      {connectionResult && <p role="status" className="px-4 py-2 text-sm text-fg-muted">{connectionResult}</p>}
      <SettingsGroup title="Interface Overrides">
        {INTERFACES.map((iface) => {
          const override = shared.overrides[iface.id];
          const usingGlobal = !override;
          return (
            <div key={iface.id} className="border-t border-line-muted/50 py-3 first:border-t-0">
              <SettingsRow
                title={iface.label}
                description={iface.description}
              >
                <Switch
                  checked={!usingGlobal}
                  onCheckedChange={(checked) => {
                    if (!checked) {
                      shared.setOverride(iface.id, null);
                    } else {
                      // Initialize override with the current global values.
                      shared.setOverride(iface.id, {
                        provider: shared.globalProvider,
                        model: shared.globalModel,
                      });
                    }
                  }}
                />
              </SettingsRow>
              {!usingGlobal && override && (
                <div className="ml-4 mt-1 space-y-2 border-l-2 border-line-muted pl-4">
                  <SettingsRow title="Provider" description={`${iface.label} provider override.`}>
                    <Select
                      value={override.provider}
                      onValueChange={(v) => shared.setOverride(iface.id, { provider: v as ProviderId, model: override.model })}
                    >
                      <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PROVIDERS.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </SettingsRow>
                  <SettingsRow title="Model" description={`${iface.label} model override.`}>
                    <Input
                      value={override.model}
                      onChange={(e) => shared.setOverride(iface.id, { provider: override.provider, model: e.target.value })}
                      placeholder={getProviderInfo(override.provider).modelPlaceholder}
                      className="w-56"
                    />
                  </SettingsRow>
                </div>
              )}
              {usingGlobal && (
                <div className="ml-4 mt-1 flex items-center gap-1.5 text-[11px] text-fg-muted">
                  <Check className="h-3 w-3" /> Using global default ({shared.globalProvider} / {shared.globalModel})
                </div>
              )}
            </div>
          );
        })}
      </SettingsGroup>

      <SettingsGroup title="Behavior">
        <SettingsRow title="Response style" description="Concise / Balanced / Detailed.">
          <Select
            value={aiBehavior.responseStyle}
            onValueChange={(v) => setAIBehavior({ responseStyle: v as typeof aiBehavior.responseStyle })}
          >
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="concise">Concise</SelectItem>
              <SelectItem value="balanced">Balanced</SelectItem>
              <SelectItem value="detailed">Detailed</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow title="Context level" description="Light / Standard / Extended.">
          <Select
            value={aiBehavior.contextLevel}
            onValueChange={(v) => setAIBehavior({ contextLevel: v as typeof aiBehavior.contextLevel })}
          >
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="standard">Standard</SelectItem>
              <SelectItem value="extended">Extended</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow title="Conversation memory" description="Allow Lilthe to use persistent history and owner-approved personal memory across capabilities.">
          <Switch
            checked={aiBehavior.rememberConversations}
            onCheckedChange={(v) => setAIBehavior({ rememberConversations: v })}
          />
        </SettingsRow>
        <SettingsRow title="Allow coding project context" description="Let Lilthe use project files while her coding capability is active.">
          <Switch
            checked={aiBehavior.allowProjectContext}
            onCheckedChange={(v) => setAIBehavior({ allowProjectContext: v })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Lilthe Memory — Owner Controls">
        <div className="space-y-3 py-2">
          <p className="text-[11px] text-fg-muted">
            These are bounded facts and preferences Lilthe may use across every capability. Full transcripts, project files, account numbers, and balances are not stored here.
          </p>
          <div className="grid gap-2 sm:grid-cols-[120px_1fr_1.5fr_auto]">
            <select value={memoryScope} onChange={(event) => setMemoryScope(event.target.value)} className="rounded border border-line bg-surface px-2 py-1.5 text-xs text-fg">
              <option value="global">Global</option>
              <option value="personal">Personal</option>
            </select>
            <Input value={memoryKey} onChange={(event) => setMemoryKey(event.target.value)} placeholder="Key, e.g. preferred_name" />
            <Input value={memoryValue} onChange={(event) => setMemoryValue(event.target.value)} placeholder="What Lilthe should remember" />
            <Button size="sm" onClick={() => void saveMemory()} disabled={!memoryKey.trim() || !memoryValue.trim()}>Remember</Button>
          </div>
          <div className="overflow-hidden rounded-md border border-line-muted">
            <div className="flex items-center justify-between border-b border-line-muted bg-surface-2 px-3 py-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">Stored memory · {memoryEntries.length}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => void loadMemory()} disabled={memoryLoading} className="focus-ring rounded p-1 text-fg-faint hover:bg-hover hover:text-fg" title="Refresh memory"><RefreshCw className={`h-3 w-3 ${memoryLoading ? "animate-spin" : ""}`} /></button>
                {memoryEntries.length > 0 && !confirmClearMemory && <button onClick={() => setConfirmClearMemory(true)} className="focus-ring rounded px-1.5 py-1 text-[9px] text-red-500 hover:bg-red-500/10">Clear all</button>}
                {confirmClearMemory && <><button onClick={() => void clearMemory()} className="focus-ring rounded bg-red-500 px-1.5 py-1 text-[9px] font-medium text-white">Confirm forget all</button><button onClick={() => setConfirmClearMemory(false)} className="focus-ring rounded px-1.5 py-1 text-[9px] text-fg-muted hover:bg-hover">Cancel</button></>}
              </div>
            </div>
            {memoryEntries.length === 0 ? (
              <p className="px-3 py-4 text-center text-[11px] text-fg-faint">No persistent memory is stored, or the owner is not signed in.</p>
            ) : memoryEntries.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2 border-b border-line-muted px-3 py-2 last:border-b-0">
                <span className="mt-0.5 rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-[8px] uppercase text-[var(--accent)]">{entry.scope === "user" ? "personal" : entry.scope}</span>
                <div className="min-w-0 flex-1"><p className="text-[11px] font-medium text-fg">{entry.key}</p><p className="break-words text-[10px] text-fg-muted">{entry.value}</p></div>
                <button onClick={() => void deleteMemory(entry.id)} className="focus-ring rounded p-1 text-fg-faint hover:bg-red-500/10 hover:text-red-500" title="Forget"><Trash2 className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Provider Status">
        <div className="py-2 text-[12px] text-fg-muted">
          Configured state of each AI provider. Encrypted owner keys and server environment fallbacks are checked without displaying credentials.
        </div>
        {PROVIDERS.map((p) => (
          <SettingsRow key={p.id} title={p.name} description={`Environment variable: ${p.envKey} (server-side only).`}>
            <ProviderStatusPill provider={p.id} />
          </SettingsRow>
        ))}
      </SettingsGroup>
    </div>
  );
}

/**
 * Display the configured state of an AI provider. Uses the same
 * `/api/economic-agent/test` endpoint shape (keyPresent + success) —
 * but for a status badge, we only check `keyPresent` to avoid making
 * a network call on every render. The user can press "Test Connection"
 * for a real round-trip check.
 *
 * IMPORTANT: never display the API key value. Only "Configured" /
 * "Not configured". We don't know if the key is *valid* until the
 * user runs Test Connection — so we don't claim "Ready" here.
 */
function ProviderStatusPill({ provider }: { provider: ProviderId }) {
  // Check encrypted owner credentials and server environment fallbacks without
  // generating a paid reply. Network/auth/database failures are unavailable,
  // never evidence that the saved key is missing.
  const [status, setStatus] = useState<"checking" | "configured" | "not_configured" | "unavailable">("checking");

  useEffect(() => {
    let cancelled = false;
    probeProviders().then((data) => {
      if (!cancelled) setStatus(data.providers[provider] === true ? "configured" : data.providers[provider] === false ? "not_configured" : "unavailable");
    }).catch(() => { if (!cancelled) setStatus("unavailable"); });
    return () => { cancelled = true; };
  }, [provider]);

  if (status === "checking") {
    return <StatusPill status="unavailable" label="Checking…" />;
  }
  if (status === "configured") {
    return <StatusPill status="configured" label="Configured" />;
  }
  if (status === "unavailable") return <StatusPill status="unavailable" label="Unable to check" />;
  return <StatusPill status="not_configured" label="Not configured" />;
}


// All mounted badges share one owner-authorized request; do not cache results
// beyond that request, so reopening Settings sees newly saved credentials.
let providerProbe: Promise<{ providers: Partial<Record<ProviderId, boolean>> }> | null = null;
function probeProviders() {
  if (!providerProbe) providerProbe = fetch("/api/health/ai-probe", {
    cache: "no-store", signal: AbortSignal.timeout(45_000),
  }).then(async (response) => {
    if (!response.ok) throw new Error("Provider status unavailable");
    const data = await response.json() as { providers: Partial<Record<ProviderId, boolean>> };
    if (!data.providers) throw new Error("Invalid provider status");
    return data;
  }).finally(() => { providerProbe = null; });
  return providerProbe;
}
