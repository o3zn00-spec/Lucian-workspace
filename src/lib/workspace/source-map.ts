"use client";

/* Source-mapping layer — Phase 12.
 *
 * Bridge between the rendered preview DOM and the project's source files.
 *
 * Architecture:
 *
 *   1. The preview engine (preview-engine.ts) instruments the rendered HTML
 *      with `data-lucian-source-file` + `data-lucian-source-id` attributes
 *      on every JSX-derived element. These attributes exist ONLY in the
 *      editing preview — they are NEVER written to the project's source
 *      files.
 *
 *   2. The visual canvas's inspection script reads those attributes from
 *      the clicked element + its ancestors and sends them back to the
 *      parent via postMessage.
 *
 *   3. This module provides the mapping: given a (sourceFile, sourceId)
 *      pair, it loads the file's content, parses it (JSX AST for .jsx/.tsx,
 *      DOMParser for .html), and returns the source location + editable
 *      properties.
 *
 *   4. Visual editor actions (set className, set text, set style, etc.)
 *      call into the appropriate mutator (jsx-ast.ts / visual-editor.ts /
 *      tailwind-mutator.ts / css-mutator.ts) which produces a patched
 *      source string. The visual editor then writes that string back to
 *      IndexedDB via the workspace store's writeFile.
 *
 * Preview instrumentation attributes:
 *   data-lucian-source-file  → the source file path (e.g. "src/Card.tsx")
 *   data-lucian-source-id   → stable id (e.g. "el-12-4-a1b2") computed
 *                              from the source element's AST location
 *
 * These attributes are stripped from the rendered DOM before export /
 * download (see the preview engine's export path).
 */

import type { Project, ProjectFile } from "@/types/workspace";
import {
  parseJsxSource,
  collectJsxElements,
  isJsxFile,
  type JsxElementInfo,
} from "./jsx-ast";
import { analyzeProject, type VisualNode } from "./visual-editor";

/**
 * Information about a selected element's source mapping.
 *
 * Returned by `resolveSourceMapping()` — the visual editor uses this to
 * decide which mutator to call and which file to write to.
 */
export interface SourceMapping {
  /** The source file the element belongs to. */
  filePath: string;
  /** The file extension (lowercase, no dot). */
  fileExt: string;
  /** Stable source id from the preview instrumentation. */
  sourceId: string;
  /** Element info from the JSX AST (for .jsx/.tsx files). */
  jsxElement?: JsxElementInfo;
  /** The current source content of the file (loaded lazily). */
  sourceContent: string;
  /** True if the source file could not be parsed safely. */
  parseError?: string;
  /**
   * The mutator strategy the visual editor should use for this element:
   *
   *   - "jsx-ast"         → JSX/TSX AST mutation (jsx-ast.ts)
   *   - "html-dom"         → HTML DOMParser mutation (visual-editor.ts)
   *   - "css-rule"         → CSS/CSS Module rule mutation (css-mutator.ts)
   *   - "tailwind-static"  → static Tailwind utility mutation (tailwind-mutator.ts)
   *   - "direct-edit"      → fallback — open Monaco at the source location
   */
  strategy: "jsx-ast" | "html-dom" | "css-rule" | "tailwind-static" | "direct-edit";
  /** Reason for the strategy choice (for diagnostics). */
  strategyReason: string;
}

/**
 * Resolve the source mapping for a selected preview element.
 *
 * @param project  the active project
 * @param sourceFile  the data-lucian-source-file attribute value
 * @param sourceId  the data-lucian-source-id attribute value (or the
 *                  DOM-order id "n6" for HTML projects)
 * @param node  the VisualNode from the inspection (may carry className, etc.)
 *
 * Returns null if the source file doesn't exist or can't be resolved.
 */
export async function resolveSourceMapping(
  project: Project | null,
  sourceFile: string | null,
  sourceId: string,
  node: VisualNode | null,
  readFile: (filePath: string) => Promise<string | undefined>,
): Promise<SourceMapping | null> {
  if (!project || !sourceFile) return null;

  const fileEntry = project.files.find((f) => f.path === sourceFile);
  if (!fileEntry || fileEntry.binary) return null;

  const sourceContent = await readFile(sourceFile);
  if (typeof sourceContent !== "string") return null;

  const fileExt = sourceFile.split(".").pop()?.toLowerCase() ?? "";

  // ── JSX / TSX files ──
  if (isJsxFile(sourceFile)) {
    const { ast, parseError } = parseJsxSource(sourceContent);
    if (!ast || parseError) {
      return {
        filePath: sourceFile,
        fileExt,
        sourceId,
        sourceContent,
        parseError: parseError ?? undefined,
        strategy: "direct-edit",
        strategyReason: parseError
          ? `Source file failed to parse: ${parseError}`
          : "Could not parse the JSX/TSX source.",
      };
    }
    const elements = collectJsxElements(ast, sourceFile);
    const jsxElement = elements.find((e) => e.sourceId === sourceId);
    if (!jsxElement) {
      // The source id doesn't match any element — the file may have
      // changed since selection. Fall back to Direct Edit.
      return {
        filePath: sourceFile,
        fileExt,
        sourceId,
        sourceContent,
        strategy: "direct-edit",
        strategyReason: "Source element not found — the file may have changed since selection.",
      };
    }

    // Decide strategy based on the element's properties.
    let strategy: SourceMapping["strategy"] = "jsx-ast";
    let strategyReason = "JSX AST mutation";

    // If the user wants to edit Tailwind utilities, use the Tailwind mutator
    // (still via setClassName on the AST, but the inspector calls
    // setTailwindUtility first to compute the new className string).
    if (jsxElement.className && !jsxElement.classNameIsDynamic) {
      strategy = "tailwind-static";
      strategyReason = "Static Tailwind className — utility mutation";
    } else if (jsxElement.classNameIsDynamic) {
      // Dynamic className — Direct Edit. The inspector can still call
      // setInlineStyle (which mutates the `style` attribute, not className),
      // but className itself is not safe.
      strategy = "jsx-ast";
      strategyReason = "Dynamic className — inline style edits allowed, className falls back to Direct Edit";
    }

    return {
      filePath: sourceFile,
      fileExt,
      sourceId,
      sourceContent,
      jsxElement,
      strategy,
      strategyReason,
    };
  }

  // ── HTML files ──
  if (fileExt === "html" || fileExt === "htm") {
    return {
      filePath: sourceFile,
      fileExt,
      sourceId,
      sourceContent,
      strategy: "html-dom",
      strategyReason: "HTML DOMParser mutation",
    };
  }

  // ── CSS / CSS Module files ──
  if (fileExt === "css" || fileExt === "scss" || fileExt === "module.css") {
    // For CSS files, the sourceId is the class name (the inspector passes
    // the className as the sourceId for CSS-rule mutations).
    return {
      filePath: sourceFile,
      fileExt,
      sourceId,
      sourceContent,
      strategy: "css-rule",
      strategyReason: "CSS rule mutation",
    };
  }

  // ── Other files ──
  return {
    filePath: sourceFile,
    fileExt,
    sourceId,
    sourceContent,
    strategy: "direct-edit",
    strategyReason: `File type .${fileExt} is not supported for visual editing.`,
  };
}

