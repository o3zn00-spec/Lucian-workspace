"use client";

/* LUCIAN Settings — Data & Storage section.
 *
 * Per-module storage usage + backup/import + cleanup + DANGER ZONE.
 *
 * CRITICAL SAFETY RULE: a generic "reset LUCIAN local data" action
 * NEVER touches provider-backed financial data. Only:
 *   - UI cache
 *   - manual/local Vault data (when explicitly selected)
 *   - DevWorkspace projects (when explicitly selected)
 *
 * Provider-backed Vault / Neon financial records live in Postgres and
 * are not reachable from a local-data reset. Settings does NOT expose
 * any option that implies "delete financial ledger" or "reset provider
 * money" — those do not exist as local data.
 *
 * Danger Zone confirmations use LUCIAN's own AlertDialog primitive
 * (NOT window.confirm / window.alert / window.prompt).
 */

import { useEffect, useState } from "react";
import {
  AlertTriangle, Download, Upload, Trash2, RefreshCw, FolderOpen, Bell,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui-devspace/alert-dialog";
import { Button } from "@/components/ui-devspace/button";
import { useNotificationStore } from "@/store/notifications";
import { useSettingsStore } from "@/store/settings";
import { useVaultStore } from "@/store/vault";
import { SettingsGroup, SettingsRow, SettingsSectionHeader, StatusPill } from "@/components/settings/primitives";
import { toast } from "@/hooks/use-toast";
import { estimateStorage } from "@/lib/workspace/db";

interface StorageUsage {
  total: number;
  quota: number;
}

export function DataStorageSection() {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);

  const notificationStore = useNotificationStore();
  const settingsStore = useSettingsStore();
  const vaultStore = useVaultStore();

  useEffect(() => {
    void refreshUsage();
  }, []);

  async function refreshUsage() {
    setLoadingUsage(true);
    try {
      const est = await estimateStorage();
      setUsage({ total: est.usage, quota: est.quota });
    } catch {
      setUsage(null);
    } finally {
      setLoadingUsage(false);
    }
  }

  /* ── Backup / Import ── */

  function handleExportBackup() {
    // Export all localStorage keys under "lucian-" prefix.
    try {
      const keys = Object.keys(localStorage).filter((k) => k.startsWith("lucian-"));
      const data: Record<string, unknown> = {};
      for (const k of keys) {
        try {
          data[k] = JSON.parse(localStorage.getItem(k) ?? "null");
        } catch {
          data[k] = localStorage.getItem(k);
        }
      }
      const blob = new Blob([JSON.stringify({ version: 1, exportedAt: Date.now(), data }, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lucian-local-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Local backup exported" });
    } catch {
      toast({ title: "Export failed", description: "Could not read localStorage.", variant: "destructive" });
    }
  }

  function handleImportBackup(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string) as { data: Record<string, unknown> };
        if (!parsed.data || typeof parsed.data !== "object") {
          toast({ title: "Invalid backup file", variant: "destructive" });
          return;
        }
        for (const [k, v] of Object.entries(parsed.data)) {
          if (!k.startsWith("lucian-")) continue;
          localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
        }
        toast({ title: "Backup imported", description: "Reload the page to apply all settings." });
      } catch {
        toast({ title: "Import failed", description: "Could not parse backup file.", variant: "destructive" });
      }
    };
    reader.readAsText(file);
  }

  /* ── Cleanup actions ── */

  function clearNotificationHistory() {
    notificationStore.clear();
    toast({ title: "Notification history cleared" });
  }

  function clearCachedPreview() {
    // The preview cache is in sessionStorage under "lucian-preview-*".
    let cleared = 0;
    for (const k of Object.keys(sessionStorage)) {
      if (k.startsWith("lucian-preview-")) {
        sessionStorage.removeItem(k);
        cleared++;
      }
    }
    toast({ title: "Preview cache cleared", description: `${cleared} cached preview(s) removed.` });
  }

  function resetIndividualModule(module: "ui-cache" | "notifications" | "settings") {
    switch (module) {
      case "ui-cache":
        for (const k of Object.keys(sessionStorage)) sessionStorage.removeItem(k);
        toast({ title: "UI cache reset" });
        break;
      case "notifications":
        notificationStore.clear();
        toast({ title: "Notification history reset" });
        break;
      case "settings":
        settingsStore.resetAllSettings();
        toast({ title: "Settings reset to defaults" });
        break;
    }
  }

  function resetAllLocalData() {
    // Remove all "lucian-*" localStorage keys. NEVER touches
    // provider-backed financial data — that lives in Postgres, not
    // localStorage.
    let cleared = 0;
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("lucian-")) {
        localStorage.removeItem(k);
        cleared++;
      }
    }
    for (const k of Object.keys(sessionStorage)) sessionStorage.removeItem(k);
    toast({
      title: "LUCIAN local data reset",
      description: `${cleared} local storage key(s) removed. Reload the page. Provider-backed Vault financial records were NOT touched.`,
    });
  }

  return (
    <div>
      <SettingsSectionHeader
        title="Data & Storage"
        subtitle="Manage LUCIAN's local data. Provider-backed financial records are NOT local cache and cannot be reset from here."
      />

      {/* Phase 16 — honest LOCAL vs ACCOUNT/CLOUD distinction. */}
      <SettingsGroup title="Where LUCIAN data lives">
        <div className="py-2 text-[12px] text-fg-muted">
          <div className="mb-2 font-medium text-fg">LOCAL (this browser only)</div>
          <ul className="ml-4 list-disc space-y-0.5 text-[11.5px] text-fg-muted">
            <li>DevWorkspace project source files (uploaded ZIP/folder contents)</li>
            <li>WebContainer filesystem + runtime state (terminal, processes)</li>
            <li>Editor buffers + preview cache + build artifacts</li>
            <li>Session-only UI cache (sessionStorage)</li>
          </ul>
          <div className="mt-3 mb-1 font-medium text-fg">ACCOUNT / SERVER-BACKED (synced across your devices)</div>
          <ul className="ml-4 list-disc space-y-0.5 text-[11.5px] text-fg-muted">
            <li>Profile (display name, avatar) + email + sessions</li>
            <li>Server-backed notifications</li>
            <li>Saved items (bookmarks across modules)</li>
            <li>Vault metadata (provider accounts, payment methods, withdrawal destinations, security + auto-fund settings)</li>
          </ul>
          <div className="mt-3 mb-1 font-medium text-fg">HYBRID (local cache of server-owned records)</div>
          <ul className="ml-4 list-disc space-y-0.5 text-[11.5px] text-fg-muted">
            <li>Local notification store coalesces with server-backed notifications on login (by dedupeKey)</li>
            <li>Local Vault store coalesces manual (self-reported) accounts with server-backed provider accounts</li>
          </ul>
          <div className="mt-3 text-[10.5px] text-fg-faint">
            Project source files are NEVER automatically uploaded to the server. The migration prompt only ever offers notifications and saved items — never your DevWorkspace projects.
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title="Storage Usage">
        <SettingsRow
          title="Total local storage"
          description={usage ? `${formatBytes(usage.total)} used of ${formatBytes(usage.quota)} estimated quota.` : loadingUsage ? "Measuring…" : "Storage estimate unavailable."}
        >
          <Button onClick={refreshUsage} variant="outline" size="sm">
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </SettingsRow>
        <div className="py-2 text-[12px] text-fg-muted">
          Per-module breakdown is best-effort — browser APIs do not expose per-IndexedDB-store sizes.
          The total reflects the combined usage of IndexedDB, localStorage, and sessionStorage.
        </div>
      </SettingsGroup>

      <SettingsGroup title="Backup">
        <SettingsRow title="Export LUCIAN local backup" description="Download a JSON backup of all `lucian-*` local data (settings, manual accounts, notifications history).">
          <Button onClick={handleExportBackup} variant="outline" size="sm">
            <Download className="h-3.5 w-3.5" />
            Export
          </Button>
        </SettingsRow>
        <SettingsRow title="Import local backup" description="Restore a previously exported LUCIAN backup.">
          <label className="themed inline-flex items-center gap-1.5 rounded-md border border-line-muted px-2.5 py-1 text-xs text-fg-muted hover:bg-hover hover:text-fg cursor-pointer">
            <Upload className="h-3.5 w-3.5" />
            Import
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportBackup(f);
                e.target.value = "";
              }}
            />
          </label>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Cleanup">
        <SettingsRow title="Clear cached preview data" description="Remove cached preview data from sessionStorage. Does NOT touch projects.">
          <Button onClick={clearCachedPreview} variant="outline" size="sm">
            <Trash2 className="h-3.5 w-3.5" />
            Clear
          </Button>
        </SettingsRow>
        <SettingsRow title="Clear notification history" description="Remove all stored notification records from the notification store.">
          <Button onClick={clearNotificationHistory} variant="outline" size="sm">
            <Bell className="h-3.5 w-3.5" />
            Clear
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Reset Individual Local Module Data">
        <SettingsRow title="Reset UI cache" description="Clears sessionStorage. Does NOT touch projects, settings, or Vault.">
          <Button onClick={() => resetIndividualModule("ui-cache")} variant="outline" size="sm">Reset</Button>
        </SettingsRow>
        <SettingsRow title="Reset notification history" description="Clears the notification store only.">
          <Button onClick={() => resetIndividualModule("notifications")} variant="outline" size="sm">Reset</Button>
        </SettingsRow>
        <SettingsRow
          title="Reset manual / local Vault data"
          description="Clears manual accounts, local transactions, and capital allocations. Provider-backed financial records (ledger, real transactions) are NOT touched. Uses the proper Vault store action — never mutates state directly."
        >
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">Reset</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset manual / local Vault data?</AlertDialogTitle>
                <AlertDialogDescription>
                  This clears manual accounts, local transaction history, balance history, and zeroes out capital allocations. The action uses the Vault store&apos;s <code>resetManualVaultData()</code> action and updates the UI immediately. Provider-backed financial records (Postgres ledger, real provider transactions, payment methods, provider connections) are NOT touched — they live on the server and are not reachable from here. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    vaultStore.resetManualVaultData();
                    toast({ title: "Manual Vault data reset", description: "Provider-backed financial records were NOT touched." });
                  }}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  Reset manual data
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SettingsRow>
        <SettingsRow title="Reset Settings to defaults" description="Resets all Settings preferences to defaults.">
          <Button onClick={() => resetIndividualModule("settings")} variant="outline" size="sm">Reset</Button>
        </SettingsRow>
      </SettingsGroup>

      {/* DANGER ZONE — LUCIAN AlertDialog, NOT window.confirm */}
      <SettingsGroup title="Danger Zone">
        <div className="py-2">
          <AlertTriangle className="h-4 w-4 text-red-400" />
        </div>

        <SettingsRow
          title="Reset LUCIAN local data"
          description="Removes ALL `lucian-*` localStorage + sessionStorage. Provider-backed Vault / Neon financial records are NOT touched (they live in Postgres, not in local storage)."
        >
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm">
                <Trash2 className="h-3.5 w-3.5" />
                Reset local data
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset all LUCIAN local data?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes every <code>lucian-*</code> localStorage and sessionStorage key — including Settings preferences, manual accounts, and notification history. Provider-backed Vault financial records (ledger, real transactions, balances) live in Postgres and are NOT affected by this action. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={resetAllLocalData}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  Reset local data
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SettingsRow>

        <SettingsRow
          title="Delete all local DevWorkspace projects"
          description="Permanently deletes every local DevWorkspace project (active + recycled). Cannot be undone."
        >
          <DeleteAllProjectsButton />
        </SettingsRow>

        <div className="py-2 text-[11px] text-fg-muted">
          Note: there is intentionally NO option here to delete the financial ledger, clear real Vault balances, or reset provider money. Those records live in Postgres and are only managed from inside Vault.
        </div>
      </SettingsGroup>
    </div>
  );
}

/* ── Delete All Projects (with confirmation) ── */

function DeleteAllProjectsButton() {
  const [deleting, setDeleting] = useState(false);
  async function handleDelete() {
    setDeleting(true);
    try {
      // Lazy import to avoid loading the IndexedDB layer on settings open.
      const { listProjects, listTrashedProjects, deleteProject } = await import("@/lib/workspace/db");
      const [active, trashed] = await Promise.all([listProjects(), listTrashedProjects()]);
      for (const p of [...active, ...trashed]) {
        await deleteProject(p.id);
      }
      toast({ title: "All local projects deleted", description: `${active.length + trashed.length} project(s) permanently removed.` });
    } catch {
      toast({ title: "Delete failed", description: "Could not delete all projects.", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={deleting}>
          <Trash2 className="h-3.5 w-3.5" />
          {deleting ? "Deleting…" : "Delete all"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete ALL local DevWorkspace projects?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes every local DevWorkspace project, including those in the Recycle Bin. File contents and version history will be irrecoverable. This action does NOT touch Vault financial data or Settings.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Delete all projects
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ── Helpers ── */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
