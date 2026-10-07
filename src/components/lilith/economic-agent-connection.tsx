"use client";

/* EconomicAgentConnection — settings panel for the Economic Agent's
 * AI provider connection. Integrated into the Lilith settings area.
 *
 * API keys are NEVER stored in the browser. They live in Vercel
 * environment variables and are only read server-side via
 * /api/economic-agent/test and /api/economic-agent/chat.
 *
 * This UI only persists: the selected provider id + model identifier.
 */

import { useState } from "react";
import {
  Plug,
  ChevronDown,
  Check,
  Loader2,
  KeyRound,
  Save,
} from "lucide-react";
import {
  useEconomicAgentConnection,
  PROVIDERS,
  getProviderInfo,
  type ProviderId,
  type ConnectionTestResult,
} from "@/store/economic-agent-connection";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

export function EconomicAgentConnection() {
  const provider = useEconomicAgentConnection((s) => s.provider);
  const model = useEconomicAgentConnection((s) => s.model);
  const lastTest = useEconomicAgentConnection((s) => s.lastTest);
  const testing = useEconomicAgentConnection((s) => s.testing);
  const setProvider = useEconomicAgentConnection((s) => s.setProvider);
  const setModel = useEconomicAgentConnection((s) => s.setModel);
  const setLastTest = useEconomicAgentConnection((s) => s.setLastTest);
  const setTesting = useEconomicAgentConnection((s) => s.setTesting);

  const [providerOpen, setProviderOpen] = useState(false);
  const providerInfo = getProviderInfo(provider);

  const handleTest = async () => {
    setTesting(true);
    setLastTest(null);
    try {
      const res = await fetch("/api/economic-agent/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model }),
      });
      const data = (await res.json()) as ConnectionTestResult;
      setLastTest(data);
      if (data.success) {
        toast({
          title: "Provider connection verified",
          description: data.reason || data.message,
        });
      } else {
        toast({
          title: "Connection failed",
          description: data.reason || data.message,
          variant: "destructive",
        });
      }
    } catch {
      setLastTest({
        success: false,
        message: "Network error",
        reason: "Could not reach the server.",
        provider,
        model,
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Plug className="h-4 w-4 text-fg-muted" />
        <h3 className="text-[13px] font-semibold text-fg">Lilthe Model Connection</h3>
      </div>

      {/* Provider dropdown */}
      <div>
        <label className="text-[12px] font-medium text-fg-muted">Provider</label>
        <div className="relative mt-1">
          <button
            type="button"
            onClick={() => setProviderOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px] text-fg hover:bg-hover"
          >
            <span>{providerInfo.name}</span>
            <ChevronDown className="h-3.5 w-3.5 text-fg-faint" />
          </button>
          {providerOpen && (
            <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-line bg-overlay shadow-pop">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setProvider(p.id as ProviderId);
                    if (!model) setModel(p.defaultModel);
                    setProviderOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between px-3 py-2 text-left text-[12px] transition-colors",
                    provider === p.id
                      ? "bg-active text-fg"
                      : "text-fg-muted hover:bg-hover hover:text-fg",
                  )}
                >
                  <span>{p.name}</span>
                  {provider === p.id && <Check className="h-3 w-3 text-[var(--accent)]" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Model identifier */}
      <div>
        <label className="text-[12px] font-medium text-fg-muted">Model Identifier</label>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={providerInfo.modelPlaceholder}
          className="mt-1 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-[13px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
      </div>

      {/* API key status — read-only, never exposes the actual key */}
      <div>
        <label className="text-[12px] font-medium text-fg-muted">API Key</label>
        <div className="mt-1 flex items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2">
          <KeyRound className="h-3.5 w-3.5 text-fg-faint" />
          <span className="text-[13px] text-fg-muted">
            Using Vercel environment key
          </span>
        </div>
        <p className="mt-1 text-[10px] text-fg-faint">
          Active source: Vercel environment variable{" "}
          <code className="font-mono text-fg-muted">{providerInfo.envKey}</code>
        </p>
      </div>

      {/* Connection status */}
      <div className="flex items-center gap-2 rounded-md border border-line-muted bg-surface-2/50 px-3 py-2">
        {testing ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin text-[var(--accent)]" />
            <span className="text-[12px] text-fg-muted">Testing connection…</span>
          </>
        ) : lastTest ? (
          <>
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                lastTest.success ? "bg-[#089981]" : "bg-[#f23645]",
              )}
            />
            <span className="text-[12px] font-medium text-fg">
              {lastTest.success ? "Connected" : "Connection failed"}
            </span>
            <span className="ml-auto text-[10px] text-fg-faint">
              {lastTest.testedAt
                ? new Date(lastTest.testedAt).toLocaleTimeString()
                : ""}
            </span>
          </>
        ) : (
          <>
            <span className="h-2 w-2 rounded-full bg-fg-faint" />
            <span className="text-[12px] text-fg-muted">Not tested</span>
          </>
        )}
      </div>

      {/* Last test details */}
      {lastTest && lastTest.reason && (
        <div className="rounded-md border border-line bg-surface-2 px-3 py-2 text-[11px] text-fg-muted">
          {lastTest.reason}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            toast({
              title: "Connection saved",
              description: `${providerInfo.name} · ${model || providerInfo.defaultModel}`,
            });
          }}
          className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-[var(--accent-fg)] hover:opacity-90"
        >
          <Save className="h-3.5 w-3.5" />
          Save Connection
        </button>
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-fg-muted hover:text-fg disabled:opacity-50"
        >
          {testing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plug className="h-3.5 w-3.5" />
          )}
          Check Saved Connection
        </button>
      </div>
    </div>
  );
}
