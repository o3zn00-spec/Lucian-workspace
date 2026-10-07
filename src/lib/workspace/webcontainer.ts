"use client";

// WebContainer live runtime — boots a real Node.js environment in the browser,
// mounts the active project, installs dependencies, and runs the appropriate
// dev command. This is what makes ANY Node-based project (Next.js, Vite,
// React, Express...) run for real inside LUCIAN WORKSPACE.
//
// Architecture rules:
//  - Single container instance per browser tab (WebContainer API limit).
//  - Switching projects tears down the previous process and remounts.
//  - File edits are synced into the running container so the dev server's
//    own hot-reload picks them up (true live editing).
//  - All install/run output is streamed to subscribers (terminal panel).
//
// Requires cross-origin isolation (COOP/COEP headers — configured in
// next.config.ts) and a Chromium-based browser.

import type { EnvVar, ProjectFile } from "@/types/workspace";

type WebContainerType = import("@webcontainer/api").WebContainer;
type WebContainerProcess = import("@webcontainer/api").WebContainerProcess;
type FileSystemTree = import("@webcontainer/api").FileSystemTree;

export type RuntimeStatus =
  | "idle"
  | "unsupported"
  | "booting"
  | "mounting"
  | "installing"
  | "starting"
  | "running"
  | "error"
  | "stopped";

export interface RuntimeState {
  status: RuntimeStatus;
  serverUrl: string | null;
  error: string | null;
  /** Which run strategy was chosen (npm script name or 'static'). */
  strategy: string | null;
}

export interface RuntimeSyncResult {
  attempted: boolean;
  ok: boolean;
  error?: string;
}

type StateListener = (state: RuntimeState) => void;
type TerminalListener = (chunk: string) => void;

let container: WebContainerType | null = null;
let bootPromise: Promise<WebContainerType> | null = null;
let devProcess: WebContainerProcess | null = null;
let currentProjectId: string | null = null;

let state: RuntimeState = { status: "idle", serverUrl: null, error: null, strategy: null };
const stateListeners = new Set<StateListener>();
const terminalListeners = new Set<TerminalListener>();

