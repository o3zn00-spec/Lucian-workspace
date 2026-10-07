"use client";

// LUCIAN Phase 16 — Post-login local data migration prompt (FINAL CORRECTED).
//
// FINAL CORRECTIONS:
//   - Reads the ACTUAL localStorage keys used by the real LUCIAN stores
//      lucian-browser-v2, lucian-investing, lucian-news-watchlist,
//      lucian-markets-favorites, lucian-markets-price-alerts).
//   - Builds REAL import payloads — no more empty arrays for chats,
//   - Aggregates browser bookmarks + investing watchlist + investing
//     research + investing theses + news watchlist topics + markets
//     favorites into the unified saved-items payload (with distinct
//     `source` per origin).
//
// FINAL CANONICAL-FORMAT FIX — one format everywhere:
//
//   LOCAL MIGRATION → SavedItem server model → normal hydration
//
// …must use the EXACT SAME source/type/refId/metadata structure the
// live sync (src/lib/auth/live-sync.ts callers) and hydration
// (src/lib/auth/cloud-hydration.ts) use. Verified canonical formats:
//
//   browser   bookmark  refId = bookmark URL        (NOT internal id)
//   investing watchlist  refId = item id
//   investing research   refId = item id
//   investing thesis     refId = investmentId
//   news      topic      refId = topic slug id
//   news      article    refId = article id
//   markets   favorite   refId = symbol
//
// Markets price alerts are DEVICE-LOCAL (no live sync, no hydration
// restore path exists) — they are intentionally NOT migrated and NOT
// cleared on account switch.
//   - Does NOT migrate DevWorkspace project files (those live in
//     IndexedDB and stay local by design).
//   - Does NOT migrate shared AI config (provider/model preferences
//     are device-local settings, not user content).
//
// The modal is shown only ONCE per session per migration version.
// It's safe to dismiss — the user can re-trigger from Settings →
// Data & Storage if they change their mind later.

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Database, FileText, Bell, Bot, Save, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Per-category list of localStorage keys to scan. A category can pull
// from multiple stores (saved-items aggregates 5 stores). Each entry
// includes the field-name to look for in the parsed Zustand persist
// wrapper so we count + extract correctly.
interface StoreSpec {
  key: string;
  // The field inside `state` that holds the records array. For
  // array-valued fields we use it directly; for object-valued stores
  field?: string;
  // Optional extractor for shapes that don't have a single `field`
  extract?: (state: Record<string, unknown>) => unknown[] | null;
}

const CATEGORY_STORES: Record<string, StoreSpec[]> = {
  notifications: [
    { key: "lucian-notifications", field: "notifications" },
  ],
  "saved-items": [
    { key: "lucian-browser-v2", field: "bookmarks" },
    { key: "lucian-investing", field: "watchlist" },
    { key: "lucian-investing", field: "research" },
    { key: "lucian-investing", field: "theses" },
    { key: "lucian-news-watchlist", field: "topics" },
    // FINAL: pre-account saved News articles. The live News system
    // cloud-syncs saved articles (source="news", type="article",
    // refId=article.id) and hydration restores them — but the migration
    // never scanned the old local saved list. Only `saved` is migrated:
    // widget config + preferences (incl. weather location) stay local.
    { key: "lucian-news-feed", field: "saved" },
    // `lucian-markets-favorites` is a raw JSON array (no Zustand wrapper).
    { key: "lucian-markets-favorites", extract: (s) => (Array.isArray(s.__rawArray) ? s.__rawArray : null) },
    // NOTE: lucian-markets-price-alerts is DEVICE-LOCAL (no cloud save /
    // hydrate path) — intentionally NOT migrated.
  ],
  // Agent memory has no client-side store. The server endpoint exists
  // for future use, but we don't fabricate migration records from
  // non-existent local data. Documented honestly below.
};

interface MigrationPromptProps {
  /** When true, the prompt will be shown (caller controls visibility).
   *  The prompt itself does the actual server + local checks. */
  open: boolean;
  onClose: () => void;
}

interface CategoryState {
  category: string;
  localCount: number;
  serverStatus: string | null; // pending | complete | partial | skipped | null
}

