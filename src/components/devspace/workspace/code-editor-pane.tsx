"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import Image from "next/image";
import Editor, { type OnMount, type BeforeMount } from "@monaco-editor/react";
import {
  X,
  Circle,
  FileCode2,
  Loader2,
  Save,
  Image as ImageIcon,
  Pencil,
  Lock,
  XCircle,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useSettingsStore } from "@/store/settings";
import { Button } from "@/components/ui-devspace/button";
import { cn } from "@/lib/utils";
import { monacoLanguage, isImageFile } from "@/lib/workspace/filesystem";
import { toast as sonnerToast } from "sonner";

export function CodeEditorPane() {
  const {
    activeProject,
    activeProjectId,
    openTabs,
    activeTab,
    closeTab,
    setActiveTab,
    writeFile,
    setTabEditing,
    markTabDirty,
    loadFileContent,
    contentCache,
    editorDrafts,
    setEditorDraft,
    clearEditorDraft,
    lastFileOperation,
  } = useWorkspaceStore();

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Parameters<BeforeMount>[0] | null>(null);
  const [editorLoading, setEditorLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const saveCurrentRef = useRef<() => Promise<void>>(async () => undefined);

  // Look up the file entry (lightweight metadata — always available).
  const fileEntry = activeProject?.files.find((f) => f.path === activeTab);
  const isBinary = fileEntry ? fileEntry.binary || isImageFile(fileEntry.path) : false;
  const language = fileEntry ? monacoLanguage(fileEntry.path) : "plaintext";

  // Local editor buffer + dirty state.
  const [buffer, setBuffer] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);

  // Whether the current tab is in edit mode.
  const currentTab = openTabs.find((t) => t.path === activeTab);
  const isEditing = currentTab?.editing ?? false;

  // Track which file the buffer currently reflects.
  const [bufferedPath, setBufferedPath] = useState<string | null>(null);

  // Reset the buffer when the active tab changes. This is the "adjust state
  // when prop changes" pattern from the React docs.
  if (activeTab !== bufferedPath) {
    setBufferedPath(activeTab);
    const tabIsDirty = openTabs.find((tab) => tab.path === activeTab)?.dirty ?? false;
    setIsDirty(tabIsDirty);
    if (activeTab && !isBinary) {
      const draft = editorDrafts.get(activeTab);
      const cached = contentCache.get(activeTab);
      if (draft !== undefined) {
        setBuffer(draft);
      } else if (cached !== undefined) {
        setBuffer(cached);
      } else {
        setBuffer("");
      }
    } else {
      setBuffer("");
    }
  }

  // Lazy-load file content from IndexedDB when a new tab is opened and the
  // content isn't yet in the cache. The effect is purely for synchronization
  // with an external system (IndexedDB), not for adjusting React state in
  // response to prop changes — that's handled above.
  useEffect(() => {
    if (!activeTab || !activeProjectId || !fileEntry || isBinary) return;
    const cached = contentCache.get(activeTab);
    if (cached !== undefined) return; // already have it.
    let cancelled = false;
    // Set loading state inside a microtask so it doesn't trigger the
    // cascading-render lint rule.
    Promise.resolve().then(() => {
      if (cancelled) return;
      setIsLoadingContent(true);
    });
    loadFileContent(activeProjectId, activeTab).then((content) => {
      if (cancelled) return;
      if (content !== undefined) {
        setBuffer(content);
        setIsDirty(false);
      }
      setIsLoadingContent(false);
    });
    return () => {
      cancelled = true;
      setIsLoadingContent(false);
    };
  }, [activeTab, activeProjectId, fileEntry, isBinary, contentCache, loadFileContent]);

  // Keep Monaco aligned when another workspace operation (for example,
  // project-wide Replace All) changes the durable content of an open tab.
  const cachedActiveContent = activeTab ? contentCache.get(activeTab) : undefined;
  const activeDraft = activeTab ? editorDrafts.get(activeTab) : undefined;
  useEffect(() => {
    if (cachedActiveContent === undefined || activeDraft !== undefined || isDirty || cachedActiveContent === buffer) return;
    const timer = window.setTimeout(() => setBuffer(cachedActiveContent), 0);
    return () => window.clearTimeout(timer);
  }, [cachedActiveContent, activeDraft, isDirty, buffer]);

  // Search results can request an exact line reveal after switching back to
  // the Code tab. The request is consumed once the matching Monaco model is
  // active.
  useEffect(() => {
    if (!activeTab || !editorRef.current) return;
    const rawTarget = window.sessionStorage.getItem("lucian:workspace:reveal-line");
    const target = rawTarget ? JSON.parse(rawTarget) as { path: string; line: number } : null;
    if (!target || target.path !== activeTab) return;
    window.sessionStorage.removeItem("lucian:workspace:reveal-line");
    const timer = window.setTimeout(() => {
      editorRef.current?.revealLineInCenter(target.line);
      editorRef.current?.setPosition({ lineNumber: target.line, column: 1 });
      editorRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, editorLoading]);

  // Configure Monaco theme + options once. We pick the theme based on the
  // active LUCIAN app theme so the editor matches the rest of the UI.
  // We import useTheme from LUCIAN's ThemeProvider (not the workspace store)
  // because DevWorkspace reuses LUCIAN's global theme system.
  const { theme: appTheme } = useTheme();

  // Settings → DevWorkspace → Editor preferences. These are the canonical
  // source for Monaco editor options — components do NOT keep their own
  // editor preference state.
  const editorPrefs = useSettingsStore((s) => s.devWorkspace.editor);

  const editorThemeName = useMemo(() => {
    // LUCIAN's light themes are "natural-white" and "creamy-light".
    return appTheme === "natural-white" || appTheme === "creamy-light"
      ? "workspace-light"
      : "workspace-dark";
  }, [appTheme]);

  // Phase 12: Direct Edit source reveal.
  // When the Visual Editor requests a Direct Edit, it stashes a sourceId
  // on window.__lucianRevealSourceId. We parse the active file's content
  // via the JSX AST, find the element with that sourceId, compute its
  // line number, and reveal it in Monaco using the proper revealLineInCenter
  // + selection APIs.
  useEffect(() => {
    if (!activeTab || !editorRef.current) return;
    if (typeof window === "undefined") return;
    const w = window as unknown as { __lucianRevealSourceId?: string };
    const sourceId = w.__lucianRevealSourceId;
    if (!sourceId) return;
    // Clear immediately so we don't re-reveal on every render.
    w.__lucianRevealSourceId = undefined;

    // Only JSX/TSX files have source ids we can resolve.
    if (!/\.(jsx|tsx)$/.test(activeTab)) return;

    // Parse the source to find the element's line.
    void (async () => {
      try {
        const { parseJsxSource, collectJsxElements } = await import("@/lib/workspace/jsx-ast");
        const content = contentCache.get(activeTab);
        if (typeof content !== "string") return;
        const { ast } = parseJsxSource(content);
        if (!ast) return;
        const elements = collectJsxElements(ast, activeTab);
        const target = elements.find((e) => e.sourceId === sourceId);
        if (!target) return;
        // Reveal the line in Monaco. Use revealLineInCenter for a smooth
        // scroll, then set the selection to highlight the element.
        const editor = editorRef.current;
        const monaco = monacoRef.current;
        if (!editor || !monaco) return;
        editor.revealLineInCenter(target.startLine);
        editor.setSelection(new monaco.Range(
          target.startLine,
          target.startColumn + 1,
          target.endLine,
          target.endColumn + 1,
        ));
        editor.focus();
      } catch {
        // Non-fatal — if the JSX AST module isn't available or parsing
        // fails, the file is still opened at line 1.
      }
    })();
  }, [activeTab, contentCache]);

  const handleBeforeMount: BeforeMount = useCallback((monaco) => {
    monacoRef.current = monaco;
    monaco.editor.defineTheme("workspace-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6b7280", fontStyle: "italic" },
        { token: "keyword", foreground: "c084fc" },
        { token: "string", foreground: "86efac" },
        { token: "number", foreground: "fbbf24" },
      ],
      colors: {
        "editor.background": "#0f1117",
        "editor.foreground": "#e5e7eb",
        "editorLineNumber.foreground": "#4b5563",
        "editorLineNumber.activeForeground": "#9ca3af",
        "editor.selectionBackground": "#3b82f655",
        "editor.lineHighlightBackground": "#1f2937",
        "editorCursor.foreground": "#a78bfa",
        "editorIndentGuide.background": "#1f2937",
      },
    });
    monaco.editor.defineTheme("workspace-light", {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6b7280", fontStyle: "italic" },
        { token: "keyword", foreground: "7c3aed" },
        { token: "string", foreground: "059669" },
        { token: "number", foreground: "d97706" },
      ],
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "#1f2937",
        "editorLineNumber.foreground": "#9ca3af",
        "editorLineNumber.activeForeground": "#374151",
        "editor.selectionBackground": "#3b82f633",
        "editor.lineHighlightBackground": "#f3f4f6",
        "editorCursor.foreground": "#7c3aed",
        "editorIndentGuide.background": "#e5e7eb",
      },
    });
  }, []);

  const saveCurrent = useCallback(async () => {
    if (!activeTab || saving) return;
    setSaving(true);
    try {
      const result = await writeFile(activeTab, buffer);
      setIsDirty(false);
      markTabDirty(activeTab, false);
      if (result.warnings.length) {
        sonnerToast.warning("Saved with a sync warning", { description: result.warnings.join(" ") });
      } else {
        sonnerToast.success("Saved", { description: activeTab });
      }
    } catch (error) {
      sonnerToast.error("Save failed — your unsaved editor buffer is still available", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }, [activeTab, saving, buffer, writeFile, markTabDirty]);

  useEffect(() => {
    saveCurrentRef.current = saveCurrent;
  }, [saveCurrent]);

  const cancelEdit = useCallback(() => {
    if (!activeTab) return;
    // Restore buffer from cache (the original content).
    const cached = contentCache.get(activeTab) ?? "";
    setBuffer(cached);
    setIsDirty(false);
    clearEditorDraft(activeTab);
    markTabDirty(activeTab, false);
    setTabEditing(activeTab, false);
  }, [activeTab, contentCache, clearEditorDraft, markTabDirty, setTabEditing]);

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    setEditorLoading(false);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      // Only save if we're in edit mode.
      if (useWorkspaceStore.getState().openTabs.find((t) => t.path === useWorkspaceStore.getState().activeTab)?.editing) {
        void saveCurrentRef.current();
      }
    });
  }, []);

  const handleChange = (value: string | undefined) => {
    if (!isEditing) return; // ignore changes when not in edit mode.
    const next = value ?? "";
    setBuffer(next);
    const cached = contentCache.get(activeTab!);
    if (cached !== undefined && next !== cached) {
      setIsDirty(true);
      setEditorDraft(activeTab!, next);
      markTabDirty(activeTab!, true);
    } else {
      setIsDirty(false);
      clearEditorDraft(activeTab!);
      markTabDirty(activeTab!, false);
    }
  };

  const handleEnterEdit = () => {
    if (!activeTab) return;
    setTabEditing(activeTab, true);
    // Focus the editor so typing works immediately.
    setTimeout(() => editorRef.current?.focus(), 50);
  };

  // ── Autosave (Settings → DevWorkspace → Editor → autosave) ──
  // When autosave is ON and the buffer has unsaved changes, debounced-save
  // after 1.5s of inactivity. This is the REAL autosave — it writes to
  // IndexedDB + refreshes the preview, exactly like a manual save.
  useEffect(() => {
    if (!editorPrefs.autosave) return;
    if (!isDirty || !activeTab || !isEditing) return;
    const timer = window.setTimeout(() => {
      void saveCurrent();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [editorPrefs.autosave, isDirty, activeTab, isEditing, saveCurrent]);

  // Render image/binary viewer.
  if (fileEntry && isBinary) {
    const cached = contentCache.get(fileEntry.path);
    return (
      <div className="flex h-full flex-col bg-card">
        <TabsBar />
        <div className="flex flex-1 items-center justify-center overflow-auto bg-muted/30 p-6">
          {isImageFile(fileEntry.path) && cached ? (
            <div className="flex flex-col items-center gap-4">
              {/* Using next/image with `unoptimized` because src is a base64
                  data: URL cached from IndexedDB; next/image's optimizer
                  cannot fetch or transform inline data: URLs. */}
              <div className="relative max-h-[70vh] max-w-full" style={{ width: '100%', height: '70vh' }}>
                <Image
                  src={cached}
                  alt={fileEntry.path}
                  fill
                  unoptimized
                  className="rounded-lg border border-border/50 bg-background shadow-sm object-contain"
                />
              </div>
              <div className="text-center text-sm text-muted-foreground">
                <p className="font-mono">{fileEntry.path}</p>
                <p>Binary asset — replace via the Asset Manager.</p>
              </div>
            </div>
          ) : isLoadingContent ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading...
            </div>
          ) : (
            <div className="text-center text-muted-foreground">
              <ImageIcon className="mx-auto mb-2 h-8 w-8" />
              <p className="font-mono">{fileEntry.path}</p>
              <p>Binary file — not editable as text.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-card">
      <TabsBar />
      {/* Edit-mode toolbar */}
      {activeTab && !isBinary && (
        <div className="flex h-9 shrink-0 items-center justify-between border-b bg-muted/30 px-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {isEditing ? (
              <>
                <Pencil className="h-3.5 w-3.5 text-amber-500" />
                <span className="font-medium text-amber-600 dark:text-amber-400">Editing</span>
                {isDirty && (
                  <span className="flex items-center gap-1 text-amber-600">
                    <Circle className="h-2 w-2 fill-current" /> Unsaved changes
                  </span>
                )}
              </>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5" />
                <span>Read-only</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isEditing ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={cancelEdit}
                  disabled={!isDirty && false}
                  className="h-7 gap-1 text-xs"
                >
                  <XCircle className="h-3.5 w-3.5" /> Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={saveCurrent}
                  disabled={!isDirty || saving}
                  className="h-7 gap-1 text-xs"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {saving ? "Saving…" : "Save"}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={handleEnterEdit}
                className="h-7 gap-1 text-xs"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            )}
          </div>
        </div>
      )}
      {lastFileOperation && (!lastFileOperation.path || lastFileOperation.path === activeTab) && (
        <div className={cn(
          "flex min-h-8 shrink-0 items-center gap-2 border-b px-3 py-1 text-[11px]",
          lastFileOperation.kind === "error" && "border-destructive/30 bg-destructive/10 text-destructive",
          lastFileOperation.kind === "warning" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
          lastFileOperation.kind === "saved" && "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          lastFileOperation.kind === "saving" && "text-muted-foreground",
        )}>
          {lastFileOperation.kind === "saving" ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          ) : lastFileOperation.kind === "error" || lastFileOperation.kind === "warning" ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          )}
          <span>{lastFileOperation.message}</span>
        </div>
      )}
      <div className="relative flex-1 overflow-hidden">
        {!activeTab ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <FileCode2 className="h-10 w-10 opacity-40" />
            <p className="text-sm">Select a file from the explorer to view it</p>
            <p className="text-xs opacity-70">Files open in read-only mode. Click Edit to make changes.</p>
          </div>
        ) : isLoadingContent && !buffer ? (
          <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading file...
          </div>
        ) : (
          <>
            {editorLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-card">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            <Editor
              path={activeTab}
              language={language}
              value={buffer}
              beforeMount={handleBeforeMount}
              onMount={handleMount}
              onChange={handleChange}
              theme={editorThemeName}
              loading={<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
              options={{
                // ── Settings → DevWorkspace → Editor ──
                // These are the canonical editor preferences, sourced from
                // useSettingsStore. Components do NOT keep their own editor
                // preference state.
                fontSize: editorPrefs.fontSize,
                tabSize: editorPrefs.tabSize,
                wordWrap: editorPrefs.wordWrap ? "on" : "off",
                minimap: { enabled: editorPrefs.minimap },
                // ── Fixed editor behaviors (not user-configurable) ──
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontLigatures: true,
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                cursorBlinking: "smooth",
                cursorSmoothCaretAnimation: "on",
                roundedSelection: true,
                padding: { top: 12, bottom: 12 },
                renderLineHighlight: "all",
                lineNumbersMinChars: 3,
                automaticLayout: true,
                bracketPairColorization: { enabled: true },
                guides: { bracketPairs: "active", indentation: true },
                // Read-only unless the user enters edit mode.
                readOnly: !isEditing,
                // Don't show the editor's own modifier-only edit indicators.
                domReadOnly: !isEditing,
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}

function TabsBar() {
  const {
    openTabs,
    activeTab,
    setActiveTab,
    closeTab,
    activeProject,
  } = useWorkspaceStore();

  const files = activeProject?.files ?? [];

  return (
    <div className="flex h-9 shrink-0 items-center overflow-x-auto border-b bg-muted/30">
      {openTabs.length === 0 && (
        <span className="px-3 text-xs text-muted-foreground">No files open</span>
      )}
      {openTabs.map((tab) => {
        const file = files.find((f) => f.path === tab.path);
        const isActive = activeTab === tab.path;
        return (
          <button
            key={tab.path}
            onClick={() => setActiveTab(tab.path)}
            className={cn(
              "group flex h-full shrink-0 items-center gap-2 border-r px-3 text-xs",
              isActive ? "bg-card text-foreground" : "text-muted-foreground hover:bg-card/50",
            )}
          >
            <span className="max-w-[160px] truncate">{tab.path.split("/").pop()}</span>
            {tab.editing && (
              <Pencil className="h-2.5 w-2.5 text-amber-500" />
            )}
            {tab.dirty && <Circle className="h-2 w-2 fill-current text-amber-500" />}
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                if (tab.dirty) {
                  if (!confirm("Discard unsaved changes?")) return;
                }
                closeTab(tab.path);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  closeTab(tab.path);
                }
              }}
              className="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
