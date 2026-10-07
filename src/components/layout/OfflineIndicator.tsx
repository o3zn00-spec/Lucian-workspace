"use client";

/* LUCIAN Phase 17 — Offline indicator.
 *
 * A small, non-blocking banner shown at the top of the viewport when
 * `navigator.onLine === false`. The banner:
 *   - Distinguishes "LOCAL FUNCTION AVAILABLE" (with a list of features
 *     that still work: Settings, IndexedDB projects, editor buffers,
 *     local cached content) from "SERVER CONNECTION REQUIRED" (Vault,
 *     Markets live data, AI chats, cloud sync).
 *   - Does NOT fake successful server saves — server-side operations
 *     surface their own honest error states (503 / network-error).
 *   - Auto-hides when connectivity returns.
 *
 * Mounted once at the AppShell level so it persists across route changes.
 */

import { useEffect, useState } from "react";
import { WifiOff, X } from "lucide-react";

export function OfflineIndicator() {
  const [online, setOnline] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Defer setState past the effect body so the lint rule is satisfied.
    // Initial state and event listeners are wired up here; setState
    // calls happen on the network change events themselves.
    const t = setTimeout(() => {
      setOnline(navigator.onLine);
    }, 0);

    const handleOnline = () => {
      setOnline(true);
      setDismissed(false); // reset so the banner re-appears next time
    };
    const handleOffline = () => {
      setOnline(false);
      setDismissed(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      clearTimeout(t);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (online || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] flex justify-center p-2"
    >
      <div className="pointer-events-auto flex max-w-md items-start gap-2 rounded-md border border-warning/40 bg-surface px-3 py-2 text-[11px] shadow-lg">
        <WifiOff className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        <div className="flex-1">
          <div className="font-semibold text-fg">Offline — server connection required for some features</div>
          <div className="mt-0.5 text-fg-muted">
            <span className="font-medium text-success">Available:</span> Settings, IndexedDB projects, editor buffers, local cached content.
            <br />
            <span className="font-medium text-warning">Unavailable:</span> Vault, live market data, AI chats, cloud sync. Pending syncs will retry when you reconnect.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss offline indicator"
          className="shrink-0 rounded p-0.5 text-fg-muted hover:bg-hover hover:text-fg"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
