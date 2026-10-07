"use client";

/* LUCIAN Knowledge Library — File parsers (Phase 14).
 *
 * Parses imported files (PDF, TXT, EPUB) into extracted text content
 * that the Knowledge Library can display + search.
 *
 * All parsing happens CLIENT-SIDE in the browser:
 *   - PDF: pdfjs-dist (PDF.js) — extracts text per page.
 *   - TXT: direct File.text() — preserves line breaks + Unicode.
 *   - EPUB: a lightweight ZIP + XHTML parser (no DRM bypass).
 *
 * Security:
 *   - File type + extension validated BEFORE parsing.
 *   - File size limited (MAX_FILE_SIZE_BYTES = 50MB).
 *   - EPUB XHTML is sanitized — <script> tags stripped, no external
 *     resources loaded. We extract TEXT only, never render raw HTML.
 *   - PDF: PDF.js runs in a sandboxed worker; we never execute
 *     embedded JavaScript.
 *
 * No server round-trip — files never leave the browser.
 */

import type { KnowledgeMaterial } from "./materials";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

export interface ParsedMaterial {
  title: string;
  type: "pdf" | "txt" | "epub";
  fileName: string;
  mimeType: string;
  textContent: string;
  chapters?: { title?: string; startOffset: number; endOffset: number }[];
  author?: string;
  source: string;
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

/** Validate a file before parsing.
 *  Throws ParseError if the file is too large, has an unsupported
 *  extension, or has a suspicious MIME type. */
export function validateFile(file: File): void {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new ParseError(
      `File is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB.`,
    );
  }
  if (file.size === 0) {
    throw new ParseError("File is empty.");
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["pdf", "txt", "epub", "text", "plain"].includes(ext) && !file.type.startsWith("text/") && file.type !== "application/pdf" && file.type !== "application/epub+zip") {
    throw new ParseError(
      `Unsupported file type: ${file.type || ext}. Supported: PDF, TXT, EPUB.`,
    );
  }
}

/** Detect the material type from the file extension + MIME type. */
export function detectType(file: File): "pdf" | "txt" | "epub" {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf" || file.type === "application/pdf") return "pdf";
  if (ext === "epub" || file.type === "application/epub+zip") return "epub";
  return "txt";
}

// ── TXT parser ────────────────────────────────────────────────────────────

/** Parse a plain-text file. Preserves line breaks, paragraphs, Unicode. */
export async function parseTxt(file: File): Promise<ParsedMaterial> {
  const text = await file.text();
  return {
    title: file.name.replace(/\.[^.]+$/, ""),
    type: "txt",
    fileName: file.name,
    mimeType: file.type || "text/plain",
    textContent: text,
    source: "Imported from text file",
  };
}

// ── PDF parser (via PDF.js) ────────────────────────────────────────────────

/**
 * Parse a PDF file using PDF.js.
 *
 * We load pdfjs-dist dynamically (not at module level) so it only
 * bundles when the user actually imports a PDF. The worker is loaded
 * from the same origin (pdfjs-dist ships a worker file that Next.js
 * bundles as a static asset via the `new URL(..., import.meta.url)`
 * pattern).
 *
 * For each page, we extract the text items and concatenate them with
 * newlines. Pages are separated by a form-feed character (\f) so the
 * reading view can split on \f to reconstruct page boundaries.
 *
 * If the PDF is scanned/image-only and contains no extractable text,
 * we return an HONEST "No extractable text found" result — we do NOT
 * perform OCR (out of scope for Phase 14).
 */
