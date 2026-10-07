"use client";

// LUCIAN Phase 16 — LiveSyncMount component.
//
// Thin wrapper around useLiveSync() so it can be mounted from a
// Server Component layout. The hook starts the retry loop that
// drains pending server-sync records (chats / notifications /
// saved-items) when the user is authenticated.

import { useLiveSync } from "@/lib/auth/live-sync";

/** Renders nothing. Mounts the live-sync retry loop. */
export function LiveSyncMount() {
  useLiveSync();
  return null;
}
