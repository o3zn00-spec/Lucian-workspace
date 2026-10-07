"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ChevronRight, Bell, Bot, FileText, Plus, PieChart, Newspaper, FlaskConical } from "lucide-react";
import { useNotificationStore } from "@/store/notifications";
import { useGlobalSearchStore } from "@/store/global-search";
import { useSettingsStore } from "@/store/settings";
import { shouldMaskSensitive } from "@/lib/regional-format";
import { getActivity, type ActivityEntry } from "@/lib/activity-aggregator";
import { cn } from "@/lib/utils";

export default function HomePage() {
  const router = useRouter();
  // Phase 9: Home search opens the SAME canonical overlay that lives at
  // the AppShell level. No local overlay instance.
  const openSearch = useGlobalSearchStore((s) => s.openWith);
  const [recentActivity, setRecentActivity] = useState<ActivityEntry[]>([]);

  // Settings → General → Startup.
  // openHomeOnLaunch: when ON (default), the user lands on Home when
  //   LUCIAN starts. When OFF, we redirect to the default landing page
  //   (if it's not "home"). This is a one-shot redirect on initial mount.
  // reopenLastModule: not yet supported — LUCIAN's routing doesn't track
  //   "last module" across sessions yet. We honestly don't fake it.
  const startup = useSettingsStore((s) => s.general.startup);
  const defaultLandingPage = useSettingsStore((s) => s.general.navigation.defaultLandingPage);
  const redirectAttemptedRef = useRef(false);

  useEffect(() => {
    if (redirectAttemptedRef.current) return;
    redirectAttemptedRef.current = true;
    // If "Open Home on launch" is OFF and the default landing page is not
    // "home", redirect there. This is the real startup behavior — we
    // don't fake it.
    if (!startup.openHomeOnLaunch && defaultLandingPage !== "home") {
      const route = defaultLandingPage === "dev-workspace" ? "/dev-workspace" : `/${defaultLandingPage}`;
      router.replace(route);
      return;
    }
  }, [startup.openHomeOnLaunch, defaultLandingPage, router]);

  // Hydration-safe date/greeting — computed only after mount so the
  // server and client render the same initial markup. Defer setState
  // to a microtask to comply with React 19's set-state-in-effect rule.
  const [dateStr, setDateStr] = useState("");
  const [greeting, setGreeting] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => {
      const now = new Date();
      const ds = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      const hour = now.getHours();
      const g = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
      setDateStr(ds);
      setGreeting(g);
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  // Phase 10: Recent Activity comes from the REAL activity aggregator
  // (markets ops, vault tx, investing activities, economy-hub updates,
  // dev-workspace project updates). This is SEPARATE from the
  // notification store — clearing notifications does NOT clear this.
  useEffect(() => {
    const id = window.setTimeout(() => setRecentActivity(getActivity(5)), 0);
    // Re-poll every 30 seconds so newly created activity appears
    // without a manual refresh.
    const interval = setInterval(() => {
      setRecentActivity(getActivity(5));
    }, 30000);
    return () => {
      window.clearTimeout(id);
      clearInterval(interval);
    };
  }, []);

  // Notifications — select the raw notifications array (stable reference)
  // then derive needsAttention with useMemo.
  const notifications = useNotificationStore((s) => s.notifications);
  // Settings: whether to surface Needs Attention on Home. If OFF, the
  // section is hidden entirely (notifications themselves are NOT deleted).
  const needsAttentionOnHome = useSettingsStore((s) => s.notifications.needsAttentionOnHome);

  // Phase 10: Needs Attention = actionable + unresolved + unread + not dismissed.
  // This is NOT the same as Recent Activity. A routine trade (informational)
  // appears in Recent Activity but NOT in Needs Attention. A meaningful
  // failure / due review / triggered alert appears in BOTH only if the
  // activity aggregator surfaced it AND it's actionable.
  // Phase 10 (corrected in Phase 11 carry-forward): Needs Attention must
  // NOT depend on read state. READ = user has seen it; RESOLVED = problem
  // is no longer active; DISMISSED = user intentionally removed it.
  // Reading an unresolved actionable notification must NOT remove it from
  // Needs Attention — only resolution or dismissal should.
  // Bell unread count still uses `!dismissed && !resolved && !read`.
  const needsAttention = useMemo(
    () =>
      notifications
        .filter(
          (n) =>
            !n.dismissed &&
            !n.resolved &&
            n.actionable,
        )
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 5),
    [notifications],
  );

  const quickActions = [
    { label: "New Note", icon: FileText, path: "/notes" },
    { label: "Open Project", icon: ChevronRight, path: "/dev-workspace" },
    { label: "Research", icon: FlaskConical, path: "/research" },
    { label: "Add Investment", icon: PieChart, path: "/investing" },
  ];

  return (
    <div className="themed flex h-full min-h-0 flex-col bg-canvas text-fg">
      {/* Main content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          {/* Date + greeting */}
          <div className="mb-6">
            <p className="text-[12px] text-fg-faint">{dateStr}</p>
            <h1 className="mt-0.5 text-[22px] font-semibold tracking-tight text-fg">{greeting}</h1>
          </div>

          {/* Large search */}
          <div className="mb-8">
            <button onClick={() => openSearch()}
              className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-fg-faint">
              <Search className="h-4 w-4 text-fg-faint" />
              <span className="text-[14px] text-fg-faint">Search anything in LUCIAN...</span>
              <kbd className="ml-auto rounded border border-line px-1.5 py-0.5 font-sans text-[10px] text-fg-faint">/</kbd>
            </button>
          </div>

          {/* Recent Activity + Needs Attention */}
          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            {/* Recent Activity — Phase 10: REAL module activity, NOT
                notifications. Sourced from the activity aggregator. */}
            <div className="rounded-lg border border-line bg-surface p-4">
              <h2 className="mb-3 text-[12px] font-semibold text-fg">Recent Activity</h2>
              {recentActivity.length === 0 ? (
                <p className="text-[11px] text-fg-faint">No recent activity yet.</p>
              ) : (
                <div className="space-y-2">
                  {recentActivity.map((item) => (
                    <button
                      key={item.id}
                      data-navigation-target={item.deepLink || undefined}
                      disabled={!item.deepLink}
                      onClick={() => item.deepLink && router.push(item.deepLink)}
                      className="flex w-full items-center gap-2 text-left text-[11px] transition-colors hover:bg-hover/40 rounded"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                      <span className="flex-1 truncate text-fg-muted">
                        <span className="text-fg">{item.title}</span>
                        <span className="ml-1 text-fg-faint">— {item.moduleLabel}</span>
                      </span>
                      <span className="shrink-0 text-[9px] text-fg-faint">{formatTimeAgo(item.timestamp)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Needs Attention — Phase 10: actionable, unresolved,
                unread notifications. Clicking opens the deep link.
                Settings → Notifications → needsAttentionOnHome controls
                whether this section renders at all (records are NOT deleted). */}
            {needsAttentionOnHome && (
            <div className="rounded-lg border border-line bg-surface p-4">
              <div className="mb-3 flex items-center gap-2">
                <Bell className="h-3.5 w-3.5 text-fg-muted" />
                <h2 className="text-[12px] font-semibold text-fg">Needs Attention</h2>
              </div>
              {needsAttention.length === 0 ? (
                <p className="text-[11px] text-fg-faint">No items need your attention.</p>
              ) : (
                <div className="space-y-2">
                  {needsAttention.map((n) => {
                    // Privacy: mask sensitive values in the notification
                    // message when the Home mask toggle (or privacy mode)
                    // is on. The underlying record is NOT modified.
                    const maskedMessage = shouldMaskSensitive("home")
                      ? maskNotificationMessage(n.message)
                      : n.message;
                    return (
                    <button
                      key={n.id}
                      data-navigation-target={n.deepLink || undefined}
                      disabled={!n.deepLink}
                      onClick={() => n.deepLink && router.push(n.deepLink)}
                      className="flex w-full items-start gap-2 text-left text-[11px] transition-colors hover:bg-hover/40 rounded"
                    >
                      <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", n.level === "error" ? "bg-red-500" : n.level === "warning" ? "bg-amber-500" : "bg-[var(--accent)]")} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-fg">{n.title}</p>
                        <p className="truncate text-[10px] text-fg-muted">{maskedMessage}</p>
                      </div>
                      <ChevronRight className="h-3 w-3 shrink-0 text-fg-faint" />
                    </button>
                    );
                  })}
                </div>
              )}
            </div>
            )}
          </div>

          {/* Quick Actions */}
          <div>
            <h2 className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-fg-faint">Quick Actions</h2>
            <div className="flex flex-wrap gap-2">
              {quickActions.map(action => (
                <button key={action.label} data-navigation-target={action.path} onClick={() => router.push(action.path)}
                  className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg">
                  <action.icon className="h-3.5 w-3.5" />
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Phase 9: GlobalSearchOverlay is mounted once at AppShell — no
          local instance here. */}
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
 * Mask sensitive values in a notification message for Home display.
 * Replaces currency amounts ($1,234.56, 1234.56 USD) and 4+ digit runs
 * (account identifiers, card numbers) with bullets. The underlying
 * notification record is NEVER modified — only the rendered string.
 */
function maskNotificationMessage(message: string): string {
  if (!message) return message;
  // Mask currency amounts: $1,234.56 / $1234.56 / 1,234.56 USD / 1234.56 EUR
  let masked = message.replace(
    /(?:\$|€|£|¥)?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s?(?:USD|EUR|GBP|JPY|BTC|ETH|USDC)?/g,
    (match) => match.trim().length > 0 ? "••••" : match,
  );
  // Mask 4+ digit runs (account numbers, card last-4 already shown as ••••)
  masked = masked.replace(/\b\d{4,}\b/g, "••••");
  return masked;
}
