"use client";

/* LUCIAN Knowledge Library — Material model + IndexedDB storage (Phase 14).
 *
 * ONE canonical KnowledgeMaterial model. Reused by:
 *   - Add Material dialog (creates materials)
 *   - Library home (lists materials)
 *   - Reading view (displays material content)
 *   - Highlights page (lists highlights across materials)
 *   - Knowledge Notes page (lists notes across materials)
 *   - Phase 9 deep-link receiver (?item=<id>)
 *
 * Storage: IndexedDB (not localStorage — materials can be large).
 * We use the idb library (already in package.json) for a clean API.
 *
 * No Neon, no Supabase, no server filesystem. Pure client-side.
 */

import { openDB, type IDBPDatabase } from "idb";

/** Canonical material type. */
export type MaterialType = "pdf" | "txt" | "epub" | "builtin";

/** ONE canonical Knowledge material model. */
export interface KnowledgeMaterial {
  /** Stable unique id. */
  id: string;
  /** Display title. */
  title: string;
  /** Material type — drives the parser + reader. */
  type: MaterialType;
  /** Original file name (for imported materials). */
  fileName?: string;
  /** MIME type (e.g. "application/pdf", "text/plain", "application/epub+zip"). */
  mimeType?: string;
  /** Author (extracted from EPUB metadata when available). */
  author?: string;
  /** When the material was created (epoch ms). */
  createdAt: number;
  /** When the material was last updated (epoch ms). */
  updatedAt: number;
  /** Extracted text content (UTF-8). For PDFs this is the concatenated
   *  text of all pages, with page breaks (\f) between pages. For EPUBs
   *  this is the concatenated chapter text. For TXTs this is the raw
   *  file content. For built-in materials this is the editorial content. */
  textContent?: string;
  /** Chapter/page structure (when available). Used for navigation. */
  chapters?: { title?: string; startOffset: number; endOffset: number }[];
  /** Reading progress (0–100). */
  readingProgress?: number;
  /** Reading status. */
  status?: "reading" | "read";
  /** Source attribution (e.g. "Imported from PDF"). */
  source?: string;
  /** For built-in materials, a reference to the static catalog entry. */
  builtinId?: string;
}

/** A highlight created by selecting text in a material. */
export interface KnowledgeHighlight {
  /** Stable unique id. */
  id: string;
  /** The material this highlight belongs to. */
  materialId: string;
  /** The highlighted text (exact string). */
  text: string;
  /** Character offset in the material's textContent where the highlight
   *  starts. Used to scroll back to the highlight location. */
  startOffset: number;
  /** Character offset where the highlight ends. */
  endOffset: number;
  /** Highlight color/style (default "yellow"). */
  color?: string;
  /** When the highlight was created (epoch ms). */
  createdAt: number;
}

/** A note attached to a material (or to a highlight). */
export interface KnowledgeNote {
  /** Stable unique id. */
  id: string;
  /** The material this note belongs to. */
  materialId: string;
  /** The note text. */
  text: string;
  /** Optional reference to a highlight (when the note is attached to a
   *  specific selection). */
  highlightId?: string;
  /** Character offset in the material's textContent (when the note is
   *  attached to a specific location). */
  offset?: number;
  /** When the note was created (epoch ms). */
  createdAt: number;
  /** When the note was last updated (epoch ms). */
  updatedAt: number;
}

// ── IndexedDB schema ──────────────────────────────────────────────────────

const DB_NAME = "lucian-knowledge";
const DB_VERSION = 1;
const STORE_MATERIALS = "materials";
const STORE_HIGHLIGHTS = "highlights";
const STORE_NOTES = "notes";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available on the server"));
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_MATERIALS)) {
          const store = db.createObjectStore(STORE_MATERIALS, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
          store.createIndex("type", "type");
        }
        if (!db.objectStoreNames.contains(STORE_HIGHLIGHTS)) {
          const store = db.createObjectStore(STORE_HIGHLIGHTS, { keyPath: "id" });
          store.createIndex("materialId", "materialId");
          store.createIndex("createdAt", "createdAt");
        }
        if (!db.objectStoreNames.contains(STORE_NOTES)) {
          const store = db.createObjectStore(STORE_NOTES, { keyPath: "id" });
          store.createIndex("materialId", "materialId");
          store.createIndex("createdAt", "createdAt");
        }
      },
    });
  }
  return dbPromise;
}

/** Generate a stable unique id. */
function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Material CRUD ─────────────────────────────────────────────────────────

