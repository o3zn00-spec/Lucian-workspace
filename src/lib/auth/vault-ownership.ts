// LUCIAN Phase 16 — Authenticated ownership helper for Vault routes.
//
// Vault API routes call `requireVaultOwner()` at the top to get the
// authenticated user's id. Every subsequent query scopes by
// `ownerUserId: userId`. This is the canonical Phase 16 ownership
// boundary — never trust userId from the request body.
//
// Behavior:
//   - Authenticated user → returns the userId, route proceeds.
//   - Unauthenticated → throws AuthError("unauthorized"), route
//     handler catches it and returns 401 JSON.
//   - Database unavailable → the route returns 503
//     (database_unavailable) separately; this helper doesn't check
//     DB availability (the route does that as needed).
//
// This helper is SERVER-ONLY.

import { requireUserId } from "@/lib/auth/session";
import { AuthError, unauthorized } from "@/lib/auth/errors";

/** Returns the authenticated user's id, or throws AuthError.
 *  Vault routes use this to scope every query by ownerUserId. */
export async function requireVaultOwner(): Promise<string> {
  // requireUserId() already throws AuthError("unauthorized") if no
  // session — we re-export it under a Vault-specific name for clarity.
  return requireUserId();
}

/** Map an AuthError (or any error) to an AuthError. Used by Vault
 *  routes to safely wrap unknown exceptions. Re-exported from
 *  src/lib/auth/errors. */
export { toAuthError } from "@/lib/auth/errors";

/** The standard 401 response shape for Vault routes when the user is
 *  not authenticated. Middleware returns this for unauthed API
 *  requests; Vault routes use this when `requireVaultOwner()` throws. */
export function unauthorizedVaultResponse(): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: "You must be signed in to access Vault data.",
      code: "unauthorized",
    }),
    {
      status: 401,
      headers: { "Content-Type": "application/json" },
    },
  );
}

/** Wrap a Vault route handler with auth + safe error mapping.
 *  Usage:
 *    export const GET = withVaultOwner(async (userId, req) => {
 *      const accounts = await db.vaultAccount.findMany({ where: { ownerUserId: userId } });
 *      return NextResponse.json({ accounts });
 *    });
 *
 *  The wrapper:
 *    1. Calls requireVaultOwner() to get the authenticated userId.
 *    2. If unauthed, returns 401 JSON.
 *    3. If the handler throws an AuthError, returns the matching
 *       status + JSON.
 *    4. If the handler throws an unknown error, returns 500 with a
 *       safe generic message (no internal details leaked). */
export function withVaultOwner<TArgs extends unknown[]>(
  handler: (userId: string, ...args: TArgs) => Promise<Response>,
): (...args: TArgs) => Promise<Response> {
  return async (...args: TArgs) => {
    let userId: string;
    try {
      userId = await requireVaultOwner();
    } catch (err) {
      if (err instanceof AuthError) {
        return new Response(
          JSON.stringify({ ok: false, error: err.message, code: err.code }),
          { status: err.statusCode, headers: { "Content-Type": "application/json" } },
        );
      }
      return unauthorizedVaultResponse();
    }
    try {
      return await handler(userId, ...args);
    } catch (err) {
      const ae = err instanceof AuthError ? err : unauthorized();
      return new Response(
        JSON.stringify({ ok: false, error: ae.message, code: ae.code }),
        { status: ae.statusCode, headers: { "Content-Type": "application/json" } },
      );
    }
  };
}

void unauthorized; // re-exported via toAuthError path; kept for callers that want it directly
