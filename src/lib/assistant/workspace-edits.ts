import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { safeProjectPath } from "./record-tools";
import { workspaceReadAllowed } from "./tool-access";
import { validateCloudSnapshot } from "@/lib/workspace/cloud-validation";
import type { Prisma } from "@prisma/client";

const PREFIX = "_workspace_edit:";
const MAX_TEXT = 16000;
export type WorkspaceEdit = {
  version: 1; id: string; projectId: string; projectName: string; path: string;
  revision: number; projectUpdatedAt: number; before: string; after: string; reason: string;
  expiresAt: number; status: "pending" | "applied"; appliedRevision?: number;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export class EditReviewError extends Error {}
export function validEditArguments(value: Record<string, unknown>) {
  return Object.keys(value).length === 5 && Object.keys(value).every(k => ["projectId", "path", "revision", "content", "reason"].includes(k)) &&
    typeof value.projectId === "string" && value.projectId.length > 0 && value.projectId.length <= 160 && safeProjectPath(value.path) &&
    Number.isSafeInteger(value.revision) && Number(value.revision) > 0 && typeof value.content === "string" && value.content.length <= MAX_TEXT &&
    typeof value.reason === "string" && value.reason.trim().length > 0 && value.reason.length <= 500;
}
function fileSnapshot(row: { project: unknown; contents: unknown }, path: string) {
  const project = object(row.project), contents = object(row.contents);
  if (project.trashedAt || !Array.isArray(project.files) || !project.files.some(f => object(f).path === path && object(f).binary === false) ||
    !Object.hasOwn(contents, path) || typeof contents[path] !== "string" || (contents[path] as string).length > MAX_TEXT) throw new EditReviewError("An existing, complete indexed text file is required.");
  return { project, contents, before: contents[path] as string };
}
function parseEdit(value: string): WorkspaceEdit {
  const edit = JSON.parse(value) as WorkspaceEdit;
  if (edit.version !== 1 || !safeProjectPath(edit.path) || !["pending", "applied"].includes(edit.status) || typeof edit.before !== "string" || typeof edit.after !== "string" ||
    edit.before.length > MAX_TEXT || edit.after.length > MAX_TEXT || !Number.isSafeInteger(edit.revision) || !Number.isFinite(edit.expiresAt)) throw new EditReviewError("Invalid edit proposal.");
  return edit;
}
export async function proposeWorkspaceEdit(userId: string, args: Record<string, unknown>) {
  if (!validEditArguments(args) || !await workspaceReadAllowed(userId)) throw new EditReviewError("Project edit proposal is unavailable.");
  const row = await db.cloudWorkspaceProject.findFirst({ where: { id: args.projectId as string, userId } });
  if (!row || row.revision !== args.revision) throw new EditReviewError("Project changed. Read the current file before proposing an edit.");
  const { project, before } = fileSnapshot(row, args.path as string);
  if (before === args.content) throw new EditReviewError("The proposal does not change the file.");
  const recent = await db.assistantMemory.count({ where: { userId, key: { startsWith: PREFIX }, updatedAt: { gte: new Date(Date.now() - 86400000) } } });
  if (recent >= 20) throw new EditReviewError("Daily edit-proposal limit reached.");
  if (!await workspaceReadAllowed(userId)) throw new EditReviewError("Project access was revoked.");
  const edit: WorkspaceEdit = { version: 1, id: randomUUID(), projectId: row.id, projectName: typeof project.name === "string" ? project.name.slice(0, 200) : "Project",
    path: args.path as string, revision: row.revision, projectUpdatedAt: Number(project.updatedAt ?? 0), before, after: args.content as string, reason: args.reason as string,
    expiresAt: Date.now() + 3600000, status: "pending" };
  await db.$transaction(async tx => {
    await tx.assistantMemory.create({ data: { userId, key: PREFIX + edit.id, value: JSON.stringify(edit) } });
    await tx.assistantActivity.create({ data: { userId, tool: "workspace.propose", module: "dev-workspace", status: "completed", reason: "Prepared one text-file change for owner review. No project changed or code executed." } });
  });
  return edit.id;
}
export async function getWorkspaceEdit(userId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new EditReviewError("Edit proposal unavailable.");
  const row = await db.assistantMemory.findUnique({ where: { userId_key: { userId, key: PREFIX + id } } });
  if (!row) throw new EditReviewError("Edit proposal unavailable.");
  const edit = parseEdit(row.value);
  if (edit.id !== id) throw new EditReviewError("Invalid edit proposal.");
  return edit;
}
export async function applyWorkspaceEdit(userId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new EditReviewError("Edit proposal unavailable.");
  return db.$transaction(async tx => {
    const memory = await tx.assistantMemory.findUnique({ where: { userId_key: { userId, key: PREFIX + id } } });
    if (!memory) throw new EditReviewError("Edit proposal unavailable.");
    const edit = parseEdit(memory.value);
    if (edit.id !== id) throw new EditReviewError("Invalid edit proposal.");
    if (edit.status === "applied") return edit;
    if (edit.expiresAt <= Date.now()) throw new EditReviewError("Proposal expired. Ask Lilthe for a fresh proposal.");
    const row = await tx.cloudWorkspaceProject.findFirst({ where: { id: edit.projectId, userId } });
    if (!row || row.revision !== edit.revision) throw new EditReviewError("Project changed. This proposal cannot overwrite newer work.");
    const { project, contents, before } = fileSnapshot(row, edit.path);
    if (before !== edit.before) throw new EditReviewError("File changed. Ask Lilthe for a fresh proposal.");
    const nextContents = { ...contents, [edit.path]: edit.after };
    const now = Date.now();
    const snapshot = validateCloudSnapshot({ project: { ...project, updatedAt: now,
      files: (project.files as unknown[]).map(f => object(f).path === edit.path ? { ...object(f), size: Buffer.byteLength(edit.after), updatedAt: now } : f),
      totalSize: Object.values(nextContents).reduce<number>((size, text) => size + (typeof text === "string" ? Buffer.byteLength(text) : 0), 0),
    }, contents: nextContents });
    const changed = await tx.cloudWorkspaceProject.updateMany({ where: { id: edit.projectId, userId, revision: edit.revision }, data: {
      project: snapshot.project as unknown as Prisma.InputJsonValue, contents: snapshot.contents, revision: { increment: 1 },
    } });
    if (changed.count !== 1) throw new EditReviewError("Project changed. This proposal cannot overwrite newer work.");
    const applied: WorkspaceEdit = { ...edit, status: "applied", appliedRevision: edit.revision + 1 };
    const marked = await tx.assistantMemory.updateMany({ where: { id: memory.id, userId, value: memory.value }, data: { value: JSON.stringify(applied) } });
    if (marked.count !== 1) throw new EditReviewError("Proposal already changed. Reload the review.");
    await tx.assistantActivity.create({ data: { userId, tool: "workspace.apply", module: "dev-workspace", status: "completed", reason: "Owner applied one reviewed cloud text-file proposal. No code execution, Git push or deployment." } });
    return applied;
  });
}
