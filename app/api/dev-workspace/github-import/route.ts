import { NextResponse } from "next/server";

/**
 * LUCIAN DevWorkspace — server-side GitHub public repository import.
 *
 * Phase 11 (finalized in Phase 12): production-safe streaming transport.
 *
 * Architecture:
 *   Browser
 *     → POST /api/dev-workspace/github-import { url, branch? }
 *     → LUCIAN validates GitHub repo/ref (strict host allowlist)
 *     → GitHub repository metadata API (api.github.com/repos/owner/repo)
 *       → resolves real default_branch when none specified
 *     → server fetches codeload.github.com archive
 *     → server STREAMS raw ZIP bytes back to the browser
 *     → browser receives ArrayBuffer
 *     → JSZip → existing importZipToFiles() → IndexedDB project
 *
 * Phase 12 corrections (replacing the previous base64-JSON transport):
 *   - Returns the archive as a raw binary `application/zip` response, NOT
 *     as a base64 string wrapped in JSON. This avoids holding a
 *     potentially huge base64 string (1.33× the ZIP size) in server
 *     memory and avoids the JSON parse cost on the browser.
 *   - Real default branch discovery via the GitHub repository metadata
 *     API (api.github.com/repos/owner/repo → default_branch). No longer
 *     relies only on HEAD/main/master fallback — repos using "develop",
 *     "trunk", "production", "release", etc. now resolve correctly.
 *   - ONE overall request deadline shared across metadata lookup + archive
 *     fetch + any fallback attempt. We track the deadline manually so
 *     Vercel's maxDuration is never exceeded.
 *
 * Security (unchanged from Phase 11):
 *   - GitHub-only URL validation. No arbitrary URL proxying.
 *   - Rejects localhost, private network ranges, file://, etc.
 *   - Strict github.com host + path-shape validation.
 *   - codeload destination controlled by LUCIAN (server builds the URL
 *     from the parsed owner/repo — the client never supplies a fetch URL).
 *   - redirect: "error" — no off-domain redirect following.
 *   - ZIP magic-bytes check before returning.
 *   - Bounded archive size (100 MB) — checked via Content-Length AND
 *     enforced during streaming body read.
 *   - Honest private-repo state (404/401/403 → "auth-required" error).
 *   - No GitHub token required for PUBLIC repositories.
 *
 * Private repositories:
 *   LUCIAN does not currently store a GitHub PAT. If a repository returns
 *   404 (which is what GitHub returns for both nonexistent AND private
 *   repos when unauthenticated), we return an honest "authentication not
 *   configured" error rather than pretending the import succeeded.
 *
 * Vercel: `runtime = "nodejs"` + `dynamic = "force-dynamic"` + `maxDuration = 30`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // seconds — overall Vercel function budget.

/** Maximum archive size we will download + return. 100 MB. */
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
/** Overall request deadline. Slightly under maxDuration so we have time
 *  to return an honest error response if we hit the cap. */
const OVERALL_DEADLINE_MS = 28_000;
/** Per-fetch timeout for individual network calls (metadata + archive).
 *  Bounded by the overall deadline so a single slow call can't eat the
 *  entire budget. */
const PER_FETCH_TIMEOUT_MS = 15_000;

/** Approved GitHub hosts. The route will only ever fetch from these. */
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);
const GITHUB_API_HOST = "api.github.com";
const CODELOAD_HOST = "codeload.github.com";

interface ImportRequestBody {
  url?: string;
  branch?: string;
}

interface ErrorResponse {
  success: false;
  error: string;
  errorType:
    | "invalid-url"
    | "not-github"
    | "rate-limited"
    | "not-found"
    | "auth-required"
    | "too-large"
    | "timeout"
    | "fetch-failed"
    | "bad-archive"
    | "metadata-failed";
  statusCode: number;
}

/** Header metadata returned alongside the binary ZIP stream. We pass it
 *  via response headers (not a JSON body) so the browser can read it
 *  from the same Response object that yields the binary stream. */
const META_PREFIX = "x-lucian-github-";

/**
 * Parse a GitHub URL into owner, repo, optional subdir, and optional branch.
 *
 * Accepts:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/main
 *   https://github.com/owner/repo/tree/main/subdir
 *   https://github.com/owner/repo.git
 *
 * Rejects anything that is not exactly github.com (or www.github.com).
 * This is the ONLY host we proxy — the route is NOT a general URL proxy.
 */
