"use client";

/* LUCIAN Economy Hub — shared components. */

import { cn } from "@/lib/utils";
import {
  STATUS_LABELS,
  BUSINESS_STATUS_LABELS,
  RESEARCH_TYPE_LABELS,
  type OpportunityStatus,
  type BusinessStatus,
} from "@/store/economy-hub";

const STATUS_COLORS: Record<OpportunityStatus, string> = {
  discovered: "bg-blue-500/15 text-blue-400",
  researching: "bg-cyan-500/15 text-cyan-400",
  shortlisted: "bg-violet-500/15 text-violet-400",
  testing: "bg-amber-500/15 text-amber-400",
  approved: "bg-teal-500/15 text-teal-400",
  building: "bg-indigo-500/15 text-indigo-400",
  launched: "bg-green-500/15 text-green-400",
  operating: "bg-emerald-500/15 text-emerald-400",
  profitable: "bg-green-500/15 text-green-400",
  failed: "bg-red-500/15 text-red-400",
  paused: "bg-gray-500/15 text-gray-400",
  rejected: "bg-red-500/15 text-red-400",
};

export function StatusBadge({ status }: { status: OpportunityStatus }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
        STATUS_COLORS[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

const BIZ_STATUS_COLORS: Record<BusinessStatus, string> = {
  planning: "bg-blue-500/15 text-blue-400",
  building: "bg-indigo-500/15 text-indigo-400",
  launching: "bg-violet-500/15 text-violet-400",
  operating: "bg-green-500/15 text-green-400",
  paused: "bg-gray-500/15 text-gray-400",
  closed: "bg-red-500/15 text-red-400",
};

export function BusinessStatusBadge({ status }: { status: BusinessStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
        BIZ_STATUS_COLORS[status],
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", BIZ_STATUS_COLORS[status].split(" ")[0].replace("/15", ""))} />
      {BUSINESS_STATUS_LABELS[status]}
    </span>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? "text-green-400" : score >= 60 ? "text-amber-400" : "text-fg-muted";
  return (
    <span className={cn("font-mono text-[11px] font-bold tabular-nums", color)}>
      {score}
      <span className="text-fg-faint">/100</span>
    </span>
  );
}

export function StatCard({
  label,
  value,
  onClick,
  active,
}: {
  label: string;
  value: number;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "rounded-md border px-3 py-2 text-left transition-colors",
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/5"
          : "border-line bg-surface",
        onClick && "hover:border-fg-faint",
      )}
    >
      <div className="text-[9px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className="mt-0.5 font-mono text-[18px] font-bold tabular-nums text-fg">{value}</div>
    </button>
  );
}

export function PipelineStage({
  label,
  count,
  onClick,
  active,
}: {
  label: string;
  count: number;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "flex min-w-[80px] flex-col items-center rounded-md border px-2 py-1.5 transition-colors",
        active
          ? "border-[var(--accent)] bg-[var(--accent)]/5"
          : "border-line bg-surface",
        onClick && "hover:border-fg-faint",
      )}
    >
      <span className="text-[9px] font-medium uppercase tracking-wide text-fg-faint">{label}</span>
      <span className="mt-0.5 font-mono text-[16px] font-bold tabular-nums text-fg">{count}</span>
    </button>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
      {children}
    </h3>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <p className="text-[13px] font-medium text-fg-muted">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-[11px] text-fg-faint">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 86400000 * 2) return "yesterday";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
