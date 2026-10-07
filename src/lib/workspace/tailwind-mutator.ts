"use client";

/* Tailwind utility class mutator — Phase 12.
 *
 * Operates on a STATIC className string (e.g. "p-4 text-sm bg-blue-500").
 * For dynamic className expressions (cn(), clsx(), template literals,
 * conditionals) → the visual editor falls back to Direct Edit.
 *
 * Categories supported (matches the Phase 12 brief):
 *   - padding (p, px, py, pt, pr, pb, pl)
 *   - margin (m, mx, my, mt, mr, mb, ml)
 *   - gap (gap, gap-x, gap-y)
 *   - width/height (w-*, h-*, min-w-*, min-h-*, max-w-*, max-h-*)
 *   - font size (text-xs…text-9xl)
 *   - font weight (font-thin…font-black)
 *   - text alignment (text-left/center/right/justify)
 *   - background (bg-*)
 *   - text color (text-* — but NOT text size; we distinguish by pattern)
 *   - borders (border, border-*, border-{width}, border-{color})
 *   - radius (rounded, rounded-*)
 *
 * Responsive prefixes:
 *   sm:, md:, lg:, xl:, 2xl: are preserved / added / removed per breakpoint.
 */

export type Breakpoint = "base" | "sm" | "md" | "lg" | "xl" | "2xl";

/** Tailwind utility category. */
export type TwCategory =
  | "padding" | "margin" | "gap"
  | "width" | "height" | "minWidth" | "maxWidth" | "minHeight" | "maxHeight"
  | "fontSize" | "fontWeight" | "textAlign"
  | "backgroundColor" | "textColor"
  | "borderWidth" | "borderColor"
  | "borderRadius" | "opacity";

/** A single parsed Tailwind utility. */
export interface TwUtility {
  /** Full original class string (e.g. "md:p-4"). */
  raw: string;
  /** Breakpoint prefix (e.g. "md") or "base" if none. */
  breakpoint: Breakpoint;
  /** Category. */
  category: TwCategory;
  /** The part after the prefix (e.g. "p-4"). */
  body: string;
}

/** Parse a className string into Tailwind utilities + non-Tailwind classes. */
export function parseTailwindClasses(className: string): {
  utilities: TwUtility[];
  other: string[];
} {
  const tokens = className.split(/\s+/).filter(Boolean);
  const utilities: TwUtility[] = [];
  const other: string[] = [];
  for (const tok of tokens) {
    const parsed = parseOneUtility(tok);
    if (parsed) {
      utilities.push(parsed);
    } else {
      other.push(tok);
    }
  }
  return { utilities, other };
}

function parseOneUtility(raw: string): TwUtility | null {
  // Match optional breakpoint prefix + body.
  const m = /^((?:sm|md|lg|xl|2xl):)?(.+)$/.exec(raw);
  if (!m) return null;
  const prefix = m[1];
  const body = m[2];
  const breakpoint: Breakpoint = prefix ? (prefix.replace(/:$/, "") as Breakpoint) : "base";

  const category = categorize(body);
  if (!category) return null;

  return { raw, breakpoint, category, body };
}

