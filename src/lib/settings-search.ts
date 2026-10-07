/* LUCIAN — Settings search index.
 *
 * ONE canonical index of searchable Settings entries. Used by the
 * Settings page's search input. Each entry maps a search term to a
 * Settings section so typing "theme" jumps to Appearance → Theme,
 * "GitHub" → Connections or DevWorkspace, etc.
 *
 * The index is deliberately a static array — it is the search corpus.
 * We do NOT scrape the DOM. New sections / subsections add new entries
 * here.
 */

import type { SettingsSectionId } from "@/store/settings";

export interface SettingsSearchEntry {
  /** Section the entry lives in. */
  section: SettingsSectionId;
  /** Subsection label (the in-page group the user lands on). */
  subsection: string;
  /** The visible label of the setting. */
  label: string;
  /** A short description / hint shown in the search results. */
  description: string;
  /** Lower-cased search keywords (matched as a substring). Includes the
   *  label + subsection + a few synonyms. */
  keywords: string[];
}

export const SETTINGS_SEARCH_INDEX: SettingsSearchEntry[] = [
  /* ── General ── */
  { section: "general", subsection: "Startup", label: "Open Home on launch", description: "Open the Home page when LUCIAN starts.", keywords: ["startup", "launch", "open", "home", "boot"] },
  { section: "general", subsection: "Startup", label: "Reopen last module", description: "Restore the module you last used.", keywords: ["startup", "module", "restore", "reopen", "last"] },
  { section: "general", subsection: "Startup", label: "Reopen last DevWorkspace project", description: "Restore the last open DevWorkspace project.", keywords: ["startup", "dev-workspace", "project", "restore", "reopen"] },
  { section: "general", subsection: "Startup", label: "Restore previous tabs / session", description: "Restore the tabs and modules from your previous session.", keywords: ["startup", "tabs", "session", "restore"] },
  { section: "general", subsection: "Navigation", label: "Default landing page", description: "Where LUCIAN lands when you open the app.", keywords: ["navigation", "landing", "default", "page", "home"] },
  { section: "general", subsection: "Navigation", label: "Internal links behavior", description: "Whether in-app links open in the same tab or a new tab.", keywords: ["navigation", "internal", "links", "tab"] },
  { section: "general", subsection: "Navigation", label: "External links behavior", description: "Whether external links open in the same tab or a new tab.", keywords: ["navigation", "external", "links", "tab"] },
  { section: "general", subsection: "Navigation", label: "Remember sidebar collapsed state", description: "Keep the sidebar collapsed or expanded as you left it.", keywords: ["navigation", "sidebar", "collapsed", "remember"] },
  { section: "general", subsection: "Regional", label: "Language", description: "Display language for LUCIAN.", keywords: ["regional", "language", "locale"] },
  { section: "general", subsection: "Regional", label: "Time format (12h / 24h)", description: "How times are displayed across LUCIAN.", keywords: ["regional", "time", "12", "24", "hour"] },
  { section: "general", subsection: "Regional", label: "Date format", description: "How dates are displayed.", keywords: ["regional", "date", "format", "iso", "us", "eu"] },
  { section: "general", subsection: "Regional", label: "Number format", description: "How numbers are displayed.", keywords: ["regional", "number", "format"] },
  { section: "general", subsection: "Regional", label: "Currency display", description: "Whether currency is shown as symbol, code, or name.", keywords: ["regional", "currency", "display", "symbol", "code"] },

  /* ── Appearance ── */
  { section: "appearance", subsection: "Mode", label: "Appearance Mode", description: "System / Dark / Light.", keywords: ["appearance", "mode", "dark", "light", "system", "theme"] },
  { section: "appearance", subsection: "Theme", label: "Theme", description: "Background theme for the entire interface.", keywords: ["appearance", "theme", "background", "midnight", "deep", "charcoal", "espresso", "purple", "teal", "forest", "white", "creamy"] },
  { section: "appearance", subsection: "Accent", label: "Accent color", description: "Used for primary actions, active states, focus rings.", keywords: ["appearance", "accent", "color", "gold", "orange", "emerald", "blue", "purple", "crimson", "rose", "ink"] },
  { section: "appearance", subsection: "Interface", label: "Density", description: "Comfortable or compact spacing.", keywords: ["appearance", "density", "compact", "comfortable", "spacing"] },
  { section: "appearance", subsection: "Interface", label: "Font size", description: "Small / Default / Large text size.", keywords: ["appearance", "font", "size", "scale", "text"] },
  { section: "appearance", subsection: "Interface", label: "Animations", description: "Full or reduced motion.", keywords: ["appearance", "animations", "motion", "reduced"] },
  { section: "appearance", subsection: "Interface", label: "Rounded interface", description: "Default or reduced corner radius.", keywords: ["appearance", "rounded", "corner", "radius"] },

  /* ── Notifications ── */
  { section: "notifications", subsection: "Master", label: "Notifications master toggle", description: "Turn all notifications on or off.", keywords: ["notifications", "master", "enable", "disable", "on", "off"] },
  { section: "notifications", subsection: "Categories", label: "DevWorkspace notifications", description: "Runtime / build failure notifications.", keywords: ["notifications", "dev-workspace", "runtime", "build", "failures", "category"] },
  { section: "notifications", subsection: "Categories", label: "Investing notifications", description: "Thesis review reminders.", keywords: ["notifications", "investing", "thesis", "review", "category"] },
  { section: "notifications", subsection: "Categories", label: "Markets notifications", description: "Triggered price alerts.", keywords: ["notifications", "markets", "price", "alert", "category"] },
  { section: "notifications", subsection: "Categories", label: "Vault notifications", description: "Important financial activity, large transactions, provider failures.", keywords: ["notifications", "vault", "financial", "transaction", "category"] },
  { section: "notifications", subsection: "Global", label: "Notification sound", description: "Play a sound when notifications arrive.", keywords: ["notifications", "sound", "global"] },
  { section: "notifications", subsection: "Global", label: "Unread badge", description: "Show the unread count on the bell icon.", keywords: ["notifications", "unread", "badge", "bell"] },
  { section: "notifications", subsection: "Global", label: "Needs Attention on Home", description: "Show actionable notifications on the Home page.", keywords: ["notifications", "needs", "attention", "home"] },
  { section: "notifications", subsection: "Global", label: "Keep resolved notifications", description: "Keep resolved notifications in history instead of hiding them.", keywords: ["notifications", "resolved", "keep", "history"] },
  { section: "notifications", subsection: "Global", label: "Quiet mode", description: "Suppress sound and badges but keep records.", keywords: ["notifications", "quiet", "silent", "mode"] },

  /* ── DevWorkspace ── */
  { section: "dev-workspace", subsection: "Editor", label: "Font size", description: "Code editor font size.", keywords: ["dev-workspace", "editor", "font", "size"] },
  { section: "dev-workspace", subsection: "Editor", label: "Tab size", description: "Indentation width in spaces.", keywords: ["dev-workspace", "editor", "tab", "size", "indent"] },
  { section: "dev-workspace", subsection: "Editor", label: "Word wrap", description: "Wrap long lines in the editor.", keywords: ["dev-workspace", "editor", "word", "wrap"] },
  { section: "dev-workspace", subsection: "Editor", label: "Minimap", description: "Show the code minimap.", keywords: ["dev-workspace", "editor", "minimap"] },
  { section: "dev-workspace", subsection: "Editor", label: "Autosave", description: "Automatically save file changes.", keywords: ["dev-workspace", "editor", "autosave", "save"] },
  { section: "dev-workspace", subsection: "Projects", label: "Restore last project", description: "Reopen the last project when DevWorkspace loads.", keywords: ["dev-workspace", "projects", "restore", "last", "reopen"] },
  { section: "dev-workspace", subsection: "Projects", label: "Create history before significant edits", description: "Snapshot the project before structural edits.", keywords: ["dev-workspace", "projects", "history", "snapshot", "edit"] },
  { section: "dev-workspace", subsection: "Projects", label: "Maximum local history", description: "Number of history snapshots to keep per project.", keywords: ["dev-workspace", "projects", "history", "max", "limit"] },
  { section: "dev-workspace", subsection: "Preview", label: "Default device", description: "Default responsive preview device.", keywords: ["dev-workspace", "preview", "device", "responsive", "mobile", "tablet", "desktop"] },
  { section: "dev-workspace", subsection: "Preview", label: "Auto refresh", description: "Refresh the preview automatically when files change.", keywords: ["dev-workspace", "preview", "auto", "refresh"] },
  { section: "dev-workspace", subsection: "Preview", label: "Start runtime automatically", description: "Auto-start the WebContainer runtime when a project opens.", keywords: ["dev-workspace", "preview", "runtime", "start", "auto", "webcontainer"] },
  { section: "dev-workspace", subsection: "Preview", label: "Show runtime diagnostics", description: "Show runtime status diagnostics in the preview pane.", keywords: ["dev-workspace", "preview", "runtime", "diagnostics", "status"] },
  { section: "dev-workspace", subsection: "Visual Editor", label: "Prefer Visual Edit when safe", description: "Use the visual editor when the edit is safe.", keywords: ["dev-workspace", "visual", "editor", "prefer", "safe"] },
  { section: "dev-workspace", subsection: "Visual Editor", label: "Fallback to Direct Edit", description: "Fall back to direct source edit when visual edit is unsafe.", keywords: ["dev-workspace", "visual", "editor", "fallback", "direct"] },
  { section: "dev-workspace", subsection: "Visual Editor", label: "Show source mapping", description: "Show which source lines a visual edit affected.", keywords: ["dev-workspace", "visual", "editor", "source", "mapping"] },
  { section: "dev-workspace", subsection: "Visual Editor", label: "Snapshot before structural edit", description: "Take a project snapshot before structural visual edits.", keywords: ["dev-workspace", "visual", "editor", "snapshot", "structural"] },
  { section: "dev-workspace", subsection: "Visual Editor", label: "Default responsive breakpoint", description: "Initial preview width for visual edits.", keywords: ["dev-workspace", "visual", "editor", "responsive", "breakpoint", "default"] },
  { section: "dev-workspace", subsection: "GitHub", label: "Public GitHub Import", description: "Import a public GitHub repository as a DevWorkspace project.", keywords: ["dev-workspace", "github", "public", "import", "repository"] },
  { section: "dev-workspace", subsection: "GitHub", label: "Private repositories", description: "Authenticate to import private GitHub repositories.", keywords: ["dev-workspace", "github", "private", "authentication", "repositories"] },

  /* ── Privacy & Security ── */
  { section: "privacy", subsection: "Privacy Mode", label: "Privacy Mode", description: "Mask sensitive values across LUCIAN.", keywords: ["privacy", "mode", "mask", "sensitive"] },
  { section: "privacy", subsection: "Masking", label: "Mask sensitive in notifications", description: "Hide sensitive values inside notification messages.", keywords: ["privacy", "mask", "sensitive", "notifications"] },
  { section: "privacy", subsection: "Masking", label: "Mask sensitive in Global Search", description: "Hide sensitive values in Global Search results.", keywords: ["privacy", "mask", "sensitive", "global", "search"] },
  { section: "privacy", subsection: "Masking", label: "Mask sensitive on Home", description: "Hide sensitive values on the Home page.", keywords: ["privacy", "mask", "sensitive", "home"] },
  { section: "privacy", subsection: "Vault Security", label: "Vault → Security", description: "Vault-specific financial security (withdrawal limits, allowlists). Lives in Vault, not Settings.", keywords: ["privacy", "vault", "security", "withdrawal", "limit", "allowlist", "2fa", "destination"] },

  /* ── Data & Storage ── */
  { section: "data-storage", subsection: "Usage", label: "Storage usage", description: "Per-module local storage usage for LUCIAN.", keywords: ["data", "storage", "usage", "size", "local"] },
  { section: "data-storage", subsection: "Backup", label: "Export LUCIAN local backup", description: "Download a backup of LUCIAN local data.", keywords: ["data", "storage", "backup", "export", "download"] },
  { section: "data-storage", subsection: "Backup", label: "Import local backup", description: "Restore a previously exported LUCIAN backup.", keywords: ["data", "storage", "backup", "import", "restore"] },
  { section: "data-storage", subsection: "Cleanup", label: "Clear cached preview data", description: "Remove cached preview data without touching projects.", keywords: ["data", "storage", "clear", "cache", "preview"] },
  { section: "data-storage", subsection: "Cleanup", label: "Manage project storage", description: "Per-project storage management.", keywords: ["data", "storage", "manage", "project"] },
  { section: "data-storage", subsection: "Cleanup", label: "Clear notification history", description: "Remove all stored notification records.", keywords: ["data", "storage", "clear", "notifications", "history"] },
  { section: "data-storage", subsection: "Cleanup", label: "Reset individual local module data", description: "Reset one module's local data at a time.", keywords: ["data", "storage", "reset", "module", "individual"] },
  { section: "data-storage", subsection: "Danger Zone", label: "Reset LUCIAN local data", description: "Reset ALL local LUCIAN data (UI cache, manual accounts, preferences).", keywords: ["data", "storage", "danger", "reset", "all", "local"] },
  { section: "data-storage", subsection: "Danger Zone", label: "Delete all local projects", description: "Permanently delete every local DevWorkspace project.", keywords: ["data", "storage", "danger", "delete", "projects"] },

  /* ── Connections ── */
  { section: "connections", subsection: "Development", label: "GitHub Public Import", description: "Status of the public GitHub import capability.", keywords: ["connections", "github", "public", "import"] },
  { section: "connections", subsection: "Development", label: "GitHub Account", description: "GitHub account connection (private repo access).", keywords: ["connections", "github", "account", "private", "auth"] },
  { section: "connections", subsection: "Market / Data", label: "Markets data provider", description: "Status of the markets data provider.", keywords: ["connections", "markets", "data", "provider", "news"] },
  { section: "connections", subsection: "Vault / Finance", label: "Stripe", description: "Vault payment provider status.", keywords: ["connections", "vault", "stripe", "payment", "card"] },
  { section: "connections", subsection: "Vault / Finance", label: "Plaid", description: "Vault bank provider status.", keywords: ["connections", "vault", "plaid", "bank"] },
  { section: "connections", subsection: "Vault / Finance", label: "Bybit", description: "Vault exchange status and encrypted owner credentials.", keywords: ["connections", "vault", "bybit", "crypto", "trading"] },
  { section: "connections", subsection: "Vault / Finance", label: "Alpaca", description: "Vault broker provider status.", keywords: ["connections", "vault", "alpaca", "broker"] },
  { section: "connections", subsection: "Vault / Finance", label: "Database / Neon", description: "Status of the Vault Postgres database (Neon / Vercel Postgres).", keywords: ["connections", "vault", "database", "neon", "postgres", "url"] },

  /* ── Accessibility & Shortcuts ── */
  { section: "accessibility", subsection: "Accessibility", label: "Reduce motion", description: "Minimize animations across LUCIAN.", keywords: ["accessibility", "reduce", "motion", "animation"] },
  { section: "accessibility", subsection: "Accessibility", label: "High contrast", description: "Increase contrast for better readability.", keywords: ["accessibility", "high", "contrast"] },
  { section: "accessibility", subsection: "Accessibility", label: "Larger interface text", description: "Larger text size across the interface.", keywords: ["accessibility", "larger", "text", "font"] },
  { section: "accessibility", subsection: "Accessibility", label: "Keyboard focus indicators", description: "Show visible focus rings on keyboard navigation.", keywords: ["accessibility", "keyboard", "focus", "indicators"] },
  { section: "accessibility", subsection: "Shortcuts", label: "Global Search", description: "Ctrl/Cmd + K opens Global Search.", keywords: ["accessibility", "shortcuts", "global", "search", "cmd", "ctrl", "k"] },
  { section: "accessibility", subsection: "Shortcuts", label: "Close dialog", description: "Esc closes any open dialog.", keywords: ["accessibility", "shortcuts", "close", "dialog", "esc"] },
  { section: "accessibility", subsection: "Shortcuts", label: "DevWorkspace Save", description: "Ctrl/Cmd + S saves the active file in DevWorkspace.", keywords: ["accessibility", "shortcuts", "dev-workspace", "save", "cmd", "ctrl", "s"] },
  { section: "accessibility", subsection: "Shortcuts", label: "File Search", description: "Ctrl/Cmd + P opens file search inside DevWorkspace.", keywords: ["accessibility", "shortcuts", "file", "search", "ctrl", "cmd", "p"] },

  /* ── Account ── */
  { section: "account", subsection: "Account", label: "Account status", description: "LUCIAN currently runs without full account authentication.", keywords: ["account", "auth", "login", "session"] },
  { section: "account", subsection: "Local Workspace", label: "Local Workspace", description: "Active local workspace (no cloud account needed).", keywords: ["account", "local", "workspace", "active"] },

  /* ── About & Diagnostics ── */
  { section: "about", subsection: "About", label: "Version", description: "LUCIAN version information.", keywords: ["about", "version", "build"] },
  { section: "about", subsection: "System Status", label: "System status", description: "Real-time status of LUCIAN subsystems.", keywords: ["about", "system", "status", "diagnostics", "ready"] },
  { section: "about", subsection: "Diagnostics", label: "Run diagnostics", description: "Run a real diagnostic check of LUCIAN subsystems.", keywords: ["about", "diagnostics", "run", "check", "test"] },
  { section: "about", subsection: "About", label: "Licenses", description: "Open-source licenses used by LUCIAN.", keywords: ["about", "licenses", "open", "source"] },
  { section: "about", subsection: "About", label: "Privacy / About", description: "Privacy and about information.", keywords: ["about", "privacy", "information"] },
];

