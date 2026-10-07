// LUCIAN Browser — embed-policy checker (Phase 15, hardened).
//
// SSRF-safe server-side check that fetches ONLY response headers (never
// the body) to classify whether a URL is likely embeddable in an iframe.
//
// This is NOT a proxy. We do NOT return the page body. We do NOT
// rewrite headers. We do NOT bypass X-Frame-Options or CSP. We simply
// READ the response headers to give the LUCIAN client an honest hint
// about whether the iframe will likely render.
//
// ── SSRF PROTECTION (two layers) ──────────────────────────────────────────
//
// Layer 1 — URL validation (reused from News Phase 13):
//   - http/https only (no file:, javascript:, data:, blob:, etc.)
//   - reject localhost / .localhost
//   - reject literal private/loopback/link-local IPs in the URL
//   - reject IDN homograph-style labels
//   Uses `isSafeHttpUrl()` from `@/lib/news/article-media` — proven,
//   no reinvented rules.
//
// Layer 2 — DNS resolution + IP validation (DNS rebinding-safe):
//   - Resolve ALL IPv4 + IPv6 addresses for each hostname.
//   - Reject if ANY resolved address is loopback/private/link-local/
//     CGNAT/reserved/multicast/ULA.
//   - Re-check DNS for EVERY redirect hostname (each redirect creates
//     a new request with a fresh `safeLookup` call).
//   - DNS rebinding protection: `safeLookup` is passed as the `lookup`
//     option to Node's `http.request()`/`https.request()`. It resolves
//     + validates AT CONNECTION TIME, so the validated IP IS the IP
//     used for the TCP connection — closing the TOCTOU gap.
//
// ── OTHER PROTECTIONS ─────────────────────────────────────────────────────
//
//   - Bounded redirects (3 hops) — each re-validated via isSafeHttpUrl
//     + safeLookup (DNS re-checked per hop).
//   - Short timeout (5s) on socket.
//   - Headers-only: response body destroyed immediately after headers.
//   - No credential forwarding (no Cookie header sent).
//   - No arbitrary custom headers (only UA + Accept).
//   - Server-side cache: bounded LRU (500 entries, 10min TTL).
//
// ── CLASSIFICATION ────────────────────────────────────────────────────────
//
//   - X-Frame-Options: DENY → blocked
//   - X-Frame-Options: SAMEORIGIN (third-party context) → blocked
//   - CSP frame-ancestors 'none' → blocked
//   - CSP frame-ancestors 'self' (third-party context) → blocked
//   - CSP frame-ancestors * → potentially-embeddable
//   - No explicit blocking header → unknown (NOT "allowed")
//
// Per spec section 16: we NEVER claim "embedding allowed" merely because
// XFO/CSP was absent. The most we say is "potentially-embeddable" or
// "unknown".

import { NextRequest, NextResponse } from "next/server";
import { request as httpsRequest } from "node:https";
import { request as httpRequest, type RequestOptions } from "node:http";
import { isSafeHttpUrl } from "@/lib/news/article-media";
import { safeLookup, BlockedAddressError } from "@/lib/browser/ssrf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 5000;

// ── Server-side cache ────────────────────────────────────────────────────
//
// Bounded LRU cache. Stores embed-policy results by canonical URL so
// repeated checks for the same URL don't re-fetch. Per spec section 39:
// cache by canonical URL/hostname, bounded, never permanent.
// TTL: 10 minutes. Max entries: 500.

const SERVER_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SERVER_CACHE_MAX = 500;

interface CacheEntry {
  result: EmbedPolicyResult;
  expiry: number;
}

const SERVER_CACHE = new Map<string, CacheEntry>();

/** Canonical cache key: lowercase host, strip trailing slash, drop hash. */
function canonicalCacheKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    let path = u.pathname;
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    return `${u.protocol}//${host}${path}${u.search}`;
  } catch {
    return url;
  }
}

function getCachedResult(url: string): EmbedPolicyResult | null {
  const key = canonicalCacheKey(url);
  const entry = SERVER_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiry) {
    SERVER_CACHE.delete(key);
    return null;
  }
  // LRU touch: re-insert to move to end (most recently used).
  SERVER_CACHE.delete(key);
  SERVER_CACHE.set(key, entry);
  return entry.result;
}

function setCachedResult(url: string, result: EmbedPolicyResult): void {
  const key = canonicalCacheKey(url);
  // Evict oldest if at capacity.
  if (SERVER_CACHE.size >= SERVER_CACHE_MAX && !SERVER_CACHE.has(key)) {
    const oldestKey = SERVER_CACHE.keys().next().value;
    if (oldestKey) SERVER_CACHE.delete(oldestKey);
  }
  SERVER_CACHE.set(key, { result, expiry: Date.now() + SERVER_CACHE_TTL_MS });
}

