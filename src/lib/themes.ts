export type ThemeId =
  | "midnight-gray"
  | "deep-black"
  | "charcoal"
  | "midnight-blue"
  | "deep-teal"
  | "forest-night"
  | "espresso"
  | "deep-purple"
  | "natural-white"
  | "creamy-light";

export type AccentId =
  | "lucian-gold"
  | "orange"
  | "emerald"
  | "ocean-blue"
  | "royal-purple"
  | "crimson"
  | "rose"
  | "ink";

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  description: string;
  /** Small palette preview: [canvas, surface, line, fg] */
  preview: [string, string, string, string];
  light?: boolean;
}

export interface AccentDefinition {
  id: AccentId;
  name: string;
  color: string;
}

export const THEMES: ThemeDefinition[] = [
  {
    id: "midnight-gray",
    name: "Midnight Gray",
    description: "Cool gray with quiet contrast",
    preview: ["#0e1013", "#151a1e", "#2b333b", "#e6e9ec"],
  },
  {
    id: "deep-black",
    name: "Deep Black",
    description: "Pure, focused and minimal",
    preview: ["#000000", "#0c0c0c", "#2a2a2a", "#f0f0f0"],
  },
  {
    id: "charcoal",
    name: "Charcoal",
    description: "Soft black for long sessions",
    preview: ["#1b1d1e", "#232526", "#3b3e40", "#e9e9e7"],
  },
  {
    id: "midnight-blue",
    name: "Midnight Blue",
    description: "Deep blue studio atmosphere",
    preview: ["#0c1322", "#121c31", "#2b3a58", "#e4e9f3"],
  },
  {
    id: "deep-teal",
    name: "Deep Teal",
    description: "Calm teal with cool depth",
    preview: ["#081a1d", "#0e2529", "#234850", "#e0ecec"],
  },
  {
    id: "forest-night",
    name: "Forest Night",
    description: "Muted green, low-light canvas",
    preview: ["#0e1611", "#142018", "#2c4133", "#e2ebe4"],
  },
  {
    id: "espresso",
    name: "Espresso",
    description: "Dark warm brown, dark-academia feel",
    preview: ["#19110c", "#231913", "#453325", "#f0e6dc"],
  },
  {
    id: "deep-purple",
    name: "Deep Purple",
    description: "Creative violet without glare",
    preview: ["#130f1e", "#1b152c", "#382e55", "#e9e4f2"],
  },
  {
    id: "natural-white",
    name: "Natural White",
    description: "Clean neutral workspace",
    preview: ["#f6f8fa", "#ffffff", "#d1d9e0", "#1f2328"],
    light: true,
  },
  {
    id: "creamy-light",
    name: "Creamy Light",
    description: "Warm paper-like light workspace",
    preview: ["#f7f2e7", "#fffcf4", "#ddd1ba", "#2b2418"],
    light: true,
  },
];

export const ACCENTS: AccentDefinition[] = [
  { id: "lucian-gold", name: "Lucian Gold", color: "#d4a72c" },
  { id: "orange", name: "Orange", color: "#ec7211" },
  { id: "emerald", name: "Emerald", color: "#23a55f" },
  { id: "ocean-blue", name: "Ocean Blue", color: "#2f81f7" },
  { id: "royal-purple", name: "Royal Purple", color: "#8957e5" },
  { id: "crimson", name: "Crimson", color: "#d1242f" },
  { id: "rose", name: "Rose", color: "#e0559f" },
  { id: "ink", name: "Ink", color: "#64707d" },
];

export const DEFAULT_THEME: ThemeId = "midnight-gray";
export const DEFAULT_ACCENT: AccentId = "lucian-gold";

/**
 * Storage keys are namespaced under "lucian-".
 *
 * NOTE: an older build of this project used "lucid-theme" / "lucid-accent".
 * On first load we transparently migrate those values to the new keys so
 * existing users keep their preferences.
 */
export const THEME_STORAGE_KEY = "lucian-theme";
export const ACCENT_STORAGE_KEY = "lucian-accent";
/** Legacy keys kept only for one-time migration. */
export const LEGACY_THEME_STORAGE_KEY = "lucid-theme";
export const LEGACY_ACCENT_STORAGE_KEY = "lucid-accent";

export const THEME_IDS = THEMES.map((t) => t.id);
export const ACCENT_IDS = ACCENTS.map((a) => a.id);
