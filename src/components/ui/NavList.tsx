"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, ReactNode } from "react";
import { Tooltip } from "@/components/ui/Tooltip";

function NavPendingIndicator() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`nav-pending-indicator ml-auto h-3 w-3 shrink-0 rounded-full border border-fg-faint border-t-[var(--accent)] ${pending ? "is-pending" : ""}`}
    />
  );
}

export interface NavItem {
  /** Stable key */
  id: string;
  /** Route path (use Next.js path conventions, e.g. "/" or "/projects") */
  href: string;
  /** Visible label (also used for tooltip in collapsed state) */
  label: string;
  /** lucide-react icon component */
  icon: ComponentType<{ size?: number | string; className?: string }>;
  /** Legacy paths that should keep this item highlighted. */
  aliases?: string[];
}

/** A section of navigation items with an optional heading. */
export interface NavSection {
  /** Section heading (hidden when collapsed). */
  heading?: string;
  /** Items in this section. */
  items: NavItem[];
}

interface NavListProps {
  /** A flat list of items (no sections). */
  items?: NavItem[];
  /** Sectioned list (takes precedence over `items` when both are provided). */
  sections?: NavSection[];
  /** When true, render as an icon-only rail (labels + tooltips on hover) */
  collapsed?: boolean;
  /** Optional heading shown above the list (hidden when collapsed) */
  heading?: string;
  /** Called after a navigation item is clicked (e.g. to close mobile drawer) */
  onNavigate?: () => void;
}

/**
 * Reusable vertical navigation list used by both the expanded sidebar and
 * the collapsed desktop rail. Active state is derived from the current
 * pathname (exact match for "/", startsWith for nested routes).
 *
 * Supports both flat `items` and sectioned `sections` props. When sections
 * are provided, each section gets a subtle heading + a divider between
 * sections (in expanded mode) or a spacer (in collapsed mode).
 */
export function NavList({
  items,
  sections,
  collapsed = false,
  heading,
  onNavigate,
}: NavListProps) {
  const pathname = usePathname();

  // Normalize: if sections not provided, wrap items in a single section.
  const allSections: NavSection[] = sections ?? [
    { heading, items: items ?? [] },
  ];

  return (
    <div className="space-y-0.5">
      {allSections.map((section, sIdx) => (
        <div key={sIdx}>
          {/* Section divider (between sections, not before the first) */}
          {sIdx > 0 && !collapsed ? (
            <div className="my-1.5 h-px bg-line-muted" />
          ) : null}
          {sIdx > 0 && collapsed ? (
            <div className="my-1.5 h-px bg-line-muted mx-3" />
          ) : null}

          {/* Section heading */}
          {section.heading && !collapsed ? (
            <div className="px-2.5 pb-1 pt-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
                {section.heading}
              </span>
            </div>
          ) : null}

          {/* Items */}
          <div className={collapsed ? "flex flex-col items-stretch gap-0.5" : "space-y-0"}>
            {section.items.map(({ id, href, label, icon: Icon, aliases = [] }) => {
              const activePaths = [href, ...aliases];
              const active =
                activePaths.some((path) => path === "/"
                  ? pathname === "/"
                  : pathname === path || pathname.startsWith(`${path}/`));

              const link = (
                <Link
                  key={id}
                  href={href}
                  data-navigation-target={href}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                  className={`focus-ring themed relative flex items-center rounded-md transition-colors ${
                    collapsed
                      ? "h-9 w-9 mx-auto justify-center"
                      : "gap-2.5 px-2.5 py-1.5"
                  } ${
                    active
                      ? "bg-active font-medium text-fg"
                      : "text-fg-muted hover:bg-hover hover:text-fg"
                  }`}
                >
                  {active && !collapsed ? (
                    <span className="absolute -left-3 top-1/2 h-5 w-0.75 -translate-y-1/2 rounded-r bg-accent" />
                  ) : null}
                  <Icon
                    size={collapsed ? 18 : 15}
                    className={active ? "text-accent" : "text-fg-faint"}
                  />
                  {!collapsed ? <span className="text-sm">{label}</span> : null}
                  {!collapsed ? <NavPendingIndicator /> : null}
                </Link>
              );

              if (collapsed) {
                return (
                  <Tooltip key={id} label={label} side="right">
                    {link}
                  </Tooltip>
                );
              }
              return link;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

interface NavListRailSpacerProps {
  children?: ReactNode;
}

/** Tiny helper so the rail can have section breaks without re-styling. */
export function NavListRailSpacer({ children }: NavListRailSpacerProps) {
  return <div className="my-2 h-px bg-line-muted">{children}</div>;
}
