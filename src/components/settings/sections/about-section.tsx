"use client";

/* eslint-disable react-hooks/set-state-in-effect */

/* LUCIAN Settings — About & Diagnostics section.
 *
 * Shows:
 *   - LUCIAN version + build info
 *   - System status (real checks via /api/health/system-status)
 *   - Run Diagnostics action (real, no fake "Online" status)
 *   - Licenses + Privacy/About (short, factual — no fake legal docs)
 *
 * CRITICAL HONESTY RULE:
 *   A subsystem is labeled "Module Available" when the code module
 *   exists. This does NOT mean an external service was contacted.
 *   A subsystem is labeled "Configured" when an API key / DATABASE_URL
 *   is present. This does NOT mean the key is valid or the service is
 *   reachable.
 *   A subsystem is labeled "Connected" / "Reachable" ONLY when an
 *   actual probe (network request) succeeded.
 *
 *   We NEVER show "Online" / "Ready" for something that was not probed.
 */

import { useEffect, useState } from "react";
import { Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { SettingsGroup, SettingsRow, SettingsSectionHeader, StatusPill } from "@/components/settings/primitives";
import { Button } from "@/components/ui-devspace/button";
import { formatDateTime } from "@/lib/regional-format";

interface SystemStatus {
  marketsProvider: string;
  indexedDb: string;
  webContainer: string;
  githubImport: string;
  browser: string;
  vaultDatabase: { configured: boolean };
  vaultProviders: Array<{ name: string; type: string; state: string; configured: boolean; detail: string | null }>;
  auth: { database: boolean; secret: boolean; google: boolean; email: boolean };
  buildInfo: { version: string; nodeEnv: string; timestamp: string };
}

export function AboutSection() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [diagnostics, setDiagnostics] = useState<string[] | null>(null);

  // Client-side capability checks (performed in the browser, not on the
  // server). These are REAL checks — we probe the browser's actual
  // capabilities, not just assert "ready".
  const [clientCaps, setClientCaps] = useState<{
    indexedDb: boolean;
    webContainerIsolated: boolean;
    serviceWorker: boolean;
    webCrypto: boolean;
  } | null>(null);

  useEffect(() => {
    void refreshStatus();
  }, []);

  // Run client capability checks once on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setClientCaps({
      indexedDb: "indexedDB" in window,
      webContainerIsolated:
        "crossOriginIsolated" in window &&
        (window as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true,
      serviceWorker: "serviceWorker" in navigator,
      webCrypto: "crypto" in window && "subtle" in window.crypto,
    });
  }, []);

  async function refreshStatus() {
    setLoading(true);
    try {
      const res = await fetch("/api/health/system-status", { cache: "no-store" });
      if (!res.ok) {
        setStatus(null);
        return;
      }
      setStatus((await res.json()) as SystemStatus);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  async function runDiagnostics() {
    setRunning(true);
    setDiagnostics(null);
    const lines: string[] = [];
    // Use the shared regional formatter (Settings → General → Regional).
    lines.push(`Diagnostics run at ${formatDateTime(Date.now())}`);
    lines.push("");

    // 1. Fetch fresh server status.
    try {
      const res = await fetch("/api/health/system-status", { cache: "no-store" });
      if (!res.ok) {
        lines.push(`✗ /api/health/system-status returned ${res.status}`);
      } else {
        const s = (await res.json()) as SystemStatus;
        lines.push(`✓ Server reachable (build ${s.buildInfo.version}, env ${s.buildInfo.nodeEnv})`);
        lines.push("");

        // Markets — module available (client-only), no external probe.
        lines.push(`• Markets provider: Module Available (client-only module; no external service probe)`);

        // Vault database — configured state only.
        lines.push(`• Vault database: ${s.vaultDatabase.configured ? "Configured (DATABASE_URL present)" : "Not configured"} — NOT a connection test`);

        // Vault providers — honest state.
        lines.push(`• Vault providers:`);
        for (const p of s.vaultProviders) {
          lines.push(`    — ${p.name}: ${p.state}${p.detail ? ` — ${p.detail}` : ""}`);
        }

        // Module availability (NOT external connectivity).
        lines.push(`• GitHub Import: Module Available (route exists; no network probe until you import)`);
        lines.push(`• Browser module: Module Available (route exists)`);
      }
    } catch (err) {
      lines.push(`✗ Network error: ${err instanceof Error ? err.message : "unknown"}`);
    }

    // 2. Client-side capability checks (REAL probes of browser capabilities).
    lines.push("");
    lines.push("Client capabilities (real browser feature detection):");
    if (typeof window !== "undefined") {
      const idb = "indexedDB" in window;
      lines.push(`• IndexedDB: ${idb ? "Supported / Available" : "Unavailable"}`);

      // WebContainer — requires cross-origin isolation.
      const crossIsolated =
        "crossOriginIsolated" in window &&
        (window as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
      lines.push(`• WebContainer: ${crossIsolated ? "Available (cross-origin isolated)" : "Unavailable — requires cross-origin isolation (scoped to /dev-workspace)"}`);

      // Service worker (PWA).
      const sw = "serviceWorker" in navigator;
      lines.push(`• Service Worker (PWA): ${sw ? "Supported" : "Not supported"}`);

      // Web Crypto.
      const crypto = "crypto" in window && "subtle" in window.crypto;
      lines.push(`• Web Crypto: ${crypto ? "Available" : "Unavailable"}`);
    }

    lines.push("");
    lines.push("Diagnostics complete.");
    setDiagnostics(lines);
    setRunning(false);
  }

  return (
    <div>
      <SettingsSectionHeader
        title="About & Diagnostics"
        subtitle="LUCIAN version, system status, and a real diagnostics action. Status labels distinguish module availability from external connectivity."
      />

      <SettingsGroup title="LUCIAN">
        <SettingsRow title="Version" description={status ? `${status.buildInfo.version} (env: ${status.buildInfo.nodeEnv})` : "Loading…"}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-muted" /> : <StatusPill status="ready" label="Running" />}
        </SettingsRow>
        <SettingsRow title="Build information" description={status ? `Server timestamp: ${status.buildInfo.timestamp}` : "Loading…"} />
      </SettingsGroup>

      <SettingsGroup title="System Status">
        <div className="py-2 text-[11px] text-fg-muted">
          <strong>Status label key:</strong>
          <ul className="mt-1 space-y-0.5">
            <li><StatusPill status="ready" label="Module Available" /> — the code module exists; no external service was contacted.</li>
            <li><StatusPill status="configured" label="Configured" /> — an API key / DATABASE_URL is present; NOT a reachability check.</li>
            <li><StatusPill status="setup_required" label="Integration Required" /> — integration exists but needs setup.</li>
            <li><StatusPill status="not_configured" label="Not Configured" /> — no env var / credential present.</li>
          </ul>
        </div>

        <SettingsRow title="Markets provider" description="The markets data module. Client-only — no external service probe is performed.">
          <StatusPill status="ready" label="Module Available" />
        </SettingsRow>
        
        <SettingsRow title="IndexedDB" description="Browser storage for DevWorkspace projects and file contents. Real capability check performed client-side.">
          {clientCaps ? (
            clientCaps.indexedDb
              ? <StatusPill status="ready" label="Supported" />
              : <StatusPill status="unavailable" label="Unavailable" />
          ) : <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-muted" />}
        </SettingsRow>
        <SettingsRow title="WebContainer" description="The DevWorkspace runtime. Requires cross-origin isolation (scoped to /dev-workspace). Real capability check performed client-side.">
          {clientCaps ? (
            clientCaps.webContainerIsolated
              ? <StatusPill status="ready" label="Available" />
              : <StatusPill status="unavailable" label="Unavailable — needs cross-origin isolation" />
          ) : <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-muted" />}
        </SettingsRow>
        <SettingsRow title="GitHub Import" description="The public GitHub repository import endpoint. Module exists; no network probe is performed until you import a repo.">
          <StatusPill status="ready" label="Module Available" />
        </SettingsRow>
        <SettingsRow title="Browser" description="The in-app browser module. Module exists; no external service probe.">
          <StatusPill status="ready" label="Module Available" />
        </SettingsRow>
        <SettingsRow title="Vault database" description="Postgres connection for the Vault financial ledger. 'Configured' means DATABASE_URL is present — NOT a connection test. The value is never exposed.">
          {status ? (
            status.vaultDatabase.configured
              ? <StatusPill status="configured" label="Configured" />
              : <StatusPill status="not_configured" label="Not configured" />
          ) : <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-muted" />}
        </SettingsRow>
        <SettingsRow title="Vault providers" description="Honest state of Stripe / Plaid / Bybit / Alpaca. 'Configured' does NOT mean reachable.">
          <div className="themed flex flex-wrap gap-1.5">
            {status ? (
              status.vaultProviders.map((p) => (
                <StatusPill
                  key={p.name}
                  status={vaultStateToPill(p.state)}
                  label={`${p.name}: ${vaultStateLabel(p.state)}`}
                />
              ))
            ) : <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-muted" />}
          </div>
        </SettingsRow>
        {/* Phase 16 — authentication + Neon + Google + email status. */}
        <SettingsRow title="Authentication database" description="DATABASE_URL for users, sessions, profile, chats, notifications. 'Configured' means env var present; NOT a connection test.">
          {status ? (
            status.auth.database
              ? <StatusPill status="configured" label="Configured" />
              : <StatusPill status="not_configured" label="Not configured" />
          ) : <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-muted" />}
        </SettingsRow>
        <SettingsRow title="Auth secret" description="AUTH_SECRET for signing session cookies. Without it, Auth.js refuses to start and sign-in fails.">
          {status ? (
            status.auth.secret
              ? <StatusPill status="ready" label="Configured" />
              : <StatusPill status="not_configured" label="Not configured — sign-in will fail" />
          ) : <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-muted" />}
        </SettingsRow>
        <SettingsRow title="Google OAuth" description="GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET. Honestly reports whether Google sign-in is enabled on this server.">
          {status ? (
            status.auth.google
              ? <StatusPill status="ready" label="Configured" />
              : <StatusPill status="not_configured" label="Not configured — button is disabled" />
          ) : <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-muted" />}
        </SettingsRow>
        <SettingsRow title="Email delivery (SMTP)" description="Used for password-reset email links. Honestly reports whether SMTP is configured.">
          {status ? (
            status.auth.email
              ? <StatusPill status="ready" label="Configured" />
              : <StatusPill status="not_configured" label="Not configured — resets won't email" />
          ) : <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-muted" />}
        </SettingsRow>
        <SettingsRow title="Refresh status" description="Re-fetch the system status from the server.">
          <Button onClick={refreshStatus} variant="outline" size="sm" disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Diagnostics">
        <SettingsRow
          title="Run diagnostics"
          description="Run a real diagnostic check of LUCIAN subsystems (server-side status + client capabilities). Distinguishes module availability from external connectivity."
        >
          <Button onClick={runDiagnostics} variant="outline" size="sm" disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
            {running ? "Running…" : "Run diagnostics"}
          </Button>
        </SettingsRow>
        {diagnostics && (
          <pre className="mt-2 overflow-x-auto rounded-md border border-line-muted bg-surface-2 p-3 text-[11px] leading-relaxed text-fg-muted">
            {diagnostics.join("\n")}
          </pre>
        )}
      </SettingsGroup>

      <SettingsGroup title="Licenses">
        <SettingsRow title="Open-source licenses" description="LUCIAN is built on Next.js, React, Zustand, Prisma, Radix UI, Tailwind CSS, and other open-source packages.">
          <a
            href="https://github.com/vercel/next.js/blob/canary/LICENSE"
            target="_blank"
            rel="noreferrer"
            className="text-[12px] text-accent hover:underline"
          >
            View Next.js license ↗
          </a>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Privacy / About">
        <SettingsRow title="About LUCIAN" description="LUCIAN is an integrated workspace for markets, development, knowledge, and personal finance.">
          <span className="text-[12px] text-fg-muted">v{status?.buildInfo.version ?? "0.0.0"}</span>
        </SettingsRow>
        <SettingsRow title="Privacy" description="LUCIAN stores local preferences in this browser. Provider-backed financial data lives in Postgres. API keys live only in server environment variables and are never exposed to the browser." />
      </SettingsGroup>
    </div>
  );
}

function vaultStateToPill(state: string): "ready" | "configured" | "setup_required" | "not_configured" | "error" | "unavailable" {
  switch (state) {
    case "connected":      return "ready";
    case "configured":     return "configured";
    case "setup_required": return "setup_required";
    case "connecting":     return "configured";
    case "restricted":
    case "error":          return "error";
    case "not_configured":
    default:               return "not_configured";
  }
}

function vaultStateLabel(state: string): string {
  switch (state) {
    case "connected":      return "Connected";
    case "configured":     return "Configured";
    case "setup_required": return "Integration required";
    case "connecting":     return "Connecting…";
    case "restricted":     return "Restricted";
    case "error":          return "Error";
    case "not_configured":
    default:               return "Not configured";
  }
}
