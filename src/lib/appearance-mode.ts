"use client";

/* LUCIAN — Appearance Mode Resolver.
 *
 * Resolves the appearance MODE (system / dark / light) into an effective
 * mode ("dark" | "light") AND a theme override when the user's selected
 * theme is incompatible with the chosen mode.
 *
 * Rules:
 *   - mode = "system" → follow prefers-color-scheme.
 *   - mode = "dark"   → force dark. If the selected theme is light,
 *     fall back to a deterministic dark counterpart.
 *   - mode = "light"  → force light. If the selected theme is dark,
 *     fall back to a deterministic light counterpart.
 *
 * Theme compatibility is read from the theme definition's `light` flag
 * in src/lib/themes.ts. The mapping is deterministic so the user always
 * gets the same counterpart for a given theme.
 *
 * This module is consumed by the AppearanceApplier (which writes the
 * effective theme + mode to <html> dataset attributes).
 */

import { useSyncExternalStore } from "react";
import { useSettingsStore } from "@/store/settings";
import { useTheme } from "@/components/theme/ThemeProvider";
import { THEMES, type ThemeId } from "@/lib/themes";

export type EffectiveMode = "dark" | "light";

/* ─── Theme mode compatibility ─── */

const LIGHT_THEMES: ThemeId[] = THEMES.filter((t) => t.light).map((t) => t.id);

function isLightTheme(theme: ThemeId): boolean {
  return LIGHT_THEMES.includes(theme);
}

/**
 * Deterministic mapping from any theme to its dark/light counterpart.
 * If the theme is already light, its dark counterpart is the default
 * dark theme; if the theme is dark, its light counterpart is the
 * default light theme. This avoids creating hundreds of overrides.
 */
const DEFAULT_DARK: ThemeId = "midnight-gray";
const DEFAULT_LIGHT: ThemeId = "natural-white";

export function resolveThemeForMode(theme: ThemeId, mode: EffectiveMode): ThemeId {
  if (mode === "light") {
    return isLightTheme(theme) ? theme : DEFAULT_LIGHT;
  }
  // mode === "dark"
  return isLightTheme(theme) ? DEFAULT_DARK : theme;
}

/* ─── System mode as an external store (useSyncExternalStore) ─── */

function subscribeSystemMode(cb: () => void): () => void {
  if (typeof window !== "undefined" && window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  }
  return () => {};
}

function getSystemModeSnapshot(): EffectiveMode {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function getServerSystemModeSnapshot(): EffectiveMode {
  return "dark";
}

/* ─── Hook: effective mode + theme ─── */

export interface EffectiveAppearance {
  /** The effective mode after resolving "system". */
  mode: EffectiveMode;
  /** The effective theme (may differ from the user's selected theme when
   *  the selected theme is incompatible with the effective mode). */
  theme: ThemeId;
  /** The user's selected theme (before mode resolution). */
  selectedTheme: ThemeId;
  /** True if the user's selected theme was overridden due to mode mismatch. */
  themeOverridden: boolean;
}

/**
 * React hook that returns the effective appearance (mode + theme) and
 * re-renders when the settings change OR when the OS color-scheme
 * changes (only relevant when mode = "system").
 *
 * SSR-safe: returns "dark" + DEFAULT_THEME on the server.
 */
export function useEffectiveAppearance(): EffectiveAppearance {
  const settingsMode = useSettingsStore((s) => s.appearance.mode);
  // useTheme() reads from localStorage (the user's SELECTED theme).
  // The AppearanceApplier writes the EFFECTIVE theme to the DOM dataset,
  // so useTheme() still returns the selected theme (not the effective one).
  const { theme: selectedTheme } = useTheme();
  // Read the system mode via useSyncExternalStore — this is the React-
  // recommended way to bind to browser APIs without setState-in-effect.
  const systemMode = useSyncExternalStore(
    subscribeSystemMode,
    getSystemModeSnapshot,
    getServerSystemModeSnapshot,
  );

  const effectiveMode: EffectiveMode =
    settingsMode === "system" ? systemMode : settingsMode;
  const effectiveTheme = resolveThemeForMode(selectedTheme, effectiveMode);
  const themeOverridden = effectiveTheme !== selectedTheme;

  return { mode: effectiveMode, theme: effectiveTheme, selectedTheme, themeOverridden };
}
