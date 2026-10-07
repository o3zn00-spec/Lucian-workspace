"use client";

/* JSX/TSX AST utilities — Phase 12.
 *
 * Provides SAFE parse / mutate / generate / validate for JSX and TSX
 * source files. The source code remains the source of truth — visual
 * editor actions mutate the AST and regenerate source, then re-validate
 * before committing.
 *
 * Architecture:
 *
 *   parseJsxSource(source) → { ast, parseError? }
 *         ↓
 *   locateJsxElement(ast, sourceId) → JSXElement | null
 *         ↓
 *   mutate (setClassName / setText / setStyle / insert / delete / reorder)
 *         ↓
 *   generateJsxSource(ast) → string
 *         ↓
 *   re-parse generated source → valid? commit : rollback
 *
 * Source mapping:
 *   Each JSX element in the source is assigned a stable `sourceId` based
 *   on its source range (start offset + hash of the file path). This id
 *   is injected into the rendered preview via `data-lucian-source-id` so
 *   the visual editor can map a clicked DOM element back to its source
 *   JSX node RELIABLY — not via DOM-order heuristics.
 *
 *   The `data-lucian-source-*` attributes are injected by the preview
 *   engine (preview-engine.ts) ONLY for the editing preview — they are
 *   NEVER written to the project's source files. Exported/downloaded
 *   source remains clean.
 *
 * Safety:
 *   - If `@babel/parser` fails to parse, we return parseError and the
 *     visual editor falls back to Direct Edit.
 *   - If a mutation produces source that fails to re-parse, we ROLL BACK
 *     and never write the file.
 *   - We never use regex as the primary JSX transformation system —
 *     only AST traversal + mutation.
 */

import { parse, type ParserOptions } from "@babel/parser";
import traverse, { type NodePath } from "@babel/traverse";
import generate from "@babel/generator";
import * as t from "@babel/types";

/** Parser options that handle JSX + TS + TSX + the latest syntax. */
const PARSER_OPTS: ParserOptions = {
  sourceType: "module",
  plugins: ["jsx", "typescript", "classProperties", "objectRestSpread", "dynamicImport", "optionalChaining", "nullishCoalescingOperator"],
  errorRecovery: false,
  tokens: false,
};

export interface ParseResult {
  ast: t.File | null;
  parseError: string | null;
}

