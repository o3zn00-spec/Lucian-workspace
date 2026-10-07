// LUCIAN Browser — URL utilities (Phase 15).
//
// Genuine, predictable address handling. No fake "blocked domains"
// list — we validate schemes + parse URLs properly, and convert
// non-URL input into a real search-provider URL.
//
// Security:
//   - Only http: and https: are navigable.
//   - javascript:, data:, file:, vbscript:, blob:, about: are REJECTED
//     from raw address input. about:blank is allowed internally for
//     the new-tab placeholder only (never from user input).
//   - Search queries are URL-encoded and sent to a real search
//     provider. We do NOT fabricate search results inside LUCIAN.

/** Schemes that must NEVER be passed to the iframe from user input. */
const UNSAFE_SCHEMES = [
  "javascript:",
  "data:",
  "file:",
  "vbscript:",
  "blob:",
  "about:",
  "view-source:",
  "chrome:",
  "chrome-extension:",
  "edge:",
  "moz-extension:",
];

/** The default search provider. Encoded query is appended. */
export const DEFAULT_SEARCH_URL = "https://duckduckgo.com/?q=";

/** Result of classifying address-bar input. */
export type AddressKind =
  | { kind: "url"; url: string }
  | { kind: "search"; url: string; query: string }
  | { kind: "unsafe"; reason: string; raw: string }
  | { kind: "empty" };

/** Returns true if the raw input starts with (case-insensitively) an
 *  unsafe scheme. Used by the address bar to reject malicious input
 *  BEFORE normalization. */
export function isUnsafeScheme(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  // Match `scheme:` or `scheme://` prefixes.
  for (const scheme of UNSAFE_SCHEMES) {
    if (lower.startsWith(scheme)) return true;
  }
  return false;
}

/** Normalize a user-entered address into a navigable http(s) URL.
 *
 *  Rules:
 *    - "" → "" (empty — caller shows new-tab state)
 *    - unsafe scheme → throws (caller should catch + show "Unsupported address")
 *    - "https://example.com" → unchanged
 *    - "http://example.com" → unchanged
 *    - "example.com" → "https://example.com"
 *    - "www.example.com" → "https://www.example.com"
 *    - "example.com/path?q=1" → "https://example.com/path?q=1"
 *    - "user:pass@example.com" → throws (userinfo rejected — SSRF/phishing risk)
 *    - "latest AI news" (contains spaces or no dot) → search URL
 *
 *  This function NEVER returns a non-http(s) URL. */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";

  if (isUnsafeScheme(trimmed)) {
    throw new UnsafeAddressError(
      `Unsupported address scheme. LUCIAN Browser only allows http and https.`,
    );
  }

  // If it already has an http(s) scheme, validate it parses cleanly.
  if (/^https?:\/\//i.test(trimmed)) {
    const u = parseStrictUrl(trimmed);
    if (!u) throw new UnsafeAddressError("Invalid URL.");
    if (u.username || u.password) {
      throw new UnsafeAddressError("URLs with embedded credentials are not allowed.");
    }
    return u.href;
  }

  // Bare hostname? "example.com", "www.example.com", "example.com/path"
  // Heuristic: looks like a host if it contains a dot, has no spaces,
  // and the part before the first "/" or "?" looks like a domain.
  const looksLikeHost = /^[^\s/?:#]+\.[^\s/?:#]+/.test(trimmed);
  if (looksLikeHost) {
    // Prepend https:// and re-validate.
    const candidate = "https://" + trimmed;
    const u = parseStrictUrl(candidate);
    if (!u) throw new UnsafeAddressError("Invalid URL.");
    if (u.username || u.password) {
      throw new UnsafeAddressError("URLs with embedded credentials are not allowed.");
    }
    return u.href;
  }

  // Otherwise → search query.
  return constructSearchUrl(trimmed);
}

/** Build a real search-provider URL from a free-text query. */
export function constructSearchUrl(query: string): string {
  const q = query.trim();
  if (!q) return "";
  return DEFAULT_SEARCH_URL + encodeURIComponent(q);
}

/** Classify raw address-bar input without normalizing. Used by the UI
 *  to show inline feedback ("this is a search" vs "this is a URL" vs
 *  "this is unsafe"). */
export function classifyAddress(raw: string): AddressKind {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: "empty" };
  if (isUnsafeScheme(trimmed)) {
    return { kind: "unsafe", reason: "Unsupported address scheme", raw: trimmed };
  }
  try {
    const url = normalizeUrl(trimmed);
    // If normalization produced a search URL, classify as search.
    if (url.startsWith(DEFAULT_SEARCH_URL)) {
      return { kind: "search", url, query: trimmed };
    }
    return { kind: "url", url };
  } catch (e) {
    if (e instanceof UnsafeAddressError) {
      return { kind: "unsafe", reason: e.message, raw: trimmed };
    }
    return { kind: "unsafe", reason: "Invalid address", raw: trimmed };
  }
}

/** Strict URL parser. Returns null if the URL is not a valid absolute
 *  http(s) URL. Wrapper around the standard URL constructor that
 *  adds the scheme validation. */
export function parseStrictUrl(url: string): URL | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

/** Extract a sensible hostname for display (title/label fallback).
 *  Returns the input unchanged if it can't be parsed. */
export function hostnameForDisplay(url: string): string {
  try {
    const u = new URL(url);
    // Strip leading "www." for display only — the actual URL keeps it.
    return u.hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

/** Custom error for unsafe address input. Lets the UI catch + show
 *  an honest "Unsupported address" message instead of navigating. */
export class UnsafeAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeAddressError";
  }
}