/** True when the browser supports WebContainers (cross-origin isolated). */
export function isRuntimeSupported(): boolean {
  return typeof window !== "undefined" && (window as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
}

export function getRuntimeState(): RuntimeState {
  return state;
}

export function subscribeRuntime(fn: StateListener): () => void {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}

/** Wait until a start/restart reaches a usable or failed terminal state. */
export async function waitForRuntimeSettled(timeoutMs = 120_000): Promise<RuntimeState> {
  if (state.status === "running" || state.status === "error" || state.status === "unsupported") return state;
  return new Promise<RuntimeState>((resolve) => {
    let unsubscribe: () => void = () => undefined;
    const timeout = setTimeout(() => {
      unsubscribe();
      resolve({ ...state, error: state.error ?? `Runtime did not become ready within ${Math.round(timeoutMs / 1000)} seconds.` });
    }, timeoutMs);
    unsubscribe = subscribeRuntime((next) => {
      if (next.status !== "running" && next.status !== "error" && next.status !== "unsupported") return;
      clearTimeout(timeout);
      unsubscribe();
      resolve(next);
    });
  });
}

export function subscribeTerminal(fn: TerminalListener): () => void {
  terminalListeners.add(fn);
  return () => terminalListeners.delete(fn);
}

function setState(patch: Partial<RuntimeState>) {
  state = { ...state, ...patch };
  for (const fn of stateListeners) fn(state);
}

// Rolling terminal buffer so late subscribers (and the agent's read_terminal
// tool) can see recent output, not just live chunks.
const TERMINAL_BUFFER_MAX = 24000;
let terminalBuffer = "";

/** Strip ANSI escape sequences + cursor-control noise from npm/node output. */
export function stripAnsi(text: string): string {
  return text
    // CSI sequences: ESC [ ... cmd  (colors, cursor moves, line clears)
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")
    // OSC sequences: ESC ] ... BEL
    .replace(/\u001b\][^\u0007]*\u0007/g, "")
    // Bare escapes and leftover bracket codes npm emits without ESC
    .replace(/\u001b/g, "")
    .replace(/\[[0-9]{1,2}[GKJm]/g, "")
    .replace(/\[[0-9];[0-9]{1,2}m/g, "");
}

function emitTerminal(chunk: string) {
  const clean = stripAnsi(chunk);
  terminalBuffer = (terminalBuffer + clean).slice(-TERMINAL_BUFFER_MAX);
  for (const fn of terminalListeners) fn(clean);
}

/** Recent terminal output (ANSI-stripped) for the agent + UI. */
export function getTerminalBuffer(): string {
  return terminalBuffer;
}

async function getContainer(): Promise<WebContainerType> {
  if (container) return container;
  if (!bootPromise) {
    setState({ status: "booting", error: null });
    emitTerminal("\r\n[lucian] Booting WebContainer runtime...\r\n");
    bootPromise = import("@webcontainer/api").then(({ WebContainer }) =>
      WebContainer.boot({ coep: "require-corp" }),
    );
  }
  container = await bootPromise;
  container.on("server-ready", (_port, url) => {
    emitTerminal(`\r\n[lucian] Server ready at ${url}\r\n`);
    setState({ status: "running", serverUrl: url });
  });
  container.on("error", (err) => {
    emitTerminal(`\r\n[lucian] Container error: ${err.message}\r\n`);
    setState({ status: "error", error: err.message });
  });
  return container;
}

/** Convert flat ProjectFile[] into the WebContainer FileSystemTree. */
function toFileSystemTree(files: ProjectFile[]): FileSystemTree {
  const root: FileSystemTree = {};
  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let node: FileSystemTree = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts[i];
      const existing = node[dir];
      if (existing && "directory" in existing) {
        node = existing.directory as FileSystemTree;
      } else {
        const created: FileSystemTree = {};
        node[dir] = { directory: created };
        node = created;
      }
    }
    const name = parts[parts.length - 1];
    if (f.binary) {
      // Binary contents are stored as data URLs — decode to bytes.
      const b64 = f.content.split(",")[1] ?? "";
      try {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        node[name] = { file: { contents: bytes } };
      } catch {
        node[name] = { file: { contents: "" } };
      }
    } else {
      node[name] = { file: { contents: f.content } };
    }
  }
  return root;
}

interface RunPlan {
  install: boolean;
  command: string[];
  label: string;
}

/** Decide how to run the project based on package.json / file layout. */
function planRun(files: ProjectFile[]): RunPlan {
  const pkgFile = files.find((f) => f.path === "package.json");
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      const scripts: Record<string, string> = pkg.scripts ?? {};
      for (const name of ["dev", "start", "serve", "develop"]) {
        if (scripts[name]) {
          return { install: true, command: ["npm", "run", name], label: `npm run ${name}` };
        }
      }
      return { install: true, command: ["npx", "-y", "serve", "-l", "3111", "."], label: "static server" };
    } catch {
      // fallthrough to static
    }
  }
  return { install: false, command: ["npx", "-y", "serve", "-l", "3111", "."], label: "static server" };
}

async function pipeProcess(proc: WebContainerProcess) {
  const reader = proc.output.getReader();
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        emitTerminal(value);
      }
    } catch {
      // stream closed — fine
    }
  })();
}

/** Kill the currently running dev process (if any). */
export async function stopRuntime(): Promise<void> {
  if (devProcess) {
    try {
      devProcess.kill();
    } catch {
      // already dead
    }
    devProcess = null;
  }
  setState({ status: "stopped", serverUrl: null });
}

/**
 * Boot (or reuse) the container, mount the project, install deps, and run.
 * Returns when the run command has been spawned (server URL arrives via state).
 */