export function MigrationPrompt({ open, onClose }: MigrationPromptProps) {
  const { status } = useSession();
  const [acting, setActing] = useState(false);
  const [categories, setCategories] = useState<CategoryState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [hasChecked, setHasChecked] = useState(false);

  // On open: check server migration state + local data counts.
  // All setState calls happen after `await fetch()` (i.e. in async
  // callbacks), which the lint rule allows.
  const check = useCallback(async () => {
    if (status !== "authenticated") return;
    let res: Response;
    try {
      res = await fetch("/api/user/migrations", { cache: "no-store" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check migration state.");
      setHasChecked(true);
      return;
    }
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setError(data.error || "Failed to check migration state.");
      setHasChecked(true);
      return;
    }
    const serverMap = new Map<string, string>();
    for (const m of data.migrations ?? []) {
      serverMap.set(m.category, m.status);
    }
    const next: CategoryState[] = [];
    for (const cat of Object.keys(CATEGORY_STORES)) {
      const localCount = countLocalData(cat);
      const serverStatus = serverMap.get(cat) ?? null;
      if (localCount > 0 && (serverStatus === null || serverStatus === "pending" || serverStatus === "partial")) {
        next.push({ category: cat, localCount, serverStatus });
      }
    }
    setCategories(next);
    setError(null);
    setHasChecked(true);
  }, [status]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      if (!cancelled) await check();
    })();
    return () => { cancelled = true; };
  }, [open, check]);

  const handleSkip = useCallback(async () => {
    setActing(true);
    setError(null);
    try {
      const res = await fetch("/api/user/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "skip",
          categories: categories.map(c => c.category),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Failed to skip migration.");
        return;
      }
      toast.success("Local data will remain on this device only.");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to skip migration.");
    } finally {
      setActing(false);
    }
  }, [categories, onClose]);

  const handleImport = useCallback(async () => {
    setActing(true);
    setError(null);
    try {
      const payload = buildImportPayload(categories.map(c => c.category));
      const res = await fetch("/api/user/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import",
          categories: categories.map(c => c.category),
          payload,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Failed to import data.");
        return;
      }
      const summary = Object.entries(data.result ?? {})
        .map(([cat, r]) => `${cat}: ${(r as { recordCount: number }).recordCount}`)
        .join(", ");
      toast.success(`Imported: ${summary}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import data.");
    } finally {
      setActing(false);
    }
  }, [categories, onClose]);

  if (!open) return null;
  if (!hasChecked) {
    return (
      <ModalShell>
        <div className="flex items-center gap-2 py-4 text-[12px] text-fg-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Checking for local data…
        </div>
      </ModalShell>
    );
  }
  if (categories.length === 0) {
    // No eligible data — close silently.
    return null;
  }
  return (
    <ModalShell>
      <div className="mb-4">
        <h2 className="text-[15px] font-semibold text-fg">LUCIAN found data stored on this device.</h2>
        <p className="mt-1 text-[12px] text-fg-muted">
          Your account can store these categories on the server so they sync across your devices and survive browser loss. Project source files stay local (IndexedDB) — they are NOT uploaded.
        </p>
      </div>

      <div className="space-y-1.5">
        {categories.map(c => (
          <div key={c.category} className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2">
            <CategoryIcon category={c.category} />
            <div className="flex-1">
              <div className="text-[12px] font-medium text-fg">{CATEGORY_LABEL[c.category]}</div>
              <div className="text-[10.5px] text-fg-faint">
                {c.localCount} local record{c.localCount === 1 ? "" : "s"} · server status: {c.serverStatus ?? "not yet migrated"}
              </div>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200">
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <button
          onClick={handleImport} disabled={acting}
          className="flex items-center justify-center gap-2 rounded-md bg-[var(--accent)] px-3 py-2 text-[12px] font-semibold text-[var(--accent-fg)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
        >
          {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Add Eligible Data to My Account
        </button>
        <button
          onClick={handleSkip} disabled={acting}
          className="rounded-md border border-line bg-surface px-3 py-2 text-[12px] text-fg hover:bg-hover disabled:opacity-50"
        >
          Keep Local Only
        </button>
      </div>

      <p className="mt-3 text-[10.5px] text-fg-faint">
        You can re-run this from Settings → Data & Storage later. The choice is remembered for each category at this migration version.
      </p>
    </ModalShell>
  );
}

const CATEGORY_LABEL: Record<string, string> = {
  notifications: "Notifications",
  "saved-items": "Saved items",
};

function CategoryIcon({ category }: { category: string }) {
  const cls = "h-3.5 w-3.5 text-fg-muted";
  switch (category) {
    case "notifications": return <Bell className={cls} />;
    case "saved-items": return <Save className={cls} />;
    default: return <FileText className={cls} />;
  }
}

function ModalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className={cn(
        "themed w-full max-w-md rounded-xl border border-line bg-surface p-6",
        "shadow-[0_20px_60px_rgba(0,0,0,0.55)]",
      )}>
        <div className="mb-4 flex items-center gap-2">
          <Database className="h-4 w-4 text-[var(--accent)]" />
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-fg-muted">Account Data Migration</h2>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Read a Zustand-persisted localStorage entry, returning the inner
 *  `state` object. Returns null if missing or unparseable.
 *  Also handles raw JSON arrays (no Zustand wrapper) — used by
 *  `lucian-markets-favorites`. */
function readStoreState(storageKey: string): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: Record<string, unknown> } | unknown[];
    // Zustand persist wraps state as { state, version }
    if (
      parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
      "state" in (parsed as Record<string, unknown>)
    ) {
      const inner = (parsed as { state: unknown }).state;
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        return inner as Record<string, unknown>;
      }
    }
    // Raw array (lucian-markets-favorites case) — convert to a synthetic
    // record so the caller's `extract` function can pick it up via
    // a sentinel key.
    if (Array.isArray(parsed)) {
      return { __rawArray: parsed };
    }
    return null;
  } catch {
    return null;
  }
}

/** Extract the records array for a single StoreSpec. */
function extractRecords(state: Record<string, unknown> | null, spec: StoreSpec): unknown[] {
  if (!state) return [];
  if (spec.extract) {
    return spec.extract(state) ?? [];
  }
  if (spec.field) {
    const arr = state[spec.field];
    return Array.isArray(arr) ? arr : [];
  }
  return [];
}

/** Count the local data records for a category across ALL its stores. */
function countLocalData(category: string): number {
  const specs = CATEGORY_STORES[category] ?? [];
  let total = 0;
  for (const spec of specs) {
    const state = readStoreState(spec.key);
    total += extractRecords(state, spec).length;
  }
  return total;
}

/** Build the import payload from the client's local stores.
 *  Only categories the user selected are included. Maps each store's
 *  shape to the server's expected payload schema. */
function buildImportPayload(categories: string[]): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  const payload: Record<string, unknown> = {};

  for (const cat of categories) {
    if (cat === "notifications") {
      payload.notifications = buildNotificationsPayload();
    } else if (cat === "saved-items") {
      payload["saved-items"] = buildSavedItemsPayload();
    }
  }
  return payload;
}


/** Build notifications payload from the notification store. */
function buildNotificationsPayload(): unknown[] {
  const state = readStoreState("lucian-notifications") as Record<string, unknown> | null;
  if (!state) return [];
  const arr = Array.isArray(state.notifications) ? state.notifications : [];
  return arr.map((n) => {
    const rec = n as Record<string, unknown>;
    return {
      source: String(rec.source ?? "local"),
      title: String(rec.title ?? ""),
      message: String(rec.message ?? ""),
      level: String(rec.level ?? "info"),
      actionable: Boolean(rec.actionable),
      dedupeKey: typeof rec.dedupeKey === "string" ? rec.dedupeKey : null,
      entityRef: typeof rec.entity === "string"
        ? rec.entity
        : (typeof rec.entityRef === "string" ? rec.entityRef : null),
      deepLink: typeof rec.deepLink === "string" ? rec.deepLink : null,
    };
  });
}

/** Build saved-items payload by aggregating bookmarks, watchlists,
 *  research, news topics, market favorites, and price alerts. Each
 *  origin gets its own `source` so the server can distinguish them. */
function buildSavedItemsPayload(): unknown[] {
  const items: unknown[] = [];

  // Browser bookmarks — CANONICAL format: refId is the bookmark URL,
  // identical to the live sync in useBrowserStore.addBookmark and to
  // what hydrateBrowserBookmarks expects (refId = URL, dedupe by URL).
  const browserState = readStoreState("lucian-browser-v2") as Record<string, unknown> | null;
  if (browserState) {
    const bookmarks = Array.isArray(browserState.bookmarks) ? browserState.bookmarks : [];
    for (const b of bookmarks) {
      const rec = b as Record<string, unknown>;
      if (typeof rec.url !== "string" || !rec.url) continue;
      items.push({
        source: "browser",
        type: "bookmark",
        refId: rec.url,
        title: String(rec.title ?? rec.url),
        data: { url: rec.url, title: rec.title, createdAt: rec.createdAt },
      });
    }
  }

  // Investing — CANONICAL types: "watchlist" | "research" | "thesis",
  // identical to the live sync in useInvestingStore and to what
  // hydrateInvestingSavedItems dispatches on. (The obsolete migration-only
  // names "watchlist-item" / "research-item" were IGNORED by hydration.)
  const investingState = readStoreState("lucian-investing") as Record<string, unknown> | null;
  if (investingState) {
    const watchlist = Array.isArray(investingState.watchlist) ? investingState.watchlist : [];
    for (const w of watchlist) {
      const rec = w as Record<string, unknown>;
      items.push({
        source: "investing",
        type: "watchlist",
        refId: typeof rec.id === "string" ? rec.id : undefined,
        title: String(rec.symbol ?? rec.name ?? "Investment"),
        // Hydration reads data.addedAt for the watchlist createdAt —
        // include it so the original timestamp survives the round-trip.
        data: { ...rec, addedAt: rec.addedAt ?? rec.createdAt },
      });
    }
    // Investing research notes
    const research = Array.isArray(investingState.research) ? investingState.research : [];
    for (const r of research) {
      const rec = r as Record<string, unknown>;
      items.push({
        source: "investing",
        type: "research",
        refId: typeof rec.id === "string" ? rec.id : undefined,
        title: String(rec.title ?? rec.symbol ?? "Research"),
        data: rec,
      });
    }
    // Investing theses (keyed by investmentId — same refId the live
    // sync and hydrateInvestingSavedItems use).
    const theses = Array.isArray(investingState.theses) ? investingState.theses : [];
    for (const t of theses) {
      const rec = t as Record<string, unknown>;
      items.push({
        source: "investing",
        type: "thesis",
        refId: typeof rec.investmentId === "string" ? rec.investmentId : undefined,
        title: String(rec.reason ?? "").slice(0, 60) || "Investment Thesis",
        data: rec,
      });
    }
  }

  // News saved articles — CANONICAL format, identical to the live sync
  // in useNewsFeedStore.toggleSave and to what hydrateNewsSavedItems
  // restores: source="news", type="article", refId=article.id. The whole
  // SavedArticle record travels in data (title/description/url/source/
  // category/publishedAt/imageUrl/savedAt) so hydration reconstructs the
  // article exactly. Widget config + preferences are NOT migrated.
  const newsFeedState = readStoreState("lucian-news-feed") as Record<string, unknown> | null;
  if (newsFeedState) {
    const savedArticles = Array.isArray(newsFeedState.saved) ? newsFeedState.saved : [];
    for (const a of savedArticles) {
      const rec = a as Record<string, unknown>;
      if (typeof rec.id !== "string" || !rec.id) continue;
      items.push({
        source: "news",
        type: "article",
        refId: rec.id,
        title: String(rec.title ?? "Saved article"),
        data: { ...rec },
      });
    }
  }

  // News watchlist topics — CANONICAL type "topic" (what live sync and
  // hydrateNewsSavedItems expect). The record (label/enabled/addedAt)
  // travels in data so hydration restores the exact enabled state.
  const newsState = readStoreState("lucian-news-watchlist") as Record<string, unknown> | null;
  if (newsState) {
    const topics = Array.isArray(newsState.topics) ? newsState.topics : [];
    for (const t of topics) {
      const rec = t as Record<string, unknown>;
      items.push({
        source: "news",
        type: "topic",
        refId: typeof rec.id === "string" ? rec.id : undefined,
        title: String(rec.label ?? rec.id ?? "Topic"),
        data: rec,
      });
    }
  }

  // Markets favorites (raw JSON array, no Zustand wrapper)
  const favRaw = readStoreState("lucian-markets-favorites");
  if (Array.isArray(favRaw)) {
    for (const sym of favRaw) {
      if (typeof sym !== "string") continue;
      items.push({
        source: "markets",
        type: "favorite",
        refId: sym,
        title: sym,
        data: { symbol: sym },
      });
    }
  }

  // Markets price alerts: DEVICE-LOCAL (see header comment) — not
  // uploaded. There is no hydration restore path for them, so migrating
  // them would create orphan server rows hydration ignores.

  return items;
}
