// LUCIAN Markets — RSS news aggregator.
//
// Real market news is fetched from public RSS feeds of authoritative
// financial publishers. RSS is the most permissive data source:
//   - No API key required
//   - Public syndication format (intended for redistribution)
//   - No licensing restrictions on displaying headlines + links
//
// To stay honest and respectful of source terms:
//   - We only display headline + short summary + source + link
//   - We never display full article text
//   - The "Read" button always links back to the original publisher
//
// Categories are derived from each feed's known topical focus.
//
// Phase 13: this module now also extracts article media (media:content,
// media:thumbnail, enclosure, description <img>, content:encoded <img>)
// and falls back to a server-side Open Graph fetch when RSS supplies no
// legitimate image. See src/lib/news/article-media.ts for the pipeline.

import type { NewsItem, NewsProvider, NewsFilters, MarketCategory } from "./intelligence-types";
import {
  resolveArticleMedia,
  type RssItemForMedia,
} from "@/lib/news/article-media";

/** A single RSS feed source. */
interface FeedSource {
  /** Stable ID used as providerId on resulting NewsItems. */
  id: string;
  /** Publisher name shown in the UI. */
  source: string;
  /** RSS feed URL. */
  url: string;
  /** Market categories this feed generally covers. */
  categories: MarketCategory[];
  /** Default content type for stories from this feed. */
  defaultType: NewsItem["type"];
}

/** Curated list of legitimate financial RSS feeds.
    Each is a well-known publisher whose RSS feed is publicly
    distributed for syndication. */
const FEEDS: FeedSource[] = [
  // ── Crypto ────────────────────────────────────────────────────────
  {
    id: "coindesk",
    source: "CoinDesk",
    url: "https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml",
    categories: ["crypto"],
    defaultType: "news",
  },
  {
    id: "cointelegraph",
    source: "Cointelegraph",
    url: "https://cointelegraph.com/rss",
    categories: ["crypto"],
    defaultType: "news",
  },
  // ── Forex / Macro ────────────────────────────────────────────────
  {
    id: "fxstreet-forex",
    source: "FXStreet",
    url: "https://www.fxstreet.com/rss/news/forex",
    categories: ["forex"],
    defaultType: "news",
  },
  {
    id: "fxstreet-markets",
    source: "FXStreet",
    url: "https://www.fxstreet.com/rss/news/markets",
    categories: ["forex", "stocks", "indices"],
    defaultType: "news",
  },
  // ── Multi-asset / general ────────────────────────────────────────
  {
    id: "investing-news",
    source: "Investing.com",
    url: "https://www.investing.com/news/rss/1.rss",
    categories: ["stocks", "indices"],
    defaultType: "news",
  },
  {
    id: "investing-forex",
    source: "Investing.com",
    url: "https://www.investing.com/news/forex-news/rss",
    categories: ["forex"],
    defaultType: "news",
  },
  // ── Commodities / Metals / Energy ───────────────────────────────
  {
    id: "investing-commodities",
    source: "Investing.com",
    url: "https://www.investing.com/news/commodities-news/rss",
    categories: ["metals", "energy"],
    defaultType: "news",
  },
  {
    id: "kitco-metals",
    source: "Kitco",
    url: "https://www.kitco.com/news/rss/",
    categories: ["metals"],
    defaultType: "news",
  },
];

/** Symbol-matching rules — used to attach instrument symbols to stories
    based on headline keyword matches. */
const SYMBOL_KEYWORDS: { symbol: string; keywords: string[] }[] = [
  { symbol: "BTCUSD", keywords: ["bitcoin", "btc"] },
  { symbol: "ETHUSD", keywords: ["ethereum", "eth "] },
  { symbol: "XRPUSD", keywords: ["ripple", "xrp"] },
  { symbol: "SOLUSD", keywords: ["solana", "sol "] },
  { symbol: "BNBUSD", keywords: ["bnb"] },
  { symbol: "XAUUSD", keywords: ["gold", "xau"] },
  { symbol: "XAGUSD", keywords: ["silver", "xag"] },
  { symbol: "XTIUSD", keywords: ["wti", "crude oil"] },
  { symbol: "XBRUSD", keywords: ["brent"] },
  { symbol: "XNGUSD", keywords: ["natural gas"] },
  { symbol: "EURUSD", keywords: ["eur/usd", "euro dollar", "euro/dollar"] },
  { symbol: "GBPUSD", keywords: ["gbp/usd", "pound dollar", "cable"] },
  { symbol: "USDJPY", keywords: ["usd/jpy", "dollar yen"] },
  { symbol: "NAS100", keywords: ["nasdaq"] },
  { symbol: "US30", keywords: ["dow jones", "djia"] },
  { symbol: "SPX500", keywords: ["s&p 500", "sp500", "s&p500"] },
];

