"use client";
import type { AIBehaviorWire } from "@/lib/ai-behavior-wire";
export type { ContextLevel, ResponseStyle } from "@/lib/ai-behavior-wire";

/* LUCIAN — Central Settings / Preferences store.
 *
 * This is the ONE central store for global LUCIAN workspace preferences.
 * It is the source of truth ONLY for settings that genuinely belong globally:
 *
 *   - general startup / navigation / regional preferences
 *   - appearance interface prefs (density, font scale, animations, rounded)
 *     (theme + accent remain in ThemeProvider's localStorage-backed store;
 *     appearance MODE — system/dark/light — lives here and is applied by
 *     ThemeProvider through the dataset attributes this store writes)
 *   - privacy (global masking)
 *   - accessibility (reduce motion, high contrast, larger text, focus indicators)
 *   - notifications master + per-category enables + global notification behavior
 *   - dev-workspace editor / preview / visual editor / github prefs
 *     allow project context)
 *   - selectedSettingsSection (UI state for the Settings page itself)
 *
 * Specialized stores remain the source of truth for their own data:
 *
 *   - notifications:    the notification records themselves (NOT cloned here)
 *   - vault:            Vault financial balances, security, destinations
 *                       (NOT cloned here; Settings only links to Vault)
 *   - markets:          price alerts (NOT cloned here)
 *   - workspace:        DevWorkspace projects, file tree (NOT cloned here)
 *
 * Settings writes here are the ONE truth for the toggles above. When the
 * notification store needs to know whether a category is enabled, it reads
 * this store; it does NOT keep a parallel category flag.
 *
 * Persistence: Zustand `persist` middleware, single localStorage key
 * `lucian-settings` (versioned). Safe defaults; older versions migrate
 * forward.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/* ─────────────────────────────────────────────────────────────────────── */
/* Types                                                                   */
/* ─────────────────────────────────────────────────────────────────────── */

export type AppearanceMode = "system" | "dark" | "light";
export type InterfaceDensity = "comfortable" | "compact";
export type FontScale = "small" | "default" | "large";
export type AnimationLevel = "full" | "reduced";
export type RoundedLevel = "default" | "reduced";


export type DefaultLandingPage =
  | "home"
  | "vault"
  | "markets"
  | "dev-workspace"
  | "news-feed"
  | "knowledge-library"
  | "economy-hub"
  | "research"
  | "chess-academy"
  | "browser"
  | "settings"
  | "investing"
  | "notes";

export type InternalLinkBehavior = "same-tab" | "new-tab";
export type ExternalLinkBehavior = "same-tab" | "new-tab";

export type TimeFormat = "12h" | "24h";
export type DateFormat = "iso" | "us" | "eu" | "long";
export type NumberFormat = "us" | "eu" | "iso";
export type CurrencyDisplay = "symbol" | "code" | "name";

export type Language = "en";

export type NotificationCategory =
  | "dev-workspace"
  | "investing"
  | "markets"
  | "vault";

export type ResponsiveDevice =
  | "auto"
  | "desktop"
  | "tablet"
  | "mobile";

export interface SettingsState {
  /* ── General ── */
  general: {
    startup: {
      openHomeOnLaunch: boolean;
      reopenLastModule: boolean;
      reopenLastDevWorkspaceProject: boolean;
      restorePreviousTabs: boolean;
    };
    navigation: {
      defaultLandingPage: DefaultLandingPage;
      internalLinks: InternalLinkBehavior;
      externalLinks: ExternalLinkBehavior;
      rememberSidebarCollapsed: boolean;
    };
    regional: {
      language: Language;
      timeFormat: TimeFormat;
      dateFormat: DateFormat;
      numberFormat: NumberFormat;
      currencyDisplay: CurrencyDisplay;
    };
  };

  /* ── Appearance ── */
  appearance: {
    mode: AppearanceMode;
    density: InterfaceDensity;
    fontScale: FontScale;
    animations: AnimationLevel;
    rounded: RoundedLevel;
  };




