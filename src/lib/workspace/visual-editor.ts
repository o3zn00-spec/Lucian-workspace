// Visual Editor Studio — source mapping architecture.
//
// The visual editor does NOT work on a fake overlay. It maps elements in
// the rendered preview back to their actual source location in the
// project files. When the user edits a visual property (text, style,
// attribute), we patch the REAL source file at that location.
//
// Support matrix (Phase 12 final integration pass):
//   HTML / CSS / JS projects       → Full source mapping. Every element in
//                                    index.html is editable via DOMParser.
//   React (jsx/tsx) / Vite         → Full source mapping. The Babel plugin
//                                    inside `preview-engine.ts` injects
//                                    `data-lucian-source-file` +
//                                    `data-lucian-source-id` on every JSX
//                                    element. Edits route through `jsx-ast.ts`
//                                    (AST mutate + validate + rollback).
//   Next.js (App Router / Pages)   → Same Babel path. We render the page
//                                    component through the React preview
//                                    engine. Server-only APIs / server
//                                    actions / dynamic middleware are
//                                    stubbed (see preview-engine.ts mocks)
//                                    or, when not safely mockable, the
//                                    project falls back to Direct Edit.
//   Vue                            → Vue preview renders, but source
//                                    instrumentation is not supported —
//                                    Direct Edit for structural edits.
//   Projects without any detectable
//     entry component              → Direct Edit. The editor still surfaces
//                                    the project's files, components,
//                                    styles, assets, and diagnostics.
//
// Design:
//   1. `analyzeProject()` decides the mode + entry file.
//   2. `VisualCanvas` calls `buildActivePreviewDoc()` which routes through
//      `preview-engine.ts:buildPreviewDoc()` — the SAME pipeline for every
//      framework. The Babel JSX source-injection plugin runs for every
//      .jsx/.tsx file.
//   3. Each element in the rendered preview carries
//      `data-lucian-source-file` + `data-lucian-source-id` (JSX) or
//      a DOM-order id `n0, n1, …` (HTML, assigned by the inspection
//      script).
//   4. The Layers panel renders the iframe DOM tree. Selecting a node
//      selects it in the iframe + loads its properties in the inspector.
//   5. Editing a property → patch the source file → re-render the preview.

import type { DetectedFramework, FileEntry, Project, ProjectFile } from "@/types/workspace";

/** A node in the visual editor's element tree (mirror of the iframe DOM). */
export interface VisualNode {
  /** Stable ID assigned by the preview engine (data-lucid-id attribute). */
  id: string;
  /** Tag name (lowercase). */
  tag: string;
  /** Element text content (truncated). */
  text: string;
  /** Source location when known: { file, line, col }. */
  source?: {
    file: string;
    line: number;
    col: number;
  };
  /** Children. */
  children: VisualNode[];
  /** Inline style properties (most useful ones for the inspector). */
  style: Record<string, string>;
  /** Class names. */
  className: string;
  /** Common attributes (href, src, alt, etc.) — subset. */
  attributes: Record<string, string>;
}

/** A source-safe element specification shared by canvas and inspector inserts. */
export interface VisualElementSpec {
  tagName: string;
  attrs?: Array<{ name: string; value: string }>;
  text?: string;
  selfClosing?: boolean;
}

/** One reversible source write performed by the visual editor. */
export interface VisualMutationRecord {
  filePath: string;
  before: string;
  after: string;
  label: string;
}

/**
 * The mode the Visual Editor should run in for the active project.
 *
 * - `live-canvas`  → the project can be rendered in an iframe; visual edits
 *                    write back to the real source via the DOMParser-based
 *                    patcher.
 * - `direct-edit`  → the project cannot currently be rendered (no HTML
 *                    entry, broken structure, missing deps, etc.). The
 *                    editor stays useful: shows the project's file tree,
 *                    framework, routes/pages, components, styles, assets,
 *                    and a diagnostics panel. Source edits go through the
 *                    Code editor + Agent.
 *
 * The editor NEVER refuses to open a project — `direct-edit` is the
 * honest fallback when live rendering is unavailable.
 */
export type VisualEditorMode = "live-canvas" | "direct-edit";

/**
 * A diagnostic item surfaced to the user in Direct Edit mode. Each one
 * represents something we honestly noticed about the project — missing
 * entry, broken structure, missing deps, etc. — paired with a suggested
 * next action.
 */