/**
 * Search the settings index. Returns matches sorted by relevance
 * (label match first, then keyword match). Empty query returns an
 * empty array (the caller shows the section list when no query).
 */
export function searchSettings(query: string, limit = 12): SettingsSearchEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const labelMatches: SettingsSearchEntry[] = [];
  const keywordMatches: SettingsSearchEntry[] = [];
  const descMatches: SettingsSearchEntry[] = [];

  for (const entry of SETTINGS_SEARCH_INDEX) {
    const label = entry.label.toLowerCase();
    const keywords = entry.keywords.join(" ");
    const desc = entry.description.toLowerCase();

    if (label.includes(q)) {
      labelMatches.push(entry);
    } else if (keywords.includes(q)) {
      keywordMatches.push(entry);
    } else if (desc.includes(q)) {
      descMatches.push(entry);
    }
  }

  // Deduplicate (an entry could match both label and keywords).
  const seen = new Set<string>();
  const out: SettingsSearchEntry[] = [];
  for (const e of [...labelMatches, ...keywordMatches, ...descMatches]) {
    const key = `${e.section}:${e.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Map a search query to the single best section to jump to. Used by
 * the global "Search settings" input — typing a query and pressing
 * Enter jumps directly to the best section.
 */
export function bestSectionForQuery(query: string): SettingsSectionId | null {
  const matches = searchSettings(query, 1);
  return matches[0]?.section ?? null;
}
