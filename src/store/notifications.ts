"use client";

/* LUCIAN Notifications — Phase 10 canonical store.
 *
 * ONE notification system shared across all modules. Producers call
 * `notify()` (or `add()` for low-level control); the bell + Notification
 * Center + Home "Needs Attention" all read from this store.
 *
 * Phase 10 additions:
 *   - Schema extended: dismissed, resolved, actionable, level, dedupeKey,
 *     entity metadata, lastTriggerAt, cooldownUntil.
 *   - Producer-level dedupe + cooldown (key = module + event + entity).
 *     Repeated identical failures within the cooldown window are dropped,
 *     NOT re-added as new notifications.
 *   - Bounded history (max 500). Pruning prefers oldest resolved/dismissed
 *     informational entries first; unresolved actionable notifications are
 *     NEVER pruned merely because the cap was reached.
 *   - Dismiss (persisted, not UI-only) — dismissed notifications disappear
 *     from the active Notification Center and from the unread count.
 *   - Clear All Visible — clears the currently visible set (after
 *     confirmation) without touching Home Recent Activity (which is a
 *     separate concept driven by the activity aggregator).
 *   - Resolve — marks a notification as resolved (e.g. runtime recovered,
 *     alert reset, review completed). Resolved notifications stay in
 *     history but no longer appear in Needs Attention.
 *   - Focus — sets a `focusedId` so the Notification Center can
 *     highlight the exact record selected from Global Search when no
 *     deepLink exists (Phase 9 wrap-up).
 *
 * Privacy:
 *   - Vault producers must NOT pass hidden balances or sensitive account
 *     details. The producer is responsible for sanitizing the payload
 *     before calling `notify()`.
 *   - No API keys, tokens, or raw sensitive API errors are stored.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { syncNotification } from "@/lib/auth/live-sync";

export type NotificationLevel = "info" | "success" | "warning" | "error";

/** Back-compat with Phase 9 schema. `priority` is kept so existing
 *  consumers (TopNav bell badge, Home urgentUnread) keep working. */
export type NotificationPriority = "low" | "normal" | "high" | "urgent";

/** Map level → priority for legacy consumers. */
function levelToPriority(level: NotificationLevel): NotificationPriority {
  switch (level) {
    case "error":
      return "urgent";
    case "warning":
      return "high";
    case "success":
      return "normal";
    case "info":
    default:
      return "low";
  }
}

export interface AppNotification {
  id: string;
  /** Module that produced this notification (e.g. "markets", "vault"). */
  source: string;
  title: string;
  message: string;
  /** Structured level. Legacy `priority` is derived from this. */
  level: NotificationLevel;
  /** Derived from level — kept for back-compat with Phase 9 consumers. */
  priority: NotificationPriority;
  /** Wall-clock time (ms since epoch). */
  timestamp: number;
  /** User has seen it (clicked / opened). */
  read: boolean;
  /** User dismissed it from the Notification Center. Dismissed records
   *  disappear from the active list but remain in bounded history. */
  dismissed: boolean;
  /** The underlying condition is resolved (runtime recovered, alert
   *  reset, review completed). Resolved records stay in history but no
   *  longer contribute to Needs Attention. */
  resolved: boolean;
  /** True if this notification represents something the user should act
   *  on (vs. purely informational). Drives Home Needs Attention. */
  actionable: boolean;
  /** Optional internal route (deep link) the notification opens when clicked. */
  deepLink?: string;
  /** Optional entity metadata for dedupe + deep linking.
   *  Example: { module: "markets", type: "price-alert", id: "BTCUSD|above|75000" } */
  entity?: {
    module: string;
    type: string;
    id: string;
  };
  /** Stable dedupe key (computed as `source + event + entity.id` by the
   *  helper). When a producer fires the same key within `cooldownMs`,
   *  the notification is NOT re-added — the existing record's
   *  `lastTriggerAt` is bumped instead. */
  dedupeKey?: string;
  /** Last time this notification's condition was triggered (updated on
   *  repeat hits while in cooldown). */
  lastTriggerAt: number;
  /** Earliest time the producer may fire the same dedupeKey again. */
  cooldownUntil: number;
}

