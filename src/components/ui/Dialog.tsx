"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Visible title in the dialog header */
  title: string;
  /** Accessible label for the dialog as a whole */
  ariaLabel?: string;
  /** Optional max width class — defaults to `max-w-md`. */
  maxWidthClass?: string;
  children: ReactNode;
  /** Optional footer (action buttons etc.) */
  footer?: ReactNode;
}

/**
 * Reusable modal/dialog primitive used by all Lucian dialogs.
 *
 * Behavior:
 * - Renders nothing when `open` is false (so initial mount is clean).
 * - Escape key closes the dialog.
 * - Backdrop click closes the dialog.
 * - Body scroll is locked while open and restored on close.
 * - Focus is moved to the close button on open (so keyboard users have an
 *   obvious escape hatch and Tab cannot leak to the page underneath).
 * - The dialog has `role="dialog"` + `aria-modal="true"`.
 *
 * Not a true focus trap — for a Phase 3 import / rename / delete dialog
 * that's a reasonable tradeoff. The Settings modal could be migrated to
 * use this primitive in a future cleanup pass.
 */
export function Dialog({
  open,
  onClose,
  title,
  ariaLabel,
  maxWidthClass = "max-w-md",
  children,
  footer,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusTimer = window.setTimeout(() => {
      closeBtnRef.current?.focus();
    }, 0);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? title}
    >
      <div
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        className={`themed relative flex w-full ${maxWidthClass} flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pop`}
      >
        <div className="themed flex h-13 shrink-0 items-center justify-between border-b border-line-muted px-4 sm:px-5">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          <IconButton ref={closeBtnRef} label="Close dialog" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">{children}</div>
        {footer ? (
          <div className="themed flex shrink-0 items-center justify-end gap-2 border-t border-line-muted px-4 py-3 sm:px-5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