/** Get all materials, sorted by most recently updated. */
export async function getAllMaterials(): Promise<KnowledgeMaterial[]> {
  try {
    const db = await getDB();
    const all = await db.getAll(STORE_MATERIALS);
    return (all as KnowledgeMaterial[]).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/** Get a single material by id. */
export async function getMaterial(id: string): Promise<KnowledgeMaterial | null> {
  try {
    const db = await getDB();
    const m = await db.get(STORE_MATERIALS, id);
    return (m as KnowledgeMaterial) ?? null;
  } catch {
    return null;
  }
}

/** Create a new material. */
export async function createMaterial(
  material: Omit<KnowledgeMaterial, "id" | "createdAt" | "updatedAt">,
): Promise<KnowledgeMaterial> {
  const db = await getDB();
  const now = Date.now();
  const full: KnowledgeMaterial = {
    ...material,
    id: newId("mat"),
    createdAt: now,
    updatedAt: now,
  };
  await db.put(STORE_MATERIALS, full);
  return full;
}

/** Update an existing material. */
export async function updateMaterial(
  id: string,
  patch: Partial<KnowledgeMaterial>,
): Promise<void> {
  const db = await getDB();
  const existing = (await db.get(STORE_MATERIALS, id)) as KnowledgeMaterial | undefined;
  if (!existing) return;
  const updated: KnowledgeMaterial = { ...existing, ...patch, updatedAt: Date.now() };
  await db.put(STORE_MATERIALS, updated);
}

/** Delete a material + all its highlights + notes. */
export async function deleteMaterial(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([STORE_MATERIALS, STORE_HIGHLIGHTS, STORE_NOTES], "readwrite");
  await tx.objectStore(STORE_MATERIALS).delete(id);
  // Delete all highlights for this material.
  const highlightIdx = tx.objectStore(STORE_HIGHLIGHTS).index("materialId");
  let hCursor = await highlightIdx.openCursor(id);
  while (hCursor) {
    await hCursor.delete();
    hCursor = await hCursor.continue();
  }
  // Delete all notes for this material.
  const noteIdx = tx.objectStore(STORE_NOTES).index("materialId");
  let nCursor = await noteIdx.openCursor(id);
  while (nCursor) {
    await nCursor.delete();
    nCursor = await nCursor.continue();
  }
  await tx.done;
}

// ── Highlight CRUD ────────────────────────────────────────────────────────

/** Get all highlights for a material. */
export async function getHighlightsForMaterial(materialId: string): Promise<KnowledgeHighlight[]> {
  try {
    const db = await getDB();
    const idx = db.transaction(STORE_HIGHLIGHTS).store.index("materialId");
    const all = await idx.getAll(materialId);
    return (all as KnowledgeHighlight[]).sort((a, b) => a.startOffset - b.startOffset);
  } catch {
    return [];
  }
}

/** Get ALL highlights across ALL materials (for the Highlights page). */
export async function getAllHighlights(): Promise<Array<KnowledgeHighlight & { material?: KnowledgeMaterial }>> {
  try {
    const db = await getDB();
    const all = await db.getAll(STORE_HIGHLIGHTS);
    const highlights = all as KnowledgeHighlight[];
    // Enrich with material info.
    const enriched = await Promise.all(
      highlights.map(async (h) => {
        const material = (await db.get(STORE_MATERIALS, h.materialId)) as KnowledgeMaterial | undefined;
        return { ...h, material };
      }),
    );
    return enriched.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/** Create a new highlight. */
export async function createHighlight(
  highlight: Omit<KnowledgeHighlight, "id" | "createdAt">,
): Promise<KnowledgeHighlight> {
  const db = await getDB();
  const full: KnowledgeHighlight = {
    ...highlight,
    id: newId("hl"),
    createdAt: Date.now(),
  };
  await db.put(STORE_HIGHLIGHTS, full);
  return full;
}

/** Delete a highlight. */
export async function deleteHighlight(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_HIGHLIGHTS, id);
}

// ── Note CRUD ──────────────────────────────────────────────────────────────

/** Get all notes for a material. */
export async function getNotesForMaterial(materialId: string): Promise<KnowledgeNote[]> {
  try {
    const db = await getDB();
    const idx = db.transaction(STORE_NOTES).store.index("materialId");
    const all = await idx.getAll(materialId);
    return (all as KnowledgeNote[]).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

/** Get ALL notes across ALL materials (for the Knowledge Notes page). */
export async function getAllNotes(): Promise<Array<KnowledgeNote & { material?: KnowledgeMaterial }>> {
  try {
    const db = await getDB();
    const all = await db.getAll(STORE_NOTES);
    const notes = all as KnowledgeNote[];
    const enriched = await Promise.all(
      notes.map(async (n) => {
        const material = (await db.get(STORE_MATERIALS, n.materialId)) as KnowledgeMaterial | undefined;
        return { ...n, material };
      }),
    );
    return enriched.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/** Create a new note. */
export async function createNote(
  note: Omit<KnowledgeNote, "id" | "createdAt" | "updatedAt">,
): Promise<KnowledgeNote> {
  const db = await getDB();
  const now = Date.now();
  const full: KnowledgeNote = {
    ...note,
    id: newId("note"),
    createdAt: now,
    updatedAt: now,
  };
  await db.put(STORE_NOTES, full);
  return full;
}

/** Update a note. */
export async function updateNote(id: string, patch: Partial<KnowledgeNote>): Promise<void> {
  const db = await getDB();
  const existing = (await db.get(STORE_NOTES, id)) as KnowledgeNote | undefined;
  if (!existing) return;
  const updated: KnowledgeNote = { ...existing, ...patch, updatedAt: Date.now() };
  await db.put(STORE_NOTES, updated);
}

/** Delete a note. */
export async function deleteNote(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_NOTES, id);
}