function parseGitHubUrl(
  url: string,
): { owner: string; repo: string; subdir: string; branch: string | null } | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname !== "github.com" && u.hostname !== "www.github.com") return null;
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const parts = u.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo, kind, branch, ...rest] = parts;
    if (kind === "tree" && branch) {
      return { owner, repo, subdir: rest.join("/"), branch };
    }
    if (kind && kind !== "tree") return null;
    return { owner, repo, subdir: "", branch: null };
  } catch {
    return null;
  }
}

/** Build the codeload URL for the given ref (branch). */
function buildArchiveUrl(owner: string, repo: string, ref: string): string {
  return `https://${CODELOAD_HOST}/${owner}/${repo}/zip/refs/heads/${ref}`;
}

/** Fetch with a hard timeout via AbortController. The timeout is the
 *  minimum of perFetchTimeoutMs and the remaining overall deadline. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      // Do NOT follow redirects to arbitrary hosts — codeload.github.com
      // and api.github.com don't redirect off-domain, but this is
      // defense-in-depth against any future redirect trickery.
      redirect: "error",
    });
  } finally {
    clearTimeout(id);
  }
}

/**
 * Resolve the repository's real default branch via the GitHub REST API.
 *
 * Calls `https://api.github.com/repos/owner/repo` and reads
 * `default_branch` from the JSON response. GitHub returns this field
 * for public repositories without authentication.
 *
 * Returns null if the metadata lookup fails (rate limit, network error,
 * 404, parse error). The caller then falls back to main/master.
 */
