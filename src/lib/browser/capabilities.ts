// LUCIAN Browser — Web vs Desktop capability matrix (Phase 15).
//
// ONE canonical definition of what the Web version of LUCIAN Browser
// can and cannot do, vs what a future Desktop version could do. This
// is referenced by the info panel so we don't duplicate explanatory
// text everywhere.
//
// Per spec section 27: do NOT claim future desktop features are
// already implemented. Do NOT add a fake "Launch Desktop Mode" button.

export interface CapabilityRow {
  feature: string;
  web: string;
  desktop: string;
}

/** The canonical capability matrix. Rendered by the Browser info panel. */
export const BROWSER_CAPABILITY_MATRIX: CapabilityRow[] = [
  { feature: "Tabs", web: "Yes", desktop: "Yes" },
  { feature: "Address bar", web: "Yes", desktop: "Yes" },
  { feature: "Bookmarks", web: "Yes", desktop: "Yes" },
  { feature: "LUCIAN history", web: "Yes", desktop: "Yes" },
  { feature: "Compatible iframe pages", web: "Yes", desktop: "Yes" },
  { feature: "Blocked-site bypass", web: "No (honest)", desktop: "No bypass" },
  { feature: "Broader browser engine", web: "No", desktop: "Yes" },
  { feature: "WebContents (native page)", web: "No", desktop: "Yes" },
  { feature: "Downloads manager", web: "Limited (browser-native)", desktop: "Full" },
  { feature: "DevTools", web: "No", desktop: "Possible" },
  { feature: "Extensions", web: "No", desktop: "Future/Maybe" },
  { feature: "Cross-origin DOM access", web: "No (security)", desktop: "Per engine/security" },
  { feature: "Website sessions", web: "Limited (third-party cookie rules)", desktop: "Desktop profile" },
  { feature: "Popups / new windows", web: "Limited", desktop: "Native handling" },
];

/** The "what Web can do" list (positive capabilities). */
export const WEB_CAN_DO: string[] = [
  "Embed compatible sites",
  "Manage LUCIAN tabs",
  "Manage LUCIAN history",
  "Manage bookmarks",
  "Navigate URLs",
  "Open blocked sites externally",
];

/** The "what Web cannot do" list (honest limitations). */
export const WEB_CANNOT_DO: string[] = [
  "Override X-Frame-Options",
  "Override CSP frame-ancestors",
  "Access cross-origin page DOM",
  "Freely control third-party authentication cookies",
  "Inspect arbitrary cross-origin navigation",
  "Install browser extensions",
  "Provide unrestricted DevTools",
  "Behave like Electron WebContents",
];

/** The "Desktop future" list — explicitly NOT implemented in Phase 15. */
export const DESKTOP_FUTURE: string[] = [
  "Electron WebContents or equivalent",
  "Real browser session/profile",
  "Desktop-native navigation",
  "Broader website compatibility",
  "Downloads manager",
  "Stronger browser integration",
];