interface NotifyInput {
  source: string;
  title: string;
  message: string;
  level?: NotificationLevel;
  actionable?: boolean;
  deepLink?: string;
  entity?: { module: string; type: string; id: string };
  /** Stable event name used in the dedupe key (e.g. "runtime-failed",
   *  "price-alert-triggered", "thesis-due"). */
  event?: string;
  /** Per-notification cooldown override (ms). Default 5 minutes. */
  cooldownMs?: number;
  /** If a notification with the same dedupeKey already exists AND is
   *  currently resolved, re-triggering it should reopen it (set resolved
   *  back to false). Default true. */
  reopenIfResolved?: boolean;
  /** Explicit dedupe key override. If omitted, the store computes one
   *  from `source + event + entity`. */
  dedupeKey?: string;
}

interface NotificationState {
  notifications: AppNotification[];
  /** Id of the notification that should be highlighted in the
   *  Notification Center (set when the user follows a search result for
   *  a notification without a deep link — Phase 9 wrap-up). The center
   *  auto-clears this after a few seconds. */
  focusedId: string | null;

  // ── Producer API ──
  /** Add a notification with dedupe/cooldown. This is the canonical
   *  producer entry point — prefer this over `add()` for new code. */
  notify: (input: NotifyInput) => void;
  /** Low-level add (skips dedupe). Kept for back-compat with Phase 9
   *  callers that pass the old schema directly. The optional `id`
   *  field is used by the cloud-hydration layer to preserve the
   *  server's stable id when merging hydrated rows. */
  add: (n: Omit<AppNotification, "id" | "timestamp" | "read" | "priority" | "dismissed" | "resolved" | "lastTriggerAt" | "cooldownUntil"> & { id?: string }) => void;

  // ── Consumer API ──
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismiss: (id: string) => void;
  /** Resolve a notification (condition cleared). Keeps the record in
   *  history but removes it from Needs Attention. */
  resolve: (id: string) => void;
  /** Clear all VISIBLE (non-dismissed) notifications. Dismissed ones
   *  remain in history. Does NOT touch Home Recent Activity. */
  clearAllVisible: () => void;
  /** Hard-reset (used by tests / dev only). */
  clear: () => void;
  remove: (id: string) => void;
  setFocusedId: (id: string | null) => void;

  // ── Derived selectors (functions; consumers should prefer useMemo) ──
  /** Active = not dismissed. This is what the bell + Notification Center render. */
  activeNotifications: () => AppNotification[];
  /** Unread count — only counts active, non-dismissed, non-resolved notifications. */
  unreadCount: () => number;
  /** Actionable + unresolved + unread — drives Home Needs Attention. */
  needsAttention: () => AppNotification[];
  /** Back-compat: high/urgent unread items (legacy Home urgentUnread). */
  urgentUnread: () => AppNotification[];
}

const MAX_NOTIFICATIONS = 500;
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

