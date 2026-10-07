"use client";

// LUCIAN Browser — canonical store (Phase 15).
//
// ONE store for Browser tabs, bookmarks, and history. Persists to
// localStorage with versioning so future schema changes can migrate
// without breaking users' existing data.
//
// Per-tab LUCIAN-controlled history:
//   - history[] holds the URLs LUCIAN itself navigated to (address bar,
//     bookmark click, history click, deep link, search).
//   - historyIndex points at the current position.
//   - Back/Forward move within this stack.
//   - New navigation after going Back truncates the forward branch.
//   - We NEVER read cross-origin iframe DOM to populate history.
//   - We NEVER throw a SecurityError attempting forbidden access.
//
// Bookmarks + history are separate concepts:
//   - Bookmarks: user-curated, persist forever.
//   - History: LUCIAN-known navigation log, bounded (200 entries).

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { hostnameForDisplay, normalizeUrl, UnsafeAddressError } from "@/lib/browser/url";
import { syncSavedItem, deleteSavedItemByRef } from "@/lib/auth/live-sync";

// ── Types ────────────────────────────────────────────────────────────────

/** Load state of a Browser tab. */
export type TabLoadState =
  | "idle"           // no URL yet (new tab)
  | "loading"        // navigation dispatched, iframe loading
  | "embedded"       // iframe onLoad fired + we believe content rendered
  | "possibly-blocked" // iframe onLoad fired but we suspect content didn't render
  | "blocked-by-policy" // server-side embed-policy check returned "blocked"
  | "failed"         // iframe errored or timed out
  | "unsafe"         // address was rejected (unsafe scheme / invalid)
  ;

/** Embed-policy classification (from the server-side checker, when run). */
export interface EmbedPolicy {
  state: "blocked" | "potentially-embeddable" | "unknown" | "not-checked";
  /** Reason for the classification (empty for not-checked). */
  reason?: string;
  /** The final URL after redirects (for transparency). */
  finalUrl?: string;
  /** Raw header values found (for the "Why?" explainer). */
  xFrameOptions?: string;
  contentSecurityPolicy?: string;
  /** Content-type of the response (informational). */
  contentType?: string;
  /** When the check ran (epoch ms) — for client-side cache TTL. */
  checkedAt?: number;
}

/** One LUCIAN Browser tab. */
export interface BrowserTab {
  id: string;
  /** The URL the user asked LUCIAN to load. This is the SOURCE OF
   *  TRUTH for the address bar + history. It is always http(s) or "". */
  requestedUrl: string;
  /** Display label — hostname fallback (we never read cross-origin DOM). */
  label: string;
  /** LUCIAN-controlled navigation stack for this tab. */
  history: string[];
  /** Index into history[] of the current page. -1 when empty. */
  historyIndex: number;
  /** Current load state — drives the content-area UI. */
  loadState: TabLoadState;
  /** Embed-policy result (cached per-tab). */
  embedPolicy: EmbedPolicy;
  /** When this tab was created (epoch ms). */
  createdAt: number;
}

/** One bookmark. */
export interface BrowserBookmark {
  id: string;
  url: string;
  title: string;
  createdAt: number;
}

/** One history entry. */
export interface BrowserHistoryEntry {
  url: string;
  title: string;
  visitedAt: number;
}

// ── Persistence schema (versioned) ───────────────────────────────────────

/** Shape persisted to localStorage. Bump SCHEMA_VERSION when this changes;
 *  the migrate() function handles upgrades. */
interface PersistedState {
  schemaVersion: number;
  bookmarks: BrowserBookmark[];
  history: BrowserHistoryEntry[];
  tabs: BrowserTab[];
  activeTabId: string;
}

const SCHEMA_VERSION = 2;
const STORAGE_KEY = "lucian-browser-v2";

// Old v1 shape (from the Phase 14 Browser) — used only by migrate().
interface V1Persisted {
  bookmarks: { url: string; title: string; addedAt: number }[];
  history: { url: string; title: string; visitedAt: number }[];
}

