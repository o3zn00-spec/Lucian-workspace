// IndexedDB-backed persistence layer.
//
// Architecture:
//   - `projects` store: Project metadata + lightweight file index (FileEntry[]).
//     Always loaded in full — small even for projects with 48k files
//     (each entry is ~80 bytes).
//   - `contents` store: per-file content keyed by `${projectId}:${path}`.
//     Loaded on demand only when the user opens a file.
//   - `versions` store: historical snapshots (full content copies).
//
// This separation is what lets the UI list 48k+ files without loading
// their contents into memory.

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Project, ProjectVersion } from "@/types/workspace";

const DB_NAME = "workspace-dev-db-v2";
const DB_VERSION = 2;
const PROJECTS_STORE = "projects";
const VERSIONS_STORE = "versions";
const CONTENTS_STORE = "contents";

interface WorkspaceDB extends DBSchema {
  [PROJECTS_STORE]: {
    key: string;
    value: Project;
  };
  [VERSIONS_STORE]: {
    key: string;
    value: ProjectVersion;
    indexes: { "by-project": string };
  };
  [CONTENTS_STORE]: {
    key: string;
    value: { key: string; content: string; updatedAt: number };
  };
}

let dbPromise: Promise<IDBPDatabase<WorkspaceDB>> | null = null;
const cloudRevisions = new Map<string, number>();
const cloudTimers = new Map<string, ReturnType<typeof setTimeout>>();
let cloudHydration: Promise<void> | null = null;

function cloudSyncEnabled(): boolean {
  return typeof window !== "undefined" && process.env.NEXT_PUBLIC_WORKSPACE_CLOUD_SYNC_ENABLED !== "false";
}

function announceProjectChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("lucian:workspace-projects-changed"));
}

function getDB() {
  if (typeof window === "undefined") {
    throw new Error("IndexedDB is only available in the browser");
  }
  if (!dbPromise) {
    dbPromise = openDB<WorkspaceDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, _transaction) {
        // v1 stores
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
            db.createObjectStore(PROJECTS_STORE, { keyPath: "id" });
          }
          if (!db.objectStoreNames.contains(VERSIONS_STORE)) {
            const store = db.createObjectStore(VERSIONS_STORE, { keyPath: "id" });
            store.createIndex("by-project", "projectId");
          }
        }
        // v2: add separate content store for lazy loading. Existing v1
        // projects stored inline content on each file; that data is left
        // in place (the user can re-import if needed). The new code path
        // expects content in the contents store, so old projects won't
        // display content until re-imported — that's an acceptable trade-off
        // for a major version bump.
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains(CONTENTS_STORE)) {
            db.createObjectStore(CONTENTS_STORE, { keyPath: "key" });
          }
        }
      },
    });
  }
  return dbPromise;
}

export function contentKey(projectId: string, path: string): string {
  return `${projectId}:${path}`;
}

// ---- Project CRUD --------------------------------------------------------

/** Return all live projects (excluding trashed), sorted newest-updated first. */
export async function listProjects(): Promise<Project[]> {
  if (cloudSyncEnabled()) {
    cloudHydration ??= hydrateCloudProjects().finally(() => { cloudHydration = null; });
    await cloudHydration;
  }
  const db = await getDB();
  const all = await db.getAll(PROJECTS_STORE);
  return all
    .filter((p) => p.trashedAt === null || p.trashedAt === undefined)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Return all trashed projects, sorted by trash date (most recent first). */
export async function listTrashedProjects(): Promise<Project[]> {
  const db = await getDB();
  const all = await db.getAll(PROJECTS_STORE);
  return all
    .filter((p) => p.trashedAt !== null && p.trashedAt !== undefined)
    .sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0));
}

export async function getProject(id: string): Promise<Project | undefined> {
  const db = await getDB();
  return db.get(PROJECTS_STORE, id);
}

