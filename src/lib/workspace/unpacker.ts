// Smart Code → Project reconstructor. Accepts, in priority order:
//   1. XML bundles        — <file path="...">...</file> (Repomix XML / LUCIAN XML)
//   2. Plain bundles      — ==== separators + "FILE: path" headers (Repomix
//                           plain, LUCIAN plain, legacy DevWorkspace bundles)
//   3. Markdown bundles   — "## File: path" headings followed by fenced code
//   4. Loose AI output    — any markdown code fences with nearby path hints:
//                           path comments (// src/App.tsx), bold headers
//                           (**src/App.tsx**), headings (### src/App.tsx),
//                           or fence-info paths (```tsx title=src/App.tsx)
//   5. Single raw file    — filename inferred from content
//
// Returns files + a diagnostic + which strategy matched, so the UI can be
// honest about what it understood.

import type { ProjectFile } from "@/types/workspace";

export interface UnpackResult {
  files: ProjectFile[];
  strategy: "xml" | "plain-bundle" | "markdown-bundle" | "loose-fences" | "single-file" | "none";
  diagnostic: string | null;
}

function makeFile(path: string, content: string): ProjectFile {
  return {
    path: path.replace(/^\/+/, "").replace(/\\/g, "/"),
    content,
    binary: false,
    size: new TextEncoder().encode(content).length,
    updatedAt: Date.now(),
    loaded: true,
  };
}

/** A plausible relative file path: has an extension, no spaces, sane depth. */
function isPathLike(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 200 || /\s/.test(t)) return false;
  if (!/^[\w.\-/@]+\.[A-Za-z0-9]{1,10}$/.test(t)) return false;
  return true;
}

// ---- Strategy 1: XML ------------------------------------------------------

function tryXml(input: string): ProjectFile[] {
  const files: ProjectFile[] = [];
  const re = /<file\s+path="([^"]+)"\s*>\n?([\s\S]*?)<\/file>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const path = m[1].trim();
    if (!path) continue;
    let content = m[2];
    if (content.endsWith("\n")) content = content.slice(0, -1);
    files.push(makeFile(path, content));
  }
  return files;
}

// ---- Strategy 2: Plain bundle (=== separators + FILE: headers) ------------

function tryPlainBundle(input: string): ProjectFile[] {
  const files: ProjectFile[] = [];
  // Split on separator lines of 40+ = characters.
  const lines = input.split("\n");
  let i = 0;
  while (i < lines.length) {
    if (/^={40,}\s*$/.test(lines[i])) {
      // Header block: next non-sep line(s) may contain FILE: path
      let j = i + 1;
      let path: string | null = null;
      while (j < lines.length && !/^={40,}\s*$/.test(lines[j])) {
        const fm = lines[j].match(/^FILE:\s*(.+)$/);
        if (fm && isPathLike(fm[1])) path = fm[1].trim();
        j++;
      }
      if (path && j < lines.length) {
        // Content runs from after the closing separator to the next opening
        // separator (or EOF).
        let k = j + 1;
        // skip a single blank line
        if (k < lines.length && lines[k].trim() === "") k++;
        const start = k;
        while (k < lines.length && !/^={40,}\s*$/.test(lines[k])) k++;
        let content = lines.slice(start, k).join("\n");
        content = content.replace(/\n+$/, "\n").replace(/\n$/, "");
        files.push(makeFile(path, content));
        i = k;
        continue;
      }
    }
    i++;
  }
  return files;
}

// ---- Strategy 3: Markdown bundle (## File: path + fence) -------------------

function tryMarkdownBundle(input: string): ProjectFile[] {
  const files: ProjectFile[] = [];
  const re = /^#{1,4}\s*File:\s*(.+?)\s*$\n+```[^\n]*\n([\s\S]*?)\n```/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    const path = m[1].trim().replace(/^`|`$/g, "");
    if (isPathLike(path)) files.push(makeFile(path, m[2]));
  }
  return files;
}

// ---- Strategy 4: Loose AI output (fences + nearby path hints) ---------------

function tryLooseFences(input: string): ProjectFile[] {
  const files: ProjectFile[] = [];
  const fenceRe = /```([^\n]*)\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(input)) !== null) {
    const info = m[1].trim();
    const body = m[2];
    let path: string | null = null;

    // (a) fence info string: ```tsx title=src/App.tsx  OR  ```src/App.tsx
    const infoTitle = info.match(/(?:title|file(?:name)?|path)=([^\s]+)/i);
    if (infoTitle && isPathLike(infoTitle[1])) path = infoTitle[1];
    if (!path) {
      const infoParts = info.split(/\s+/).filter(Boolean);
      for (const part of infoParts) {
        if (isPathLike(part) && part.includes(".")) { path = part; break; }
      }
    }

    // (b) first line of the code block is a path comment:
    //     // src/App.tsx | /* src/App.tsx */ | # scripts/run.py | <!-- index.html -->
    if (!path) {
      const firstLine = body.split("\n", 1)[0].trim();
      const cm = firstLine.match(/^(?:\/\/|#|\/\*|<!--)\s*([\w.\-/@]+\.[A-Za-z0-9]{1,10})\s*(?:\*\/|-->)?$/);
      if (cm && isPathLike(cm[1])) path = cm[1];
    }

    // (c) look upward: the 3 non-empty lines before the fence may name the
    //     file as **src/App.tsx**, ### src/App.tsx, `src/App.tsx`, File: ...
    if (!path) {
      const before = input.slice(0, m.index).split("\n").filter((l) => l.trim());
      const candidates = before.slice(-3).reverse();
      for (const raw of candidates) {
        const stripped = raw
          .replace(/^#{1,6}\s*/, "")
          .replace(/^(?:File|Filename|Path|Create|Update)\s*:?\s*/i, "")
          .replace(/[:.]$/, "")
          .trim()
          .replace(/^\*\*|\*\*$/g, "")
          .replace(/^`|`$/g, "");
        if (isPathLike(stripped)) { path = stripped; break; }
      }
    }

    if (path) {
      // If the first line was the path comment, drop it from the content.
      const lines = body.split("\n");
      const firstTrim = lines[0]?.trim() ?? "";
      const isPathComment = new RegExp(
        `^(?:\\/\\/|#|\\/\\*|<!--)\\s*${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?:\\*\\/|-->)?$`,
      ).test(firstTrim);
      const content = isPathComment ? lines.slice(1).join("\n").replace(/^\n/, "") : body;
      files.push(makeFile(path, content));
    }
  }
  // De-duplicate: later occurrences win (AI often revises files mid-answer).
  const byPath = new Map<string, ProjectFile>();
  for (const f of files) byPath.set(f.path, f);
  return [...byPath.values()];
}

