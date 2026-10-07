"use client";

import { useId, useRef, useState, type ReactNode } from "react";

interface TooltipProps {
  /** Tooltip text */
  label: string;
  /** Preferred side; will flip if no room (basic best-effort, no JS measurement) */
  side?: "top" | "right" | "bottom" | "left";
  /** The element the tooltip wraps; must accept mouse + focus events */
  children: ReactNode;
  /** Disable the tooltip (e.g. when the label is already visible) */
  disabled?: boolean;
}

const SIDE_CLASSES: Record<NonNullable<TooltipProps["side"]>, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
  right: "left-full top-1/2 -translate-y-1/2 ml-1.5",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
  left: "right-full top-1/2 -translate-y-1/2 mr-1.5",
};

/**
 * Lightweight tooltip primitive — no dependencies.
 *
 * Behavior:
 * - Appears on hover and on keyboard focus (so keyboard users also see hints)
 * - Disappears on blur / mouse leave
 * - Small delay so it doesn't flicker during fast pointer moves
 *
 * Accessibility:
 * - Wraps children in a <span> with `aria-describedby` pointing to the
 *   tooltip text; the tooltip itself is `role="tooltip"`.
 * - Children should already be focusable (a button, link, or input).
 *   If not, set tabIndex on the child manually.
 */
export function Tooltip({
  label,
  side = "right",
  children,
  disabled = false,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tipId = useId();

  function show() {
    if (disabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(true), 250);
  }
  function hide() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOpen(false);
  }

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span aria-describedby={open ? tipId : undefined}>{children}</span>
      {open && !disabled ? (
        <span
          role="tooltip"
          id={tipId}
          className={`themed pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-line bg-overlay px-2 py-1 text-xs font-medium text-fg shadow-pop ${SIDE_CLASSES[side]}`}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}
