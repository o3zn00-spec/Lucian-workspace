"use client";

/* LUCIAN Global Search — canonical store.
 *
 * Phase 9: ONE source of truth for the global search overlay's open/close
 * state and the initial query (e.g. text typed into TopNav's compact search
 * input before opening the overlay).
 *
 * Mounted once at the AppShell level so the overlay persists across route
 * changes. Home search, TopNav search input, TopNav search icon, the
 * keyboard shortcut (/ and Ctrl/Cmd+K), and any other search trigger all
 * call `open()` / `setQuery()` here — there is no other search overlay
 * instance.
 */

import { create } from "zustand";

interface GlobalSearchState {
  /** Whether the overlay is currently visible. */
  open: boolean;
  /** Initial query seeded into the overlay's input when opened. */
  initialQuery: string;
  /** Open the overlay. Optionally seed an initial query. */
  openWith: (query?: string) => void;
  /** Toggle the overlay open/closed. */
  toggle: () => void;
  /** Close the overlay. Does NOT clear initialQuery (so re-opening keeps
   *  the prior text if the user reopens via the compact input). */
  close: () => void;
  /** Set the initialQuery (does not open the overlay). */
  setQuery: (q: string) => void;
}

export const useGlobalSearchStore = create<GlobalSearchState>((set) => ({
  open: false,
  initialQuery: "",

  openWith: (query) =>
    set((s) => ({
      open: true,
      initialQuery: query !== undefined ? query : s.initialQuery,
    })),

  toggle: () => set((s) => ({ open: !s.open })),

  close: () => set({ open: false }),

  setQuery: (q) => set({ initialQuery: q }),
}));
