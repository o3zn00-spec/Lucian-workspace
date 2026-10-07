// LUCIAN Phase 16 — Profile update endpoint.
//
// PATCH /api/auth/profile
//   { displayName?, avatar? }
//
// Authenticated. Derives userId from the session, never the body.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/session";
import { isValidDisplayName } from "@/lib/auth/validation";
import { AuthError, badRequest, toAuthError, unauthorized } from "@/lib/auth/errors";

export const dynamic = "force-dynamic";

interface ProfilePatchBody {
  displayName?: unknown;
  avatar?: unknown;
}

export async function PATCH(req: Request) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (err) {
    return errorResponse(err as AuthError);
  }

  let body: ProfilePatchBody;
  try {
    body = await req.json() as ProfilePatchBody;
  } catch {
    return errorResponse(badRequest("Invalid request body."));
  }

  const displayName = String(body.displayName ?? "").trim();
  const avatar = body.avatar === null || body.avatar === undefined
    ? undefined
    : String(body.avatar);

  if (!isValidDisplayName(displayName)) {
    return errorResponse(badRequest("Please enter a display name (1–64 characters)."));
  }

  try {
    const profile = await db.profile.upsert({
      where: { userId },
      create: { userId, displayName, avatar: avatar ?? null },
      update: { displayName, ...(avatar !== undefined ? { avatar } : {}) },
      select: { displayName: true, avatar: true, updatedAt: true },
    });

    // Also update User.name so search / notifications see the new name.
    await db.user.update({
      where: { id: userId },
      data: { name: displayName, ...(avatar !== undefined ? { image: avatar } : {}) },
    }).catch(() => { /* non-fatal — profile is the source of truth */ });

    return NextResponse.json({ ok: true, profile });
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

void unauthorized;
