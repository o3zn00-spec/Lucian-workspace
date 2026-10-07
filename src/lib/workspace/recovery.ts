import type { PreviewMode, Project, ProjectVersion } from "@/types/workspace";
import {
  getManyFileContents,
  saveVersion,
  trimProjectHistory,
} from "./db";

function versionId(): string {
  return `ver_${crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
}

/** Create a complete, recoverable snapshot before a structural mutation. */
export async function createRecoverySnapshot(
  project: Project,
  label: string,
  previewMode: PreviewMode,
  maxVersions: number,
): Promise<ProjectVersion> {
  const contents = await getManyFileContents(
    project.id,
    project.files.map((file) => file.path),
  );
  const version: ProjectVersion = {
    id: versionId(),
    projectId: project.id,
    label,
    createdAt: Date.now(),
    previewMode,
    directories: [...(project.directories ?? [])],
    files: project.files.map((file) => ({
      ...file,
      content: contents.get(file.path) ?? "",
    })),
  };
  await saveVersion(version);
  await trimProjectHistory(project.id, Math.max(1, maxVersions));
  return version;
}
