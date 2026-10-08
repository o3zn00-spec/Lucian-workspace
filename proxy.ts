// LUCIAN Phase 16 — Route protection PROXY (Next.js 16).
//
// Next.js 16 deprecated the `middleware` file convention in favor of
// `proxy`. This file is the exact migration of the former middleware.ts:
// identical matcher, identical route policy, identical Auth.js wrapping.
//
// WHY PROXY (and not just renaming):
//   - The previous middleware.ts imported the full Auth.js config
//     (`@/lib/auth/auth`), which transitively pulls in the Prisma client,
//     the @auth/prisma-adapter, and bcryptjs. Bundled for the EDGE
//     runtime that produced a ~1.04 MB `_middleware` Edge Function —
//     over Vercel's 1 MB plan limit (deployment blocker).
//   - The Next.js 16 `proxy` convention runs on the NODE.JS runtime.
//     Node-compatible modules (Prisma, bcryptjs) no longer get inlined
//     into a size-capped Edge bundle, so the Vercel Edge size limit no
//     longer applies to this interception layer.
//   - Security semantics are PRESERVED (not weakened): the session()
//     callback in auth.ts verifies the JWT's sessionVersion against the
//     database on every authenticated request — that DB check now runs
//     natively in the Node runtime instead of failing in Edge.
//
// Auth.js v5 uses the `auth` middleware factory. We export the wrapped
// proxy that:
//   1. Lets /api/auth/* and public technical routes pass through.
//   2. Redirects unauthenticated users from private LUCIAN routes to
//      /login (preserving the original URL as callbackUrl).
//   3. Redirects authenticated users from /login / /signup /
//      /forgot-password back to / (Home) — unless they explicitly
//      request the recovery page via ?redirect=reset.
//
// Avoid redirect loops by maintaining a clear matcher + per-route logic.

import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { auth } from "@/lib/auth/auth";
import { configuredOwnerEmail } from "@/lib/auth/owner-identity";
import { db } from "@/lib/db";

const AUTH_PAGES = new Set(["/login", "/forgot-password", "/reset-password"]);
const PUBLIC_AUTH_API_PATHS = [
  "/api/auth/callback",
  "/api/auth/csrf",
  "/api/auth/error",
  "/api/auth/providers",
  "/api/auth/session",
  "/api/auth/signin",
  "/api/auth/signout",
  "/api/auth/verify-request",
  "/api/auth/reset-password/request",
  "/api/auth/reset-password/confirm",
  "/api/auth/google-status",
  "/api/auth/email-status",
  "/api/auth/health",
  "/api/auth/signup",
];

async function takeAuthRateLimit(req: { headers: Headers }, scope: string, maximum: number, windowMs: number) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || req.headers.get("x-real-ip")?.trim() || "unavailable";
  const secret = process.env.AUTH_SECRET;
  const now = Date.now();
  if (!secret || !process.env.DATABASE_URL) return { available: false, allowed: false, retryAfter: 60 };
  const windowIndex = Math.floor(now / windowMs);
  const windowStart = new Date(windowIndex * windowMs);
  const expiresAt = new Date((windowIndex + 1) * windowMs);
  const id = createHmac("sha256", secret).update(`${scope}:${address}:${windowIndex}`).digest("hex");
  try {
    const bucket = await db.authRateLimit.upsert({
      where: { id },
      create: { id, scope, count: 1, windowStart, expiresAt },
      update: { count: { increment: 1 } },
      select: { count: true },
    });
    if (bucket.count === 1) {
      await db.authRateLimit.deleteMany({ where: { expiresAt: { lt: new Date(now) }, id: { not: id } } });
    }
    return { available: true, allowed: bucket.count <= maximum, retryAfter: Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000)) };
  } catch {
    return { available: false, allowed: false, retryAfter: 60 };
  }
}

function rateLimited(retryAfter: number) {
  return NextResponse.json(
    { ok: false, error: "Too many authentication attempts. Please wait before trying again.", code: "rate_limited" },
    { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfter) } },
  );
}

function isPathUnderPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

function isPublicAuthApiPath(pathname: string): boolean {
  if (PUBLIC_AUTH_API_PATHS.includes(pathname)) return true;
  return pathname.startsWith("/api/auth/callback/") || pathname.startsWith("/api/auth/signin/");
}

export default auth(async (req) => {
  const { pathname, search } = req.nextUrl;
  if (req.method === "POST" && pathname === "/api/auth/reset-password/request") {
    const attempt = await takeAuthRateLimit(req, "owner-recovery", 5, 60 * 60 * 1000);
    if (!attempt.available) return NextResponse.json({ ok: false, error: "Authentication protection is temporarily unavailable.", code: "auth_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
    if (!attempt.allowed) return rateLimited(attempt.retryAfter);
  }
  if (req.method === "POST" && pathname === "/api/auth/callback/credentials") {
    const attempt = await takeAuthRateLimit(req, "owner-login", 10, 15 * 60 * 1000);
    if (!attempt.available) return NextResponse.json({ ok: false, error: "Authentication protection is temporarily unavailable.", code: "auth_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
    if (!attempt.allowed) return rateLimited(attempt.retryAfter);
  }
  // CRITICAL: must check req.auth?.user?.id (NOT just req.auth) because
  // the session() callback in auth.ts returns a session object even
  // when the JWT is stale (sessionVersion mismatch) — it clears
  // session.user.id to signal "unauthenticated". Checking only req.auth
  // would let stale JWTs through.
  const ownerEmail = configuredOwnerEmail();
  const sessionEmail = req.auth?.user?.email?.toLowerCase();
  const isOwner = !!req.auth?.user?.id && !!ownerEmail && sessionEmail === ownerEmail;
  const isApi = pathname.startsWith("/api/");

  // Public technical routes (OAuth callbacks, webhooks, health) — always pass.
  if (
    isPublicAuthApiPath(pathname) ||
    isPathUnderPrefix(pathname, "/api/vault/webhooks")
  ) {
    return NextResponse.next();
  }

  if (pathname === "/signup") {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?reason=owner-only";
    return NextResponse.redirect(url);
  }

  // Auth pages — redirect authed users to Home unless they're actively
  // performing a recovery (we look at the search string for `?token=`
  // on /reset-password so deep links to a reset don't bounce).
  if (AUTH_PAGES.has(pathname)) {
    if (isOwner && !(pathname === "/reset-password" && search.includes("token="))) {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Public routes (technical routes served statically) — pass.
  // No app routes are public-only beyond auth pages and the API prefixes
  // already handled above.

  // All other routes require auth.
  // For API calls, return a 401 JSON response so the client can handle
  // it gracefully (rather than receiving a redirect to /login).
  if (!isOwner) {
    if (isApi) {
      return new NextResponse(
        JSON.stringify({ ok: false, error: ownerEmail ? "Owner authorization required." : "The LUCIAN owner identity is not configured.", code: ownerEmail ? "owner_required" : "owner_not_configured" }),
        { status: ownerEmail ? 403 : 503, headers: { "Content-Type": "application/json" } },
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?callbackUrl=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
});

export const config = {
  // Run on every navigable route except:
  //   - _next/static, _next/image, favicon, branding, sw.js
  //   - public assets (they're served directly by Next.js)
  matcher: [
    "/((?!\\.well-known/workflow/|_next/static|_next/image|favicon.ico|apple-icon.png|icon.png|branding|auth/guardian-entrance.mp4|auth/guardian-hold.webp|sw.js|manifest.json).*)",
  ],
};