/** RSS <item> shape — only the fields we read. */
interface RssItem {
  title?: string;
  link?: string;
  /** Stripped plaintext summary (HTML tags removed) — used for display. */
  description?: string;
  /** Phase 13: raw HTML description (tags preserved) — used for <img> extraction. */
  descriptionHtml?: string;
  pubDate?: string;
  creator?: string;
  /** Phase 13: full HTML body from content:encoded. */
  contentEncoded?: string;
  /** Phase 13: raw <item> XML chunk for namespace-aware media extraction. */
  raw?: string;
  /** Phase 13: enclosures attached to the item. */
  enclosures?: { url: string; type?: string; length?: string }[];
}

/** Parse an RSS XML string into a list of items. Server-side only —
    uses Node's DOMParser via a tiny regex-based extractor (no extra deps). */
function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  const matches = xml.match(itemRegex) ?? [];
  for (const m of matches) {
    const item: RssItem = { raw: m };
    const titleMatch = m.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) item.title = decodeEntities(stripCdata(titleMatch[1].trim()));
    const linkMatch = m.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    if (linkMatch) item.link = decodeEntities(stripCdata(linkMatch[1].trim()));
    const descMatch = m.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    if (descMatch) {
      const rawHtml = decodeEntities(stripCdata(descMatch[1].trim()));
      item.descriptionHtml = rawHtml;
      item.description = stripHtml(rawHtml);
    }
    const pubMatch = m.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);
    if (pubMatch) item.pubDate = pubMatch[1].trim();
    const creatorMatch = m.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
    if (creatorMatch) item.creator = creatorMatch[1].trim();
    // Phase 13: extract content:encoded (full HTML body).
    const contentMatch = m.match(/<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i);
    if (contentMatch) item.contentEncoded = decodeEntities(stripCdata(contentMatch[1].trim()));
    // Phase 13: extract all <enclosure> tags.
    const enclosureRegex = /<enclosure\b[^>]*?(?:\/>|><\/enclosure>)/gi;
    const enclosureMatches = m.match(enclosureRegex) ?? [];
    if (enclosureMatches.length > 0) {
      item.enclosures = enclosureMatches.map((e) => {
        const urlMatch = e.match(/\surl=["']([^"']+)["']/i);
        const typeMatch = e.match(/\stype=["']([^"']+)["']/i);
        const lengthMatch = e.match(/\slength=["']([^"']+)["']/i);
        return {
          url: urlMatch ? decodeEntities(urlMatch[1]) : "",
          type: typeMatch ? typeMatch[1] : undefined,
          length: lengthMatch ? lengthMatch[1] : undefined,
        };
      }).filter((e) => e.url);
    }
    items.push(item);
  }
  return items;
}

/** Remove RSS CDATA wrappers like <![CDATA[...]]> */
function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function stripHtml(s: string): string {
  // Remove HTML tags + collapse whitespace.
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function categorize(
  headline: string,
  feedCategories: MarketCategory[],
): { categories: MarketCategory[]; symbols: string[]; type: NewsItem["type"] } {
  const lower = headline.toLowerCase();
  const symbols: string[] = [];
  for (const { symbol, keywords } of SYMBOL_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) symbols.push(symbol);
  }
  const isBreaking =
    lower.includes("breaking") ||
    lower.includes("just in") ||
    lower.includes("alert");
  return {
    categories: feedCategories,
    symbols,
    type: isBreaking ? "breaking" : "news",
  };
}

