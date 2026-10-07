// LUCIAN Browser — embed-policy cache (Phase 15).
//
// Client-side LRU cache for embed-policy check results. Bounded + TTL'd
// so we don't repeatedly hit the server for the same URL.
//
// Per spec section 38: cache results for 10–30 minutes, bound entries,
// never cache permanently. We use 15 minutes + 1000 entries.

import type { EmbedPolicy } from "@/store/browser";

interface CacheEntry {
  policy: EmbedPolicy;
  /** When the entry was cached (epoch ms). */
  cachedAt: number;
  /** LRU order — higher = more recently used. */
  order: number;
}

const TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ENTRIES = 1000;

let cache = new Map<string, CacheEntry>();
let lruCounter = 0;

/** Canonical cache key — strips hash + trailing slash, lowercases host.
 *  Two URLs that resolve to the same page should share a cache entry. */
export function cacheKeyFor(url: string): string {
  try {
    const u = new URL(url);
    // Drop hash (irrelevant for embedding). Lowercase host. Normalize
    // trailing slash on pathname.
    const host = u.hostname.toLowerCase();
    let path = u.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return `${u.protocol}//${host}${path}${u.search}`;
  } catch {
    return url;
  }
}

/** Lookup a cached embed-policy result. Returns null if the entry is
 *  stale or missing. Touches the LRU order on hit. */
export function getCachedPolicy(url: string): EmbedPolicy | null {
  const key = cacheKeyFor(url);
  const entry = cache.get(key);
  if (!entry) return null;
  // TTL check.
  if (Date.now() - entry.cachedAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  // LRU touch.
  entry.order = ++lruCounter;
  return entry.policy;
}

/** Store an embed-policy result in the cache. Evicts the
 *  least-recently-used entry when the cache is full. */
export function setCachedPolicy(url: string, policy: EmbedPolicy): void {
  const key = cacheKeyFor(url);
  // Evict if at capacity.
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    // Find the LRU entry (lowest order).
    let lruKey: string | null = null;
    let lruOrder = Infinity;
    for (const [k, v] of cache) {
      if (v.order < lruOrder) {
        lruOrder = v.order;
        lruKey = k;
      }
    }
    if (lruKey) cache.delete(lruKey);
  }
  cache.set(key, {
    policy,
    cachedAt: Date.now(),
    order: ++lruCounter,
  });
}

/** Test hook — clear the cache (for E2E determinism). */
export function _clearEmbedPolicyCacheForTests(): void {
  cache.clear();
  lruCounter = 0;
}

/** Test hook — get current cache size. */
export function _embedPolicyCacheSizeForTests(): number {
  return cache.size;
}