/** Parse a JSX/TSX source string. Returns { ast, parseError }. */
export function parseJsxSource(source: string): ParseResult {
  try {
    const ast = parse(source, PARSER_OPTS);
    return { ast, parseError: null };
  } catch (err) {
    return {
      ast: null,
      parseError: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Compute a stable source id for a JSX element based on its source location.
 *
 * The id is `el-{startLine}-{startCol}-{fileHash}` — stable across re-renders
 * as long as the element's source position doesn't change. When the user
 * edits an element, we update the AST node IN PLACE so its source range
 * stays the same; after regeneration + re-parse, the element's position
 * is the same (or very close), so the id round-trips.
 *
 * For elements WITHOUT source location info (programmatically generated),
 * we fall back to null — those elements cannot be safely visually edited
 * and the visual editor will show a "Direct Edit" fallback.
 */
export function computeSourceId(
  node: t.JSXElement | t.JSXFragment,
  filePath: string,
): string | null {
  if (!node.loc) return null;
  // Use the OPENING element's location for JSXElement; for JSXFragment use
  // the fragment's own start.
  let line: number;
  let col: number;
  if (t.isJSXElement(node) && node.openingElement.loc) {
    line = node.openingElement.loc.start.line;
    col = node.openingElement.loc.start.column;
  } else {
    line = node.loc.start.line;
    col = node.loc.start.column;
  }
  const fileHash = simpleHash(filePath);
  return `el-${line}-${col}-${fileHash}`;
}

function simpleHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).slice(-4).padStart(4, "0");
}

/** Collect all JSX elements in the AST, keyed by their sourceId. */
export interface JsxElementInfo {
  sourceId: string;
  filePath: string;
  /** The element name (e.g. "div", "Card", "button"). For fragments, "#fragment". */
  name: string;
  /** Start line (1-indexed) in the source file. */
  startLine: number;
  /** Start column (0-indexed) in the source file. */
  startColumn: number;
  /** End line (1-indexed). */
  endLine: number;
  /** End column (0-indexed). */
  endColumn: number;
  /** The current className value (string literal only — null for dynamic). */
  className: string | null;
  /** True if className is a dynamic expression (not safe to mutate directly). */
  classNameIsDynamic: boolean;
  /** Static text content (direct text children, joined). */
  textContent: string | null;
  /** True if any child is a JSX expression container ({...}). */
  hasDynamicChildren: boolean;
}

export function collectJsxElements(ast: t.File, filePath: string): JsxElementInfo[] {
  const out: JsxElementInfo[] = [];
  traverse(ast, {
    JSXElement(path) {
      const node = path.node;
      const sourceId = computeSourceId(node, filePath);
      if (!sourceId) return;
      const name = getJsxElementName(node);
      const { className, classNameIsDynamic } = getClassName(node);
      const { textContent, hasDynamicChildren } = getChildrenInfo(node);
      out.push({
        sourceId,
        filePath,
        name,
        startLine: node.loc?.start.line ?? 0,
        startColumn: node.loc?.start.column ?? 0,
        endLine: node.loc?.end.line ?? 0,
        endColumn: node.loc?.end.column ?? 0,
        className,
        classNameIsDynamic,
        textContent,
        hasDynamicChildren,
      });
    },
    JSXFragment(path) {
      const node = path.node;
      const sourceId = computeSourceId(node, filePath);
      if (!sourceId) return;
      const { textContent, hasDynamicChildren } = getFragmentChildrenInfo(node);
      out.push({
        sourceId,
        filePath,
        name: "#fragment",
        startLine: node.loc?.start.line ?? 0,
        startColumn: node.loc?.start.column ?? 0,
        endLine: node.loc?.end.line ?? 0,
        endColumn: node.loc?.end.column ?? 0,
        className: null,
        classNameIsDynamic: false,
        textContent,
        hasDynamicChildren,
      });
    },
  });
  return out;
}

function getJsxElementName(node: t.JSXElement): string {
  const name = node.openingElement.name;
  if (t.isJSXIdentifier(name)) return name.name;
  if (t.isJSXMemberExpression(name)) {
    const parts: string[] = [];
    let cur: t.JSXMemberExpression | t.JSXIdentifier = name;
    while (t.isJSXMemberExpression(cur)) {
      parts.unshift(cur.property.name);
      cur = cur.object;
    }
    if (t.isJSXIdentifier(cur)) parts.unshift(cur.name);
    return parts.join(".");
  }
  if (t.isJSXNamespacedName(name)) {
    return `${name.namespace.name}:${name.name.name}`;
  }
  return "<unknown>";
}

function getClassName(node: t.JSXElement): {
  className: string | null;
  classNameIsDynamic: boolean;
} {
  for (const attr of node.openingElement.attributes) {
    if (!t.isJSXAttribute(attr)) continue;
    if (attr.name.name !== "className") continue;
    const value = attr.value;
    if (value === null || value === undefined) {
      return { className: "", classNameIsDynamic: false };
    }
    if (t.isStringLiteral(value)) {
      return { className: value.value, classNameIsDynamic: false };
    }
    if (t.isJSXExpressionContainer(value)) {
      return { className: null, classNameIsDynamic: true };
    }
    return { className: null, classNameIsDynamic: true };
  }
  return { className: null, classNameIsDynamic: false };
}

function getChildrenInfo(node: t.JSXElement): {
  textContent: string | null;
  hasDynamicChildren: boolean;
} {
  let text = "";
  let hasDynamic = false;
  for (const child of node.children) {
    if (t.isJSXText(child)) {
      const raw = child.value.replace(/\s+/g, " ").trim();
      if (raw) text += (text ? " " : "") + raw;
    } else if (t.isJSXExpressionContainer(child)) {
      if (!t.isJSXEmptyExpression(child.expression)) {
        hasDynamic = true;
      }
    } else {
      hasDynamic = true;
    }
  }
  return {
    textContent: text || null,
    hasDynamicChildren: hasDynamic,
  };
}

function getFragmentChildrenInfo(node: t.JSXFragment): {
  textContent: string | null;
  hasDynamicChildren: boolean;
} {
  let text = "";
  let hasDynamic = false;
  for (const child of node.children) {
    if (t.isJSXText(child)) {
      const raw = child.value.replace(/\s+/g, " ").trim();
      if (raw) text += (text ? " " : "") + raw;
    } else if (t.isJSXExpressionContainer(child)) {
      if (!t.isJSXEmptyExpression(child.expression)) {
        hasDynamic = true;
      }
    } else {
      hasDynamic = true;
    }
  }
  return {
    textContent: text || null,
    hasDynamicChildren: hasDynamic,
  };
}

/* ── Mutations ────────────────────────────────────────────────────── */

export type MutationStatus =
  | "ok"
  | "dynamic"
  | "not-found"
  | "parse-error"
  | "no-sibling"
  | "target-not-found"
  | "same-parent-required";

export interface MutationResult {
  source: string;
  status: MutationStatus;
  error?: string;
}

/**
 * Find a JSXElement in the AST by its sourceId.
 */
function findJsxElementBySourceId(
  ast: t.File,
  sourceId: string,
  filePath: string,
): NodePath<t.JSXElement> | null {
  let found: NodePath<t.JSXElement> | null = null;
  traverse(ast, {
    JSXElement(path) {
      const node = path.node;
      const id = computeSourceId(node, filePath);
      if (id === sourceId) {
        found = path as NodePath<t.JSXElement>;
        path.stop();
      }
    },
  });
  return found;
}

/**
 * Set the className attribute on a JSX element.
 */
export function setClassName(
  source: string,
  sourceId: string,
  filePath: string,
  newClassName: string,
): MutationResult {
  const { ast, parseError } = parseJsxSource(source);
  if (!ast || parseError) {
    return { source, status: "parse-error", error: parseError ?? "parse failed" };
  }
  const path = findJsxElementBySourceId(ast, sourceId, filePath);
  if (!path) return { source, status: "not-found" };

  const node = path.node;
  let classNameAttr: t.JSXAttribute | null = null;
  for (const attr of node.openingElement.attributes) {
    if (t.isJSXAttribute(attr) && attr.name.name === "className") {
      classNameAttr = attr;
      break;
    }
  }

  if (classNameAttr) {
    if (classNameAttr.value === null || t.isStringLiteral(classNameAttr.value)) {
      classNameAttr.value = t.stringLiteral(newClassName);
    } else {
      return { source, status: "dynamic" };
    }
  } else {
    const newAttr = t.jsxAttribute(
      t.jsxIdentifier("className"),
      t.stringLiteral(newClassName),
    );
    node.openingElement.attributes.push(newAttr);
  }

  return generateAndValidate(ast, source);
}

/**
 * Set the text content of a JSX element (replaces direct JSXText children).
 */
export function setJsxText(
  source: string,
  sourceId: string,
  filePath: string,
  newText: string,
): MutationResult {
  const { ast, parseError } = parseJsxSource(source);
  if (!ast || parseError) {
    return { source, status: "parse-error", error: parseError ?? "parse failed" };
  }
  const path = findJsxElementBySourceId(ast, sourceId, filePath);
  if (!path) return { source, status: "not-found" };

  const node = path.node;
  for (const child of node.children) {
    if (t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)) {
      return { source, status: "dynamic" };
    }
    if (t.isJSXElement(child) || t.isJSXFragment(child)) {
      return { source, status: "dynamic" };
    }
  }
  node.children = [t.jsxText(newText)];
  return generateAndValidate(ast, source);
}

