"use client";

/* LUCIAN Home Recent Activity aggregator — Phase 10.
 *
 * This is SEPARATE from the Notification store. Notifications are for
 * things the user should be aware of or act on. Recent Activity is a
 * derived timeline of REAL things the user did across LUCIAN modules.
 *
 * Sources (all REAL — no fabricated events):
 *   - Markets: operation history (position opened/closed, pending
 *     placed/triggered/cancelled, account reset) from the paper-trading
 *     engine. Persisted in localStorage under
 *     `lucian-markets-operation-history`.
 *   - Vault: transactions (account-created, balance-updated,
 *     local-transfer, pool-allocation, etc.) from the Vault store.
 *     Persisted via zustand-persist under `lucian-vault`.
 *   - Investing: activities (buy, sell, dividend, thesis-update,
 *     watchlist-add/remove, research-saved) from the Investing store.
 *     Persisted via zustand-persist under `lucian-investing`.
 *   - DevWorkspace: project create / update / import events. We derive
 *     these from the workspace store's `projects` list, keyed off each
 *     project's `updatedAt` timestamp (a real signal of recent activity).
 *   - Economy Hub: opportunity / business / research create+update events
 *     derived from the Economy Hub store's arrays.
 *
 * The aggregator is read-only and lazy — it pulls from the real stores
 * on demand and merges by timestamp. It does NOT modify any source store.
 *
 * Architecture:
 *
 *   REAL MODULE STORES / HISTORIES
 *         ↓
 *   getActivity() (derived aggregator)
 *         ↓
 *   Home Recent Activity
 *
 * while:
 *
 *   NOTIFICATION PRODUCERS
 *         ↓
 *   notification store
 *         ↓
 *   Bell / Notification Center
 *         ↓
 *   Needs Attention where actionable
 *
 * Clearing notifications does NOT clear Recent Activity.
 */

export interface ActivityEntry {
  /** Stable unique id (e.g. "mkt-op-<id>" for markets operation history). */
  id: string;
  /** Module that produced the activity (matches notification `source`). */
  module: string;
  /** Human-readable module label. */
  moduleLabel: string;
  /** Short title (e.g. "BTCUSD position opened"). */
  title: string;
  /** Optional subtitle / detail. */
  subtitle?: string;
  /** Wall-clock time (ms since epoch). */
  timestamp: number;
  /** Optional deep link to the exact entity. */
  deepLink?: string;
}

/** Read localStorage safely (returns null on SSR / parse failure). */
function readLS<T = unknown>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

interface MarketsOpHistoryEntry {
  id: string;
  timestamp: number;
  kind: string;
  symbol: string | null;
}

interface VaultState {
  state?: {
    transactions?: Array<{
      id: string;
      type: string;
      description: string;
      from: string;
      to: string;
      amount: number;
      currency: string;
      timestamp: number;
      accountLabel?: string;
    }>;
  };
}

interface InvestingState {
  state?: {
    activities?: Array<{
      id: string;
      type: string;
      entityId: string;
      entityName: string;
      message: string;
      createdAt: number;
    }>;
  };
}

interface EconomyHubState {
  state?: {
    opportunities?: Array<{ id: string; name: string; status?: string; updatedAt?: number; createdAt?: number }>;
    businesses?: Array<{ id: string; name: string; status?: string; updatedAt?: number; createdAt?: number }>;
    researchRecords?: Array<{ id: string; title: string; updatedAt?: number; createdAt?: number }>;
  };
}

interface WorkspaceProject {
  id: string;
  name: string;
  updatedAt: number;
  createdAt?: number;
}

const MARKETS_OP_LABELS: Record<string, string> = {
  position_opened: "Position opened",
  position_closed_manual: "Position closed",
  position_closed_stop_loss: "Stopped out",
  position_closed_take_profit: "Take profit hit",
  pending_placed: "Pending order placed",
  pending_triggered: "Pending order filled",
  pending_cancelled: "Pending order cancelled",
  pending_rejected: "Order rejected",
  account_reset: "Account reset",
};

/** Derive a unified activity timeline from the real module stores.
 *  Returns at most `limit` entries (default 10), most-recent-first. */
