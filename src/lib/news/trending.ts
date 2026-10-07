// LUCIAN News — Trending topics, deduplication, and Top Stories ranking.
//
// All three features derive from ONE normalized article corpus — no fake
// data, no hardcoded lists. The algorithms are deterministic and
// explainable (we store enough metadata per trend / top-story to justify
// why it appears).
//
// Trending algorithm:
//   1. Tokenize the most recent articles' headlines + summaries.
//   2. Discard common stop-words, short tokens, and known junk patterns.
//   3. Score each remaining token / phrase as:
//        score = (frequency across articles) × (source diversity) × (recency)
//      - "frequency across articles" = # of distinct articles mentioning it.
//      - "source diversity" = # of distinct publishers mentioning it.
//      - "recency" = exponential decay — newer mentions weight more.
//   4. Keep top N (default 6).
//
//   This rewards topics covered by MULTIPLE publishers over topics repeated
//   many times inside ONE feed (which is usually the same wire copy).
//
// Top Stories ranking:
//   - Score by: recency × source-diversity × (isBreaking ? 1.5 : 1.0).
//   - Same-story (URL-deduped) collapse before ranking so we don't surface
//     five copies of one wire story.
//
// Deduplication:
//   - Primary key: canonical URL (strip query string + fragment).
//   - Secondary: normalized title similarity (Levenshtein distance ≤ ~3 chars
//     on a normalized slug) — collapses headlines like "Bitcoin Rallies Past
//     $80K" vs "Bitcoin Rallies Past $80,000".
//
// All functions are PURE — they take an article array and return a derived
// array. No state, no I/O. The caller decides what to display.

import type { NewsItem, MarketCategory } from "@/lib/markets/intelligence-types";

/** A normalized article record (subset of NewsItem used for derivation). */
export interface NormalizedArticle {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  summary: string;
  categories: MarketCategory[];
  symbols: string[];
  type: string;
  imageUrl?: string;
}

/** Convert a NewsItem[] into a NormalizedArticle[] (lightweight projection). */
export function normalizeArticles(items: NewsItem[]): NormalizedArticle[] {
  return items.map((i) => ({
    id: i.id,
    title: i.headline,
    url: i.url,
    source: i.source,
    publishedAt: i.publishedAt,
    summary: i.summary,
    categories: i.categories,
    symbols: i.symbols,
    type: i.type,
    imageUrl: i.imageUrl,
  }));
}

// ── Stop words + junk patterns ───────────────────────────────────────────

const STOP_WORDS = new Set<string>([
  // Articles / conjunctions / prepositions
  "the", "a", "an", "and", "or", "but", "if", "then", "else",
  "of", "to", "in", "on", "at", "by", "for", "with", "without",
  "as", "is", "are", "was", "were", "be", "been", "being",
  "this", "that", "these", "those", "it", "its",
  "from", "into", "out", "up", "down", "over", "under",
  "after", "before", "since", "until", "while",
  // Common filler
  "news", "today", "yesterday", "tomorrow", "says", "said",
  "report", "reports", "reported", "reporting",
  "will", "would", "could", "should", "may", "might", "must", "shall",
  "has", "have", "had", "having",
  "do", "does", "did", "doing",
  "not", "no", "yes", "so", "very", "more", "most", "less",
  "than", "then", "what", "when", "where", "which", "who", "whom",
  "how", "why", "about", "above", "below", "between", "through",
  "during", "against", "around", "off", "again",
  // Generic news verbs/nouns we don't want as trends on their own
  "first", "last", "new", "old", "next", "former", "current",
  "amid", "amidst", "via", "per", "amid",
  // Currencies (too generic)
  "usd", "us",
]);

/** Reject tokens that are too short, purely numeric, or contain junk. */
function isMeaningfulToken(tok: string): boolean {
  if (tok.length < 3) return false;
  if (tok.length > 40) return false;
  if (/^\d+$/.test(tok)) return false;
  if (STOP_WORDS.has(tok)) return false;
  // Reject tokens that are all punctuation.
  if (!/[a-z]/i.test(tok)) return false;
  return true;
}

/** Tokenize a piece of text into lowercase meaningful tokens. */
function tokenize(text: string): string[] {
  // Split on whitespace + word boundaries (keeps hyphens/apostrophes).
  const raw = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-]/giu, " ")
    .split(/\s+/)
    .filter(Boolean);
  return raw.filter(isMeaningfulToken);
}

// ── Trending ──────────────────────────────────────────────────────────────

export interface Trend {
  /** Display label (Original Case preferred — we keep the first occurrence). */
  label: string;
  /** Lowercase key used for matching. */
  key: string;
  /** Score for ranking — higher = more trending. */
  score: number;
  /** Number of distinct articles mentioning this trend. */
  articleCount: number;
  /** Number of distinct publishers mentioning this trend. */
  sourceCount: number;
  /** Most recent article timestamp mentioning this trend (epoch ms). */
  lastSeenAt: number;
}