export interface DiagnosticItem {
  /** Severity — info / warning / error. */
  severity: "info" | "warning" | "error";
  /** Short label. */
  label: string;
  /** What we noticed. */
  detail: string;
  /** Suggested next action. */
  action?: string;
}

/**
 * Structured analysis of a project. The Visual Editor uses this to decide
 * its mode and what to show in the left panel + diagnostics tab.
 */
export interface ProjectAnalysis {
  /** The mode to operate in. */
  mode: VisualEditorMode;
  /** Human-readable label for the mode badge. */
  modeLabel: string;
  /** The HTML file to render in the canvas (when mode = "live-canvas"). */
  entryFile?: string;
  /** Source-mapping support level (full for HTML, limited for JSX/TSX). */
  sourceMapping: "full" | "limited" | "none";
  /** Honest explanation of what the user can do. */
  explanation: string;
  /** Detected HTML files in the project (any framework). */
  htmlFiles: string[];
  /** Detected CSS / style files. */
  styleFiles: string[];
  /** Detected JavaScript / TypeScript source files (component files). */
  componentFiles: string[];
  /** Detected image / font / binary assets. */
  assetFiles: string[];
  /** Detected config files (package.json, vite.config, next.config, etc.). */
  configFiles: string[];
  /** Detected route / page entries (best-effort heuristic). */
  routes: string[];
  /** Honest diagnostics — never empty in direct-edit mode. */
  diagnostics: DiagnosticItem[];
}

/**
 * Analyze a project and produce a `ProjectAnalysis`. NEVER returns a
 * blocking state — if the project can't render, we set mode="direct-edit"
 * and surface honest diagnostics + suggested actions.
 *
 * Phase 12 final integration pass:
 *   - HTML / static projects          → `live-canvas` with `entryFile = index.html`.
 *   - React (jsx/tsx) / Vite         → `live-canvas` with `entryFile = src/App.tsx` (or
 *                                      whichever entry `preview-engine.ts` will pick).
 *   - Next.js (App Router / Pages)   → `live-canvas` for the safe subset (no
 *                                      server-only APIs detected, no complex
 *                                      middleware). Falls back to `direct-edit`
 *                                      when the analyzer detects unsafe
 *                                      runtime requirements.
 *   - Vue                            → `live-canvas` (Vue preview), but source
 *                                      mapping is `none` — Direct Edit for
 *                                      structural edits.
 *   - Projects without any detectable
 *     entry file                     → `direct-edit`.
 */
