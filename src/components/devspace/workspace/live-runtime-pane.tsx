"use client";

// Live Runtime pane — runs the active project inside a WebContainer and
// shows the real dev server in an iframe, with a collapsible terminal.
// This is the "any project runs for real" engine. Honest states only:
// every status shown reflects the actual container state.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play,
  Square,
  RefreshCw,
  Loader2,
  TerminalSquare,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  ExternalLink,
  MousePointerClick,
  X,
  Globe2,
} from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { useSettingsStore } from "@/store/settings";
import { Button } from "@/components/ui-devspace/button";
import { Badge } from "@/components/ui-devspace/badge";
import {
  Panel,
  PanelGroup,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";
import { cn } from "@/lib/utils";
import {
  getRuntimeState,
  isRuntimeSupported,
  startRuntime,
  stopRuntime,
  subscribeRuntime,
  subscribeTerminal,
  type RuntimeState,
} from "@/lib/workspace/webcontainer";
import { findElementInSource, type InspectedElement } from "@/lib/workspace/inspector";
import type { ProjectFile } from "@/types/workspace";
import { registerPreviewInspector, type PreviewInspection } from "@/lib/workspace/preview-bridge";

const STATUS_LABELS: Record<RuntimeState["status"], string> = {
  idle: "Not started",
  unsupported: "Unsupported browser",
  booting: "Booting runtime…",
  mounting: "Mounting files…",
  installing: "Installing dependencies…",
  starting: "Starting dev server…",
  running: "Running",
  error: "Error",
  stopped: "Stopped",
};

export function LiveRuntimePane() {
  const { activeProject, activeProjectId, loadAllFileContents } = useWorkspaceStore();
  const [runtime, setRuntime] = useState<RuntimeState>(getRuntimeState());
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [terminalText, setTerminalText] = useState("");
  const [launching, setLaunching] = useState(false);
  const [inspectMode, setInspectMode] = useState(false);
  const [inspectHits, setInspectHits] = useState<{
    element: InspectedElement;
    matches: { path: string; line: number; preview: string }[];
  } | null>(null);
  const terminalRef = useRef<HTMLPreElement>(null);
  const terminalPanelRef = useRef<ImperativePanelHandle>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const openTab = useWorkspaceStore((s) => s.openTab);

  // Settings → DevWorkspace → Preview → startRuntimeAutomatically.
  // When ON, the runtime auto-starts when a project opens (one-shot per
  // project). When OFF (default), the user clicks Start manually.
  const startRuntimeAutomatically = useSettingsStore((s) => s.devWorkspace.preview.startRuntimeAutomatically);
  const autoStartedForRef = useRef<string | null>(null);

  // Toggle inspect mode inside the running project.
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "lucian-inspect-toggle", enabled: inspectMode },
      "*",
    );
  }, [inspectMode]);

  // Receive clicked-element reports from the injected inspector.
  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      if (e.data?.type !== "lucian-inspect-click" || !e.data.element) return;
      const element = e.data.element as InspectedElement;
      const state = useWorkspaceStore.getState();
      if (!state.activeProject || !state.activeProjectId) return;
      await state.loadAllFileContents(state.activeProjectId);
      const cache = useWorkspaceStore.getState().contentCache;
      const files = state.activeProject.files.map((f) => ({
        path: f.path,
        binary: f.binary,
        content: f.binary ? "" : (cache.get(f.path) ?? ""),
      }));
      const matches = findElementInSource(element, files);
      setInspectHits({ element, matches });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (runtime.status !== "running" || !runtime.serverUrl) return;
    return registerPreviewInspector("live-runtime", async (selector) => {
      const frameWindow = iframeRef.current?.contentWindow;
      if (!frameWindow) throw new Error("The live preview frame is not available.");
      return new Promise<PreviewInspection>((resolve, reject) => {
        const requestId = crypto.randomUUID();
        const cleanup = () => {
          window.removeEventListener("message", onMessage);
          window.clearTimeout(timeout);
        };
        const onMessage = (event: MessageEvent) => {
          if (event.source !== frameWindow || event.data?.type !== "lucian-dom-snapshot-response" || event.data.requestId !== requestId) return;
          cleanup();
          if (event.data.error) {
            reject(new Error(String(event.data.error)));
            return;
          }
          resolve({ source: "live-runtime", ...(event.data.payload as Omit<PreviewInspection, "source">) });
        };
        const timeout = window.setTimeout(() => {
          cleanup();
          reject(new Error("The live project did not answer the DOM inspection request."));
        }, 3_000);
        window.addEventListener("message", onMessage);
        frameWindow.postMessage({ type: "lucian-dom-snapshot-request", requestId, selector: selector || "body" }, "*");
      });
    });
  }, [runtime.status, runtime.serverUrl]);

  useEffect(() => subscribeRuntime(setRuntime), []);
  useEffect(
    () =>
      subscribeTerminal((chunk) => {
        setTerminalText((t) => {
          const next = t + chunk;
          // Keep the buffer bounded (~200KB).
          return next.length > 200_000 ? next.slice(-150_000) : next;
        });
      }),
    [],
  );

  // Auto-scroll terminal.
  useEffect(() => {
    const el = terminalRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [terminalText]);

  const supported = isRuntimeSupported();

  const handleStart = useCallback(async () => {
    if (!activeProject || !activeProjectId) return;
    setLaunching(true);
    setTerminalText("");
    try {
      await loadAllFileContents(activeProjectId);
      const { getManyFileContents } = await import("@/lib/workspace/db");
      const binaryPaths = activeProject.files.filter((f) => f.binary).map((f) => f.path);
      const binaryContents = await getManyFileContents(activeProjectId, binaryPaths);
      const cache = useWorkspaceStore.getState().contentCache;
      const files: ProjectFile[] = activeProject.files.map((f) => ({
        ...f,
        content: f.binary
          ? (binaryContents.get(f.path) ?? "")
          : (cache.get(f.path) ?? ""),
      }));
      await startRuntime({
        projectId: activeProjectId,
        files,
        envVars: activeProject.envVars,
      });
    } finally {
      setLaunching(false);
    }
  }, [activeProject, activeProjectId, loadAllFileContents]);

  // Auto-start the runtime when a project opens, if the setting is ON.
  // One-shot per project — we track which project we've already auto-
  // started for so we don't re-start on every re-render.
  useEffect(() => {
    if (!startRuntimeAutomatically) return;
    if (!activeProjectId) {
      autoStartedForRef.current = null;
      return;
    }
    if (autoStartedForRef.current === activeProjectId) return;
    if (runtime.status !== "idle" && runtime.status !== "stopped") return;
    autoStartedForRef.current = activeProjectId;
    // handleStart() calls setLaunching/setTerminalText — this is a
    // legitimate side-effect (starting an external system), not a
    // cascading state update. The lint rule flags it because it can't
    // distinguish side-effects from state syncs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void handleStart();
  }, [startRuntimeAutomatically, activeProjectId, runtime.status, handleStart]);

  if (!activeProject) return null;

  const busy =
    launching ||
    runtime.status === "booting" ||
    runtime.status === "mounting" ||
    runtime.status === "installing" ||
    runtime.status === "starting";

  return (
    <div className="flex h-full flex-col bg-muted/30">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-card px-3">
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Live Runtime
          </span>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              runtime.status === "running" && "border-emerald-500/40 text-emerald-600",
              runtime.status === "error" && "border-destructive/40 text-destructive",
              busy && "border-amber-500/40 text-amber-600",
            )}
          >
            {busy && <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />}
            {STATUS_LABELS[runtime.status]}
          </Badge>
          {runtime.strategy && (
            <Badge variant="secondary" className="text-[10px]">{runtime.strategy}</Badge>
          )}
        </div>
        <div className="hidden min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[10px] text-muted-foreground md:flex">
          <Globe2 className="h-3 w-3 shrink-0" />
          <span className="truncate font-mono" title={runtime.serverUrl ?? "Runtime not started"}>
            {runtime.serverUrl ?? "Runtime URL appears here after the dev server starts"}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {runtime.status === "running" ? (
            <>
              <Button
                variant={inspectMode ? "default" : "ghost"}
                size="icon"
                className="h-7 w-7"
                title={inspectMode ? "Exit inspect mode" : "Inspect element (click any element in the preview to find its source)"}
                onClick={() => setInspectMode((v) => !v)}
              >
                <MousePointerClick className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Restart" onClick={handleStart}>
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
              {runtime.serverUrl && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Open in new tab"
                  onClick={() => window.open(runtime.serverUrl!, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Stop" onClick={() => stopRuntime()}>
                <Square className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <Button size="sm" className="h-7 gap-1.5 px-2.5 text-xs" disabled={busy || !supported} onClick={handleStart}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Run Project
            </Button>
          )}
        </div>
      </div>

      {/* Unsupported browser — honest message, no fakery */}
      {!supported && (
        <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            The live runtime needs a Chromium browser (Chrome/Edge) with cross-origin isolation.
            Use the Preview tab for the instant static engine instead.
          </span>
        </div>
      )}

      {/* Error banner */}
      {runtime.status === "error" && runtime.error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span className="font-semibold">Runtime error: </span>
          {runtime.error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <PanelGroup direction="vertical" autoSaveId="lucian-devworkspace-runtime-terminal-v1" className="h-full">
          <Panel id="runtime-preview" order={1} defaultSize={72} minSize={30}>
            <div className="flex h-full min-h-0 flex-col">
              <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
                {runtime.status === "running" && runtime.serverUrl ? (
                  <iframe
                    ref={iframeRef}
                    src={runtime.serverUrl}
                    className="h-full w-full border-0"
                    title="Live project"
                    allow="cross-origin-isolated"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center text-sm text-muted-foreground">
                      {busy ? (
                        <div className="flex flex-col items-center gap-2">
                          <Loader2 className="h-6 w-6 animate-spin" />
                          <span>{STATUS_LABELS[runtime.status]}</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2 px-6">
                          <TerminalSquare className="h-8 w-8 opacity-40" />
                          <span>
                            Press <strong>Run Project</strong> to boot a real dev server for this
                            project — npm install, hot reload, real APIs.
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {inspectHits && (
                <div className="shrink-0 border-t bg-card px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold">
                      <MousePointerClick className="mr-1 inline h-3 w-3 text-primary" />
                      &lt;{inspectHits.element.tag}&gt;
                      {inspectHits.element.id && `#${inspectHits.element.id}`}
                      {inspectHits.element.text && (
                        <span className="ml-1.5 font-normal text-muted-foreground">
                          &quot;{inspectHits.element.text.slice(0, 50)}{inspectHits.element.text.length > 50 ? "…" : ""}&quot;
                        </span>
                      )}
                    </span>
                    <button type="button" aria-label="Close inspection results" onClick={() => setInspectHits(null)} className="rounded p-0.5 hover:bg-accent">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  {inspectHits.matches.length === 0 ? (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      No matching source lines found (dynamic content or generated markup).
                    </p>
                  ) : (
                    <div className="mt-1 max-h-24 space-y-0.5 overflow-y-auto">
                      {inspectHits.matches.map((m, i) => (
                        <button
                          key={i}
                          onClick={() => { openTab(m.path); setInspectHits(null); setInspectMode(false); }}
                          className="flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left text-[10px] hover:bg-accent"
                          title="Open in editor"
                        >
                          <span className="shrink-0 font-mono text-primary">{m.path}:{m.line}</span>
                          <span className="truncate font-mono text-muted-foreground">{m.preview}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Panel>

          <PanelResizeHandle
            aria-label="Resize runtime and terminal"
            className="h-1 shrink-0 bg-border transition-colors hover:bg-primary/40 focus-visible:bg-primary"
          />

          <Panel
            ref={terminalPanelRef}
            id="runtime-terminal"
            order={2}
            defaultSize={28}
            minSize={14}
            maxSize={60}
            collapsible
            collapsedSize={7}
            onCollapse={() => setTerminalOpen(false)}
            onExpand={() => setTerminalOpen(true)}
          >
            <div className="flex h-full min-h-0 flex-col bg-card">
              <button
                className="flex h-8 w-full shrink-0 items-center justify-between px-3 text-xs text-muted-foreground hover:bg-accent/50"
                onClick={() => terminalOpen ? terminalPanelRef.current?.collapse() : terminalPanelRef.current?.expand(28)}
              >
                <span className="flex items-center gap-1.5">
                  <TerminalSquare className="h-3.5 w-3.5" /> Terminal
                </span>
                {terminalOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
              </button>
              {terminalOpen && (
                <pre
                  ref={terminalRef}
                  className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words border-t bg-black/90 px-3 py-2 font-mono text-[11px] leading-snug text-green-400"
                >
                  {terminalText || "[lucian] Terminal output will appear here when the runtime starts.\n"}
                </pre>
              )}
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
