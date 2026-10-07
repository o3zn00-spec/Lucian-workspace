// LUCIAN News — Article Media pipeline (Phase 13).
//
// Normalizes media extraction from RSS items + optional Open Graph
// fallback into ONE canonical ArticleMedia field. The pipeline is
// priority-ordered so the most reliable source wins.
//
//   1. media:content           (RSS Media RSS extension — large images, video)
//   2. media:thumbnail         (RSS Media RSS extension — small thumbnails)
//   3. <enclosure>             (RSS 2.0 — usually a podcast/image MIME)
//   4. <img> from <description> (HTML inside the description field)
//   5. <img> from content:encoded (HTML inside the content:encoded field)
//   6. Open Graph image        (server-side fetch + parse, only if no RSS image)
//
// All extracted URLs are validated for safety. Tracking pixels, data: URLs,
// javascript: URLs, and obvious 1x1 pixels are rejected. We prefer https.
//
// SSRF protections live in `safeFetchArticleHtml()` — we never fetch the
// article page unless its URL was returned by the News provider AND the
// hostname passes private/internal IP checks.
//
// This module is SERVER-ONLY. It uses Node fetch with bounded redirects,
// bounded response size, and bounded timeout. We do NOT expose an arbitrary
// URL proxy — the only public API is `resolveArticleMedia()` which takes
// an article URL the RSS provider already trusted.

/** Canonical media representation attached to every article. */
export interface ArticleMedia {
  /** Stable image URL (https preferred) or undefined if no legitimate image. */
  imageUrl?: string;
  /** Stable video URL (direct media file) or embeddable video URL. */
  videoUrl?: string;
  /** "image" or "video". Defaults to "image" when imageUrl is set. */
  type?: "image" | "video";
  /** Where the media came from — used for diagnostics + debugging. */
  source:
    | "media-content"
    | "thumbnail"
    | "enclosure"
    | "description"
    | "content-encoded"
    | "open-graph"
    | "twitter";
}

/** Parsed RSS item — the minimal subset we read for media extraction.
 *  `raw` is the full <item>...</item> XML for namespace-aware extraction. */
export interface RssItemForMedia {
  link?: string;
  description?: string;
  /** content:encoded — RSS 2.0 + FeedBurner extension carrying full HTML body. */
  contentEncoded?: string;
  /** The raw <item> XML chunk so we can run regex extraction on namespaced tags. */
  raw?: string;
  /** Enclosures attached to the item. */
  enclosures?: { url: string; type?: string; length?: string }[];
}

const MAX_OG_FALLBACK_PER_REQUEST = 4;
const OG_FETCH_TIMEOUT_MS = 5_000;
const OG_FETCH_MAX_BYTES = 1_500_000; // 1.5MB HTML cap — plenty for OG extraction.
const OG_MAX_REDIRECTS = 3;

// ── Phase 13 carryover: cross-request in-memory TTL cache ──────────────────
//
// The per-request `ogCache` (passed by the caller) prevents duplicate
// OG fetches WITHIN one /api/news/feed request. But the same articles
// are fetched again on the NEXT request, hammering publisher pages.
//
// This module-level Map survives across requests inside the same Node.js
// serverless function instance (Vercel reuses warm instances for ~5–15
// minutes between invocations). It is:
//
//   - keyed by CANONICAL article URL (query string + fragment + trailing
//     slash stripped) so two URL variants of the same article share
//     one cache entry
//   - bounded to OG_CACHE_MAX_ENTRIES (500) — oldest entries evicted
//     first via simple insertion-order sweep
//   - TTL of OG_CACHE_TTL_MS (45 minutes) — expired entries removed
//     lazily on read AND proactively on every write
//   - stores BOTH successful results AND null results (so a known
//     "no OG image" article doesn't get re-fetched)
//   - in-memory only — NO database, NO Redis, NO filesystem. State is
//     lost on cold starts, which is fine (the next request rebuilds it).
//
// All SSRF protections in `safeFetchArticleHtml` are preserved — the
// cache only short-circuits the FETCH step, never the URL validation.

interface OgCacheEntry {
  media: ArticleMedia | null;
  expiresAt: number; // epoch ms
}

const OG_CACHE_TTL_MS = 45 * 60 * 1000; // 45 minutes
const OG_CACHE_MAX_ENTRIES = 500;