// ── Result type ───────────────────────────────────────────────────────────

interface EmbedPolicyResult {
  state: "blocked" | "potentially-embeddable" | "unknown" | "error";
  reason: string;
  finalUrl?: string;
  xFrameOptions?: string;
  contentSecurityPolicy?: string;
  contentType?: string;
  checkedAt: number;
  /** True if the result was served from the server-side cache. */
  cached?: boolean;
}

// ── Header-only fetch with DNS rebinding protection ────────────────────────
//
// Uses Node's `http.request`/`https.request` (NOT `fetch()`) so we can
// pass a custom `lookup` function that validates DNS at connection time.
// `fetch()` (undici) doesn't support custom DNS lookup easily.

interface FetchedHeaders {
  status: number;
  headers: Record<string, string | undefined>;
  location?: string;
}

function fetchHeadersOnly(url: string): Promise<FetchedHeaders> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";

    const options: RequestOptions = {
      method: "GET",
      headers: {
        "User-Agent": "LUCIAN-Browser-PolicyBot/1.0 (+https://lucian.app)",
        "Accept": "text/html,application/xhtml+xml",
      },
      // Custom DNS lookup: resolves + validates ALL addresses at
      // connection time. This IS the IP used for the TCP connection.
      lookup: safeLookup,
      timeout: FETCH_TIMEOUT_MS,
    };

    const callback = (res: import("node:http").IncomingMessage): void => {
      // Destroy the response body immediately — we only want headers.
      res.destroy();
      const headers: Record<string, string | undefined> = {};
      // Node's IncomingHttpHeaders uses lowercase keys.
      const rawHeaders = res.headers as Record<string, string | string[] | undefined>;
      for (const [key, value] of Object.entries(rawHeaders)) {
        headers[key] = Array.isArray(value) ? value[0] : value;
      }
      resolve({
        status: res.statusCode ?? 0,
        headers,
        location: headers.location,
      });
    };

    const req = isHttps
      ? httpsRequest(url, options, callback)
      : httpRequest(url, options, callback);

    req.on("error", (err: NodeJS.ErrnoException) => {
      reject(err);
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });

    req.end();
  });
}