// ---- Strategy 5: single raw file -------------------------------------------

function inferSingleFile(input: string): ProjectFile | null {
  const content = input.trim();
  if (!content) return null;
  const first = content.split("\n", 1)[0];
  if (/^<!DOCTYPE html>|^<html/i.test(content)) return makeFile("index.html", content);
  if (/^\s*\{[\s\S]*\}\s*$/.test(content) && /"[\w-]+"\s*:/.test(content)) {
    try { JSON.parse(content); return makeFile("data.json", content); } catch { /* not json */ }
  }
  if (/import\s.+from\s|export\s(default\s)?(function|const|class)/.test(content)) {
    const hasJsx = /<[A-Z][\w]*(\s|\/|>)/.test(content);
    const hasTypes = /:\s*(string|number|boolean|React\.)|interface\s+\w+/.test(content);
    if (hasJsx) return makeFile(hasTypes ? "src/App.tsx" : "src/App.jsx", content);
    return makeFile(hasTypes ? "src/index.ts" : "src/index.js", content);
  }
  if (/^(def |class |import |from )/m.test(content) && /:$/m.test(content)) {
    return makeFile("main.py", content);
  }
  if (/^\s*(\.|#|@media|@import|:root|[a-z-]+\s*\{)/m.test(content) && /[{};]/.test(content)) {
    return makeFile("styles.css", content);
  }
  if (/^#!\//.test(first)) return makeFile("script.sh", content);
  if (/^(SELECT|CREATE|INSERT|UPDATE|DELETE|ALTER)\s/im.test(content)) {
    return makeFile("query.sql", content);
  }
  return makeFile("untitled.txt", content);
}

// ---- Main entry -------------------------------------------------------------

export function unpackCode(input: string): UnpackResult {
  const trimmed = input.trim();
  if (!trimmed) {
    return { files: [], strategy: "none", diagnostic: "Input is empty." };
  }

  // 1. XML
  const xml = tryXml(trimmed);
  if (xml.length > 0) {
    return { files: xml, strategy: "xml", diagnostic: null };
  }

  // 2. Plain bundle
  if (/^FILE:\s*.+$/m.test(trimmed) && /^={40,}\s*$/m.test(trimmed)) {
    const plain = tryPlainBundle(trimmed);
    if (plain.length > 0) {
      return { files: plain, strategy: "plain-bundle", diagnostic: null };
    }
  }

  // 3. Markdown bundle
  const mdBundle = tryMarkdownBundle(trimmed);
  if (mdBundle.length > 0) {
    return { files: mdBundle, strategy: "markdown-bundle", diagnostic: null };
  }

  // 4. Loose fences (AI chat output)
  if (/```/.test(trimmed)) {
    const loose = tryLooseFences(trimmed);
    if (loose.length > 0) {
      return {
        files: loose,
        strategy: "loose-fences",
        diagnostic: `Recovered ${loose.length} file(s) from AI-style code blocks with path hints. Review the tree before adding to the library.`,
      };
    }
    // Fences exist but no paths at all: take the largest fence as one file.
    const fenceRe = /```[^\n]*\n([\s\S]*?)\n```/g;
    let biggest = "";
    let m: RegExpExecArray | null;
    while ((m = fenceRe.exec(trimmed)) !== null) {
      if (m[1].length > biggest.length) biggest = m[1];
    }
    if (biggest) {
      const single = inferSingleFile(biggest);
      if (single) {
        return {
          files: [single],
          strategy: "single-file",
          diagnostic: `No file paths were found near the code blocks. The largest code block was saved as "${single.path}" (inferred from its content).`,
        };
      }
    }
  }

  // 5. Single raw file
  const single = inferSingleFile(trimmed);
  if (single) {
    return {
      files: [single],
      strategy: "single-file",
      diagnostic: `Input looked like a single source file. Saved as "${single.path}" (inferred from content).`,
    };
  }

  return {
    files: [],
    strategy: "none",
    diagnostic:
      "Could not recognize this input. Supported: XML bundles (<file path=…>), plain bundles (FILE: headers with ==== separators), markdown bundles (## File: headings), AI chat output with code fences, or a single raw source file.",
  };
}
