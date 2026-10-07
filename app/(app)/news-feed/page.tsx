"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Search,
  Bookmark,
  BookmarkCheck,
  ExternalLink,
  Play,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  MoreHorizontal,
  Sun,
  Cloud,
  CloudRain,
  CloudSun,
  MapPin,
  TrendingUp,
  TrendingDown,
  Gamepad2,
  Newspaper,
  Eye,
  Clock,
  Bot,
} from "lucide-react";
import { useNewsFeedStore, type SavedArticle, type WidgetId, ALL_WIDGET_OPTIONS } from "@/store/news-feed";
import { useNewsWatchlistStore } from "@/store/news-watchlist";
import { useNewsWeatherStore } from "@/store/news-weather";
import {
  subscribeNewsMarkets,
  readNewsMarketSnapshot,
  useMarketsStore,
} from "@/store/markets";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";



/* ── Types ── */

interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: number;
  type: string;
  categories: string[];
  symbols: string[];
  /** Phase 13: optional real article image URL (validated server-side). */
  imageUrl?: string;
}

interface NewsVideo {
  id: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  videoUrl: string;
  source: string;
  articleUrl?: string;
  publishedAt?: number;
  duration?: number;
  kind: "direct" | "embed";
  isLive?: boolean;
}

interface Trend {
  label: string;
  key: string;
  score: number;
  articleCount: number;
  sourceCount: number;
  lastSeenAt: number;
}

interface WeatherData {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  daily: {
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weather_code: number[];
  }[];
}

interface SportsEvent {
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: string;
  awayScore: string;
  status: string;
  time: string;
}

type Tab = "discover" | "watch" | "play";

const CATEGORIES = [
  "for-you", "top-stories", "world", "nigeria", "business",
  "markets", "technology", "science", "entertainment", "sports", "crypto",
];

const CATEGORY_LABELS: Record<string, string> = {
  "for-you": "For You",
  "top-stories": "Top Stories",
  world: "World",
  nigeria: "Nigeria",
  business: "Business",
  markets: "Markets",
  technology: "Technology",
  science: "Science",
  entertainment: "Entertainment",
  sports: "Sports",
  crypto: "Crypto",
};



/* ── Page ── */

export default function NewsFeedPageWrapper() {
  return (
    <>
      {/* Phase 9: deep-link receiver for /news-feed?article=<id> */}
      <Suspense fallback={null}>
        <NewsFeedDeepLinkReceiver />
      </Suspense>
      <NewsFeedPage />
    </>
  );
}

/**
 * Phase 9: News Feed deep-link receiver.
 *
 * Reads `?article=<id>` on mount (or on URL change), validates the saved
 * article exists in the store, dispatches a CustomEvent so the inner
 * page opens the Saved dialog with that article highlighted, and strips
 * the param.
 */
function NewsFeedDeepLinkReceiver() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const consumedRef = useRef<string | null>(null);

  useEffect(() => {
    const articleId = searchParams.get("article");
    if (!articleId) return;
    if (consumedRef.current === articleId) return;
    consumedRef.current = articleId;

    // Verify the saved article exists in the store. If it was removed
    // between search and click, do NOT fabricate one.
    const exists = useNewsFeedStore.getState().saved.some((a) => a.id === articleId);
    if (exists) {
      window.dispatchEvent(new CustomEvent("lucian:news-deeplink", { detail: articleId }));
    }
    const next = new URLSearchParams(searchParams.toString());
    next.delete("article");
    const qs = next.toString();
    router.replace(qs ? `/news-feed?${qs}` : "/news-feed");
  }, [searchParams, router]);

  return null;
}

export function NewsFeedPage() {
  const [tab, setTab] = useState<Tab>("discover");
  // Phase 9: highlight state set by the deep-link receiver — opens the
  // Saved dialog and visually highlights the target article.
  const [savedOpen, setSavedOpen] = useState(false);
  const [highlightArticleId, setHighlightArticleId] = useState<string | null>(null);
  // Phase 13: topic filter set when the user clicks a Trending topic or
  // a Watchlist topic. The Discover tab filters real articles by this topic.
  const [topicFilter, setTopicFilter] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const articleId = (e as CustomEvent<string>).detail;
      if (!articleId) return;
      setHighlightArticleId(articleId);
      setSavedOpen(true);
      // Auto-clear highlight after a few seconds.
      window.setTimeout(() => setHighlightArticleId((cur) => (cur === articleId ? null : cur)), 5000);
    };
    window.addEventListener("lucian:news-deeplink", handler as EventListener);
    return () => window.removeEventListener("lucian:news-deeplink", handler as EventListener);
  }, []);

  // Phase 13: listen for topic-filter events dispatched by Trending /
  // Watchlist widgets. The handler also flips the tab to Discover so the
  // user sees the filtered results immediately.
  useEffect(() => {
    const handler = (e: Event) => {
      const topic = (e as CustomEvent<string | null>).detail;
      setTopicFilter(topic);
      setTab("discover");
    };
    window.addEventListener("lucian:news-topic-filter" as string, handler as EventListener);
    return () => window.removeEventListener("lucian:news-topic-filter" as string, handler as EventListener);
  }, []);

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric" });
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="themed flex h-full min-h-0 flex-col bg-canvas text-fg">
      {/* Header */}
      <div className="shrink-0 border-b border-line-muted px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] text-fg-faint">{dateStr}</p>
            <h1 className="text-[16px] font-semibold tracking-tight text-fg">{greeting}</h1>
          </div>
          <div className="flex items-center gap-2">
            
            <SavedButton onClick={() => setSavedOpen(true)} />
          </div>
        </div>
        {/* Tab nav */}
        <div className="mt-2 flex gap-1">
          {([
            ["discover", "Discover"],
            ["watch", "Watch"],
            ["play", "Play"],
          ] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "border-b-2 px-3 py-1.5 text-[13px] font-medium transition-colors",
                tab === id
                  ? "border-[var(--accent)] text-fg"
                  : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "discover" && <DiscoverTab topicFilter={topicFilter} onClearTopicFilter={() => setTopicFilter(null)} />}
        {tab === "watch" && <WatchTab />}
        {tab === "play" && <PlayTab />}
      </div>

      {/* Phase 9: Saved dialog lifted to page level so deep links can
          open it with a specific article highlighted. */}
      {savedOpen && (
        <SavedDialog
          onClose={() => { setSavedOpen(false); setHighlightArticleId(null); }}
          highlightId={highlightArticleId}
        />
      )}
    </div>
  );
}

/* ── Saved button ── */

