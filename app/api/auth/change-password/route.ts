// LUCIAN Phase 16 — Change password (authenticated).
//
// POST /api/auth/change-password
//   { currentPassword, newPassword, confirmPassword }
//
// Server flow:
//   1. Require an authenticated session (401 if none).
//   2. Verify currentPassword against User.passwordHash.
//   3. Validate newPassword against strength rules.
//   4. Hash newPassword, update User.passwordHash.
//   5. Bump User.sessionVersion. Because the JWT carries the sessionVersion
//      that was current at sign-in, EVERY existing JWT for this user
//      (across all browsers/devices) becomes invalid on the next
//      authenticated server resolution. This is the JWT equivalent of
//      "sign out all other sessions" — it also signs out the current one.
//      The user is prompted to sign in again with the new password.
//   6. Return success — the client clears the local session and redirects
//      to /login.
//
// Returns 401 if the current password is wrong (invalid_credentials),
// NOT "user not found" — we don't reveal account state.
//
// IMPORTANT: We do NOT pretend to revoke only "other sessions". Under the
// JWT strategy, we cannot distinguish the current browser from another
// device's JWT. We bump the version (revoking ALL JWTs) and the client
// signs out + redirects to login. This is the honest, correct behavior.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { validatePasswordDetailed } from "@/lib/auth/validation";
import { requireUserId } from "@/lib/auth/session";
import {
  AuthError,
  invalidCredentials,
  weakPassword,
  passwordMismatch,
  unauthorized,
  toAuthError,
} from "@/lib/auth/errors";

export const dynamic = "force-dynamic";

interface ChangePasswordBody {
  currentPassword?: unknown;
  newPassword?: unknown;
  confirmPassword?: unknown;
}

export async function POST(req: Request) {
  let body: ChangePasswordBody;
  try {
    body = await req.json() as ChangePasswordBody;
  } catch {
    return errorResponse({ ...unauthorized(), message: "Invalid request body." } as AuthError);
  }

  let userId: string;
  try {
    userId = await requireUserId();
  } catch (err) {
    return errorResponse(err as AuthError);
  }

  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");
  const confirmPassword = String(body.confirmPassword ?? "");

  if (!currentPassword) return errorResponse(invalidCredentials());
  const pwErr = validatePasswordDetailed(newPassword);
  if (pwErr) return errorResponse(weakPassword(pwErr.message));
  if (newPassword !== confirmPassword) return errorResponse(passwordMismatch());

  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, status: true, sessionVersion: true },
    });
    if (!user || user.status === "disabled" || !user.passwordHash) {
      return errorResponse(invalidCredentials());
    }
    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) return errorResponse(invalidCredentials());

    const newHash = await hashPassword(newPassword);
    // Atomically: update password hash + bump sessionVersion so every
    // previously-issued JWT (this browser + any other browser) is
    // rejected on its next authenticated request.
    await db.user.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
        sessionVersion: { increment: 1 },
      },
    });

    return NextResponse.json({
      ok: true,
      message: "Password updated. Please sign in with your new password.",
      // Tells the client to clear the local session and redirect to /login.
      // The current JWT becomes invalid on the next request because
      // sessionVersion no longer matches.
      signOutRequired: true,
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