export async function parsePdf(file: File): Promise<ParsedMaterial> {
  // Dynamic import — only loads PDF.js when needed.
  const pdfjs = await import("pdfjs-dist");
  // Set the worker source. We use the CDN-hosted worker matching the
  // installed version. This is the officially recommended approach for
  // browser usage. The worker runs same-origin via the CDN's CORS
  // headers.
  //
  // We guard for the case where the worker is already set (HMR).
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  }

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  // Extract metadata (title, author) when available.
  let title = file.name.replace(/\.pdf$/i, "");
  let author: string | undefined;
  try {
    const meta = await pdf.getMetadata();
    const info = meta?.info as Record<string, unknown> | undefined;
    if (info?.Title && typeof info.Title === "string" && info.Title.trim()) {
      title = info.Title.trim();
    }
    if (info?.Author && typeof info.Author === "string" && info.Author.trim()) {
      author = info.Author.trim();
    }
  } catch {
    // Metadata not available — use the filename.
  }

  // Extract text from each page.
  const pageTexts: string[] = [];
  const chapters: { title?: string; startOffset: number; endOffset: number }[] = [];
  let totalOffset = 0;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    // Concatenate text items. Each item has a `str` property. We join
    // items with spaces and add newlines based on the `hasEOL` flag.
    let pageText = "";
    let lastY: number | null = null;
    for (const item of textContent.items) {
      if (!("str" in item)) continue;
      // Detect line breaks via Y-position changes.
      const transform = (item as { transform?: number[] }).transform;
      const y = transform ? transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
        pageText += "\n";
      } else if (pageText && !pageText.endsWith(" ") && !pageText.endsWith("\n")) {
        pageText += " ";
      }
      pageText += (item as { str: string }).str;
      if ((item as { hasEOL?: boolean }).hasEOL) {
        pageText += "\n";
      }
      lastY = y;
    }
    const startOffset = totalOffset;
    pageTexts.push(pageText);
    totalOffset += pageText.length + 1; // +1 for the \f separator
    chapters.push({
      title: `Page ${i}`,
      startOffset,
      endOffset: totalOffset,
    });
  }

  // Join pages with form-feed.
  const fullText = pageTexts.join("\f");

  if (!fullText.trim()) {
    throw new ParseError("No extractable text found in this PDF. It may be a scanned/image-only document. OCR is not supported.");
  }

  return {
    title,
    type: "pdf",
    fileName: file.name,
    mimeType: "application/pdf",
    textContent: fullText,
    chapters,
    author,
    source: "Imported from PDF",
  };
}

// ── EPUB parser ───────────────────────────────────────────────────────────

/**
 * Parse an EPUB file.
 *
 * EPUB is a ZIP archive containing XHTML chapters + metadata (OPF).
 * We:
 *   1. Unzip using the browser's built-in DecompressionStream API
 *      (no external dependency needed — available in all modern browsers).
 *   2. Read the OPF file to get the title + spine (chapter order).
 *   3. For each spine item, read the XHTML, strip all tags, extract
 *      the text content.
 *   4. Concatenate chapters with double newlines.
 *
 * Security:
 *   - We NEVER render the raw XHTML — we extract TEXT only.
 *   - <script> tags are stripped (we don't parse them at all).
 *   - No external resources are loaded (images, CSS, etc. are ignored).
 *   - DRM-encrypted EPUBs will fail to parse — we report an honest
 *     "unsupported" state.
 */