export async function saveProject(project: Project): Promise<void> {
  const db = await getDB();
  project.updatedAt = Date.now();
  await db.put(PROJECTS_STORE, project);
  scheduleCloudUpload(project.id);
  announceProjectChange();
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(PROJECTS_STORE, id);
  // Cascade delete versions.
  const versions = await db.getAllFromIndex(VERSIONS_STORE, "by-project", id);
  const vTx = db.transaction(VERSIONS_STORE, "readwrite");
  await Promise.all(versions.map((v) => vTx.store.delete(v.id)));
  await vTx.done;
  // Cascade delete all file contents for this project.
  // We iterate over keys with prefix `${id}:` — IndexedDB doesn't have native
  // prefix queries, so we use a cursor range.
  const cTx = db.transaction(CONTENTS_STORE, "readwrite");
  const range = IDBKeyRange.bound(`${id}:`, `${id}:\uffff`);
  let cursor = await cTx.store.openCursor(range);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await cTx.done;
  if (cloudSyncEnabled()) {
    void fetch(`/api/workspace/projects/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
  }
  announceProjectChange();
}

// ---- File content (lazy) -------------------------------------------------

export async function getFileContent(
  projectId: string,
  path: string,
): Promise<string | undefined> {
  const db = await getDB();
  const row = await db.get(CONTENTS_STORE, contentKey(projectId, path));
  return row?.content;
}

export async function setFileContent(
  projectId: string,
  path: string,
  content: string,
): Promise<void> {
  const db = await getDB();
  await db.put(CONTENTS_STORE, {
    key: contentKey(projectId, path),
    content,
    updatedAt: Date.now(),
  });
  scheduleCloudUpload(projectId);
}

export type ProjectContentMutation =
  | { type: "put"; path: string; content: string }
  | { type: "delete"; path: string };

/**
 * Commit project metadata and all related content changes in one IndexedDB
 * transaction. If any write fails, IndexedDB aborts the complete transaction,
 * leaving the previous project and file contents intact.
 */
export async function commitProjectMutation(
  project: Project,
  mutations: ProjectContentMutation[],
): Promise<Project> {
  const db = await getDB();
  const savedProject = { ...project, updatedAt: Date.now() };
  const tx = db.transaction([PROJECTS_STORE, CONTENTS_STORE], "readwrite");
  const projectStore = tx.objectStore(PROJECTS_STORE);
  const contentStore = tx.objectStore(CONTENTS_STORE);
  const now = savedProject.updatedAt;

  await projectStore.put(savedProject);
  for (const mutation of mutations) {
    if (mutation.type === "put") {
      await contentStore.put({
        key: contentKey(savedProject.id, mutation.path),
        content: mutation.content,
        updatedAt: now,
      });
    } else {
      await contentStore.delete(contentKey(savedProject.id, mutation.path));
    }
  }
  await tx.done;
  scheduleCloudUpload(savedProject.id);
  announceProjectChange();
  return savedProject;
}

export async function deleteFileContent(projectId: string, path: string): Promise<void> {
  const db = await getDB();
  await db.delete(CONTENTS_STORE, contentKey(projectId, path));
  scheduleCloudUpload(projectId);
}

/** Bulk-load contents for multiple files (used by Save Preview / Download ZIP). */
export async function getManyFileContents(
  projectId: string,
  paths: string[],
): Promise<Map<string, string>> {
  const db = await getDB();
  const result = new Map<string, string>();
  const tx = db.transaction(CONTENTS_STORE, "readonly");
  await Promise.all(
    paths.map(async (path) => {
      const row = await tx.store.get(contentKey(projectId, path));
      if (row) result.set(path, row.content);
    }),
  );
  return result;
}

/** Bulk-write contents (used by import). */
export async function setManyFileContents(
  projectId: string,
  entries: { path: string; content: string }[],
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(CONTENTS_STORE, "readwrite");
  const now = Date.now();
  await Promise.all(
    entries.map((e) =>
      tx.store.put({
        key: contentKey(projectId, e.path),
        content: e.content,
        updatedAt: now,
      }),
    ),
  );
  await tx.done;
  scheduleCloudUpload(projectId);
}

/** Rename a file's content key. */
export async function renameFileContent(
  projectId: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const db = await getDB();
  const old = await db.get(CONTENTS_STORE, contentKey(projectId, oldPath));
  if (old) {
    await db.delete(CONTENTS_STORE, contentKey(projectId, oldPath));
    await db.put(CONTENTS_STORE, {
      key: contentKey(projectId, newPath),
      content: old.content,
      updatedAt: Date.now(),
    });
    scheduleCloudUpload(projectId);
  }
}

// ---- Authenticated cloud synchronization ---------------------------------

async function hydrateCloudProjects(): Promise<void> {
  try {
    const response = await fetch("/api/workspace/projects", { cache: "no-store" });
    if (!response.ok) return; // signed-out/offline users keep the local cache
    const payload = await response.json() as { projects?: Array<{ id: string; project: Project; revision: number }> };
    const db = await getDB();
    for (const summary of payload.projects ?? []) {
      cloudRevisions.set(summary.id, summary.revision);
      const local = await db.get(PROJECTS_STORE, summary.id);
      const remoteUpdated = Number(summary.project?.updatedAt ?? 0);
      if (local && local.updatedAt > remoteUpdated) {
        scheduleCloudUpload(summary.id);
        continue;
      }
      const detailResponse = await fetch(`/api/workspace/projects/${encodeURIComponent(summary.id)}`, { cache: "no-store" });
      if (!detailResponse.ok) continue;
      const detail = await detailResponse.json() as {
        project: Project;
        contents: Record<string, string>;
        revision: number;
      };
      await db.put(PROJECTS_STORE, detail.project);
      const tx = db.transaction(CONTENTS_STORE, "readwrite");
      const now = Date.now();
      for (const [path, content] of Object.entries(detail.contents ?? {})) {
        await tx.store.put({ key: contentKey(summary.id, path), content, updatedAt: now });
      }
      await tx.done;
      cloudRevisions.set(summary.id, detail.revision);
    }
  } catch {
    // Offline-first: cloud failure never prevents IndexedDB access.
  }
}

function scheduleCloudUpload(projectId: string) {
  if (!cloudSyncEnabled()) return;
  const previous = cloudTimers.get(projectId);
  if (previous) clearTimeout(previous);
  cloudTimers.set(projectId, setTimeout(() => {
    cloudTimers.delete(projectId);
    void uploadCloudProject(projectId);
  }, 900));
}

async function uploadCloudProject(projectId: string): Promise<void> {
  try {
    const db = await getDB();
    const project = await db.get(PROJECTS_STORE, projectId);
    if (!project) return;
    const contents: Record<string, string> = {};
    const tx = db.transaction(CONTENTS_STORE, "readonly");
    for (const file of project.files) {
      const row = await tx.store.get(contentKey(projectId, file.path));
      if (row) contents[file.path] = row.content;
    }
    await tx.done;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const revision = cloudRevisions.get(projectId);
    if (revision) headers["If-Match"] = String(revision);
    const response = await fetch(`/api/workspace/projects/${encodeURIComponent(projectId)}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ project, contents }),
    });
    if (response.ok) {
      const saved = await response.json() as { revision: number };
      cloudRevisions.set(projectId, saved.revision);
    } else if (response.status === 409) {
      // Pull the newer snapshot on the next list refresh instead of silently
      // overwriting edits made in another tab/device.
      cloudRevisions.delete(projectId);
      announceProjectChange();
    }
  } catch {
    // Local data remains durable; a later mutation/load retries upload.
  }
}

