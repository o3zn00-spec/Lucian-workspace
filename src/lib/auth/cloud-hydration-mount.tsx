"use client";

// LUCIAN Phase 16 — CloudHydrationMount component.
//
// Thin wrapper around useCloudHydration() so it can be mounted from a
// Server Component layout. The hook fires server-backed data hydration
// (chats / notifications / saved-items) when the user transitions to
// authenticated. Hydration is idempotent, dedupe-aware, and silent
// (does NOT replay notification sounds).

import { useCloudHydration } from "@/lib/auth/cloud-hydration";

/** Renders nothing. Mounts the cloud hydration hook. */
export function CloudHydrationMount() {
  useCloudHydration();
  return null;
}
