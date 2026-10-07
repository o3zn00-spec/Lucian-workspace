"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  RefreshCw,
  ExternalLink,
  Loader2,
  Monitor,
  Tablet,
  Smartphone,
  Info,
  AlertTriangle,
  Terminal,
  X,
  Network,
  ChevronDown,
  ChevronUp,
  Wifi,
  WifiOff,
  Globe2,
} from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { useSettingsStore } from "@/store/settings";
import { buildPreviewDoc } from "@/lib/workspace/preview-engine";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui-devspace/button";
import { Badge } from "@/components/ui-devspace/badge";
import type { MockLogEntry, PreviewMode, ProjectFile, ResponsiveDevice } from "@/types/workspace";
import { inspectSameOriginDocument, registerPreviewInspector } from "@/lib/workspace/preview-bridge";

const DEVICE_WIDTHS: Record<ResponsiveDevice, number> = {
  desktop: 1280,
  tablet: 768,
  mobile: 375,
};

const DEVICE_HEIGHTS: Record<ResponsiveDevice, number> = {
  desktop: 800,
  tablet: 1024,
  mobile: 667,
};

const DEVICE_LABELS: Record<ResponsiveDevice, string> = {
  desktop: "Desktop · 1280px",
  tablet: "Tablet · 768px",
  mobile: "Mobile · 375px",
};

