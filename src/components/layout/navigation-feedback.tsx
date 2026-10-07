"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { navigationLabelForPath } from "@/components/layout/navigation";

const NAVIGATION_EVENT = "lucian:navigation-start";

export function beginNavigationFeedback(target: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NAVIGATION_EVENT, { detail: target }));
}

/**
 * Small, persistent-shell feedback for client navigation. It reacts before
 * the destination renders, marks the exact clicked control as busy, and
 * suppresses repeated clicks on that same destination until navigation ends.
 */
export function NavigationFeedback() {
  const pathname = usePathname();
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const pendingTargetRef = useRef<string | null>(null);
  const pendingElementRef = useRef<HTMLElement | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
    const element = pendingElementRef.current;
    if (element) {
      element.removeAttribute("data-navigation-pending");
      element.removeAttribute("aria-busy");
    }
    pendingElementRef.current = null;
    pendingTargetRef.current = null;
    document.body.removeAttribute("data-navigation-pending");
    setPendingTarget(null);
  }, []);

  const begin = useCallback((target: string, element?: HTMLElement | null) => {
    if (!target || target === pathname || target.startsWith("#")) return;
    if (pendingTargetRef.current === target && element && pendingElementRef.current === element) return;
    if (pendingElementRef.current && pendingElementRef.current !== element) {
      pendingElementRef.current.removeAttribute("data-navigation-pending");
      pendingElementRef.current.removeAttribute("aria-busy");
    }
    pendingTargetRef.current = target;
    pendingElementRef.current = element ?? null;
    element?.setAttribute("data-navigation-pending", "true");
    element?.setAttribute("aria-busy", "true");
    document.body.setAttribute("data-navigation-pending", "true");
    setPendingTarget(target);
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(clear, 12_000);
  }, [clear, pathname]);

  useEffect(() => {
    const id = window.setTimeout(clear, 0);
    return () => window.clearTimeout(id);
  }, [pathname, clear]);

  useEffect(() => {
    const onNavigationEvent = (event: Event) => {
      const target = (event as CustomEvent<string>).detail;
      begin(target.split("?")[0]);
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const origin = event.target instanceof Element ? event.target : null;
      const control = origin?.closest<HTMLElement>("a[href], [data-navigation-target]");
      if (!control || control.getAttribute("target") === "_blank") return;
      const target = control.getAttribute("data-navigation-target") || control.getAttribute("href") || "";
      if (!target.startsWith("/")) return;
      if (pendingTargetRef.current === target && pendingElementRef.current === control) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      begin(target.split("?")[0], control);
    };
    window.addEventListener(NAVIGATION_EVENT, onNavigationEvent);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener(NAVIGATION_EVENT, onNavigationEvent);
      document.removeEventListener("click", onClick, true);
      clear();
    };
  }, [begin, clear]);

  if (!pendingTarget) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[200]" role="status" aria-live="polite">
      <div className="h-0.5 overflow-hidden bg-[var(--line-muted)]">
        <div className="lucian-navigation-progress h-full bg-[var(--accent)]" />
      </div>
      <div className="mx-auto mt-2 w-fit rounded-full border border-line bg-overlay/95 px-3 py-1 text-[10px] font-medium text-fg-muted shadow-pop backdrop-blur">
        Opening {navigationLabelForPath(pendingTarget)}…
      </div>
    </div>
  );
}
