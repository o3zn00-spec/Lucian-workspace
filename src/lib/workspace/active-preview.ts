"use client";

/* Active-Visual-Editor preview loader — Phase 12 final integration pass.
 *
 * Single source of truth that bridges the active Visual Editor canvas to
 * the project's REAL preview engine (`preview-engine.ts:buildPreviewDoc`).
 *
 * Why this exists:
 *   Before this pass, `VisualCanvas` rendered the entry file's raw HTML
 *   string + a hand-rolled `inlineAssets()` helper. That bypassed the
 *   Babel JSX instrumentation plugin in `preview-engine.ts`, so React /
 *   Vite / TSX projects never received `data-lucian-source-file` /
 *   `data-lucian-source-id` attributes — clicks never mapped back to the
 *   real JSX source node.
 *
 *   This module routes EVERY supported framework through the same
 *   `buildPreviewDoc()` pipeline, then appends the visual-editor
 *   inspection + source-map scripts so the iframe can drive selection,
 *   drag, resize, and source-backed edits.
 *
 * Supported frameworks (matches `DetectedFramework`):
 *   - html / static        → buildHtmlPreview (HTML DOMParser editing path)
 *   - react-jsx / react-tsx → buildReactPreview (Babel JSX instrumentation)
 *   - react-vite            → buildReactPreview (Babel JSX instrumentation)
 *   - nextjs                → buildReactPreview with `isNextjs=true`
 *                             (Babel JSX instrumentation; safe subset only)
 *   - vue                   → buildVuePreview (no source instrumentation —
 *                             Direct Edit fallback for structural edits)
 *
 * For unsupported / unsafe projects, `buildPreviewDoc()` returns an honest
 * "Visual Preview Limited / Direct Edit" info card.
 */

import type { Project, ProjectFile, PreviewMode, EnvVar } from "@/types/workspace";
import { buildPreviewDoc } from "./preview-engine";
import { buildInspectionScript } from "./visual-editor";
import { buildSourceMapScript } from "./source-map";

export interface BuildActivePreviewArgs {
  project: Project;
  files: ProjectFile[];
  /** Framework string from project.framework. */
  framework: string;
  /** Preview mode (real / demo / fake). */
  mode: PreviewMode;
  envVars: EnvVar[];
  /**
   * The entry file the canvas is currently rendering. For HTML projects
   * this is the .html path. For React / Vite / Next.js projects this is
   * the detected entry (e.g. "src/App.tsx", "app/page.tsx") and is only
   * used as a fallback hint — the preview engine itself chooses the
   * real entry from `files`.
   */
  entryFile: string;
}

/**
 * Build the active Visual Editor preview document for the given project.
 *
 * Returns the full HTML string to feed to the iframe's `srcDoc`. The
 * document already contains:
 *   - The framework-specific preview (HTML / React / Vue / Next.js).
 *   - The source-instrumentation attributes
 *     (`data-lucian-source-file`, `data-lucian-source-id`) for JSX / TSX
 *     elements — injected by the Babel plugin inside `buildPreviewDoc`.
 *   - The HTML source-id assignment script (for HTML projects).
 *   - The inspection script that reports DOM structure + clicks back to
 *     the parent via `postMessage`.
 */
export function buildActivePreviewDoc(args: BuildActivePreviewArgs): string {
  const { project, files, framework, mode, envVars, entryFile } = args;

  // 1. Build the framework-specific preview via the shared engine.
  //    For React/Vite/Next.js, this is what injects the Babel source plugin.
  const frameworkDoc = buildPreviewDoc({ files, framework, mode, envVars });

  // 2. For HTML projects, tag every element with data-lucian-source-file
  //    so the inspector's resolveSourceMapping gets a non-null sourceFile.
  //    We do this as a regex pass on the document BEFORE injecting the
  //    inspection script — cheap and reliable for well-formed HTML.
  let doc = frameworkDoc;
  if (framework === "html" || framework === "static") {
    doc = tagHtmlSourceFile(doc, entryFile);
  }

  // 3. Inject the inspection + source-map scripts at the end of <body>.
  //    The inspection script assigns data-lucid-id (DOM-order id, used
  //    by HTML DOMParser editing) and forwards clicks + drop targets.
  //    The source-map script assigns data-lucian-source-id for HTML
  //    projects where the Babel plugin didn't run, AND tags every
  //    element with data-lucian-source-file=entryFile so the inspector
  //    can resolve the sourceFile even for wrapper elements.
  const script = `<script>\n${buildInspectionScript()}\n${buildSourceMapScript(entryFile)}\n</script>`;
  if (/<\/body>/i.test(doc)) {
    doc = doc.replace(/<\/body>/i, `${script}</body>`);
  } else {
    doc = doc + script;
  }

  // Tag the iframe document with a marker attribute the inspection script
  // can read so it knows the entryFile even before assigning ids.
  void project; // (project is reserved for future scoped state)
  return doc;
}

/**
 * Tag every HTML element with `data-lucian-source-file="<entryFile>"`.
 *
 * We only set the attribute on elements that don't already have it
 * (JSX-derived elements in the same document would already carry it).
 *
 * The regex is intentionally simple — it matches every `<tag` opening
 * that's not a closing tag, doctype, or comment, and inserts the attribute
 * right after the tag name. This is safe for well-formed HTML; for
 * malformed HTML the DOMParser path in `visual-editor.ts:patchHtmlText`
 * still works because it uses the DOM-order id (n0, n1, …) which the
 * inspection script assigns regardless.
 */
function tagHtmlSourceFile(html: string, entryFile: string): string {
  if (!entryFile) return html;
  const escaped = entryFile.replace(/"/g, "&quot;");
  // Match opening tags like `<div ...>` but NOT `</div>`, `<!doctype>`, `<!--`.
  return html.replace(/<(?!\/|!)([a-zA-Z][\w-]*)((?:\s[^>]*)?)(\s*\/?)>/g,
    (match, tag: string, attrs: string, close: string) => {
      // If the element already has data-lucian-source-file, leave it.
      if (/\bdata-lucian-source-file=/.test(attrs)) return match;
      return `<${tag}${attrs} data-lucian-source-file="${escaped}"${close}>`;
    });
}
