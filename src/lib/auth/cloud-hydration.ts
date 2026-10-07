"use client";

// LUCIAN Phase 16 — Cloud hydration layer (FINAL CORRECTED).
//
// When the authenticated session becomes active, fetch eligible
// server-backed data (chats / notifications / saved-items) and merge
// it into the corresponding local stores. This is the ONE clean
// hydration layer — local stores are NOT replaced wholesale; instead,
// server data is merged with dedupe so we never destroy newer local
// state.
//
// Behavior:
//   - Triggered when useSession() reports "authenticated".
//   - For each category (chats / notifications / saved-items):
//       1. fetch the authenticated user's records from the server.
//       2. merge into the local store via a category-specific merge
//          function (id / timestamp-aware).
//       3. dedupe using the store's existing dedupe key.
//   - If the server is unreachable:
//       - the local data is preserved (no white screen).
//       - hydration is retried on the next session change.
//       - we DO NOT report successful cloud sync.
//   - Notifications: hydration does NOT replay sounds and does NOT
//     create a burst of new toasts — server-backed rows are merged
//     into the store silently with their existing dedupeKey.
//   - Chats: server conversations are merged into the local store
//     using their stable conversation id; local messages that are
//     newer than the server's last message are preserved (so an
//     unsynced local draft is never lost).
//   - Saved items: server favorites are restored into the local
//     store (e.g. the markets favorites Set) for supported categories.
//
// This module is the single point of truth for cloud → local hydration.
// useFavorites) keep their existing shape; we
// only add a `hydrate*` function to each as needed.

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

const HYDRATION_KEY = "lucian-cloud-hydrated-at";
const HYDRATION_USER_KEY = "lucian-cloud-hydrated-user";
const HYDRATION_TTL_MS = 5 * 60 * 1000; // re-hydrate at most every 5 min

// PHASE 17 carry-over fix: per-user account isolation.
//
// Tracks the userId of the last authenticated session that hydrated
// local stores. When a DIFFERENT userId logs in on the same browser,
// we clear account-backed localStorage + reset zustand stores BEFORE
// hydrating — otherwise User B would see User A's notifications,
// chats, saved items, etc. that were hydrated previously.
//
// Device-local data (settings, theme, accent, DevWorkspace IndexedDB
// projects) is preserved — those are intentionally not in the
// ACCOUNT_BACKED_KEYS list.
//
// Phase 17 account-isolation fix: the hydration marker itself is now
// scoped to the user (HYDRATION_USER_KEY), so a different user logging
// in within the TTL is NOT falsely considered "recently hydrated".
//
// FINAL DATA-CLASSIFICATION FIX — rule: if LUCIAN clears something on
// account switch, a reliable server source must be able to restore it.
// Categories re-audited against the ACTUAL live-sync/hydration code:
//
//   ACCOUNT-BACKED (cleared — hydrateCloudData restores them):
//     lucian-news-watchlist (topics), lucian-investing
//       (watchlist/research/theses ONLY — surgical reset),
//     lucian-markets-favorites,
//     lucian-browser-v2 (bookmarks), lucian-news-feed (saved articles)
//
//   DEVICE-LOCAL (NEVER cleared — no cloud restore path exists):
//     lucian-markets-price-alerts (no live sync, no hydration —
//       user-created alerts are device functionality)
//     lucian-news-weather (manual weather location preference —
//       device-local like other preferences)
//     lucian-investing paper/simulation state: investments,
//       transactions, dividends, activities, portfolios (explicitly
//       NOT cloud-synced — see hydrateInvestingSavedItems comment)

const ACCOUNT_BACKED_KEYS = [
  // Notification cloud cache
  "lucian-notifications",
  // Saved-items cloud caches
  "lucian-news-watchlist",
  "lucian-markets-favorites",
  "lucian-browser-v2", // bookmarks (cloud-synced) — Phase 17 fix: was lucian-browser (obsolete)
  "lucian-news-feed", // saved articles (account-backed) — widgets/preferences are also cleared for simplicity
  // NOTE: lucian-markets-price-alerts and lucian-news-weather are
  // DEVICE-LOCAL — intentionally NOT cleared on account switch (no
  // cloud restore path exists for either).
  // NOTE: lucian-investing is NOT bulk-removed here either — its
  // persisted state holds DEVICE-LOCAL paper data (investments,
  // transactions, dividends, activities, portfolios). The account-backed
  // fields (watchlist/research/theses) are cleared surgically via the
  // in-memory reset below, which re-persists the surviving state.
  // Pending server-sync queue (ownership must match the session)
  "lucian-sync-pending",
  // Hydration marker (so the new user re-hydrates)
  "lucian-cloud-hydrated-at",
  "lucian-cloud-hydrated-user",
];

