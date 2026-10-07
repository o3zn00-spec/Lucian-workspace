"use client";

/* LUCIAN News — Watchlist store.
 *
 * A user-managed list of news topics. Each topic can be enabled/disabled
 * and removed. Clicking a topic filters the real News dataset for matching
 * articles (handled in the page).
 *
 * Persistence: localStorage via zustand persist (same pattern as the
 * news-feed store). No auth, no database.
 *
 * The store is intentionally minimal: name + enabled. It does NOT cache
 * matched articles (the page does that — it already has the article
 * corpus in memory).
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { syncSavedItem, deleteSavedItemByRef } from "@/lib/auth/live-sync";

export interface WatchlistTopic {
  /** Stable id (slugified topic). */
  id: string;
  /** Display label — exactly what the user typed (e.g. "Federal Reserve"). */
  label: string;
  /** Whether the topic is active for matching. Disabled topics are kept
   *  in storage but excluded from matching. */
  enabled: boolean;
  /** When the user added the topic (epoch ms). For sort stability. */
  addedAt: number;
}

interface NewsWatchlistState {
  topics: WatchlistTopic[];
  addTopic: (label: string) => void;
  removeTopic: (id: string) => void;
  toggleTopic: (id: string) => void;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]/giu, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

export const useNewsWatchlistStore = create<NewsWatchlistState>()(
  persist(
    (set, get) => ({
      topics: [],

      addTopic: (label) => {
        const trimmed = label.trim();
        if (!trimmed) return;
        const id = slugify(trimmed);
        if (!id) return;
        // De-dupe by id (case-insensitive).
        if (get().topics.some((t) => t.id === id)) return;
        const topic = { id, label: trimmed, enabled: true, addedAt: Date.now() };
        set((s) => ({
          topics: [...s.topics, topic],
        }));
        // Phase 17: live server-sync (best-effort, non-blocking).
        void syncSavedItem({
          source: "news",
          type: "topic",
          refId: id,
          title: trimmed,
          data: { ...topic },
        }).catch(() => { /* non-fatal — local already succeeded */ });
      },

      removeTopic: (id) => {
        set((s) => ({ topics: s.topics.filter((t) => t.id !== id) }));
        void deleteSavedItemByRef({ source: "news", refId: id }).catch(() => { /* non-fatal */ });
      },

      toggleTopic: (id) => {
        // FINAL FIX: toggling must persist the enabled state to the
        // server. addTopic/removeTopic already cloud-sync; toggle was
        // the only mutation that stayed local, so a disabled topic on
        // Device A came back enabled after hydration on Device B.
        let updated: WatchlistTopic | undefined;
        set((s) => ({
          topics: s.topics.map((t) => {
            if (t.id !== id) return t;
            updated = { ...t, enabled: !t.enabled };
            return updated;
          }),
        }));
        // Upsert the EXISTING canonical (source="news", refId=<topic id>)
        // record — the server dedupes by (userId, source, refId), so this
        // updates the row in place and never creates a duplicate topic.
        if (updated) {
          void syncSavedItem({
            source: "news",
            type: "topic",
            refId: updated.id,
            title: updated.label,
            data: { ...updated },
          }).catch(() => { /* non-fatal — local toggle already succeeded */ });
        }
      },
    }),
    {
      name: "lucian-news-watchlist",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
        return localStorage;
      }),
    },
  ),
);
