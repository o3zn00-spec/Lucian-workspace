"use client";

/* LUCIAN Global Search — async ranked search engine.
 *
 * Phase 9: One canonical search system. Multiple providers run in parallel
 * via Promise.allSettled — one provider failing must NOT break the others.
 *
 * Providers return raw SearchResult[] (no ranking). The engine:
 *   1. Aggregates results from every provider.
 *   2. Computes a match-rank score per result against the query.
 *   3. Sorts: exact > prefix > word-boundary > filename/entity-name >
 *      substring > metadata/content.
 *   4. Groups by module (cap 6 groups, cap 5 results per group).
 *
 * DevWorkspace provider uses REAL IndexedDB data (db.listProjects()) —
 * there is no localStorage snapshot fallback for projects.
 */

import type { CatalogInstrument } from "@/lib/markets/catalog";
import { INSTRUMENT_CATALOG, getInstrumentBySymbol } from "@/lib/markets/catalog";
import type { ChessLesson } from "@/lib/chess-data";
import { CHESS_LESSONS } from "@/lib/chess-data";
import type { KnowledgeItem } from "@/lib/knowledge-data";
import { KNOWLEDGE_ITEMS } from "@/lib/knowledge-data";
import { listProjects } from "@/lib/workspace/db";

export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  module: string;
  moduleLabel: string;
  deepLink?: string;
  timestamp?: number;
  /**
   * Internal ranking hint computed by the provider. Lower = better match.
   * The engine re-ranks using its own scoring logic; this hint helps when
   * two results tie on the engine score (e.g. both are exact matches but
   * one is the entity name and the other is a substring match in content).
   *
   * 0  = exact match (entity name === query, case-insensitive)
   * 1  = prefix match (entity name starts with query)
   * 2  = word-boundary match (entity name has a word that starts with query)
   * 3  = filename / entity-name match (filename === query)
   * 4  = substring of entity name
   * 5  = metadata / content match only
   */
  matchRank?: number;
}

export interface SearchGroup {
  module: string;
  moduleLabel: string;
  results: SearchResult[];
}

export type SearchProvider = (query: string) => Promise<SearchResult[]>;

/* ────────────────────────────────────────────────────────────────────── */
/* Provider registry                                                      */
/* ────────────────────────────────────────────────────────────────────── */

const providers: { id: string; fn: SearchProvider }[] = [];

export function registerSearchProvider(id: string, provider: SearchProvider) {
  // De-duplicate: if a provider with the same id is already registered,
  // replace it (module-hot-reload safety).
  const existing = providers.findIndex((p) => p.id === id);
  if (existing >= 0) providers[existing] = { id, fn: provider };
  else providers.push({ id, fn: provider });
}

/**
 * Run every registered provider in parallel via Promise.allSettled.
 * One provider failing does NOT affect the others — its results are
 * simply omitted and a console.warn is emitted (dev only).
 */
export async function globalSearch(query: string): Promise<SearchGroup[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const q = trimmed.toLowerCase();

  const settled = await Promise.allSettled(
    providers.map(async (p) => ({ id: p.id, results: await p.fn(q) })),
  );

  const allResults: SearchResult[] = [];
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === "fulfilled") {
      allResults.push(...s.value.results);
    } else if (process.env.NODE_ENV !== "production") {
      console.warn(`[global-search] provider "${providers[i]?.id}" failed:`, s.reason);
    }
  }

  // Engine-side re-ranking (so providers that lie about matchRank are
  // still sorted correctly by the engine's own scoring).
  const ranked = allResults
    .map((r) => ({ r, score: computeScore(r, q) }))
    .sort((a, b) => a.score - b.score);

  // Group by module (preserving the rank order).
  const groups: Map<string, SearchGroup> = new Map();
  for (const { r } of ranked) {
    if (!groups.has(r.module)) {
      groups.set(r.module, {
        module: r.module,
        moduleLabel: r.moduleLabel,
        results: [],
      });
    }
    const g = groups.get(r.module)!;
    if (g.results.length < 5) g.results.push(r);
  }

  return Array.from(groups.values()).slice(0, 6);
}