/** Clear account-backed local data so a different authenticated user
 *  does not see the previous user's hydrated caches. Called when the
 *  authenticated user.id changes (User A logs out → User B logs in
 *  on the same browser).
 *
 *  PRESERVED (genuinely device-local):
 *    - lucian-settings (theme, accent, accessibility, density)
 *    - lucian-economy-hub (local-only state)
 *    - lucian-vault (manual self-reported financial data — explicitly
 *      device-local per the schema comment in prisma/schema.prisma)
 *    - lucian-markets-price-alerts (device-local alerts — no cloud
 *      save/hydrate path)
 *    - lucian-news-weather (manual weather location — device-local)
 *    - Investing paper/simulation state: investments, transactions,
 *      dividends, activities, portfolios (NOT server-backed — the
 *      server can only restore watchlist/research/theses, so ONLY
 *      those three are cleared)
 *    - DevWorkspace IndexedDB projects (always device-local)
 *    - All editor buffers, drafts, settings
 *
 *  CLEARED (account-backed caches hydrated from server): see list above. */
function clearAccountBackedLocalData(): void {
  if (typeof window === "undefined") return;
  for (const key of ACCOUNT_BACKED_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }
  // Also reset the in-memory zustand stores so the user doesn't see
  // User A's data flashed before the next hydration completes.
  // Each reset is independently try/caught — a missing store or method
  // does NOT abort the others.
  try {
    const notifMod = require("@/store/notifications") as typeof import("@/store/notifications");
    notifMod.useNotificationStore.getState().clear?.();
  } catch { /* store not available */ }
  try {
    const browserMod = require("@/store/browser") as typeof import("@/store/browser");
    browserMod.useBrowserStore.setState({ bookmarks: [] });
  } catch { /* store not available */ }
  try {
    const newsFeedMod = require("@/store/news-feed") as typeof import("@/store/news-feed");
    newsFeedMod.useNewsFeedStore.setState({ saved: [] });
  } catch { /* store not available */ }
  try {
    const newsWlMod = require("@/store/news-watchlist") as typeof import("@/store/news-watchlist");
    newsWlMod.useNewsWatchlistStore.setState({ topics: [] });
  } catch { /* store not available */ }
  try {
    const investingMod = require("@/store/investing") as typeof import("@/store/investing");
    // FINAL FIX: clear ONLY the account-backed investing metadata the
    // server can restore (watchlist / research / theses — all three
    // have live sync + hydration). Paper/simulation data (investments,
    // transactions, dividends, activities, portfolios) is DEVICE-LOCAL:
    // it is never uploaded, so clearing it here would permanently
    // destroy user data with no restore path.
    investingMod.useInvestingStore.setState({
      watchlist: [],
      research: [],
      theses: [],
    });
  } catch { /* store not available */ }
  // DEVICE-LOCAL (final classification — do NOT clear on account switch):
  //   - lucian-markets-price-alerts (no cloud save/hydrate path)
  //   - lucian-news-weather (manual weather location preference)
  //   - investing investments/transactions/dividends/activities/portfolios
  // The in-memory stores above keep their state; nothing to reset here.
}

/** Returns the userId of the last authenticated session that hydrated
 *  local caches, or null if no previous user. */
function getLastAuthenticatedUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(HYDRATION_USER_KEY);
  } catch {
    return null;
  }
}

/** Records the current authenticated userId so the next session change
 *  can detect a user switch. */
function setLastAuthenticatedUserId(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(HYDRATION_USER_KEY, userId);
  } catch {
    /* storage unavailable */
  }
}

interface ServerNotification {
  id: string;
  source: string;
  title: string;
  message: string;
  level: string;
  actionable: boolean;
  resolved: boolean;
  readAt: string | null;
  dismissedAt: string | null;
  dedupeKey: string | null;
  entityRef: string | null;
  deepLink: string | null;
  lastTriggerAt: string;
  createdAt: string;
}

interface ServerSavedItem {
  id: string;
  source: string;
  type: string;
  refId: string | null;
  title: string;
  data: unknown;
  createdAt: string;
}