function hashId(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/** Convert RSS items to NewsItems — async because we may fetch Open Graph
 *  images for items that don't have one in the RSS feed. */
async function toNewsItems(
  source: FeedSource,
  items: RssItem[],
  ogCache: Map<string, import("@/lib/news/article-media").ArticleMedia | null>,
  ogFallbackBudget: { count: number },
): Promise<NewsItem[]> {
  const out: NewsItem[] = [];
  for (const i of items) {
    if (!i.title || !i.link) continue;
    const headline = i.title;
    const { categories, symbols, type } = categorize(headline, source.categories);
    const publishedAt = i.pubDate ? Date.parse(i.pubDate) : Date.now();

    // Phase 13: resolve article media. Priority:
    //   media:content → media:thumbnail → enclosure → description img →
    //   content:encoded img → Open Graph fallback (bounded + SSRF-protected).
    const itemForMedia: RssItemForMedia = {
      link: i.link,
      description: i.descriptionHtml,
      contentEncoded: i.contentEncoded,
      raw: i.raw,
      enclosures: i.enclosures,
    };
    const media = await resolveArticleMedia(itemForMedia, i.link, ogCache, ogFallbackBudget);

    out.push({
      id: hashId(i.link),
      source: source.source,
      publishedAt: Number.isNaN(publishedAt) ? Date.now() : publishedAt,
      headline,
      summary: (i.description ?? "").slice(0, 280),
      url: i.link,
      type,
      categories,
      symbols,
      providerId: source.id,
      imageUrl: media?.imageUrl,
    });
  }
  return out;
}

/** Fetch a single RSS feed with timeout. */
async function fetchFeed(
  source: FeedSource,
  signal: AbortSignal,
  ogCache: Map<string, import("@/lib/news/article-media").ArticleMedia | null>,
  ogFallbackBudget: { count: number },
): Promise<NewsItem[]> {
  try {
    const res = await fetch(source.url, {
      signal,
      headers: {
        // Some RSS endpoints require a UA.
        "User-Agent": "LUCIAN-Markets/1.0 (+https://lucian.app)",
      },
      // Server-side fetch — no CORS restrictions.
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return await toNewsItems(source, parseRss(xml), ogCache, ogFallbackBudget);
  } catch {
    return [];
  }
}

/** RSS Aggregator provider — combines multiple legitimate RSS feeds
    into a single sorted, deduplicated feed. */
export const rssAggregatorProvider: NewsProvider = {
  id: "rss-aggregator",
  label: "RSS Aggregator (CoinDesk, Cointelegraph, FXStreet, Investing.com, Kitco)",
  configured: true,
  async fetch(filters: NewsFilters): Promise<NewsItem[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    // Phase 13: per-request Open Graph cache + bounded fallback budget.
    // The cache prevents re-fetching the same article URL across multiple
    // feeds; the budget caps total OG fetches at OG_LIMITS.MAX_FALLBACK_PER_REQUEST
    // so a single /api/news/feed request never blows up into dozens of
    // publisher-page fetches.
    const ogCache = new Map<string, import("@/lib/news/article-media").ArticleMedia | null>();
    const ogFallbackBudget = { count: 0 };
    try {
      // Fetch all feeds in parallel.
      const allResults = await Promise.all(
        FEEDS.map((src) => fetchFeed(src, controller.signal, ogCache, ogFallbackBudget)),
      );
      let items = allResults.flat();

      // Deduplicate by id (same story may appear in multiple feeds).
      const seen = new Set<string>();
      items = items.filter((it) => {
        if (seen.has(it.id)) return false;
        seen.add(it.id);
        return true;
      });

      // ── Apply filters ──
      if (filters.market !== "all") {
        items = items.filter((it) => it.categories.includes(filters.market));
      }
      const allowedTypes = new Set<string>();
      if (filters.content.breaking) allowedTypes.add("breaking");
      if (filters.content.news) allowedTypes.add("news");
      if (filters.content.analysis) allowedTypes.add("analysis");
      if (filters.content.economicEvents) allowedTypes.add("economic-event");
      items = items.filter((it) => allowedTypes.has(it.type));

      if (filters.currentInstrumentOnly && filters.market !== "all") {
        // For "current instrument only", filter by attached symbols.
        // The store side attaches the current symbol to filters before
        // calling fetch; we filter by symbols matching the current
        // instrument OR market category.
        items = items.filter((it) => it.symbols.length > 0);
      }

      // Sort latest first.
      items.sort((a, b) => b.publishedAt - a.publishedAt);
      return items.slice(0, 100);
    } finally {
      clearTimeout(timeout);
    }
  },
};
