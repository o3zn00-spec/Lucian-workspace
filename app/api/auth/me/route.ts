// LUCIAN Phase 16 — Current user endpoint.
//
// GET /api/auth/me → { user, profile } (401 if unauthenticated)
//
// Derives userId from the authenticated session — never trusts the body.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { AuthError, badRequest, toAuthError } from "@/lib/auth/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    return errorResponse(err as AuthError);
  }
  try {
    const profile = await db.profile.findUnique({
      where: { userId: user.id },
      select: { displayName: true, avatar: true, updatedAt: true },
    });
    const fullUser = await db.user.findUnique({
      where: { id: user.id },
      select: {
        id: true, email: true, username: true, name: true, image: true,
        emailVerified: true, status: true, createdAt: true, updatedAt: true,
        accounts: { select: { provider: true, providerAccountId: true } },
      },
    });
    if (!fullUser) {
      return errorResponse({ ...badRequest("Account not found."), code: "user_not_found", statusCode: 404 } as AuthError);
    }
    return NextResponse.json({
      ok: true,
      user: fullUser,
      profile: profile ?? { displayName: user.name ?? user.email, avatar: null },
    });
  } catch (err) {
    return errorResponse(toAuthError(err));
  }
}

function errorResponse(err: AuthError): NextResponse {
  return NextResponse.json(
    { ok: false, error: err.message, code: err.code },
    { status: err.statusCode },
  );
}
