"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Composer menus must escape every scrolling/clipping ancestor. */
export function ComposerPopover({ children, className = "", onClose }: { children: ReactNode; className?: string; onClose?: () => void }) {
  const marker = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8, visible: false });
  useLayoutEffect(() => {
    const place = () => {
      const anchor = marker.current?.parentElement?.getBoundingClientRect();
      const menu = panel.current?.getBoundingClientRect();
      if (!anchor || !menu) return;
      const above = anchor.top - menu.height - 8;
      setPosition({ left: Math.max(8, Math.min(anchor.right - menu.width, window.innerWidth - menu.width - 8)), top: Math.max(8, above >= 8 ? above : Math.min(anchor.bottom + 8, window.innerHeight - menu.height - 8)), visible: true });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", key);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); document.removeEventListener("keydown", key); };
  }, [onClose]);
  return <><span ref={marker} />{typeof document !== "undefined" && createPortal(<div ref={panel} data-composer-popover className={`themed fixed z-[180] max-w-[calc(100vw-16px)] max-h-[calc(100dvh-16px)] overflow-y-auto rounded-2xl border border-line bg-overlay p-1 shadow-pop ${className}`} style={{ left: position.left, top: position.top, visibility: position.visible ? "visible" : "hidden" }}>{children}</div>, document.body)}</>;
}
