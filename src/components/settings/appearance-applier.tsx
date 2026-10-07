"use client";

/* LUCIAN — Appearance applier.
 *
 * Reads the appearance + accessibility slices of useSettingsStore and
 * the theme/accent from ThemeProvider, and writes them to <html>
 * dataset attributes. CSS can then read those attributes (e.g.
 * [data-density="compact"], [data-font-scale="large"],
 * [data-motion="reduced"], [data-rounded="reduced"], [data-mode="light"],
 * [data-high-contrast="true"]) to apply the appropriate styles.
 *
 * MODE RESOLUTION (Settings integration):
 *   - mode = "system" → follow prefers-color-scheme (re-renders on OS change).
 *   - mode = "dark"   → force dark. If the selected theme is light, the
 *     effective theme falls back to a deterministic dark counterpart.
 *   - mode = "light"  → force light. If the selected theme is dark, the
 *     effective theme falls back to a deterministic light counterpart.
 *
 * The effective theme is written to <html> data-theme AND mirrored to
 * localStorage so ThemeProvider's useSyncExternalStore sees it. This
 * means a mode mismatch transparently swaps the theme without losing
 * the user's selected theme (which is preserved in the Settings store
 * intent — the ThemeProvider still reports the user's selected theme,
 * but the DOM reflects the effective theme for the current mode).
 *
 * This component renders nothing. It runs as a side effect.
 */

import { useEffect } from "react";
import { useSettingsStore } from "@/store/settings";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useEffectiveAppearance } from "@/lib/appearance-mode";

/**
 * Apply the appearance prefs. Call once at the app root, inside the
 * ThemeProvider and inside the SettingsStore provider (Zustand persist
 * auto-hydrates, so just calling this in the layout is fine).
 */
export function useAppearanceApplier() {
  const appearance = useSettingsStore((s) => s.appearance);
  const accessibility = useSettingsStore((s) => s.accessibility);
  const { accent } = useTheme();
  const { mode: effectiveMode, theme: effectiveTheme, selectedTheme } = useEffectiveAppearance();

  useEffect(() => {
    const root = document.documentElement;
    // Effective mode (resolves "system" → "dark" | "light").
    root.dataset.mode = effectiveMode;
    root.dataset.density = appearance.density;
    root.dataset.fontScale = appearance.fontScale;
    root.dataset.motion = accessibility.reduceMotion ? "reduced" : appearance.animations;
    root.dataset.rounded = appearance.rounded;
    root.dataset.highContrast = String(accessibility.highContrast);
    root.dataset.largerText = String(accessibility.largerText);
    root.dataset.keyboardFocus = String(accessibility.keyboardFocusIndicators);

    // Effective theme — may differ from the user's selected theme when
    // the selected theme is incompatible with the effective mode. We
    // write it ONLY to the DOM dataset (NOT localStorage) so:
    //   - CSS picks it up immediately (data-theme attribute).
    //   - ThemeProvider's useSyncExternalStore reads from localStorage
    //     (the user's selected theme), so useTheme() still returns the
    //     selected theme — the appearance section's picker shows the
    //     correct selected state.
    //   - The user's SELECTED theme is preserved in localStorage. When
    //     the mode changes back, we re-resolve and write the correct
    //     effective theme to the DOM.
    root.dataset.theme = effectiveTheme;
    root.dataset.accent = accent;
  }, [appearance, accessibility, effectiveMode, effectiveTheme, accent]);

  return { selectedTheme, effectiveTheme, effectiveMode };
}

/**
 * Component form (use in app root). Renders nothing.
 */
export function AppearanceApplier() {
  useAppearanceApplier();
  return null;
}
