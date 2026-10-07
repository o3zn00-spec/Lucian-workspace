// LUCIAN Phase 16 — Server-side session helpers.
//
// Wraps Auth.js's `auth()` for use in server components and route
// handlers. Provides:
//   - getCurrentUser() : the authenticated user, or null.
//   - requireUser()    : the authenticated user, or throws AuthError.
//   - requireUserId()  : the authenticated user's id, or throws AuthError.
//
// `requireUserId()` is the canonical entry point for ownership queries.
// Never trust userId from the request body — derive it from the session
// instead.
//
// This module is SERVER-ONLY.

import { auth } from "@/lib/auth/auth";
import { unauthorized } from "@/lib/auth/errors";
import { AuthError } from "@/lib/auth/errors";
import { configuredOwnerEmail } from "@/lib/auth/owner-identity";
import { db } from "@/lib/db";

/** The authenticated user shape returned by `auth()`, minus the unsafe
 *  fields. This is what every server component / route handler should
 *  use as the "current user" — never read User.passwordHash, etc. */
export interface SessionUser {
  id: string;
  email: string;
  username: string | null;
  name: string | null;
  image: string | null;
  emailVerified: Date | null;
  status: string;
}

/** Get the current authenticated user, or null if no session.
 *  Returns null gracefully (does NOT throw on missing session). */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user) return null;
  const u = session.user as { id?: string; status?: string; email?: string | null; name?: string | null; image?: string | null; emailVerified?: Date | null };
  if (!u.id || !u.email) return null;
  // `username` is not on the JWT — fetch from DB if needed by callers.
  // Most callers only need id + email + status, so we don't add a DB
  // lookup here. Callers that need username should hit /api/auth/me.
  return {
    id: u.id,
    email: u.email,
    username: null,
    name: u.name ?? null,
    image: u.image ?? null,
    emailVerified: u.emailVerified ?? null,
    status: u.status ?? "active",
  };
}

/** Require an authenticated user. Throws AuthError("unauthorized")
 *  if there is no session. Use this in route handlers to guard
 *  authenticated endpoints. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  const ownerEmail = configuredOwnerEmail();
  if (!ownerEmail) {
    throw new AuthError("unauthorized", "The LUCIAN owner identity is not configured.", 503);
  }
  if (!user || user.email.toLowerCase() !== ownerEmail) throw unauthorized();
  const owner = await db.user.findUnique({
    where: { email: ownerEmail },
    select: { id: true, status: true },
  });
  if (!owner || owner.id !== user.id || owner.status !== "active") throw unauthorized();
  return user;
}

/** Require an authenticated user and return their id. This is the
 *  canonical userId for all ownership queries. */
export async function requireUserId(): Promise<string> {
  const user = await requireUser();
  return user.id;
}

/** Returns true if there is an authenticated session. Use this in
 *  server components that adapt their UI to auth state without
 *  needing the full user object.
 *
 *  CRITICAL: must check session?.user?.id (NOT just session?.user)
 *  because the session() callback in auth.ts returns a session
 *  object even when the JWT is stale (sessionVersion mismatch) —
 *  it clears session.user.id to signal "unauthenticated". Without
 *  the id check, stale JWTs would appear authenticated here. */
export async function isAuthenticated(): Promise<boolean> {
  try {
    await requireUser();
    return true;
  } catch {
    return false;
  }
}
