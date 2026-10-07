// LUCIAN Phase 16 — Local → server data migration API.
//
// GET  /api/user/migrations  → list this user's migration state per category
// POST /api/user/migrate     → import eligible local data to the server
//
// Migration flow:
//   1. Client sends the local data it wants to migrate (chats,
//      notifications, agent memory, saved items) along with a
//      `version` (so we can re-migrate when schemas change).
//   2. Server checks UserDataMigration for each category:
//      - If (userId, category, version) is "complete" → skip (don't duplicate)
//      - If "skipped" → respect the user's choice (don't migrate)
//      - Otherwise → import the data, deduping by id/title/dedupeKey.
//   3. Server creates / updates a UserDataMigration row for each
//      category with the count + status.
//
// Honesty rules:
//   - The user can choose "Keep Local Only" (POST /api/user/migrate
//     with { action: "skip", categories: [...] }) — we record
//     status="skipped" so the prompt doesn't reappear.
//   - The user can choose "Add Eligible Data to My Account" (POST
//     /api/user/migrate with { action: "import", payload: {...}}).
//   - The endpoint NEVER silently uploads sensitive/local content
//     (DevWorkspace project files are NOT migrated — those stay in
//     IndexedDB). Only the categories the client explicitly sends
//     are imported.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/session";
import { AuthError, badRequest, toAuthError } from "@/lib/auth/errors";

export const dynamic = "force-dynamic";

const MIGRATION_VERSION = 1;

const VALID_CATEGORIES = [
  "notifications",
  "saved-items",
] as const;
type Category = (typeof VALID_CATEGORIES)[number];

function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (VALID_CATEGORIES as readonly string[]).includes(v);
}

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

interface MigrateBody {
  action?: unknown;     // "import" | "skip"
  categories?: unknown;
  payload?: unknown;
}

interface ImportPayload {
  notifications?: Array<{ source: string; title: string; message: string; level?: string; actionable?: boolean; dedupeKey?: string | null; entityRef?: string | null; deepLink?: string | null; createdAt?: string }>;
  "saved-items"?: Array<{ source: string; type: string; refId: string; title: string; data?: unknown }>;
}

export async function POST(req: Request) {
  let userId: string;
  try { userId = await requireUserId(); }
  catch (err) { return errorResponse(err as AuthError); }

  let body: MigrateBody;
  try { body = await req.json() as MigrateBody; }
  catch { return errorResponse(badRequest("Invalid body.")); }

  const action = String(body.action ?? "");
  if (!Array.isArray(body.categories)) {
    return errorResponse(badRequest("categories must be an array."));
  }
  const categories = (body.categories as unknown[]).filter(isCategory);
  if (categories.length === 0) {
    return errorResponse(badRequest("At least one valid category is required."));
  }

  try {
    if (action === "skip") {
      // Mark each category as "skipped" — the prompt won't reappear.
      await Promise.all(categories.map(async (category) => {
        await db.userDataMigration.upsert({
          where: { userId_category_version: { userId, category, version: MIGRATION_VERSION } },
          create: { userId, category, version: MIGRATION_VERSION, status: "skipped" },
          update: { status: "skipped" },
        });
      }));
      return NextResponse.json({ ok: true, action: "skip", categories });
    }

    if (action === "import") {
      const payload = (body.payload ?? {}) as ImportPayload;
      const result: Record<string, { status: string; recordCount: number; skipped?: boolean }> = {};

      for (const category of categories) {
        // Check existing migration state — skip if already complete.
        const existing = await db.userDataMigration.findUnique({
          where: { userId_category_version: { userId, category, version: MIGRATION_VERSION } },
        });
        if (existing?.status === "complete" || existing?.status === "skipped") {
          result[category] = {
            status: existing.status,
            recordCount: existing.recordCount,
            skipped: true,
          };
          continue;
        }

        let imported = 0;
        try {
          if (category === "notifications" && payload.notifications) {
            for (const n of payload.notifications) {
              if (n.dedupeKey) {
                await db.userNotification.upsert({
                  where: { userId_dedupeKey: { userId, dedupeKey: n.dedupeKey } },
                  create: {
                    userId, source: n.source, title: n.title, message: n.message,
                    level: n.level ?? "info", actionable: n.actionable ?? false,
                    dedupeKey: n.dedupeKey, entityRef: n.entityRef ?? null,
                    deepLink: n.deepLink ?? null,
                  },
                  update: { title: n.title, message: n.message },
                });
              } else {
                await db.userNotification.create({
                  data: {
                    userId, source: n.source, title: n.title, message: n.message,
                    level: n.level ?? "info", actionable: n.actionable ?? false,
                    entityRef: n.entityRef ?? null, deepLink: n.deepLink ?? null,
                  },
                });
              }
              imported++;
            }
          } else if (category === "saved-items" && payload["saved-items"]) {
            for (const s of payload["saved-items"]) {
              await db.savedItem.upsert({
                where: { userId_source_refId: { userId, source: s.source, refId: s.refId } },
                create: { userId, source: s.source, type: s.type, refId: s.refId, title: s.title, data: (s.data ?? null) as never },
                update: { title: s.title, data: (s.data ?? null) as never },
              });
              imported++;
            }
          }
          await db.userDataMigration.upsert({
            where: { userId_category_version: { userId, category, version: MIGRATION_VERSION } },
            create: { userId, category, version: MIGRATION_VERSION, status: "complete", recordCount: imported, migratedAt: new Date() },
            update: { status: "complete", recordCount: imported, migratedAt: new Date() },
          });
          result[category] = { status: "complete", recordCount: imported };
        } catch (err) {
          // Partial failure — record the partial state.
          await db.userDataMigration.upsert({
            where: { userId_category_version: { userId, category, version: MIGRATION_VERSION } },
            create: { userId, category, version: MIGRATION_VERSION, status: "partial", recordCount: imported, migratedAt: new Date() },
            update: { status: "partial", recordCount: imported, migratedAt: new Date() },
          });
          result[category] = { status: "partial", recordCount: imported };
          console.error(`[migrate] ${category} partial:`, toAuthError(err).code);
        }
      }

      return NextResponse.json({ ok: true, action: "import", result });
    }

    return errorResponse(badRequest(`Unknown action: ${action}`));
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
