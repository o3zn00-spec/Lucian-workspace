"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, CheckCheck, Bell, Trash2, RotateCcw } from "lucide-react";
import { useNotificationStore, type AppNotification } from "@/store/notifications";
import { shouldMaskSensitive } from "@/lib/regional-format";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-devspace/dialog";
import { Button } from "@/components/ui-devspace/button";
import { cn } from "@/lib/utils";
import { beginNavigationFeedback } from "@/components/layout/navigation-feedback";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NotificationCenter({ open, onClose }: Props) {
  const router = useRouter();
  const notifications = useNotificationStore((s) => s.notifications);
  const markRead = useNotificationStore((s) => s.markRead);
  const markAllRead = useNotificationStore((s) => s.markAllRead);
  const dismiss = useNotificationStore((s) => s.dismiss);
  const clearAllVisible = useNotificationStore((s) => s.clearAllVisible);
  const resolve = useNotificationStore((s) => s.resolve);
  const focusedId = useNotificationStore((s) => s.focusedId);
  const setFocusedId = useNotificationStore((s) => s.setFocusedId);
  const [filter, setFilter] = useFilter();
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Phase 10: when a focusedId is set (from Global Search), auto-scroll
  // the target row into view + clear focus after a few seconds.
  const focusedRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open || !focusedId) return;
    // Allow the render to land, then scroll.
    const id = window.setTimeout(() => {
      focusedRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
    // Auto-clear focus after 6 seconds so it doesn't linger.
    const clearId = window.setTimeout(() => setFocusedId(null), 6000);
    return () => {
      window.clearTimeout(id);
      window.clearTimeout(clearId);
    };
  }, [open, focusedId, setFocusedId]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const id = setTimeout(() => {
      document.addEventListener("mousedown", handler);
      document.addEventListener("keydown", keyHandler);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [open, onClose]);

  // Active = not dismissed. Resolved notifications stay in the list (so
  // the user can see the recovery) but are visually muted.
  const active = useMemo(
    () => notifications.filter((n) => !n.dismissed),
    [notifications],
  );
  const filtered = useMemo(
    () => (filter === "unread" ? active.filter((n) => !n.read && !n.resolved) : active),
    [active, filter],
  );
  const unreadCount = useMemo(
    () => active.filter((n) => !n.read && !n.resolved).length,
    [active],
  );

  // Group by date
  const today: AppNotification[] = [];
  const yesterday: AppNotification[] = [];
  const older: AppNotification[] = [];
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  for (const n of filtered) {
    if (n.timestamp >= todayStart) today.push(n);
    else if (n.timestamp >= yesterdayStart) yesterday.push(n);
    else older.push(n);
  }

  const handleClick = (n: AppNotification) => {
    markRead(n.id);
    if (n.deepLink) {
      beginNavigationFeedback(n.deepLink);
      router.push(n.deepLink);
      onClose();
    }
    // If no deep link, keep the Notification Center open so the user can
    // see the highlighted record (Phase 9 wrap-up: search → notification
    // without deepLink → focus in place).
  };

  const handleDismiss = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    dismiss(id);
  };

  const handleResolve = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    resolve(id);
  };

  // FIX (Phase 14 lock pass): the panel + backdrop MUST NOT render when
  // `open === false`. Previously both divs were always mounted, which
  // meant the fixed-position backdrop (z-[150]) and the panel itself
  // (z-[151]) intercepted pointer events across the entire application
  // even when the user had closed the Notification Center. We now
  // return null when closed — no animation requires the nodes to stay
  // mounted (the panel is fully unmounted/remounted on each open), so
  // conditional rendering is the cleanest correct fix.
  if (!open) return null;

  return (
    <>
      {/* Mobile backdrop */}
      <div className="fixed inset-0 z-[150] bg-black/30 md:hidden" onClick={onClose} />
      <div
        ref={ref}
        className="themed fixed right-0 top-14 z-[151] flex h-[calc(100vh-3.5rem)] w-full flex-col border-l border-line bg-surface shadow-pop md:w-[400px]"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-line-muted px-4 py-3">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-fg-muted" />
            <h2 className="text-[14px] font-semibold text-fg">Notifications</h2>
            {unreadCount > 0 && <span className="rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--accent-fg)]">{unreadCount}</span>}
          </div>
          <button type="button" aria-label="Close notifications" onClick={onClose} className="text-fg-muted hover:text-fg"><X className="h-4 w-4" /></button>
        </div>

        {/* Filter + Mark all + Clear all */}
        <div className="flex shrink-0 items-center justify-between border-b border-line-muted px-3 py-2">
          <div className="flex gap-1">
            <button onClick={() => setFilter("all")} className={cn("rounded px-2 py-0.5 text-[10px] font-medium", filter === "all" ? "bg-active text-fg" : "text-fg-muted hover:text-fg")}>All</button>
            <button onClick={() => setFilter("unread")} className={cn("rounded px-2 py-0.5 text-[10px] font-medium", filter === "unread" ? "bg-active text-fg" : "text-fg-muted hover:text-fg")}>Unread</button>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={markAllRead} disabled={unreadCount === 0} className="flex items-center gap-1 text-[10px] text-fg-muted hover:text-fg disabled:opacity-30">
              <CheckCheck className="h-3 w-3" /> Mark all read
            </button>
            <button
              onClick={() => setConfirmClearOpen(true)}
              disabled={active.length === 0}
              className="flex items-center gap-1 text-[10px] text-fg-muted hover:text-fg disabled:opacity-30"
              title="Clear all visible notifications"
            >
              <Trash2 className="h-3 w-3" /> Clear all
            </button>
          </div>
        </div>

        {/* List — independent scroll */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="h-8 w-8 text-fg-faint opacity-30" />
              <p className="mt-2 text-[12px] text-fg-muted">No notifications</p>
            </div>
          ) : (
            <div>
              {today.length > 0 && (
                <DateGroup
                  label="Today"
                  items={today}
                  onClick={handleClick}
                  onDismiss={handleDismiss}
                  onResolve={handleResolve}
                  focusedId={focusedId}
                  focusedRef={focusedRef}
                />
              )}
              {yesterday.length > 0 && (
                <DateGroup
                  label="Yesterday"
                  items={yesterday}
                  onClick={handleClick}
                  onDismiss={handleDismiss}
                  onResolve={handleResolve}
                  focusedId={focusedId}
                  focusedRef={focusedRef}
                />
              )}
              {older.length > 0 && (
                <DateGroup
                  label="Previous"
                  items={older}
                  onClick={handleClick}
                  onDismiss={handleDismiss}
                  onResolve={handleResolve}
                  focusedId={focusedId}
                  focusedRef={focusedRef}
                />
              )}
            </div>
          )}
        </div>

        {/* Phase 10: Clear All confirmation dialog — uses LUCIAN's own
            Dialog component, NOT browser confirm(). */}
        <Dialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Clear all notifications?</DialogTitle>
            </DialogHeader>
            <p className="text-[12px] text-fg-muted">
              This will dismiss all visible notifications. Dismissed records stay in history but disappear from the bell and the unread count. Your Home Recent Activity is separate and will not be affected.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmClearOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  clearAllVisible();
                  setConfirmClearOpen(false);
                }}
              >
                Clear all
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}

