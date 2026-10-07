import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const VARIANT_CLASSES: Record<Variant, string> = {
  // Accent-driven primary action
  primary:
    "bg-accent text-accent-fg hover:bg-accent-hover active:bg-accent-active border border-transparent",
  // Quiet secondary (default for most actions)
  secondary:
    "bg-surface text-fg-muted hover:bg-hover hover:text-fg active:bg-active border border-line",
  // Minimal — for toolbar-style actions that only need hover affordance
  ghost:
    "bg-transparent text-fg-muted hover:bg-hover hover:text-fg active:bg-active border border-transparent",
  // Destructive — visually distinct without introducing a new color token
  danger:
    "bg-transparent text-fg-muted hover:bg-hover hover:text-fg active:bg-active border border-line",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-[13px] gap-1.5",
  md: "h-8 px-3 text-sm gap-2",
};

/**
 * Reusable button primitive.
 *
 * - `primary`   → accent-filled (use sparingly for the primary action on a page)
 * - `secondary` → bordered surface button (default for most actions)
 * - `ghost`     → no border, only hover bg (toolbar-style)
 * - `danger`    → currently same look as secondary; reserved for future destructive actions
 *
 * The button respects the active theme + accent automatically through CSS
 * variables, so no per-theme special-casing is needed.
 */
export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "secondary", size = "md", className = "", children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`focus-ring themed inline-flex select-none items-center justify-center rounded-md font-medium leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});