/**
 * Set an inline style property on a JSX element.
 */
export function setInlineStyle(
  source: string,
  sourceId: string,
  filePath: string,
  property: string,
  value: string,
): MutationResult {
  const styleProperty = property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
  const { ast, parseError } = parseJsxSource(source);
  if (!ast || parseError) {
    return { source, status: "parse-error", error: parseError ?? "parse failed" };
  }
  const path = findJsxElementBySourceId(ast, sourceId, filePath);
  if (!path) return { source, status: "not-found" };

  const node = path.node;
  let styleAttr: t.JSXAttribute | null = null;
  for (const attr of node.openingElement.attributes) {
    if (t.isJSXAttribute(attr) && attr.name.name === "style") {
      styleAttr = attr;
      break;
    }
  }

  if (!styleAttr) {
    const styleObj = t.objectExpression([
      t.objectProperty(t.identifier(styleProperty), t.stringLiteral(value)),
    ]);
    const newAttr = t.jsxAttribute(
      t.jsxIdentifier("style"),
      t.jsxExpressionContainer(styleObj),
    );
    node.openingElement.attributes.push(newAttr);
  } else {
    const v = styleAttr.value;
    if (t.isJSXExpressionContainer(v) && t.isObjectExpression(v.expression)) {
      const obj = v.expression;
      let found = false;
      const newProps: Array<t.ObjectProperty | t.ObjectMethod | t.SpreadElement> = [];
      for (const prop of obj.properties) {
        if (
          t.isObjectProperty(prop) &&
          ((t.isIdentifier(prop.key) && prop.key.name === styleProperty) ||
            (t.isStringLiteral(prop.key) && prop.key.value === styleProperty))
        ) {
          found = true;
          if (value !== "") {
            newProps.push(
              t.objectProperty(t.identifier(styleProperty), t.stringLiteral(value)),
            );
          }
          // If value is empty, we skip (effectively removing the property).
        } else if (t.isObjectProperty(prop)) {
          // Keep the existing property as-is.
          newProps.push(prop);
        } else if (t.isSpreadElement(prop) || t.isObjectMethod(prop)) {
          // Preserve spreads/methods (dynamic) — but mark as dynamic if we
          // were trying to edit a property that's now behind a spread.
          newProps.push(prop);
        }
      }
      if (!found && value !== "") {
        newProps.push(
          t.objectProperty(t.identifier(styleProperty), t.stringLiteral(value)),
        );
      }
      obj.properties = newProps;
    } else {
      return { source, status: "dynamic" };
    }
  }

  return generateAndValidate(ast, source);
}