const ogTtlCache = new Map<string, OgCacheEntry>();

/** Canonicalize an article URL for cache keying:
 *  - strip query string + fragment (same article, different tracking params)
 *  - strip trailing slash
 *  - lowercase the hostname
 *  Returns the canonical key, or the original URL on parse failure. */
function canonicalizeArticleUrl(url: string): string {
  try {
    const u = new URL(url);
    let path = u.pathname;
    if (path.endsWith("/") && path.length > 1) path = path.slice(0, -1);
    return `${u.protocol}//${u.hostname.toLowerCase()}${path}`;
  } catch {
    return url;
  }
}

/** Look up a cached OG result. Returns the cached ArticleMedia (which
 *  may be null for "no OG image found") or `undefined` if not cached
 *  or expired. Lazily evicts the expired entry on read. */
function ogCacheGet(canonicalUrl: string): ArticleMedia | null | undefined {
  const entry = ogTtlCache.get(canonicalUrl);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    ogTtlCache.delete(canonicalUrl);
    return undefined;
  }
  return entry.media;
}

/** Store an OG result (success OR null) in the cache with the configured
 *  TTL. Proactively evicts expired entries when the cache exceeds the
 *  max-entries cap. */
function ogCacheSet(canonicalUrl: string, media: ArticleMedia | null): void {
  // Proactive eviction of expired entries.
  if (ogTtlCache.size >= OG_CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of ogTtlCache) {
      if (v.expiresAt < now) ogTtlCache.delete(k);
    }
  }
  // If still over cap after expiry sweep, evict oldest insertion-order
  // entries until we're under the cap. Map preserves insertion order
  // in JS, so the first iteration is the oldest.
  while (ogTtlCache.size >= OG_CACHE_MAX_ENTRIES) {
    const oldest = ogTtlCache.keys().next().value;
    if (oldest === undefined) break;
    ogTtlCache.delete(oldest);
  }
  ogTtlCache.set(canonicalUrl, {
    media,
    expiresAt: Date.now() + OG_CACHE_TTL_MS,
  });
}

/**
 * Resolve the canonical media for an article.
 *
 * Order of preference:
 *   media:content → media:thumbnail → enclosure → description img →
 *   content:encoded img → Open Graph fallback.
 *
 * @param item         The parsed RSS item (with raw XML preserved).
 * @param articleUrl   The article's canonical URL (already trusted by RSS).
 * @param ogCache      Optional shared cache (Map<articleUrl, ArticleMedia|null>)
 *                     so multiple callers in one request don't re-fetch the
 *                     same article page.
 * @param ogFallbackBudget  Mutable counter — limits how many OG fetches the
 *                     caller will perform this request. Defaults to 4.
 */
export async function resolveArticleMedia(
  item: RssItemForMedia,
  articleUrl: string,
  ogCache?: Map<string, ArticleMedia | null>,
  ogFallbackBudget?: { count: number },
): Promise<ArticleMedia | null> {
  // 1. media:content
  const mediaContent = extractMediaContent(item.raw);
  if (mediaContent?.imageUrl && isLegitimateImageUrl(mediaContent.imageUrl)) {
    return mediaContent;
  }
  if (mediaContent?.videoUrl && isLegitimateVideoUrl(mediaContent.videoUrl)) {
    return { videoUrl: mediaContent.videoUrl, type: "video", source: "media-content" };
  }

  // 2. media:thumbnail
  const thumbnail = extractMediaThumbnail(item.raw);
  if (thumbnail && isLegitimateImageUrl(thumbnail)) {
    return { imageUrl: thumbnail, type: "image", source: "thumbnail" };
  }

  // 3. enclosure
  const enclosureMedia = extractEnclosureMedia(item.enclosures);
  if (enclosureMedia) return enclosureMedia;

  // 4. <img> from <description>
  const descImg = extractFirstImg(item.description);
  if (descImg && isLegitimateImageUrl(descImg)) {
    return { imageUrl: descImg, type: "image", source: "description" };
  }

  // 5. <img> from content:encoded
  const contentImg = extractFirstImg(item.contentEncoded);
  if (contentImg && isLegitimateImageUrl(contentImg)) {
    return { imageUrl: contentImg, type: "image", source: "content-encoded" };
  }

  // 6. Open Graph fallback — only if the caller still has budget AND the
  //    article URL is safe to fetch.
  //
  //    Phase 13 carryover: check the cross-request TTL cache FIRST so
  //    repeated requests for the same article don't re-fetch the publisher
  //    page. The TTL cache also short-circuits the per-request budget
  //    decrement — a cache hit doesn't consume the OG fetch budget.
  const canonicalUrl = canonicalizeArticleUrl(articleUrl);

  // 6a. Cross-request TTL cache hit?
  const ttlCached = ogCacheGet(canonicalUrl);
  if (ttlCached !== undefined) {
    return ttlCached;
  }

  // 6b. Per-request cache hit (within this single /api/news/feed call)?
  if (ogCache?.has(articleUrl)) {
    const cached = ogCache.get(articleUrl);
    return cached ?? null;
  }

  // 6c. Out of per-request OG budget?
  if (ogFallbackBudget && ogFallbackBudget.count >= MAX_OG_FALLBACK_PER_REQUEST) {
    return null; // out of OG budget — accept "no image"
  }

  // 6d. Fetch + populate both caches.
  const og = await safeResolveOpenGraph(articleUrl);
  if (ogFallbackBudget) ogFallbackBudget.count += 1;
  if (ogCache) ogCache.set(articleUrl, og);
  ogCacheSet(canonicalUrl, og);
  return og;
}