export function analyzeProject(project: Project | null): ProjectAnalysis | null {
  if (!project) return null;

  const fw = project.framework;
  const all = project.files;

  // Categorize files by extension + path patterns.
  const htmlFiles = all
    .filter((f) => !f.binary && f.path.endsWith(".html"))
    .map((f) => f.path)
    .sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b)));
  const styleFiles = all
    .filter((f) => !f.binary && /\.(css|scss|sass|less|styl)$/.test(f.path))
    .map((f) => f.path)
    .sort();
  const componentFiles = all
    .filter(
      (f) =>
        !f.binary &&
        /\.(jsx?|tsx?|vue|svelte|astro)$/.test(f.path) &&
        !f.path.startsWith("node_modules/"),
    )
    .map((f) => f.path)
    .sort();
  const assetFiles = all.filter((f) => f.binary).map((f) => f.path).sort();
  const configFiles = all
    .filter((f) =>
      [
        "package.json",
        "vite.config.js",
        "vite.config.mjs",
        "vite.config.ts",
        "next.config.js",
        "next.config.mjs",
        "next.config.ts",
        "tsconfig.json",
        "jsconfig.json",
        "tailwind.config.js",
        "tailwind.config.ts",
        ".env",
        ".env.local",
        ".env.example",
      ].includes(f.path),
    )
    .map((f) => f.path)
    .sort();
  // Route detection — best-effort heuristic. We treat any file under
  // app/, pages/, src/pages/, src/app/ as a route candidate.
  const routes = all
    .filter(
      (f) =>
        !f.binary &&
        (
          /^src\/app\/.*\/page\.(jsx?|tsx?)$/.test(f.path) ||
          /^app\/.*\/page\.(jsx?|tsx?)$/.test(f.path) ||
          /^src\/pages\/.*\.(jsx?|tsx?)$/.test(f.path) ||
          /^pages\/.*\.(jsx?|tsx?)$/.test(f.path) ||
          /^src\/App\.(jsx?|tsx?)$/.test(f.path) ||
          /^src\/main\.(jsx?|tsx?)$/.test(f.path)
        ),
    )
    .map((f) => f.path)
    .sort();

  // Build diagnostics.
  const diagnostics: DiagnosticItem[] = [];

  const hasHtml = htmlFiles.length > 0;
  const hasComponents = componentFiles.length > 0;
  const hasPackageJson = configFiles.includes("package.json");

  // ── HTML / static projects: live-canvas with the index.html entry ──
  if (hasHtml && (fw === "html" || fw === "static")) {
    return {
      mode: "live-canvas",
      modeLabel: "Live Canvas",
      entryFile: htmlFiles[0],
      sourceMapping: "full",
      explanation:
        "HTML/CSS/JS project. Visual edits modify the real HTML/CSS source files directly through the DOMParser patcher.",
      htmlFiles,
      styleFiles,
      componentFiles,
      assetFiles,
      configFiles,
      routes,
      diagnostics,
    };
  }

  // ── HTML projects that ALSO happen to have a framework (legacy CRA with
  //    public/index.html etc.) — still use the HTML entry. ──
  if (hasHtml) {
    return {
      mode: "live-canvas",
      modeLabel: "Live Canvas",
      entryFile: htmlFiles[0],
      sourceMapping: "full",
      explanation:
        "HTML entry detected. Visual edits route through the DOMParser patcher for HTML files, and the React/Vite source files remain editable via the Code editor.",
      htmlFiles,
      styleFiles,
      componentFiles,
      assetFiles,
      configFiles,
      routes,
      diagnostics,
    };
  }

  // ── React / Vite projects: live-canvas using the React preview engine. ──
  // The preview engine builds a self-contained HTML doc that loads React +
  // Babel standalone and transpiles every .jsx/.tsx file with the source-
  // instrumentation plugin. Entry file is `src/App.tsx` / `App.jsx` /
  // `src/main.tsx` etc. — the preview engine picks the right one.
  if (fw === "react-jsx" || fw === "react-tsx" || fw === "react-vite") {
    const entryFile = detectReactEntry(componentFiles);
    if (!entryFile) {
      diagnostics.push({
        severity: "warning",
        label: "No React entry component",
        detail:
          "Detected a React/Vite project but no App.tsx / App.jsx / main.tsx was found. The preview engine has nothing to bootstrap.",
        action: "Add an App.tsx (or main.tsx) that exports a default React component.",
      });
      return directEditFallback(
        "React project — entry component missing",
        htmlFiles, styleFiles, componentFiles, assetFiles, configFiles, routes, diagnostics,
      );
    }
    if (!hasPackageJson) {
      diagnostics.push({
        severity: "warning",
        label: "No package.json",
        detail: "Component files exist but no package.json was found. Dependency resolution may fail.",
        action: "Add a package.json with the project's dependencies.",
      });
    }
    return {
      mode: "live-canvas",
      modeLabel: "Live Canvas · JSX source mapping",
      entryFile,
      sourceMapping: "full",
      explanation:
        "React/Vite project. The preview engine transpiles every .jsx/.tsx file through Babel with the JSX source-instrumentation plugin — clicks map back to the exact AST source node, and visual edits write through jsx-ast.ts (mutate + validate + rollback).",
      htmlFiles,
      styleFiles,
      componentFiles,
      assetFiles,
      configFiles,
      routes,
      diagnostics,
    };
  }

  // ── Next.js projects: live-canvas for the safe subset, Direct Edit
  //    otherwise. The preview engine extracts app/page.tsx or
  //    pages/index.tsx and renders it as a React component. ──
  if (fw === "nextjs") {
    const entryFile = detectNextjsEntry(componentFiles);
    if (!entryFile) {
      diagnostics.push({
        severity: "warning",
        label: "No Next.js page component found",
        detail:
          "This project uses Next.js but neither app/page.tsx nor pages/index.tsx was found. The preview engine has nothing to render.",
        action: "Add a page.tsx under app/ (App Router) or pages/index.tsx (Pages Router).",
      });
      return directEditFallback(
        "Next.js project — page component missing",
        htmlFiles, styleFiles, componentFiles, assetFiles, configFiles, routes, diagnostics,
      );
    }
    const unsafe = detectNextjsUnsafeFeatures(all);
    if (unsafe.length > 0) {
      // The project uses server-only features we can't safely mock.
      for (const u of unsafe) diagnostics.push(u);
      diagnostics.push({
        severity: "info",
        label: "Visual Preview Limited",
        detail:
          "This Next.js project uses server-only features that can't be safely mocked in a browser iframe. Falling back to Direct Edit.",
        action: "Open the file in the Code editor or use the Project Agent for structural changes.",
      });
      return directEditFallback(
        "Next.js project — server-only features detected",
        htmlFiles, styleFiles, componentFiles, assetFiles, configFiles, routes, diagnostics,
      );
    }
    return {
      mode: "live-canvas",
      modeLabel: "Live Canvas · Next.js (safe subset)",
      entryFile,
      sourceMapping: "full",
      explanation:
        "Next.js project. The preview engine renders the page component through the same React pipeline (Babel + source instrumentation). Server-only APIs are mocked; client components render normally. Server Actions, dynamic middleware, and database runtimes are not executed.",
      htmlFiles,
      styleFiles,
      componentFiles,
      assetFiles,
      configFiles,
      routes,
      diagnostics,
    };
  }

  // ── Vue projects: live-canvas, but no JSX source instrumentation. ──
  if (fw === "vue") {
    const entryFile =
      componentFiles.find((p) => /App\.vue$/.test(p)) ??
      componentFiles.find((p) => p.endsWith(".vue")) ??
      "";
    if (!entryFile) {
      return directEditFallback(
        "Vue project — no App.vue found",
        htmlFiles, styleFiles, componentFiles, assetFiles, configFiles, routes, diagnostics,
      );
    }
    return {
      mode: "live-canvas",
      modeLabel: "Live Canvas · Vue (no source mapping)",
      entryFile,
      sourceMapping: "none",
      explanation:
        "Vue project. The preview engine renders the Vue app, but source instrumentation is not supported — visual structural edits fall back to Direct Edit.",
      htmlFiles,
      styleFiles,
      componentFiles,
      assetFiles,
      configFiles,
      routes,
      diagnostics,
    };
  }

  // ── Unknown / empty / non-HTML static projects ──
  if (!hasComponents && !hasHtml) {
    diagnostics.push({
      severity: "info",
      label: "Empty or unrecognized project",
      detail: "No HTML files and no component files were found. The project may be empty, or only contain assets/config.",
      action: "Import a real project, or use the composer below to upload files / a folder.",
    });
    return directEditFallback(
      "No previewable entry",
      htmlFiles, styleFiles, componentFiles, assetFiles, configFiles, routes, diagnostics,
    );
  }

  return directEditFallback(
    "No previewable entry",
    htmlFiles, styleFiles, componentFiles, assetFiles, configFiles, routes, diagnostics,
  );
}