function categorize(body: string): TwCategory | null {
  // Order matters — more specific patterns first.

  // padding / margin / gap
  if (/^p[xytrbl]?-\d/.test(body) || /^p[xytrbl]?$/.test(body)) return "padding";
  if (/^m[xytrbl]?-\d/.test(body) || /^m[xytrbl]?$/.test(body)) return "margin";
  if (/^gap-[xy]?\d/.test(body) || /^gap$/.test(body)) return "gap";

  // width / height
  if (/^min-w-(\[.+\]|\d)/.test(body) || /^min-w-(full|screen|auto|min|max|fit)$/.test(body)) return "minWidth";
  if (/^max-w-(\[.+\]|\d)/.test(body) || /^max-w-(full|screen|none|xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|prose)$/.test(body)) return "maxWidth";
  if (/^min-h-(\[.+\]|\d)/.test(body) || /^min-h-(full|screen|auto|min|max|fit)$/.test(body)) return "minHeight";
  if (/^max-h-(\[.+\]|\d)/.test(body) || /^max-h-(full|screen|none)$/.test(body)) return "maxHeight";
  if (/^w-(\[.+\]|\d)/.test(body) || /^w-(full|screen|auto|min|max|fit)$/.test(body)) return "width";
  if (/^h-(\[.+\]|\d)/.test(body) || /^h-(full|screen|auto|min|max|fit)$/.test(body)) return "height";

  // font size — text-xs…text-9xl (NOT text-left/center/right which is align).
  if (/^text-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/.test(body)) return "fontSize";
  // font weight
  if (/^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/.test(body)) return "fontWeight";
  // text alignment
  if (/^text-(left|center|right|justify)$/.test(body)) return "textAlign";

  // background color — bg-{color}-{shade} or bg-{color}
  if (/^bg-/.test(body)) return "backgroundColor";
  // text color — text-{color}-{shade} (NOT text-xs etc. which is font size)
  if (/^text-[a-z]+-\d{2,3}$/.test(body) || /^text-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white|transparent|current)$/.test(body)) return "textColor";

  // border
  if (/^border-(t|r|b|l)-\d/.test(body) || /^border-[trbl]?$/.test(body) || /^border-\d$/.test(body)) return "borderWidth";
  if (/^border-/.test(body)) {
    // border-{color} or border-{style}
    if (/^(solid|dashed|dotted|double|none)$/.test(body.replace(/^border-/, ""))) return "borderWidth"; // style grouped under width for simplicity
    return "borderColor";
  }

  // border radius
  if (/^rounded(-([tlbr]|[tlbr]{2}))?(-(none|sm|md|lg|xl|2xl|3xl|full))?$/.test(body)) return "borderRadius";

  // opacity
  if (/^opacity-\d+$/.test(body)) return "opacity";

  return null;
}

/** Build a className string from utilities + other classes. */
function serializeTailwindClasses(utilities: TwUtility[], other: string[]): string {
  return [...utilities.map((u) => u.raw), ...other].filter(Boolean).join(" ");
}

/**
 * Set a Tailwind utility for a (category, breakpoint) pair.
 *
 * - If an existing utility matches the same category + breakpoint, it's
 *   replaced (e.g. setUtility("p-6", "padding", "base") replaces "p-4").
 * - If value is empty, the existing utility for that category+breakpoint
 *   is removed.
 * - Otherwise, the new utility is appended.
 *
 * Returns the new className string.
 */
export function setTailwindUtility(
  className: string,
  newUtilityBody: string,
  category: TwCategory,
  breakpoint: Breakpoint = "base",
): string {
  const { utilities, other } = parseTailwindClasses(className);
  const prefix = breakpoint === "base" ? "" : `${breakpoint}:`;
  const newRaw = `${prefix}${newUtilityBody}`;

  // Remove existing utilities with the same category + breakpoint.
  const filtered = utilities.filter(
    (u) => !(u.category === category && u.breakpoint === breakpoint),
  );

  // If the new body is empty, we just removed the existing one — done.
  if (!newUtilityBody) {
    return serializeTailwindClasses(filtered, other);
  }

  // Add the new utility.
  const newUtility = parseOneUtility(newRaw);
  if (!newUtility) {
    // Not a recognized Tailwind utility — append as "other" so we don't
    // lose user-typed classes.
    return serializeTailwindClasses(filtered, [...other, newRaw]);
  }
  filtered.push(newUtility);
  return serializeTailwindClasses(filtered, other);
}

/**
 * Get the current Tailwind utility value for a (category, breakpoint) pair.
 *
 * Returns the body (e.g. "p-4") or null if no utility matches.
 */
export function getTailwindUtility(
  className: string,
  category: TwCategory,
  breakpoint: Breakpoint = "base",
): string | null {
  const { utilities } = parseTailwindClasses(className);
  const found = utilities.find(
    (u) => u.category === category && u.breakpoint === breakpoint,
  );
  return found ? found.body : null;
}

