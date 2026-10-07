"use client";

import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";

const retryKey = "lucian:isolation-navigation";
const subscribe = () => () => {};
const getIsolation = () => window.crossOriginIsolated;
const needsBrowserIsolation = (path: string) => path === "/dev-workspace" || path.startsWith("/dev-workspace/");

/** COOP/COEP belongs to a document, not a Next client-side route response. */
export function IsolationBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const needsIsolation = needsBrowserIsolation(pathname);
  // Ordinary routes can render on the server without a preparation screen.
  const serverIsolation = useCallback(() => needsIsolation ? null : false, [needsIsolation]);
  const isolated = useSyncExternalStore(subscribe, getIsolation, serverIsolation);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const target = new URL(anchor.href, window.location.href);
      if (target.origin !== window.location.origin || needsBrowserIsolation(target.pathname) === window.crossOriginIsolated) return;
      // Change the document headers directly, avoiding a client transition
      // followed by a second load. In-route links retain Next navigation.
      event.preventDefault();
      window.location.assign(target.href);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (window.crossOriginIsolated === needsIsolation) {
      try { sessionStorage.removeItem(retryKey); } catch { /* Storage may be disabled. */ }
      return;
    }
    // One full navigation per URL. Unsupported hosts must not reload forever.
    const target = window.location.href;
    try {
      if (sessionStorage.getItem(retryKey) === target) return;
      sessionStorage.setItem(retryKey, target);
    } catch {
      // Show a recoverable error rather than crash or enter a reload loop.
      return;
    }
    window.location.reload();
  }, [pathname, needsIsolation]);

  if (isolated === needsIsolation) return children;
  const failed = isolated !== null;
  return (
    <div className="themed flex min-h-full items-center justify-center bg-canvas p-8 text-fg">
      <div className="max-w-md space-y-4" role="status">
        <h1 className="text-xl font-semibold">{failed ? "Workspace needs browser isolation" : "Opening workspace"}</h1>
        <p className="text-sm text-fg-muted">
          {failed ? "The required browser security headers are unavailable. Your projects have not been changed." : "Preparing the working environment."}
        </p>
        {failed && <button className="rounded-md border border-line px-4 py-2 text-sm" onClick={() => {
          try { sessionStorage.removeItem(retryKey); } catch { /* Retry is explicit. */ }
          window.location.reload();
        }}>Retry</button>}
      </div>
    </div>
  );
}