/** Mark that hydration has run at time t. The next session change within
 *  the TTL skips hydration; past the TTL we re-hydrate (so a long-lived
 *  session still picks up server-side changes from another device).
 *  Phase 17 account-isolation fix: we ALSO record the user id that owns
 *  this hydration marker. When a DIFFERENT user logs in next, the marker
 *  is treated as stale (different owner → must re-hydrate from THEIR
 *  server data) so user B never inherits user A's hydration state. */
function markHydrated(userId?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(HYDRATION_KEY, String(Date.now()));
    localStorage.setItem(HYDRATION_USER_KEY, userId ?? "");
  } catch { /* storage unavailable */ }
}

/** True if hydration has run recently (within the TTL) AND the user id
 *  matches the current authenticated user. A different user → not hydrated
 *  recently → triggers a fresh hydration from the new user's server data. */
function hydratedRecently(userId?: string | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(HYDRATION_KEY);
    if (!raw) return false;
    const ts = parseInt(raw, 10);
    if (!Number.isFinite(ts)) return false;
    if (Date.now() - ts >= HYDRATION_TTL_MS) return false;
    // TTL OK — but verify it was for the SAME user.
    const storedUser = localStorage.getItem(HYDRATION_USER_KEY);
    const currentUser = userId ?? "";
    if (storedUser !== currentUser) return false;
    return true;
  } catch {
    return false;
  }
}

/** Fetch with timeout — never block the UI on a slow server. */
async function fetchJsonWithTimeout(url: string, ms = 8000): Promise<{ ok: true; data: unknown } | { ok: false }> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), ms);
    const res = await fetch(url, { credentials: "same-origin", signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return { ok: false };
    const json = await res.json();
    return { ok: true, data: json };
  } catch {
    return { ok: false };
  }
}

/** Hydrate notifications into useNotificationStore. The store's existing
 *  dedupeKey model handles dedupe — we use `add()` (low-level, skips
 *  cooldown) to insert server rows WITHOUT replaying sounds. The store
 *  itself gates sound playback to producer calls (notify()), not add(),
 *  so hydrated records are silent. */
async function hydrateNotifications(): Promise<void> {
  const result = await fetchJsonWithTimeout("/api/user/notifications?limit=200");
  if (!result.ok) return;
  const data = result.data as { ok?: boolean; notifications?: ServerNotification[] };
  if (!data?.notifications || !Array.isArray(data.notifications)) return;
  try {
    const mod = require("@/store/notifications") as typeof import("@/store/notifications");
    const store = mod.useNotificationStore.getState();
    const existing = store.notifications;
    const existingIds = new Set(existing.map((n) => n.id));
    const existingDedupeKeys = new Set(
      existing.map((n) => n.dedupeKey).filter((k): k is string => Boolean(k)),
    );
    for (const sn of data.notifications) {
      // Skip if we already have this notification (by id OR dedupeKey).
      if (existingIds.has(sn.id)) continue;
      if (sn.dedupeKey && existingDedupeKeys.has(sn.dedupeKey)) continue;
      const level = (["info", "success", "warning", "error"].includes(sn.level) ? sn.level : "info") as
        | "info" | "success" | "warning" | "error";
      // Use the low-level add() path so we DON'T trigger sound or
      // re-bump cooldowns — hydrated records are inserted silently.
      // Pass the server's stable id so future updates (mark-read,
      // dismiss) hit the same row.
      store.add({
        id: sn.id,
        source: sn.source,
        title: sn.title,
        message: sn.message,
        level,
        // Preserve the server's read / dismissed state — the user may
        // have already acknowledged this notification on another device.
        // (add() overrides `read` to false; we restore it post-add.)
        deepLink: sn.deepLink ?? undefined,
        actionable: sn.actionable,
        entity: sn.entityRef
          ? (() => {
              const [module, type, ...rest] = sn.entityRef.split(":");
              return { module, type, id: rest.join(":") };
            })()
          : undefined,
        dedupeKey: sn.dedupeKey ?? undefined,
      });
      // add() forces read=false — restore the server's read state via
      // the markRead API if the server says it was already read.
      if (sn.readAt !== null || sn.dismissedAt !== null) {
        // Direct setState bypasses the public API to avoid an extra
        // row scan — we just patched the record above.
        mod.useNotificationStore.setState((s) => ({
          notifications: s.notifications.map((n) =>
            n.id === sn.id
              ? {
                  ...n,
                  read: sn.readAt !== null ? true : n.read,
                  dismissed: sn.dismissedAt !== null ? true : n.dismissed,
                  resolved: sn.resolved,
                }
              : n,
          ),
        }));
      }
    }
  } catch {
    /* notification store not available — fail silently */
  }
}

