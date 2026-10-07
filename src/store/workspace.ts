"use client";

// DevWorkspace global state.
//
// We keep this in Zustand rather than React Context so deeply nested
// components (file tree, editor tabs, preview iframe, history panel) can
// subscribe to slices without prop drilling.
//
// NOTE: the original DevWorkspace had its own theme + accent state in this
// store. LUCIAN already provides a global theme system via ThemeProvider
// (useTheme), so the DevWorkspace reuses that. There is NO theme state here.

import { create } from "zustand";
import type {
  AppView,
  EnvVar,
  FileEntry,
  MockLogEntry,
  OpenTab,
  PreviewMode,
  Project,
  ProjectFile,
  ResponsiveDevice,
  ScanResult,
} from "@/types/workspace";
import {
  deleteProject as dbDeleteProject,
  commitProjectMutation,
  deleteFileContent,
  estimateStorage,
  getFileContent,
  getManyFileContents,
  getProject,
  listProjects,
  listTrashedProjects,
  renameFileContent,
  saveProject,
  setFileContent,
} from "@/lib/workspace/db";
import {
  buildProjectFromImport,
  createEmptyProject,
  newId,
} from "@/lib/workspace/project";
import { detectFramework } from "@/lib/workspace/filesystem";
import { scanProject } from "@/lib/workspace/project-scanner";
import { createRecoverySnapshot } from "@/lib/workspace/recovery";
import { useSettingsStore } from "@/store/settings";
import {
  createDirectoryInLinkedFolder,
  removePathFromLinkedFolder,
  syncFileToLinkedFolder,
} from "@/lib/workspace/local-folder";

export interface FileOperationResult {
  ok: true;
  databaseSaved: true;
  runtimeSynced: boolean | null;
  folderSynced: boolean | null;
  warnings: string[];
}

export interface ReplaceAllResult extends FileOperationResult {
  filesChanged: number;
  replacements: number;
}

export interface WorkspaceOperationStatus {
  kind: "saving" | "saved" | "warning" | "error";
  message: string;
  path?: string;
  at: number;
}

interface WorkspaceState {
  // --- Navigation ---
  view: AppView;
  setView: (v: AppView) => void;

  // --- Projects ---
  projects: Project[];
  activeProjectId: string | null;
  activeProject: Project | null;
  loadingProjects: boolean;
  refreshProjects: () => Promise<void>;
  createProject: (name: string, description?: string) => Promise<Project>;
  importProject: (name: string, importResult: {
    entries: FileEntry[];
    contents: { path: string; content: string }[];
    skippedDirs: string[];
  }) => Promise<Project>;
  openProject: (id: string) => Promise<void>;
  closeProject: () => void;
  renameProject: (id: string, name: string) => Promise<void>;
  /**
   * Soft-delete: move a project to the Recycle Bin. The project record and
   * all its file contents stay in IndexedDB; only `trashedAt` is set.
   */
  removeProject: (id: string) => Promise<void>;
  /** Restore a project from the Recycle Bin. */
  restoreProject: (id: string) => Promise<void>;
  /**
   * Permanently delete a project AND every file + version row that belongs
   * to it. Cannot be undone.
   */
  permanentlyDeleteProject: (id: string) => Promise<void>;
  /** Empty the Recycle Bin (permanently delete every trashed project). */
  emptyRecycleBin: () => Promise<void>;
  /** Trashed projects list (kept on the store so the Storage Manager can render). */
  trashedProjects: Project[];
  refreshTrashedProjects: () => Promise<void>;
  updateProjectEntries: (id: string, files: FileEntry[]) => Promise<void>;
  updateProjectEnv: (id: string, envVars: EnvVar[]) => Promise<void>;
  persistActive: () => Promise<void>;

  // --- File content (lazy) ---
  /** In-memory cache of file contents for the active project. */
  contentCache: Map<string, string>;
  /** Paths currently being loaded from IndexedDB. */
  loadingPaths: Set<string>;
  loadFileContent: (projectId: string, path: string) => Promise<string | undefined>;
  /** Pre-load all file contents (used before history save / download / preview). */
  loadAllFileContents: (projectId: string) => Promise<Map<string, string>>;
  /** Get a ProjectFile[] (entries + content) for the active project. */
  getActiveProjectFiles: () => Promise<ProjectFile[]>;
  /** Clear the content cache (e.g. when switching projects). */
  clearContentCache: () => void;

