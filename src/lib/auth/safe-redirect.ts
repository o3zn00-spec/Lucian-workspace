// LUCIAN Phase 16 — Safe redirect helper.
//
// All client-side navigations that use a `callbackUrl` query parameter
// (or any user-controlled redirect target) MUST be sanitized through
// `sanitizeCallbackUrl`. This prevents open-redirect attacks where a
// malicious link like:
//
//   /login?callbackUrl=https://evil.example
//   /login?callbackUrl=javascript:alert(document.cookie)
//   /login?callbackUrl=//evil.example
//
// would otherwise redirect the user to an attacker-controlled page.
//
// ALLOWED: internal app routes only.
//   - Must start with a single "/"
//   - Must NOT start with "//" (protocol-relative URL → external host)
//   - Must NOT start with "/\" (backslash normalization attack)
//   - Must NOT contain a ":" before the first "/" (scheme like javascript:)
//
// REJECTED → defaults to "/" (the LUCIAN home route).
//
// Auth.js's own redirect callback already validates callbackUrl, but we
// apply an additional defense-in-depth layer on the client side because
// the auth-card navigates via router.push(callbackUrl) BEFORE Auth.js's
// redirect callback runs.

const SAFE_INTERNAL_RE = /^\/(?!\/|\\)[^:?]*$/;

/** Returns a sanitized callback URL. If the input is anything other than
 *  a safe internal LUCIAN route, returns "/" instead.
 *
 *  Examples:
 *    sanitizeCallbackUrl("/")          → "/"
 *    sanitizeCallbackUrl("/settings")  → "/settings"
 *    sanitizeCallbackUrl("/dev-workspace?tab=code") → "/dev-workspace?tab=code"
 *    sanitizeCallbackUrl("https://evil.example") → "/"
 *    sanitizeCallbackUrl("//evil.example")       → "/"
 *    sanitizeCallbackUrl("javascript:alert(1)") → "/"
 *    sanitizeCallbackUrl("")                     → "/"
 *    sanitizeCallbackUrl(null)                   → "/"
 */
export function sanitizeCallbackUrl(input: string | null | undefined): string {
  if (!input) return "/";
  if (typeof input !== "string") return "/";
  // Trim whitespace — never allow leading whitespace tricks.
  const trimmed = input.trim();
  if (!trimmed) return "/";
  // Must start with "/" and not "//" or "/\".
  if (!trimmed.startsWith("/")) return "/";
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return "/";
  // Reject anything with a scheme prefix before the first "/".
  // (Internal routes never have ":" before the first "/".)
  const firstSlash = trimmed.indexOf("/");
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx !== -1 && (firstSlash === -1 || colonIdx < firstSlash)) return "/";
  // Reject `javascript:` / `data:` schemes anywhere in the prefix.
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return "/";
  // Final regex check — strict whitelist of internal-only paths.
  // Strip the query/fragment before matching so paths like
  // "/settings?foo=bar" pass.
  const pathOnly = trimmed.split("#")[0]?.split("?")[0] ?? trimmed;
  if (!SAFE_INTERNAL_RE.test(pathOnly)) return "/";
  // Disallow backslashes anywhere (browsers normalize them to slashes,
  // which can change semantics).
  if (trimmed.includes("\\")) return "/";
  return trimmed;
}