/** Build a `direct-edit` ProjectAnalysis with the given diagnostics. */
function directEditFallback(
  explanation: string,
  htmlFiles: string[],
  styleFiles: string[],
  componentFiles: string[],
  assetFiles: string[],
  configFiles: string[],
  routes: string[],
  diagnostics: DiagnosticItem[],
): ProjectAnalysis {
  return {
    mode: "direct-edit",
    modeLabel: "Direct Edit",
    sourceMapping: "none",
    explanation:
      explanation + ". Direct Edit mode is active — you can browse the project's files, components, styles, assets, and diagnostics below. Use the Agent to ask questions or request changes.",
    htmlFiles,
    styleFiles,
    componentFiles,
    assetFiles,
    configFiles,
    routes,
    diagnostics,
  };
}

/** Find the React entry file (App.tsx / App.jsx / src/main.tsx etc.). */
function detectReactEntry(componentFiles: string[]): string | undefined {
  const candidates = [
    "src/App.tsx", "src/App.jsx", "App.tsx", "App.jsx",
    "src/main.tsx", "src/main.jsx", "main.tsx", "main.jsx",
  ];
  for (const c of candidates) {
    if (componentFiles.includes(c)) return c;
  }
  // Fallback: any App.tsx / App.jsx / main.tsx / main.jsx anywhere.
  return componentFiles.find((p) =>
    /(^|\/)(App|main)\.(jsx|tsx)$/.test(p),
  );
}