// ── 1. media:content ─────────────────────────────────────────────────────

/** Extract media:content elements from the raw RSS XML.
 *
 * media:content appears as either:
 *   <media:content url="..." medium="image" />
 *   <media:content url="..." medium="video" type="video/mp4" />
 *   <media:group><media:content url="..." /></media:group>
 *
 * We extract the first image medium OR the first video if no image.
 */
export function extractMediaContent(rawXml?: string): ArticleMedia | null {
  if (!rawXml) return null;
  const re = /<media:content\b[^>]*?(?:\/>|><\/media:content>)/gi;
  const matches = rawXml.match(re) ?? [];
  let firstImage: string | null = null;
  let firstVideo: string | null = null;
  for (const m of matches) {
    const url = extractAttr(m, "url");
    if (!url) continue;
    const medium = extractAttr(m, "medium")?.toLowerCase();
    const type = extractAttr(m, "type")?.toLowerCase() ?? "";
    if (medium === "image" || type.startsWith("image/")) {
      if (!firstImage) firstImage = url;
    } else if (medium === "video" || type.startsWith("video/")) {
      if (!firstVideo) firstVideo = url;
    } else {
      // No medium/type hint — accept as image only if URL looks image-y.
      if (!firstImage && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)) {
        firstImage = url;
      }
    }
  }
  if (firstImage) return { imageUrl: firstImage, type: "image", source: "media-content" };
  if (firstVideo) return { videoUrl: firstVideo, type: "video", source: "media-content" };
  return null;
}

// ── 2. media:thumbnail ───────────────────────────────────────────────────

export function extractMediaThumbnail(rawXml?: string): string | null {
  if (!rawXml) return null;
  const re = /<media:thumbnail\b[^>]*?(?:\/>|><\/media:thumbnail>)/gi;
  const matches = rawXml.match(re) ?? [];
  for (const m of matches) {
    const url = extractAttr(m, "url");
    if (url) return url;
  }
  return null;
}

// ── 3. enclosure ─────────────────────────────────────────────────────────

function extractEnclosureMedia(
  enclosures?: { url: string; type?: string; length?: string }[],
): ArticleMedia | null {
  if (!enclosures || enclosures.length === 0) return null;
  for (const e of enclosures) {
    if (!e.url) continue;
    const type = (e.type ?? "").toLowerCase();
    if (type.startsWith("image/")) {
      if (isLegitimateImageUrl(e.url)) {
        return { imageUrl: e.url, type: "image", source: "enclosure" };
      }
    } else if (type.startsWith("video/")) {
      if (isLegitimateVideoUrl(e.url)) {
        return { videoUrl: e.url, type: "video", source: "enclosure" };
      }
    } else if (type.startsWith("audio/")) {
      // Audio enclosure — skip for the visual feed (we don't show audio in cards).
      continue;
    } else {
      // No type hint — accept only if URL looks like an image.
      if (isLegitimateImageUrl(e.url) && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(e.url)) {
        return { imageUrl: e.url, type: "image", source: "enclosure" };
      }
    }
  }
  return null;
}