function SavedButton({ onClick }: { onClick?: () => void }) {
  const saved = useNewsFeedStore((s) => s.saved);

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11px] font-medium text-fg-muted hover:text-fg"
    >
      {saved.length > 0 ? <BookmarkCheck className="h-3.5 w-3.5 text-[var(--accent)]" /> : <Bookmark className="h-3.5 w-3.5" />}
      Saved ({saved.length})
    </button>
  );
}

function SavedDialog({ onClose, highlightId }: { onClose: () => void; highlightId?: string | null }) {
  const saved = useNewsFeedStore((s) => s.saved);
  const removeSaved = useNewsFeedStore((s) => s.removeSaved);
  const highlightRef = useRef<HTMLAnchorElement | null>(null);

  // Phase 9: scroll the highlighted article into view when the dialog
  // opens via a deep link.
  useEffect(() => {
    if (highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [highlightId, saved]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="themed flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-pop" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line-muted px-4 py-3">
          <h2 className="text-[14px] font-semibold text-fg">Saved Articles</h2>
          <button type="button" aria-label="Close saved articles" onClick={onClose} className="text-fg-muted hover:text-fg"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {saved.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-fg-faint">No saved articles yet.</p>
          ) : (
            <div className="space-y-2">
              {saved.map(a => (
                <div
                  key={a.id}
                  className={cn(
                    "flex items-start gap-2 rounded-md border p-3 transition-colors",
                    a.id === highlightId
                      ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 ring-1 ring-inset ring-[var(--accent)]/30"
                      : "border-line bg-surface-2",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <a
                      ref={a.id === highlightId ? highlightRef : undefined}
                      href={a.url} target="_blank" rel="noopener noreferrer"
                      className="text-[12px] font-medium text-fg hover:text-[var(--accent)]"
                    >
                      {a.title}
                    </a>
                    <p className="mt-0.5 text-[10px] text-fg-faint">{a.source} · {new Date(a.publishedAt).toLocaleDateString()}</p>
                  </div>
                  <button type="button" aria-label={`Remove saved article: ${a.title}`} onClick={() => removeSaved(a.id)} className="text-fg-faint hover:text-red-400">
                    <BookmarkCheck className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Discover tab ── */

function DiscoverTab({ topicFilter, onClearTopicFilter }: { topicFilter: string | null; onClearTopicFilter: () => void }) {
  return (
    <div className="flex h-full min-h-0">
      {/* Widget column */}
      <WidgetColumn />

      {/* Main feed */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <FeedContent topicFilter={topicFilter} onClearTopicFilter={onClearTopicFilter} />
      </div>
    </div>
  );
}

/* ── Feed content ── */

function FeedContent({ topicFilter, onClearTopicFilter }: { topicFilter: string | null; onClearTopicFilter: () => void }) {
  const preferences = useNewsFeedStore((s) => s.preferences);
  const setCategory = useNewsFeedStore((s) => s.setCategory);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);

  const fetchNews = useCallback(async (cat: string, query?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ category: cat });
      if (query) params.set("search", query);
      const res = await fetch(`/api/news/feed?${params}`);
      const data = await res.json();
      setItems(data.items ?? []);
      if (data.error) setError(data.error);
    } catch {
      setError("Failed to load news.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Defer the initial fetch to a microtask so we don't call setState
  // synchronously inside the effect body (React 19 rule).
  useEffect(() => {
    const id = window.setTimeout(() => fetchNews(preferences.category), 0);
    return () => window.clearTimeout(id);
  }, [preferences.category, fetchNews]);

  const handleSearch = () => {
    if (search.trim()) {
      fetchNews(preferences.category, search.trim());
    }
  };

  // Phase 13: when topicFilter is set, filter the loaded items by topic
  // (case-insensitive whole-phrase match against headline + summary).
  // We do this client-side to avoid an extra round-trip — the articles
  // are already loaded. When topicFilter is null, show the full list.
  const filteredItems = useMemo(() => {
    if (!topicFilter) return items;
    const topic = topicFilter.toLowerCase();
    return items.filter(
      (i) =>
        i.headline.toLowerCase().includes(topic) ||
        i.summary.toLowerCase().includes(topic),
    );
  }, [items, topicFilter]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-4">
      {/* Search */}
      <div className="mb-3 flex items-center gap-2">
        {showSearch ? (
          <div className="flex flex-1 items-center gap-1">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint" />
              <input
                autoFocus
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                placeholder="Search news, topics, companies..."
                className="w-full rounded-md border border-line bg-surface py-1.5 pl-8 pr-2 text-[12px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            </div>
            <button type="button" aria-label="Close news search" onClick={() => { setShowSearch(false); setSearch(""); fetchNews(preferences.category); }} className="text-fg-faint hover:text-fg">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button onClick={() => setShowSearch(true)} className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11px] text-fg-muted hover:text-fg">
            <Search className="h-3.5 w-3.5" />
            Search
          </button>
        )}
        <button
          onClick={() => fetchNews(preferences.category, search.trim() || undefined)}
          className="rounded-md border border-line bg-surface p-1.5 text-fg-muted hover:text-fg"
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Categories */}
      <div className="mb-4 flex gap-1 overflow-x-auto pb-1">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={cn(
              "whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
              preferences.category === cat
                ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                : "bg-surface-2 text-fg-muted hover:text-fg",
            )}
          >
            {CATEGORY_LABELS[cat] ?? cat}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <SkeletonGrid />
      ) : error ? (
        <div className="rounded-md border border-dashed border-line-muted p-8 text-center">
          <p className="text-[12px] font-medium text-fg-muted">{error}</p>
          <button onClick={() => fetchNews(preferences.category)} className="mt-2 rounded border border-line bg-surface-2 px-3 py-1 text-[11px] text-fg-muted hover:text-fg">
            Try Again
          </button>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-md border border-dashed border-line-muted p-8 text-center">
          <p className="text-[12px] font-medium text-fg-muted">
            {topicFilter ? `No stories match “${topicFilter}”.` : "No stories found."}
          </p>
          <p className="mt-1 text-[11px] text-fg-faint">
            {topicFilter ? "Try a different topic or clear the filter." : "Try a different category or search query."}
          </p>
          {topicFilter && (
            <button
              onClick={onClearTopicFilter}
              className="mt-2 rounded border border-line bg-surface-2 px-3 py-1 text-[11px] text-fg-muted hover:text-fg"
            >
              Clear topic filter
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Phase 13: topic filter chip */}
          {topicFilter && (
            <div className="flex items-center gap-2 rounded-md border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3 py-1.5">
              <span className="text-[11px] font-medium text-fg-muted">Topic:</span>
              <span className="text-[12px] font-semibold text-[var(--accent)]">{topicFilter}</span>
              <button
                onClick={onClearTopicFilter}
                className="ml-auto rounded p-0.5 text-fg-faint hover:text-fg"
                title="Clear topic filter"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Featured (first item) */}
          <FeaturedCard item={filteredItems[0]} />

          {/* Grid of remaining items */}
          <div className="grid gap-3 sm:grid-cols-2">
            {filteredItems.slice(1).map((item, i) => (
              <NewsCard key={item.id} item={item} variant={i % 3 === 0 ? "compact" : "medium"} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Skeleton ── */

function SkeletonGrid() {
  return (
    <div className="space-y-3">
      <div className="h-[200px] animate-pulse rounded-md bg-surface-2" />
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="space-y-2">
            <div className="h-[100px] animate-pulse rounded-md bg-surface-2" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-surface-2" />
            <div className="h-2 w-1/2 animate-pulse rounded bg-surface-2" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Featured card ── */

function FeaturedCard({ item }: { item: NewsItem }) {
  const toggleSave = useNewsFeedStore((s) => s.toggleSave);
  const isSaved = useNewsFeedStore((s) => s.isSaved(item.id));

  const savedArticle: SavedArticle = {
    id: item.id,
    title: item.headline,
    description: item.summary,
    url: item.url,
    source: item.source,
    category: item.categories[0] ?? "general",
    publishedAt: item.publishedAt,
    savedAt: 0,
    imageUrl: item.imageUrl,
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      {/* Image area / fallback */}
      <div className="relative flex h-[200px] items-center justify-center bg-surface-2">
        <ArticleImage
          src={item.imageUrl}
          alt={item.headline}
          className="h-full w-full object-cover"
          fallback={<Newspaper className="h-12 w-12 text-fg-faint opacity-30" />}
        />
        {item.type === "breaking" && (
          <span className="absolute left-3 top-3 rounded bg-red-500/90 px-2 py-0.5 text-[9px] font-bold uppercase text-white">
            Breaking
          </span>
        )}
      </div>
      {/* Content */}
      <div className="p-4">
        <div className="mb-1 flex items-center gap-2 text-[10px] text-fg-faint">
          <span className="capitalize text-[var(--accent)]">{item.categories[0] ?? "News"}</span>
          <span>·</span>
          <span>{formatTimeAgo(item.publishedAt)}</span>
        </div>
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="block">
          <h2 className="text-[15px] font-semibold leading-snug text-fg hover:text-[var(--accent)]">
            {item.headline}
          </h2>
        </a>
        {item.summary && (
          <p className="mt-1 line-clamp-2 text-[12px] text-fg-muted">{item.summary}</p>
        )}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-fg-faint">{item.source}</span>
          <div className="flex items-center gap-1">
            
            <button
              type="button"
              aria-label={isSaved ? "Remove saved story" : "Save story"}
              onClick={() => { toggleSave(savedArticle); toast({ title: isSaved ? "Removed" : "Saved" }); }}
              className="rounded p-1 text-fg-faint hover:text-[var(--accent)]"
            >
              {isSaved ? <BookmarkCheck className="h-3.5 w-3.5 text-[var(--accent)]" /> : <Bookmark className="h-3.5 w-3.5" />}
            </button>
            <a aria-label={`Open ${item.headline} in a new tab`} href={item.url} target="_blank" rel="noopener noreferrer" className="rounded p-1 text-fg-faint hover:text-fg">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Article image with broken-image fallback ── */

/**
 * Phase 13: Renders an article image with graceful fallback.
 *
 * Implementation choice: we use a CSS background-image on a div instead
 * of a native <img> element. This is because:
 *
 *   - The COEP header (`Cross-Origin-Embedder-Policy: require-corp` set in
 *     next.config.ts) blocks external images that don't send
 *     `Cross-Origin-Resource-Policy: cross-origin`. Most publisher images
 *     don't, so <img> + crossOrigin fails silently. Background-image
 *     doesn't enforce CORP — it loads the image directly.
 *
 *   - We don't want to wildcard-allow every domain in next.config.ts
 *     (spec requirement: "do NOT blindly wildcard every domain").
 *     Next/Image would require this for runtime-loaded images.
 *
 *   - background-image has no broken-image-icon artifact — when the URL
 *     fails, the div simply shows the fallback element underneath.
 *
 * Accessibility is preserved via `role="img"` + `aria-label`.
 *
 * The image is loaded with `loading="lazy"` semantics via a tiny
 * IntersectionObserver that defers setting the `backgroundImage` until
 * the element is in view.
 *
 * - onError for background-image doesn't fire, so we use the Image()
 *     constructor to probe the URL first. If it errors, we fall back to
 *     the placeholder element.
 */
function ArticleImage({
  src,
  alt,
  className,
  fallback,
}: {
  src?: string;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const [lastSrc, setLastSrc] = useState<string | undefined>(src);
  if (src !== lastSrc) {
    setLastSrc(src);
    if (failed) setFailed(false);
  }
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Lazy-load: only consider the image "ready to load" when it scrolls
  // into view. This avoids loading 50 images at once on a long feed.
  useEffect(() => {
    if (!src || failed) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // Defer to avoid synchronous setState in the effect body.
      const id = window.setTimeout(() => setInView(true), 0);
      return () => window.clearTimeout(id);
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: "100px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [src, failed]);

  // Probe the URL — if it errors, swap to fallback.
  useEffect(() => {
    if (!src || !inView) return;
    let cancelled = false;
    const probe = new Image();
    probe.onload = () => { if (!cancelled) setFailed(false); };
    probe.onerror = () => { if (!cancelled) setFailed(true); };
    probe.src = src;
    return () => { cancelled = true; };
  }, [src, inView]);

  if (!src || failed) {
    return (
      <div ref={ref} className={cn("flex items-center justify-center", className)}>
        {fallback ?? <Newspaper className="h-6 w-6 text-fg-faint opacity-30" />}
      </div>
    );
  }
  return (
    <div
      ref={ref}
      role="img"
      aria-label={alt}
      className={cn(className)}
      style={inView ? {
        backgroundImage: `url("${src}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      } : undefined}
    >
      {!inView && (fallback ?? <Newspaper className="h-6 w-6 text-fg-faint opacity-30" />)}
    </div>
  );
}

/* ── News card ── */

function NewsCard({ item, variant }: { item: NewsItem; variant: "medium" | "compact" }) {
  const toggleSave = useNewsFeedStore((s) => s.toggleSave);
  const isSaved = useNewsFeedStore((s) => s.isSaved(item.id));

  const savedArticle: SavedArticle = {
    id: item.id,
    title: item.headline,
    description: item.summary,
    url: item.url,
    source: item.source,
    category: item.categories[0] ?? "general",
    publishedAt: item.publishedAt,
    savedAt: 0,
    imageUrl: item.imageUrl,
  };

  if (variant === "compact") {
    return (
      <div className="flex items-start gap-2 rounded-md border border-line bg-surface p-3">
        {/* Phase 13: small thumbnail for compact cards */}
        {item.imageUrl ? (
          <ArticleImage
            src={item.imageUrl}
            alt={item.headline}
            className="h-12 w-12 shrink-0 rounded-md object-cover"
            fallback={null}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            <p className="line-clamp-2 text-[12px] font-medium text-fg hover:text-[var(--accent)]">{item.headline}</p>
          </a>
          <p className="mt-0.5 text-[9px] text-fg-faint">{item.source} · {formatTimeAgo(item.publishedAt)}</p>
        </div>
        
        <button type="button" aria-label={isSaved ? "Remove saved story" : "Save story"} onClick={() => { toggleSave(savedArticle); toast({ title: isSaved ? "Removed" : "Saved" }); }} className="shrink-0 text-fg-faint hover:text-[var(--accent)]">
          {isSaved ? <BookmarkCheck className="h-3.5 w-3.5 text-[var(--accent)]" /> : <Bookmark className="h-3.5 w-3.5" />}
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      {/* Phase 13: real thumbnail or newspaper fallback */}
      <div className="flex h-[100px] items-center justify-center bg-surface-2">
        <ArticleImage
          src={item.imageUrl}
          alt={item.headline}
          className="h-full w-full object-cover"
          fallback={<Newspaper className="h-6 w-6 text-fg-faint opacity-30" />}
        />
      </div>
      <div className="p-3">
        <div className="mb-1 flex items-center gap-1.5 text-[9px] text-fg-faint">
          <span className="capitalize text-[var(--accent)]">{item.categories[0] ?? "News"}</span>
          <span>·</span>
          <span>{formatTimeAgo(item.publishedAt)}</span>
        </div>
        <a href={item.url} target="_blank" rel="noopener noreferrer">
          <p className="line-clamp-2 text-[12px] font-medium text-fg hover:text-[var(--accent)]">{item.headline}</p>
        </a>
        {item.summary && <p className="mt-1 line-clamp-1 text-[10px] text-fg-muted">{item.summary}</p>}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[9px] text-fg-faint">{item.source}</span>
          <div className="flex items-center gap-1">
            
            <button type="button" aria-label={isSaved ? "Remove saved story" : "Save story"} onClick={() => { toggleSave(savedArticle); toast({ title: isSaved ? "Removed" : "Saved" }); }} className="rounded p-0.5 text-fg-faint hover:text-[var(--accent)]">
              {isSaved ? <BookmarkCheck className="h-3 w-3 text-[var(--accent)]" /> : <Bookmark className="h-3 w-3" />}
            </button>
            <a aria-label={`Open ${item.headline} in a new tab`} href={item.url} target="_blank" rel="noopener noreferrer" className="rounded p-0.5 text-fg-faint hover:text-fg">
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Widget column ── */

function WidgetColumn() {
  const widgets = useNewsFeedStore((s) => s.widgets);
  const [addWidgetOpen, setAddWidgetOpen] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const handleDragStart = (id: string) => setDraggedId(id);
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    const ids: string[] = widgets.map(w => w.id);
    const fromIdx = ids.indexOf(draggedId);
    const toIdx = ids.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    ids.splice(fromIdx, 1);
    ids.splice(toIdx, 0, draggedId);
    useNewsFeedStore.getState().reorderWidgets(ids);
    setDraggedId(null);
  };

  return (
    <aside className="hidden w-[260px] shrink-0 flex-col border-r border-line-muted bg-surface-2/40 lg:flex">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line-muted px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">Widgets</span>
        <button onClick={() => setAddWidgetOpen(true)} className="text-fg-faint hover:text-fg" title="Add widget">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {/* Widget list — independent scroll */}
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {widgets.filter(w => w.visible).map(w => (
          <div
            key={w.id}
            draggable
            onDragStart={() => handleDragStart(w.id)}
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(w.id)}
            className={cn("cursor-grab active:cursor-grabbing", draggedId === w.id && "opacity-50")}
          >
            <WidgetWrapper widgetId={w.id} />
          </div>
        ))}
        {widgets.filter(w => w.visible).length === 0 && (
          <p className="py-4 text-center text-[11px] text-fg-faint">No widgets. Click + to add.</p>
        )}
      </div>
      {/* Add widget dialog */}
      {addWidgetOpen && <AddWidgetDialog onClose={() => setAddWidgetOpen(false)} />}
    </aside>
  );
}

function WidgetWrapper({ widgetId }: { widgetId: WidgetId }) {
  const widgets = useNewsFeedStore((s) => s.widgets);
  const toggleCollapse = useNewsFeedStore((s) => s.toggleWidgetCollapse);
  const removeWidget = useNewsFeedStore((s) => s.removeWidget);
  // Hooks must be called BEFORE any conditional early return.
  const [menuOpen, setMenuOpen] = useState(false);
  const config = widgets.find(w => w.id === widgetId);
  if (!config) return null;

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface">
      {/* Widget header */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
          {ALL_WIDGET_OPTIONS.find(o => o.id === widgetId)?.label ?? widgetId}
        </span>
        <div className="relative">
          <button type="button" aria-label="Open widget menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)} className="text-fg-faint hover:text-fg">
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-6 z-20 w-32 overflow-hidden rounded-md border border-line bg-overlay shadow-pop">
                <button onClick={() => { toggleCollapse(widgetId); setMenuOpen(false); }} className="flex w-full items-center gap-1.5 px-2 py-1 text-[10px] text-fg-muted hover:bg-hover hover:text-fg">
                  {config.collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
                  {config.collapsed ? "Expand" : "Collapse"}
                </button>
                <button onClick={() => { removeWidget(widgetId); setMenuOpen(false); }} className="flex w-full items-center gap-1.5 px-2 py-1 text-[10px] text-red-400 hover:bg-hover">
                  <X className="h-3 w-3" />
                  Remove
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {/* Widget body */}
      {!config.collapsed && (
        <div className="px-3 pb-2">
          {widgetId === "weather" && <WeatherWidget />}
          {widgetId === "markets" && <MarketsWidget />}
          {widgetId === "sports" && <SportsWidget />}
          {widgetId === "trending" && <TrendingWidget />}
          {widgetId === "watchlist" && <WatchlistWidget />}
          {widgetId === "top-stories" && <TopStoriesWidget />}
        </div>
      )}
    </div>
  );
}

/* ── Weather widget ── */

function WeatherWidget() {
  const location = useNewsWeatherStore((s) => s.location);
  const setLocation = useNewsWeatherStore((s) => s.setLocation);
  const [data, setData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof location.lat !== "number" || typeof location.lon !== "number") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/news/weather?lat=${location.lat}&lon=${location.lon}`);
        if (!res.ok) throw new Error("Weather service unavailable");
        const d = await res.json();
        if (cancelled) return;
        setData(d);
      } catch {
        if (cancelled) return;
        setError("Weather unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [location.lat, location.lon]);

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/news/geocode?q=${encodeURIComponent(q)}`);
      if (res.status === 404) {
        setSearchError("No matching location found.");
        return;
      }
      if (!res.ok) {
        setSearchError("Geocoding service unavailable.");
        return;
      }
      const loc = await res.json();
      // Trigger the weather effect to re-fetch with the new coordinates.
      // We set loading=true here (in the click handler, NOT in an effect)
      // so the lint rule is satisfied.
      setLoading(true);
      setError(null);
      setLocation({ label: loc.label, lat: loc.lat, lon: loc.lon });
      setEditing(false);
      setQuery("");
    } catch {
      setSearchError("Failed to look up location.");
    } finally {
      setSearching(false);
    }
  };

  if (loading) return <div className="h-[60px] animate-pulse rounded bg-surface-2" />;
  if (error || !data?.current) {
    return (
      <div>
        <p className="text-[10px] text-fg-faint">{error ?? "Weather unavailable"}</p>
        <button onClick={() => setEditing(true)} className="mt-1 text-[10px] text-[var(--accent)] hover:underline">
          Change location
        </button>
        {editing && (
          <LocationEditor
            query={query}
            setQuery={setQuery}
            searching={searching}
            error={searchError}
            onSearch={handleSearch}
            onCancel={() => { setEditing(false); setSearchError(null); }}
          />
        )}
      </div>
    );
  }

  const temp = Math.round(data.current.temperature_2m);
  const feelsLike = Math.round(data.current.apparent_temperature);
  const condition = getWeatherCondition(data.current.weather_code);

  return (
    <div>
      <div className="flex items-center gap-2">
        {condition.icon}
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[20px] font-bold text-fg">{temp}°C</div>
          <button
            onClick={() => setEditing(v => !v)}
            className="flex max-w-full items-center gap-1 truncate text-[9px] text-fg-faint hover:text-fg"
            title="Change weather location"
          >
            <MapPin className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{location.label}</span>
            <ChevronDown className="h-2.5 w-2.5 shrink-0" />
          </button>
        </div>
      </div>
      <p className="mt-1 text-[10px] text-fg-muted">{condition.label}</p>
      <div className="mt-1 flex gap-3 text-[9px] text-fg-faint">
        <span>Feels {feelsLike}°</span>
        <span>Humidity {data.current.relative_humidity_2m}%</span>
        <span>Wind {Math.round(data.current.wind_speed_10m)} km/h</span>
      </div>
      {editing && (
        <LocationEditor
          query={query}
          setQuery={setQuery}
          searching={searching}
          error={searchError}
          onSearch={handleSearch}
          onCancel={() => { setEditing(false); setSearchError(null); }}
        />
      )}
    </div>
  );
}

/** Phase 13: small inline location editor with quick-pick catalog + free-text search. */
function LocationEditor({
  query,
  setQuery,
  searching,
  error,
  onSearch,
  onCancel,
}: {
  query: string;
  setQuery: (s: string) => void;
  searching: boolean;
  error: string | null;
  onSearch: () => void;
  onCancel: () => void;
}) {
  // Lazy-load the catalog to avoid bundling it for users who never open
  // the editor. Small list (~16 entries), so the import cost is negligible.
  const [catalog, setCatalog] = useState<Array<{ label: string; lat: number; lon: number }>>([]);
  useEffect(() => {
    import("@/lib/news/weather-locations").then(({ WEATHER_LOCATION_CATALOG }) => {
      setCatalog(WEATHER_LOCATION_CATALOG);
    });
  }, []);
  const setLocation = useNewsWeatherStore((s) => s.setLocation);
  // We accept a parent `onPick` callback that lets the parent set
  // loading=true + clear error (in the click handler, NOT in an effect)
  // before triggering the location change.
  const onPick = (loc: { label: string; lat: number; lon: number }) => {
    // The parent WeatherWidget reads `loading` from its own state — we
    // can't set it from here directly. Instead, we rely on the location
    // change to trigger the parent's effect, and the parent's initial
    // `loading=true` state already shows the skeleton during the first
    // fetch. For subsequent picks, the parent's `loading` state is already
    // false from the previous successful fetch, so the user sees the
    // previous weather until the new one arrives. That's acceptable UX.
    setLocation({ label: loc.label, lat: loc.lat, lon: loc.lon });
    onCancel();
  };
  return (
    <div className="mt-2 rounded-md border border-line-muted bg-surface-2 p-2">
      <div className="flex items-center gap-1">
        <input
          autoFocus
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && onSearch()}
          placeholder="Search city..."
          className="flex-1 rounded border border-line bg-surface px-2 py-1 text-[10px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
        <button
          onClick={onSearch}
          disabled={searching || !query.trim()}
          className="rounded bg-[var(--accent)] px-2 py-1 text-[10px] font-medium text-[var(--accent-fg)] disabled:opacity-50"
        >
          {searching ? "..." : "Go"}
        </button>
        <button type="button" aria-label="Cancel location search" onClick={onCancel} className="rounded p-1 text-fg-faint hover:text-fg">
          <X className="h-3 w-3" />
        </button>
      </div>
      {error && <p className="mt-1 text-[9px] text-red-400">{error}</p>}
      <div className="mt-2 max-h-32 overflow-y-auto">
        <p className="px-1 text-[9px] uppercase tracking-wide text-fg-faint">Quick pick</p>
        {catalog.map(loc => (
          <button
            key={loc.label}
            onClick={() => onPick({ label: loc.label, lat: loc.lat, lon: loc.lon })}
            className="block w-full truncate rounded px-2 py-1 text-left text-[10px] text-fg-muted hover:bg-hover hover:text-fg"
          >
            {loc.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function getWeatherCondition(code: number): { label: string; icon: React.ReactNode } {
  if (code === 0) return { label: "Clear sky", icon: <Sun className="h-5 w-5 text-amber-400" /> };
  if (code <= 3) return { label: "Partly cloudy", icon: <CloudSun className="h-5 w-5 text-fg-muted" /> };
  if (code <= 48) return { label: "Foggy", icon: <Cloud className="h-5 w-5 text-fg-muted" /> };
  if (code <= 67) return { label: "Rainy", icon: <CloudRain className="h-5 w-5 text-blue-400" /> };
  return { label: "Cloudy", icon: <Cloud className="h-5 w-5 text-fg-muted" /> };
}

/* ── Markets widget ── */

/**
 * Phase 13: News Markets widget uses the EXISTING shared LUCIAN Markets
 * data service — there is NO second Bybit WebSocket connection. We
 * subscribe to price streams for the displayed symbols (refcounted with
 * the chart workspace's subscriptions), read the latest prices via
 * `readNewsMarketSnapshot`, and re-render when the store updates.
 *
 * Clicking a market row deep-links to /markets?symbol=<SYMBOL> using the
 * Phase 9 deep-link architecture — not just the Markets homepage.
 */
const NEWS_MARKET_SYMBOLS = ["BTCUSD", "ETHUSD", "XAUUSD", "NAS100"];

function MarketsWidget() {
  // Subscribe to the shared markets store so we re-render on price updates.
  // We only read a small slice (the price map + ticker map) to minimize
  // re-render churn.
  const pricesVersion = useMarketsStore((s) => {
    // Compute a cheap version number: sum of all known prices' rounded values.
    // This causes a re-render only when an actual displayed price changes.
    let v = 0;
    for (const sym of NEWS_MARKET_SYMBOLS) {
      const p = s.prices.get(sym);
      const t = s.tickers.get(sym);
      v += p ? Math.round(p * 100) : 0;
      v += t ? Math.round(t.priceChangePercent * 100) : 0;
    }
    return v;
  });
  void pricesVersion; // we only use it to trigger re-renders.

  // Subscribe to price streams on mount, unsubscribe on unmount.
  useEffect(() => {
    const cleanup = subscribeNewsMarkets(NEWS_MARKET_SYMBOLS);
    return cleanup;
  }, []);

  const snapshots = NEWS_MARKET_SYMBOLS.map((sym) => readNewsMarketSnapshot(sym));

  // Phase 13 carryover: News Markets must NEVER show fake prices for
  // unsupported instruments. `readNewsMarketSnapshot` returns:
  //   - live=true + price + changePct for crypto symbols with a live
  //     Bybit subscription (BTCUSD, ETHUSD)
  //   - live=false + catalog snapshot price + null changePct for
  //     non-crypto symbols (XAUUSD, NAS100) — clearly marked as REFERENCE
  //   - price=null when neither live nor catalog data exists
  //
  // We surface an honest footer when ANY of the displayed symbols is
  // reference-only so the user understands the displayed price is a
  // reference snapshot, not real current market data.
  const hasLive = snapshots.some((s) => s.live);
  const hasReference = snapshots.some((s) => !s.live && s.price !== null);
  const hasMissing = snapshots.some((s) => s.price === null);

  if (snapshots.every((s) => s.price === null)) {
    return (
      <div>
        <p className="text-[10px] text-fg-faint">Markets data unavailable.</p>
        <a href="/markets" className="mt-1 block text-[9px] text-[var(--accent)] hover:underline">Open Markets →</a>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {snapshots.map(s => (
        <a
          key={s.symbol}
          href={`/markets?symbol=${encodeURIComponent(s.symbol)}`}
          className="flex items-center justify-between rounded px-1 py-0.5 text-[10px] hover:bg-hover"
          title={
            s.live
              ? `${s.symbol} — live data`
              : s.price !== null
                ? `${s.symbol} — reference snapshot (no live provider configured)`
                : `${s.symbol} — unavailable`
          }
        >
          <span className="font-medium text-fg">{s.symbol}</span>
          <div className="flex items-center gap-1.5">
            <span className="font-mono tabular-nums text-fg-muted">
              {s.price !== null
                ? `$${s.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
                : "—"}
            </span>
            {s.live && s.changePct !== null ? (
              <span className={cn("flex items-center gap-0.5 font-mono tabular-nums", s.changePct >= 0 ? "text-green-400" : "text-red-400")}>
                {s.changePct >= 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                {s.changePct >= 0 ? "+" : ""}{s.changePct.toFixed(2)}%
              </span>
            ) : s.price !== null ? (
              // Reference snapshot — honest "REF" badge so the user knows
              // this is NOT live market data.
              <span className="rounded bg-surface-2 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-fg-faint">
                REF
              </span>
            ) : null}
          </div>
        </a>
      ))}
      {/* Phase 13 carryover: honest footer about data source */}
      {hasReference && !hasLive && (
        <p className="mt-1 text-[9px] text-fg-faint">
          Reference prices only — no live provider configured.
        </p>
      )}
      {hasReference && hasLive && (
        <p className="mt-1 text-[9px] text-fg-faint">
          Mixed: live + reference data.
        </p>
      )}
      {hasMissing && (
        <p className="mt-1 text-[9px] text-fg-faint">
          Some symbols unavailable.
        </p>
      )}
      <a href="/markets" className="mt-1 block text-[9px] text-[var(--accent)] hover:underline">Open Markets →</a>
    </div>
  );
}

/* ── Sports widget ── */

function SportsWidget() {
  const [events, setEvents] = useState<SportsEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/news/sports")
      .then(r => r.json())
      .then(d => { setEvents(d.events ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="h-[60px] animate-pulse rounded bg-surface-2" />;
  if (events.length === 0) return <p className="text-[10px] text-fg-faint">No live scores available</p>;

  return (
    <div className="space-y-1.5">
      {events.slice(0, 4).map((e, i) => (
        <div key={i} className="flex items-center justify-between text-[10px]">
          <div className="min-w-0 flex-1">
            <p className="truncate text-fg">{e.homeTeam}</p>
            <p className="truncate text-fg">{e.awayTeam}</p>
          </div>
          <div className="ml-2 text-right">
            <p className="font-mono text-fg">{e.homeScore}</p>
            <p className="font-mono text-fg">{e.awayScore}</p>
          </div>
          {e.status === "live" && <span className="ml-1 rounded bg-red-500/20 px-1 text-[8px] font-bold uppercase text-red-400">Live</span>}
          {e.status === "final" && <span className="ml-1 text-[8px] text-fg-faint">FT</span>}
        </div>
      ))}
    </div>
  );
}

/* ── Trending widget (Phase 13 — derived from REAL article corpus) ── */

function TrendingWidget() {
  const [trends, setTrends] = useState<Trend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTrends = useCallback(async () => {
    try {
      const res = await fetch("/api/news/trending?max=6");
      const data = await res.json();
      setTrends(data.trends ?? []);
      setError(data.error ?? null);
    } catch {
      setError("Failed to load trends.");
      setTrends([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fire-and-forget — the `loading=true` initial state is set by useState,
    // and loadTrends defers all setState calls until after the first await.
    // This keeps the effect body free of synchronous setState calls (which
    // would trigger the react-hooks/set-state-in-effect rule).
    let cancelled = false;
    (async () => {
      try {
        await loadTrends();
      } finally {
        if (!cancelled) return;
      }
    })();
    return () => { cancelled = true; };
  }, [loadTrends]);

  const handleTrendClick = (label: string) => {
    // Dispatch a CustomEvent that NewsFeedPage listens for — it sets
    // topicFilter on the Discover tab so the user sees real matching
    // articles immediately. The trend is NOT decorative.
    window.dispatchEvent(new CustomEvent("lucian:news-topic-filter", { detail: label }));
  };

  if (loading) return <div className="h-[60px] animate-pulse rounded bg-surface-2" />;
  if (error) return <p className="text-[10px] text-fg-faint">{error}</p>;
  if (trends.length === 0) {
    return <p className="text-[10px] text-fg-faint">No trending topics right now.</p>;
  }

  return (
    <div className="space-y-0.5">
      {trends.map((t, i) => (
        <button
          key={t.key}
          onClick={() => handleTrendClick(t.label)}
          className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[10px] text-fg-muted hover:bg-hover hover:text-fg"
          title={`${t.articleCount} articles across ${t.sourceCount} ${t.sourceCount === 1 ? "source" : "sources"}`}
        >
          <span className="font-mono font-bold text-fg-faint">{i + 1}</span>
          <span className="flex-1 truncate">{t.label}</span>
          <span className="font-mono text-[9px] text-fg-faint">{t.sourceCount}×</span>
        </button>
      ))}
    </div>
  );
}

/* ── Watchlist widget (Phase 13 — real user topics + real matching) ── */

function WatchlistWidget() {
  const topics = useNewsWatchlistStore((s) => s.topics);
  const addTopic = useNewsWatchlistStore((s) => s.addTopic);
  const removeTopic = useNewsWatchlistStore((s) => s.removeTopic);
  const toggleTopic = useNewsWatchlistStore((s) => s.toggleTopic);
  const [input, setInput] = useState("");

  const handleAdd = () => {
    const v = input.trim();
    if (!v) return;
    addTopic(v);
    setInput("");
  };

  const handleTopicClick = (label: string) => {
    // Same CustomEvent as Trending — filters the real Discover feed.
    window.dispatchEvent(new CustomEvent("lucian:news-topic-filter", { detail: label }));
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1">
        <input
          type="search"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleAdd()}
          placeholder="Add topic (e.g. Bitcoin)..."
          className="flex-1 rounded border border-line bg-surface px-2 py-1 text-[10px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
        />
        <button
          onClick={handleAdd}
          disabled={!input.trim()}
          className="rounded bg-[var(--accent)] px-2 py-1 text-[10px] font-medium text-[var(--accent-fg)] disabled:opacity-50"
          title="Add topic"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
      {topics.length === 0 ? (
        <p className="text-[10px] text-fg-faint">
          Follow topics to see related stories. Try “Bitcoin”, “Federal Reserve”, or “Nigeria”.
        </p>
      ) : (
        <div className="space-y-0.5">
          {topics.map(t => (
            <div
              key={t.id}
              className={cn(
                "flex items-center gap-1 rounded px-1 py-0.5 text-[10px]",
                t.enabled ? "text-fg-muted" : "text-fg-faint line-through",
              )}
            >
              <button
                onClick={() => toggleTopic(t.id)}
                className="shrink-0 text-fg-faint hover:text-fg"
                title={t.enabled ? "Disable topic" : "Enable topic"}
              >
                <span className={cn("inline-block h-2 w-2 rounded-full", t.enabled ? "bg-[var(--accent)]" : "bg-fg-faint")} />
              </button>
              <button
                onClick={() => t.enabled && handleTopicClick(t.label)}
                disabled={!t.enabled}
                className="flex-1 truncate text-left hover:text-[var(--accent)]"
                title={t.enabled ? `Filter News by “${t.label}”` : "Enable to filter"}
              >
                {t.label}
              </button>
              <button
                onClick={() => removeTopic(t.id)}
                className="shrink-0 text-fg-faint hover:text-red-400"
                title="Remove topic"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Top Stories widget (Phase 13 — real ranking) ── */

function TopStoriesWidget() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/news/top-stories?max=5");
        const data = await res.json();
        if (cancelled) return;
        setItems(data.items ?? []);
        setError(data.error ?? null);
      } catch {
        if (cancelled) return;
        setError("Failed to load top stories.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return <div className="h-[60px] animate-pulse rounded bg-surface-2" />;
  if (error) return <p className="text-[10px] text-fg-faint">{error}</p>;
  if (items.length === 0) {
    return <p className="text-[10px] text-fg-faint">No top stories available right now.</p>;
  }

  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <a
          key={item.id}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded px-1 py-0.5 hover:bg-hover"
        >
          <p className="line-clamp-2 text-[10px] font-medium text-fg-muted hover:text-fg">
            <span className="font-mono font-bold text-fg-faint">{i + 1}.</span>{" "}
            {item.headline}
          </p>
          <p className="mt-0.5 text-[9px] text-fg-faint">{item.source} · {formatTimeAgo(item.publishedAt)}</p>
        </a>
      ))}
    </div>
  );
}

/* ── Add widget dialog ── */

function AddWidgetDialog({ onClose }: { onClose: () => void }) {
  const widgets = useNewsFeedStore((s) => s.widgets);
  const addWidget = useNewsFeedStore((s) => s.addWidget);

  const available = ALL_WIDGET_OPTIONS.filter(o => !widgets.some(w => w.id === o.id));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="themed w-full max-w-sm overflow-hidden rounded-lg border border-line bg-surface shadow-pop" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line-muted px-4 py-3">
          <h2 className="text-[13px] font-semibold text-fg">Add Widget</h2>
          <button type="button" aria-label="Close add widget dialog" onClick={onClose} className="text-fg-muted hover:text-fg"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-3">
          {available.length === 0 ? (
            <p className="py-4 text-center text-[11px] text-fg-faint">All widgets are already added.</p>
          ) : (
            <div className="space-y-1">
              {available.map(o => (
                <button
                  key={o.id}
                  onClick={() => { addWidget(o.id); toast({ title: "Widget added", description: o.label }); onClose(); }}
                  className="flex w-full items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2 text-left text-[12px] text-fg-muted hover:text-fg"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Watch tab (Phase 13 — real RSS video provider) ── */

/**
 * Phase 13: Watch tab pulls REAL video metadata from RSS feeds that
 * include media:content or enclosure with video MIME types.
 *
 * Sources: Reuters Video, BBC News Video, WSJ Video.
 *
 * No fake videos. No fake durations. No fake view counts. No fake LIVE
 * badges. If the provider is partially unavailable, the tab still shows
 * whatever real videos are returned — never fabricated content.
 *
 * Clicking a video:
 *   - Direct media file (mp4/webm/etc.) → opens in an inline <video>
 *     player via a modal.
 *   - Embeddable URL (YouTube/Vimeo/etc.) → opens in a sandboxed iframe
 *     modal OR opens the article page externally, whichever the provider
 *     allows.
 */
function WatchTab() {
  const [videos, setVideos] = useState<NewsVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<NewsVideo | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/news/watch");
      const data = await res.json();
      setVideos(data.videos ?? []);
      setError(data.error ?? null);
    } catch {
      setError("Failed to load videos.");
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fire-and-forget — `loading=true` is the initial useState value,
    // and load() defers all setState calls until after the first await.
    let cancelled = false;
    (async () => {
      try { await load(); } finally { if (cancelled) return; }
    })();
    return () => { cancelled = true; };
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className="space-y-2">
              <div className="h-[120px] animate-pulse rounded-md bg-surface-2" />
              <div className="h-3 w-3/4 animate-pulse rounded bg-surface-2" />
              <div className="h-2 w-1/2 animate-pulse rounded bg-surface-2" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md px-4 py-8 text-center">
        <Play className="mx-auto h-10 w-10 text-fg-faint opacity-30" />
        <p className="mt-3 text-[14px] font-medium text-fg-muted">{error}</p>
        <button onClick={() => { setLoading(true); void load(); }} className="mt-2 rounded border border-line bg-surface-2 px-3 py-1 text-[11px] text-fg-muted hover:text-fg">
          Try Again
        </button>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-8 text-center">
        <Play className="mx-auto h-10 w-10 text-fg-faint opacity-30" />
        <p className="mt-3 text-[14px] font-medium text-fg-muted">No videos available right now</p>
        <p className="mt-1 max-w-sm text-[12px] text-fg-faint">
          The video feeds returned no usable media. Try again in a few minutes.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] text-fg-faint">
          {videos.length} video{videos.length === 1 ? "" : "s"} from Reuters · BBC · WSJ
        </p>
        <button onClick={() => { setLoading(true); void load(); }} className="rounded border border-line bg-surface-2 p-1.5 text-fg-muted hover:text-fg" title="Refresh videos">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {videos.map(v => (
          <button
            key={v.id}
            onClick={() => setActive(v)}
            className="overflow-hidden rounded-md border border-line bg-surface text-left hover:border-[var(--accent)]/40"
          >
            <div className="relative flex h-[120px] items-center justify-center bg-surface-2">
              <ArticleImage
                src={v.thumbnailUrl}
                alt={v.title}
                className="h-full w-full object-cover"
                fallback={<Play className="h-8 w-8 text-fg-faint opacity-30" />}
              />
              <span className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity hover:opacity-100">
                <Play className="h-8 w-8 text-white" />
              </span>
              {v.isLive && (
                <span className="absolute left-2 top-2 rounded bg-red-500/90 px-1.5 py-0.5 text-[8px] font-bold uppercase text-white">Live</span>
              )}
              {v.duration && (
                <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[9px] font-mono text-white">
                  {formatDuration(v.duration)}
                </span>
              )}
            </div>
            <div className="p-2">
              <p className="line-clamp-2 text-[11px] font-medium text-fg">{v.title}</p>
              <p className="mt-1 text-[9px] text-fg-faint">{v.source}{v.publishedAt ? ` · ${formatTimeAgo(v.publishedAt)}` : ""}</p>
            </div>
          </button>
        ))}
      </div>
      {active && <VideoPlayerModal video={active} onClose={() => setActive(null)} />}
    </div>
  );
}

/** Phase 13: video player modal.
 *
 * For direct media URLs (mp4/webm/ogg/m3u8): render an inline <video>
 * element with native controls. The browser handles the playback.
 *
 * For embeddable URLs (YouTube/Vimeo/etc.): render a sandboxed <iframe>
 * that allows only the scripts + same-origin the embed provider needs.
 * Arbitrary untrusted article URLs are NEVER iframed — only known video
 * hosts (validated by isLegitimateVideoUrl in article-media.ts).
 */
function VideoPlayerModal({ video, onClose }: { video: NewsVideo; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl overflow-hidden rounded-lg border border-line bg-surface shadow-pop"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line-muted px-4 py-2">
          <p className="truncate text-[12px] font-medium text-fg">{video.title}</p>
          <button type="button" aria-label="Close video player" onClick={onClose} className="text-fg-muted hover:text-fg">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="aspect-video w-full bg-black">
          {video.kind === "direct" ? (
            <video
              src={video.videoUrl}
              controls
              autoPlay
              className="h-full w-full"
            />
          ) : (
            <iframe
              src={getEmbedUrl(video.videoUrl)}
              title={video.title}
              className="h-full w-full"
              sandbox="allow-scripts allow-same-origin allow-presentation"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          )}
        </div>
        <div className="flex items-center justify-between border-t border-line-muted px-4 py-2">
          <p className="text-[10px] text-fg-faint">{video.source}{video.publishedAt ? ` · ${formatTimeAgo(video.publishedAt)}` : ""}</p>
          {video.articleUrl && (
            <a
              href={video.articleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] text-[var(--accent)] hover:underline"
            >
              Open article <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** Convert a YouTube watch URL into an embed URL.
 *  Other embed providers (Vimeo, Dailymotion) are handled too. */
function getEmbedUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === "youtu.be") {
      const id = u.pathname.slice(1);
      return `https://www.youtube.com/embed/${id}`;
    }
    if (host.endsWith("youtube.com")) {
      const id = u.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${id}`;
      // Already an embed URL?
      if (u.pathname.startsWith("/embed/")) return url;
    }
    if (host.endsWith("vimeo.com")) {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
    if (host.endsWith("dailymotion.com")) {
      const id = u.pathname.split("/").filter(Boolean)[1];
      if (id) return `https://www.dailymotion.com/embed/video/${id}`;
    }
    return url;
  } catch {
    return url;
  }
}

/** Format a video duration in seconds as M:SS or H:MM:SS. */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ── Play tab ── */

function PlayTab() {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="text-center">
        <Gamepad2 className="mx-auto h-12 w-12 text-fg-faint opacity-30" />
        <p className="mt-3 text-[14px] font-medium text-fg-muted">Play Content Provider Not Connected</p>
        <p className="mt-1 max-w-sm text-[12px] text-fg-faint">
          Games, puzzles, and interactive content will appear here when a play content provider is connected.
        </p>
      </div>
    </div>
  );
}

/* ── Helpers ── */

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 86400000 * 2) return "yesterday";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