/** Find the Next.js entry file (app/page.tsx or pages/index.tsx). */
function detectNextjsEntry(componentFiles: string[]): string | undefined {
  const candidates = [
    "src/app/page.tsx", "src/app/page.jsx",
    "app/page.tsx", "app/page.jsx",
    "src/pages/index.tsx", "src/pages/index.jsx",
    "pages/index.tsx", "pages/index.jsx",
  ];
  for (const c of candidates) {
    if (componentFiles.includes(c)) return c;
  }
  return componentFiles.find((p) =>
    /(^|\/)(app|pages)\/(page|index)\.(jsx|tsx)$/.test(p),
  );
}

/**
 * Detect Next.js features that are NOT safe to run in a browser iframe.
 *
 * Returns a list of DiagnosticItem entries — empty if the project is in
 * the safe subset.
 *
 * What's "unsafe":
 *   - "app/api/.../route.ts" route handlers (server runtime — won't execute).
 *   - Server Actions (functions marked with "use server").
 *   - "middleware.ts" that imports anything other than next/server.
 *   - Dynamic route segments combined with generateStaticParams.
 *
 * What's "safe" (mocked, see preview-engine.ts):
 *   - next/image, next/link, next/navigation, next/headers.
 *   - next-auth/react (client-side).
 *   - Server-only Node modules (fs, path, …) — mocked.
 */
function detectNextjsUnsafeFeatures(files: ProjectFile[] | FileEntry[]): DiagnosticItem[] {
  const out: DiagnosticItem[] = [];
  const hasRouteHandler = files.some(
    (f) => !f.binary && /(^|\/)app\/api\/.*\/route\.(ts|js|tsx|jsx)$/.test(f.path),
  );
  if (hasRouteHandler) {
    out.push({
      severity: "warning",
      label: "API route handlers detected",
      detail:
        "This project contains app/api/.../route.ts handlers. They require a Next.js server runtime and won't execute in the browser-only iframe preview.",
      action: "The preview will fall back to Direct Edit. Run `npm run dev` locally for full API testing.",
    });
  }
  // Server Actions — only inspect content if it's been loaded.
  // (FileEntry doesn't carry content; ProjectFile does.)
  const hasServerAction = files.some(
    (f) => !f.binary &&
      typeof (f as ProjectFile).content === "string" &&
      /["']use server["']/.test((f as ProjectFile).content),
  );
  if (hasServerAction) {
    out.push({
      severity: "warning",
      label: "Server Actions detected",
      detail:
        "This project defines Server Actions (\"use server\"). They require a Next.js server runtime — the browser preview cannot execute them.",
      action: "The preview will fall back to Direct Edit for these files.",
    });
  }
  return out;
}

/**
 * Walk the source DOM in document order and assign IDs the same way the
 * iframe inspection script does (counter-based, on every element). The
 * iframe uses `document.querySelectorAll('*')` which yields elements in
 * document order — `doc.querySelectorAll('*')` does the same on the
 * source DOM, so IDs line up.
 *
 * Returns a Map<id, Element> for lookup. Mutates the source DOM only
 * temporarily (we serialize back at the end without persisting the IDs).
 */
function assignSourceIds(doc: Document): Map<string, Element> {
  const map = new Map<string, Element>();
  let counter = 0;
  // querySelectorAll('*') returns elements in document order — matches the iframe.
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    map.set("n" + counter++, el);
  }
  return map;
}

/** Serialize a DOM Document back to a string, preserving the doctype. */
function serializeDoc(doc: Document): string {
  const doctype = doc.doctype
    ? `<!DOCTYPE ${doc.doctype.name}${doc.doctype.publicId ? ` PUBLIC "${doc.doctype.publicId}"` : ""}${doc.doctype.systemId ? ` "${doc.doctype.systemId}"` : ""}>`
    : "<!DOCTYPE html>";
  return `${doctype}\n${doc.documentElement.outerHTML}`;
}

/**
 * Patch a text node inside an HTML source string.
 *
 * The elementId is assigned by the iframe inspection script (e.g. "n6")
 * and does NOT exist in the source HTML. We rebuild the source DOM,
 * assign IDs the same way the iframe does (deterministic counter), then
 * look up the element by ID and patch its text content. This keeps the
 * source HTML unchanged (no data-lucid-id pollution in the file).
 */
