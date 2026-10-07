// LUCIAN Phase 16 — Password reset confirm endpoint.
//
// POST /api/auth/reset-password/confirm
//   { token, newPassword, confirmPassword }
//
// Server flow:
//   1. Validate new password (length + letter + digit requirements).
//   2. Hash the token (SHA-256) — the DB stores the hash, not raw.
//   3. Look up the token row by hash.
//   4. Reject if: not found (invalid), usedAt set (one-time use), or
//      expiresAt past (expired).
//   5. Hash the new password with bcryptjs.
//   6. In a transaction: update User.passwordHash + mark token usedAt.
//   7. Optionally invalidate ALL other sessions for this user (delete
//    all Session rows for the userId) so any compromised session is
//    also killed.
//   8. Return success.
//
// The token is one-time use — the transaction marks `usedAt` so any
// further use is rejected with reset_token_used.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import {
  isValidPassword,
  validatePasswordDetailed,
} from "@/lib/auth/validation";
import {
  AuthError,
  badRequest,
  weakPassword,
  passwordMismatch,
  resetTokenInvalid,
  resetTokenExpired,
  resetTokenUsed,
  toAuthError,
} from "@/lib/auth/errors";
import { configuredOwnerEmail } from "@/lib/auth/owner-identity";

export const dynamic = "force-dynamic";

interface ConfirmBody {
  token?: unknown;
  newPassword?: unknown;
  confirmPassword?: unknown;
}

class ResetTokenClaimError extends Error {}

export async function POST(req: Request) {
  let body: ConfirmBody;
  try {
    body = await req.json() as ConfirmBody;
  } catch {
    return errorResponse(badRequest("Invalid request body."));
  }

  const token = String(body.token ?? "");
  const newPassword = String(body.newPassword ?? "");
  const confirmPassword = String(body.confirmPassword ?? "");

  if (!token) return errorResponse(resetTokenInvalid());
  const pwErr = validatePasswordDetailed(newPassword);
  if (pwErr) return errorResponse(weakPassword(pwErr.message));
  if (newPassword !== confirmPassword) return errorResponse(passwordMismatch());

  if (!process.env.DATABASE_URL) {
    return errorResponse({
      code: "database_unavailable",
      message: "The database is temporarily unavailable. Please try again.",
      statusCode: 503,
      name: "AuthError",
    } as AuthError);
  }

  try {
    const hashedToken = await sha256Hex(token);
    const tokenRow = await db.passwordResetToken.findUnique({
      where: { token: hashedToken },
      select: {
        id: true, userId: true, usedAt: true, expiresAt: true,
        user: { select: { email: true, status: true } },
      },
    });

    if (!tokenRow) return errorResponse(resetTokenInvalid());
    const ownerEmail = configuredOwnerEmail();
    if (!ownerEmail || tokenRow.user.email !== ownerEmail || tokenRow.user.status !== "active") {
      return errorResponse(resetTokenInvalid());
    }
    if (tokenRow.usedAt) return errorResponse(resetTokenUsed());
    if (tokenRow.expiresAt.getTime() < Date.now()) {
      return errorResponse(resetTokenExpired());
    }

    // Update password + mark token used + bump sessionVersion in a
    // single transaction. Bumping sessionVersion invalidates EVERY
    // existing JWT for this user (across all browsers/devices) on the
    // next authenticated request — that's the JWT equivalent of
    // "delete all sessions". The user must sign in again with the new
    // password.
    const newHash = await hashPassword(newPassword);
    await db.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: tokenRow.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new ResetTokenClaimError();
      await tx.user.update({
        where: { id: tokenRow.userId },
        data: {
          passwordHash: newHash,
          sessionVersion: { increment: 1 },
        },
      });
    });

    return NextResponse.json({ ok: true, message: "Your password has been updated. Please sign in." });
  } catch (err) {
    if (err instanceof ResetTokenClaimError) return errorResponse(resetTokenUsed());
    return errorResponse(toAuthError(err));
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

function errorResponse(err: AuthError): NextResponse {
  return NextResponse.json(
    { ok: false, error: err.message, code: err.code },
    { status: err.statusCode },
  );
}

void isValidPassword; // exported via validation module