/**
 * Set an arbitrary attribute on a JSX element.
 */
export function setJsxAttribute(
  source: string,
  sourceId: string,
  filePath: string,
  attrName: string,
  value: string,
): MutationResult {
  const { ast, parseError } = parseJsxSource(source);
  if (!ast || parseError) {
    return { source, status: "parse-error", error: parseError ?? "parse failed" };
  }
  const path = findJsxElementBySourceId(ast, sourceId, filePath);
  if (!path) return { source, status: "not-found" };

  const node = path.node;
  let attr: t.JSXAttribute | null = null;
  for (const a of node.openingElement.attributes) {
    if (t.isJSXAttribute(a) && a.name.name === attrName) {
      attr = a;
      break;
    }
  }

  if (attr) {
    if (attr.value === null || t.isStringLiteral(attr.value)) {
      if (value === "") {
        node.openingElement.attributes = node.openingElement.attributes.filter(
          (a) => !(t.isJSXAttribute(a) && a.name.name === attrName),
        );
      } else {
        attr.value = t.stringLiteral(value);
      }
    } else {
      return { source, status: "dynamic" };
    }
  } else {
    if (value !== "") {
      const newAttr = t.jsxAttribute(
        t.jsxIdentifier(attrName),
        t.stringLiteral(value),
      );
      node.openingElement.attributes.push(newAttr);
    }
  }

  return generateAndValidate(ast, source);
}

/**
 * Delete a JSX element identified by sourceId.
 */
export function deleteJsxElement(
  source: string,
  sourceId: string,
  filePath: string,
): MutationResult {
  const { ast, parseError } = parseJsxSource(source);
  if (!ast || parseError) {
    return { source, status: "parse-error", error: parseError ?? "parse failed" };
  }
  const path = findJsxElementBySourceId(ast, sourceId, filePath);
  if (!path) return { source, status: "not-found" };
  path.remove();
  return generateAndValidate(ast, source);
}

