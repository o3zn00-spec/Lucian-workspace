// Virtual file-system helpers: framework detection, path utilities,
// tree building, asset classification, and smart import filtering.

import type { DetectedFramework, FileEntry, ProjectFile } from "@/types/workspace";

export const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "js", "jsx", "ts", "tsx", "vue", "svelte",
  "astro", "html", "htm", "css", "scss", "sass", "less", "styl", "svg",
  "yml", "yaml", "toml", "ini", "env", "gitignore", "dockerignore",
  "sh", "bash", "zsh", "py", "rb", "go", "rs", "java", "c", "cpp", "h", "hpp",
  "xml", "graphql", "gql", "sql", "lock", "log", "conf", "config",
]);

export const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "svg",
]);

export const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif",
  "woff", "woff2", "ttf", "otf", "eot",
  "mp3", "mp4", "webm", "mov", "avi", "wav", "ogg", "pdf", "zip",
]);

// Directories that are NEVER loaded when a project is imported.
// These contain dependencies, build output, caches, or VCS data — including
// them would balloon memory usage and freeze the UI on large projects.
export const IGNORED_DIRS = new Set([
  "node_modules",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  ".cache",
  ".parcel-cache",
  "dist",
  "build",
  "out",
  "target",
  ".gradle",
  ".maven",
  "__pycache__",
  ".pytest_cache",
  ".venv",
  "venv",
  "env",
  ".idea",
  ".vscode",
  "coverage",
  ".nyc_output",
  "tmp",
  "temp",
  ".tmp",
  ".git",
  ".hg",
  ".svn",
  "vendor", // PHP/bundler vendor dirs
  ".pnp",
  ".yarn",
  "bun.lockb", // binary lockfile
]);

// File patterns we skip during import. These are either binary lockfiles,
// generated artifacts, or OS metadata that add no value to the workspace.
export const IGNORED_FILE_PATTERNS = [
  /\.DS_Store$/i,
  /^Thumbs\.db$/i,
  /^\.DS_Store$/i,
  /\/__MACOSX\//i,
  /\.map$/i, // source maps — too big to be useful in the editor
  /\.lock$/i, // yarn.lock, package-lock.json, pnpm-lock.yaml kept; bun.lockb skipped
  /\.log$/i, // log files
];

// Lockfiles we DO want to keep (so the user can inspect them).
export const KEPT_LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
]);

export function getExtension(path: string): string {
  const base = path.split("/").pop() ?? "";
  if (!base.includes(".")) return "";
  return base.split(".").pop()!.toLowerCase();
}

export function isTextFile(path: string): boolean {
  const ext = getExtension(path);
  if (ext === "") return true; // files like "Dockerfile", "LICENSE"
  if (IMAGE_EXTENSIONS.has(ext) || BINARY_EXTENSIONS.has(ext)) return false;
  return TEXT_EXTENSIONS.has(ext);
}

export function isImageFile(path: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(path));
}

export function isBinaryFile(path: string): boolean {
  return BINARY_EXTENSIONS.has(getExtension(path));
}

export function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

export function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

export function joinPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

/** Returns true if a path should be skipped during import (per IGNORED lists). */
export function shouldIgnorePath(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  for (const part of parts) {
    if (IGNORED_DIRS.has(part)) return true;
  }
  // Skip files matching IGNORED_FILE_PATTERNS, except keep known lockfiles.
  const base = parts[parts.length - 1] ?? path;
  if (KEPT_LOCKFILES.has(base)) return false;
  for (const pattern of IGNORED_FILE_PATTERNS) {
    if (pattern.test(path)) return true;
  }
  // Skip files larger than 5 MB by default — they're typically media.
  return false;
}

/** Returns the list of skipped directories encountered in a path. */
export function getSkippedDirs(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const skipped: string[] = [];
  for (const part of parts) {
    if (IGNORED_DIRS.has(part)) skipped.push(part);
  }
  return skipped;
}