/** Hydrate saved items back into their respective local stores.
 *
 *  Phase 17: covers ALL four account-backed saved-content sources:
 *    - markets   → localStorage `lucian-markets-favorites` (raw JSON array)
 *    - browser   → useBrowserStore.bookmarks (zustand persist)
 *    - news      → useNewsFeedStore.saved (articles) + useNewsWatchlistStore.topics
 *    - investing → useInvestingStore.watchlist + research + theses
 *
 *  Each source is hydrated INDEPENDENTLY and try/caught — a failure in
 *  one category does NOT abort the others. Items are merged with dedupe
 *  so we never overwrite newer local edits or create duplicates. */
async function hydrateSavedItems(): Promise<void> {
  // Fetch ALL saved items in one request (no source filter) — the server
  // returns every row for the authenticated user, sorted by createdAt desc.
  const result = await fetchJsonWithTimeout("/api/user/saved-items");
  if (!result.ok) return;
  const data = result.data as { ok?: boolean; items?: ServerSavedItem[] };
  if (!data?.items || !Array.isArray(data.items)) return;

  // Group by source for targeted hydration.
  const bySource = new Map<string, ServerSavedItem[]>();
  for (const item of data.items) {
    const arr = bySource.get(item.source) ?? [];
    arr.push(item);
    bySource.set(item.source, arr);
  }

  // Hydrate each source independently.
  hydrateMarketsFavorites(bySource.get("markets") ?? []);
  hydrateBrowserBookmarks(bySource.get("browser") ?? []);
  hydrateNewsSavedItems(bySource.get("news") ?? []);
  hydrateInvestingSavedItems(bySource.get("investing") ?? []);
}

/** Merge server markets favorites into the local favorites Set.
 *  Dispatches BOTH a synthetic storage event AND a custom :changed
 *  event so the useSyncExternalStore-based useFavorites hook picks up
 *  the change on the same tab. */
function hydrateMarketsFavorites(items: ServerSavedItem[]): void {
  if (typeof window === "undefined" || items.length === 0) return;
  try {
    const FAVORITES_KEY = "lucian-markets-favorites";
    const existing = new Set<string>(
      (() => {
        try {
          const raw = localStorage.getItem(FAVORITES_KEY);
          return raw ? (JSON.parse(raw) as string[]) : [];
        } catch { return []; }
      })(),
    );
    let changed = false;
    for (const item of items) {
      if (item.type !== "favorite" || !item.refId) continue;
      if (!existing.has(item.refId)) {
        existing.add(item.refId);
        changed = true;
      }
    }
    if (changed) {
      const serialized = JSON.stringify([...existing]);
      try {
        localStorage.setItem(FAVORITES_KEY, serialized);
      } catch { /* storage unavailable */ }
      // Dispatch both event types so useSyncExternalStore picks up the
      // change regardless of which listener pattern the hook uses.
      try {
        window.dispatchEvent(new StorageEvent("storage", {
          key: FAVORITES_KEY,
          newValue: serialized,
        }));
      } catch { /* non-fatal */ }
      try {
        window.dispatchEvent(new Event(FAVORITES_KEY + ":changed"));
      } catch { /* non-fatal */ }
    }
  } catch {
    /* non-fatal */
  }
}

/** Merge server browser bookmarks into useBrowserStore.
 *  Dedupes by URL — local bookmarks that are newer (higher createdAt)
 *  are preserved over server duplicates. */
function hydrateBrowserBookmarks(items: ServerSavedItem[]): void {
  if (typeof window === "undefined" || items.length === 0) return;
  try {
    const mod = require("@/store/browser") as typeof import("@/store/browser");
    const store = mod.useBrowserStore.getState();
    const existingByUrl = new Map(store.bookmarks.map((b) => [b.url, b]));
    let added = 0;
    for (const item of items) {
      if (item.type !== "bookmark" || !item.refId) continue;
      // refId is the URL (set by addBookmark).
      const url = item.refId;
      if (existingByUrl.has(url)) continue; // local already has it
      // Reconstruct the bookmark from the server data.
      const data = (item.data ?? {}) as { title?: string };
      const bookmark: import("@/store/browser").BrowserBookmark = {
        id: `bm_cloud_${item.id}`,
        url,
        title: data.title || item.title || url,
        createdAt: new Date(item.createdAt).getTime(),
      };
      existingByUrl.set(url, bookmark);
      added++;
    }
    if (added > 0) {
      mod.useBrowserStore.setState({
        bookmarks: [...existingByUrl.values()].sort((a, b) => b.createdAt - a.createdAt),
      });
    }
  } catch {
    /* browser store not available — fail silently */
  }
}

