"use client";

import { openDB, type DBSchema } from "idb";
import type { ProjectFile } from "@/types/workspace";
import { base64ToBytes } from "./filesystem";

type FolderPermission = "granted" | "denied" | "prompt";

interface WritableFileHandle {
  createWritable(): Promise<{
    write(data: string | Blob | Uint8Array): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
  }>;
}

interface WritableDirectoryHandle {
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<WritableDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<WritableFileHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  queryPermission?(options?: { mode: "readwrite" }): Promise<FolderPermission>;
  requestPermission?(options?: { mode: "readwrite" }): Promise<FolderPermission>;
}

interface FolderHandleDB extends DBSchema {
  handles: {
    key: string;
    value: { projectId: string; handle: unknown };
  };
}

export interface LinkedFolderStatus {
  supported: boolean;
  connected: boolean;
  permission: FolderPermission | "unsupported";
  name?: string;
}

export interface FolderSyncResult {
  attempted: boolean;
  ok: boolean;
  error?: string;
}

const HANDLE_DB = "lucian-workspace-folder-handles-v1";

function handleDB() {
  return openDB<FolderHandleDB>(HANDLE_DB, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("handles")) {
        db.createObjectStore("handles", { keyPath: "projectId" });
      }
    },
  });
}

function directoryPicker(): ((options: { mode: "readwrite" }) => Promise<WritableDirectoryHandle>) | null {
  if (typeof window === "undefined") return null;
  const picker = (window as unknown as {
    showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<WritableDirectoryHandle>;
  }).showDirectoryPicker;
  return picker?.bind(window) ?? null;
}

async function storedHandle(projectId: string): Promise<WritableDirectoryHandle | null> {
  const db = await handleDB();
  const row = await db.get("handles", projectId);
  return (row?.handle as WritableDirectoryHandle | undefined) ?? null;
}

async function permission(handle: WritableDirectoryHandle): Promise<FolderPermission> {
  if (!handle.queryPermission) return "granted";
  return handle.queryPermission({ mode: "readwrite" });
}

function pathParts(path: string): string[] {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === ".." || part.includes("\0"))) {
    throw new Error(`Unsafe project path: ${path}`);
  }
  return parts;
}

async function parentDirectory(
  root: WritableDirectoryHandle,
  parts: string[],
  create: boolean,
): Promise<WritableDirectoryHandle> {
  let directory = root;
  for (const part of parts.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(part, { create });
  }
  return directory;
}

async function writableHandle(projectId: string): Promise<{
  handle: WritableDirectoryHandle | null;
  result: FolderSyncResult;
}> {
  const handle = await storedHandle(projectId);
  if (!handle) return { handle: null, result: { attempted: false, ok: true } };
  const currentPermission = await permission(handle);
  if (currentPermission !== "granted") {
    return {
      handle: null,
      result: {
        attempted: true,
        ok: false,
        error: "Linked folder permission is required again. Use the folder button to grant access.",
      },
    };
  }
  return { handle, result: { attempted: true, ok: true } };
}

async function writeToHandle(
  root: WritableDirectoryHandle,
  path: string,
  content: string,
  binary: boolean,
): Promise<void> {
  const parts = pathParts(path);
  const parent = await parentDirectory(root, parts, true);
  const file = await parent.getFileHandle(parts.at(-1)!, { create: true });
  const stream = await file.createWritable();
  try {
    if (binary) {
      const base64 = content.split(",")[1] ?? "";
      await stream.write(base64ToBytes(base64));
    } else {
      await stream.write(content);
    }
    await stream.close();
  } catch (error) {
    await stream.abort?.().catch(() => undefined);
    throw error;
  }
}

export function isLocalFolderSupported(): boolean {
  return directoryPicker() !== null;
}

export async function getLinkedFolderStatus(projectId: string): Promise<LinkedFolderStatus> {
  if (!isLocalFolderSupported()) {
    return { supported: false, connected: false, permission: "unsupported" };
  }
  const handle = await storedHandle(projectId);
  if (!handle) return { supported: true, connected: false, permission: "prompt" };
  return {
    supported: true,
    connected: true,
    permission: await permission(handle),
    name: handle.name,
  };
}

export async function connectLocalFolder(projectId: string): Promise<LinkedFolderStatus> {
  const picker = directoryPicker();
  if (!picker) throw new Error("Folder write access requires Chrome or Edge.");
  const handle = await picker({ mode: "readwrite" });
  const db = await handleDB();
  await db.put("handles", { projectId, handle });
  return getLinkedFolderStatus(projectId);
}

export async function requestLinkedFolderPermission(projectId: string): Promise<LinkedFolderStatus> {
  const handle = await storedHandle(projectId);
  if (!handle) throw new Error("No folder is linked to this project.");
  if (handle.requestPermission) await handle.requestPermission({ mode: "readwrite" });
  return getLinkedFolderStatus(projectId);
}

export async function disconnectLocalFolder(projectId: string): Promise<void> {
  const db = await handleDB();
  await db.delete("handles", projectId);
}

export async function syncFileToLinkedFolder(
  projectId: string,
  path: string,
  content: string,
  binary = false,
): Promise<FolderSyncResult> {
  try {
    const access = await writableHandle(projectId);
    if (!access.handle) return access.result;
    await writeToHandle(access.handle, path, content, binary);
    return { attempted: true, ok: true };
  } catch (error) {
    return { attempted: true, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function createDirectoryInLinkedFolder(
  projectId: string,
  path: string,
): Promise<FolderSyncResult> {
  try {
    const access = await writableHandle(projectId);
    if (!access.handle) return access.result;
    let directory = access.handle;
    for (const part of pathParts(path)) {
      directory = await directory.getDirectoryHandle(part, { create: true });
    }
    return { attempted: true, ok: true };
  } catch (error) {
    return { attempted: true, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function removePathFromLinkedFolder(
  projectId: string,
  path: string,
): Promise<FolderSyncResult> {
  try {
    const access = await writableHandle(projectId);
    if (!access.handle) return access.result;
    const parts = pathParts(path);
    const parent = await parentDirectory(access.handle, parts, false);
    await parent.removeEntry(parts.at(-1)!, { recursive: true });
    return { attempted: true, ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found/i.test(message)) return { attempted: true, ok: true };
    return { attempted: true, ok: false, error: message };
  }
}

export async function syncProjectToLinkedFolder(
  projectId: string,
  files: ProjectFile[],
  directories: string[] = [],
): Promise<FolderSyncResult> {
  try {
    const access = await writableHandle(projectId);
    if (!access.handle) return access.result;
    for (const path of directories) {
      let directory = access.handle;
      for (const part of pathParts(path)) {
        directory = await directory.getDirectoryHandle(part, { create: true });
      }
    }
    for (const file of files) {
      await writeToHandle(access.handle, file.path, file.content, file.binary);
    }
    return { attempted: true, ok: true };
  } catch (error) {
    return { attempted: true, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
