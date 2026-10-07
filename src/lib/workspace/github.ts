"use client";

// Client-side GitHub repo import — uses the LUCIAN server-side proxy route
// with binary streaming transport (Phase 12 finalization).
//
// Phase 11 originally returned the archive as base64 inside JSON. Phase 12
// corrects this: the server now returns raw ZIP bytes as a binary stream
// (Content-Type: application/zip), which the browser receives as an
// ArrayBuffer directly. This avoids the 1.33× memory overhead of base64
// and the JSON parse cost on large repositories.
//
// Flow:
//   Browser
//     → POST /api/dev-workspace/github-import { url, branch? }
//     → server fetches codeload.github.com (after resolving default branch)
//     → server streams raw ZIP bytes back
//     → browser receives ArrayBuffer
//     → JSZip → existing importZipToFiles() → IndexedDB project
//
// For private repositories: the server route returns an honest
// "auth-required" error since LUCIAN does not store a GitHub PAT.

import JSZip from "jszip";
import { importZipToFiles, type ImportResult } from "./project";

export interface GitHubImportResult extends ImportResult {
  repoName: string;
  branch: string;
}

interface ServerErrorResponse {
  success: false;
  error: string;
  errorType: string;
  statusCode: number;
}

/**
 * Import a public GitHub repository as a LUCIAN project, via the
 * LUCIAN server-side proxy route (binary streaming transport).
 *
 * @param url GitHub URL (https://github.com/owner/repo[/tree/branch[/subdir]])
 * @param branch Optional explicit branch override. If omitted, the
 *               server resolves the real default branch via the GitHub
 *               metadata API.
 */
export async function importFromGitHub(
  url: string,
  branch?: string,
): Promise<GitHubImportResult> {
  let res: Response;
  try {
    res = await fetch("/api/dev-workspace/github-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, branch }),
    });
  } catch {
    throw new Error(
      "Could not reach the LUCIAN GitHub import service. Check your network connection and try again.",
    );
  }

  // Error responses are JSON; success is a binary ZIP stream.
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    if (contentType.includes("application/json")) {
      const err = (await res.json().catch(() => null)) as ServerErrorResponse | null;
      throw new Error(err?.error ?? `GitHub import failed (HTTP ${res.status}).`);
    }
    // Non-JSON error — read the text body if present.
    const text = await res.text().catch(() => "");
    throw new Error(text || `GitHub import failed (HTTP ${res.status}).`);
  }

  if (!contentType.includes("application/zip") && !contentType.includes("octet-stream")) {
    // Server returned an unexpected content type.
    throw new Error(
      `GitHub import service returned an unexpected content type: ${contentType}`,
    );
  }

  // Read the binary stream into an ArrayBuffer. The browser handles
  // streaming efficiently — no base64 decode needed.
  let buffer: ArrayBuffer;
  try {
    buffer = await res.arrayBuffer();
  } catch {
    throw new Error("Failed to read the repository archive from the server response.");
  }

  // ZIP magic-bytes sanity check (PK\x03\x04).
  const magic = new Uint8Array(buffer.slice(0, 4));
  if (magic[0] !== 0x50 || magic[1] !== 0x4b || magic[2] !== 0x03 || magic[3] !== 0x04) {
    throw new Error("GitHub returned a response that is not a valid ZIP archive.");
  }

  // Read metadata from response headers.
  const owner = decodeURIComponent(res.headers.get("x-lucian-github-owner") ?? "");
  const repoName = decodeURIComponent(res.headers.get("x-lucian-github-repo-name") ?? "");
  const branchName = decodeURIComponent(res.headers.get("x-lucian-github-branch") ?? "main");
  const subdir = decodeURIComponent(res.headers.get("x-lucian-github-subdir") ?? "");

  return await finalizeImport(buffer, owner, repoName, branchName, subdir);
}

async function finalizeImport(
  buffer: ArrayBuffer,
  owner: string,
  repoName: string,
  branch: string,
  subdir: string,
): Promise<GitHubImportResult> {
  // Re-pack the archive without GitHub's wrapper folder so paths are clean.
  const zip = await JSZip.loadAsync(buffer);
  const repacked = new JSZip();
  const names = Object.keys(zip.files);
  if (names.length === 0) {
    throw new Error("Repository archive was empty.");
  }
  // Find the wrapper prefix (first path segment shared by all entries).
  const wrapper = names[0].split("/")[0] + "/";
  const wantedPrefix = subdir
    ? wrapper + subdir.replace(/\/+$/, "") + "/"
    : wrapper;

  let copied = 0;
  for (const name of names) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    if (!name.startsWith(wantedPrefix)) continue;
    const cleanPath = name.slice(wantedPrefix.length);
    if (!cleanPath) continue;
    const content = await entry.async("uint8array");
    repacked.file(cleanPath, content);
    copied++;
  }
  if (copied === 0) {
    throw new Error(
      subdir
        ? `No files found under subdirectory "${subdir}" in the repository.`
        : "Repository archive was empty.",
    );
  }

  const repackedBuffer = await repacked.generateAsync({ type: "arraybuffer" });
  const result = await importZipToFiles(repackedBuffer);
  // Use the repo name (without owner) as the project name for cleanliness.
  const shortName = repoName.includes("/")
    ? repoName.split("/")[1]
    : repoName;
  void owner; // kept for future use (display in UI / notifications)
  return { ...result, repoName: shortName, branch };
}