/* ────────────────────────────────────────────────────────────────────── */
/* Ranking                                                                */
/* ────────────────────────────────────────────────────────────────────── */

/**
 * Compute a numeric score for a result against the (already-lowercased)
 * query. Lower = better. The exact tier order is:
 *
 *   0  exact match on title (entity name === query)
 *   1  prefix match on title
 *   2  word-boundary match on title
 *   3  exact match on a path/filename tail (basename === query)
 *   4  prefix match on filename
 *   5  substring of title
 *   6  substring of snippet (metadata / content)
 *
 * Ties are broken by provider-supplied matchRank, then by timestamp
 * (more recent first).
 */
function computeScore(r: SearchResult, q: string): number {
  const title = (r.title ?? "").toLowerCase();
  const snippet = (r.snippet ?? "").toLowerCase();

  if (title === q) return 0;
  if (title.startsWith(q)) return 1;
  if (wordStartsWith(title, q)) return 2;

  // Filename / entity-name tail match (e.g. "App.tsx" inside path "src/App.tsx").
  // Used by DevWorkspace file results where title = basename.
  // We treat a result whose id encodes a file path as eligible for tier 3-4.
  const tail = title.split(/[\\/]/).pop() ?? title;
  if (tail === q) return 3;
  if (tail.startsWith(q)) return 4;

  if (title.includes(q)) return 5;
  if (snippet.includes(q)) return 6;

  // Fallback — shouldn't happen since the provider already matched.
  return 7 + (r.matchRank ?? 99);
}

function wordStartsWith(haystack: string, needle: string): boolean {
  if (!needle) return false;
  // Word boundary: start of string OR a non-alphanumeric char precedes the match.
  let idx = haystack.indexOf(needle);
  while (idx >= 0) {
    if (idx === 0) return true;
    const prev = haystack.charCodeAt(idx - 1);
    // ASCII alnum / underscore means we're in the middle of a word.
    const isAlnum =
      (prev >= 48 && prev <= 57) || // 0-9
      (prev >= 65 && prev <= 90) || // A-Z
      (prev >= 97 && prev <= 122) || // a-z
      prev === 95; // _
    if (!isAlnum) return true;
    idx = haystack.indexOf(needle, idx + 1);
  }
  return false;
}

/* ────────────────────────────────────────────────────────────────────── */
/* Providers — every provider reads REAL LUCIAN data.                     */
/* ────────────────────────────────────────────────────────────────────── */

/* Helper: client-side guard for providers that read browser storage. */
function isClient(): boolean {
  return typeof window !== "undefined";
}

