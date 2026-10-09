import "server-only";
import { db } from "@/lib/db";

export const RECORD_SOURCES = { investing: "investing", research: "research", "news-feed": "news" } as const;
const fields: Record<string, readonly string[]> = {
  watchlist: ["symbol", "name", "assetType", "targetEntry", "notes"],
  research: ["symbol", "source", "url", "notes"],
  thesis: ["reason", "horizon", "confidence", "targetPrice", "risks", "reassessmentConditions"],
  article: ["description", "url", "source", "category", "publishedAt"],
};
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

export async function readModuleRecords(userId: string, module: keyof typeof RECORD_SOURCES) {
  const rows = await db.savedItem.findMany({ where: { userId, source: RECORD_SOURCES[module], type: { in: Object.keys(fields) } },
    orderBy: { createdAt: "desc" }, take: 6, select: { title: true, type: true, data: true, refId: true } });
  return JSON.stringify(rows.map(row => {
    const data = object(row.data);
    const details = Object.fromEntries((fields[row.type] ?? []).flatMap<[string, string | number]>(key => {
      const value = data[key];
      return typeof value === "string" ? [[key, value.slice(0, 1500)]] : typeof value === "number" && Number.isFinite(value) ? [[key, value]] : [];
    }));
    return { title: row.title.slice(0, 200), type: row.type, refId: row.refId, details };
  }));
}

export function safeProjectPath(path: unknown): path is string {
  if (typeof path !== "string" || !path || path.length > 300 || path.startsWith("/") || path.includes("\\") || /[\x00-\x1f]/.test(path)) return false;
  if (path.split("/").some(part => !part || part === "." || part === "..")) return false;
  // Project environment settings and private credential files are never exposed.
  return !/(^|\/)(\.env(?:\..*)?|\.ssh|\.git|credentials(?:\..*)?|secrets?(?:\..*)?|id_rsa|id_ed25519)(\/|$)|\.(pem|key|p12|pfx)$/i.test(path);
}

export async function readWorkspaceProjects(userId: string) {
  const rows = await db.cloudWorkspaceProject.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take: 8,
    select: { id: true, project: true, revision: true } });
  return JSON.stringify(rows.filter(row => !object(row.project).trashedAt).map(row => {
    const project = object(row.project);
    const files = Array.isArray(project.files) ? project.files : [];
    const paths = files.flatMap(file => { const f = object(file); return !f.binary && safeProjectPath(f.path) ? [f.path] : []; });
    return { id: row.id, name: typeof project.name === "string" ? project.name.slice(0, 200) : "Untitled", revision: row.revision,
      files: paths.slice(0, 40), listedFiles: Math.min(paths.length, 40), totalIndexedTextFiles: paths.length };
  }));
}

export async function readWorkspaceFile(userId: string, projectId: string, path: string) {
  const row = await db.cloudWorkspaceProject.findFirst({ where: { id: projectId, userId }, select: { project: true, contents: true, revision: true } });
  if (!row || object(row.project).trashedAt) return "Project or file unavailable.";
  const project = object(row.project), contents = object(row.contents);
  const files = Array.isArray(project.files) ? project.files : [];
  if (!files.some(file => { const f = object(file); return f.path === path && f.binary === false; }) || !Object.hasOwn(contents, path) || typeof contents[path] !== "string") return "Project or file unavailable.";
  const content = contents[path] as string;
  return JSON.stringify({ projectId, path, revision: row.revision, content: content.slice(0, 16000), truncated: content.length > 16000 });
}
