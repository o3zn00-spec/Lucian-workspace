import type { ReactNode } from "react";

interface EmptyStateProps {
  /** Heading — typically one short sentence */
  title: string;
  /** Optional supporting description */
  description?: ReactNode;
  /** Optional icon node (typically a lucide-react icon) */
  icon?: ReactNode;
  /** Optional actions (buttons, links, etc.) — rendered in a row */
  actions?: ReactNode;
  className?: string;
}

/**
 * Standard empty-state component.
 *
 * Used when a view or list has no items yet — e.g. the Projects page when
 * the user has not created any projects. Designed to look intentional rather
 * than unfinished, with generous spacing and muted typography.
 */
export function EmptyState({
  title,
  description,
  icon,
  actions,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`themed flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-surface-2/40 px-6 py-16 text-center ${className}`}
    >
      {icon ? (
        <div className="themed mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface text-fg-faint">
          {icon}
        </div>
      ) : null}
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-fg-muted">
          {description}
        </p>
      ) : null}
      {actions ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