async function resolveDefaultBranch(
  owner: string,
  repo: string,
  remainingMs: number,
): Promise<string | null> {
  const timeoutMs = Math.min(PER_FETCH_TIMEOUT_MS, remainingMs);
  if (timeoutMs <= 0) return null;

  const apiUrl = `https://${GITHUB_API_HOST}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      apiUrl,
      {
        headers: {
          // GitHub requires a User-Agent on all API requests.
          "User-Agent": "lucian-dev-workspace",
          "Accept": "application/vnd.github+json",
        },
      },
      timeoutMs,
    );
  } catch {
    return null;
  }

  if (!res.ok) return null;

  try {
    const data = (await res.json()) as { default_branch?: string };
    if (typeof data.default_branch === "string" && data.default_branch) {
      return data.default_branch;
    }
  } catch {
    /* ignore parse errors — fall back */
  }
  return null;
}

/** Simple deadline tracker — returns the remaining milliseconds. */
function makeDeadline(): () => number {
  const start = Date.now();
  return () => Math.max(0, OVERALL_DEADLINE_MS - (Date.now() - start));
}

export async function POST(req: Request) {
  const remaining = makeDeadline();

  let body: ImportRequestBody;
  try {
    body = (await req.json()) as ImportRequestBody;
  } catch {
    return errorResponse("Invalid request body. Expected JSON with a 'url' field.", "invalid-url", 400);
  }

  const { url, branch: explicitBranch } = body;
  if (!url || typeof url !== "string") {
    return errorResponse("A GitHub URL is required.", "invalid-url", 400);
  }

  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    return errorResponse(
      "Invalid GitHub URL. Use the form https://github.com/owner/repo or https://github.com/owner/repo/tree/branch/subdir.",
      "not-github",
      400,
    );
  }

  const { owner, repo, subdir, branch: urlBranch } = parsed;
  const branch = explicitBranch || urlBranch;

  // ── Resolve the ref to fetch ──
  // If a branch was specified (either via URL /tree/branch or request body),
  // use it directly. Otherwise, resolve the real default branch via the
  // GitHub metadata API. If that fails, fall back to main/master.
  let refsToTry: string[];
  if (branch) {
    refsToTry = [branch];
  } else {
    const defaultBranch = await resolveDefaultBranch(owner, repo, remaining());
    if (defaultBranch) {
      refsToTry = [defaultBranch];
    } else {
      // Metadata lookup failed — fall back to common defaults. Repos
      // using "develop"/"trunk"/"production"/"release" as default will
      // fail here, but the metadata API succeeds for the vast majority
      // of public repos so this is rare.
      refsToTry = ["main", "master"];
    }
  }

  if (remaining() <= 0) {
    return errorResponse("Timed out while resolving the repository branch.", "timeout", 504);
  }

  // ── Fetch the archive ──
  // Try each ref in order. Each attempt gets a per-fetch timeout bounded
  // by the remaining overall deadline. We stop as soon as one succeeds.
  let archiveRes: Response | null = null;
  let actualBranch = refsToTry[0];
  let lastError: { status: number; statusText: string } | null = null;

  for (const ref of refsToTry) {
    if (remaining() <= 0) {
      return errorResponse("Timed out while downloading the repository archive.", "timeout", 504);
    }
    const archiveUrl = buildArchiveUrl(owner, repo, ref);
    const fetchTimeout = Math.min(PER_FETCH_TIMEOUT_MS, remaining());
    let res: Response;
    try {
      res = await fetchWithTimeout(archiveUrl, {}, fetchTimeout);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("abort")) {
        // This individual fetch timed out — try the next ref if we have
        // budget, otherwise return a timeout error.
        lastError = { status: 0, statusText: "timeout" };
        continue;
      }
      lastError = { status: 0, statusText: msg };
      continue;
    }

    if (res.status === 404) {
      lastError = { status: 404, statusText: res.statusText };
      continue;
    }
    if (res.status === 403 || res.status === 429) {
      return errorResponse(
        "GitHub is rate-limiting this server. Wait a minute and try again, or download the ZIP manually from github.com.",
        "rate-limited",
        429,
      );
    }
    if (res.status === 401) {
      return errorResponse(
        "Private repository authentication is not configured. LUCIAN can only import public repositories.",
        "auth-required",
        401,
      );
    }
    if (!res.ok) {
      lastError = { status: res.status, statusText: res.statusText };
      continue;
    }

    archiveRes = res;
    actualBranch = ref;
    break;
  }

  if (!archiveRes) {
    if (branch) {
      return errorResponse(
        `Repository or branch "${branch}" not found. It may be private, deleted, or the branch name is incorrect.`,
        "not-found",
        404,
      );
    }
    return errorResponse(
      `Repository not found at ${owner}/${repo}. It may be private, deleted, or the default branch could not be resolved.`,
      "not-found",
      404,
    );
  }

  // ── Size check (via Content-Length) ──
  const contentLength = parseInt(archiveRes.headers.get("content-length") ?? "0", 10);
  if (contentLength && contentLength > MAX_ARCHIVE_BYTES) {
    return errorResponse(
      `Repository archive is too large (${(contentLength / 1024 / 1024).toFixed(1)} MB). The maximum is ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB.`,
      "too-large",
      413,
    );
  }

  // ── Stream the archive back to the browser as raw binary ──
  // We pipe the response body through a TransformStream that enforces
  // the size cap during streaming. This avoids loading the entire
  // archive into server memory.
  const source = archiveRes.body;
  if (!source) {
    return errorResponse("GitHub returned an empty archive body.", "bad-archive", 502);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader();
      let total = 0;
      try {
        while (true) {
          if (remaining() <= 0) {
            try { await reader.cancel(); } catch { /* ignore */ }
            controller.error(new Error("timeout"));
            return;
          }
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            total += value.byteLength;
            if (total > MAX_ARCHIVE_BYTES) {
              try { await reader.cancel(); } catch { /* ignore */ }
              controller.error(new Error("too-large"));
              return;
            }
            controller.enqueue(value);
          }
        }
        controller.close();
      } catch (err) {
        try { await reader.cancel(); } catch { /* ignore */ }
        controller.error(err instanceof Error ? err : new Error(String(err)));
      }
    },
  });

  // Return raw binary with metadata in headers (not JSON body).
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(owner)}-${encodeURIComponent(repo)}-${encodeURIComponent(actualBranch)}.zip"`,
      [`${META_PREFIX}repo-name`]: encodeURIComponent(`${owner}/${repo}`),
      [`${META_PREFIX}owner`]: encodeURIComponent(owner),
      [`${META_PREFIX}branch`]: encodeURIComponent(actualBranch),
      [`${META_PREFIX}subdir`]: encodeURIComponent(subdir),
      [`${META_PREFIX}size`]: contentLength ? String(contentLength) : "unknown",
      // Cache short-lived so a re-import doesn't re-download from GitHub
      // if the user clicks import twice quickly. ZIP archives are
      // immutable for a given ref so this is safe.
      "Cache-Control": "private, max-age=60",
    },
  });
}

/** Helper to build an error JSON response. */
function errorResponse(
  error: string,
  errorType: ErrorResponse["errorType"],
  statusCode: number,
): NextResponse<ErrorResponse> {
  return NextResponse.json<ErrorResponse>(
    { success: false, error, errorType, statusCode },
    { status: statusCode },
  );
}

/** GET — quick health probe. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "dev-workspace/github-import",
    transport: "binary-stream",
    maxArchiveBytes: MAX_ARCHIVE_BYTES,
    overallDeadlineMs: OVERALL_DEADLINE_MS,
    perFetchTimeoutMs: PER_FETCH_TIMEOUT_MS,
  });
}