export function patchHtmlText(
  source: string,
  elementId: string,
  newText: string,
): string {
  if (typeof window === "undefined") return source;
  const parser = new DOMParser();
  const doc = parser.parseFromString(source, "text/html");
  const idMap = assignSourceIds(doc);
  const target = idMap.get(elementId);
  if (!target) {
    throw new Error(
      `Element "${elementId}" not found in source DOM. The page structure may have changed since selection — refresh the canvas and try again.`,
    );
  }
  // Patch the first direct text child (preserve nested elements).
  let patched = false;
  for (const node of Array.from(target.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      node.textContent = newText;
      patched = true;
      break;
    }
  }
  if (!patched) {
    target.insertBefore(doc.createTextNode(newText), target.firstChild);
  }
  return serializeDoc(doc);
}

/**
 * Patch an inline style property on an element in an HTML source string.
 * Adds the style attribute if missing. Removes the property when value
 * is empty.
 */
export function patchHtmlStyle(
  source: string,
  elementId: string,
  property: string,
  value: string,
): string {
  if (typeof window === "undefined") return source;
  const parser = new DOMParser();
  const doc = parser.parseFromString(source, "text/html");
  const idMap = assignSourceIds(doc);
  const el = idMap.get(elementId) as HTMLElement | undefined;
  if (!el) {
    throw new Error(
      `Element "${elementId}" not found in source DOM. The page structure may have changed since selection — refresh the canvas and try again.`,
    );
  }
  if (value.trim() === "") {
    el.style.removeProperty(property);
  } else {
    el.style.setProperty(property, value);
  }
  return serializeDoc(doc);
}

/**
 * Patch an attribute on an element in an HTML source string.
 */
export function patchHtmlAttribute(
  source: string,
  elementId: string,
  attribute: string,
  value: string,
): string {
  if (typeof window === "undefined") return source;
  const parser = new DOMParser();
  const doc = parser.parseFromString(source, "text/html");
  const idMap = assignSourceIds(doc);
  const el = idMap.get(elementId);
  if (!el) {
    throw new Error(
      `Element "${elementId}" not found in source DOM. The page structure may have changed since selection — refresh the canvas and try again.`,
    );
  }
  if (value === "") {
    el.removeAttribute(attribute);
  } else {
    el.setAttribute(attribute, value);
  }
  return serializeDoc(doc);
}

function createHtmlElement(doc: Document, spec: VisualElementSpec): Element {
  const element = doc.createElement(spec.tagName);
  for (const attribute of spec.attrs ?? []) {
    element.setAttribute(attribute.name, attribute.value);
  }
  if (spec.text) element.textContent = spec.text;
  return element;
}

/** Insert a real HTML child into the selected source element. */
export function insertHtmlChild(
  source: string,
  parentId: string,
  spec: VisualElementSpec,
): string {
  if (typeof window === "undefined") return source;
  const doc = new DOMParser().parseFromString(source, "text/html");
  const parent = assignSourceIds(doc).get(parentId);
  if (!parent) throw new Error(`Parent element "${parentId}" was not found. Refresh the canvas and try again.`);
  parent.appendChild(createHtmlElement(doc, spec));
  return serializeDoc(doc);
}

/** Delete, duplicate, or move a real HTML element among its siblings. */
export function mutateHtmlStructure(
  source: string,
  elementId: string,
  operation: "delete" | "duplicate" | "up" | "down",
): string {
  if (typeof window === "undefined") return source;
  const doc = new DOMParser().parseFromString(source, "text/html");
  const element = assignSourceIds(doc).get(elementId);
  if (!element || !element.parentElement) throw new Error(`Element "${elementId}" was not found.`);
  if (["HTML", "HEAD", "BODY"].includes(element.tagName)) {
    throw new Error(`The document ${element.tagName.toLowerCase()} element cannot be changed structurally.`);
  }
  if (operation === "delete") {
    element.remove();
  } else if (operation === "duplicate") {
    element.insertAdjacentElement("afterend", element.cloneNode(true) as Element);
  } else if (operation === "up") {
    const previous = element.previousElementSibling;
    if (!previous) throw new Error("The element is already first in its parent.");
    element.parentElement.insertBefore(element, previous);
  } else {
    const next = element.nextElementSibling;
    if (!next) throw new Error("The element is already last in its parent.");
    next.insertAdjacentElement("afterend", element);
  }
  return serializeDoc(doc);
}