export function PreviewPane() {
  const {
    activeProject,
    activeProjectId,
    previewMode,
    device,
    previewKey,
    refreshPreview,
    setDevice,
    loadAllFileContents,
    contentCache,
    previewDiagnostic,
    setPreviewDiagnostic,
    mockLog,
    setMockLog,
    clearMockLog,
  } = useWorkspaceStore();

  // Settings → DevWorkspace → Preview.
  // defaultDevice: applied once when a project opens (sets the initial
  //   device if the workspace store hasn't been touched yet).
  // autoRefresh: when ON, the preview rebuilds automatically on file
  //   changes (already the default behavior via previewKey; when OFF,
  //   the user must click Refresh manually — implemented by short-
  //   circuiting the rebuild effect below).
  // showRuntimeDiagnostics: controls visibility of the diagnostic banner.
  const previewPrefs = useSettingsStore((s) => s.devWorkspace.preview);
  const appliedDefaultDeviceRef = useRef<string | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [previewDoc, setPreviewDoc] = useState("");
  const [buildError, setBuildError] = useState<string | null>(null);
  const [mockPanelOpen, setMockPanelOpen] = useState(false);

  // Apply the default device setting once per project open.
  useEffect(() => {
    if (!activeProjectId) {
      appliedDefaultDeviceRef.current = null;
      return;
    }
    if (appliedDefaultDeviceRef.current === activeProjectId) return;
    appliedDefaultDeviceRef.current = activeProjectId;
    // Only apply the default if the user hasn't already switched device
    // for this project. We detect this by checking if the device is still
    // the workspace store's initial value ("desktop"). This is a heuristic
    // — if the user's default IS "desktop", this is a no-op anyway.
    if (previewPrefs.defaultDevice && previewPrefs.defaultDevice !== "auto") {
      setDevice(previewPrefs.defaultDevice);
    }
  }, [activeProjectId, previewPrefs.defaultDevice, setDevice]);

  // Detect missing configuration in Real mode (computed unconditionally to
  // keep hook order stable).
  const realModeWarnings = useMemo(() => {
    if (!activeProject) return [];
    if (previewMode !== "real") return [];
    const warnings: string[] = [];
    const hasEnv = activeProject.envVars.length > 0;
    const pkg = activeProject.files.find((f) => f.path === "package.json");
    let needsSupabase = false;
    let needsFirebase = false;
    // We can't read the content from FileEntry — it's lazy. We check the
    // framework instead: react/vite projects typically use these.
    if (pkg) {
      // Load package.json synchronously from cache if available.
      const cached = contentCache.get("package.json");
      if (cached) {
        try {
          const deps = JSON.parse(cached).dependencies ?? {};
          if (deps["@supabase/supabase-js"]) needsSupabase = true;
          if (deps["firebase"]) needsFirebase = true;
        } catch {
          // ignore
        }
      }
    }
    if (needsSupabase && !activeProject.envVars.some((e) => e.key.includes("SUPABASE"))) {
      warnings.push("Supabase detected but no SUPABASE_URL / SUPABASE_ANON_KEY in env vars.");
    }
    if (needsFirebase && !activeProject.envVars.some((e) => e.key.includes("FIREBASE"))) {
      warnings.push("Firebase detected but no FIREBASE_API_KEY / FIREBASE_AUTH_DOMAIN in env vars.");
    }
    if (!hasEnv && (needsSupabase || needsFirebase)) {
      warnings.push("Open the Environment Variables panel to add credentials.");
    }
    return warnings;
  }, [previewMode, activeProject, contentCache]);

  // Build the preview document whenever the project files, mode, or refresh key change.
  // We load all text contents from IndexedDB first, then build the doc.
  //
  // Settings → DevWorkspace → Preview → autoRefresh: when OFF, file saves
  // do NOT bump previewKey (gated in the code editor's saveCurrent), so
  // this effect doesn't fire on every save. The user clicks Refresh to
  // force a rebuild (which bumps previewKey). When ON, saves bump
  // previewKey and the preview rebuilds automatically.
  useEffect(() => {
    if (!activeProjectId) return;
    let cancelled = false;
    setLoading(true);
    setBuildError(null);

    (async () => {
      try {
        // Load cache misses only; save operations keep cached content current.
        await loadAllFileContents(activeProjectId);
        const latest = useWorkspaceStore.getState();
        const project = latest.activeProject;
        if (!project || latest.activeProjectId !== activeProjectId) return;
        // Merge into a unified ProjectFile[] for the preview engine.
        const cache = latest.contentCache;
        const files: ProjectFile[] = project.files.map((f) => {
          const content = cache.get(f.path) ?? "";
          return { ...f, content };
        });

        if (cancelled) return;
        const doc = buildPreviewDoc({
          files,
          framework: project.framework,
          mode: previewMode,
          envVars: project.envVars,
        });
        if (!cancelled) {
          setPreviewDoc(doc);
          setPreviewDiagnostic(null);
        }
      } catch (err) {
        console.error("Preview build failed:", err);
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setBuildError(msg);
          setPreviewDiagnostic({ message: msg, source: "preview-build" });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, previewMode, previewKey, loadAllFileContents, setPreviewDiagnostic]);

  // Listen for runtime errors AND mock-log updates from the iframe.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type === "preview-error" && typeof e.data.message === "string") {
        setPreviewDiagnostic({
          message: e.data.message,
          source: e.data.source ?? "iframe-runtime",
        });
      }
      if (e.data?.type === "mock-log-update" && Array.isArray(e.data.log)) {
        setMockLog(e.data.log as MockLogEntry[]);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [setPreviewDiagnostic, setMockLog]);

  useEffect(() => {
    if (loading || !iframeRef.current) return;
    return registerPreviewInspector("instant-preview", async (selector) => {
      const document = iframeRef.current?.contentDocument;
      if (!document) throw new Error("The instant preview DOM is not available yet.");
      return {
        source: "instant-preview",
        ...inspectSameOriginDocument(document, selector),
      };
    });
  }, [loading, previewKey]);

  const handleOpenInNewTab = () => {
    const blob = new Blob([previewDoc], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };

  if (!activeProject) return null;

  const width = DEVICE_WIDTHS[device];
  const height = DEVICE_HEIGHTS[device];
  const isDesktop = device === "desktop";
  const previewUrl = `lucian://preview/${activeProject.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project"}/`;

  return (
    <div className="flex h-full flex-col bg-muted/30">
      {/* Preview toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-card px-3">
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Preview
          </span>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px]",
              previewMode === "real" && "border-emerald-500/30 text-emerald-600",
              previewMode === "demo" && "border-amber-500/30 text-amber-600",
              previewMode === "fake" && "border-zinc-500/30 text-zinc-600",
            )}
          >
            {previewMode.toUpperCase()}
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            {activeProject.framework}
          </Badge>
        </div>

        <div className="hidden min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[10px] text-muted-foreground md:flex">
          <Globe2 className="h-3 w-3 shrink-0" />
          <span className="truncate font-mono" title={previewUrl}>{previewUrl}</span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <div className="mr-2 hidden items-center rounded-md border border-border/50 bg-background p-0.5 lg:flex">
            <DeviceButton device="desktop" current={device} onSelect={setDevice} icon={Monitor} />
            <DeviceButton device="tablet" current={device} onSelect={setDevice} icon={Tablet} />
            <DeviceButton device="mobile" current={device} onSelect={setDevice} icon={Smartphone} />
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refreshPreview} title="Refresh preview">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleOpenInNewTab} title="Open in new tab">
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Real-mode warnings */}
      {realModeWarnings.length > 0 && (
        <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <p className="font-medium">Real mode configuration missing</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5 opacity-90">
              {realModeWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Mode info banner */}
      {previewMode === "fake" && (
        <div className="flex items-center gap-2 border-b border-zinc-500/30 bg-zinc-500/10 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300">
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span>Fake mode — backend calls will be intercepted with simulated responses.</span>
        </div>
      )}

      {/* Diagnostic error banner (from build or runtime).
          Settings → DevWorkspace → Preview → showRuntimeDiagnostics:
          when OFF, the banner is hidden (errors still land in the store,
          but the visual is suppressed). */}
      {(buildError || previewDiagnostic) && previewPrefs.showRuntimeDiagnostics && (
        <DiagnosticBanner
          message={buildError ?? previewDiagnostic?.message ?? ""}
          source={previewDiagnostic?.source}
          onDismiss={() => {
            setBuildError(null);
            setPreviewDiagnostic(null);
          }}
        />
      )}

      {/* Iframe container */}
      <div className="flex-1 overflow-auto bg-zinc-100 dark:bg-zinc-900">
        <div
          className={cn(
            "relative mx-auto my-4 bg-background shadow-lg transition-all duration-200",
            isDesktop ? "w-full" : "rounded-2xl border-4 border-zinc-800",
          )}
          style={{
            width: isDesktop ? "calc(100% - 2rem)" : `${width}px`,
            maxWidth: "100%",
            height: isDesktop ? "calc(100vh - 8rem)" : `${height}px`,
            maxHeight: isDesktop ? undefined : `${height}px`,
          }}
        >
          {loading && (
            <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          <iframe
            ref={iframeRef}
            key={previewKey}
            title="live-preview"
            srcDoc={previewDoc}
            // Phase 11: tightened sandbox. Removed `allow-popups` and
            // `allow-modals` — previews should not be able to open new
            // windows or modal dialogs. Kept `allow-scripts` (needed to
            // run preview code), `allow-forms` (form submissions inside
            // previews), and `allow-same-origin` (needed so srcDoc can
            // access its own DOM + the mock bootstrap can attach
            // listeners). No `allow-top-navigation` — previews cannot
            // redirect the parent LUCIAN window.
            sandbox="allow-scripts allow-forms allow-same-origin"
            className="h-full w-full border-0 bg-background"
            onLoad={() => setLoading(false)}
          />
        </div>
      </div>

      {/* Status bar + mock log panel */}
      <MockLogBar
        mockLog={mockLog}
        open={mockPanelOpen}
        onToggle={() => setMockPanelOpen((o) => !o)}
        onClear={clearMockLog}
        deviceLabel={DEVICE_LABELS[device]}
        fileCount={activeProject.fileCount}
        framework={activeProject.framework}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// MockLogBar — the Live vs Mocked indicator + expandable panel
// ---------------------------------------------------------------------------

interface MockLogBarProps {
  mockLog: MockLogEntry[];
  open: boolean;
  onToggle: () => void;
  onClear: () => void;
  deviceLabel: string;
  fileCount: number;
  framework: string;
}

function MockLogBar({
  mockLog,
  open,
  onToggle,
  onClear,
  deviceLabel,
  fileCount,
  framework,
}: MockLogBarProps) {
  const liveCount = mockLog.filter((e) => e.status === "live").length;
  const mockedCount = mockLog.filter((e) => e.status === "mocked").length;
  const hasCalls = mockLog.length > 0;

  return (
    <div className="shrink-0 border-t bg-card">
      {/* Compact status row */}
      <div className="flex h-7 items-center justify-between px-3 text-[11px]">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggle}
            disabled={!hasCalls}
            className={cn(
              "flex items-center gap-1.5 rounded px-1.5 py-0.5 transition-colors",
              hasCalls ? "hover:bg-accent cursor-pointer" : "cursor-default opacity-60",
            )}
            title={hasCalls ? "Show network call log" : "No network calls yet"}
          >
            <Network className="h-3 w-3 text-muted-foreground" />
            {hasCalls ? (
              <>
                <span className="font-medium">{mockLog.length} call{mockLog.length !== 1 ? "s" : ""}</span>
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <Wifi className="h-2.5 w-2.5" />{liveCount} Live
                </span>
                {mockedCount > 0 && (
                  <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                    <WifiOff className="h-2.5 w-2.5" />{mockedCount} Mocked
                  </span>
                )}
                {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
              </>
            ) : (
              <span className="text-muted-foreground">No API calls yet</span>
            )}
          </button>
        </div>
        <span className="text-muted-foreground">
          {deviceLabel} · {fileCount} files · {framework}
        </span>
      </div>

      {/* Expandable panel */}
      {open && hasCalls && (
        <div className="max-h-64 overflow-y-auto border-t bg-muted/30">
          <div className="sticky top-0 flex items-center justify-between border-b bg-card/80 px-3 py-1 backdrop-blur">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Network calls ({mockLog.length})
            </span>
            <button
              onClick={onClear}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
          <div className="divide-y">
            {mockLog.slice().reverse().map((entry) => (
              <MockLogRow key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MockLogRow({ entry }: { entry: MockLogEntry }) {
  const isLive = entry.status === "live";
  const time = new Date(entry.timestamp).toLocaleTimeString(undefined, {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  // Truncate long URLs for display.
  const displayUrl = entry.url.length > 80
    ? entry.url.slice(0, 77) + "..."
    : entry.url;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono">
      <span className="shrink-0 text-muted-foreground">{time}</span>
      <span className="shrink-0 font-semibold text-muted-foreground">{entry.method}</span>
      <span className="flex-1 truncate" title={entry.url}>{displayUrl}</span>
      <span className="shrink-0 text-muted-foreground">{entry.statusCode}</span>
      <span className="shrink-0">
        {isLive ? (
          <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
            <Wifi className="h-2.5 w-2.5" /> Live
          </span>
        ) : (
          <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400" title={entry.fakeReason}>
            <WifiOff className="h-2.5 w-2.5" /> Mocked
          </span>
        )}
      </span>
    </div>
  );
}

function DiagnosticBanner({
  message,
  source,
  onDismiss,
}: {
  message: string;
  source?: string;
  onDismiss: () => void;
}) {
  return (
    <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
      <div className="flex items-start gap-2">
        <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-destructive">
              Preview {source === "iframe-runtime" ? "runtime" : "build"} error
            </span>
            <button
              type="button"
              aria-label="Dismiss preview error"
              onClick={onDismiss}
              className="rounded p-0.5 hover:bg-destructive/20"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-destructive">
            {message}
          </pre>
        </div>
      </div>
    </div>
  );
}

function DeviceButton({
  device,
  current,
  onSelect,
  icon: Icon,
}: {
  device: ResponsiveDevice;
  current: ResponsiveDevice;
  onSelect: (d: ResponsiveDevice) => void;
  icon: typeof Monitor;
}) {
  return (
    <Button
      variant={current === device ? "default" : "ghost"}
      size="icon"
      className={cn("h-6 w-7", current === device ? "" : "text-muted-foreground")}
      onClick={() => onSelect(device)}
      title={DEVICE_LABELS[device]}
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}