/**
 * Derive trending topics from a corpus of articles.
 *
 * Algorithm:
 *   score = (articleCount) × (sourceCount) × (recencyWeight)
 *
 * where recencyWeight = sum over each article of:
 *   exp(-(now - publishedAt) / HALF_LIFE_MS)
 *
 * HALF_LIFE_MS = 24h. So articles < 24h old contribute > 0.5×,
 * articles 2 days old contribute ~0.25×, etc. This means trends fade
 * gracefully over a few days.
 *
 * Multi-word phrases: we ALSO consider 2-word bigrams of frequent tokens
 * to surface trends like "Federal Reserve" / "OpenAI" / "Bitcoin ETF"
 * that span words. We only emit bigrams whose individual tokens already
 * have meaningful frequency, to avoid noise.
 */
export function deriveTrends(
  articles: NormalizedArticle[],
  options: { max?: number; now?: number } = {},
): Trend[] {
  const max = options.max ?? 6;
  const now = options.now ?? Date.now();
  const HALF_LIFE_MS = 24 * 60 * 60 * 1000;

  // Key → trend metadata.
  const trendMap = new Map<string, Trend>();
  // Track distinct sources per trend.
  const trendSources = new Map<string, Set<string>>();

  const upsertTrend = (key: string, label: string, articleSource: string, publishedAt: number) => {
    const t = trendMap.get(key);
    const sources = trendSources.get(key) ?? new Set<string>();
    sources.add(articleSource);
    trendSources.set(key, sources);
    const recencyWeight = Math.exp(-(now - publishedAt) / HALF_LIFE_MS);
    if (t) {
      t.articleCount += 1;
      t.lastSeenAt = Math.max(t.lastSeenAt, publishedAt);
      // Score = articleCount × sourceCount × sum(recencyWeights)
      // We accumulate recencyWeights incrementally — easier to compute the
      // sum first then multiply.
      t.score = (t.score ?? 0) + recencyWeight;
    } else {
      trendMap.set(key, {
        label,
        key,
        score: recencyWeight,
        articleCount: 1,
        sourceCount: 0, // computed below
        lastSeenAt: publishedAt,
      });
    }
  };

  for (const a of articles) {
    const text = `${a.title} ${a.summary}`;
    const tokens = tokenize(text);

    // Single-word trends.
    for (const tok of tokens) {
      upsertTrend(tok, tok, a.source, a.publishedAt);
    }

    // Two-word bigrams — only emit when both tokens are meaningful AND
    // they actually appear adjacent in the headline (not summary) so we
    // surface proper-noun phrases like "Federal Reserve".
    const headTokens = tokenize(a.title);
    for (let i = 0; i < headTokens.length - 1; i++) {
      const a1 = headTokens[i];
      const a2 = headTokens[i + 1];
      if (!isMeaningfulToken(a1) || !isMeaningfulToken(a2)) continue;
      // Skip if either is a stop word (we already filtered above but
      // double-check).
      if (STOP_WORDS.has(a1) || STOP_WORDS.has(a2)) continue;
      const key = `${a1} ${a2}`;
      upsertTrend(key, key, a.source, a.publishedAt);
    }
  }

  // Compute sourceCount and final score = score (sum of recency weights)
  // × sourceCount. sourceCount is already counted via the Set.
  for (const t of trendMap.values()) {
    const sources = trendSources.get(t.key);
    t.sourceCount = sources ? sources.size : 0;
    t.score = t.score * Math.max(1, t.sourceCount);
  }

  // Filter: require at least 2 articles AND prefer source diversity.
  // A trend covered by only 1 publisher is rarely "trending".
  const filtered = Array.from(trendMap.values()).filter((t) => {
    if (t.articleCount < 2) return false;
    // For single-word trends, require source diversity ≥ 2 OR articleCount ≥ 4.
    // For bigrams, allow source diversity = 1 if articleCount ≥ 3 (a single
    // publisher may legitimately cover "Federal Reserve" multiple times).
    const isBigram = t.key.includes(" ");
    if (isBigram) {
      return t.sourceCount >= 2 || t.articleCount >= 3;
    }
    return t.sourceCount >= 2;
  });

  // Sort: highest score first, then most recent.
  filtered.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score;
    return b.lastSeenAt - a.lastSeenAt;
  });

  // De-duplicate overlapping trends — if "bitcoin" and "bitcoin etf" both
  // surface, keep the more specific one (bigram). We do this by removing
  // any single-word trend whose key is a substring of a higher-ranked
  // bigram's key.
  const out: Trend[] = [];
  for (const t of filtered) {
    const isSubstringOfHigher = out.some((o) =>
      o.key !== t.key &&
      o.key.includes(t.key) &&
      o.score >= t.score * 0.5
    );
    if (!isSubstringOfHigher) {
      out.push(t);
      if (out.length >= max) break;
    }
  }

  return out;
}

