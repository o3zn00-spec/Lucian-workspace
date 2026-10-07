// LUCIAN Phase 16 — Password hashing utilities.
//
// Uses bcryptjs (pure-JS, Vercel-serverless-safe). Cost factor 12 is a
// reasonable balance between security and login latency on a serverless
// cold start. The hash format includes the salt and cost factor so the
// server can verify against any valid hash without separate config.
//
// SECURITY:
//   - Plain-text passwords are NEVER logged or persisted.
//   - The hash is NEVER returned to the client. API routes select
//     explicit fields and exclude `passwordHash`.
//   - Comparison is constant-time inside bcryptjs.
//
// This module is SERVER-ONLY. Never import from a client component.

import bcrypt from "bcryptjs";

const COST_FACTOR = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST_FACTOR);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export function isPasswordHash(value: string | null | undefined): value is string {
  if (!value) return false;
  return /^\$2[aby]\$\d{2}\$/.test(value);
}
