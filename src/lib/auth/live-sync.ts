"use client";

// LUCIAN Phase 16 — Live server-sync layer (FINAL CORRECTED).
//
// This module wires the existing client stores' mutation paths to the
// server-side /api/user/* endpoints. It is INTENTIONALLY resilient:
//
//   - Local operation ALWAYS succeeds first (the store mutates locally
//     + persists to localStorage as before). The user sees their action.
//   - Server-sync happens AFTER the local mutation, in the background.
//   - If the server is unreachable, the local change is NOT rolled back.
//     The user's data is preserved. A `sync-pending` flag is recorded
//     in localStorage so a future retry can pick it up.
//   - If the server returns 401 (unauthed), sync is silently skipped
//     — the user is not yet logged in, so server persistence isn't
//     expected.
//   - Duplicate records are deduped by the server's existing upsert
//     paths (dedupeKey for notifications, (userId, source, refId) for
//     saved-items, etc.).
//
// IMPORTANT: this layer does NOT replace the post-login migration
// prompt. The migration prompt handles bulk import of pre-existing
// local data. This layer handles live incremental writes after login.
//
// Use the hooks:
//   - useChatsSync()        — call from a top-level component (e.g. root layout)
//   - useNotificationsSync() — same
//
// Or call the imperative helpers directly from store mutation paths:
//   - syncChatConversation(...)
//   - syncNotification(...)
//   - syncSavedItem(...)

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

const SYNC_PENDING_KEY = "lucian-sync-pending";

interface PendingSyncRecord {
  id: string;
  endpoint: string; // e.g. "/api/user/notifications"
  method: "POST" | "DELETE" | "PUT" | "PATCH";
  body?: unknown;
  addedAt: number;
  attempts: number;
}

interface PendingSyncStore {
  records: PendingSyncRecord[];
}

/** Record a pending sync operation that failed (e.g. network down).
 *  The retry loop will pick it up on the next successful server round. */
