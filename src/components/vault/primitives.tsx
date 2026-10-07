"use client";

// LUCIAN Vault — shared UI primitives.
// Premium financial dashboard styling, restrained cards, subtle borders.

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { type VaultTransactionStatus } from "@/store/vault";

/* ── Card ── */
export function VaultCard({
  children,
  className,
  inset = false,
}: {
  children: ReactNode;
  className?: string;
  inset?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line-muted bg-surface themed",
        inset && "bg-inset",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function VaultCardHeader({
  title,
  subtitle,
  action,
  icon,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line-muted px-4 py-3 sm:px-5">
      <div className="flex items-center gap-2.5">
        {icon && <span className="text-fg-muted">{icon}</span>}
        <div>
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-fg">
            {title}
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-[11px] text-fg-muted">{subtitle}</p>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

export function VaultCardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("p-4 sm:p-5", className)}>{children}</div>;
}

/* ── Stat block ── */
export function VaultStat({
  label,
  value,
  hint,
  positive,
  negative,
  muted,
}: {
  label: string;
  value: string;
  hint?: string;
  positive?: boolean;
  negative?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="themed">
      <div className="text-[10px] font-medium uppercase tracking-wider text-fg-faint">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-[15px] font-semibold tabular-nums tracking-tight",
          positive && "text-[var(--accent)]",
          negative && "text-red-400",
          muted && "text-fg-muted",
          !positive && !negative && !muted && "text-fg",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[10px] text-fg-faint">{hint}</div>}
    </div>
  );
}

/* ── Status pill ── */
const STATUS_STYLES: Record<VaultTransactionStatus, string> = {
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  processing: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  "requires-action": "bg-purple-500/10 text-purple-400 border-purple-500/30",
  completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/10 text-red-400 border-red-500/30",
  cancelled: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30",
  requested: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
};

export function StatusPill({ status }: { status: VaultTransactionStatus }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1).replace("-", " ");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide themed",
        STATUS_STYLES[status],
      )}
    >
      {label}
    </span>
  );
}

/* ── Source badge ── */
export function SourceBadge({ source }: { source: "manual" | "provider" }) {
  if (source === "provider") {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-400 themed">
        <span className="h-1 w-1 rounded-full bg-emerald-400" />
        Connected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-400 themed">
      Manual
    </span>
  );
}

/* ── Provider status banner ── */
export function ProviderNotConnectedBanner({
  message = "Provider not connected. Live balances and real-money flows require provider setup.",
}: {
  message?: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 themed">
      <span className="text-amber-400">⚠</span>
      <p className="text-[11px] text-amber-200/80">{message}</p>
    </div>
  );
}

/* ── Empty state ── */
export function VaultEmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-line-muted bg-inset/40 px-6 py-8 text-center themed">
      {icon && <div className="text-fg-faint">{icon}</div>}
      <h4 className="mt-2 text-[12px] font-semibold text-fg">{title}</h4>
      {description && (
        <p className="mt-1 max-w-sm text-[11px] text-fg-muted">{description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/* ── Card brand badge ── */
export function CardBrandBadge({ brand }: { brand: string }) {
  const styles: Record<string, string> = {
    visa: "bg-blue-500/10 text-blue-300 border-blue-500/30",
    mastercard: "bg-orange-500/10 text-orange-300 border-orange-500/30",
    amex: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
    discover: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    unknown: "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
  };
  const label = brand.charAt(0).toUpperCase() + brand.slice(1);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide themed",
        styles[brand] ?? styles.unknown,
      )}
    >
      {label}
    </span>
  );
}