  // --- File operations ---
  writeFile: (path: string, content: string) => Promise<FileOperationResult>;
  writeFileBinary: (
    path: string,
    dataUrl: string,
    mime: string,
  ) => Promise<FileOperationResult>;
  deleteFile: (path: string) => Promise<FileOperationResult>;
  renameFile: (oldPath: string, newPath: string) => Promise<FileOperationResult>;
  createFile: (path: string, content?: string) => Promise<FileOperationResult>;
  createFolder: (path: string) => Promise<FileOperationResult>;
  deletePath: (path: string) => Promise<FileOperationResult>;
  movePath: (oldPath: string, newPath: string) => Promise<FileOperationResult>;
  replaceAllText: (
    query: string,
    replacement: string,
    caseSensitive?: boolean,
  ) => Promise<ReplaceAllResult>;
  createSnapshot: (label: string) => Promise<void>;
  lastFileOperation: WorkspaceOperationStatus | null;
  clearFileOperation: () => void;

  // --- Editor tabs ---
  openTabs: OpenTab[];
  activeTab: string | null;
  /** Unsaved Monaco buffers, preserved while switching tabs/workbench views. */
  editorDrafts: Map<string, string>;
  openTab: (path: string) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  setTabEditing: (path: string, editing: boolean) => void;
  markTabDirty: (path: string, dirty: boolean) => void;
  setEditorDraft: (path: string, content: string) => void;
  clearEditorDraft: (path: string) => void;

  // --- Preview state ---
  previewMode: PreviewMode;
  setPreviewMode: (m: PreviewMode) => void;
  device: ResponsiveDevice;
  setDevice: (d: ResponsiveDevice) => void;
  previewKey: number;
  refreshPreview: () => void;
  /** Last preview diagnostic (error message + source). */
  previewDiagnostic: { message: string; source?: string } | null;
  setPreviewDiagnostic: (d: { message: string; source?: string } | null) => void;

  // --- Mock log (API mocking layer) ---
  /** Live log of network calls intercepted by the mock layer. */
  mockLog: MockLogEntry[];
  setMockLog: (log: MockLogEntry[]) => void;
  clearMockLog: () => void;

  // --- Project scanning ---
  /** Re-scan the active project for required services/env vars. */
  rescanActiveProject: () => Promise<void>;
}

function normalizeProjectPath(value: string): string {
  const path = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const parts = path.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === ".." || part.includes("\0"))) {
    throw new Error("Enter a safe path inside the project.");
  }
  return parts.join("/");
}

function impliedDirectories(paths: string[]): string[] {
  const directories = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  }
  return [...directories].sort();
}

function nextProjectState(project: Project, files: FileEntry[], directories?: string[]): Project {
  const explicit = new Set((directories ?? project.directories ?? []).map(normalizeProjectPath));
  return {
    ...project,
    files,
    directories: [...explicit].sort(),
    fileCount: files.length,
    totalSize: files.reduce((sum, file) => sum + (file.size ?? 0), 0),
    framework: detectFramework(files),
  };
}

function completedResult(
  runtime: { attempted: boolean; ok: boolean; error?: string },
  folder: { attempted: boolean; ok: boolean; error?: string },
): FileOperationResult {
  const warnings: string[] = [];
  if (!runtime.ok && runtime.error) warnings.push(`Runtime sync: ${runtime.error}`);
  if (!folder.ok && folder.error) warnings.push(`Folder sync: ${folder.error}`);
  return {
    ok: true,
    databaseSaved: true,
    runtimeSynced: runtime.attempted ? runtime.ok : null,
    folderSynced: folder.attempted ? folder.ok : null,
    warnings,
  };
}

function mergeSyncResult(
  current: { attempted: boolean; ok: boolean; error?: string },
  next: { attempted: boolean; ok: boolean; error?: string },
): { attempted: boolean; ok: boolean; error?: string } {
  const errors = [current.error, next.error].filter(Boolean);
  return {
    attempted: current.attempted || next.attempted,
    ok: current.ok && next.ok,
    error: errors.length ? errors.join("; ") : undefined,
  };
}

