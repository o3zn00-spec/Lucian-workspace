"use client";



import { useEffect, useRef } from "react";
import { useVaultStore } from "@/store/vault";
import { useInvestingStore } from "@/store/investing";
import { useNotificationStore, type NotificationLevel } from "@/store/notifications";
import { subscribeRuntime, type RuntimeState } from "@/lib/workspace/webcontainer";
import { useWorkspaceStore } from "@/store/workspace";

/* ── Producer 1: Vault events ─────────────────────────────────────────── */

/** Set of vault transaction ids we've already notified on. Persisted in
 *  localStorage so a page refresh doesn't re-notify on existing txs. */
function readNotifiedTxIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem("lucian-vault-notified-tx");
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(arr);
  } catch {
    return new Set();
  }
}

function writeNotifiedTxIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    // Cap the persisted set at 500 — older entries are dropped (LRU).
    const arr = Array.from(ids).slice(-500);
    localStorage.setItem("lucian-vault-notified-tx", JSON.stringify(arr));
  } catch { /* ignore */ }
}

function useVaultEventsProducer() {
  const transactions = useVaultStore((s) => s.transactions);
  const settings = useVaultStore((s) => s.settings);
  const notifiedRef = useRef<Set<string>>(readNotifiedTxIds());

  useEffect(() => {
    // Only consider transactions newer than the first run (i.e. ones the
    // user actually performed during this session or that we haven't
    // notified on yet).
    const newTxs = transactions.filter((t) => !notifiedRef.current.has(t.id));
    if (newTxs.length === 0) return;

    const notify = useNotificationStore.getState().notify;
    const notificationsSettings = settings.notifications;
    const largeThreshold = settings.security.largeTransactionThreshold;

    for (const tx of newTxs) {
      // Decide whether this tx warrants a notification based on the
      // user's settings + the tx type.
      let shouldNotify = false;
      let level: NotificationLevel = "info";
      let actionable = false;

      if (tx.type === "local-transfer") {
        if (!notificationsSettings.transfers) continue;
        shouldNotify = true;
        level = "success";
        // Large transfers are flagged as actionable (Need Attention).
        if (notificationsSettings.largeTransfers && tx.amount >= largeThreshold) {
          level = "warning";
          actionable = true;
        }
      } else if (tx.type === "pool-allocation" || tx.type === "pool-deallocation") {
        // Capital-pool changes are informational. Always notify (the user
        // can disable by editing the producer here if too noisy).
        shouldNotify = true;
        level = "info";
      } else if (tx.type === "balance-updated") {
        if (!notificationsSettings.balanceChanges) continue;
        shouldNotify = true;
        level = "info";
      } else if (tx.type === "account-created" || tx.type === "account-removed") {
        shouldNotify = true;
        level = "info";
      } else if (tx.type === "security-event") {
        shouldNotify = true;
        level = "warning";
        actionable = true;
      }

      if (!shouldNotify) continue;

      // PRIVACY: do NOT include amount / currency / masked identifiers in
      // the notification payload. The user clicks the deep link to see
      // the transaction in context (where Vault privacy settings apply
      // to the rendered row).
      const isLarge = tx.amount >= largeThreshold;
      const title =
        tx.type === "local-transfer" ? "Local transfer completed" :
        tx.type === "pool-allocation" ? "Capital allocated" :
        tx.type === "pool-deallocation" ? "Capital deallocated" :
        tx.type === "balance-updated" ? "Account balance updated" :
        tx.type === "account-created" ? "Account added" :
        tx.type === "account-removed" ? "Account removed" :
        tx.type === "security-event" ? "Security event" :
        tx.type;
      const message =
        tx.type === "local-transfer"
          ? `${tx.from} → ${toShortLabel(tx.to)}${isLarge ? " · large transfer" : ""}`
          : tx.description || tx.type;

      notify({
        source: "vault",
        event: "vault-tx",
        title,
        // PRIVACY: message omits amount + currency. The deep link opens
        // the activity tab where the user's privacy settings apply.
        message,
        level,
        actionable,
        deepLink: `/vault?tab=activity&transaction=${encodeURIComponent(tx.id)}`,
        entity: {
          module: "vault",
          type: "transaction",
          id: tx.id,
        },
        cooldownMs: 60 * 1000, // 1-minute cooldown per tx id
      });

      notifiedRef.current.add(tx.id);
    }
    writeNotifiedTxIds(notifiedRef.current);
  }, [transactions, settings]);
}

/** Shorten a label for the notification message — never reveals balance
 *  or masked identifier. */
function toShortLabel(s: string): string {
  return s.length > 30 ? s.slice(0, 28) + "…" : s;
}

/* ── Producer 2: DevWorkspace runtime failures ───────────────────────── */