/**
 * Duplicate a JSX element identified by sourceId.
 */
export function duplicateJsxElement(
  source: string,
  sourceId: string,
  filePath: string,
): MutationResult {
  const { ast, parseError } = parseJsxSource(source);
  if (!ast || parseError) {
    return { source, status: "parse-error", error: parseError ?? "parse failed" };
  }
  const path = findJsxElementBySourceId(ast, sourceId, filePath);
  if (!path) return { source, status: "not-found" };
  const cloned = t.cloneDeepWithoutLoc(path.node);
  path.insertAfter(cloned);
  return generateAndValidate(ast, source);
}

/**
 * Move a JSX element up or down among its siblings.
 */
export function moveJsxElement(
  source: string,
  sourceId: string,
  filePath: string,
  direction: "up" | "down",
): MutationResult {
  const { ast, parseError } = parseJsxSource(source);
  if (!ast || parseError) {
    return { source, status: "parse-error", error: parseError ?? "parse failed" };
  }
  const path = findJsxElementBySourceId(ast, sourceId, filePath);
  if (!path) return { source, status: "not-found" };

  if (direction === "up") {
    const prev = path.getPrevSibling();
    // Find the first useful previous sibling (skip whitespace JSXText).
    // getPrevSibling() returns a single NodePath (possibly with isRemoval
    // true if there's no sibling) — iterate backwards manually.
    let prevUseful: NodePath | null = null;
    let cur: NodePath | null = prev;
    let guard = 0;
    while (cur && !cur.removed && guard < 100) {
      guard++;
      if (cur.node) {
        if (t.isJSXText(cur.node)) {
          if (cur.node.value.trim()) { prevUseful = cur; break; }
        } else {
          prevUseful = cur;
          break;
        }
      }
      cur = cur.getPrevSibling();
    }
    if (!prevUseful) return { source, status: "no-sibling" };
    const nodeToMove = path.node;
    path.replaceWith(prevUseful.node);
    prevUseful.replaceWith(nodeToMove);
  } else {
    const next = path.getNextSibling();
    if (!next.node) return { source, status: "no-sibling" };
    let nextUseful: NodePath | null = null;
    if (t.isJSXText(next.node)) {
      if (next.node.value.trim()) {
        nextUseful = next;
      } else {
        const after = next.getNextSibling();
        if (after.node && !t.isJSXText(after.node)) {
          nextUseful = after;
        } else if (after.node && t.isJSXText(after.node) && after.node.value.trim()) {
          nextUseful = after;
        }
      }
    } else {
      nextUseful = next;
    }
    if (!nextUseful) return { source, status: "no-sibling" };
    const nodeToMove = path.node;
    path.replaceWith(nextUseful.node);
    nextUseful.replaceWith(nodeToMove);
  }
  return generateAndValidate(ast, source);
}

/**
 * Reorder a JSX element relative to a target sibling.
 */
export function reorderJsxElement(
  source: string,
  sourceId: string,
  filePath: string,
  target:
    | { kind: "before" | "after"; targetSourceId: string }
    | { kind: "append" },
): MutationResult {
  const { ast, parseError } = parseJsxSource(source);
  if (!ast || parseError) {
    return { source, status: "parse-error", error: parseError ?? "parse failed" };
  }
  const path = findJsxElementBySourceId(ast, sourceId, filePath);
  if (!path) return { source, status: "not-found" };

  if (target.kind === "append") {
    const parent = path.parentPath;
    if (!parent || !(t.isJSXElement(parent.node) || t.isJSXFragment(parent.node))) {
      return { source, status: "same-parent-required" };
    }
    const cloned = t.cloneDeepWithoutLoc(path.node);
    path.remove();
    (parent.node as t.JSXElement | t.JSXFragment).children.push(cloned);
    return generateAndValidate(ast, source);
  }

  const targetPath = findJsxElementBySourceId(ast, target.targetSourceId, filePath);
  if (!targetPath) return { source, status: "target-not-found" };
  // Phase 12 final: guard against self-drop (source === target). This
  // happens when the user starts dragging an element and releases on
  // itself. Without this guard, `path.remove()` would mutate the AST,
  // then `targetPath.insertAfter(cloned)` would fail because targetPath
  // is now detached — the result would be silently dropping the element.
  if (path === targetPath) {
    return { source, status: "same-parent-required" };
  }
  if (path.parentPath !== targetPath.parentPath) {
    return { source, status: "same-parent-required" };
  }

  const cloned = t.cloneDeepWithoutLoc(path.node);
  path.remove();
  if (target.kind === "before") {
    targetPath.insertBefore(cloned);
  } else {
    targetPath.insertAfter(cloned);
  }
  return generateAndValidate(ast, source);
}