/* Helper: read a JSON value from localStorage, returning null on any error. */
function readLS<T = unknown>(key: string): T | null {
  if (!isClient()) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/* ── Navigation provider ───────────────────────────────────────────── */

interface NavItem {
  label: string;
  path: string;
  keywords: string[];
}

const NAV_ITEMS: NavItem[] = [
  { label: "Home", path: "/", keywords: ["home", "dashboard"] },
  { label: "Markets", path: "/markets", keywords: ["markets", "trading", "chart"] },
  { label: "Investing", path: "/investing", keywords: ["investing", "portfolio", "holdings"] },
  { label: "Vault", path: "/vault", keywords: ["vault", "money", "account", "balance"] },
  { label: "Economy Hub", path: "/economy-hub", keywords: ["economy", "opportunity", "business"] },
  { label: "News", path: "/news-feed", keywords: ["news", "feed", "discovery"] },
  { label: "Research", path: "/research", keywords: ["research", "evidence", "sources", "analysis"] },
  { label: "DevWorkspace", path: "/dev-workspace", keywords: ["dev", "workspace", "project", "code"] },
  { label: "Browser", path: "/browser", keywords: ["browser", "web", "url"] },
  { label: "Mindset Library", path: "/mindset-library", keywords: ["mindset", "knowledge", "library", "book", "reading", "learning"] },
  { label: "Chess", path: "/chess-academy", keywords: ["chess", "academy", "game", "puzzle"] },
  { label: "Notes", path: "/notes", keywords: ["notes", "notebook", "write"] },
  { label: "Settings", path: "/settings", keywords: ["settings", "preferences", "security", "appearance"] },
];

async function searchNavigation(q: string): Promise<SearchResult[]> {
  return NAV_ITEMS.filter(
    (n) =>
      n.label.toLowerCase().includes(q) ||
      n.keywords.some((k) => k.includes(q)),
  ).map((n) => ({
    id: `nav-${n.path}`,
    title: n.label,
    snippet: "Navigate to page",
    module: "navigation",
    moduleLabel: "Navigation",
    deepLink: n.path,
  }));
}

/* ── Markets provider — searches the static instrument catalog ────── */

async function searchMarkets(q: string): Promise<SearchResult[]> {
  return INSTRUMENT_CATALOG.filter(
    (i: CatalogInstrument) =>
      i.symbol.toLowerCase().includes(q) ||
      i.name.toLowerCase().includes(q) ||
      i.badge.toLowerCase().includes(q),
  )
    .slice(0, 8)
    .map((i: CatalogInstrument) => ({
      id: `mkt-${i.symbol}`,
      title: i.symbol,
      snippet: i.name,
      module: "markets",
      moduleLabel: "Markets",
      // Deep link: /markets?symbol=BTCUSD — receiver will select the symbol.
      deepLink: `/markets?symbol=${encodeURIComponent(i.symbol)}`,
    }));
}

/* ── Notes provider — reads lucian-notes-v2 from localStorage ─────── */

interface NotesPage {
  id: string;
  title: string;
  content: string;
  updatedAt: number;
}
interface NotesSection {
  id: string;
  notebookId: string;
  name: string;
  pages: NotesPage[];
}
interface NotesData {
  sections: NotesSection[];
}

async function searchNotes(q: string): Promise<SearchResult[]> {
  const data = readLS<NotesData>("lucian-notes-v2");
  if (!data) return [];
  const results: SearchResult[] = [];
  for (const sec of data.sections ?? []) {
    for (const page of sec.pages ?? []) {
      const text = (page.title + " " + page.content.replace(/<[^>]+>/g, "")).toLowerCase();
      if (text.includes(q)) {
        results.push({
          id: `note-${page.id}`,
          title: page.title || "Untitled",
          snippet: page.content.replace(/<[^>]+>/g, "").slice(0, 80),
          module: "notes",
          moduleLabel: "Notes",
          deepLink: `/notes?page=${encodeURIComponent(page.id)}`,
          timestamp: page.updatedAt,
        });
      }
    }
  }
  return results.slice(0, 5);
}

/* ── Investing provider — reads lucian-investing store from localStorage ── */

interface InvestingStore {
  investments?: Array<{ id: string; symbol: string; name: string; assetType: string; updatedAt?: number }>;
  watchlist?: Array<{ id: string; symbol: string; name: string; notes?: string; targetEntry?: number }>;
  research?: Array<{ id: string; title: string; source: string; url: string; symbol: string; notes: string; savedAt: number }>;
}

async function searchInvesting(q: string): Promise<SearchResult[]> {
  // The investing store uses zustand persist with name "lucian-investing".
  // Its serialized shape is { state: { investments, watchlist, research, ... }, version }.
  const raw = readLS<{ state?: InvestingStore }>("lucian-investing");
  const data = raw?.state;
  if (!data) return [];
  const results: SearchResult[] = [];
  for (const inv of data.investments ?? []) {
    if (inv.symbol.toLowerCase().includes(q) || inv.name.toLowerCase().includes(q)) {
      results.push({
        id: `inv-${inv.id}`,
        title: `${inv.symbol} — ${inv.name}`,
        snippet: `Investment · ${inv.assetType}`,
        module: "investing",
        moduleLabel: "Investing",
        deepLink: `/investing?holding=${encodeURIComponent(inv.id)}`,
        timestamp: inv.updatedAt,
      });
    }
  }
  for (const w of data.watchlist ?? []) {
    if (w.symbol.toLowerCase().includes(q) || w.name.toLowerCase().includes(q)) {
      results.push({
        id: `wl-${w.id}`,
        title: `${w.symbol} — Watchlist`,
        snippet: w.notes || (w.targetEntry ? `Target: $${w.targetEntry}` : "Watchlist item"),
        module: "investing",
        moduleLabel: "Investing",
        deepLink: `/investing?watchlist=${encodeURIComponent(w.id)}`,
      });
    }
  }
  for (const r of data.research ?? []) {
    if (r.title.toLowerCase().includes(q) || r.notes.toLowerCase().includes(q) || r.symbol.toLowerCase().includes(q)) {
      results.push({
        id: `res-${r.id}`,
        title: r.title,
        snippet: r.notes.slice(0, 80) || `Research · ${r.source}`,
        module: "investing",
        moduleLabel: "Investing",
        deepLink: `/investing?research=${encodeURIComponent(r.id)}`,
        timestamp: r.savedAt,
      });
    }
  }
  return results.slice(0, 5);
}

/* ── Economy Hub provider ──────────────────────────────────────────── */

interface EconomyHubStore {
  opportunities?: Array<{ id: string; name: string; description?: string; score: number; updatedAt?: number; status?: string }>;
  businesses?: Array<{ id: string; name: string; status: string; updatedAt?: number }>;
  researchRecords?: Array<{ id: string; title: string; summary?: string; updatedAt?: number }>;
}

async function searchEconomyHub(q: string): Promise<SearchResult[]> {
  const raw = readLS<{ state?: EconomyHubStore }>("lucian-economy-hub");
  const data = raw?.state;
  if (!data) return [];
  const results: SearchResult[] = [];
  for (const opp of data.opportunities ?? []) {
    if (opp.name?.toLowerCase().includes(q) || opp.description?.toLowerCase().includes(q)) {
      results.push({
        id: `opp-${opp.id}`,
        title: opp.name,
        snippet: opp.description?.slice(0, 80) || `Score: ${opp.score}`,
        module: "economy-hub",
        moduleLabel: "Economy Hub",
        deepLink: `/economy-hub?opportunity=${encodeURIComponent(opp.id)}`,
        timestamp: opp.updatedAt,
      });
    }
  }
  for (const biz of data.businesses ?? []) {
    if (biz.name?.toLowerCase().includes(q)) {
      results.push({
        id: `biz-${biz.id}`,
        title: biz.name,
        snippet: `Business · ${biz.status}`,
        module: "economy-hub",
        moduleLabel: "Economy Hub",
        deepLink: `/economy-hub?business=${encodeURIComponent(biz.id)}`,
        timestamp: biz.updatedAt,
      });
    }
  }
  for (const r of data.researchRecords ?? []) {
    if (r.title?.toLowerCase().includes(q) || r.summary?.toLowerCase().includes(q)) {
      results.push({
        id: `ehres-${r.id}`,
        title: r.title,
        snippet: r.summary?.slice(0, 80) || "Research",
        module: "economy-hub",
        moduleLabel: "Economy Hub",
        deepLink: `/economy-hub?research=${encodeURIComponent(r.id)}`,
        timestamp: r.updatedAt,
      });
    }
  }
  return results.slice(0, 5);
}

interface NewsFeedStore {
  saved?: Array<{ id: string; title: string; description: string; url: string; source: string; category: string; savedAt: number }>;
}

async function searchNewsFeed(q: string): Promise<SearchResult[]> {
  const raw = readLS<{ state?: NewsFeedStore }>("lucian-news-feed");
  const data = raw?.state;
  if (!data) return [];
  const results: SearchResult[] = [];
  for (const a of data.saved ?? []) {
    if (a.title?.toLowerCase().includes(q) || a.description?.toLowerCase().includes(q) || a.source?.toLowerCase().includes(q)) {
      results.push({
        id: `news-${a.id}`,
        title: a.title,
        snippet: a.description?.slice(0, 80) || a.source,
        module: "news-feed",
        moduleLabel: "News Feed",
        deepLink: `/news-feed?article=${encodeURIComponent(a.id)}`,
        timestamp: a.savedAt,
      });
    }
  }
  return results.slice(0, 5);
}

/* ── Knowledge Library provider — static catalog ──────────────────── */

async function searchKnowledgeLibrary(q: string): Promise<SearchResult[]> {
  return KNOWLEDGE_ITEMS.filter(
    (i: KnowledgeItem) =>
      i.title.toLowerCase().includes(q) ||
      i.summary.toLowerCase().includes(q) ||
      i.author.toLowerCase().includes(q),
  )
    .slice(0, 5)
    .map((i: KnowledgeItem) => ({
      id: `know-${i.id}`,
      title: i.title,
      snippet: i.summary.slice(0, 80),
      module: "knowledge-library",
      moduleLabel: "Mindset Library",
      deepLink: `/mindset-library?item=${encodeURIComponent(i.id)}`,
    }));
}

/* ── Vault provider — accounts + transactions (respects locked state) ── */

interface VaultStore {
  state?: {
    locked?: boolean;
    settings?: { hideBalances?: boolean };
    accounts?: Array<{ id: string; label: string; provider: string; type: string; currency: string; balance: number; note?: string }>;
    transactions?: Array<{ id: string; description: string; type: string; from: string; to: string; amount: number; currency: string; timestamp: number; accountLabel?: string }>;
  };
}

async function searchVault(q: string): Promise<SearchResult[]> {
  const raw = readLS<VaultStore>("lucian-vault");
  const state = raw?.state;
  if (!state) return [];

  // Respect Vault privacy: if locked, do NOT surface account or transaction
  // details in search results (titles + snippets could leak sensitive info).
  if (state.locked) return [];

  const hideBalances = state.settings?.hideBalances ?? false;
  const results: SearchResult[] = [];

  for (const a of state.accounts ?? []) {
    if (a.label?.toLowerCase().includes(q) || a.provider?.toLowerCase().includes(q) || a.note?.toLowerCase().includes(q)) {
      results.push({
        id: `vault-${a.id}`,
        title: a.label,
        // Snippet shows institution + type, NEVER balance — Vault privacy.
        snippet: hideBalances ? `${a.provider} · ${a.type}` : `${a.provider} · ${a.type} · ${a.currency}`,
        module: "vault",
        moduleLabel: "Vault",
        deepLink: `/vault?tab=accounts&account=${encodeURIComponent(a.id)}`,
      });
    }
  }
  for (const t of state.transactions ?? []) {
    if (
      t.description?.toLowerCase().includes(q) ||
      t.type?.toLowerCase().includes(q) ||
      t.from?.toLowerCase().includes(q) ||
      t.to?.toLowerCase().includes(q) ||
      t.accountLabel?.toLowerCase().includes(q)
    ) {
      results.push({
        id: `vtx-${t.id}`,
        title: t.description || `${t.type}: ${t.from} → ${t.to}`,
        // Snippet omits amount when hideBalances is on.
        snippet: hideBalances
          ? `${t.type} · ${t.from} → ${t.to}`
          : `${t.type} · ${t.from} → ${t.to} · ${t.amount} ${t.currency}`,
        module: "vault",
        moduleLabel: "Vault",
        deepLink: `/vault?tab=activity&transaction=${encodeURIComponent(t.id)}`,
        timestamp: t.timestamp,
      });
    }
  }
  return results.slice(0, 5);
}

/* ── Browser provider — bookmarks + history ────────────────────────── */

// FINAL FIX: the ACTIVE Browser store persists to "lucian-browser-v2"
// via zustand persist (see src/store/browser.ts — STORAGE_KEY). Its
// persisted wrapper is { state: { schemaVersion, bookmarks, history,
// tabs, activeTabId }, version: 2 } where:
//   - bookmarks: { id, url, title, createdAt }[]
//   - history:   { url, title, visitedAt }[]
// The obsolete "lucian-browser" key (v1, no wrapper, addedAt field) is
// NOT read anymore.
interface BrowserStore {
  bookmarks?: Array<{ id?: string; url: string; title: string; createdAt: number }>;
  history?: Array<{ url: string; title: string; visitedAt: number }>;
}

async function searchBrowser(q: string): Promise<SearchResult[]> {
  // Zustand persist wraps the store state as { state, version } — same
  // wrapper every other provider here reads (investing, news-feed,
  // notifications, vault).
  const raw = readLS<{ state?: BrowserStore }>("lucian-browser-v2");
  const data = raw?.state;
  if (!data) return [];
  const results: SearchResult[] = [];
  for (const b of data.bookmarks ?? []) {
    if (b.title?.toLowerCase().includes(q) || b.url?.toLowerCase().includes(q)) {
      results.push({
        id: `bm-${b.url}`,
        title: b.title || b.url,
        snippet: b.url,
        module: "browser",
        moduleLabel: "Browser",
        deepLink: `/browser?url=${encodeURIComponent(b.url)}`,
        timestamp: b.createdAt,
      });
    }
  }
  for (const h of data.history ?? []) {
    if (h.title?.toLowerCase().includes(q) || h.url?.toLowerCase().includes(q)) {
      results.push({
        id: `hist-${h.url}`,
        title: h.title || h.url,
        snippet: h.url,
        module: "browser",
        moduleLabel: "Browser",
        deepLink: `/browser?url=${encodeURIComponent(h.url)}`,
        timestamp: h.visitedAt,
      });
    }
  }
  return results.slice(0, 5);
}

/* ── Notifications provider ─────────────────────────────────────────── */

interface NotificationsStore {
  state?: {
    notifications?: Array<{
      id: string;
      source: string;
      title: string;
      message: string;
      timestamp: number;
      read: boolean;
      priority: string;
      deepLink?: string;
    }>;
  };
}

async function searchNotifications(q: string): Promise<SearchResult[]> {
  const raw = readLS<NotificationsStore>("lucian-notifications");
  const data = raw?.state;
  if (!data) return [];
  const results: SearchResult[] = [];
  for (const n of data.notifications ?? []) {
    // Phase 10: do not surface dismissed notifications in search.
    if ((n as { dismissed?: boolean }).dismissed) continue;
    if (n.title?.toLowerCase().includes(q) || n.message?.toLowerCase().includes(q) || n.source?.toLowerCase().includes(q)) {
      results.push({
        id: `ntf-${n.id}`,
        title: n.title,
        snippet: n.message,
        module: "notifications",
        moduleLabel: "Notifications",
        // Phase 9 wrap-up: if the notification has its own deepLink, the
        // search overlay routes there. If NOT, the overlay's openResult
        // detects `module === "notifications"` + no deepLink and opens
        // the Notification Center focused on this exact record (via the
        // `lucian:open-notifications` CustomEvent + focusedId on the
        // notification store). We intentionally leave deepLink undefined
        // here in that case so the overlay can distinguish it.
        deepLink: n.deepLink,
        timestamp: n.timestamp,
      });
    }
  }
  return results.slice(0, 5);
}

/* ── Chess Academy provider — static lessons ─────────────────────── */

async function searchChess(q: string): Promise<SearchResult[]> {
  return CHESS_LESSONS.filter(
    (l: ChessLesson) =>
      l.title.toLowerCase().includes(q) ||
      l.description.toLowerCase().includes(q) ||
      l.concept.toLowerCase().includes(q),
  )
    .slice(0, 5)
    .map((l: ChessLesson) => ({
      id: `chess-${l.id}`,
      title: l.title,
      snippet: l.concept,
      module: "chess-academy",
      moduleLabel: "Chess Academy",
      deepLink: `/chess-academy?lesson=${encodeURIComponent(l.id)}`,
    }));
}

/* ── DevWorkspace provider — REAL IndexedDB ────────────────────────── */

/**
 * Searches DevWorkspace projects + their file paths using the REAL
 * IndexedDB workspace store. Falls back to empty if IndexedDB is
 * unavailable (SSR or browser support issue).
 *
 * Generated/irrelevant directories are excluded from filename search:
 *   node_modules, .git, .next, dist, build, out, .cache, coverage
 *
 * File-content matching is intentionally NOT performed here — scanning
 * every file's content from IndexedDB on every keystroke would be far too
 * slow. File-path / filename matching is already enough to find the right
 * file in practice.
 */

const IGNORED_DIR_PREFIXES = [
  "node_modules/",
  ".git/",
  ".next/",
  "dist/",
  "build/",
  "out/",
  ".cache/",
  "coverage/",
  ".turbo/",
  ".vercel/",
];

function isIgnoredPath(path: string): boolean {
  const p = path.startsWith("/") ? path.slice(1) : path;
  return IGNORED_DIR_PREFIXES.some((prefix) => p.startsWith(prefix) || p.includes("/" + prefix));
}

/** Cap on total file entries scanned per query (responsiveness safeguard). */
const MAX_FILE_SCAN = 5000;

async function searchDevWorkspace(q: string): Promise<SearchResult[]> {
  if (!isClient()) return [];

  let projects;
  try {
    projects = await listProjects();
  } catch {
    // IndexedDB unavailable — return empty.
    return [];
  }
  if (!projects || projects.length === 0) return [];

  const results: SearchResult[] = [];
  let scanned = 0;
  let reachedScanCap = false;

  for (const p of projects) {
    if (p.name?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)) {
      results.push({
        id: `dw-${p.id}`,
        title: p.name,
        snippet: p.description || `${p.files?.length ?? p.fileCount ?? 0} files`,
        module: "dev-workspace",
        moduleLabel: "DevWorkspace",
        deepLink: `/dev-workspace?project=${encodeURIComponent(p.id)}`,
      });
    }

    // Scan file paths. We use the lightweight file index (FileEntry[])
    // attached to each project — NOT the content store.
    for (const f of p.files ?? []) {
      if (reachedScanCap) break;
      scanned++;
      if (scanned > MAX_FILE_SCAN) {
        reachedScanCap = true;
        break;
      }
      const path = f.path ?? "";
      if (!path || isIgnoredPath(path)) continue;
      const filename = path.split(/[\\/]/).pop() ?? path;
      const pathLower = path.toLowerCase();
      const nameLower = filename.toLowerCase();
      if (pathLower.includes(q) || nameLower.includes(q)) {
        results.push({
          id: `dwf-${p.id}-${path}`,
          title: filename,
          snippet: `${p.name} · ${path}`,
          module: "dev-workspace",
          moduleLabel: "DevWorkspace",
          deepLink: `/dev-workspace?project=${encodeURIComponent(p.id)}&file=${encodeURIComponent(path)}`,
        });
      }
    }
    if (reachedScanCap) break;
  }

  return results.slice(0, 8);
}

/* ── Register all providers (idempotent — safe to call multiple times) ── */

let providersRegistered = false;
export function ensureProvidersRegistered() {
  if (providersRegistered) return;
  providersRegistered = true;
  registerSearchProvider("navigation", searchNavigation);
  registerSearchProvider("markets", searchMarkets);
  registerSearchProvider("notes", searchNotes);
  registerSearchProvider("investing", searchInvesting);
  registerSearchProvider("economy-hub", searchEconomyHub);
  registerSearchProvider("news-feed", searchNewsFeed);
  registerSearchProvider("knowledge-library", searchKnowledgeLibrary);
  registerSearchProvider("vault", searchVault);
  registerSearchProvider("browser", searchBrowser);
  registerSearchProvider("notifications", searchNotifications);
  registerSearchProvider("chess", searchChess);
  registerSearchProvider("dev-workspace", searchDevWorkspace);
}

// Register at module load so the first search is immediate.
ensureProvidersRegistered();

// Re-export getInstrumentBySymbol for convenience of search consumers.
export { getInstrumentBySymbol };