function newTabId(): string {
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function newBookmarkId(): string {
  return `bm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeEmptyTab(): BrowserTab {
  return {
    id: newTabId(),
    requestedUrl: "",
    label: "New Tab",
    history: [],
    historyIndex: -1,
    loadState: "idle",
    embedPolicy: { state: "not-checked" },
    createdAt: Date.now(),
  };
}

/** Derive a label from a URL. We use the hostname — never read
 *  cross-origin iframe DOM. */
function labelForUrl(url: string): string {
  if (!url) return "New Tab";
  return hostnameForDisplay(url) || url;
}

// ── Store interface ──────────────────────────────────────────────────────

interface BrowserStore {
  tabs: BrowserTab[];
  activeTabId: string;
  bookmarks: BrowserBookmark[];
  history: BrowserHistoryEntry[];

  // Tab operations
  newTab: () => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;

  // Navigation
  navigateActive: (input: string) => { ok: boolean; error?: string };
  goBack: () => void;
  goForward: () => void;
  reloadActive: () => void;

  // Load state (called by iframe onLoad/onError + embed-policy check)
  setTabLoadState: (id: string, state: TabLoadState) => void;
  setTabEmbedPolicy: (id: string, policy: EmbedPolicy) => void;

  // Bookmarks
  addBookmark: (url: string, title?: string) => void;
  removeBookmark: (id: string) => void;
  removeBookmarkByUrl: (url: string) => void;
  isBookmarked: (url: string) => boolean;

  // History
  clearHistory: () => void;
  removeHistoryEntry: (url: string) => void;
}

// ── Store implementation ─────────────────────────────────────────────────

export const useBrowserStore = create<BrowserStore>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: "",
      bookmarks: [],
      history: [],

      newTab: () => {
        const tab = makeEmptyTab();
        set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
        return tab.id;
      },

      closeTab: (id) => {
        set((s) => {
          const next = s.tabs.filter((t) => t.id !== id);
          if (next.length === 0) {
            // Always keep at least one tab.
            const fresh = makeEmptyTab();
            return { tabs: [fresh], activeTabId: fresh.id };
          }
          let activeTabId = s.activeTabId;
          if (id === s.activeTabId) {
            // Pick the nearest tab to the left, fallback to first.
            const closedIdx = s.tabs.findIndex((t) => t.id === id);
            const nextIdx = Math.max(0, closedIdx - 1);
            activeTabId = next[Math.min(nextIdx, next.length - 1)].id;
          }
          return { tabs: next, activeTabId };
        });
      },

      setActiveTab: (id) => {
        set(() => ({ activeTabId: id }));
      },

      navigateActive: (input) => {
        let url: string;
        try {
          url = normalizeUrl(input);
        } catch (e) {
          if (e instanceof UnsafeAddressError) {
            return { ok: false, error: e.message };
          }
          return { ok: false, error: "Invalid address" };
        }
        if (!url) return { ok: false, error: "Empty address" };

        set((s) => {
          const tabs = s.tabs.map((t) => {
            if (t.id !== s.activeTabId) return t;
            // Truncate forward branch — new nav invalidates forward history.
            const truncatedHistory = t.history.slice(0, t.historyIndex + 1);
            const newHistory = [...truncatedHistory, url];
            const newIndex = newHistory.length - 1;
            return {
              ...t,
              requestedUrl: url,
              label: labelForUrl(url),
              history: newHistory,
              historyIndex: newIndex,
              loadState: "loading" as TabLoadState,
              embedPolicy: { state: "not-checked" as const },
            };
          });
          // Add to global history (dedupe consecutive duplicates).
          const last = s.history[0];
          const newEntry: BrowserHistoryEntry = {
            url,
            title: labelForUrl(url),
            visitedAt: Date.now(),
          };
          const history = (last && last.url === url)
            ? [newEntry, ...s.history.slice(1)]
            : [newEntry, ...s.history];
          return {
            tabs,
            history: history.slice(0, 200),
          };
        });
        return { ok: true };
      },

      goBack: () => {
        set((s) => {
          const tabs = s.tabs.map((t) => {
            if (t.id !== s.activeTabId) return t;
            if (t.historyIndex <= 0) return t;
            const newIndex = t.historyIndex - 1;
            const url = t.history[newIndex];
            return {
              ...t,
              requestedUrl: url,
              label: labelForUrl(url),
              historyIndex: newIndex,
              loadState: "loading" as TabLoadState,
              embedPolicy: { state: "not-checked" as const },
            };
          });
          return { tabs };
        });
      },

      goForward: () => {
        set((s) => {
          const tabs = s.tabs.map((t) => {
            if (t.id !== s.activeTabId) return t;
            if (t.historyIndex >= t.history.length - 1) return t;
            const newIndex = t.historyIndex + 1;
            const url = t.history[newIndex];
            return {
              ...t,
              requestedUrl: url,
              label: labelForUrl(url),
              historyIndex: newIndex,
              loadState: "loading" as TabLoadState,
              embedPolicy: { state: "not-checked" as const },
            };
          });
          return { tabs };
        });
      },

      reloadActive: () => {
        set((s) => {
          const tabs = s.tabs.map((t) => {
            if (t.id !== s.activeTabId) return t;
            if (!t.requestedUrl) return t;
            // Reset to loading — the iframe re-mounts via key change.
            return {
              ...t,
              loadState: "loading" as TabLoadState,
              embedPolicy: { state: "not-checked" as const },
            };
          });
          return { tabs };
        });
      },

      setTabLoadState: (id, state) => {
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === id ? { ...t, loadState: state } : t)),
        }));
      },

      setTabEmbedPolicy: (id, policy) => {
        set((s) => ({
          tabs: s.tabs.map((t) => {
            if (t.id !== id) return t;
            // If the policy says "blocked", override the load state to
            // reflect it. Otherwise keep the current load state — the
            // iframe onLoad will update it.
            if (policy.state === "blocked") {
              return { ...t, embedPolicy: policy, loadState: "blocked-by-policy" as TabLoadState };
            }
            return { ...t, embedPolicy: policy };
          }),
        }));
      },

      addBookmark: (url, title) => {
        if (!url) return;
        const resolvedTitle = title || labelForUrl(url);
        set((s) => {
          // Dedupe by URL — if it already exists, do nothing.
          if (s.bookmarks.some((b) => b.url === url)) return s;
          const bookmark: BrowserBookmark = {
            id: newBookmarkId(),
            url,
            title: resolvedTitle,
            createdAt: Date.now(),
          };
          return { bookmarks: [bookmark, ...s.bookmarks] };
        });
        // Phase 17: live server-sync (best-effort, non-blocking).
        // refId is the URL so deletes can find the row without knowing
        // the server's row id. The server dedupes by (userId, source, refId).
        void syncSavedItem({
          source: "browser",
          type: "bookmark",
          refId: url,
          title: resolvedTitle,
          data: { url, title: resolvedTitle },
        }).catch(() => { /* non-fatal — local already succeeded */ });
      },

      removeBookmark: (id) => {
        // Find the bookmark's url BEFORE mutating so we can delete the
        // server row by (source, refId=url).
        const target = get().bookmarks.find((b) => b.id === id);
        set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== id) }));
        if (target?.url) {
          void deleteSavedItemByRef({ source: "browser", refId: target.url }).catch(() => { /* non-fatal */ });
        }
      },

      removeBookmarkByUrl: (url) => {
        set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.url !== url) }));
        if (url) {
          void deleteSavedItemByRef({ source: "browser", refId: url }).catch(() => { /* non-fatal */ });
        }
      },

      isBookmarked: (url) => {
        return get().bookmarks.some((b) => b.url === url);
      },

      clearHistory: () => {
        set(() => ({ history: [] }));
      },

      removeHistoryEntry: (url) => {
        set((s) => ({ history: s.history.filter((h) => h.url !== url) }));
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          // SSR-safe fallback — returns null on every get during SSR.
          return {
            getItem: () => null,
            setItem: () => {},
            removeItem: () => {},
          };
        }
        return window.localStorage;
      }),
      version: SCHEMA_VERSION,
      // Only persist data fields, not the action functions.
      partialize: (s): PersistedState => ({
        schemaVersion: SCHEMA_VERSION,
        bookmarks: s.bookmarks,
        history: s.history,
        tabs: s.tabs,
        activeTabId: s.activeTabId,
      }),
      // Migrate from older schemas (v1 → v2).
      migrate: (persisted: unknown, version: number): Partial<BrowserStore> => {
        if (version < 2 && persisted && typeof persisted === "object") {
          // v1 shape — convert to v2.
          const v1 = persisted as V1Persisted;
          const bookmarks: BrowserBookmark[] = (v1.bookmarks || []).map((b, i) => ({
            id: `bm_migrated_${i}_${Math.random().toString(36).slice(2, 8)}`,
            url: b.url,
            title: b.title,
            createdAt: b.addedAt,
          }));
          const history: BrowserHistoryEntry[] = (v1.history || []).map((h) => ({
            url: h.url,
            title: h.title,
            visitedAt: h.visitedAt,
          }));
          const freshTab = makeEmptyTab();
          return {
            bookmarks,
            history,
            tabs: [freshTab],
            activeTabId: freshTab.id,
          };
        }
        // Already v2 — return as-is (the persisted shape matches).
        return persisted as Partial<BrowserStore>;
      },
      // On rehydrate, ensure at least one tab exists.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (!state.tabs || state.tabs.length === 0) {
          const fresh = makeEmptyTab();
          state.tabs = [fresh];
          state.activeTabId = fresh.id;
        }
        // If activeTabId doesn't point at an existing tab, pick the first.
        if (!state.tabs.some((t) => t.id === state.activeTabId)) {
          state.activeTabId = state.tabs[0]?.id ?? "";
        }
      },
    },
  ),
);

// ── Convenience selectors ────────────────────────────────────────────────

export function selectActiveTab(s: BrowserStore): BrowserTab | undefined {
  return s.tabs.find((t) => t.id === s.activeTabId);
}