  /* ── Notifications master + categories + globals ──
   *
   * The notification STORE owns the records. This owns WHETHER each
   * category is allowed to notify. The notification store's producer
   * helpers consult this store before adding a notification. */
  notifications: {
    masterEnabled: boolean;
    categories: Record<NotificationCategory, boolean>;
    sound: boolean;
    unreadBadge: boolean;
    needsAttentionOnHome: boolean;
    keepResolvedNotifications: boolean;
    quietMode: boolean;
  };

  /* ── DevWorkspace prefs (read by DevWorkspace components) ── */
  devWorkspace: {
    editor: {
      fontSize: number;
      tabSize: number;
      wordWrap: boolean;
      minimap: boolean;
      autosave: boolean;
    };
    projects: {
      restoreLastProject: boolean;
      createHistoryBeforeEdits: boolean;
      maxLocalHistory: number;
    };
    preview: {
      defaultDevice: ResponsiveDevice;
      autoRefresh: boolean;
      startRuntimeAutomatically: boolean;
      showRuntimeDiagnostics: boolean;
    };
    visualEditor: {
      preferVisualEditWhenSafe: boolean;
      fallbackToDirectEdit: boolean;
      showSourceMapping: boolean;
      snapshotBeforeStructuralEdit: boolean;
      defaultResponsiveBreakpoint: ResponsiveDevice;
    };
  };

  /* ── Privacy & Security (global) ──
   *
   * Vault-specific financial security (withdrawal limits, allowlists,
   * destination delay, 2FA requirement) lives in the Vault store /
   * VaultSecuritySettings DB row. Settings only owns GLOBAL privacy. */
  privacy: {
    privacyMode: boolean;
    maskSensitiveInNotifications: boolean;
    maskSensitiveInGlobalSearch: boolean;
    maskSensitiveOnHome: boolean;
  };

  /* ── Accessibility ── */
  accessibility: {
    reduceMotion: boolean;
    highContrast: boolean;
    largerText: boolean;
    keyboardFocusIndicators: boolean;
  };

  /* ── UI state for the Settings page itself ── */
  aiBehavior: AIBehaviorWire;
  setAIBehavior: (patch: Partial<AIBehaviorWire>) => void;
  selectedSettingsSection: SettingsSectionId;
  settingsSearchQuery: string;

  /* ── Actions ── */
  setGeneralStartup: (patch: Partial<SettingsState["general"]["startup"]>) => void;
  setGeneralNavigation: (patch: Partial<SettingsState["general"]["navigation"]>) => void;
  setGeneralRegional: (patch: Partial<SettingsState["general"]["regional"]>) => void;

  setAppearance: (patch: Partial<SettingsState["appearance"]>) => void;

  setNotifications: (patch: Partial<SettingsState["notifications"]>) => void;
  setNotificationCategory: (cat: NotificationCategory, enabled: boolean) => void;

  setDevWorkspaceEditor: (patch: Partial<SettingsState["devWorkspace"]["editor"]>) => void;
  setDevWorkspaceProjects: (patch: Partial<SettingsState["devWorkspace"]["projects"]>) => void;
  setDevWorkspacePreview: (patch: Partial<SettingsState["devWorkspace"]["preview"]>) => void;
  setDevWorkspaceVisualEditor: (patch: Partial<SettingsState["devWorkspace"]["visualEditor"]>) => void;

  setPrivacy: (patch: Partial<SettingsState["privacy"]>) => void;

  setAccessibility: (patch: Partial<SettingsState["accessibility"]>) => void;

  setSelectedSettingsSection: (id: SettingsSectionId) => void;
  setSettingsSearchQuery: (q: string) => void;

  /** Reset all settings to defaults. Used by the Danger Zone. */
  resetAllSettings: () => void;
}

export type SettingsSectionId =
  | "general"
  | "ai-models"
  | "lilthe"
  | "appearance"
  | "notifications"
  | "dev-workspace"
  | "privacy"
  | "data-storage"
  | "connections"
  | "accessibility"
  | "account"
  | "about";