// ── Main handler ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const urlParam = req.nextUrl.searchParams.get("url");
  if (!urlParam) {
    return NextResponse.json(
      { state: "error", reason: "Missing url parameter", checkedAt: Date.now() } satisfies EmbedPolicyResult,
      { status: 400 },
    );
  }

  // Check server-side cache first.
  const cached = getCachedResult(urlParam);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true });
  }

  // ── Layer 1: URL validation (reused from News Phase 13) ──────────────
  if (!isSafeHttpUrl(urlParam)) {
    const result: EmbedPolicyResult = {
      state: "blocked",
      reason: "URL failed safety validation (scheme/IP not allowed)",
      checkedAt: Date.now(),
    };
    setCachedResult(urlParam, result);
    return NextResponse.json(result);
  }

  // ── Layer 2: DNS-safe fetch with bounded redirects ───────────────────
  let currentUrl = urlParam;
  let finalHeaders: FetchedHeaders | null = null;

  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    // Re-validate URL at every hop.
    if (!isSafeHttpUrl(currentUrl)) {
      const result: EmbedPolicyResult = {
        state: "blocked",
        reason: "Redirect target failed safety validation",
        finalUrl: currentUrl,
        checkedAt: Date.now(),
      };
      setCachedResult(urlParam, result);
      return NextResponse.json(result);
    }

    try {
      const fetched = await fetchHeadersOnly(currentUrl);

      // 3xx → follow the Location header (bounded). DNS is re-checked
      // at the next hop because `safeLookup` runs inside the new request.
      if (fetched.status >= 300 && fetched.status < 400 && fetched.location) {
        currentUrl = new URL(fetched.location, currentUrl).href;
        continue;
      }

      // Non-redirect response → we have the headers.
      finalHeaders = fetched;
      break;
    } catch (err: unknown) {
      // Distinguish SSRF-blocked addresses from network failures.
      const errMsg = err instanceof Error ? err.message : String(err);
      if (err instanceof BlockedAddressError || errMsg.includes("blocked address")) {
        const result: EmbedPolicyResult = {
          state: "blocked",
          reason: `URL resolved to a blocked address (private/loopback/internal). ${errMsg}`,
          finalUrl: currentUrl,
          checkedAt: Date.now(),
        };
        setCachedResult(urlParam, result);
        return NextResponse.json(result);
      }
      // Network/timeout/DNS failure → unknown (conservative).
      const result: EmbedPolicyResult = {
        state: "unknown",
        reason: `Policy check failed: ${errMsg}`,
        finalUrl: currentUrl,
        checkedAt: Date.now(),
      };
      setCachedResult(urlParam, result);
      return NextResponse.json(result);
    }
  }

  if (!finalHeaders) {
    const result: EmbedPolicyResult = {
      state: "unknown",
      reason: `Exceeded ${MAX_REDIRECTS} redirects`,
      finalUrl: currentUrl,
      checkedAt: Date.now(),
    };
    setCachedResult(urlParam, result);
    return NextResponse.json(result);
  }

  // ── Read response headers + classify ──────────────────────────────────
  const xfo = finalHeaders.headers["x-frame-options"];
  const csp = finalHeaders.headers["content-security-policy"];
  const contentType = finalHeaders.headers["content-type"] ?? "";

  // X-Frame-Options classification.
  if (xfo) {
    const xfoLower = xfo.toLowerCase().trim();
    if (xfoLower === "deny") {
      const result: EmbedPolicyResult = {
        state: "blocked",
        reason: "Site sends X-Frame-Options: DENY — refuses iframe embedding.",
        finalUrl: currentUrl,
        xFrameOptions: xfo,
        contentSecurityPolicy: csp,
        checkedAt: Date.now(),
      };
      setCachedResult(urlParam, result);
      return NextResponse.json(result);
    }
    if (xfoLower === "sameorigin") {
      const result: EmbedPolicyResult = {
        state: "blocked",
        reason: "Site sends X-Frame-Options: SAMEORIGIN — only same-origin iframes can embed it.",
        finalUrl: currentUrl,
        xFrameOptions: xfo,
        contentSecurityPolicy: csp,
        checkedAt: Date.now(),
      };
      setCachedResult(urlParam, result);
      return NextResponse.json(result);
    }
    // "allow-all" or other rare values → fall through.
  }

  // CSP frame-ancestors classification.
  if (csp) {
    const faMatch = csp.match(/frame-ancestors\s+([^;]+)/i);
    if (faMatch) {
      const faValue = faMatch[1].trim();
      const faLower = faValue.toLowerCase();
      if (faLower === "'none'") {
        const result: EmbedPolicyResult = {
          state: "blocked",
          reason: "Site sends Content-Security-Policy: frame-ancestors 'none'.",
          finalUrl: currentUrl,
          xFrameOptions: xfo,
          contentSecurityPolicy: csp,
          checkedAt: Date.now(),
        };
        setCachedResult(urlParam, result);
        return NextResponse.json(result);
      }
      if (faLower === "'self'") {
        const result: EmbedPolicyResult = {
          state: "blocked",
          reason: "Site sends CSP frame-ancestors 'self' — only same-origin iframes can embed it.",
          finalUrl: currentUrl,
          xFrameOptions: xfo,
          contentSecurityPolicy: csp,
          checkedAt: Date.now(),
        };
        setCachedResult(urlParam, result);
        return NextResponse.json(result);
      }
      if (faValue === "*") {
        const result: EmbedPolicyResult = {
          state: "potentially-embeddable",
          reason: "Site sends CSP frame-ancestors * — embedding likely permitted (but not guaranteed).",
          finalUrl: currentUrl,
          xFrameOptions: xfo,
          contentSecurityPolicy: csp,
          checkedAt: Date.now(),
        };
        setCachedResult(urlParam, result);
        return NextResponse.json(result);
      }
      // Explicit source list — conservative: treat as blocked.
      const result: EmbedPolicyResult = {
        state: "blocked",
        reason: `Site sends CSP frame-ancestors with an explicit source list — embedding restricted to: ${faValue}`,
        finalUrl: currentUrl,
        xFrameOptions: xfo,
        contentSecurityPolicy: csp,
        checkedAt: Date.now(),
      };
      setCachedResult(urlParam, result);
      return NextResponse.json(result);
    }
  }

  // No explicit blocking header → unknown (NOT "allowed").
  const result: EmbedPolicyResult = {
    state: "unknown",
    reason: "No explicit frame-blocking header found. Embedding is not guaranteed — the site may still block iframe rendering for other reasons (authentication, browser policy, COEP, etc.).",
    finalUrl: currentUrl,
    xFrameOptions: xfo,
    contentSecurityPolicy: csp,
    contentType,
    checkedAt: Date.now(),
  };
  setCachedResult(urlParam, result);
  return NextResponse.json(result);
}