export function recordPendingSync(rec: Omit<PendingSyncRecord, "addedAt" | "attempts">): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(SYNC_PENDING_KEY);
    const store: PendingSyncStore = raw ? (JSON.parse(raw) as PendingSyncStore) : { records: [] };
    const id = rec.id || `${rec.endpoint}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    // Dedupe by id — keep the latest body
    store.records = store.records.filter(r => r.id !== id);
    store.records.push({ ...rec, id, addedAt: Date.now(), attempts: 0 });
    // Cap to prevent unbounded growth
    if (store.records.length > 200) {
      store.records = store.records.slice(-200);
    }
    localStorage.setItem(SYNC_PENDING_KEY, JSON.stringify(store));
  } catch {
    // localStorage unavailable or full — fail silently. The local
    // mutation already succeeded; we just lose the retry path.
  }
}

/** Best-effort POST to a /api/user/* endpoint. Returns true on
 *  success (2xx), false on network error. 401 is treated as a soft
 *  skip (user not yet logged in). 4xx (other) is treated as a hard
 *  failure — the server rejected the request, retrying won't help. */
async function bestEffortPost(endpoint: string, body: unknown, idHint: string): Promise<boolean> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      credentials: "same-origin",
    });
    if (res.status === 401) return true; // soft skip — not logged in yet
    if (res.status >= 200 && res.status < 300) return true;
    if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 408 && res.status !== 429) {
      return true; // hard 4xx — don't retry
    }
    // 5xx / 408 / 429 → record for retry
    recordPendingSync({ id: idHint, endpoint, method: "POST", body });
    return false;
  } catch {
    // Network error — record for retry
    recordPendingSync({ id: idHint, endpoint, method: "POST", body });
    return false;
  }
}

/** Best-effort DELETE. Same semantics as bestEffortPost. */
async function bestEffortDelete(endpoint: string, idHint: string): Promise<boolean> {
  try {
    const res = await fetch(endpoint, { method: "DELETE", credentials: "same-origin" });
    if (res.status === 401) return true;
    if (res.status >= 200 && res.status < 300) return true;
    if (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 408 && res.status !== 429) {
      return true;
    }
    recordPendingSync({ id: idHint, endpoint, method: "DELETE" });
    return false;
  } catch {
    recordPendingSync({ id: idHint, endpoint, method: "DELETE" });
    return false;
  }
}

// ── Public sync helpers ─────────────────────────────────────────

/** Sync a chat message to the server. Creates the conversation if
 *  it doesn't exist yet (idempotent by conversation id). The local
 *  store's mutation has already happened by the time this is called.
 *
 *  CONTRACT: the client must send a stable `messageId` so retries
 *  don't duplicate the row. The server dedupes by (conversationId,
 *  messageId) via a unique constraint. */


/** Tiny deterministic string hash → short base36. Used to derive a
 *  stable messageId from (conversationId, role, content) so a retry
 *  with the same content yields the same id. NEVER used for security. */


/** Sync a notification to the server. The server dedupes by
 *  (userId, dedupeKey). The local notification store's mutation
 *  has already happened by the time this is called. */
export async function syncNotification(input: {
  source: string;
  title: string;
  message: string;
  level?: string;
  actionable?: boolean;
  dedupeKey?: string;
  entityRef?: string;
  deepLink?: string;
}): Promise<void> {
  await bestEffortPost("/api/user/notifications", {
    source: input.source,
    title: input.title,
    message: input.message,
    level: input.level ?? "info",
    actionable: input.actionable ?? false,
    dedupeKey: input.dedupeKey,
    entityRef: input.entityRef,
    deepLink: input.deepLink,
  }, `notif_${input.dedupeKey ?? input.title}`);
}

/** Sync a saved-item (bookmark / favorite / etc.) to the server.
 *  The server dedupes by (userId, source, refId). */
export async function syncSavedItem(input: {
  source: string;
  type: string;
  refId?: string;
  title: string;
  data?: unknown;
}): Promise<void> {
  await bestEffortPost("/api/user/saved-items", {
    source: input.source,
    type: input.type,
    refId: input.refId,
    title: input.title,
    data: input.data,
  }, `saved_${input.source}_${input.refId ?? input.title}`);
}

/** Delete a saved-item from the server by (source, refId). This is the
 *  canonical delete path for the local favorites / bookmark stores —
 *  they don't know the server's row id, only the (source, refId) tuple
 *  they originally POSTed. Without this path, removed favorites would
 *  reappear after login (the server row survived the local delete). */
export async function deleteSavedItemByRef(input: {
  source: string;
  refId: string;
}): Promise<void> {
  const params = new URLSearchParams({
    source: input.source,
    refId: input.refId,
  });
  await bestEffortDelete(
    `/api/user/saved-items?${params.toString()}`,
    `del_saved_${input.source}_${input.refId}`,
  );
}

/** Delete a saved-item from the server by id. Kept for back-compat
 *  with the existing call sites that already had the row id. New
 *  code should prefer deleteSavedItemByRef since local stores don't
 *  carry the server's row id. */
export async function deleteSavedItem(id: string): Promise<void> {
  await bestEffortDelete(`/api/user/saved-items?id=${encodeURIComponent(id)}`, `del_saved_${id}`);
}

// ── React hooks ─────────────────────────────────────────────────

/** Top-level hook that runs the retry loop for pending sync records.
 *  Mount this once at the app root. */
export function useLiveSync(): void {
  const { status } = useSession();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    const flush = async () => {
      if (typeof window === "undefined") return;
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(SYNC_PENDING_KEY);
      } catch { return; }
      if (!raw) return;
      let store: PendingSyncStore;
      try {
        store = JSON.parse(raw) as PendingSyncStore;
      } catch { return; }
      if (!store.records || store.records.length === 0) return;

      // Process up to 10 records per tick.
      const activeRecords = store.records.filter(record => !record.endpoint.startsWith("/api/user/chats") && !record.endpoint.startsWith("/api/user/agent-memory"));
      const toProcess = activeRecords.slice(0, 10);
      const remaining: PendingSyncRecord[] = [...activeRecords.slice(10)];
      for (const rec of toProcess) {
        try {
          const res = await fetch(rec.endpoint, {
            method: rec.method,
            headers: rec.method === "POST" || rec.method === "PUT" || rec.method === "PATCH"
              ? { "Content-Type": "application/json" }
              : undefined,
            body: rec.body ? JSON.stringify(rec.body) : undefined,
            credentials: "same-origin",
          });
          if (res.status >= 200 && res.status < 300) {
            // success — drop from pending
          } else if (res.status === 401) {
            // not authed — keep pending (will retry next tick)
            remaining.push(rec);
          } else if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
            // hard 4xx — drop (retrying won't help)
          } else {
            // 5xx / 408 / 429 — keep pending
            remaining.push({ ...rec, attempts: rec.attempts + 1 });
          }
        } catch {
          remaining.push({ ...rec, attempts: rec.attempts + 1 });
        }
      }
      // Drop records that have failed too many times (>20 attempts = 20 ticks)
      const kept = remaining.filter(r => r.attempts < 20);
      try {
        localStorage.setItem(SYNC_PENDING_KEY, JSON.stringify({ records: kept }));
      } catch { /* storage full — silently fail */ }
    };
    // Run once on mount
    void flush();
    // Then every 30 seconds
    timerRef.current = setInterval(flush, 30_000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [status]);
}
