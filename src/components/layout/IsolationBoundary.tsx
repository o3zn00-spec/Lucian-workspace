"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";

const retryKey = "lucian:isolation-navigation";
const subscribe = () => () => {};
const getIsolation = () => window.crossOriginIsolated;
const serverIsolation = () => null;

/** COOP/COEP belongs to a document, not a Next client-side route response. */
export function IsolationBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const needsIsolation = pathname === "/dev-workspace" || pathname.startsWith("/dev-workspace/");
  const isolated = useSyncExternalStore(subscribe, getIsolation, serverIsolation);

  useEffect(() => {
    if (window.crossOriginIsolated === needsIsolation) {
      sessionStorage.removeItem(retryKey);
      return;
    }
    // One full navigation per URL. Unsupported hosts must not reload forever.
    const target = window.location.href;
    if (sessionStorage.getItem(retryKey) === target) {
      return;
    }
    sessionStorage.setItem(retryKey, target);
    window.location.reload();
  }, [pathname, needsIsolation]);

  if (isolated === needsIsolation) return children;
  const failed = isolated !== null;
  return (
    <main className="themed flex min-h-dvh items-center justify-center bg-canvas p-8 text-fg">
      <div className="max-w-md space-y-4" role="status">
        <h1 className="text-xl font-semibold">{failed ? "Workspace needs browser isolation" : "Opening workspace"}</h1>
        <p className="text-sm text-fg-muted">
          {failed ? "The required browser security headers are unavailable. Your projects have not been changed." : "Preparing the working environment."}
        </p>
        {failed && <button className="rounded-md border border-line px-4 py-2 text-sm" onClick={() => {
          sessionStorage.removeItem(retryKey);
          window.location.reload();
        }}>Retry</button>}
      </div>
    </main>
  );
}
