"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ACCENT_IDS,
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT,
  DEFAULT_THEME,
  LEGACY_ACCENT_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  THEME_IDS,
  THEME_STORAGE_KEY,
  type AccentId,
  type ThemeId,
} from "@/lib/themes";

interface ThemeContextValue {
  theme: ThemeId;
  accent: AccentId;
  setTheme: (theme: ThemeId) => void;
  setAccent: (accent: AccentId) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/* ------------------------------------------------------------------ */
/* localStorage as an external store (for useSyncExternalStore)       */
/* ------------------------------------------------------------------ */

const STORAGE_EVENT = "storage";
const listeners = new Set<() => void>();
let selectedTheme: ThemeId | undefined;
let selectedAccent: AccentId | undefined;

function subscribeStorage(cb: () => void): () => void {
  listeners.add(cb);
  if (typeof window !== "undefined" && listeners.size === 1) {
    window.addEventListener(STORAGE_EVENT, handleStorageEvent);
  }
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined" && listeners.size === 0) {
      window.removeEventListener(STORAGE_EVENT, handleStorageEvent);
    }
  };
}

function handleStorageEvent(event: StorageEvent) {
  if (event.key !== null && ![THEME_STORAGE_KEY, ACCENT_STORAGE_KEY, LEGACY_THEME_STORAGE_KEY, LEGACY_ACCENT_STORAGE_KEY].includes(event.key)) return;
  selectedTheme = undefined;
  selectedAccent = undefined;
  listeners.forEach((cb) => cb());
}

function notifyStorageListeners() {
  listeners.forEach((cb) => cb());
}

/**
 * Get the selected theme from storage or the in-memory preference.
 *
 * IMPORTANT: we prefer localStorage over the DOM dataset because the
 * AppearanceApplier may write a DIFFERENT theme to the DOM dataset
 * (the "effective theme" after mode resolution). Reading from
 * the preference store ensures useTheme() always returns the user's SELECTED
 * theme, while the DOM reflects the EFFECTIVE theme being rendered.
 *
 * This also fixes cross-tab sync: when Tab A changes the theme, Tab B's
 * DOM dataset is stale but localStorage has the new value.
 */
function getThemeSnapshot(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME;
  if (selectedTheme !== undefined) return selectedTheme;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored && isThemeId(stored)) return stored;
    const legacy = window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (legacy && isThemeId(legacy)) {
      window.localStorage.setItem(THEME_STORAGE_KEY, legacy);
      window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
      return legacy;
    }
  } catch {
    /* storage unavailable */
  }
  // The DOM contains the effective theme, not the selected preference.
  return DEFAULT_THEME;
}

function getAccentSnapshot(): AccentId {
  if (typeof window === "undefined") return DEFAULT_ACCENT;
  if (selectedAccent !== undefined) return selectedAccent;
  try {
    const stored = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    if (stored && isAccentId(stored)) return stored;
    const legacy = window.localStorage.getItem(LEGACY_ACCENT_STORAGE_KEY);
    if (legacy && isAccentId(legacy)) {
      window.localStorage.setItem(ACCENT_STORAGE_KEY, legacy);
      window.localStorage.removeItem(LEGACY_ACCENT_STORAGE_KEY);
      return legacy;
    }
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_ACCENT;
}

// Type guards so we can safely narrow `string` to `ThemeId` / `AccentId`
// after pulling from localStorage without `as` casts.
function isThemeId(value: string): value is ThemeId {
  return (THEME_IDS as readonly string[]).includes(value);
}

function isAccentId(value: string): value is AccentId {
  return (ACCENT_IDS as readonly string[]).includes(value);
}

function getServerThemeSnapshot(): ThemeId {
  return DEFAULT_THEME;
}

function getServerAccentSnapshot(): AccentId {
  return DEFAULT_ACCENT;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // useSyncExternalStore reads the snapshot during render (no setState!),
  // re-renders when listeners fire, and gracefully handles SSR via the
  // third arg. This is the React-recommended way to bind to localStorage.
  const theme = useSyncExternalStore(
    subscribeStorage,
    getThemeSnapshot,
    getServerThemeSnapshot
  );
  const accent = useSyncExternalStore(
    subscribeStorage,
    getAccentSnapshot,
    getServerAccentSnapshot
  );

  const setTheme = useCallback((next: ThemeId) => {
    selectedTheme = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* Keep the selected preference in memory when storage is unavailable. */
    }
    notifyStorageListeners();
  }, []);

  const setAccent = useCallback((next: AccentId) => {
    selectedAccent = next;
    try {
      window.localStorage.setItem(ACCENT_STORAGE_KEY, next);
    } catch {
      /* Keep the selected preference in memory when storage is unavailable. */
    }
    notifyStorageListeners();
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, accent, setTheme, setAccent }),
    [theme, accent, setTheme, setAccent]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
