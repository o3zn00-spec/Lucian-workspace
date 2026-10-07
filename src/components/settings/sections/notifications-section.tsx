"use client";

/* LUCIAN Settings — Notifications section.
 *
 * Master toggle, per-category enables, and global behavior (sound,
 * unread badge, needs attention, keep resolved, quiet mode).
 *
 * The notification STORE owns the records; this owns WHETHER each
 * category may notify. The store's `notify()` consults the central
 * useSettingsStore via the `isNotificationAllowed` helper before
 * adding a notification. Settings is the ONE truth for category
 * enables; the store does NOT keep a parallel flag.
 */

import { useSettingsStore, type NotificationCategory } from "@/store/settings";
import { useNotificationStore } from "@/store/notifications";
import { SettingsGroup, SettingsRow, SettingsSectionHeader } from "@/components/settings/primitives";
import { Switch } from "@/components/ui-devspace/switch";

const CATEGORIES: Array<{ id: NotificationCategory; label: string; description: string }> = [
  { id: "dev-workspace", label: "DevWorkspace", description: "Runtime / build failures." },
  { id: "investing",     label: "Investing",    description: "Thesis review reminders." },
  { id: "markets",       label: "Markets",      description: "Triggered price alerts." },
  { id: "vault",         label: "Vault",        description: "Important financial activity, large transactions, provider failures." },
];

export function NotificationsSection() {
  const master = useSettingsStore((s) => s.notifications.masterEnabled);
  const categories = useSettingsStore((s) => s.notifications.categories);
  const globals = useSettingsStore((s) => s.notifications);
  const setNotifications = useSettingsStore((s) => s.setNotifications);
  const setCategory = useSettingsStore((s) => s.setNotificationCategory);

  // The notification store itself is the source of truth for the
  // records; we read the count for an at-a-glance summary. We do NOT
  // clone the records here.
  const activeCount = useNotificationStore((s) => s.notifications.filter((n) => !n.dismissed).length);
  const clearAllVisible = useNotificationStore((s) => s.clearAllVisible);

  return (
    <div>
      <SettingsSectionHeader
        title="Notifications"
        subtitle="Control whether modules may notify, and how notifications behave. The modules themselves decide what each alert actually is."
      />

      <SettingsGroup title="Master">
        <SettingsRow
          title="Notifications"
          description={master ? "All categories may notify (subject to per-category toggles)." : "All notifications are suppressed."}
        >
          <Switch
            checked={master}
            onCheckedChange={(v) => setNotifications({ masterEnabled: v })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Categories">
        {CATEGORIES.map((c) => (
          <SettingsRow
            key={c.id}
            title={c.label}
            description={c.description}
          >
            <Switch
              checked={master && categories[c.id] !== false}
              disabled={!master}
              onCheckedChange={(v) => setCategory(c.id, v)}
            />
          </SettingsRow>
        ))}
      </SettingsGroup>

      <SettingsGroup title="Global Behavior">
        <SettingsRow title="Notification sound" description="Play a sound when notifications arrive.">
          <Switch
            checked={globals.sound}
            disabled={!master || globals.quietMode}
            onCheckedChange={(v) => setNotifications({ sound: v })}
          />
        </SettingsRow>
        <SettingsRow title="Unread badge" description="Show the unread count on the bell icon.">
          <Switch
            checked={globals.unreadBadge}
            disabled={!master || globals.quietMode}
            onCheckedChange={(v) => setNotifications({ unreadBadge: v })}
          />
        </SettingsRow>
        <SettingsRow title="Needs Attention on Home" description="Show actionable notifications on the Home page.">
          <Switch
            checked={globals.needsAttentionOnHome}
            disabled={!master}
            onCheckedChange={(v) => setNotifications({ needsAttentionOnHome: v })}
          />
        </SettingsRow>
        <SettingsRow title="Keep resolved notifications" description="Keep resolved notifications in history instead of hiding them.">
          <Switch
            checked={globals.keepResolvedNotifications}
            onCheckedChange={(v) => setNotifications({ keepResolvedNotifications: v })}
          />
        </SettingsRow>
        <SettingsRow title="Quiet mode" description="Suppress sound and badges but keep records.">
          <Switch
            checked={globals.quietMode}
            onCheckedChange={(v) => setNotifications({ quietMode: v })}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="History">
        <SettingsRow
          title="Active notifications"
          description={`${activeCount} active notification(s) currently in the Notification Center.`}
        >
          <button
            onClick={() => clearAllVisible()}
            disabled={activeCount === 0}
            className="themed rounded-md border border-line-muted px-2.5 py-1 text-xs text-fg-muted hover:bg-hover hover:text-fg disabled:opacity-50"
          >
            Clear visible
          </button>
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
