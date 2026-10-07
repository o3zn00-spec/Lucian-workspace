"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, ChevronRight, X, Loader2 } from "lucide-react";
import { globalSearch, type SearchGroup } from "@/lib/search/global-search";
import { useGlobalSearchStore } from "@/store/global-search";
import { useNotificationStore } from "@/store/notifications";
import { shouldMaskSensitive } from "@/lib/regional-format";
import { cn } from "@/lib/utils";
import { beginNavigationFeedback } from "@/components/layout/navigation-feedback";

/**
 * Global Search Overlay — canonical, single instance.
 *
 * Phase 9: mounted ONCE at the AppShell level. Reads open/close state
 * from `useGlobalSearchStore` so Home search, TopNav search, the keyboard
 * shortcut, and any other trigger all open the SAME overlay.
 *
 * The same UI/design as Phase 8 — only the wiring + ranking + provider
 * architecture changed.
 */
export function GlobalSearchOverlay() {
  const router = useRouter();
  const open = useGlobalSearchStore((s) => s.open);
  const initialQuery = useGlobalSearchStore((s) => s.initialQuery);
  const close = useGlobalSearchStore((s) => s.close);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchGroup[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Token to ignore stale async results when the user types faster than
  // providers resolve.
  const reqIdRef = useRef(0);

  // When the overlay opens (or the seeded query changes), reset local
  // state to match. Defers setState to a microtask to avoid synchronous
  // setState-in-effect cascading renders (React 19 rule).
  useEffect(() => {
    if (!open) {
      // Defer cleanup so we don't call setState synchronously inside the effect.
      const id = window.setTimeout(() => {
        setResults([]);
        setSelectedIdx(0);
        setSearching(false);
      }, 0);
      return () => window.clearTimeout(id);
    }
    // Defer focus + query seeding to next tick so the input is mounted
    // before focus() AND to avoid synchronous setState in the effect body.
    const id = window.setTimeout(() => {
      setQuery(initialQuery ?? "");
      inputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, initialQuery]);

  // Debounced async search. Cancels stale requests via reqIdRef.
  // All setState calls happen inside async callbacks (setTimeout) so
  // they don't fire synchronously during the effect body.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      const id = window.setTimeout(() => {
        setResults([]);
        setSelectedIdx(0);
        setSearching(false);
      }, 0);
      return () => window.clearTimeout(id);
    }
    const reqId = ++reqIdRef.current;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      try {
        const groups = await globalSearch(query);
        // Drop the result if a newer search has superseded this one.
        if (reqIdRef.current !== reqId) return;
        setResults(groups);
        setSelectedIdx(0);
      } catch {
        if (reqIdRef.current !== reqId) return;
        setResults([]);
      } finally {
        if (reqIdRef.current === reqId) setSearching(false);
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [query]);

  const openResult = useCallback(
    (result: { id: string; deepLink?: string; module?: string }) => {
      // Phase 9 wrap-up: notification results without a deepLink open the
      // existing Notification Center (mounted in TopNav) and focus the
      // exact record. We do NOT create a fake /notifications module — we
      // set focusedId on the canonical notification store, which the
      // Notification Center reads to scroll + highlight the row.
      if (!result.deepLink) {
        if (result.module === "notifications" && result.id.startsWith("ntf-")) {
          // Extract the underlying notification id from the search result id.
          // Search result ids for notifications are shaped `ntf-<id>`.
          const notificationId = result.id.slice("ntf-".length);
          useNotificationStore.getState().setFocusedId(notificationId);
          // Open the Notification Center via a CustomEvent the TopNav
          // listens for. This avoids coupling the search overlay to the
          // TopNav's local notifOpen state.
          window.dispatchEvent(new CustomEvent("lucian:open-notifications"));
        }
        close();
        return;
      }
      // External http(s) URLs open in a new tab; internal deep links
      // route through Next.js.
      if (result.deepLink.startsWith("http")) {
        window.open(result.deepLink, "_blank", "noopener,noreferrer");
      } else {
        beginNavigationFeedback(result.deepLink);
        router.push(result.deepLink);
      }
      close();
    },
    [router, close],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      const total = results.reduce((s, g) => s + g.results.length, 0);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => (total > 0 ? Math.min(i + 1, total - 1) : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const flat = results.flatMap((g) => g.results);
        if (flat[selectedIdx]) openResult(flat[selectedIdx]);
      }
    },
    [results, selectedIdx, close, openResult],
  );

  if (!open) return null;

  const totalResults = results.reduce((s, g) => s + g.results.length, 0);
  let flatIdx = 0;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center p-4 pt-[10vh]"
      onClick={close}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="themed relative w-full max-w-2xl overflow-hidden rounded-lg border border-line bg-surface shadow-pop"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-line-muted px-4 py-3">
          <Search className="h-4 w-4 text-fg-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search anything in LUCIAN..."
            className="flex-1 bg-transparent text-[14px] text-fg placeholder:text-fg-faint focus:outline-none"
          />
          {searching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-fg-faint" />
          ) : (
            <kbd className="rounded border border-line px-1.5 py-0.5 text-[9px] text-fg-faint">ESC</kbd>
          )}
          <button onClick={close} className="text-fg-faint hover:text-fg" aria-label="Close search">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {query.trim() && !searching && totalResults === 0 ? (
            <div className="py-8 text-center text-[12px] text-fg-faint">
              No results for &quot;{query}&quot;
            </div>
          ) : !query.trim() ? (
            <div className="py-8 text-center text-[12px] text-fg-faint">
              Start typing to search LUCIAN...
            </div>
          ) : searching && totalResults === 0 ? (
            <div className="py-8 text-center text-[12px] text-fg-faint">Searching…</div>
          ) : (
            <div className="py-1">
              {results.map((group) => (
                <div key={group.module}>
                  <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wide text-fg-faint">
                    {group.moduleLabel}
                  </div>
                  {group.results.map((result) => {
                    const idx = flatIdx++;
                    // Privacy: mask sensitive values in the snippet when
                    // the Global Search mask toggle (or privacy mode) is on.
                    // The underlying search result is NOT modified.
                    const displaySnippet = result.snippet && shouldMaskSensitive("search")
                      ? maskSearchSnippet(result.snippet)
                      : result.snippet;
                    return (
                      <button
                        key={result.id}
                        onClick={() => openResult(result)}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                          idx === selectedIdx ? "bg-active" : "hover:bg-hover",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12px] font-medium text-fg">{result.title}</p>
                          {displaySnippet && (
                            <p className="truncate text-[10px] text-fg-faint">{displaySnippet}</p>
                          )}
                        </div>
                        <ChevronRight className="h-3 w-3 shrink-0 text-fg-faint" />
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Mask sensitive values in a search snippet. Replaces currency amounts
 * and 4+ digit runs (account numbers, card last-4) with bullets. The
 * underlying search result is NEVER modified — only the rendered string.
 */
function maskSearchSnippet(snippet: string): string {
  if (!snippet) return snippet;
  let masked = snippet.replace(
    /(?:\$|€|£|¥)?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s?(?:USD|EUR|GBP|JPY|BTC|ETH|USDC)?/g,
    (match) => match.trim().length > 0 ? "••••" : match,
  );
  masked = masked.replace(/\b\d{4,}\b/g, "••••");
  return masked;
}