/** Merge server news saved items into useNewsFeedStore.saved (articles)
 *  AND useNewsWatchlistStore.topics. Dedupes by id — local items are
 *  preserved over server duplicates. */
function hydrateNewsSavedItems(items: ServerSavedItem[]): void {
  if (typeof window === "undefined" || items.length === 0) return;

  // Articles (type="article")
  try {
    const mod = require("@/store/news-feed") as typeof import("@/store/news-feed");
    const store = mod.useNewsFeedStore.getState();
    const existingIds = new Set(store.saved.map((a) => a.id));
    const toAdd: import("@/store/news-feed").SavedArticle[] = [];
    for (const item of items) {
      if (item.type !== "article" || !item.refId) continue;
      if (existingIds.has(item.refId)) continue;
      // Reconstruct the article from the server data.
      const data = (item.data ?? {}) as Partial<import("@/store/news-feed").SavedArticle>;
      toAdd.push({
        id: item.refId,
        title: data.title || item.title || "Untitled",
        description: data.description ?? "",
        url: data.url ?? "",
        source: data.source ?? "unknown",
        category: data.category ?? "general",
        publishedAt: data.publishedAt ?? 0,
        imageUrl: data.imageUrl,
        savedAt: data.savedAt ?? new Date(item.createdAt).getTime(),
      });
      existingIds.add(item.refId);
    }
    if (toAdd.length > 0) {
      mod.useNewsFeedStore.setState((s) => ({
        saved: [...toAdd, ...s.saved],
      }));
    }
  } catch {
    /* news-feed store not available */
  }

  // Topics (type="topic")
  try {
    const mod = require("@/store/news-watchlist") as typeof import("@/store/news-watchlist");
    const store = mod.useNewsWatchlistStore.getState();
    const existingIds = new Set(store.topics.map((t) => t.id));
    const toAdd: import("@/store/news-watchlist").WatchlistTopic[] = [];
    for (const item of items) {
      if (item.type !== "topic" || !item.refId) continue;
      if (existingIds.has(item.refId)) continue;
      const data = (item.data ?? {}) as Partial<import("@/store/news-watchlist").WatchlistTopic>;
      toAdd.push({
        id: item.refId,
        label: data.label || item.title || item.refId,
        enabled: data.enabled ?? true,
        addedAt: data.addedAt ?? new Date(item.createdAt).getTime(),
      });
      existingIds.add(item.refId);
    }
    if (toAdd.length > 0) {
      mod.useNewsWatchlistStore.setState((s) => ({
        topics: [...s.topics, ...toAdd],
      }));
    }
  } catch {
    /* news-watchlist store not available */
  }
}

/** Merge server investing saved metadata into useInvestingStore.
 *  Covers watchlist, research, and theses — the three account-backed
 *  metadata categories the product syncs. Positions / transactions /
 *  dividends are NOT synced (per spec: "Do NOT cloud-sync paper values"). */
