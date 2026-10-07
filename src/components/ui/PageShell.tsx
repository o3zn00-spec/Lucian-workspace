import type { ReactNode } from "react";

interface PageShellProps {
  children: ReactNode;
  /**
   * Constrain the content width. Most pages want `default` (max-w-5xl),
   * wide dashboards want `wide`, and centered empty states want `narrow`.
   */
  width?: "narrow" | "default" | "wide";
  className?: string;
}

const WIDTH_CLASSES = {
  narrow: "max-w-3xl",
  default: "max-w-5xl",
  wide: "max-w-7xl",
} as const;

/**
 * Reusable internal page shell.
 *
 * Wraps every page rendered inside AppShell so that page padding, content
 * width, and vertical spacing are consistent without each page re-implementing
 * the layout. Pages should compose <PageHeader> + content blocks inside this.
 */
export function PageShell({
  children,
  width = "default",
  className = "",
}: PageShellProps) {
  return (
    <div
      className={`mx-auto w-full ${WIDTH_CLASSES[width]} px-4 py-6 sm:px-6 lg:px-8 ${className}`}
    >
      {children}
    </div>
  );
}
