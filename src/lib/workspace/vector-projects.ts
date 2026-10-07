import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { defaultSettingsForMode, type TraceSettings } from "@/lib/workspace/vector-studio";

const DB_NAME = "lucian-vector-studio-v1";
const STORE_NAME = "vector-projects";
const DB_VERSION = 1;
export const VECTOR_HISTORY_LIMIT = 40;

export interface VectorRevision {
  id: string;
  label: string;
  svg: string;
  createdAt: number;
}

export interface VectorProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  svg: string;
  sourceDataUrl: string | null;
  sourceName: string | null;
  sourceMime: string | null;
  sourceWidth: number;
  sourceHeight: number;
  settings: TraceSettings;
  history: VectorRevision[];
  historyIndex: number;
  workspacePath?: string;
}

interface VectorStudioDB extends DBSchema {
  [STORE_NAME]: {
    key: string;
    value: VectorProject;
    indexes: { "by-updated": number };
  };
}

let database: Promise<IDBPDatabase<VectorStudioDB>> | null = null;

function getDatabase() {
  if (typeof window === "undefined") throw new Error("Vector projects are available in the browser.");
  if (!database) {
    database = openDB<VectorStudioDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("by-updated", "updatedAt");
        }
      },
    });
  }
  return database;
}

function id(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

export function blankVectorSvg(width = 1200, height = 800): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g data-lucian-vector-id="layer_artboard"><rect data-lucian-vector-id="shape_background" width="${width}" height="${height}" fill="#ffffff"/><text data-lucian-vector-id="shape_title" x="${Math.round(width / 2)}" y="${Math.round(height / 2)}" text-anchor="middle" font-family="Inter, sans-serif" font-size="48" fill="#18181b">New vector project</text></g></svg>`;
}

export function createVectorProject(name = "Untitled Vector"): VectorProject {
  const now = Date.now();
  const svg = blankVectorSvg();
  return {
    id: id("vec"),
    name,
    createdAt: now,
    updatedAt: now,
    svg,
    sourceDataUrl: null,
    sourceName: null,
    sourceMime: null,
    sourceWidth: 1200,
    sourceHeight: 800,
    settings: defaultSettingsForMode("logo"),
    history: [{ id: id("rev"), label: "Created project", svg, createdAt: now }],
    historyIndex: 0,
  };
}

export async function listVectorProjects(): Promise<VectorProject[]> {
  const db = await getDatabase();
  const projects = await db.getAll(STORE_NAME);
  return projects.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveVectorProject(project: VectorProject): Promise<void> {
  const db = await getDatabase();
  await db.put(STORE_NAME, project);
}

export async function deleteVectorProject(projectId: string): Promise<void> {
  const db = await getDatabase();
  await db.delete(STORE_NAME, projectId);
}

export function renameVectorProject(project: VectorProject, name: string): VectorProject {
  return { ...project, name: name.trim() || project.name, updatedAt: Date.now() };
}

export function commitVectorRevision(project: VectorProject, svg: string, label: string): VectorProject {
  if (svg === project.svg) return project;
  const now = Date.now();
  const activeHistory = project.history.slice(0, project.historyIndex + 1);
  const history = [
    ...activeHistory,
    { id: id("rev"), label, svg, createdAt: now },
  ].slice(-VECTOR_HISTORY_LIMIT);
  return {
    ...project,
    svg,
    updatedAt: now,
    history,
    historyIndex: history.length - 1,
  };
}

export function moveVectorHistory(project: VectorProject, nextIndex: number): VectorProject {
  const index = Math.max(0, Math.min(project.history.length - 1, nextIndex));
  const revision = project.history[index];
  if (!revision) return project;
  return { ...project, svg: revision.svg, historyIndex: index, updatedAt: Date.now() };
}

export function dataUrlToFile(dataUrl: string, name: string, mime: string): File {
  const [header, payload = ""] = dataUrl.split(",", 2);
  const bytes = header.includes(";base64") ? atob(payload) : decodeURIComponent(payload);
  const array = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) array[index] = bytes.charCodeAt(index);
  return new File([array], name, { type: mime });
}
