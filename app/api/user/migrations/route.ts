// LUCIAN Phase 16 — Migration status endpoint (alias for /api/user/migrations).
//
// GET /api/user/migrations → migration state per category for this user.
//
// Used by the post-login migration prompt to decide whether to show the
// "LUCIAN found data stored on this device" prompt.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/session";
import { AuthError, toAuthError } from "@/lib/auth/errors";

export const dynamic = "force-dynamic";

const MIGRATION_VERSION = 1;

export async function GET() {
  let userId: string;
  try { userId = await requireUserId(); }
  catch (err) { return errorResponse(err as AuthError); }

  try {
    const migrations = await db.userDataMigration.findMany({
      where: { userId, version: MIGRATION_VERSION },
    });
    return NextResponse.json({
      ok: true,
      version: MIGRATION_VERSION,
      migrations: migrations.map(m => ({
        category: m.category,
        status: m.status,
        recordCount: m.recordCount,
        migratedAt: m.migratedAt,
      })),
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
