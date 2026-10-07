// LUCIAN Phase 16 — User saved items API (bookmarks / favorites).
//
// GET    /api/user/saved-items?source=...           → list
// GET    /api/user/saved-items?source=...&refId=...  → single item (lookup)
// POST   /api/user/saved-items                       → create (dedupe by userId+source+refId)
// DELETE /api/user/saved-items?id=...                → delete a single item by id
// DELETE /api/user/saved-items?source=...&refId=...  → delete by (source, refId)
//
// The DELETE-by-(source, refId) path is what the local favorites store
// uses when a user removes a favorite locally — we don't know the
// server's row id, but we do know the (source, refId) tuple. Without
// this path, removed favorites would reappear after login (the server
// row survived the local delete).
//
// Scoped by the authenticated user's id.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/session";
import { AuthError, badRequest, toAuthError } from "@/lib/auth/errors";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  let userId: string;
  try { userId = await requireUserId(); }
  catch (err) { return errorResponse(err as AuthError); }

  try {
    const url = new URL(req.url);
    const source = url.searchParams.get("source") ?? undefined;
    const refId = url.searchParams.get("refId") ?? undefined;

    // If refId is supplied, return the single matching item (or 404).
    // This is the lookup path used by the favorites store after a
    // local delete to verify the server row is also gone.
    if (source && refId) {
      const item = await db.savedItem.findUnique({
        where: { userId_source_refId: { userId, source, refId } },
      });
      return NextResponse.json({ ok: true, item });
    }

    const items = await db.savedItem.findMany({
      where: { userId, ...(source ? { source } : {}) },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ ok: true, items });
  } catch (err) {
    return errorResponse(toAuthError(err));
  }
}

interface CreateBody {
  source?: unknown;
  type?: unknown;
  refId?: unknown;
  title?: unknown;
  data?: unknown;
}

export async function POST(req: Request) {
  let userId: string;
  try { userId = await requireUserId(); }
  catch (err) { return errorResponse(err as AuthError); }

  let body: CreateBody;
  try { body = await req.json() as CreateBody; }
  catch { return errorResponse(badRequest("Invalid body.")); }

  const source = String(body.source ?? "");
  const type = String(body.type ?? "");
  const refId = body.refId === undefined || body.refId === null ? null : String(body.refId);
  const title = String(body.title ?? "");
  const data = body.data === undefined ? null : body.data;

  if (!source || !type || !title) {
    return errorResponse(badRequest("source, type, and title are required."));
  }
  if (refId === null) {
    return errorResponse(badRequest("refId is required (use a unique value within source)."));
  }

  try {
    const item = await db.savedItem.upsert({
      where: { userId_source_refId: { userId, source, refId } },
      create: { userId, source, type, refId, title, data: data as never },
      update: { title, data: data as never },
    });
    return NextResponse.json({ ok: true, item });
  } catch (err) {
    return errorResponse(toAuthError(err));
  }
}

export async function DELETE(req: Request) {
  let userId: string;
  try { userId = await requireUserId(); }
  catch (err) { return errorResponse(err as AuthError); }

  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    const source = url.searchParams.get("source");
    const refId = url.searchParams.get("refId");

    // Path A: delete by id (legacy / direct).
    if (id) {
      const item = await db.savedItem.findFirst({ where: { id, userId }, select: { id: true } });
      if (!item) return errorResponse(badRequest("Item not found."));
      await db.savedItem.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    }

    // Path B: delete by (userId, source, refId) — used by the favorites
    // store's "remove" path so server-side favorites stay in sync with
    // local deletes. This is the canonical fix for "stale cloud favorites
    // reappear after login".
    if (source && refId) {
      // deleteMany is idempotent — if the row doesn't exist (already
      // deleted, or was never created on the server), it returns 0
      // and we still respond 200 OK. This makes retries safe.
      await db.savedItem.deleteMany({
        where: { userId, source, refId },
      });
      return NextResponse.json({ ok: true });
    }

    return errorResponse(badRequest("Either id or (source + refId) is required."));
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
