import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  /** Optional padding override — defaults to `p-4` */
  padding?: "none" | "sm" | "md" | "lg";
  as?: "div" | "section" | "article";
}

const PADDING_CLASSES = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
} as const;

/**
 * Generic surface card — theme-aware border + surface background.
 *
 * Intentionally minimal so it can serve as a building block for many use
 * cases: lists, panels, dialog bodies, etc.
 */
export function Card({
  children,
  className = "",
  padding = "md",
  as: Tag = "div",
}: CardProps) {
  return (
    <Tag
      className={`themed rounded-lg border border-line bg-surface shadow-sm ${PADDING_CLASSES[padding]} ${className}`}
    >
      {children}
    </Tag>
  );
}
