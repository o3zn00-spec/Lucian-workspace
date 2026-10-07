"use client";

import { useEffect, useRef } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useMarketsStore } from "@/store/markets";
import { getInstrumentBySymbol } from "@/lib/markets/catalog";

/**
 * Markets deep-link receiver — Phase 9.
 *
 * Reads `?symbol=<SYMBOL>` on mount (or on URL change) and:
 *   1. Validates the symbol exists in the LUCIAN instrument catalog.
 *   2. Calls `selectSymbol(symbol)` which updates BOTH the legacy
 *      `selectedSymbol` field AND pane 0 of `paneStates`, so the chart
 *      workspace, order details, and intelligence panel all reflect the
 *      new symbol.
 *   3. Strips the param from the URL via `router.replace` (no new history
 *      entry, preserves back/forward).
 *
 * The receiver is idempotent — re-applying the same symbol on re-render
 * is a no-op because `selectSymbol` only writes if the value differs.
 *
 * Must be rendered inside a <Suspense> boundary because it uses
 * useSearchParams().
 */
export function MarketsDeepLinkReceiver() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const appliedRef = useRef<string | null>(null);

  useEffect(() => {
    const symbol = searchParams.get("symbol");
    if (!symbol) return;
    // Normalize — markets symbols are uppercase by convention.
    const normalized = symbol.toUpperCase();
    if (appliedRef.current === normalized) return;

    // Validate against the catalog. If the user typos or follows a stale
    // link to a removed instrument, do NOT create a fake entry — just
    // strip the param and leave the current selection.
    const instrument = getInstrumentBySymbol(normalized);
    if (!instrument) {
      const next = new URLSearchParams(searchParams.toString());
      next.delete("symbol");
      const qs = next.toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      router.replace(url);
      appliedRef.current = normalized;
      return;
    }

    appliedRef.current = normalized;
    // selectSymbol writes to selectedSymbol AND mirrors into pane 0.
    useMarketsStore.getState().selectSymbol(normalized);

    // Strip the param AFTER the selection has been applied. router.replace
    // preserves back/forward navigation (no new history entry).
    const next = new URLSearchParams(searchParams.toString());
    next.delete("symbol");
    const qs = next.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    router.replace(url);
  }, [searchParams, router, pathname]);

  return null;
}