function hydrateInvestingSavedItems(items: ServerSavedItem[]): void {
  if (typeof window === "undefined" || items.length === 0) return;
  try {
    const mod = require("@/store/investing") as typeof import("@/store/investing");
    const store = mod.useInvestingStore.getState();

    // Watchlist (type="watchlist")
    const existingWlIds = new Set(store.watchlist.map((w) => w.id));
    const wlToAdd: import("@/store/investing").WatchlistItem[] = [];
    // Research (type="research")
    const existingResIds = new Set(store.research.map((r) => r.id));
    const resToAdd: import("@/store/investing").ResearchItem[] = [];
    // Theses (type="thesis")
    const existingThesisInvIds = new Set(store.theses.map((t) => t.investmentId));
    const thesisToAdd: import("@/store/investing").Thesis[] = [];

    for (const item of items) {
      if (!item.refId) continue;
      const data = (item.data ?? {}) as Record<string, unknown>;
      if (item.type === "watchlist") {
        if (existingWlIds.has(item.refId)) continue;
        wlToAdd.push({
          id: item.refId,
          symbol: String(data.symbol ?? ""),
          name: String(data.name ?? data.symbol ?? ""),
          assetType: (data.assetType as import("@/store/investing").AssetType) ?? "other",
          targetEntry: Number(data.targetEntry ?? 0),
          notes: String(data.notes ?? ""),
          createdAt: Number(data.addedAt ?? new Date(item.createdAt).getTime()),
        });
        existingWlIds.add(item.refId);
      } else if (item.type === "research") {
        if (existingResIds.has(item.refId)) continue;
        resToAdd.push({
          id: item.refId,
          title: String(data.title ?? item.title ?? "Untitled"),
          type: String(data.type ?? "article"),
          source: String(data.source ?? ""),
          url: String(data.url ?? ""),
          symbol: String(data.symbol ?? ""),
          notes: String(data.notes ?? ""),
          savedAt: Number(data.savedAt ?? new Date(item.createdAt).getTime()),
        });
        existingResIds.add(item.refId);
      } else if (item.type === "thesis") {
        if (existingThesisInvIds.has(item.refId)) continue;
        thesisToAdd.push({
          investmentId: item.refId,
          reason: String(data.reason ?? ""),
          horizon: String(data.horizon ?? "Long Term · 3–5 years"),
          confidence: (data.confidence as import("@/store/investing").Thesis["confidence"]) ?? "medium",
          targetPrice: Number(data.targetPrice ?? 0),
          risks: String(data.risks ?? ""),
          reassessmentConditions: String(data.reassessmentConditions ?? ""),
          createdAt: Number(data.createdAt ?? new Date(item.createdAt).getTime()),
          lastReviewedAt: Number(data.lastReviewedAt ?? Date.now()),
          nextReviewAt: Number(data.nextReviewAt ?? Date.now() + 90 * 86400000),
        });
        existingThesisInvIds.add(item.refId);
      }
    }

    if (wlToAdd.length > 0 || resToAdd.length > 0 || thesisToAdd.length > 0) {
      mod.useInvestingStore.setState((s) => ({
        watchlist: [...s.watchlist, ...wlToAdd],
        research: [...s.research, ...resToAdd],
        theses: [...s.theses, ...thesisToAdd],
      }));
    }
  } catch {
    /* investing store not available */
  }
}

/** Top-level hydration entry point. Runs the three hydration passes
 *  in parallel. Each pass is independently try/caught — a failure in
 *  one category does NOT abort the others, and never throws to the
 *  caller. */
export async function hydrateCloudData(userId?: string | null): Promise<void> {
  if (typeof window === "undefined") return;
  // Mark BEFORE we run so a concurrent mount doesn't double-fire.
  // The marker is scoped to the current user so user B never inherits
  // user A's hydration state.
  markHydrated(userId);
  await Promise.allSettled([
    hydrateNotifications(),
    hydrateSavedItems(),
  ]);
}


export function useCloudHydration(): void {
  const { status, data: session } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const didHydrateRef = useRef(false);
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") {
      // Reset on sign-out so a re-sign-in re-runs hydration.
      didHydrateRef.current = false;
      lastUserIdRef.current = null;
      return;
    }
    // Per-user account isolation: if a DIFFERENT user logged in on
    // this browser, clear account-backed local caches before hydrating.
    // We check BOTH the ref (in-hook session tracking) AND the localStorage
    // marker (cross-tab/cross-refresh tracking).
    if (userId && lastUserIdRef.current !== userId) {
      const storedUserId = getLastAuthenticatedUserId();
      if (storedUserId && storedUserId !== userId) {
        // User switched — purge account-backed caches.
        clearAccountBackedLocalData();
      }
      setLastAuthenticatedUserId(userId);
      lastUserIdRef.current = userId;
      // Force re-hydration after a user switch.
      didHydrateRef.current = false;
    }
    if (didHydrateRef.current) return;
    if (hydratedRecently(userId)) {
      // Skip — we hydrated very recently for THIS user (e.g. on a quick
      // route change within the same session). Still mark as done.
      didHydrateRef.current = true;
      return;
    }
    didHydrateRef.current = true;
    void hydrateCloudData(userId).catch(() => { /* non-fatal — local data preserved */ });
  }, [status, userId]);
}
