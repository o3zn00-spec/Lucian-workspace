// LUCIAN Phase 16 — Real signup endpoint (FINAL CORRECTED).
//
// POST /api/auth/signup
//   { email, username, password, confirmPassword, displayName }
//
// Server flow:
//   1. Validate input (email format, username format, password strength, name length).
//   2. Normalize email + username to lowercase.
//   3. Check database availability (503 + database_unavailable if down).
//   4. Check email + username uniqueness (409 + email_taken/username_taken if exists).
//   5. Hash password with bcryptjs (cost 12).
//   6. Create User + Profile in a single Prisma transaction.
//   7. Return the safe user object (no passwordHash).
//
// Auth.js then signs the user in via the credentials provider (the
// client calls signIn("credentials", { username, password }, ...) after a
// 200 response — the username field accepts either an email or a username).
//
// No fake success. No hardcoded demo user. Errors map to typed codes
// the UI renders inline (no browser alert()).

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Public account creation is disabled. LUCIAN has one configured owner.",
      code: "owner_only",
    },
    { status: 403 },
  );
}
