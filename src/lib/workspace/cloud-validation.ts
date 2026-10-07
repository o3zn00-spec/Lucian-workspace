import type { Project } from "@/types/workspace";

const DEFAULT_MAX_PROJECT_BYTES = 25 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;

function positiveEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function validateCloudSnapshot(value: unknown): {
  project: Project;
  contents: Record<string, string>;
} {
  if (!value || typeof value !== "object") throw new Error("Invalid project snapshot.");
  const body = value as { project?: unknown; contents?: unknown };
  if (!body.project || typeof body.project !== "object") throw new Error("Project metadata is required.");
  const project = body.project as Project;
  if (typeof project.id !== "string" || !project.id || project.id.length > 160) throw new Error("Invalid project id.");
  if (typeof project.name !== "string" || !project.name.trim() || project.name.length > 200) throw new Error("Invalid project name.");
  if (!Array.isArray(project.files) || project.files.length > 50_000) throw new Error("Invalid project file index.");
  if (!body.contents || typeof body.contents !== "object" || Array.isArray(body.contents)) throw new Error("Project contents are required.");

  const contents = body.contents as Record<string, unknown>;
  const clean: Record<string, string> = {};
  const maxFile = positiveEnv("WORKSPACE_MAX_FILE_BYTES", DEFAULT_MAX_FILE_BYTES);
  let total = 0;
  for (const [path, content] of Object.entries(contents)) {
    if (!path || path.length > 1024 || typeof content !== "string") throw new Error("Invalid file content entry.");
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > maxFile) throw new Error(`File exceeds cloud limit: ${path}`);
    total += bytes;
    clean[path] = content;
  }
  if (total > positiveEnv("WORKSPACE_MAX_PROJECT_BYTES", DEFAULT_MAX_PROJECT_BYTES)) {
    throw new Error("Project exceeds the cloud storage limit.");
  }
  return { project, contents: clean };
}