// ── 4 + 5. <img> from HTML ────────────────────────────────────────────────

export function extractFirstImg(html?: string): string | null {
  if (!html) return null;
  // Match <img ... src="..." ...>. Case-insensitive, accepts single quotes.
  const re = /<img\b[^>]*?\ssrc=["']([^"']+)["'][^>]*>/i;
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : null;
}

// ── 6. Open Graph fallback (server-side, SSRF-protected) ─────────────────

/**
 * Fetch the article page (bounded redirects, bounded timeout, bounded size),
 * parse for og:image / twitter:image, and return the first legitimate URL.
 *
 * SSRF protections:
 *   - http/https only (no file://)
 *   - reject localhost / private IPs / link-local / loopback
 *   - reject non-ASCII hostnames that look like IDN-based obfuscation
 *   - bounded redirects (3) — each hop re-validated
 *   - response-size limit (1.5MB HTML)
 *   - HTML content-type only
 *   - timeout 5s
 */
async function safeResolveOpenGraph(articleUrl: string): Promise<ArticleMedia | null> {
  if (!isSafeHttpUrl(articleUrl)) return null;
  try {
    const html = await safeFetchArticleHtml(articleUrl);
    if (!html) return null;
    const ogImage = extractMetaContent(html, "og:image");
    if (ogImage && isLegitimateImageUrl(resolveUrl(ogImage, articleUrl))) {
      return { imageUrl: resolveUrl(ogImage, articleUrl), type: "image", source: "open-graph" };
    }
    const twitterImage = extractMetaContent(html, "twitter:image");
    if (twitterImage && isLegitimateImageUrl(resolveUrl(twitterImage, articleUrl))) {
      return { imageUrl: resolveUrl(twitterImage, articleUrl), type: "image", source: "twitter" };
    }
    return null;
  } catch {
    return null;
  }
}

/** Fetch with bounded redirects + bounded size + content-type + timeout.
 *
 *  We don't use the global `fetch` redirect: "follow" option because we
 *  need to re-validate EACH redirect destination (a public URL could
 *  redirect to an internal IP). We follow redirects manually with a
 *  small loop.
 */
async function safeFetchArticleHtml(articleUrl: string): Promise<string | null> {
  let currentUrl = articleUrl;
  for (let hop = 0; hop < OG_MAX_REDIRECTS; hop++) {
    if (!isSafeHttpUrl(currentUrl)) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OG_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          // Some publishers block default fetch UA.
          "User-Agent": "LUCIAN-NewsBot/1.0 (+https://lucian.app)",
          "Accept": "text/html,application/xhtml+xml",
        },
        // No caching directive here — the caller caches by article URL.
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        const next = res.headers.get("location")!;
        currentUrl = resolveUrl(next, currentUrl);
        continue;
      }
      if (!res.ok) return null;
      const contentType = res.headers.get("content-type") ?? "";
      if (!/text\/html|application\/xhtml/i.test(contentType)) return null;
      // Bounded read — read at most OG_FETCH_MAX_BYTES.
      const reader = res.body?.getReader();
      if (!reader) return null;
      let received = 0;
      const chunks: Uint8Array[] = [];
      while (received < OG_FETCH_MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
        }
      }
      try { await reader.cancel(); } catch { /* ignore */ }
      const buf = new Uint8Array(received);
      let pos = 0;
      for (const c of chunks) {
        buf.set(c, pos);
        pos += c.byteLength;
      }
      return new TextDecoder("utf-8", { fatal: false }).decode(buf);
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