/**
 * Build the preview instrumentation script that injects
 * data-lucian-source-* attributes into the rendered preview.
 *
 * For HTML projects, we use the existing DOMParser-based assignment
 * (counter on document.querySelectorAll('*')). For JSX/TSX projects,
 * we rely on the preview engine having already injected the attributes
 * via its React rendering path (the preview engine walks the JSX AST
 * and adds the attributes when generating the preview HTML).
 *
 * Phase 12 final integration pass:
 *   For HTML projects, the parent calls `buildSourceMapScript(entryFile)`
 *   so every element also gets `data-lucian-source-file="<entryFile>"`
 *   — that lets `resolveSourceMapping()` return a non-null `sourceFile`
 *   and route through the DOMParser patcher (`patchHtmlText` etc.).
 */
export function buildSourceMapScript(entryFile?: string): string {
  const fileAttr = entryFile ? entryFile.replace(/"/g, "&quot;") : "";
  return `
(function () {
  // For HTML projects, assign data-lucian-source-id based on document order.
  // This matches the visual-editor.ts assignSourceIds() logic so the
  // source patcher can find the same element.
  function assignHtmlSourceIds() {
    var counter = 0;
    var fileAttr = ${JSON.stringify(fileAttr)};
    document.querySelectorAll('*').forEach(function (el) {
      if (!el.hasAttribute('data-lucian-source-id')) {
        el.setAttribute('data-lucian-source-id', 'n' + (counter++));
      }
      // Tag every element with data-lucian-source-file so the inspector
      // knows which file owns it. For JSX projects, the Babel plugin
      // already set this attribute — don't overwrite (only set if missing).
      if (fileAttr && !el.hasAttribute('data-lucian-source-file')) {
        el.setAttribute('data-lucian-source-file', fileAttr);
      }
    });
  }
  // Only assign if no element has data-lucian-source-id yet (i.e. this is
  // an HTML project, not a JSX project where the preview engine already
  // injected the attributes).
  var firstWithId = document.querySelector('[data-lucian-source-id]');
  if (!firstWithId) {
    assignHtmlSourceIds();
  } else if (${JSON.stringify(fileAttr)}) {
    // JSX project — but we still tag elements without a source-file
    // (e.g. wrapper elements the preview engine added around the React root).
    document.querySelectorAll('*').forEach(function (el) {
      if (!el.hasAttribute('data-lucian-source-file')) {
        el.setAttribute('data-lucian-source-file', ${JSON.stringify(fileAttr)});
      }
    });
  }
})();
`;
}

/**
 * Inject source-mapping metadata into a JSX preview document.
 *
 * For each JSX element in the rendered preview, we add:
 *   data-lucian-source-file="<filePath>"
 *   data-lucian-source-id="<sourceId>"
 *
 * This is called by the preview engine when rendering a JSX/TSX project
 * (NOT for HTML projects — those use the DOM-order id assignment).
 *
 * The injection is done at the preview-engine level by walking the JSX
 * AST and adding the attributes to each JSXOpeningElement. This is
 * already handled by the preview engine's React rendering path, so this
 * function is a no-op placeholder for HTML projects (which use the
 * script-based assignment instead).
 */
export function injectSourceMapIntoJsxPreview(
  html: string,
  _file: string,
  _elements: JsxElementInfo[],
): string {
  // The actual injection is done by the preview engine when it walks
  // the JSX AST. This function is here for architectural completeness
  // and for future use (e.g. if we want to post-process the rendered
  // HTML to add the attributes via regex — but that's fragile and we
  // prefer the AST-based injection in the preview engine).
  return html;
}

/** Re-export the analyzer for convenience. */
export { analyzeProject };

/** Re-export the visual node type. */
export type { VisualNode } from "./visual-editor";

/** Re-export ProjectFile for convenience. */
export type { ProjectFile } from "@/types/workspace";