/* ─────────────────────────────────────────────────────────────────────── */
/* Defaults                                                                */
/* ─────────────────────────────────────────────────────────────────────── */

const DEFAULT_STATE: Omit<
  SettingsState,
  | "setGeneralStartup" | "setGeneralNavigation" | "setGeneralRegional"
  | "setAIBehavior"
  | "setAppearance"
  | "setNotifications" | "setNotificationCategory"
  | "setDevWorkspaceEditor" | "setDevWorkspaceProjects" | "setDevWorkspacePreview" | "setDevWorkspaceVisualEditor"
  | "setPrivacy"
  | "setAccessibility"
  | "setSelectedSettingsSection" | "setSettingsSearchQuery"
  | "resetAllSettings"
> = {
  general: {
    startup: {
      openHomeOnLaunch: true,
      reopenLastModule: false,
      reopenLastDevWorkspaceProject: false,
      restorePreviousTabs: false,
    },
    navigation: {
      defaultLandingPage: "home",
      internalLinks: "same-tab",
      externalLinks: "new-tab",
      rememberSidebarCollapsed: true,
    },
    regional: {
      language: "en",
      timeFormat: "12h",
      dateFormat: "us",
      numberFormat: "us",
      currencyDisplay: "symbol",
    },
  },

  appearance: {
    mode: "system",
    density: "comfortable",
    fontScale: "default",
    animations: "full",
    rounded: "default",
  },



  notifications: {
    masterEnabled: true,
    categories: {
      "dev-workspace": true,
      investing: true,
      markets: true,
      vault: true,
    },
    sound: true,
    unreadBadge: true,
    needsAttentionOnHome: true,
    keepResolvedNotifications: true,
    quietMode: false,
  },

  devWorkspace: {
    editor: {
      fontSize: 14,
      tabSize: 2,
      wordWrap: false,
      minimap: true,
      autosave: true,
    },
    projects: {
      restoreLastProject: true,
      createHistoryBeforeEdits: true,
      maxLocalHistory: 50,
    },
    preview: {
      defaultDevice: "auto",
      autoRefresh: true,
      startRuntimeAutomatically: false,
      showRuntimeDiagnostics: true,
    },
    visualEditor: {
      preferVisualEditWhenSafe: true,
      fallbackToDirectEdit: true,
      showSourceMapping: true,
      snapshotBeforeStructuralEdit: true,
      defaultResponsiveBreakpoint: "desktop",
    },
  },

  privacy: {
    privacyMode: false,
    maskSensitiveInNotifications: true,
    maskSensitiveInGlobalSearch: true,
    maskSensitiveOnHome: false,
  },

  accessibility: {
    reduceMotion: false,
    highContrast: false,
    largerText: false,
    keyboardFocusIndicators: true,
  },

  aiBehavior: { responseStyle: "balanced", contextLevel: "standard", rememberConversations: true, allowProjectContext: true },
  selectedSettingsSection: "general",
  settingsSearchQuery: "",
};

