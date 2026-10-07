"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
};

/**
 * Compact GitHub-style square icon button with border, hover and focus states.
 */
export const IconButton = forwardRef<HTMLButtonElement, Props>(
  function IconButton({ label, className = "", children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        className={`focus-ring themed inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-fg-muted transition-colors hover:bg-hover hover:text-fg active:bg-active ${className}`}
        {...rest}
      >
        {children}
      </button>
    );
  }
);