/**
 * Insert a new JSX element as a child of the element identified by sourceId.
 */
export function insertJsxChild(
  source: string,
  parentSourceId: string,
  filePath: string,
  spec: {
    tagName: string;
    attrs?: Array<{ name: string; value: string }>;
    text?: string;
    selfClosing?: boolean;
  },
): MutationResult {
  const { ast, parseError } = parseJsxSource(source);
  if (!ast || parseError) {
    return { source, status: "parse-error", error: parseError ?? "parse failed" };
  }
  const path = findJsxElementBySourceId(ast, parentSourceId, filePath);
  if (!path) return { source, status: "not-found" };

  const node = path.node;
  const attrs: t.JSXAttribute[] = (spec.attrs ?? []).map((attribute) => {
    if (attribute.name === "style") {
      const properties = attribute.value
        .split(";")
        .map((declaration) => declaration.trim())
        .filter(Boolean)
        .map((declaration) => {
          const colon = declaration.indexOf(":");
          if (colon < 1) return null;
          const rawName = declaration.slice(0, colon).trim();
          const value = declaration.slice(colon + 1).trim();
          const name = rawName.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
          return t.objectProperty(t.identifier(name), t.stringLiteral(value));
        })
        .filter((property): property is t.ObjectProperty => property !== null);
      return t.jsxAttribute(
        t.jsxIdentifier("style"),
        t.jsxExpressionContainer(t.objectExpression(properties)),
      );
    }
    return t.jsxAttribute(t.jsxIdentifier(attribute.name), t.stringLiteral(attribute.value));
  });
  const opening = t.jsxOpeningElement(
    t.jsxIdentifier(spec.tagName),
    attrs,
    spec.selfClosing ?? false,
  );
  let closing: t.JSXClosingElement | null = null;
  let children: t.JSXElement["children"] = [];
  if (!spec.selfClosing) {
    closing = t.jsxClosingElement(t.jsxIdentifier(spec.tagName));
    if (spec.text) children = [t.jsxText(spec.text)];
  }
  const newEl = t.jsxElement(opening, closing, children, spec.selfClosing ?? false);
  node.children.push(newEl);

  return generateAndValidate(ast, source);
}

/* ── Generate + validate ──────────────────────────────────────────── */

function generateAndValidate(
  ast: t.File,
  originalSource: string,
): MutationResult {
  let generated: string;
  try {
    const result = generate(ast, {
      retainLines: true,
      compact: false,
      jsescOption: { minimal: true },
    });
    generated = result.code;
  } catch (err) {
    return {
      source: originalSource,
      status: "parse-error",
      error: `Generation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const recheck = parseJsxSource(generated);
  if (recheck.parseError) {
    return {
      source: originalSource,
      status: "parse-error",
      error: `Generated source failed to parse: ${recheck.parseError}`,
    };
  }
  return { source: generated, status: "ok" };
}

/** Check whether a file path is a JSX/TSX file we can safely parse. */
export function isJsxFile(filePath: string): boolean {
  return /\.(jsx|tsx)$/.test(filePath);
}

/** Check whether a file path is a JS/TS file (broader). */
export function isJsLikeFile(filePath: string): boolean {
  return /\.(jsx?|tsx?)$/.test(filePath);
}