/**
 * Check if a className string is purely static (no dynamic expressions).
 *
 * The caller already knows whether the className attribute is a string
 * literal vs. an expression — this helper is for the case where the
 * className IS a string literal but the user wants to know if it's
 * safe to mutate (i.e. no template literals, no cn() calls inside the
 * string itself).
 *
 * Since string literals are always safe to mutate, this returns true
 * whenever the input is a string.
 */
export function isStaticClassName(className: string): boolean {
  return typeof className === "string";
}

/**
 * Suggest a Tailwind utility body for a CSS property + value.
 *
 * Used by the style inspector when the user types a CSS value (e.g.
 * "16px" for padding) — we suggest the closest Tailwind utility
 * (e.g. "p-4"). The suggestion is non-exhaustive and falls back to
 * arbitrary-value syntax (e.g. "p-[16px]") for unknown values.
 */
export function suggestTailwindBody(
  category: TwCategory,
  cssValue: string,
): string {
  if (!cssValue) return "";
  switch (category) {
    case "padding":
      return spacingToTailwind(cssValue, "p");
    case "margin":
      return spacingToTailwind(cssValue, "m");
    case "gap":
      return spacingToTailwind(cssValue, "gap");
    case "fontSize":
      return fontSizeToTailwind(cssValue);
    case "fontWeight":
      return fontWeightToTailwind(cssValue);
    case "borderRadius":
      return borderRadiusToTailwind(cssValue);
    default:
      return "";
  }
}

function spacingToTailwind(value: string, prefix: string): string {
  // Common Tailwind spacing scale: 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96
  // Each unit = 0.25rem = 4px (default).
  const px = parsePx(value);
  if (px === null) {
    // Non-px value (em, rem, %, etc.) → arbitrary value.
    return `${prefix}-[${cssEscape(value)}]`;
  }
  const units = px / 4;
  // Check if it's a clean Tailwind unit.
  const cleanUnits = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96];
  if (cleanUnits.includes(units)) {
    return `${prefix}-${units}`;
  }
  return `${prefix}-[${px}px]`;
}

function fontSizeToTailwind(value: string): string {
  const px = parsePx(value);
  if (px === null) return `text-[${cssEscape(value)}]`;
  // Map common sizes.
  const map: Record<number, string> = {
    12: "text-xs", 14: "text-sm", 16: "text-base", 18: "text-lg",
    20: "text-xl", 24: "text-2xl", 30: "text-3xl", 36: "text-4xl",
    48: "text-5xl", 60: "text-6xl", 72: "text-7xl", 96: "text-8xl", 128: "text-9xl",
  };
  return map[px] ?? `text-[${px}px]`;
}

function fontWeightToTailwind(value: string): string {
  const w = parseInt(value, 10);
  if (Number.isNaN(w)) return "";
  const map: Record<number, string> = {
    100: "font-thin", 200: "font-extralight", 300: "font-light",
    400: "font-normal", 500: "font-medium", 600: "font-semibold",
    700: "font-bold", 800: "font-extrabold", 900: "font-black",
  };
  return map[w] ?? "";
}

function borderRadiusToTailwind(value: string): string {
  const px = parsePx(value);
  if (px === null) {
    if (value === "9999px" || value === "50%") return "rounded-full";
    return `rounded-[${cssEscape(value)}]`;
  }
  const map: Record<number, string> = {
    0: "rounded-none", 2: "rounded-sm", 4: "rounded", 6: "rounded-md",
    8: "rounded-lg", 12: "rounded-xl", 16: "rounded-2xl", 24: "rounded-3xl",
  };
  return map[px] ?? (px === 9999 ? "rounded-full" : `rounded-[${px}px]`);
}

function parsePx(value: string): number | null {
  const m = /^(\d+(?:\.\d+)?)px$/.exec(value.trim());
  if (!m) return null;
  return parseFloat(m[1]);
}

function cssEscape(s: string): string {
  // Minimal CSS escape for arbitrary values — replace spaces with underscores.
  return s.trim().replace(/\s+/g, "_");
}
