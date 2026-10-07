// LUCIAN Phase 16 — Export account data (GDPR-style).
//
// GET /api/auth/export-data → JSON file containing the user's
// server-backed data: profile, accounts (no tokens), chats, agent
// memory, notifications, saved items, vault metadata (manual only).
//
// The export is per-user — only the authenticated user's data is
// included. No passwordHash, no OAuth tokens, no other users' data.
//
// Format: JSON. The Content-Disposition header suggests a filename.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUserId } from "@/lib/auth/session";
import { AuthError, toAuthError } from "@/lib/auth/errors";

export const dynamic = "force-dynamic";

export async function GET() {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (err) {
    return errorResponse(err as AuthError);
  }

  try {
    const [user, profile, accounts, sessions, conversations, memory, notifications, savedItems, vaultAccounts] = await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: {
          id: true, email: true, name: true, image: true,
          emailVerified: true, status: true, createdAt: true, updatedAt: true,
        },
      }),
      db.profile.findUnique({ where: { userId }, select: { displayName: true, avatar: true, preferences: true, createdAt: true, updatedAt: true } }),
      db.account.findMany({ where: { userId }, select: { provider: true, type: true, createdAt: true, updatedAt: true } }),
      db.session.findMany({ where: { userId }, select: { createdAt: true, expires: true } }),
      db.archivedChatConversation.findMany({
        where: { userId },
        select: { id: true, source: true, title: true, createdAt: true, updatedAt: true,
          messages: { select: { role: true, content: true, model: true, provider: true, createdAt: true }, orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "desc" },
      }),
      db.archivedAssistantMemory.findMany({ where: { userId }, select: { scope: true, key: true, value: true, createdAt: true, updatedAt: true } }),
      db.userNotification.findMany({
        where: { userId },
        select: { source: true, title: true, message: true, level: true, actionable: true, resolved: true, readAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      db.savedItem.findMany({
        where: { userId },
        select: { source: true, type: true, refId: true, title: true, data: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
      db.vaultAccount.findMany({
        where: { ownerUserId: userId },
        select: { id: true, label: true, type: true, source: true, currency: true, balance: true, createdAt: true, updatedAt: true },
      }),
    ]);

    if (!user) {
      return errorResponse({ code: "user_not_found", message: "Account not found.", statusCode: 404, name: "AuthError" } as AuthError);
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      user,
      profile,
      accounts: accounts.map(a => ({ provider: a.provider, type: a.type, linkedAt: a.createdAt })),
      sessions: sessions.map(s => ({ createdAt: s.createdAt, expiresAt: s.expires })),
      archivedConversations: conversations,
      archivedAssistantMemory: memory,
      notifications,
      savedItems,
      vaultAccounts: vaultAccounts.map(a => ({
        ...a,
        // BigInt → string (JSON can't serialize BigInt).
        balance: a.balance.toString(),
      })),
    };

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="lucian-account-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
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