export function getActivity(limit = 10): ActivityEntry[] {
  const entries: ActivityEntry[] = [];

  // ── Markets operation history ──
  try {
    const raw = readLS<MarketsOpHistoryEntry[]>("lucian-markets-operation-history");
    // The history is stored as a JSON array directly.
    const list = Array.isArray(raw) ? raw : [];
    for (const op of list) {
      const label = MARKETS_OP_LABELS[op.kind] ?? op.kind;
      entries.push({
        id: `mkt-op-${op.id}`,
        module: "markets",
        moduleLabel: "Markets",
        title: op.symbol ? `${op.symbol} · ${label}` : label,
        subtitle: "Paper trading",
        timestamp: op.timestamp,
        deepLink: op.symbol ? `/markets?symbol=${encodeURIComponent(op.symbol)}` : "/markets",
      });
    }
  } catch { /* ignore */ }

  // ── Vault transactions ──
  try {
    const vault = readLS<VaultState>("lucian-vault");
    const txs = vault?.state?.transactions ?? [];
    for (const t of txs) {
      // Vault privacy: NEVER include amount / currency in the activity
      // subtitle. The deep link opens the activity tab + highlights the
      // transaction; the Vault UI itself respects the user's
      // hideBalances / maskSensitive settings when rendering the row.
      entries.push({
        id: `vault-tx-${t.id}`,
        module: "vault",
        moduleLabel: "Vault",
        title: t.description || `${t.type}: ${t.from} → ${t.to}`,
        subtitle: t.type,
        timestamp: t.timestamp,
        deepLink: `/vault?tab=activity&transaction=${encodeURIComponent(t.id)}`,
      });
    }
  } catch { /* ignore */ }

  // ── Investing activities ──
  try {
    const inv = readLS<InvestingState>("lucian-investing");
    const acts = inv?.state?.activities ?? [];
    for (const a of acts) {
      entries.push({
        id: `inv-act-${a.id}`,
        module: "investing",
        moduleLabel: "Investing",
        title: a.message,
        subtitle: a.entityName,
        timestamp: a.createdAt,
        // entityId is the investment id — deep-link to the holding detail.
        deepLink: `/investing?holding=${encodeURIComponent(a.entityId)}`,
      });
    }
  } catch { /* ignore */ }

  // ── Economy Hub opportunity / business / research updates ──
  try {
    const eh = readLS<EconomyHubState>("lucian-economy-hub");
    for (const opp of eh?.state?.opportunities ?? []) {
      const ts = opp.updatedAt ?? opp.createdAt;
      if (!ts) continue;
      entries.push({
        id: `eh-opp-${opp.id}`,
        module: "economy-hub",
        moduleLabel: "Economy Hub",
        title: opp.name,
        subtitle: opp.status ? `Opportunity · ${opp.status}` : "Opportunity",
        timestamp: ts,
        deepLink: `/economy-hub?opportunity=${encodeURIComponent(opp.id)}`,
      });
    }
    for (const biz of eh?.state?.businesses ?? []) {
      const ts = biz.updatedAt ?? biz.createdAt;
      if (!ts) continue;
      entries.push({
        id: `eh-biz-${biz.id}`,
        module: "economy-hub",
        moduleLabel: "Economy Hub",
        title: biz.name,
        subtitle: biz.status ? `Business · ${biz.status}` : "Business",
        timestamp: ts,
        deepLink: `/economy-hub?business=${encodeURIComponent(biz.id)}`,
      });
    }
    for (const r of eh?.state?.researchRecords ?? []) {
      const ts = r.updatedAt ?? r.createdAt;
      if (!ts) continue;
      entries.push({
        id: `eh-res-${r.id}`,
        module: "economy-hub",
        moduleLabel: "Economy Hub",
        title: r.title,
        subtitle: "Research",
        timestamp: ts,
        deepLink: `/economy-hub?research=${encodeURIComponent(r.id)}`,
      });
    }
  } catch { /* ignore */ }

  // ── DevWorkspace project activity (IndexedDB-backed store) ──
  // The workspace store is zustand (not persisted to localStorage by
  // itself — projects live in IndexedDB). But the workspace store's
  // `projects` array is updated in-memory on every project create/import/
  // update, and the dev-workspace page calls `refreshProjects()` on
  // mount. To avoid pulling the workspace store into the home bundle's
  // hot path, we read the projects list via a dynamic import on demand.
  // For SSR safety this is wrapped in a typeof-window guard.
  if (typeof window !== "undefined") {
    try {
      // Use the workspace db directly — projects are stored in IndexedDB
      // and `listProjects()` is the canonical accessor. This is async, but
      // we want a synchronous read here. Instead, we rely on the workspace
      // store's persisted `projects` snapshot in localStorage (zustand
      // persist writes it there on every state change under the key
      // `lucian-workspace-store`). If that snapshot is missing (e.g. cold
      // cache), DevWorkspace activity simply won't appear in this render
      // — it'll appear on the next render after the store has hydrated.
      //
      // We do NOT use this snapshot as the source of truth for project
      // data anywhere else — Phase 9 search uses the REAL IndexedDB. Here
      // we only need project name + updatedAt for the activity timeline,
      // which the snapshot faithfully captures.
      const ws = readLS<{ state?: { projects?: WorkspaceProject[] } }>("lucian-workspace-store");
      for (const p of ws?.state?.projects ?? []) {
        if (!p.updatedAt) continue;
        entries.push({
          id: `dw-proj-${p.id}`,
          module: "dev-workspace",
          moduleLabel: "DevWorkspace",
          title: p.name,
          subtitle: "Project updated",
          timestamp: p.updatedAt,
          deepLink: `/dev-workspace?project=${encodeURIComponent(p.id)}`,
        });
      }
    } catch { /* ignore */ }
  }

  // Sort by timestamp descending and return the top `limit`.
  entries.sort((a, b) => b.timestamp - a.timestamp);
  return entries.slice(0, limit);
}
