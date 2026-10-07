import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  /** Optional small descriptor shown under the title */
  description?: ReactNode;
  /** Optional actions rendered on the right side */
  actions?: ReactNode;
  className?: string;
}

/**
 * Standard page header used at the top of internal pages.
 *
 * Provides consistent:
 * - page title typography
 * - optional description
 * - right-aligned actions row
 * - responsive behavior (stacks on small screens)
 */
export function PageHeader({
  title,
  description,
  actions,
  className = "",
}: PageHeaderProps) {
  return (
    <div
      className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight text-fg">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-fg-muted">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