/* ─────────────────────────────────────────────────────────────────────── */
/* Store                                                                    */
/* ─────────────────────────────────────────────────────────────────────── */

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,

      setAIBehavior: (patch) => set((s) => ({ aiBehavior: { ...s.aiBehavior, ...patch } })),
      setGeneralStartup: (patch) =>
        set((s) => ({ general: { ...s.general, startup: { ...s.general.startup, ...patch } } })),
      setGeneralNavigation: (patch) =>
        set((s) => ({ general: { ...s.general, navigation: { ...s.general.navigation, ...patch } } })),
      setGeneralRegional: (patch) =>
        set((s) => ({ general: { ...s.general, regional: { ...s.general.regional, ...patch } } })),

      setAppearance: (patch) =>
        set((s) => ({ appearance: { ...s.appearance, ...patch } })),


      setNotifications: (patch) =>
        set((s) => ({ notifications: { ...s.notifications, ...patch } })),
      setNotificationCategory: (cat, enabled) =>
        set((s) => ({
          notifications: {
            ...s.notifications,
            categories: { ...s.notifications.categories, [cat]: enabled },
          },
        })),

      setDevWorkspaceEditor: (patch) =>
        set((s) => ({
          devWorkspace: {
            ...s.devWorkspace,
            editor: { ...s.devWorkspace.editor, ...patch },
          },
        })),
      setDevWorkspaceProjects: (patch) =>
        set((s) => ({
          devWorkspace: {
            ...s.devWorkspace,
            projects: { ...s.devWorkspace.projects, ...patch },
          },
        })),
      setDevWorkspacePreview: (patch) =>
        set((s) => ({
          devWorkspace: {
            ...s.devWorkspace,
            preview: { ...s.devWorkspace.preview, ...patch },
          },
        })),
      setDevWorkspaceVisualEditor: (patch) =>
        set((s) => ({
          devWorkspace: {
            ...s.devWorkspace,
            visualEditor: { ...s.devWorkspace.visualEditor, ...patch },
          },
        })),

      setPrivacy: (patch) => set((s) => ({ privacy: { ...s.privacy, ...patch } })),

      setAccessibility: (patch) => set((s) => ({ accessibility: { ...s.accessibility, ...patch } })),

      setSelectedSettingsSection: (id) => set({ selectedSettingsSection: id }),
      setSettingsSearchQuery: (q) => set({ settingsSearchQuery: q }),

      resetAllSettings: () => set({ ...DEFAULT_STATE }),
    }),
    {
      name: "lucian-settings",
      version: 1,
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
        }
        return localStorage;
      }),
      migrate: (persisted, version) => {
        // Forward-compatible: if we add fields in future versions, merge
        // them with defaults so missing fields don't break the UI.
        const s = (persisted ?? {}) as Partial<SettingsState>;
        return {
          ...DEFAULT_STATE,
          ...s,
          aiBehavior: { ...DEFAULT_STATE.aiBehavior, ...(s.aiBehavior ?? {}) },
          general: { ...DEFAULT_STATE.general, ...(s.general ?? {}) },
          appearance: { ...DEFAULT_STATE.appearance, ...(s.appearance ?? {}) },
          notifications: {
            ...DEFAULT_STATE.notifications,
            ...(s.notifications ?? {}),
            categories: {
              ...DEFAULT_STATE.notifications.categories,
              ...((s.notifications ?? {}).categories ?? {}),
            },
          },
          devWorkspace: {
            ...DEFAULT_STATE.devWorkspace,
            ...(s.devWorkspace ?? {}),
            editor: { ...DEFAULT_STATE.devWorkspace.editor, ...((s.devWorkspace ?? {}).editor ?? {}) },
            projects: { ...DEFAULT_STATE.devWorkspace.projects, ...((s.devWorkspace ?? {}).projects ?? {}) },
            preview: { ...DEFAULT_STATE.devWorkspace.preview, ...((s.devWorkspace ?? {}).preview ?? {}) },
            visualEditor: { ...DEFAULT_STATE.devWorkspace.visualEditor, ...((s.devWorkspace ?? {}).visualEditor ?? {}) },
          },
          privacy: { ...DEFAULT_STATE.privacy, ...(s.privacy ?? {}) },
          accessibility: { ...DEFAULT_STATE.accessibility, ...(s.accessibility ?? {}) },
        } as SettingsState;
      },
    },
  ),
);

/* ─────────────────────────────────────────────────────────────────────── */
/* Convenience selectors (pure functions, not hooks)                       */
/* ─────────────────────────────────────────────────────────────────────── */

/** Returns true if a notification category is allowed to notify. */
export function isNotificationCategoryEnabled(
  state: SettingsState,
  category: NotificationCategory,
): boolean {
  if (!state.notifications.masterEnabled) return false;
  return state.notifications.categories[category] !== false;
}

/** Returns true if quiet mode is on (suppresses sound and badges but
 *  keeps records). */
export function isQuietMode(state: SettingsState): boolean {
  return state.notifications.quietMode;
}