function useDevWorkspaceRuntimeProducer() {
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const projects = useWorkspaceStore((s) => s.projects);
  // Track the last status we saw so we only fire on transitions, not on
  // every state update (the runtime can emit many "running" updates as
  // the server URL changes).
  const lastStatusRef = useRef<string>("idle");
  // Track which project id the current "error" notification belongs to,
  // so we can resolve it when the runtime recovers.
  const errorProjectIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeRuntime((runtimeState: RuntimeState) => {
      const status = runtimeState.status;
      if (status === lastStatusRef.current) return;
      const prevStatus = lastStatusRef.current;
      lastStatusRef.current = status;

      const notify = useNotificationStore.getState().notify;
      const resolve = useNotificationStore.getState().resolve;

      if (status === "error") {
        // Fire a notification for the active project (if any).
        const projectId = activeProjectId;
        if (!projectId) return;
        const project = projects.find((p) => p.id === projectId);
        const projectName = project?.name ?? "the current project";
        errorProjectIdRef.current = projectId;

        // Sanitize the error message — strip any URLs / paths / secrets.
        const rawErr = runtimeState.error ?? "Unknown runtime error";
        const safeErr = rawErr.slice(0, 200);

        notify({
          source: "dev-workspace",
          event: "runtime-failed",
          title: `Runtime failed: ${projectName}`,
          message: safeErr,
          level: "error",
          actionable: true,
          deepLink: `/dev-workspace?project=${encodeURIComponent(projectId)}`,
          entity: {
            module: "dev-workspace",
            type: "project-runtime",
            id: projectId,
          },
          // 10-minute cooldown so a flaky runtime doesn't spam.
          cooldownMs: 10 * 60 * 1000,
        });
      } else if (status === "running" && prevStatus === "error") {
        // Runtime recovered — resolve the existing error notification.
        const projectId = errorProjectIdRef.current;
        if (!projectId) return;
        const existing = useNotificationStore
          .getState()
          .notifications.find(
            (n) =>
              n.source === "dev-workspace" &&
              n.dedupeKey?.includes("runtime-failed") &&
              n.entity?.id === projectId &&
              !n.resolved,
          );
        if (existing) {
          resolve(existing.id);
        }
        errorProjectIdRef.current = null;
      }
    });
    return unsubscribe;
  }, [activeProjectId, projects]);
}

/* ── Producer 4: Investing thesis review due ─────────────────────────── */

/** Persisted Set of thesis investmentIds we've already notified on.
 *  Keyed by investmentId (not by review date) so updating a thesis
 *  (which bumps nextReviewAt) clears the "notified" state when the
 *  user marks it reviewed. */
function readNotifiedTheses(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem("lucian-investing-thesis-notified");
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

function writeNotifiedTheses(map: Record<string, number>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("lucian-investing-thesis-notified", JSON.stringify(map));
  } catch { /* ignore */ }
}

function useInvestingThesisProducer() {
  const theses = useInvestingStore((s) => s.theses);
  const investments = useInvestingStore((s) => s.investments);
  // Re-check every 5 minutes (in case a thesis becomes due while the
  // user has the app open).
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      if (cancelled) return;
      const now = Date.now();
      const notified = readNotifiedTheses();
      let changed = false;
      const notify = useNotificationStore.getState().notify;

      for (const t of theses) {
        // Only fire if nextReviewAt is in the past.
        if (t.nextReviewAt > now) continue;
        // Skip if we've already notified on this thesis's current
        // nextReviewAt value (so updating the thesis — which bumps
        // nextReviewAt — re-arms the check).
        const lastNotifiedAt = notified[t.investmentId];
        if (lastNotifiedAt && lastNotifiedAt >= t.nextReviewAt) continue;

        const inv = investments.find((i) => i.id === t.investmentId);
        const symbol = inv?.symbol ?? "an investment";

        notify({
          source: "investing",
          event: "thesis-review-due",
          title: `Thesis review due: ${symbol}`,
          message: `It's time to review your investment thesis for ${symbol}.`,
          level: "warning",
          actionable: true,
          deepLink: `/investing?holding=${encodeURIComponent(t.investmentId)}`,
          entity: {
            module: "investing",
            type: "thesis",
            id: t.investmentId,
          },
          // 24-hour cooldown so the user has time to act before we re-notify.
          cooldownMs: 24 * 60 * 60 * 1000,
          reopenIfResolved: true,
        });

        notified[t.investmentId] = now;
        changed = true;
      }

      if (changed) writeNotifiedTheses(notified);
    };

    // Run once immediately on mount, then every 5 minutes.
    check();
    const interval = setInterval(check, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [theses, investments]);
}

/* ── Mount point ─────────────────────────────────────────────────────── */

/**
 * Mount once at the AppShell level. Renders nothing — just registers
 * the producer observers so they fire notifications into the store.
 *
 * This component is intentionally a no-op render. All work happens in
 * effects / subscriptions.
 */
export function NotificationProducers() {
  useVaultEventsProducer();
  useDevWorkspaceRuntimeProducer();
  useInvestingThesisProducer();
  // Markets price alerts are evaluated inline from the markets store's
  // updatePrice hot path — no bridge needed.
  return null;
}