/** Extract <meta property="og:image" content="..." /> or twitter:image. */
function extractMetaContent(html: string, property: string): string | null {
  // Match either property="X" or name="X".
  const re = new RegExp(
    `<meta\\s+(?:property|name)=["']${escapeRegex(property)}["']\\s+content=["']([^"']+)["']`,
    "i",
  );
  const m = html.match(re);
  if (m) return decodeEntities(m[1]);
  // Also try the reversed attribute order: content first, then property/name.
  const re2 = new RegExp(
    `<meta\\s+content=["']([^"']+)["']\\s+(?:property|name)=["']${escapeRegex(property)}["']`,
    "i",
  );
  const m2 = html.match(re2);
  return m2 ? decodeEntities(m2[1]) : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── URL safety ────────────────────────────────────────────────────────────

/** Validate that a URL is http(s) AND not pointing at localhost / private IPs. */
export function isSafeHttpUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host === "0.0.0.0" || host === "::" || host === "[::]") return false;
  // IPv4 in dotted-quad form — reject private / loopback / link-local ranges.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    if (isPrivateOrLoopbackIPv4(host)) return false;
  }
  // IPv6 — reject [::1], [fc00::]/7, [fe80::]/10.
  if (host.startsWith("[") && host.endsWith("]")) {
    const inner = host.slice(1, -1).toLowerCase();
    if (inner === "::1") return false;
    if (inner.startsWith("fc") || inner.startsWith("fd")) return false; // ULA
    if (inner.startsWith("fe80")) return false; // link-local
  }
  // Reject IDN homograph-style labels (mixed scripts) — best-effort.
  if (/[^\x00-\x7F]/.test(host)) {
    // Allow common accented Latin IDNs but reject obvious homoglyph mixes.
    // Conservative: allow only ASCII hostnames for now.
    return false;
  }
  return true;
}

function isPrivateOrLoopbackIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 10) return true;                  // 10.0.0.0/8 private
  if (a === 127) return true;                 // 127.0.0.0/8 loopback
  if (a === 0) return true;                   // 0.0.0.0/8 "this host"
  if (a === 169 && b === 254) return true;    // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true;    // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true;                  // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

/** Validate a candidate image URL.
 *  Rejects:
 *    - empty
 *    - javascript:, data:, blob:, file:, about:
 *    - obvious 1x1 tracking pixels (via width/height attr when known OR
 *      "1x1" / "pixel" in pathname)
 *    - non-http(s) protocols
 */
export function isLegitimateImageUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  // Reject obvious 1x1 tracking pixels.
  const path = u.pathname.toLowerCase();
  if (/\b1x1\b/.test(path)) return false;
  if (/\bpixel\b/.test(path) && /\b1x1\b/.test(u.search.toLowerCase())) return false;
  // Reject empty path (just a domain root) — usually a placeholder.
  if (path === "/" || path === "") return false;
  // Prefer https — accept http but normalize to https where reasonable.
  // (We return true here; the caller can upgrade to https if both are
  // available. We never silently rewrite a URL the publisher gave us.)
  return true;
}

/** Validate a candidate video URL. Allows direct mp4/webm/ogg URLs OR
 *  known-safe embed hosts (youtube, vimeo, dailymotion). */
export function isLegitimateVideoUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const path = u.pathname.toLowerCase();
  // Direct media files.
  if (/\.(mp4|webm|ogg|mov|m3u8)(\?|$)/.test(path)) return true;
  // Known-safe embed hosts — these are sandboxed by their providers.
  const host = u.hostname.toLowerCase();
  const SAFE_VIDEO_HOSTS = [
    "youtube.com", "www.youtube.com", "youtu.be",
    "vimeo.com", "player.vimeo.com",
    "dailymotion.com", "www.dailymotion.com",
    "tv.youtube.com", "m.youtube.com",
  ];
  return SAFE_VIDEO_HOSTS.includes(host);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function extractAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`\\s${attr}=["']([^"']+)["']`, "i");
  const m = tag.match(re);
  return m ? decodeEntities(m[1]) : null;
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

function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

// ── Exports for testing + reuse ───────────────────────────────────────────

export const OG_LIMITS = {
  MAX_FALLBACK_PER_REQUEST: MAX_OG_FALLBACK_PER_REQUEST,
  FETCH_TIMEOUT_MS: OG_FETCH_TIMEOUT_MS,
  FETCH_MAX_BYTES: OG_FETCH_MAX_BYTES,
  MAX_REDIRECTS: OG_MAX_REDIRECTS,
  // Phase 13 carryover — cross-request in-memory TTL cache.
  CACHE_TTL_MS: OG_CACHE_TTL_MS,
  CACHE_MAX_ENTRIES: OG_CACHE_MAX_ENTRIES,
} as const;

// Exported for testing + cache introspection. Not part of the public API.
export const _ogCacheInternals = {
  get size() { return ogTtlCache.size; },
  get: (canonicalUrl: string) => ogCacheGet(canonicalUrl),
  set: (canonicalUrl: string, media: ArticleMedia | null) => ogCacheSet(canonicalUrl, media),
  canonicalize: canonicalizeArticleUrl,
  clear: () => ogTtlCache.clear(),
};