/** Detect the most likely framework/preview strategy for a project.
 *  Works with FileEntry[] (lazy, no content) or ProjectFile[] (full content).
 *  When content is available, we read package.json; otherwise we fall back
 *  to file extension / presence heuristics. */
export function detectFramework(files: FileEntry[] | ProjectFile[]): DetectedFramework {
  const has = (p: string) => files.some((f) => f.path === p);
  const hasExt = (ext: string) => files.some((f) => getExtension(f.path) === ext);
  const hasMatching = (re: RegExp) => files.some((f) => re.test(f.path));

  // Find package.json. Try to read its content if available.
  const pkgFile = files.find((f) => f.path === "package.json") as ProjectFile | undefined;
  if (pkgFile?.content) {
    try {
      const json = JSON.parse(pkgFile.content);
      const deps = { ...(json.dependencies ?? {}), ...(json.devDependencies ?? {}) };
      if (deps.next) return "nextjs";
      if (deps.vue || deps.nuxt) return "vue";
      if (deps.vite && (deps.react || deps["react-dom"])) {
        if (hasExt("tsx")) return "react-vite";
        return "react-jsx";
      }
      if (deps.react || deps["react-dom"]) {
        if (hasExt("tsx")) return "react-tsx";
        return "react-jsx";
      }
    } catch {
      // fall through
    }
  }

  if (has("next.config.js") || has("next.config.mjs") || has("next.config.ts")) {
    return "nextjs";
  }
  if (has("vite.config.js") || has("vite.config.ts")) {
    if (hasExt("vue")) return "vue";
    if (hasExt("tsx")) return "react-vite";
    if (hasExt("jsx")) return "react-jsx";
  }
  if (hasMatching(/pages\/_app\.(jsx|tsx|js|ts)$/)) return "nextjs";
  if (hasMatching(/app\/layout\.(jsx|tsx|js|ts)$/)) return "nextjs";

  // If package.json exists but we couldn't read its content (lazy entry),
  // infer based on the presence of typical React/Vue files.
  if (has("package.json")) {
    if (hasExt("vue")) return "vue";
    if (hasExt("tsx")) return "react-tsx";
    if (hasExt("jsx")) return "react-jsx";
  }

  if (has("index.html") || files.some((f) => f.path.endsWith(".html"))) {
    return "html";
  }

  if (hasExt("vue")) return "vue";
  if (hasExt("tsx")) return "react-tsx";
  if (hasExt("jsx")) return "react-jsx";

  if (files.length === 0) return "unknown";
  return "static";
}

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
}

/** Build a hierarchical tree from files plus optional explicit/empty folders. */
export function buildFileTree(
  files: FileEntry[] | ProjectFile[],
  explicitDirectories: string[] = [],
): TreeNode {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [] };
  const dirMap = new Map<string, TreeNode>();
  dirMap.set("", root);

  const ensureDirectory = (directoryPath: string) => {
    const parts = directoryPath.split("/").filter(Boolean);
    let currentPath = "";
    let parent = root;
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let dir = dirMap.get(currentPath);
      if (!dir) {
        dir = { name: part, path: currentPath, isDir: true, children: [] };
        dirMap.set(currentPath, dir);
        parent.children.push(dir);
      }
      parent = dir;
    }
  };

  for (const directory of [...new Set(explicitDirectories)].sort()) {
    ensureDirectory(directory);
  }

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const file of sorted) {
    const parts = file.path.split("/");
    let currentPath = "";
    let parent = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      const isLast = i === parts.length - 1;

      if (isLast) {
        parent.children.push({
          name: part,
          path: currentPath,
          isDir: false,
          children: [],
        });
      } else {
        let dir = dirMap.get(currentPath);
        if (!dir) {
          dir = { name: part, path: currentPath, isDir: true, children: [] };
          dirMap.set(currentPath, dir);
          parent.children.push(dir);
        }
        parent = dir;
      }
    }
  }

  // Sort: directories first, then alphabetical.
  function sortNode(node: TreeNode) {
    node.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortNode);
  }
  sortNode(root);

  return root;
}

