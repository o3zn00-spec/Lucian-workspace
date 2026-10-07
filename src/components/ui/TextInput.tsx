"use client";

import { forwardRef, type InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  /** Optional label rendered above the input */
  label?: string;
  /** Optional helper text shown under the input */
  helper?: string;
  /** Show an error state (red border) + helper message */
  error?: string;
};

/**
 * Reusable text input primitive — theme-aware.
 *
 * Used by every Lucian dialog that needs a single text value (Rename
 * project, future import dialogs, etc.). For multi-field forms, prefer
 * composing multiple TextInput instances explicitly.
 */
export const TextInput = forwardRef<HTMLInputElement, Props>(function TextInput(
  { label, helper, error, className = "", id, ...rest },
  ref
) {
  return (
    <div className="flex flex-col gap-1.5">
      {label ? (
        <label htmlFor={id} className="text-xs font-medium text-fg-muted">
          {label}
        </label>
      ) : null}
      <input
        ref={ref}
        id={id}
        className={`focus-ring themed h-9 w-full rounded-md border bg-inset px-3 text-sm text-fg placeholder:text-fg-faint ${
          error
            ? "border-[color-mix(in_srgb,var(--accent)_55%,var(--line))]"
            : "border-line"
        } ${className}`}
        {...rest}
      />
      {error ? (
        <p className="text-xs text-[color-mix(in_srgb,var(--accent)_85%,var(--fg))]">{error}</p>
      ) : helper ? (
        <p className="text-xs text-fg-faint">{helper}</p>
      ) : null}
    </div>
  );
});