export async function parseEpub(file: File): Promise<ParsedMaterial> {
  // Dynamic import of JSZip for ZIP extraction. JSZip is already in
  // package.json (used by the workspace unpacker).
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  // Find the OPF file (container.xml points to it).
  const containerXml = await zip.file("META-INF/container.xml")?.async("text");
  if (!containerXml) {
    throw new ParseError("Invalid EPUB: missing container.xml.");
  }
  const opfPath = containerXml.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) {
    throw new ParseError("Invalid EPUB: cannot find OPF file path.");
  }
  const opfText = await zip.file(opfPath)?.async("text");
  if (!opfText) {
    throw new ParseError("Invalid EPUB: OPF file not found.");
  }

  // Extract title + author from OPF metadata.
  const title = opfText.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/i)?.[1]?.trim() ?? file.name.replace(/\.epub$/i, "");
  const author = opfText.match(/<dc:creator[^>]*>([^<]+)<\/dc:creator>/i)?.[1]?.trim();

  // Extract the spine (chapter order).
  const manifestMatches = opfText.matchAll(/<item[^>]*id="([^"]+)"[^>]*href="([^"]+)"[^>]*media-type="([^"]+)"[^>]*\/?>/gi);
  const manifest = new Map<string, { href: string; mediaType: string }>();
  for (const m of manifestMatches) {
    manifest.set(m[1], { href: m[2], mediaType: m[3] });
  }
  const spineMatches = opfText.matchAll(/<itemref[^>]*idref="([^"]+)"[^>]*\/?>/gi);
  const spineIds: string[] = [];
  for (const m of spineMatches) {
    spineIds.push(m[1]);
  }

  // OPF hrefs are relative to the OPF file's directory.
  const opfDir = opfPath.includes("/") ? opfPath.replace(/\/[^/]*$/, "/") : "";

  // Extract text from each spine item.
  const chapterTexts: string[] = [];
  const chapters: { title?: string; startOffset: number; endOffset: number }[] = [];
  let totalOffset = 0;
  for (const id of spineIds) {
    const item = manifest.get(id);
    if (!item || !item.mediaType.includes("xhtml") && !item.mediaType.includes("html")) continue;
    // Resolve the href relative to the OPF directory.
    const fullPath = opfDir + item.href;
    const xhtml = await zip.file(fullPath)?.async("text");
    if (!xhtml) continue;

    // Strip all tags — extract text only. This is the security boundary:
    // no scripts, no iframes, no external resources. Just plain text.
    const text = stripHtml(xhtml);
    if (!text.trim()) continue;

    const startOffset = totalOffset;
    chapterTexts.push(text);
    totalOffset += text.length + 2; // +2 for the \n\n separator
    chapters.push({
      title: extractTitle(xhtml) ?? `Chapter ${chapters.length + 1}`,
      startOffset,
      endOffset: totalOffset,
    });
  }

  if (chapterTexts.length === 0) {
    throw new ParseError("No readable chapters found in this EPUB. It may be encrypted/DRM-protected.");
  }

  const fullText = chapterTexts.join("\n\n");

  return {
    title,
    type: "epub",
    fileName: file.name,
    mimeType: "application/epub+zip",
    textContent: fullText,
    chapters,
    author,
    source: "Imported from EPUB",
  };
}

/** Strip all HTML tags + extract text content. Security boundary. */
function stripHtml(html: string): string {
  // Remove <script> + <style> blocks entirely (including content).
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Remove all other tags, keeping the text between them.
  s = s.replace(/<[^>]+>/g, " ");
  // Decode common HTML entities.
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
  // Collapse whitespace.
  return s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Extract the <title> or <h1> from XHTML for chapter labeling. */
function extractTitle(xhtml: string): string | undefined {
  const h1 = xhtml.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1];
  if (h1) return stripHtml(h1).trim();
  const title = xhtml.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
  if (title) return title.trim();
  return undefined;
}

// ── Main entry point ──────────────────────────────────────────────────────

/** Parse a file into a ParsedMaterial. Detects type + dispatches. */
export async function parseFile(file: File): Promise<ParsedMaterial> {
  validateFile(file);
  const type = detectType(file);
  switch (type) {
    case "pdf": return parsePdf(file);
    case "epub": return parseEpub(file);
    case "txt": return parseTxt(file);
  }
}

/** Convert a ParsedMaterial into the KnowledgeMaterial shape for storage. */
export function toMaterialInput(parsed: ParsedMaterial): Omit<KnowledgeMaterial, "id" | "createdAt" | "updatedAt"> {
  return {
    title: parsed.title,
    type: parsed.type,
    fileName: parsed.fileName,
    mimeType: parsed.mimeType,
    author: parsed.author,
    textContent: parsed.textContent,
    chapters: parsed.chapters,
    source: parsed.source,
    readingProgress: 0,
    status: "reading",
  };
}