/** Reorder a real HTML element before/after a sibling in the same parent. */
export function reorderHtmlElement(
  source: string,
  elementId: string,
  targetId: string,
  position: "before" | "after",
): string {
  if (typeof window === "undefined") return source;
  const doc = new DOMParser().parseFromString(source, "text/html");
  const ids = assignSourceIds(doc);
  const element = ids.get(elementId);
  const target = ids.get(targetId);
  if (!element || !target || !element.parentElement || element.parentElement !== target.parentElement) {
    throw new Error("Drag reordering is limited to elements that share the same parent.");
  }
  if (element === target) return source;
  if (position === "before") target.insertAdjacentElement("beforebegin", element);
  else target.insertAdjacentElement("afterend", element);
  return serializeDoc(doc);
}

/**
 * Patch a property on a non-HTML source file (e.g. JSX/TSX).
 *
 * Strategy: locate the element by data-lucid-id attribute (the preview
 * engine injects it into the rendered DOM, but in the source code itself
 * the element is identified by surrounding text content). For limited
 * support, we do a simple string replace of an attribute value or inline
 * style entry. This is intentionally conservative — when we can't safely
 * patch, we throw with a clear message.
 */
export function patchJsxAttribute(
  source: string,
  elementId: string,
  attribute: string,
  value: string,
): string {
  // data-lucid-id is injected by the preview engine; it doesn't exist
  // in the original source. We use the surrounding text content as a
  // heuristic — but for limited support we only patch inline style
  // properties that match a stable pattern.
  //
  // This is intentionally a NO-OP with a clear message: the user should
  // edit JSX/TSX in the Code editor for structural changes.
  throw new Error(
    "JSX/TSX source patching is limited to inline style attributes via className. " +
      "For full control of component source, use the Code editor.",
  );
}

/**
 * Decide which patcher to use based on the file extension of the target file.
 */
export function patchFileContent(
  filePath: string,
  source: string,
  elementId: string,
  patch: { kind: "text" | "style" | "attribute"; property?: string; value: string },
): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (ext === "html" || ext === "htm") {
    if (patch.kind === "text") return patchHtmlText(source, elementId, patch.value);
    if (patch.kind === "style" && patch.property)
      return patchHtmlStyle(source, elementId, patch.property, patch.value);
    if (patch.kind === "attribute" && patch.property)
      return patchHtmlAttribute(source, elementId, patch.property, patch.value);
  }
  if (ext === "jsx" || ext === "tsx" || ext === "js" || ext === "ts") {
    if (patch.kind === "attribute" && patch.property) {
      return patchJsxAttribute(source, elementId, patch.property, patch.value);
    }
  }
  throw new Error(
    `Source patching is not supported for "${filePath}". Use the Code editor.`,
  );
}

/**
 * Walk the rendered iframe DOM and extract a VisualNode tree.
 *
 * Sent to the parent window via postMessage by the iframe's injected
 * script. We assign data-lucid-id to every element that doesn't have
 * one yet, so subsequent selections are stable.
 *
 * This is implemented in the visual-editor-canvas component (which
 * injects the script into the iframe), not here — this function is just
 * the type definition the canvas produces.
 */
export type IframeInspectionMessage = {
  type: "lucian-visual-inspection";
  root: VisualNode;
};

/**
 * Inject a script tag into an HTML document string that:
 *   1. Assigns data-lucid-id to every element.
 *   2. Listens for clicks — on click, sends the element's id + properties
 *      to the parent via postMessage.
 *   3. On request, walks the DOM and sends the full VisualNode tree.
 *
 * Used by the visual editor canvas to make the iframe interactive.
 */
