"use client";

/* CSS / CSS Module rule mutator — Phase 12.
 *
 * Operates on plain CSS and CSS Modules. For a selected element that
 * clearly maps to an isolated local CSS rule (e.g. `.card { ... }`),
 * the visual editor can mutate that rule's declarations.
 *
 * Safety:
 *   - We do NOT mutate broad selectors (`*`, `div`, `button`, `body`,
 *     `html`, `a`, etc.) without warning — those affect every matching
 *     element in the project and a visual edit could have unintended
 *     consequences. The caller decides whether to fall back to Direct Edit.
 *   - We do NOT mutate heavily-reused global classes without warning.
 *   - For CSS Modules (filename.module.css), the same logic applies but
 *     the scope is local to the importing component.
 *
 * Parser: we use a lightweight CSS tokenizer (not a full AST library) to
 * avoid pulling in another heavy dependency. This handles the common
 * cases (single-line rules, multi-line rules, nested @media queries).
 * Malformed CSS falls back to Direct Edit.
 */

export interface CssRuleLocation {
  /** Selector text (e.g. ".card", "button.primary"). */
  selector: string;
  /** Character offset where the rule starts (at the selector). */
  start: number;
  /** Character offset where the rule ends (after the closing brace). */
  end: number;
  /** The declarations block (text between { and }). */
  body: string;
  /** Body start offset (after the opening brace). */
  bodyStart: number;
  /** Body end offset (before the closing brace). */
  bodyEnd: number;
}

/**
 * Parse a CSS source string into a list of top-level rules.
 *
 * Handles:
 *   - Simple selectors: `.card { ... }`
 *   - Compound selectors: `button.primary:hover { ... }`
 *   - @media queries (the rule inside is included as a top-level rule
 *     with the media query as part of the selector for display purposes).
 *
 * Does NOT handle:
 *   - Nested CSS (CSS nesting spec) — falls back to Direct Edit if found.
 *   - SCSS/Less/Sass/Stylus — use the CSS Module parser instead or fall
 *     back to Direct Edit.
 */
export function parseCssRules(source: string): CssRuleLocation[] {
  const rules: CssRuleLocation[] = [];
  let i = 0;
  const len = source.length;

  while (i < len) {
    // Skip whitespace + comments.
    while (i < len && (/\s/.test(source[i]) || source.slice(i, i + 2) === "/*")) {
      if (source.slice(i, i + 2) === "/*") {
        const end = source.indexOf("*/", i + 2);
        i = end < 0 ? len : end + 2;
      } else {
        i++;
      }
    }
    if (i >= len) break;

    // Check for @media / @supports / @layer — we track the at-rule prefix
    // as part of the selector for display purposes, but the rule body is
    // still the innermost { ... }.
    let atRulePrefix = "";
    if (source[i] === "@") {
      // Read until the next { or ; (at-rules like @import end with ;).
      const braceOrSemi = findNext(source, i, ["{", ";"]);
      if (braceOrSemi < 0) break;
      if (source[braceOrSemi] === ";") {
        // Non-block at-rule (e.g. @import). Skip past it.
        i = braceOrSemi + 1;
        continue;
      }
      atRulePrefix = source.slice(i, braceOrSemi).trim() + " ";
      i = braceOrSemi + 1;
      // Skip whitespace.
      while (i < len && /\s/.test(source[i])) i++;
      if (i >= len) break;
    }

    // Read the selector (everything up to the next {).
    const selectorStart = i;
    const braceIdx = findNext(source, i, ["{"]);
    if (braceIdx < 0) break;
    const selector = (atRulePrefix + source.slice(selectorStart, braceIdx)).trim();
    // Skip whitespace inside the selector.
    const bodyStart = braceIdx + 1;
    // Find the matching closing brace (respecting nested braces in case
    // of nested CSS — we count depth).
    let depth = 1;
    let j = bodyStart;
    while (j < len && depth > 0) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}") depth--;
      if (depth === 0) break;
      j++;
    }
    if (depth !== 0) break; // malformed
    const bodyEnd = j;
    const end = j + 1;
    const body = source.slice(bodyStart, bodyEnd);

    rules.push({
      selector,
      start: selectorStart,
      end,
      body,
      bodyStart,
      bodyEnd,
    });

    i = end;
  }

  return rules;
}

function findNext(source: string, from: number, chars: string[]): number {
  for (let i = from; i < source.length; i++) {
    if (chars.includes(source[i])) return i;
  }
  return -1;
}

