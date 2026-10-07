// Repomix-grade project packer — packs a project into a single AI-friendly
// document in XML, Markdown, or Plain style, with a configurable options set
// (summary, directory tree, line numbers, comment stripping, glob patterns).
//
// This powers the Project → Code side of the Code Converter. The design goal
// is functional parity with Repomix's output structure while remaining
// LUCIAN's own implementation.

import type { ProjectFile } from "@/types/workspace";

export type PackStyle = "xml" | "markdown" | "plain";

export interface PackOptions {
  style: PackStyle;
  projectName: string;
  includeSummary: boolean;
  includeTree: boolean;
  showLineNumbers: boolean;
  removeComments: boolean;
  removeEmptyLines: boolean;
  /** Comma-separated glob-ish patterns; empty = include everything. */
  includePatterns: string;
  /** Comma-separated glob-ish patterns to exclude. */
  ignorePatterns: string;
}

export const DEFAULT_PACK_OPTIONS: PackOptions = {
  style: "xml",
  projectName: "project",
  includeSummary: true,
  includeTree: true,
  showLineNumbers: false,
  removeComments: false,
  removeEmptyLines: false,
  includePatterns: "",
  ignorePatterns: "",
};

/** Files that commonly contain secrets — always excluded, with a notice. */
const SECRET_PATTERNS = [/^\.env$/i, /^\.env\..+$/i, /(^|\/)id_rsa$/i, /\.pem$/i, /credentials\.json$/i];

function isSecretFile(path: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(path));
}

/** Convert a simple glob (* and **) to a RegExp. */
function globToRegex(glob: string): RegExp {
  const escaped = glob
    .trim()
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0001/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function parsePatterns(csv: string): RegExp[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(globToRegex);
}

export interface PackResult {
  output: string;
  fileCount: number;
  skippedSecrets: string[];
  totalChars: number;
  /** Rough token estimate (chars / 4). */
  approxTokens: number;
}

/** Strip common comment syntaxes (best-effort, non-AST). */
function stripComments(content: string, path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["js", "jsx", "ts", "tsx", "css", "scss", "java", "c", "cpp", "go", "rs"].includes(ext)) {
    return content
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:'"`])\/\/[^\n]*/g, "$1");
  }
  if (["py", "rb", "sh", "yaml", "yml", "toml"].includes(ext)) {
    return content.replace(/(^|\s)#[^\n]*/g, "$1");
  }
  if (["html", "vue", "svelte", "xml", "md"].includes(ext)) {
    return content.replace(/<!--[\s\S]*?-->/g, "");
  }
  return content;
}

function processContent(f: ProjectFile, opts: PackOptions): string {
  let content = f.content;
  if (opts.removeComments) content = stripComments(content, f.path);
  if (opts.removeEmptyLines) {
    content = content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .join("\n");
  }
  if (opts.showLineNumbers) {
    const lines = content.split("\n");
    const width = String(lines.length).length;
    content = lines
      .map((line, i) => `${String(i + 1).padStart(width)}: ${line}`)
      .join("\n");
  }
  return content;
}

/** Build the ASCII directory tree. */
export function buildTree(paths: string[]): string {
  type Node = { [k: string]: Node | null };
  const tree: Node = {};
  for (const p of paths.slice().sort()) {
    const parts = p.split("/").filter(Boolean);
    let node: Node = tree;
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      if (isLast) node[parts[i]] = null;
      else {
        node[parts[i]] = node[parts[i]] ?? {};
        node = node[parts[i]] as Node;
      }
    }
  }
  const lines: string[] = [];
  function render(node: Node, indent: string) {
    for (const key of Object.keys(node).sort((a, b) => {
      const aDir = node[a] !== null ? 0 : 1;
      const bDir = node[b] !== null ? 0 : 1;
      return aDir - bDir || a.localeCompare(b);
    })) {
      const child = node[key];
      lines.push(`${indent}${key}${child !== null ? "/" : ""}`);
      if (child !== null) render(child, indent + "  ");
    }
  }
  render(tree, "");
  return lines.join("\n");
}

const SUMMARY_TEXT = `This file is a packed representation of an entire codebase, combined into a single document. It is designed to be easily consumed by AI systems for analysis, code review, or continued development.`;

/** Pack project files into a single document. */
export function packProject(files: ProjectFile[], opts: PackOptions): PackResult {
  const include = parsePatterns(opts.includePatterns);
  const ignore = parsePatterns(opts.ignorePatterns);
  const skippedSecrets: string[] = [];

  const selected = files.filter((f) => {
    if (f.binary) return false; // binary assets don't belong in AI bundles
    if (isSecretFile(f.path)) {
      skippedSecrets.push(f.path);
      return false;
    }
    if (include.length > 0 && !include.some((re) => re.test(f.path))) return false;
    if (ignore.some((re) => re.test(f.path))) return false;
    return true;
  });

  const paths = selected.map((f) => f.path);
  const parts: string[] = [];

  if (opts.style === "xml") {
    if (opts.includeSummary) {
      parts.push(`<file_summary>\n${SUMMARY_TEXT}\n\nProject: ${opts.projectName}\nFiles: ${selected.length}\nGenerated: ${new Date().toISOString()}\nGenerated by: LUCIAN WORKSPACE Code Converter\n</file_summary>\n`);
    }
    if (opts.includeTree) {
      parts.push(`<directory_structure>\n${buildTree(paths)}\n</directory_structure>\n`);
    }
    parts.push("<files>\n");
    for (const f of selected) {
      parts.push(`<file path="${f.path}">\n${processContent(f, opts)}\n</file>\n\n`);
    }
    parts.push("</files>\n");
  } else if (opts.style === "markdown") {
    if (opts.includeSummary) {
      parts.push(`# File Summary\n\n${SUMMARY_TEXT}\n\n- **Project:** ${opts.projectName}\n- **Files:** ${selected.length}\n- **Generated:** ${new Date().toISOString()}\n- **Generated by:** LUCIAN WORKSPACE Code Converter\n\n`);
    }
    if (opts.includeTree) {
      parts.push(`# Directory Structure\n\n\`\`\`\n${buildTree(paths)}\n\`\`\`\n\n`);
    }
    parts.push("# Files\n\n");
    for (const f of selected) {
      const lang = f.path.split(".").pop() ?? "";
      parts.push(`## File: ${f.path}\n\n\`\`\`${lang}\n${processContent(f, opts)}\n\`\`\`\n\n`);
    }
  } else {
    // plain
    const sep = "=".repeat(64);
    if (opts.includeSummary) {
      parts.push(`${sep}\nFILE SUMMARY\n${sep}\n${SUMMARY_TEXT}\n\nProject: ${opts.projectName}\nFiles: ${selected.length}\nGenerated: ${new Date().toISOString()}\nGenerated by: LUCIAN WORKSPACE Code Converter\n\n`);
    }
    if (opts.includeTree) {
      parts.push(`${sep}\nDIRECTORY STRUCTURE\n${sep}\n${buildTree(paths)}\n\n`);
    }
    for (const f of selected) {
      parts.push(`${sep}\nFILE: ${f.path}\n${sep}\n${processContent(f, opts)}\n\n`);
    }
  }

  const output = parts.join("");
  return {
    output,
    fileCount: selected.length,
    skippedSecrets,
    totalChars: output.length,
    approxTokens: Math.ceil(output.length / 4),
  };
}