export async function startRuntime(opts: {
  projectId: string;
  files: ProjectFile[];
  envVars: EnvVar[];
}): Promise<void> {
  const { projectId, files, envVars } = opts;

  if (!isRuntimeSupported()) {
    setState({
      status: "unsupported",
      error: "WebContainers require a Chromium browser with cross-origin isolation.",
    });
    return;
  }

  try {
    await stopRuntime();
    terminalBuffer = "";
    emitTerminal(`[lucian] Starting a fresh runtime session for ${projectId}...\r\n`);
    const wc = await getContainer();

    setState({ status: "mounting", serverUrl: null, error: null });
    if (currentProjectId && currentProjectId !== projectId) {
      emitTerminal("\r\n[lucian] Clearing previous project...\r\n");
      const entries = await wc.fs.readdir("/");
      for (const entry of entries) {
        if (entry === "node_modules") continue; // keep the package cache warm
        await wc.fs.rm(`/${entry}`, { recursive: true, force: true });
      }
    }
    currentProjectId = projectId;

    emitTerminal(`[lucian] Mounting ${files.length} files...\r\n`);
    // Inject the visual-editor inspector into HTML entry points (idempotent).
    try {
      const { injectInspector } = await import("./inspector");
      injectInspector(files);
    } catch {
      // inspector injection is best-effort
    }
    await wc.mount(toFileSystemTree(files));

    // Write env vars as a real .env file so the project genuinely reads them.
    if (envVars.length > 0) {
      const envText = envVars.map((e) => `${e.key}=${e.value}`).join("\n") + "\n";
      await wc.fs.writeFile("/.env", envText);
      emitTerminal(`[lucian] Wrote .env with ${envVars.length} variable(s)\r\n`);
    } else {
      // A restart must not inherit credentials/settings that the owner removed.
      await wc.fs.rm("/.env", { force: true }).catch(() => undefined);
    }

    const plan = planRun(files);
    setState({ strategy: plan.label });

    if (plan.install) {
      setState({ status: "installing" });
      emitTerminal("\r\n[lucian] Running npm install (this can take a while the first time)...\r\n");
      const install = await wc.spawn("npm", ["install", "--no-audit", "--no-fund"]);
      pipeProcess(install);
      const code = await install.exit;
      if (code !== 0) {
        // Smart fallback: postinstall hooks (e.g. `prisma generate`) often
        // fail inside WebContainers. Retry without lifecycle scripts so the
        // dependencies still land, then attempt prisma generate separately.
        emitTerminal(`\r\n[lucian] npm install failed (exit ${code}) — retrying with --ignore-scripts...\r\n`);
        const retry = await wc.spawn("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts"]);
        pipeProcess(retry);
        const retryCode = await retry.exit;
        if (retryCode !== 0) {
          setState({ status: "error", error: `npm install failed even with --ignore-scripts (exit ${retryCode}). Check the terminal for the real error.` });
          emitTerminal(`\r\n[lucian] npm install FAILED (exit ${retryCode})\r\n`);
          return;
        }
        emitTerminal("\r\n[lucian] Dependencies installed (lifecycle scripts skipped).\r\n");
        // Best-effort prisma generate for projects that need it.
        const hasPrisma = files.some((f) => f.path.startsWith("prisma/") && f.path.endsWith(".prisma"));
        if (hasPrisma) {
          emitTerminal("[lucian] Project uses Prisma — attempting prisma generate...\r\n");
          const gen = await wc.spawn("npx", ["prisma", "generate"]);
          pipeProcess(gen);
          const genCode = await gen.exit;
          if (genCode !== 0) {
            emitTerminal("\r\n[lucian] NOTICE: prisma generate failed in-container. The UI will still run; database features may not work in this preview.\r\n");
          }
        }
      } else {
        emitTerminal("\r\n[lucian] Dependencies installed.\r\n");
      }
    }

    setState({ status: "starting" });
    emitTerminal(`\r\n[lucian] Starting: ${plan.label}\r\n`);
    devProcess = await wc.spawn(plan.command[0], plan.command.slice(1));
    pipeProcess(devProcess);

    devProcess.exit.then((code) => {
      if (state.status !== "running" && state.status !== "stopped") {
        setState({ status: "error", error: `${plan.label} exited with code ${code}` });
        emitTerminal(`\r\n[lucian] Process exited with code ${code}\r\n`);
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setState({ status: "error", error: msg });
    emitTerminal(`\r\n[lucian] Runtime error: ${msg}\r\n`);
  }
}

/** Sync one durable file edit into the mounted container, triggering hot reload. */
export async function syncFile(
  path: string,
  content: string,
  binary = false,
): Promise<RuntimeSyncResult> {
  if (!container || currentProjectId === null) return { attempted: false, ok: true };
  try {
    const parts = path.split("/").filter(Boolean);
    if (parts.length > 1) {
      const dir = "/" + parts.slice(0, -1).join("/");
      await container.fs.mkdir(dir, { recursive: true }).catch(() => undefined);
    }
    let payload: string | Uint8Array = content;
    if (binary) {
      const encoded = content.split(",")[1] ?? "";
      const decoded = atob(encoded);
      payload = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    }
    await container.fs.writeFile("/" + parts.join("/"), payload);
    emitTerminal(`[lucian] Synced ${path}\r\n`);
    return { attempted: true, ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    emitTerminal(`[lucian] Sync failed for ${path}: ${error}\r\n`);
    return { attempted: true, ok: false, error };
  }
}

/** Remove a file from the running container (explorer deletions). */
export async function removeFile(path: string): Promise<RuntimeSyncResult> {
  if (!container || currentProjectId === null) return { attempted: false, ok: true };
  try {
    await container.fs.rm("/" + path, { force: true, recursive: true });
    emitTerminal(`[lucian] Removed ${path}\r\n`);
    return { attempted: true, ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    emitTerminal(`[lucian] Remove failed for ${path}: ${error}\r\n`);
    return { attempted: true, ok: false, error };
  }
}

/** Create an explicit/empty directory in the mounted project. */
export async function createDirectory(path: string): Promise<RuntimeSyncResult> {
  if (!container || currentProjectId === null) return { attempted: false, ok: true };
  try {
    await container.fs.mkdir("/" + path.replace(/^\/+|\/+$/g, ""), { recursive: true });
    emitTerminal(`[lucian] Created folder ${path}\r\n`);
    return { attempted: true, ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    emitTerminal(`[lucian] Folder sync failed for ${path}: ${error}\r\n`);
    return { attempted: true, ok: false, error };
  }
}

/** The project currently mounted in the container (null when none). */
export function runtimeProjectId(): string | null {
  return currentProjectId;
}

/**
 * Run an arbitrary command inside the mounted container and capture its
 * output (used by the agent's run_command tool and future UI terminal input).
 * The container must already have a project mounted.
 */
export async function runCommand(
  commandLine: string,
  opts?: { timeoutMs?: number },
): Promise<{ ok: boolean; exitCode: number | null; output: string }> {
  if (!container || currentProjectId === null) {
    return { ok: false, exitCode: null, output: "No project is mounted in the Live Runtime. Start a project first (run_project or the Run Project button)." };
  }
  const timeoutMs = opts?.timeoutMs ?? 180000;
  const parts = commandLine.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) {
    return { ok: false, exitCode: null, output: "Empty command." };
  }
  emitTerminal(`\r\n[agent] $ ${commandLine}\r\n`);
  try {
    const proc = await container.spawn(parts[0], parts.slice(1));
    let output = "";
    const reader = proc.output.getReader();
    const readLoop = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const clean = stripAnsi(value);
          output += clean;
          emitTerminal(value);
        }
      } catch { /* stream closed */ }
    })();
    const exitCode = await Promise.race([
      proc.exit,
      new Promise<number>((_, reject) =>
        setTimeout(() => {
          try { proc.kill(); } catch { /* already dead */ }
          reject(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs),
      ),
    ]);
    await readLoop;
    return { ok: exitCode === 0, exitCode, output: output.slice(-12000) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, exitCode: null, output: msg };
  }
}