function genId(): string {
  return `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function computeDedupeKey(input: NotifyInput): string | undefined {
  if (input.dedupeKey) return input.dedupeKey;
  const event = input.event ?? "default";
  const entity = input.entity ? `${input.entity.module}:${input.entity.type}:${input.entity.id}` : "no-entity";
  return `${input.source}:${event}:${entity}`;
}

/**
 * Map a notification producer's `source` string to a Settings category.
 * This is the ONLY place that decides which category a producer belongs
 * to. Settings owns the per-category toggles; the notification store
 * consults them via this mapping (lazily, to avoid a circular import).
 *
 * Unknown sources default to allowed (better to over-notify than to
 * silently drop a notification the user expected to see).
 */
function sourceToCategory(source: string): "dev-workspace" | "investing" | "markets" | "vault" | null {
  if (source === "dev-workspace" || source.startsWith("dev-workspace:")) return "dev-workspace";
  if (source === "investing" || source.startsWith("investing:")) return "investing";
  if (source === "markets" || source.startsWith("markets:")) return "markets";
  if (source === "vault" || source.startsWith("vault:")) return "vault";
  return null;
}

/**
 * Returns true if the producer should be allowed to fire right now,
 * consulting the central Settings store (master toggle + per-category
 * enables + quiet mode). Lazily imports the settings store to avoid
 * a circular dependency at module load.
 *
 * IMPORTANT: this is the ONLY place where Settings gates notifications.
 * Producers do NOT call this themselves; the central `notify()` does.
 *
 * Quiet mode is intentionally NOT a gate here — quiet mode suppresses
 * PRESENTATION (sound, badge, interruptive visuals) but does NOT stop
 * modules from recording important events. Only the master toggle +
 * per-category toggles stop a notification from being recorded.
 */
function isNotificationAllowed(source: string): boolean {
  // Lazy import to avoid circular dependency (settings store imports
  // nothing from notifications, but we may add shared types later).
  const mod = require("@/store/settings") as typeof import("@/store/settings");
  const state = mod.useSettingsStore.getState();
  if (!state.notifications.masterEnabled) return false;
  const cat = sourceToCategory(source);
  if (cat === null) return true; // unknown sources are allowed
  return state.notifications.categories[cat] !== false;
}

/** Prune to MAX_NOTIFICATIONS. Prefer dropping oldest resolved/dismissed
 *  informational entries first; never drop unresolved actionable records
 *  merely because the cap was reached. */
function prune(list: AppNotification[]): AppNotification[] {
  if (list.length <= MAX_NOTIFICATIONS) return list;

  // Partition: protected = actionable && !resolved && !dismissed.
  const protectedList: AppNotification[] = [];
  const droppable: AppNotification[] = [];
  for (const n of list) {
    if (n.actionable && !n.resolved && !n.dismissed) {
      protectedList.push(n);
    } else {
      droppable.push(n);
    }
  }

  // Sort droppable oldest-first so we drop the oldest.
  droppable.sort((a, b) => a.timestamp - b.timestamp);

  // Keep as many droppable as we can fit.
  const slotsForDroppable = Math.max(0, MAX_NOTIFICATIONS - protectedList.length);
  const keptDroppable = droppable.slice(-slotsForDroppable);

  // Merge + re-sort by timestamp desc (newest first) for display.
  const merged = [...protectedList, ...keptDroppable];
  merged.sort((a, b) => b.timestamp - a.timestamp);
  return merged;
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      notifications: [],
      focusedId: null,

      notify: (input) => {
        // Settings gate: master toggle + per-category enables. Unknown
        // sources (no recognized category) are allowed by default.
        if (!isNotificationAllowed(input.source)) return;

        const now = Date.now();
        const level = input.level ?? "info";
        const priority = levelToPriority(level);
        const dedupeKey = computeDedupeKey(input);
        const cooldownMs = input.cooldownMs ?? DEFAULT_COOLDOWN_MS;

        // ── Dedupe / cooldown ──
        if (dedupeKey) {
          const existing = get().notifications.find((n) => n.dedupeKey === dedupeKey);
          if (existing) {
            const inCooldown = now < existing.cooldownUntil;
            if (inCooldown) {
              // Same event during cooldown — bump lastTriggerAt but do NOT
              // create a new notification or extend the cooldown window.
              set((s) => ({
                notifications: s.notifications.map((n) =>
                  n.id === existing.id
                    ? { ...n, lastTriggerAt: now }
                    : n,
                ),
              }));
              return;
            }
            // Outside cooldown — re-trigger: update the existing record
            // (reopen if resolved, bump unread if it was read).
            set((s) => ({
              notifications: s.notifications.map((n) =>
                n.id === existing.id
                  ? {
                      ...n,
                      title: input.title,
                      message: input.message,
                      level,
                      priority,
                      timestamp: now,
                      lastTriggerAt: now,
                      cooldownUntil: now + cooldownMs,
                      read: false,
                      resolved: input.reopenIfResolved === false ? n.resolved : false,
                      dismissed: false,
                      deepLink: input.deepLink ?? n.deepLink,
                    }
                  : n,
              ),
            }));
            return;
          }
        }

        // ── New notification ──
        const n: AppNotification = {
          id: genId(),
          source: input.source,
          title: input.title,
          message: input.message,
          level,
          priority,
          timestamp: now,
          read: false,
          dismissed: false,
          resolved: false,
          actionable: input.actionable ?? (level === "error" || level === "warning"),
          deepLink: input.deepLink,
          entity: input.entity,
          dedupeKey,
          lastTriggerAt: now,
          cooldownUntil: now + cooldownMs,
        };
        set((s) => ({ notifications: prune([{ ...n }, ...s.notifications]) }));

        // PHASE 16: live server-sync (best-effort, non-blocking).
        // The local mutation already succeeded; the server write happens
        // in the background. If it fails, the local change is preserved
        // and a retry is queued via recordPendingSync.
        void syncNotification({
          source: input.source,
          title: input.title,
          message: input.message,
          level,
          actionable: input.actionable ?? (level === "error" || level === "warning"),
          dedupeKey,
          entityRef: input.entity ? `${input.entity.module}:${input.entity.type}:${input.entity.id}` : undefined,
          deepLink: input.deepLink,
        }).catch(() => { /* non-fatal — local already succeeded */ });

        // Settings-driven sound: play only when sound is enabled AND
        // quiet mode is off. The sound helper is lazy-imported so the
        // store doesn't pull in the Web Audio API at module load.
        try {
          const settings = (require("@/store/settings") as typeof import("@/store/settings")).useSettingsStore.getState();
          if (settings.notifications.sound && !settings.notifications.quietMode) {
            void import("@/lib/notification-sound").then(({ playNotificationSound }) => {
              playNotificationSound();
            }).catch(() => { /* non-fatal */ });
          }
        } catch {
          /* settings store not available — skip sound */
        }
      },

      add: (n) => {
        // Back-compat path: callers using the old Omit<AppNotification,...>
        // shape land here. We fill in the new fields with sensible defaults.
        // The cloud-hydration layer passes `id` to preserve the server's
        // stable id; without one, we generate a fresh local id.
        const now = Date.now();
        const level = (n as AppNotification).level ?? "info";
        const inputId = (n as { id?: string }).id;
        const record: AppNotification = {
          ...(n as AppNotification),
          id: inputId ?? genId(),
          timestamp: now,
          read: false,
          level,
          priority: levelToPriority(level),
          dismissed: false,
          resolved: false,
          actionable: n.actionable ?? (level === "error" || level === "warning"),
          lastTriggerAt: now,
          cooldownUntil: now,
        };
        set((s) => ({ notifications: prune([record, ...s.notifications]) }));
      },

      markRead: (id) =>
        set((s) => ({
          notifications: s.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n,
          ),
        })),

      markAllRead: () =>
        set((s) => ({
          notifications: s.notifications.map((n) =>
            n.dismissed ? n : { ...n, read: true },
          ),
        })),

      dismiss: (id) =>
        set((s) => ({
          notifications: s.notifications.map((n) =>
            n.id === id
              ? { ...n, dismissed: true, read: true }
              : n,
          ),
        })),

      resolve: (id) =>
        set((s) => ({
          notifications: s.notifications.map((n) =>
            n.id === id
              ? { ...n, resolved: true, read: true }
              : n,
          ),
        })),

      clearAllVisible: () =>
        set((s) => {
          // Read the keepResolvedNotifications setting. If OFF, resolved
          // notifications are dropped entirely (not just hidden) when the
          // user clears all visible. If ON (default), resolved records
          // stay in history. Unresolved actionable records are NEVER
          // destroyed by clearAllVisible — only marked dismissed.
          let keepResolved = true;
          try {
            const settings = (require("@/store/settings") as typeof import("@/store/settings")).useSettingsStore.getState();
            keepResolved = settings.notifications.keepResolvedNotifications;
          } catch {
            /* settings store not available — keep default */
          }

          if (!keepResolved) {
            // Drop resolved+dismissed entirely; dismiss the rest.
            return {
              notifications: s.notifications
                .filter((n) => !(n.dismissed || n.resolved))
                .map((n) =>
                  n.dismissed ? n : { ...n, dismissed: true, read: true },
                ),
            };
          }

          // Default: mark every non-dismissed notification as dismissed.
          // They stay in history but disappear from the active list + unread count.
          // Home Recent Activity is a separate store and is NOT touched.
          return {
            notifications: s.notifications.map((n) =>
              n.dismissed ? n : { ...n, dismissed: true, read: true },
            ),
          };
        }),

      clear: () => set({ notifications: [], focusedId: null }),

      remove: (id) =>
        set((s) => ({
          notifications: s.notifications.filter((n) => n.id !== id),
        })),

      setFocusedId: (id) => set({ focusedId: id }),

      activeNotifications: () => get().notifications.filter((n) => !n.dismissed),

      unreadCount: () =>
        get().notifications.filter(
          (n) => !n.dismissed && !n.resolved && !n.read,
        ).length,

      needsAttention: () =>
        get()
          .notifications.filter(
            (n) =>
              !n.dismissed &&
              !n.resolved &&
              n.actionable &&
              !n.read,
          )
          .sort((a, b) => b.timestamp - a.timestamp),

      urgentUnread: () =>
        get()
          .notifications.filter(
            (n) =>
              !n.dismissed &&
              !n.resolved &&
              !n.read &&
              (n.priority === "high" || n.priority === "urgent"),
          )
          .sort((a, b) => b.timestamp - a.timestamp),
    }),
    {
      name: "lucian-notifications",
      // Bump version so old Phase 9 records (without the new fields) get
      // migrated: any missing field is filled with a sensible default on
      // first read by the consumer (the store's selectors guard for it).
      version: 2,
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
        return localStorage;
      }),
      // Migrate old Phase 9 records (which lack the new fields) to the
      // Phase 10 schema. Each old record gets sensible defaults.
      migrate: (persisted: unknown, _version: number) => {
        if (!persisted || typeof persisted !== "object") return persisted as NotificationState;
        const s = persisted as Partial<NotificationState>;
        if (!Array.isArray(s.notifications)) return s as NotificationState;
        const now = Date.now();
        s.notifications = s.notifications.map((n) => {
          const old = n as Partial<AppNotification> & { priority?: NotificationPriority };
          // If level is missing, derive it from the legacy priority.
          const level: NotificationLevel =
            old.level ??
            (old.priority === "urgent"
              ? "error"
              : old.priority === "high"
                ? "warning"
                : old.priority === "normal"
                  ? "success"
                  : "info");
          return {
            id: old.id ?? genId(),
            source: old.source ?? "unknown",
            title: old.title ?? "",
            message: old.message ?? "",
            level,
            priority: old.priority ?? levelToPriority(level),
            timestamp: old.timestamp ?? now,
            read: old.read ?? false,
            dismissed: (old as AppNotification).dismissed ?? false,
            resolved: (old as AppNotification).resolved ?? false,
            actionable: (old as AppNotification).actionable ?? (level === "error" || level === "warning"),
            deepLink: old.deepLink,
            entity: (old as AppNotification).entity,
            dedupeKey: (old as AppNotification).dedupeKey,
            lastTriggerAt: (old as AppNotification).lastTriggerAt ?? old.timestamp ?? now,
            cooldownUntil: (old as AppNotification).cooldownUntil ?? 0,
          } as AppNotification;
        });
        if (s.focusedId === undefined) s.focusedId = null;
        return s as NotificationState;
      },
    },
  ),
);
