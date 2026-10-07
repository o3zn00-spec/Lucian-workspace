// LUCIAN Phase 16 — User notifications API (server-backed).
//
// GET   /api/user/notifications              → list (with optional ?unread=true)
// POST  /api/user/notifications              → create (with dedupe by dedupeKey)
// PATCH /api/user/notifications              → bulk update (mark-read, mark-all-read, dismiss)
// PATCH /api/user/notifications/:id          → update a single notification (not implemented in this file — kept inline)
//
// All scoped by the authenticated user's id. Dedupe: when dedupeKey is
// provided and a record with the same (userId, dedupeKey) already exists,
// we UPDATE it (bump lastTriggerAt, refresh title/message) instead of
// creating a duplicate.

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
    const unreadOnly = url.searchParams.get("unread") === "true";
    const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") ?? "200", 10)));

    const notifications = await db.userNotification.findMany({
      where: {
        userId,
        ...(unreadOnly ? { readAt: null, dismissedAt: null } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      ok: true,
      notifications: notifications.map(n => ({
        ...n,
        // Don't leak DB ids directly if they're sensitive (they're cuids; safe).
      })),
    });
  } catch (err) {
    return errorResponse(toAuthError(err));
  }
}

interface CreateNotificationBody {
  source?: unknown;
  title?: unknown;
  message?: unknown;
  level?: unknown;
  actionable?: unknown;
  dedupeKey?: unknown;
  entityRef?: unknown;
  deepLink?: unknown;
}

export async function POST(req: Request) {
  let userId: string;
  try { userId = await requireUserId(); }
  catch (err) { return errorResponse(err as AuthError); }

  let body: CreateNotificationBody;
  try { body = await req.json() as CreateNotificationBody; }
  catch { return errorResponse(badRequest("Invalid body.")); }

  const source = String(body.source ?? "generic");
  const title = String(body.title ?? "");
  const message = String(body.message ?? "");
  const level = String(body.level ?? "info");
  const actionable = body.actionable === true;
  const dedupeKey = body.dedupeKey === undefined || body.dedupeKey === null ? null : String(body.dedupeKey);
  const entityRef = body.entityRef === undefined || body.entityRef === null ? null : String(body.entityRef);
  const deepLink = body.deepLink === undefined || body.deepLink === null ? null : String(body.deepLink);

  if (!title) return errorResponse(badRequest("title is required."));

  try {
    let notification;
    if (dedupeKey) {
      // Upsert by (userId, dedupeKey) — refresh title/message/lastTriggerAt.
      notification = await db.userNotification.upsert({
        where: { userId_dedupeKey: { userId, dedupeKey } },
        create: {
          userId, source, title, message, level, actionable,
          dedupeKey, entityRef, deepLink,
          lastTriggerAt: new Date(),
        },
        update: {
          // Refresh fields + bump trigger time. Do NOT reset readAt —
          // user has not yet re-acknowledged this recurrence.
          title, message, level, actionable,
          ...(deepLink !== null ? { deepLink } : {}),
          lastTriggerAt: new Date(),
        },
      });
    } else {
      notification = await db.userNotification.create({
        data: {
          userId, source, title, message, level, actionable,
          dedupeKey, entityRef, deepLink,
          lastTriggerAt: new Date(),
        },
      });
    }
    return NextResponse.json({ ok: true, notification });
  } catch (err) {
    return errorResponse(toAuthError(err));
  }
}

interface PatchBody {
  action?: unknown;       // "mark-read" | "mark-all-read" | "dismiss" | "resolve"
  id?: unknown;
}

export async function PATCH(req: Request) {
  let userId: string;
  try { userId = await requireUserId(); }
  catch (err) { return errorResponse(err as AuthError); }

  let body: PatchBody;
  try { body = await req.json() as PatchBody; }
  catch { return errorResponse(badRequest("Invalid body.")); }

  const action = String(body.action ?? "");
  const id = body.id === undefined ? null : String(body.id);
  const now = new Date();

  try {
    if (action === "mark-all-read") {
      const r = await db.userNotification.updateMany({
        where: { userId, readAt: null },
        data: { readAt: now },
      });
      return NextResponse.json({ ok: true, updated: r.count });
    }
    if (!id) return errorResponse(badRequest("id is required for this action."));

    const target = await db.userNotification.findFirst({ where: { id, userId }, select: { id: true } });
    if (!target) return errorResponse(badRequest("Notification not found."));

    if (action === "mark-read") {
      await db.userNotification.update({ where: { id }, data: { readAt: now } });
    } else if (action === "dismiss") {
      await db.userNotification.update({ where: { id }, data: { dismissedAt: now } });
    } else if (action === "resolve") {
      await db.userNotification.update({ where: { id }, data: { resolved: true, readAt: now } });
    } else {
      return errorResponse(badRequest(`Unknown action: ${action}`));
    }
    return NextResponse.json({ ok: true });
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