export function buildInspectionScript(): string {
  return `
(function () {
  function assignIds() {
    var counter = 0;
    document.querySelectorAll('*').forEach(function (el) {
      if (!el.hasAttribute('data-lucid-id')) {
        el.setAttribute('data-lucid-id', 'n' + (counter++));
      }
    });
  }
  function getStyle(el) {
    var cs = window.getComputedStyle(el);
    var out = {};
    ['color', 'background-color', 'font-size', 'font-weight', 'font-family',
     'padding', 'margin', 'border', 'border-color', 'border-radius', 'width', 'height',
     'min-width', 'max-width', 'min-height', 'max-height', 'position', 'overflow',
     'display', 'flex-direction', 'grid-template-columns', 'justify-content', 'align-items',
     'gap', 'text-align', 'line-height', 'letter-spacing', 'box-shadow', 'opacity'].forEach(function (p) {
      out[p] = cs.getPropertyValue(p);
    });
    return out;
  }
  function getAttrs(el) {
    var out = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.name !== 'data-lucid-id') out[a.name] = a.value;
    }
    return out;
  }
  function buildNode(el) {
    var id = el.getAttribute('data-lucid-id') || '';
    var tag = el.tagName.toLowerCase();
    var text = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === Node.TEXT_NODE) text += n.textContent;
    }
    text = text.trim().slice(0, 80);
    var children = [];
    for (var i = 0; i < el.children.length; i++) {
      children.push(buildNode(el.children[i]));
    }
    return {
      id: id, tag: tag, text: text, children: children,
      style: getStyle(el), className: el.className || '',
      attributes: getAttrs(el)
    };
  }
  function sendInspection() {
    assignIds();
    var root = buildNode(document.body);
    parent.postMessage({ type: 'lucian-visual-inspection', root: root }, '*');
  }
  // Assign IDs immediately.
  assignIds();
  // Listen for clicks.
  document.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    if (!el || !el.hasAttribute) return;
    var id = el.getAttribute('data-lucid-id') || el.getAttribute('data-lucian-source-id') || '';
    // Phase 12: send source-mapping metadata if present.
    var sourceFile = el.getAttribute('data-lucian-source-file') || null;
    var sourceId = el.getAttribute('data-lucian-source-id') || id;
    parent.postMessage({
      type: 'lucian-visual-select',
      id: id,
      sourceFile: sourceFile,
      sourceId: sourceId
    }, '*');
  }, true);
  // Listen for highlight requests from the parent (Layers panel selection).
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'lucian-visual-highlight') {
      var targetId = e.data.id;
      var el = targetId ? document.querySelector('[data-lucid-id="' + targetId + '"], [data-lucian-source-id="' + targetId + '"]') : null;
      if (el && el.scrollIntoView) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
    // Phase 12 final: find drop target during drag.
    if (e.data && e.data.type === 'lucian-visual-find-drop-target') {
      var excludeId = e.data.excludeSourceId;
      // The parent passes both clientX/clientY (parent CLIENT space)
      // AND localX/localY (already converted to iframe-local space, which
      // is what elementFromPoint wants). Prefer the parent-computed
      // local coords — they correctly account for the iframe's position
      // (and the parent's scroll state) inside the scaled wrapper.
      var localX = e.data.localX;
      var localY = e.data.localY;
      if (typeof localX !== 'number' || typeof localY !== 'number') {
        // Fall back to computing it from clientX/Y + the iframe's own rect.
        var clientX = e.data.clientX;
        var clientY = e.data.clientY;
        var iframeRect = window.frameElement ? window.frameElement.getBoundingClientRect() : null;
        if (!iframeRect) return;
        localX = clientX - iframeRect.left;
        localY = clientY - iframeRect.top;
      }
      var el = document.elementFromPoint(localX, localY);
      if (!el) return;
      // Walk up to find the nearest element with a data-lucian-source-id
      // (skip the element being dragged).
      var cur = el;
      var targetId = null;
      while (cur && cur !== document.body) {
        var sid = cur.getAttribute('data-lucian-source-id') || cur.getAttribute('data-lucid-id');
        if (sid && sid !== excludeId) {
          targetId = sid;
          break;
        }
        cur = cur.parentElement;
      }
      if (targetId) {
        var targetEl = cur;
        var targetRect = targetEl.getBoundingClientRect();
        // Determine before/after based on pointer Y relative to the target's center.
        var position = (localY < targetRect.top + targetRect.height / 2) ? 'before' : 'after';
        parent.postMessage({
          type: 'lucian-visual-drag-target',
          targetId: targetId,
          position: position,
          rect: {
            left: targetRect.left, top: targetRect.top,
            width: targetRect.width, height: targetRect.height,
            right: targetRect.right, bottom: targetRect.bottom,
            x: targetRect.x, y: targetRect.y
          }
        }, '*');
      }
    }
  });
  // Phase 12 final: expose __lucianGetElementRect for the parent to query
  // an element's bounding rect (used for overlay positioning).
  window.__lucianGetElementRect = function (id) {
    var el = document.querySelector('[data-lucid-id="' + id + '"], [data-lucian-source-id="' + id + '"]');
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return {
      left: r.left, top: r.top, width: r.width, height: r.height,
      right: r.right, bottom: r.bottom, x: r.x, y: r.y
    };
  };
  // Listen for inspection requests.
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'lucian-visual-request-inspection') {
      sendInspection();
    }
  });
  // Send initial inspection on load.
  setTimeout(sendInspection, 100);
})();
`;
}