interface DateGroupProps {
  label: string;
  items: AppNotification[];
  onClick: (n: AppNotification) => void;
  onDismiss: (e: React.MouseEvent, id: string) => void;
  onResolve: (e: React.MouseEvent, id: string) => void;
  focusedId: string | null;
  focusedRef: React.MutableRefObject<HTMLButtonElement | null>;
}

function DateGroup({
  label,
  items,
  onClick,
  onDismiss,
  onResolve,
  focusedId,
  focusedRef,
}: DateGroupProps) {
  return (
    <div>
      <div className="px-3 py-1.5 text-[9px] font-semibold uppercase tracking-wide text-fg-faint">{label}</div>
      {items.map((n) => {
        const isFocused = n.id === focusedId;
        return (
          <button
            key={n.id}
            ref={isFocused ? focusedRef : undefined}
            onClick={() => onClick(n)}
            className={cn(
              "group flex w-full items-start gap-2 border-b border-line-muted/60 px-3 py-2.5 text-left transition-colors",
              n.resolved
                ? "opacity-60"
                : isFocused
                  ? "bg-[var(--accent)]/10 ring-1 ring-inset ring-[var(--accent)]/40"
                  : "hover:bg-hover",
            )}
          >
            <span
              className={cn(
                "mt-1 h-2 w-2 shrink-0 rounded-full",
                n.resolved
                  ? "bg-fg-faint"
                  : n.level === "error"
                    ? "bg-red-500"
                    : n.level === "warning"
                      ? "bg-amber-500"
                      : n.level === "success"
                        ? "bg-emerald-500"
                        : "bg-[var(--accent)]",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className={cn("truncate text-[12px] font-medium", n.resolved || n.read ? "text-fg-muted" : "text-fg")}>
                  {n.title}
                </p>
                {n.actionable && !n.resolved && (
                  <span className="shrink-0 rounded bg-[var(--accent)]/10 px-1 py-px text-[8px] font-bold uppercase tracking-wide text-[var(--accent)]">
                    Action
                  </span>
                )}
                {n.resolved && (
                  <span className="shrink-0 rounded bg-emerald-500/10 px-1 py-px text-[8px] font-bold uppercase tracking-wide text-emerald-500">
                    Resolved
                  </span>
                )}
              </div>
              <p className="text-[11px] text-fg-muted">
                {shouldMaskSensitive("notifications") ? maskNotificationMessage(n.message) : n.message}
              </p>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <p className="text-[9px] text-fg-faint">{formatTimeAgo(n.timestamp)}</p>
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  {!n.resolved && n.actionable && (
                    <button
                      onClick={(e) => onResolve(e, n.id)}
                      className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] text-fg-muted hover:bg-hover hover:text-emerald-500"
                      title="Mark as resolved"
                    >
                      <RotateCcw className="h-2.5 w-2.5" /> Resolve
                    </button>
                  )}
                  <button
                    onClick={(e) => onDismiss(e, n.id)}
                    className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] text-fg-muted hover:bg-hover hover:text-red-400"
                    title="Dismiss"
                  >
                    <X className="h-2.5 w-2.5" /> Dismiss
                  </button>
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 86400000 * 2) return "yesterday";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Mask sensitive values in a notification message for the Notification
 * Center display. Replaces currency amounts and 4+ digit runs with
 * bullets. The underlying notification record is NEVER modified — only
 * the rendered string.
 */
function maskNotificationMessage(message: string): string {
  if (!message) return message;
  let masked = message.replace(
    /(?:\$|€|£|¥)?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s?(?:USD|EUR|GBP|JPY|BTC|ETH|USDC)?/g,
    (match) => match.trim().length > 0 ? "••••" : match,
  );
  masked = masked.replace(/\b\d{4,}\b/g, "••••");
  return masked;
}

// Small hook for filter state
function useFilter(): ["all" | "unread", (v: "all" | "unread") => void] {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  return [filter, setFilter];
}