/**
 * Set a CSS declaration (property: value) inside a rule.
 *
 * - If the rule already has the property, replaces its value.
 * - If the rule doesn't have the property, appends it.
 * - If value is empty, removes the property.
 *
 * Returns the new full CSS source string.
 */
export function setCssDeclaration(
  source: string,
  ruleIndex: number,
  property: string,
  value: string,
): string {
  const rules = parseCssRules(source);
  const rule = rules[ruleIndex];
  if (!rule) return source;

  const newDeclaration = value.trim()
    ? `${property}: ${value};`
    : "";

  // Parse existing declarations.
  const decls = parseDeclarations(rule.body);
  const existingIdx = decls.findIndex((d) => d.property === property);

  let newBody: string;
  if (existingIdx >= 0) {
    if (value.trim() === "") {
      // Remove.
      decls.splice(existingIdx, 1);
    } else {
      decls[existingIdx].value = value;
    }
    newBody = serializeDeclarations(decls);
  } else if (value.trim() !== "") {
    // Append.
    newBody = rule.body.trimEnd() + (rule.body.trimEnd().endsWith(";") ? " " : (rule.body.trim() ? "; " : "")) + newDeclaration + " ";
    // Normalize: ensure body ends with a newline-friendly form.
    newBody = ` ${serializeDeclarations(decls)} ${newDeclaration} `;
  } else {
    // Removing a non-existent property — no-op.
    return source;
  }

  // Reconstruct the source with the new body.
  return (
    source.slice(0, rule.bodyStart) +
    newBody +
    source.slice(rule.bodyEnd)
  );
}

interface CssDeclaration {
  property: string;
  value: string;
}

function parseDeclarations(body: string): CssDeclaration[] {
  const decls: CssDeclaration[] = [];
  // Split on ; but respect parentheses (for things like `calc(...)`).
  let depth = 0;
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (c === ";" && depth === 0) {
      pushDecl(decls, cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  pushDecl(decls, cur);
  return decls.filter((d) => d.property);
}

function pushDecl(decls: CssDeclaration[], text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx < 0) return;
  const property = trimmed.slice(0, colonIdx).trim();
  const value = trimmed.slice(colonIdx + 1).trim();
  if (!property) return;
  decls.push({ property, value });
}

function serializeDeclarations(decls: CssDeclaration[]): string {
  if (decls.length === 0) return "";
  return " " + decls.map((d) => `${d.property}: ${d.value};`).join(" ") + " ";
}

/**
 * Check whether a CSS selector is "safe" to mutate visually.
 *
 * Broad selectors like `*`, `div`, `button`, `body`, `html`, `a` are
 * considered unsafe because they affect every matching element in the
 * project. Single-class selectors (`.card`) and class+tag selectors
 * (`.btn.primary`) are safe.
 */
export function isSelectorSafeForVisualEdit(selector: string): boolean {
  const s = selector.trim();
  if (!s) return false;
  // Reject pure universal selectors.
  if (s === "*" || s.startsWith("* ")) return false;
  // Reject bare HTML tag selectors (no class).
  const bareTags = ["html", "body", "div", "span", "p", "a", "button", "img", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "input", "label", "form", "section", "article", "header", "footer", "nav", "main", "aside"];
  if (bareTags.includes(s.toLowerCase())) return false;
  // Reject selectors that contain bare-tag-only at the start (e.g. "div.something")
  // — actually we DO allow these because they're scoped by a class too.
  // But reject "div > *" style selectors.
  if (/\s>\s*\*/.test(s)) return false;
  // Allow class-based selectors.
  if (s.includes(".")) return true;
  // Allow ID-based selectors.
  if (s.includes("#")) return true;
  // Allow attribute selectors with a class.
  if (s.includes("[")) return true;
  // Otherwise (bare tag) reject.
  return false;
}

/**
 * Find the rule index for a given class name in a CSS source.
 *
 * Returns the index of the first rule whose selector contains the
 * given class (e.g. ".card" matches `.card`, `.card:hover`, `button.card`).
 * Returns -1 if not found.
 */
export function findRuleByClass(source: string, className: string): number {
  const rules = parseCssRules(source);
  for (let i = 0; i < rules.length; i++) {
    const sel = rules[i].selector;
    // Match `.className` as a word boundary.
    const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\.${escaped}\\b`).test(sel)) {
      return i;
    }
  }
  return -1;
}