function operationStatus(
  result: FileOperationResult,
  successMessage: string,
  path?: string,
): WorkspaceOperationStatus {
  return {
    kind: result.warnings.length ? "warning" : "saved",
    message: result.warnings.length ? `${successMessage}. ${result.warnings.join(" ")}` : successMessage,
    path,
    at: Date.now(),
  };
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  view: "library",
  setView: (v) => set({ view: v }),

  // --- Projects ---
  projects: [],
  activeProjectId: null,
  activeProject: null,
  loadingProjects: true,

  refreshProjects: async () => {
    set({ loadingProjects: true });
    try {
      const projects = await listProjects();
      set({ projects, loadingProjects: false });
    } catch (err) {
      console.error("Failed to list projects:", err);
      set({ loadingProjects: false });
    }
  },

  createProject: async (name, description = "") => {
    const project = createEmptyProject(name, description);
    await saveProject(project);
    set((s) => ({ projects: [project, ...s.projects] }));
    return project;
  },

  importProject: async (name, importResult) => {
    const project = await buildProjectFromImport(name, importResult);
    // Scan the project for required services / env vars so we can show the
    // "what's needed to go live" checklist immediately on the library card.
    try {
      const files: ProjectFile[] = importResult.entries.map((entry, i) => ({
        ...entry,
        content: importResult.contents[i]?.content ?? "",
      }));
      project.scanResult = scanProject(files, project.envVars);
    } catch (err) {
      console.error("Project scan failed:", err);
    }
    await saveProject(project);
    set((s) => ({ projects: [project, ...s.projects] }));
    return project;
  },

  openProject: async (id) => {
    const project = await getProject(id);
    if (!project) return;
    set({
      activeProject: project,
      activeProjectId: id,
      view: "workspace",
      openTabs: [],
      activeTab: null,
      editorDrafts: new Map(),
      contentCache: new Map(),
      loadingPaths: new Set(),
      mockLog: [],
      previewDiagnostic: null,
    });
  },

  closeProject: () => {
    set({
      activeProject: null,
      activeProjectId: null,
      openTabs: [],
      activeTab: null,
      editorDrafts: new Map(),
      contentCache: new Map(),
    });
  },

  renameProject: async (id, name) => {
    const project = await getProject(id);
    if (!project) return;
    project.name = name;
    await saveProject(project);
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...project } : p)),
      activeProject: s.activeProjectId === id ? { ...project } : s.activeProject,
    }));
  },

  removeProject: async (id) => {
    // Soft-delete: mark trashedAt, keep the row + file contents so the
    // user can restore from the Recycle Bin later.
    const project = await getProject(id);
    if (!project) return;
    project.trashedAt = Date.now();
    await saveProject(project);
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      trashedProjects: [project, ...s.trashedProjects],
      activeProject: s.activeProjectId === id ? null : s.activeProject,
      activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
    }));
  },

  restoreProject: async (id) => {
    const project = await getProject(id);
    if (!project) return;
    project.trashedAt = null;
    await saveProject(project);
    set((s) => ({
      projects: [project, ...s.projects],
      trashedProjects: s.trashedProjects.filter((p) => p.id !== id),
    }));
  },

  permanentlyDeleteProject: async (id) => {
    await dbDeleteProject(id);
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      trashedProjects: s.trashedProjects.filter((p) => p.id !== id),
      activeProject: s.activeProjectId === id ? null : s.activeProject,
      activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
    }));
  },

  emptyRecycleBin: async () => {
    const { trashedProjects } = get();
    for (const p of trashedProjects) {
      await dbDeleteProject(p.id);
    }
    set({ trashedProjects: [] });
  },

  // --- Trashed projects list ---
  trashedProjects: [],
  refreshTrashedProjects: async () => {
    try {
      const list = await listTrashedProjects();
      set({ trashedProjects: list });
    } catch (err) {
      console.error("Failed to list trashed projects:", err);
    }
  },

  updateProjectEntries: async (id, files) => {
    const project = await getProject(id);
    if (!project) return;
    project.files = files;
    project.fileCount = files.length;
    project.totalSize = files.reduce((sum, f) => sum + (f.size ?? 0), 0);
    project.framework = detectFramework(files);
    await saveProject(project);
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...project } : p)),
      activeProject: s.activeProjectId === id ? { ...project } : s.activeProject,
    }));
  },

  updateProjectEnv: async (id, envVars) => {
    const project = await getProject(id);
    if (!project) return;
    project.envVars = envVars;
    // Re-scan so the "what's needed to go live" checklist reflects the
    // newly configured env vars.
    if (project.scanResult) {
      try {
        // Update env var "configured" flags without a full re-scan.
        project.scanResult = {
          ...project.scanResult,
          envVars: project.scanResult.envVars.map((e) => ({
            ...e,
            configured: envVars.some((v) => v.key === e.key),
          })),
          services: project.scanResult.services.map((s) => ({
            ...s,
            configured: s.requiredEnvVars.some((key) =>
              envVars.some((v) => v.key === key),
            ),
          })),
        };
      } catch (err) {
        console.error("Re-scan after env update failed:", err);
      }
    }
    await saveProject(project);
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...project } : p)),
      activeProject: s.activeProjectId === id ? { ...project } : s.activeProject,
    }));
    if (get().activeProjectId === id && useSettingsStore.getState().devWorkspace.preview.autoRefresh) {
      get().refreshPreview();
    }
  },

  persistActive: async () => {
    const { activeProject } = get();
    if (!activeProject) return;
    await saveProject(activeProject);
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === activeProject.id ? { ...activeProject } : p,
      ),
    }));
  },

  // --- File content (lazy) ---
  contentCache: new Map(),
  loadingPaths: new Set(),

  loadFileContent: async (projectId, path) => {
    const state = get();
    // Check cache first.
    const cached = state.contentCache.get(path);
    if (cached !== undefined) return cached;
    if (state.loadingPaths.has(path)) {
      // Wait for in-flight load to complete, then re-check.
      while (get().loadingPaths.has(path)) {
        await new Promise((r) => setTimeout(r, 20));
      }
      return get().contentCache.get(path);
    }
    set((s) => {
      const next = new Set(s.loadingPaths);
      next.add(path);
      return { loadingPaths: next };
    });
    try {
      const content = await getFileContent(projectId, path);
      if (content !== undefined) {
        set((s) => {
          const next = new Map(s.contentCache);
          next.set(path, content);
          return { contentCache: next };
        });
      }
      return content;
    } finally {
      set((s) => {
        const next = new Set(s.loadingPaths);
        next.delete(path);
        return { loadingPaths: next };
      });
    }
  },

  loadAllFileContents: async (projectId) => {
    const state = get();
    const project = state.activeProjectId === projectId
      ? state.activeProject
      : await getProject(projectId);
    if (!project) return new Map();
    // Load only cache misses. Previous behavior re-read every project file
    // from IndexedDB on every preview refresh even though saves already keep
    // the cache current. Binary contents use the same store and cache.
    const paths = project.files.map((f) => f.path);
    const cache = get().contentCache;
    const missingPaths = paths.filter((path) => !cache.has(path));
    const loaded = missingPaths.length > 0
      ? await getManyFileContents(projectId, missingPaths)
      : new Map<string, string>();
    const allContents = new Map<string, string>();
    for (const path of paths) {
      const content = loaded.get(path) ?? cache.get(path);
      if (content !== undefined) allContents.set(path, content);
    }
    // Merge into the cache.
    set((s) => {
      const next = new Map(s.contentCache);
      for (const [path, content] of loaded) next.set(path, content);
      return { contentCache: next };
    });
    return allContents;
  },

  getActiveProjectFiles: async () => {
    const { activeProject, loadAllFileContents } = get();
    if (!activeProject) return [];
    // Make sure all contents are loaded (text + binary).
    await loadAllFileContents(activeProject.id);
    const cache = get().contentCache;
    return activeProject.files.map((f) => ({
      ...f,
      content: cache.get(f.path) ?? "",
    }));
  },

  clearContentCache: () => set({ contentCache: new Map() }),

  // --- File operations ---
  lastFileOperation: null,
  clearFileOperation: () => set({ lastFileOperation: null }),

  writeFile: async (path, content) => {
    const { activeProject, activeProjectId } = get();
    if (!activeProject || !activeProjectId) throw new Error("No project is open.");
    const safePath = normalizeProjectPath(path);
    const existing = activeProject.files.find((file) => file.path === safePath);
    if (existing?.binary) throw new Error("Binary files cannot be edited as text.");
    const knownDirectories = new Set([
      ...(activeProject.directories ?? []),
      ...impliedDirectories(activeProject.files.map((file) => file.path)),
    ]);
    if (!existing && knownDirectories.has(safePath)) {
      throw new Error(`A folder already exists at ${safePath}.`);
    }
    set({ lastFileOperation: { kind: "saving", message: "Saving to project database…", path: safePath, at: Date.now() } });
    try {
      const entry: FileEntry = {
        path: safePath,
        binary: false,
        size: new TextEncoder().encode(content).length,
        updatedAt: Date.now(),
        loaded: true,
      };
      const files = existing
        ? activeProject.files.map((file) => file.path === safePath ? entry : file)
        : [...activeProject.files, entry];
      const directories = [...new Set([
        ...(activeProject.directories ?? []),
        ...impliedDirectories([safePath]),
      ])];
      const project = await commitProjectMutation(
        nextProjectState(activeProject, files, directories),
        [{ type: "put", path: safePath, content }],
      );
      set((state) => {
        const cache = new Map(state.contentCache);
        cache.set(safePath, content);
        const drafts = new Map(state.editorDrafts);
        drafts.delete(safePath);
        return {
          contentCache: cache,
          editorDrafts: drafts,
          activeProject: project,
          projects: state.projects.map((item) => item.id === project.id ? project : item),
        };
      });

      const { syncFile, runtimeProjectId } = await import("@/lib/workspace/webcontainer");
      const runtime = runtimeProjectId() === activeProjectId
        ? await syncFile(safePath, content)
        : { attempted: false, ok: true };
      const folder = await syncFileToLinkedFolder(activeProjectId, safePath, content);
      const result = completedResult(runtime, folder);
      set({ lastFileOperation: operationStatus(result, "Saved", safePath) });
      if (useSettingsStore.getState().devWorkspace.preview.autoRefresh) get().refreshPreview();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ lastFileOperation: { kind: "error", message: `Save failed. Previous version restored: ${message}`, path: safePath, at: Date.now() } });
      throw error;
    }
  },

  writeFileBinary: async (path, dataUrl, mime) => {
    const { activeProject, activeProjectId } = get();
    if (!activeProject || !activeProjectId) throw new Error("No project is open.");
    const safePath = normalizeProjectPath(path);
    set({ lastFileOperation: { kind: "saving", message: "Saving binary asset…", path: safePath, at: Date.now() } });
    try {
    const files = [...activeProject.files];
    const idx = files.findIndex((f) => f.path === safePath);
    // Estimate size from base64 length.
    const base64 = dataUrl.split(",")[1] ?? "";
    const size = Math.floor((base64.length * 3) / 4);
    const newEntry: FileEntry = {
      path: safePath,
      binary: true,
      mime,
      size,
      updatedAt: Date.now(),
      loaded: true,
    };
    if (idx >= 0) files[idx] = newEntry;
    else files.push(newEntry);
      const project = await commitProjectMutation(
        nextProjectState(activeProject, files, [
          ...(activeProject.directories ?? []),
          ...impliedDirectories([safePath]),
        ]),
        [{ type: "put", path: safePath, content: dataUrl }],
      );
      set((state) => {
        const cache = new Map(state.contentCache);
        cache.set(safePath, dataUrl);
        return {
          contentCache: cache,
          activeProject: project,
          projects: state.projects.map((item) => item.id === project.id ? project : item),
        };
      });
      const { syncFile, runtimeProjectId } = await import("@/lib/workspace/webcontainer");
      const runtime = runtimeProjectId() === activeProjectId
        ? await syncFile(safePath, dataUrl, true)
        : { attempted: false, ok: true };
      const folder = await syncFileToLinkedFolder(activeProjectId, safePath, dataUrl, true);
      const result = completedResult(runtime, folder);
      set({ lastFileOperation: operationStatus(result, "Binary asset saved", safePath) });
      if (useSettingsStore.getState().devWorkspace.preview.autoRefresh) get().refreshPreview();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ lastFileOperation: { kind: "error", message: `Asset save failed. Previous version restored: ${message}`, path: safePath, at: Date.now() } });
      throw error;
    }
  },

  deleteFile: async (path) => {
    return get().deletePath(path);
  },

  renameFile: async (oldPath, newPath) => {
    return get().movePath(oldPath, newPath);
  },

  createFile: async (path, content = "") => {
    const result = await get().writeFile(path, content);
    get().openTab(normalizeProjectPath(path));
    return result;
  },

  createFolder: async (path) => {
    const { activeProject, activeProjectId } = get();
    if (!activeProject || !activeProjectId) throw new Error("No project is open.");
    const safePath = normalizeProjectPath(path);
    const knownDirectories = new Set([
      ...(activeProject.directories ?? []),
      ...impliedDirectories(activeProject.files.map((file) => file.path)),
    ]);
    if (knownDirectories.has(safePath) || activeProject.files.some((file) => file.path === safePath)) {
      throw new Error(`A file or folder already exists at ${safePath}.`);
    }
    try {
      const project = await commitProjectMutation(
        nextProjectState(activeProject, activeProject.files, [
          ...(activeProject.directories ?? []),
          ...impliedDirectories([`${safePath}/placeholder`]),
        ]),
        [],
      );
      set((state) => ({
        activeProject: project,
        projects: state.projects.map((item) => item.id === project.id ? project : item),
      }));
      const { createDirectory, runtimeProjectId } = await import("@/lib/workspace/webcontainer");
      const runtime = runtimeProjectId() === activeProjectId
        ? await createDirectory(safePath)
        : { attempted: false, ok: true };
      const folder = await createDirectoryInLinkedFolder(activeProjectId, safePath);
      const result = completedResult(runtime, folder);
      set({ lastFileOperation: operationStatus(result, "Folder created", safePath) });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ lastFileOperation: { kind: "error", message: `Folder creation failed: ${message}`, path: safePath, at: Date.now() } });
      throw error;
    }
  },

  createSnapshot: async (label) => {
    const { activeProject, previewMode } = get();
    if (!activeProject) throw new Error("No project is open.");
    await createRecoverySnapshot(
      activeProject,
      label,
      previewMode,
      useSettingsStore.getState().devWorkspace.projects.maxLocalHistory,
    );
  },

  deletePath: async (path) => {
    const { activeProject, activeProjectId, previewMode } = get();
    if (!activeProject || !activeProjectId) throw new Error("No project is open.");
    const safePath = normalizeProjectPath(path);
    const affects = (candidate: string) => candidate === safePath || candidate.startsWith(`${safePath}/`);
    const removedFiles = activeProject.files.filter((file) => affects(file.path));
    const directoryExists = (activeProject.directories ?? []).some(affects)
      || impliedDirectories(activeProject.files.map((file) => file.path)).some((directory) => directory === safePath);
    if (!removedFiles.length && !directoryExists) throw new Error(`${safePath} does not exist.`);
    set({ lastFileOperation: { kind: "saving", message: "Creating recovery snapshot…", path: safePath, at: Date.now() } });
    try {
      await createRecoverySnapshot(
        activeProject,
        `Before deleting ${safePath}`,
        previewMode,
        useSettingsStore.getState().devWorkspace.projects.maxLocalHistory,
      );
      const project = await commitProjectMutation(
        nextProjectState(
          activeProject,
          activeProject.files.filter((file) => !affects(file.path)),
          (activeProject.directories ?? []).filter((directory) => !affects(directory)),
        ),
        removedFiles.map((file) => ({ type: "delete" as const, path: file.path })),
      );
      set((state) => {
        const cache = new Map(state.contentCache);
        for (const file of removedFiles) cache.delete(file.path);
        const drafts = new Map(state.editorDrafts);
        for (const file of removedFiles) drafts.delete(file.path);
        const openTabs = state.openTabs.filter((tab) => !affects(tab.path));
        return {
          contentCache: cache,
          editorDrafts: drafts,
          activeProject: project,
          projects: state.projects.map((item) => item.id === project.id ? project : item),
          openTabs,
          activeTab: state.activeTab && affects(state.activeTab) ? (openTabs.at(-1)?.path ?? null) : state.activeTab,
        };
      });
      const { removeFile, runtimeProjectId } = await import("@/lib/workspace/webcontainer");
      const runtime = runtimeProjectId() === activeProjectId
        ? await removeFile(safePath)
        : { attempted: false, ok: true };
      const folder = await removePathFromLinkedFolder(activeProjectId, safePath);
      const result = completedResult(runtime, folder);
      set({ lastFileOperation: operationStatus(result, "Deleted; recovery snapshot saved", safePath) });
      get().refreshPreview();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ lastFileOperation: { kind: "error", message: `Delete failed. Project was left unchanged: ${message}`, path: safePath, at: Date.now() } });
      throw error;
    }
  },

  movePath: async (oldPath, newPath) => {
    const { activeProject, activeProjectId, previewMode } = get();
    if (!activeProject || !activeProjectId) throw new Error("No project is open.");
    const oldSafe = normalizeProjectPath(oldPath);
    const newSafe = normalizeProjectPath(newPath);
    if (oldSafe === newSafe) return completedResult({ attempted: false, ok: true }, { attempted: false, ok: true });
    if (newSafe.startsWith(`${oldSafe}/`)) throw new Error("A folder cannot be moved inside itself.");
    const affects = (candidate: string) => candidate === oldSafe || candidate.startsWith(`${oldSafe}/`);
    const remap = (candidate: string) => candidate === oldSafe ? newSafe : `${newSafe}${candidate.slice(oldSafe.length)}`;
    const movedFiles = activeProject.files.filter((file) => affects(file.path));
    const explicitMoved = (activeProject.directories ?? []).filter(affects);
    if (!movedFiles.length && !explicitMoved.length) throw new Error(`${oldSafe} does not exist.`);
    const unaffectedPaths = new Set(activeProject.files.filter((file) => !affects(file.path)).map((file) => file.path));
    if (movedFiles.some((file) => unaffectedPaths.has(remap(file.path)))) {
      throw new Error(`The destination ${newSafe} conflicts with an existing file.`);
    }
    set({ lastFileOperation: { kind: "saving", message: "Creating recovery snapshot…", path: oldSafe, at: Date.now() } });
    try {
      await createRecoverySnapshot(
        activeProject,
        `Before moving ${oldSafe}`,
        previewMode,
        useSettingsStore.getState().devWorkspace.projects.maxLocalHistory,
      );
      const contents = await getManyFileContents(activeProjectId, movedFiles.map((file) => file.path));
      const moved = movedFiles.map((file) => ({
        oldPath: file.path,
        newPath: remap(file.path),
        content: contents.get(file.path) ?? "",
        binary: file.binary,
      }));
      const files = activeProject.files.map((file) => affects(file.path)
        ? { ...file, path: remap(file.path), updatedAt: Date.now() }
        : file);
      const directories = [
        ...(activeProject.directories ?? []).map((directory) => affects(directory) ? remap(directory) : directory),
        ...impliedDirectories(files.map((file) => file.path)),
      ];
      const project = await commitProjectMutation(
        nextProjectState(activeProject, files, directories),
        [
          ...moved.map((file) => ({ type: "delete" as const, path: file.oldPath })),
          ...moved.map((file) => ({ type: "put" as const, path: file.newPath, content: file.content })),
        ],
      );
      set((state) => {
        const cache = new Map(state.contentCache);
        const drafts = new Map(state.editorDrafts);
        for (const file of moved) {
          cache.delete(file.oldPath);
          cache.set(file.newPath, file.content);
          const draft = drafts.get(file.oldPath);
          if (draft !== undefined) {
            drafts.delete(file.oldPath);
            drafts.set(file.newPath, draft);
          }
        }
        return {
          contentCache: cache,
          editorDrafts: drafts,
          activeProject: project,
          projects: state.projects.map((item) => item.id === project.id ? project : item),
          openTabs: state.openTabs.map((tab) => affects(tab.path) ? { ...tab, path: remap(tab.path) } : tab),
          activeTab: state.activeTab && affects(state.activeTab) ? remap(state.activeTab) : state.activeTab,
        };
      });

      let runtime = { attempted: false, ok: true } as { attempted: boolean; ok: boolean; error?: string };
      const { syncFile, removeFile, runtimeProjectId } = await import("@/lib/workspace/webcontainer");
      if (runtimeProjectId() === activeProjectId) {
        for (const file of moved) runtime = mergeSyncResult(runtime, await syncFile(file.newPath, file.content, file.binary));
        runtime = mergeSyncResult(runtime, await removeFile(oldSafe));
      }
      let folder = { attempted: false, ok: true } as { attempted: boolean; ok: boolean; error?: string };
      for (const file of moved) {
        folder = mergeSyncResult(folder, await syncFileToLinkedFolder(activeProjectId, file.newPath, file.content, file.binary));
      }
      folder = mergeSyncResult(folder, await removePathFromLinkedFolder(activeProjectId, oldSafe));
      const result = completedResult(runtime, folder);
      set({ lastFileOperation: operationStatus(result, "Moved; recovery snapshot saved", newSafe) });
      get().refreshPreview();
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ lastFileOperation: { kind: "error", message: `Move failed. Project was left unchanged: ${message}`, path: oldSafe, at: Date.now() } });
      throw error;
    }
  },

  replaceAllText: async (query, replacement, caseSensitive = false) => {
    const { activeProject, activeProjectId, previewMode } = get();
    if (!activeProject || !activeProjectId) throw new Error("No project is open.");
    if (!query) throw new Error("Enter text to find.");
    if (get().openTabs.some((tab) => tab.dirty)) {
      throw new Error("Save or discard open unsaved files before using Replace All.");
    }
    set({ lastFileOperation: { kind: "saving", message: "Preparing project-wide replacement…", at: Date.now() } });
    try {
      const files = await get().getActiveProjectFiles();
      const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "g" : "gi");
      let replacements = 0;
      const changed = files.flatMap((file) => {
        if (file.binary) return [];
        const content = file.content.replace(expression, () => {
          replacements += 1;
          return replacement;
        });
        return content === file.content ? [] : [{ ...file, content }];
      });
      if (!changed.length) {
        const result = completedResult({ attempted: false, ok: true }, { attempted: false, ok: true });
        set({ lastFileOperation: operationStatus(result, "No matches found") });
        return { ...result, filesChanged: 0, replacements: 0 };
      }
      await createRecoverySnapshot(
        activeProject,
        `Before replacing “${query.slice(0, 40)}”`,
        previewMode,
        useSettingsStore.getState().devWorkspace.projects.maxLocalHistory,
      );
      const changedMap = new Map(changed.map((file) => [file.path, file]));
      const entries = activeProject.files.map((entry) => {
        const file = changedMap.get(entry.path);
        return file ? {
          ...entry,
          size: new TextEncoder().encode(file.content).length,
          updatedAt: Date.now(),
        } : entry;
      });
      const project = await commitProjectMutation(
        nextProjectState(activeProject, entries),
        changed.map((file) => ({ type: "put" as const, path: file.path, content: file.content })),
      );
      set((state) => {
        const cache = new Map(state.contentCache);
        for (const file of changed) cache.set(file.path, file.content);
        return {
          contentCache: cache,
          activeProject: project,
          projects: state.projects.map((item) => item.id === project.id ? project : item),
          openTabs: state.openTabs.map((tab) => changedMap.has(tab.path) ? { ...tab, dirty: false } : tab),
        };
      });
      let runtime = { attempted: false, ok: true } as { attempted: boolean; ok: boolean; error?: string };
      const { syncFile, runtimeProjectId } = await import("@/lib/workspace/webcontainer");
      if (runtimeProjectId() === activeProjectId) {
        for (const file of changed) runtime = mergeSyncResult(runtime, await syncFile(file.path, file.content));
      }
      let folder = { attempted: false, ok: true } as { attempted: boolean; ok: boolean; error?: string };
      for (const file of changed) {
        folder = mergeSyncResult(folder, await syncFileToLinkedFolder(activeProjectId, file.path, file.content));
      }
      const result = completedResult(runtime, folder);
      set({ lastFileOperation: operationStatus(result, `Replaced ${replacements} occurrence${replacements === 1 ? "" : "s"} in ${changed.length} file${changed.length === 1 ? "" : "s"}`) });
      get().refreshPreview();
      return { ...result, filesChanged: changed.length, replacements };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      set({ lastFileOperation: { kind: "error", message: `Replace failed. Project was left at the last complete transaction: ${message}`, at: Date.now() } });
      throw error;
    }
  },

  // --- Editor tabs ---
  openTabs: [],
  activeTab: null,
  editorDrafts: new Map(),
  openTab: (path) => {
    set((s) => {
      if (s.openTabs.some((t) => t.path === path)) {
        return { activeTab: path };
      }
      return {
        openTabs: [...s.openTabs, { path, dirty: false, editing: false }],
        activeTab: path,
      };
    });
  },
  closeTab: (path) => {
    set((s) => {
      const idx = s.openTabs.findIndex((t) => t.path === path);
      const newTabs = s.openTabs.filter((t) => t.path !== path);
      const editorDrafts = new Map(s.editorDrafts);
      editorDrafts.delete(path);
      let newActive = s.activeTab;
      if (s.activeTab === path) {
        newActive = newTabs[Math.min(idx, newTabs.length - 1)]?.path ?? null;
      }
      return { openTabs: newTabs, activeTab: newActive, editorDrafts };
    });
  },
  setActiveTab: (path) => set({ activeTab: path }),
  setTabEditing: (path, editing) =>
    set((s) => ({
      openTabs: s.openTabs.map((t) =>
        t.path === path ? { ...t, editing, dirty: editing ? t.dirty : false } : t,
      ),
    })),
  markTabDirty: (path, dirty) =>
    set((s) => ({
      openTabs: s.openTabs.map((t) => (t.path === path ? { ...t, dirty } : t)),
    })),
  setEditorDraft: (path, content) =>
    set((state) => {
      const drafts = new Map(state.editorDrafts);
      drafts.set(path, content);
      return { editorDrafts: drafts };
    }),
  clearEditorDraft: (path) =>
    set((state) => {
      const drafts = new Map(state.editorDrafts);
      drafts.delete(path);
      return { editorDrafts: drafts };
    }),

  // --- Preview state ---
  previewMode: "demo",
  setPreviewMode: (m) => set({ previewMode: m }),
  device: "desktop",
  setDevice: (d) => set({ device: d }),
  previewKey: 0,
  refreshPreview: () => set((s) => ({ previewKey: s.previewKey + 1 })),
  previewDiagnostic: null,
  setPreviewDiagnostic: (d) => set({ previewDiagnostic: d }),

  // --- Mock log ---
  mockLog: [],
  setMockLog: (log) => set({ mockLog: log }),
  clearMockLog: () => set({ mockLog: [] }),

  // --- Project scanning ---
  rescanActiveProject: async () => {
    const { activeProject, getActiveProjectFiles, persistActive } = get();
    if (!activeProject) return;
    const files = await getActiveProjectFiles();
    const scanResult = scanProject(files, activeProject.envVars);
    activeProject.scanResult = scanResult;
    await persistActive();
  },
}));

/** Generate a fresh version id. */
export function generateVersionId(): string {
  return newId("ver");
}

/** Re-export estimateStorage so callers can read browser storage state. */
export { estimateStorage };