// ---- Version snapshots ---------------------------------------------------

export async function listVersions(projectId: string): Promise<ProjectVersion[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex(VERSIONS_STORE, "by-project", projectId);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveVersion(version: ProjectVersion): Promise<void> {
  const db = await getDB();
  await db.put(VERSIONS_STORE, version);
}

export async function getVersion(versionId: string): Promise<ProjectVersion | undefined> {
  const db = await getDB();
  return db.get(VERSIONS_STORE, versionId);
}

export async function deleteVersion(versionId: string): Promise<void> {
  const db = await getDB();
  await db.delete(VERSIONS_STORE, versionId);
}

/**
 * Trim a project's version history to at most `maxVersions` entries.
 * Drops the OLDEST versions first (sorted by createdAt ascending).
 * Never throws — trimming is best-effort.
 *
 * Called after every snapshot creation (history dialog save, visual
 * editor snapshot, agent write_file snapshot) to enforce the
 * Settings → DevWorkspace → Projects → maxLocalHistory retention policy.
 *
 * Safety: this ONLY deletes version snapshots, never project data or
 * file contents. Lowering the setting does NOT immediately delete
 * existing versions — trimming only happens on the NEXT save.
 */
export async function trimProjectHistory(projectId: string, maxVersions: number): Promise<void> {
  if (maxVersions < 0) return;
  try {
    const versions = await listVersions(projectId);
    if (versions.length <= maxVersions) return;
    // versions is sorted newest-first (from listVersions). Drop the
    // oldest (tail) until we're at or below the limit.
    const toDelete = versions.slice(maxVersions);
    const db = await getDB();
    const tx = db.transaction(VERSIONS_STORE, "readwrite");
    await Promise.all(toDelete.map((v) => tx.store.delete(v.id)));
    await tx.done;
  } catch {
    // Non-fatal — trim failure should not block the save.
  }
}

/** Estimated storage usage in bytes. */
export async function estimateStorage(): Promise<{ usage: number; quota: number }> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return { usage: 0, quota: 0 };
  }
  const est = await navigator.storage.estimate();
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
}

/**
 * Ask the browser to persist local storage so the user's projects survive
 * automatic eviction by the browser's LRU cleanup. Truthful: returns
 * `true` only when the browser actually grants persistence.
 *
 * Returns `{ supported: false }` when the API is unavailable.
 */
export async function requestPersistentStorage(): Promise<{
  supported: boolean;
  persisted: boolean;
}> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return { supported: false, persisted: false };
  }
  const persisted = await navigator.storage.persist();
  return { supported: true, persisted };
}

/** Check whether storage is already persistent. */
export async function isStoragePersistent(): Promise<{
  supported: boolean;
  persisted: boolean;
}> {
  if (typeof navigator === "undefined" || !navigator.storage?.persisted) {
    return { supported: false, persisted: false };
  }
  const persisted = await navigator.storage.persisted();
  return { supported: true, persisted };
}
