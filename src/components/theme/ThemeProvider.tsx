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

function subscribeStorage(cb: () => void): () => void {
  listeners.add(cb);
  if (typeof window !== "undefined") {
    window.addEventListener(STORAGE_EVENT, handleStorageEvent);
  }
  return () => {
    listeners.delete(cb);
    if (typeof window !== "undefined") {
      window.removeEventListener(STORAGE_EVENT, handleStorageEvent);
    }
  };
}

function handleStorageEvent() {
  listeners.forEach((cb) => cb());
}

function notifyStorageListeners() {
  listeners.forEach((cb) => cb());
}

/**
 * Get the current theme from localStorage (or DOM dataset for SSR safety).
 *
 * IMPORTANT: we prefer localStorage over the DOM dataset because the
 * AppearanceApplier may write a DIFFERENT theme to the DOM dataset
 * (the "effective theme" after mode resolution). Reading from
 * localStorage ensures useTheme() always returns the user's SELECTED
 * theme, while the DOM reflects the EFFECTIVE theme being rendered.
 *
 * This also fixes cross-tab sync: when Tab A changes the theme, Tab B's
 * DOM dataset is stale but localStorage has the new value.
 */
function getThemeSnapshot(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME;
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
  // Fall back to the DOM dataset if localStorage is unavailable.
  const fromDom = document.documentElement.dataset.theme as
    | ThemeId
    | undefined;
  if (fromDom && THEME_IDS.includes(fromDom)) return fromDom;
  return DEFAULT_THEME;
}

function getAccentSnapshot(): AccentId {
  if (typeof window === "undefined") return DEFAULT_ACCENT;
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
  // Fall back to the DOM dataset if localStorage is unavailable.
  const fromDom = document.documentElement.dataset.accent as
    | AccentId
    | undefined;
  if (fromDom && ACCENT_IDS.includes(fromDom)) return fromDom;
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
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      notifyStorageListeners();
    } catch {
      /* storage unavailable */
    }
  }, []);

  const setAccent = useCallback((next: AccentId) => {
    document.documentElement.dataset.accent = next;
    try {
      window.localStorage.setItem(ACCENT_STORAGE_KEY, next);
      notifyStorageListeners();
    } catch {
      /* storage unavailable */
    }
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
