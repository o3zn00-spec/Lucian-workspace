"use client";

/* LUCIAN News Feed — state management.
 *
 * Manages: saved articles, widget configuration, feed preferences.
 * Persisted to localStorage via zustand persist.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { syncSavedItem, deleteSavedItemByRef } from "@/lib/auth/live-sync";

export interface SavedArticle {
  id: string;
  title: string;
  description: string;
  url: string;
  source: string;
  category: string;
  publishedAt: number;
  imageUrl?: string;
  savedAt: number;
}

export type WidgetId =
  | "weather" | "markets" | "sports" | "trending" | "watchlist" | "top-stories";

export interface WidgetConfig {
  id: WidgetId;
  collapsed: boolean;
  visible: boolean;
}

export interface NewsPreferences {
  category: string;
  weatherLocation: string;
  weatherLat: number | null;
  weatherLon: number | null;
}

interface NewsFeedState {
  saved: SavedArticle[];
  widgets: WidgetConfig[];
  preferences: NewsPreferences;

  // Saved articles
  toggleSave: (article: SavedArticle) => void;
  isSaved: (id: string) => boolean;
  removeSaved: (id: string) => void;

  // Widget management
  reorderWidgets: (ids: string[]) => void;
  toggleWidgetCollapse: (id: string) => void;
  toggleWidgetVisible: (id: string) => void;
  addWidget: (id: WidgetId) => void;
  removeWidget: (id: string) => void;

  // Preferences
  setCategory: (c: string) => void;
  setWeatherLocation: (location: string, lat: number, lon: number) => void;
}

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: "weather", collapsed: false, visible: true },
  { id: "markets", collapsed: false, visible: true },
  { id: "sports", collapsed: false, visible: true },
  { id: "trending", collapsed: false, visible: true },
];

const DEFAULT_PREFS: NewsPreferences = {
  category: "for-you",
  weatherLocation: "Lagos",
  weatherLat: 6.5244,
  weatherLon: 3.3792,
};

export const useNewsFeedStore = create<NewsFeedState>()(
  persist(
    (set, get) => ({
      saved: [],
      widgets: DEFAULT_WIDGETS,
      preferences: DEFAULT_PREFS,

      toggleSave: (article) => {
        const exists = get().saved.some((a) => a.id === article.id);
        set((s) => {
          return {
            saved: exists
              ? s.saved.filter((a) => a.id !== article.id)
              : [{ ...article, savedAt: Date.now() }, ...s.saved],
          };
        });
        // Phase 17: live server-sync (best-effort, non-blocking).
        // refId is the article.id so deletes find the row. Server dedupes
        // by (userId, source, refId).
        if (exists) {
          void deleteSavedItemByRef({ source: "news", refId: article.id }).catch(() => { /* non-fatal */ });
        } else {
          void syncSavedItem({
            source: "news",
            type: "article",
            refId: article.id,
            title: article.title,
            data: { ...article, savedAt: Date.now() },
          }).catch(() => { /* non-fatal — local already succeeded */ });
        }
      },

      isSaved: (id) => get().saved.some((a) => a.id === id),

      removeSaved: (id) => {
        set((s) => ({ saved: s.saved.filter((a) => a.id !== id) }));
        void deleteSavedItemByRef({ source: "news", refId: id }).catch(() => { /* non-fatal */ });
      },

      reorderWidgets: (ids) =>
        set((s) => ({
          widgets: ids
            .map((id) => s.widgets.find((w) => w.id === id))
            .filter((w): w is WidgetConfig => !!w),
        })),

      toggleWidgetCollapse: (id) =>
        set((s) => ({
          widgets: s.widgets.map((w) =>
            w.id === id ? { ...w, collapsed: !w.collapsed } : w,
          ),
        })),

      toggleWidgetVisible: (id) =>
        set((s) => ({
          widgets: s.widgets.map((w) =>
            w.id === id ? { ...w, visible: !w.visible } : w,
          ),
        })),

      addWidget: (id) =>
        set((s) => {
          if (s.widgets.some((w) => w.id === id)) return s;
          return {
            widgets: [...s.widgets, { id, collapsed: false, visible: true }],
          };
        }),

      removeWidget: (id) =>
        set((s) => ({
          widgets: s.widgets.filter((w) => w.id !== id),
        })),

      setCategory: (c) =>
        set((s) => ({ preferences: { ...s.preferences, category: c } })),

      setWeatherLocation: (location, lat, lon) =>
        set((s) => ({
          preferences: {
            ...s.preferences,
            weatherLocation: location,
            weatherLat: lat,
            weatherLon: lon,
          },
        })),
    }),
    {
      name: "lucian-news-feed",
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

export const ALL_WIDGET_OPTIONS: { id: WidgetId; label: string }[] = [
  { id: "weather", label: "Weather" },
  { id: "markets", label: "Markets" },
  { id: "sports", label: "Sports" },
  { id: "trending", label: "Trending" },
  { id: "watchlist", label: "Watchlist" },
  { id: "top-stories", label: "Top Stories" },
];