/** Convert a Uint8Array or ArrayBuffer to a base64 string. */
export function bytesToBase64(bytes: Uint8Array | ArrayBuffer): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    binary += String.fromCharCode(...arr.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Convert a base64 string back to a Uint8Array. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Convert a File object to a ProjectFile (binary or text). */
export async function fileToProjectFile(file: File, path: string): Promise<ProjectFile> {
  const ext = getExtension(path);
  const isBinary = BINARY_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext);

  if (isBinary) {
    const buffer = await file.arrayBuffer();
    const base64 = bytesToBase64(buffer);
    return {
      path,
      content: `data:${file.type || "application/octet-stream"};base64,${base64}`,
      binary: true,
      mime: file.type || "application/octet-stream",
      size: buffer.byteLength,
      updatedAt: Date.now(),
      loaded: true,
    };
  }

  const text = await file.text();
  return {
    path,
    content: text,
    binary: false,
    size: new TextEncoder().encode(text).length,
    updatedAt: Date.now(),
    loaded: true,
  };
}

/** Compute total byte size of a project's files. */
export function totalSize(files: FileEntry[] | ProjectFile[]): number {
  return files.reduce((sum, f) => sum + (f.size ?? 0), 0);
}

/** Format a byte count into a human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Human-readable label for a detected framework. */
export function frameworkLabel(framework: DetectedFramework): string {
  switch (framework) {
    case "html":
      return "HTML";
    case "react-jsx":
      return "React JSX";
    case "react-tsx":
      return "React TSX";
    case "react-vite":
      return "React + Vite";
    case "nextjs":
      return "Next.js";
    case "vue":
      return "Vue";
    case "static":
      return "Static";
    case "unknown":
      return "Empty";
    default:
      return "Unknown";
  }
}

/** Guess the language for Monaco based on file extension. */
export function monacoLanguage(path: string): string {
  const ext = getExtension(path);
  const map: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    tsx: "typescript",
    json: "json",
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    sass: "sass",
    less: "less",
    vue: "html",
    svelte: "html",
    md: "markdown",
    markdown: "markdown",
    yaml: "yaml",
    yml: "yaml",
    xml: "xml",
    svg: "xml",
    py: "python",
    sh: "shell",
    bash: "shell",
    sql: "sql",
    graphql: "graphql",
    gql: "graphql",
    dockerfile: "dockerfile",
  };
  return map[ext] ?? "plaintext";
}

/**
 * Search a list of file entries by filename and (optionally) content.
 * Returns ranked results. Content search is opt-in because it requires
 * loading each file's content from IndexedDB.
 */
export interface SearchHit {
  path: string;
  /** Where the match was found. */
  matchType: "filename" | "content";
  /** Matched line preview (for content matches). */
  preview?: string;
  /** Line number (1-indexed) for content matches. */
  line?: number;
  /** Score for ranking. */
  score: number;
}

export function searchByFilename(files: FileEntry[], query: string): SearchHit[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const hits: SearchHit[] = [];
  for (const f of files) {
    const name = f.path.toLowerCase();
    if (name.includes(q)) {
      const basenameMatch = f.path.split("/").pop()!.toLowerCase().includes(q);
      hits.push({
        path: f.path,
        matchType: "filename",
        score: basenameMatch ? 100 : 50,
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score);
}

export function searchByContent(
  files: ProjectFile[],
  query: string,
  maxResults = 50,
): SearchHit[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const hits: SearchHit[] = [];
  outer: for (const f of files) {
    if (f.binary) continue;
    const lines = f.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      const idx = line.indexOf(q);
      if (idx >= 0) {
        const start = Math.max(0, idx - 30);
        const end = Math.min(lines[i].length, idx + q.length + 30);
        hits.push({
          path: f.path,
          matchType: "content",
          preview: `${start > 0 ? "…" : ""}${lines[i].slice(start, end)}${end < lines[i].length ? "…" : ""}`,
          line: i + 1,
          score: 30,
        });
        if (hits.length >= maxResults) break outer;
      }
    }
  }
  return hits.sort((a, b) => a.path.localeCompare(b.path));
}
