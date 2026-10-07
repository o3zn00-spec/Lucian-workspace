"use client";

import { useCallback, useSyncExternalStore } from "react";
import { syncSavedItem, deleteSavedItemByRef } from "@/lib/auth/live-sync";

const FAVORITES_KEY = "lucian-markets-favorites";
const EMPTY_SET: ReadonlySet<string> = new Set();

// Module-level cache so useSyncExternalStore returns a stable snapshot
// until the underlying localStorage value actually changes. Without this,
// every render would produce a new Set instance and trigger infinite updates.
let cachedSnapshot: ReadonlySet<string> | null = null;
let cachedRaw: string | null = null;

function readFavoritesSnapshot(): ReadonlySet<string> {
  if (typeof window === "undefined") return EMPTY_SET;
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (raw === cachedRaw && cachedSnapshot) return cachedSnapshot;
    cachedRaw = raw;
    if (!raw) {
      cachedSnapshot = EMPTY_SET;
    } else {
      const arr = JSON.parse(raw) as string[];
      cachedSnapshot = new Set(arr);
    }
    return cachedSnapshot;
  } catch {
    return cachedSnapshot ?? EMPTY_SET;
  }
}

function getServerSnapshot(): ReadonlySet<string> {
  return EMPTY_SET;
}

// Subscribe to localStorage `storage` events from OTHER tabs + a custom
// event we dispatch ourselves when this tab writes the key. Same-tab writes
// do not fire the native `storage` event, so we emit our own.
function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === FAVORITES_KEY || e.key === null) callback();
  };
  const onLocal = () => callback();
  window.addEventListener("storage", onStorage);
  window.addEventListener(FAVORITES_KEY + ":changed", onLocal as EventListener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(FAVORITES_KEY + ":changed", onLocal as EventListener);
  };
}

function persist(next: Set<string>): void {
  try {
    const raw = JSON.stringify([...next]);
    localStorage.setItem(FAVORITES_KEY, raw);
    // Invalidate the cache + emit a same-tab change event so
    // useSyncExternalStore picks up the new value.
    cachedRaw = raw;
    cachedSnapshot = next;
    window.dispatchEvent(new Event(FAVORITES_KEY + ":changed"));
  } catch {
    /* storage unavailable */
  }
}

/** Hook: load + persist favorites as a Set<string> of symbols.
    Shared between the InstrumentsPanel and the per-pane Change Instrument
    popover so both read/write the same localStorage-backed set.
    PHASE 16: also live-syncs to /api/user/saved-items (source="markets",
    type="favorite", refId=symbol). Server sync is best-effort — local
    mutation always succeeds first. Removing a favorite also deletes the
    server row by (source, refId) so the favorite does NOT reappear
    after the next login. */
export function useFavorites() {
  const favorites = useSyncExternalStore(
    subscribe,
    readFavoritesSnapshot,
    getServerSnapshot,
  );

  const toggle = useCallback(
    (symbol: string) => {
      const next = new Set(favorites);
      const wasFavorite = next.has(symbol);
      if (wasFavorite) next.delete(symbol);
      else next.add(symbol);
      persist(next);
      // PHASE 16: live server-sync (best-effort, non-blocking).
      //   - Adding a favorite → POST /api/user/saved-items (idempotent upsert).
      //   - Removing → DELETE /api/user/saved-items?source=markets&refId=<symbol>.
      //     This is the canonical fix for "stale cloud favorites reappear
      //     after login" — the server row is removed so the next GET
      //     /api/user/saved-items no longer returns it.
      if (wasFavorite) {
        void deleteSavedItemByRef({ source: "markets", refId: symbol }).catch(() => { /* non-fatal */ });
      } else {
        void syncSavedItem({
          source: "markets",
          type: "favorite",
          refId: symbol,
          title: symbol,
          data: { symbol },
        }).catch(() => { /* non-fatal — local already succeeded */ });
      }
    },
    [favorites],
  );

  return { favorites, toggle };
}