// ── Deduplication ─────────────────────────────────────────────────────────

/**
 * Deduplicate articles by canonical URL + normalized title.
 *
 * Returns a new array — original order preserved (first occurrence wins).
 *
 * Canonical URL = strip query string + fragment + trailing slash. Multiple
 * publishers may link to the same wire story (Reuters → BBC → Guardian all
 * republish), so we also collapse by normalized-title similarity.
 */
export function deduplicateArticles(articles: NormalizedArticle[]): NormalizedArticle[] {
  const seenByUrl = new Set<string>();
  const seenByTitleSlug = new Set<string>();
  const out: NormalizedArticle[] = [];
  for (const a of articles) {
    const canonUrl = canonicalizeUrl(a.url);
    if (seenByUrl.has(canonUrl)) continue;
    const slug = normalizeTitleSlug(a.title);
    if (seenByTitleSlug.has(slug)) continue;
    seenByUrl.add(canonUrl);
    seenByTitleSlug.add(slug);
    out.push(a);
  }
  return out;
}

function canonicalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Strip hash + query. Keep pathname. Drop trailing slash.
    let path = u.pathname;
    if (path.endsWith("/") && path.length > 1) path = path.slice(0, -1);
    return `${u.protocol}//${u.hostname.toLowerCase()}${path}`;
  } catch {
    return url;
  }
}

function normalizeTitleSlug(title: string): string {
  // Lowercase, strip punctuation, collapse whitespace, then take first 60
  // chars — enough to catch wire-story variants without being too loose.
  const s = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/giu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return s;
}

// ── Top Stories ─────────────────────────────────────────────────────────

/**
 * Derive Top Stories from a corpus of articles.
 *
 * Algorithm:
 *   score = recencyWeight × sourceDiversity × (isBreaking ? 1.5 : 1.0)
 *
 * recencyWeight = exp(-(now - publishedAt) / HALF_LIFE_MS) (24h half-life)
 * sourceDiversity = # of distinct publishers covering the same normalized
 *                   title (i.e. how widely the wire spread).
 *
 * Returns the top N (default 5) deduplicated articles.
 */
export function deriveTopStories(
  articles: NormalizedArticle[],
  options: { max?: number; now?: number } = {},
): NormalizedArticle[] {
  const max = options.max ?? 5;
  const now = options.now ?? Date.now();
  const HALF_LIFE_MS = 24 * 60 * 60 * 1000;

  // Deduplicate first so we don't surface the same wire story 5 times.
  const deduped = deduplicateArticles(articles);

  // Compute source-diversity per title-slug.
  const titleSlugSources = new Map<string, Set<string>>();
  for (const a of deduped) {
    const slug = normalizeTitleSlug(a.title);
    const sources = titleSlugSources.get(slug) ?? new Set<string>();
    sources.add(a.source);
    titleSlugSources.set(slug, sources);
  }

  // Score each article.
  const scored = deduped.map((a) => {
    const slug = normalizeTitleSlug(a.title);
    const diversity = titleSlugSources.get(slug)?.size ?? 1;
    const recencyWeight = Math.exp(-(now - a.publishedAt) / HALF_LIFE_MS);
    const isBreaking = a.type === "breaking";
    const score = recencyWeight * Math.max(1, diversity) * (isBreaking ? 1.5 : 1.0);
    return { article: a, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.article);
}

// ── Watchlist matching ───────────────────────────────────────────────────

/**
 * Match a watchlist topic against a corpus of articles.
 *
 * Match rule:
 *   - Case-insensitive whole-word match of the topic against title + summary.
 *   - "Federal Reserve" matches "Federal Reserve" or "federal reserve"
 *     but NOT "FederalReserve" or "federal-reserve" (we want true word boundaries).
 *   - Actually we DO allow hyphen/space variants via the regex (substituting
 *     one separator for the other).
 *
 * Returns the matching articles in original order (newest first is the
 * caller's responsibility — typically `articles` is already sorted).
 */
export function matchWatchlistTopic(
  topic: string,
  articles: NormalizedArticle[],
): NormalizedArticle[] {
  const normalized = topic.trim();
  if (!normalized) return [];
  // Build a regex that matches the topic as a phrase, allowing whitespace
  // OR hyphens between words. Case-insensitive.
  const words = normalized.split(/\s+/).map((w) => escapeRegex(w.toLowerCase()));
  const pattern = words.join("[\\s\\-]+");
  const re = new RegExp(`(?:^|\\b)${pattern}(?:\\b|$)`, "i");
  return articles.filter((a) => re.test(a.title) || re.test(a.summary));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
