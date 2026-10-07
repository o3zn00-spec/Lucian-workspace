"use client";

// Visual Editor Studio — main view.
//
// Three-pane layout when a project is loaded:
//   ┌───────────────┬─────────────────────────────┬───────────────┐
//   │ Pages/Layers/ │      Visual Canvas          │  Style inspector│
//   │ Assets/Files  │  (live preview + click-     │               │
//   │ /Context      │   to-select, OR direct-edit  │               │
//   │               │   when no rendering)        │               │
//   └───────────────┴─────────────────────────────┴───────────────┘
//
// When NO project is loaded → Start Workspace (project chooser).
// When project can't render → Direct Edit canvas (never refuses).
// When project can render  → Live Canvas with element selection.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelGroup, Panel, PanelResizeHandle } from "react-resizable-panels";
import {
  Bot,
  FileText,
  ImageIcon,
  Layers as LayersIcon,
  Redo2,
  Sliders,
  Undo2,
  Wand2,
} from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { useSettingsStore } from "@/store/settings";
import {
  analyzeProject,
  insertHtmlChild,
  reorderHtmlElement,
  type VisualElementSpec,
  type VisualMutationRecord,
  type VisualNode,
} from "@/lib/workspace/visual-editor";
import { VisualCanvas } from "./visual-canvas";
import { DirectEditCanvas } from "./direct-edit-canvas";
import { LayersPanel } from "./layers-panel";
import { AssetsPanel } from "./assets-panel";
import { PagesPanel } from "./pages-panel";
import { StyleInspector } from "./style-inspector";
import { VisualEditorStartWorkspace } from "./visual-editor-start-workspace";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

type LeftTab = "pages" | "layers" | "assets";

export function VisualEditorView() {
  const activeProject = useWorkspaceStore((s) => s.activeProject);
  const openTab = useWorkspaceStore((s) => s.openTab);

  // Settings → DevWorkspace → Visual Editor.
  // - snapshotBeforeStructuralEdit: when ON, create a project version
  //   snapshot before structural visual edits (reorder, resize). When
  //   OFF, skip the snapshot (the edit still happens, but there's no
  //   recoverable version). Default ON.
  // - showSourceMapping: passed to the canvas to control source-mapping
  //   UI visibility.
  const visualEditorPrefs = useSettingsStore((s) => s.devWorkspace.visualEditor);

  const [leftTab, setLeftTab] = useState<LeftTab>("layers");
  const [rootNode, setRootNode] = useState<VisualNode | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Phase 12: source mapping from the preview instrumentation.
  const [selectedSourceFile, setSelectedSourceFile] = useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [entrySelection, setEntrySelection] = useState<{ projectId: string | null; path: string }>({ projectId: null, path: "" });
  const undoStack = useRef<VisualMutationRecord[]>([]);
  const redoStack = useRef<VisualMutationRecord[]>([]);
  const historyProjectId = useRef<string | null>(null);
  const [historyState, setHistoryState] = useState<{ projectId: string | null; undo: number; redo: number }>({ projectId: null, undo: 0, redo: 0 });

  const analysis = useMemo(
    () => analyzeProject(activeProject),
    [activeProject],
  );

  const activeEntry = entrySelection.projectId === activeProject?.id && entrySelection.path
    ? entrySelection.path
    : analysis?.entryFile ?? "";

  const handleRecordMutation = useCallback((record: VisualMutationRecord) => {
    if (record.before === record.after) return;
    const projectId = useWorkspaceStore.getState().activeProjectId;
    if (historyProjectId.current !== projectId) {
      historyProjectId.current = projectId;
      undoStack.current = [];
      redoStack.current = [];
    }
    undoStack.current = [...undoStack.current.slice(-49), record];
    redoStack.current = [];
    setHistoryState({ projectId, undo: undoStack.current.length, redo: 0 });
  }, []);

  const handleUndo = useCallback(async () => {
    const projectId = useWorkspaceStore.getState().activeProjectId;
    if (historyProjectId.current !== projectId) {
      historyProjectId.current = projectId;
      undoStack.current = [];
      redoStack.current = [];
      setHistoryState({ projectId, undo: 0, redo: 0 });
      return;
    }
    const record = undoStack.current.pop();
    if (!record) return;
    try {
      await useWorkspaceStore.getState().writeFile(record.filePath, record.before);
      redoStack.current.push(record);
      useWorkspaceStore.getState().refreshPreview();
      setHistoryState({ projectId, undo: undoStack.current.length, redo: redoStack.current.length });
      toast({ title: `Undo: ${record.label}` });
    } catch (error) {
      undoStack.current.push(record);
      toast({ title: "Undo failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  }, []);

  const handleRedo = useCallback(async () => {
    const projectId = useWorkspaceStore.getState().activeProjectId;
    if (historyProjectId.current !== projectId) {
      historyProjectId.current = projectId;
      undoStack.current = [];
      redoStack.current = [];
      setHistoryState({ projectId, undo: 0, redo: 0 });
      return;
    }
    const record = redoStack.current.pop();
    if (!record) return;
    try {
      await useWorkspaceStore.getState().writeFile(record.filePath, record.after);
      undoStack.current.push(record);
      useWorkspaceStore.getState().refreshPreview();
      setHistoryState({ projectId, undo: undoStack.current.length, redo: redoStack.current.length });
      toast({ title: `Redo: ${record.label}` });
    } catch (error) {
      redoStack.current.push(record);
      toast({ title: "Redo failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      event.preventDefault();
      if (event.shiftKey) void handleRedo();
      else void handleUndo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRedo, handleUndo]);

  const handleInspection = useCallback((root: VisualNode) => {
    setRootNode(root);
  }, []);

  const handleSelect = useCallback(
    (id: string | null, sourceFile?: string | null, sourceId?: string | null) => {
      setSelectedId(id);
      setSelectedSourceFile(sourceFile ?? null);
      setSelectedSourceId(sourceId ?? null);
      // Store on window so the canvas's SelectionInfoBar can read it.
      if (typeof window !== "undefined") {
        (window as unknown as { __lucianSelectedSourceFile?: string }).__lucianSelectedSourceFile = sourceFile ?? undefined;
        (window as unknown as { __lucianSelectedSourceId?: string }).__lucianSelectedSourceId = sourceId ?? undefined;
      }
    },
    [],
  );

  const handlePatched = useCallback(() => {
    setRootNode(null);
    // Phase 12: selection restoration — keep the same sourceId selected
    // after a hot reload so the user sees their edit applied to the
    // same element. The canvas will re-resolve the source mapping on
    // the next inspection message.
  }, []);

  // Phase 12: Direct Edit — open Monaco at the source location.
  const handleDirectEdit = useCallback(
    (sourceFile: string, sourceId: string) => {
      // Open the file in the workspace editor.
      openTab(sourceFile);
      // Switch to the Workspace view so the user sees Monaco.
      useWorkspaceStore.getState().setView("workspace");
      // The Monaco editor's reveal/selection is handled by the
      // workspace-view component, which reads the source-id from a
      // shared store on mount. We stash it on the workspace store via
      // a transient field — the editor picks it up on next render.
      if (typeof window !== "undefined") {
        (window as unknown as { __lucianRevealSourceId?: string }).__lucianRevealSourceId = sourceId;
      }
    },
    [openTab],
  );

  const handleOpenSource = useCallback((path: string) => {
    openTab(path);
    useWorkspaceStore.getState().setView("workspace");
  }, [openTab]);

  const handleCreatePage = useCallback(async () => {
    if (!activeProject || !analysis) return;
    const requested = window.prompt("Page name or route", "new-page");
    if (!requested) return;
    const slug = requested.trim().toLowerCase().replace(/[^a-z0-9/_-]+/g, "-").replace(/^\/+|\/+$/g, "");
    if (!slug) return;
    let path: string;
    let content: string;
    if (activeProject.framework === "nextjs") {
      const appRoot = activeProject.files.some((file) => file.path.startsWith("src/app/")) ? "src/app" : "app";
      path = `${appRoot}/${slug}/page.tsx`;
      const component = slug.split("/").map((part) => part.replace(/(^|-)(\w)/g, (_match, _dash, letter: string) => letter.toUpperCase())).join("");
      content = `export default function ${component || "NewPage"}Page() {\n  return (\n    <main style={{ padding: "48px", minHeight: "100vh" }}>\n      <h1>${requested.trim()}</h1>\n      <p>Start designing this page in LUCIAN Visual Editor.</p>\n    </main>\n  );\n}\n`;
    } else if (analysis.htmlFiles.length || activeProject.framework === "html" || activeProject.framework === "static") {
      path = `${slug}.html`;
      content = `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>${requested.trim()}</title>\n</head>\n<body>\n  <main style="padding: 48px; min-height: 100vh;">\n    <h1>${requested.trim()}</h1>\n    <p>Start designing this page in LUCIAN Visual Editor.</p>\n  </main>\n</body>\n</html>\n`;
    } else {
      const component = slug.replace(/(^|-)(\w)/g, (_match, _dash, letter: string) => letter.toUpperCase());
      path = `src/pages/${component || "NewPage"}.tsx`;
      content = `export default function ${component || "NewPage"}() {\n  return (\n    <main style={{ padding: "48px", minHeight: "100vh" }}>\n      <h1>${requested.trim()}</h1>\n      <p>Start designing this page in LUCIAN Visual Editor.</p>\n    </main>\n  );\n}\n`;
    }
    try {
      await useWorkspaceStore.getState().createFile(path, content);
      setEntrySelection({ projectId: activeProject.id, path });
      useWorkspaceStore.getState().setView("visual-editor");
      toast({ title: "Page created", description: path });
    } catch (error) {
      toast({ title: "Page creation failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  }, [activeProject, analysis]);

  const handleCanvasInsert = useCallback(async (spec: VisualElementSpec, label: string) => {
    if (!activeProject || !selectedSourceId) {
      toast({ title: "Select a parent layer first" });
      return;
    }
    const sourceFile = selectedSourceFile || activeEntry;
    if (!sourceFile) return;
    const store = useWorkspaceStore.getState();
    try {
      const before = await store.loadFileContent(activeProject.id, sourceFile);
      if (typeof before !== "string") throw new Error(`Could not load ${sourceFile}.`);
      await store.createSnapshot(`Visual Edit — ${label}`);
      let after: string;
      if (/\.html?$/i.test(sourceFile)) {
        after = insertHtmlChild(before, selectedSourceId, spec);
      } else {
        const { insertJsxChild } = await import("@/lib/workspace/jsx-ast");
        const result = insertJsxChild(before, selectedSourceId, sourceFile, spec);
        if (result.status !== "ok") throw new Error(result.error ?? `Insert failed: ${result.status}`);
        after = result.source;
      }
      await store.writeFile(sourceFile, after);
      handleRecordMutation({ filePath: sourceFile, before, after, label });
      store.refreshPreview();
      toast({ title: label });
    } catch (error) {
      toast({ title: "Insert failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  }, [activeProject, activeEntry, selectedSourceFile, selectedSourceId, handleRecordMutation]);

  // Phase 12 final: canvas drag/drop reorder — uses the existing AST
  // reorderJsxElement() function. Creates a snapshot before the reorder
  // (gated by Settings → DevWorkspace → Visual Editor → snapshotBeforeStructuralEdit).
  const handleCanvasReorder = useCallback(
    async (sourceId: string, targetSourceId: string, position: "before" | "after", explicitSourceFile?: string) => {
      if (!activeProject) return;
      const sourceFile =
        explicitSourceFile || (
          (typeof window !== "undefined" ? (window as unknown as { __lucianSelectedSourceFile?: string }).__lucianSelectedSourceFile : undefined) ?? activeEntry
        );
      if (!sourceFile) return;
      try {
        const { reorderJsxElement } = await import("@/lib/workspace/jsx-ast");
        const { saveVersion, trimProjectHistory } = await import("@/lib/workspace/db");
        const { newId } = await import("@/lib/workspace/project");
        const store = useWorkspaceStore.getState();
        const source = await store.loadFileContent(activeProject.id, sourceFile);
        if (typeof source !== "string") return;
        // Snapshot before reorder (gated by Settings).
        if (visualEditorPrefs.snapshotBeforeStructuralEdit) {
          const files = await store.getActiveProjectFiles();
          await saveVersion({
            id: newId("ver"),
            projectId: activeProject.id,
            label: `Visual Edit — Reordered element`,
            createdAt: Date.now(),
            files,
            previewMode: store.previewMode,
          });
          // Enforce maxLocalHistory retention (Settings → DevWorkspace → Projects).
          await trimProjectHistory(activeProject.id, useSettingsStore.getState().devWorkspace.projects.maxLocalHistory);
        }
        if (/\.html?$/i.test(sourceFile)) {
          const after = reorderHtmlElement(source, sourceId, targetSourceId, position);
          await store.writeFile(sourceFile, after);
          handleRecordMutation({ filePath: sourceFile, before: source, after, label: "Reordered layer" });
          store.refreshPreview();
        } else {
          const result = reorderJsxElement(source, sourceId, sourceFile, { kind: position, targetSourceId });
          if (result.status === "ok") {
            await store.writeFile(sourceFile, result.source);
            handleRecordMutation({ filePath: sourceFile, before: source, after: result.source, label: "Reordered layer" });
            store.refreshPreview();
          }
        }
      } catch (error) {
        toast({ title: "Layer reorder failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
      }
    },
    [activeProject, activeEntry, visualEditorPrefs.snapshotBeforeStructuralEdit, handleRecordMutation],
  );

  // Phase 12 final integration pass: canvas resize is strategy-aware.
  //
  // Before committing the resize, we resolve the element's source mapping
  // (just like the Style Inspector does) and choose the appropriate mutator:
  //
  //   A. Tailwind static className  → setTailwindUtility for `width`/`height`
  //                                    at the active breakpoint. The user
  //                                    can set the breakpoint in the inspector
  //                                    before resizing; we read the inspector's
  //                                    choice via the shared window slot.
  //                                    If the exact pixel size has no clean
  //                                    Tailwind equivalent, we use the
  //                                    arbitrary value form `w-[517px]`.
  //   B. CSS / CSS Module rule        → setCssDeclaration on the isolated
  //                                    local CSS rule that owns the element.
  //                                    Broad selectors (`div {}`, `* {}`)
  //                                    are rejected → Direct Edit.
  //   C. Inline `style`               → setInlineStyle on the `style`
  //                                    attribute (object expression).
  //   D. Dynamic className / dynamic
  //      style / unknown source       → Direct Edit (no silent source
  //                                    mutation that would conflict with
  //                                    the existing styling strategy).
  const handleCanvasResize = useCallback(
    async (sourceId: string, width: number | null, height: number | null) => {
      if (!activeProject) return;
      const sourceFile =
        (typeof window !== "undefined" ? (window as unknown as { __lucianSelectedSourceFile?: string }).__lucianSelectedSourceFile : undefined) ??
        activeEntry;
      if (!sourceFile) return;
      try {
        const { resolveSourceMapping } = await import("@/lib/workspace/source-map");
        const { setInlineStyle, isJsxFile } = await import("@/lib/workspace/jsx-ast");
        const { setTailwindUtility, suggestTailwindBody } = await import("@/lib/workspace/tailwind-mutator");
        const { saveVersion, trimProjectHistory } = await import("@/lib/workspace/db");
        const { newId } = await import("@/lib/workspace/project");
        const store = useWorkspaceStore.getState();
        let source = await store.loadFileContent(activeProject.id, sourceFile);
        if (typeof source !== "string") return;
        const before = source;
        // Snapshot before resize (gated by Settings).
        if (visualEditorPrefs.snapshotBeforeStructuralEdit) {
          const files = await store.getActiveProjectFiles();
          await saveVersion({
            id: newId("ver"),
            projectId: activeProject.id,
            label: `Visual Edit — Resized element`,
            createdAt: Date.now(),
            files,
            previewMode: store.previewMode,
          });
          // Enforce maxLocalHistory retention.
          await trimProjectHistory(activeProject.id, useSettingsStore.getState().devWorkspace.projects.maxLocalHistory);
        }

        // Resolve the source mapping to pick the right mutator.
        const mapping = await resolveSourceMapping(
          activeProject,
          sourceFile,
          sourceId,
          null, // no VisualNode available here — mapping falls back to AST
          async (path) => store.loadFileContent(activeProject.id, path),
        );
        if (!mapping) {
          // No mapping → fall back to inline style on the source file
          // (only if it's a JSX/HTML file we can write to).
          if (isJsxFile(sourceFile)) {
            if (width !== null) {
              const r = setInlineStyle(source, sourceId, sourceFile, "width", `${width}px`);
              if (r.status === "ok") source = r.source;
            }
            if (height !== null) {
              const r = setInlineStyle(source, sourceId, sourceFile, "height", `${height}px`);
              if (r.status === "ok") source = r.source;
            }
          } else {
            // Can't safely mutate — Direct Edit.
            openTab(sourceFile);
            useWorkspaceStore.getState().setView("workspace");
            return;
          }
        } else if (mapping.strategy === "tailwind-static" && mapping.jsxElement) {
          // ── A. Tailwind static className ──
          // Use the inspector's current breakpoint (default "base").
          const bp = (typeof window !== "undefined"
            ? (window as unknown as { __lucianResizeBreakpoint?: string }).__lucianResizeBreakpoint
            : undefined) as
            | "base" | "sm" | "md" | "lg" | "xl" | "2xl" | undefined;
          const breakpoint = bp ?? "base";
          const currentClassName = mapping.jsxElement.className ?? "";
          let newClassName = currentClassName;
          if (width !== null) {
            const wBody = suggestTailwindBody("width", `${width}px`) || `w-[${width}px]`;
            newClassName = setTailwindUtility(newClassName, wBody, "width", breakpoint);
          }
          if (height !== null) {
            const hBody = suggestTailwindBody("height", `${height}px`) || `h-[${height}px]`;
            newClassName = setTailwindUtility(newClassName, hBody, "height", breakpoint);
          }
          const { setClassName } = await import("@/lib/workspace/jsx-ast");
          const r = setClassName(source, sourceId, sourceFile, newClassName);
          if (r.status === "ok") source = r.source;
        } else if (mapping.strategy === "css-rule") {
          // ── B. CSS / CSS Module rule ──
          //
          // The Style Inspector's CSS-row UI is the canonical path for
          // explicit CSS edits — it has access to the VisualNode (and
          // thus the element's className) which the resize handler
          // does NOT have. To avoid guessing the wrong CSS rule from
          // an unknown className, we conservatively fall back to inline
          // style on the JSX element (when the source IS a JSX file)
          // or Direct Edit. The user can then use the CSS-row UI to
          // move the resize into the proper CSS rule if desired.
          if (isJsxFile(sourceFile)) {
            if (width !== null) {
              const r = setInlineStyle(source, sourceId, sourceFile, "width", `${width}px`);
              if (r.status === "ok") source = r.source;
            }
            if (height !== null) {
              const r = setInlineStyle(source, sourceId, sourceFile, "height", `${height}px`);
              if (r.status === "ok") source = r.source;
            }
          } else {
            // CSS file directly — we don't know which rule to mutate.
            openTab(sourceFile);
            useWorkspaceStore.getState().setView("workspace");
            return;
          }
        } else if (mapping.strategy === "jsx-ast" || mapping.strategy === "html-dom") {
          // ── C. Inline style ──
          if (isJsxFile(sourceFile)) {
            if (width !== null) {
              const r = setInlineStyle(source, sourceId, sourceFile, "width", `${width}px`);
              if (r.status === "ok") source = r.source;
            }
            if (height !== null) {
              const r = setInlineStyle(source, sourceId, sourceFile, "height", `${height}px`);
              if (r.status === "ok") source = r.source;
            }
          } else if (sourceFile.endsWith(".html") || sourceFile.endsWith(".htm")) {
            // HTML — patch the inline style attribute via DOMParser.
            const { patchFileContent } = await import("@/lib/workspace/visual-editor");
            if (width !== null) {
              source = patchFileContent(sourceFile, source, sourceId, { kind: "style", property: "width", value: `${width}px` });
            }
            if (height !== null) {
              source = patchFileContent(sourceFile, source, sourceId, { kind: "style", property: "height", value: `${height}px` });
            }
          }
        } else {
          // ── D. Dynamic / Direct Edit ──
          openTab(sourceFile);
          useWorkspaceStore.getState().setView("workspace");
          if (typeof window !== "undefined") {
            (window as unknown as { __lucianRevealSourceId?: string }).__lucianRevealSourceId = sourceId;
          }
          return;
        }
        await store.writeFile(sourceFile, source);
        handleRecordMutation({ filePath: sourceFile, before, after: source, label: "Resized element" });
        store.refreshPreview();
      } catch (error) {
        toast({ title: "Resize failed", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
      }
    },
    [activeProject, activeEntry, openTab, visualEditorPrefs.snapshotBeforeStructuralEdit, handleRecordMutation],
  );

  const selectedNode = useMemo(() => {
    if (!rootNode || !selectedId) return null;
    return findNode(rootNode, selectedId);
  }, [rootNode, selectedId]);

  // No active project → Start Workspace (composer).
  if (!activeProject || !analysis) {
    return <VisualEditorStartWorkspace />;
  }

  // Project loaded — choose canvas based on analysis mode.
  const isLiveCanvas = analysis.mode === "live-canvas";

  return (
    <div className="flex h-full flex-col">
      {/* Mode badge bar */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-line-muted bg-surface-2/40 px-3">
        <div className="flex items-center gap-2 text-xs">
          <Wand2 className="h-3.5 w-3.5 text-accent" />
          <span className="font-medium text-fg">Visual Editor Studio</span>
          <span className="text-fg-faint">·</span>
          <span className="text-fg-muted">{activeProject.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => void handleUndo()} disabled={historyState.projectId !== activeProject.id || historyState.undo === 0} className="focus-ring flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-hover disabled:opacity-30" title="Undo visual edit (Ctrl/Cmd+Z)"><Undo2 className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => void handleRedo()} disabled={historyState.projectId !== activeProject.id || historyState.redo === 0} className="focus-ring flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-hover disabled:opacity-30" title="Redo visual edit (Ctrl/Cmd+Shift+Z)"><Redo2 className="h-3.5 w-3.5" /></button>
          <span className="mx-1 h-4 w-px bg-line" />
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", isLiveCanvas ? "bg-[color-mix(in_srgb,var(--accent)_15%,transparent)] text-accent" : "bg-amber-500/15 text-amber-600 dark:text-amber-400")}>
            {analysis.modeLabel}
          </span>
        </div>
      </div>

      {/* Three-pane layout */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <PanelGroup direction="horizontal">
          {/* LEFT: Framer-style Pages / Layers / Assets */}
          <Panel defaultSize={18} minSize={12} maxSize={28}>
            <div className="flex h-full flex-col">
              <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-line-muted bg-surface-2/40 px-1">
                <LeftTabBtn active={leftTab === "pages"} onClick={() => setLeftTab("pages")} icon={FileText} label="Pages" />
                <LeftTabBtn active={leftTab === "layers"} onClick={() => setLeftTab("layers")} icon={LayersIcon} label="Layers" disabled={!isLiveCanvas} />
                <LeftTabBtn active={leftTab === "assets"} onClick={() => setLeftTab("assets")} icon={ImageIcon} label="Assets" />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {leftTab === "pages" ? (
                  <PagesPanel analysis={analysis} activeEntry={activeEntry} onSelect={(path) => { setEntrySelection({ projectId: activeProject.id, path }); setRootNode(null); handleSelect(null); }} onCreate={() => void handleCreatePage()} />
                ) : leftTab === "layers" ? (
                  isLiveCanvas ? (
                    <LayersPanel
                      root={rootNode}
                      entryFile={activeEntry}
                      selectedId={selectedId}
                      onSelect={handleSelect}
                      onReorder={(sourceId, targetSourceId, position, sourceFile) => void handleCanvasReorder(sourceId, targetSourceId, position, sourceFile)}
                    />
                  ) : (
                    <DisabledPanel
                      label="Layers available in Live Canvas mode"
                      hint="This project doesn't have a previewable entry — use Direct Edit or the Workspace Code editor."
                    />
                  )
                ) : leftTab === "assets" ? (
                  <AssetsPanel analysis={analysis} onOpenSource={handleOpenSource} onInsertElement={(spec, label) => void handleCanvasInsert(spec, label)} canInsert={!!selectedSourceId} />
                ) : null}
              </div>
            </div>
          </Panel>
          <PanelResizeHandle className="w-1 bg-border hover:bg-primary/30 transition-colors" />

          {/* CENTER: Canvas (Live or Direct Edit) */}
          <Panel defaultSize={56} minSize={30}>
            {isLiveCanvas && activeEntry ? (
              <VisualCanvas
                entryFile={activeEntry}
                onInspection={handleInspection}
                onSelect={handleSelect}
                selectedId={selectedId}
                onDirectEdit={handleDirectEdit}
                onCanvasReorder={handleCanvasReorder}
                onCanvasResize={handleCanvasResize}
                onCanvasInsert={(spec, label) => void handleCanvasInsert(spec, label)}
              />
            ) : (
              <DirectEditCanvas analysis={analysis} />
            )}
          </Panel>
          <PanelResizeHandle className="w-1 bg-border hover:bg-primary/30 transition-colors" />

          {/* RIGHT: Style inspector */}
          <Panel defaultSize={26} minSize={18}>
            <div className="flex h-full flex-col">
              <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-line-muted bg-surface-2/40 px-1">
                <div className="flex flex-1 items-center justify-center gap-1.5 px-2 py-1 text-[11px] font-medium">
                  <Sliders className="h-3 w-3" /> Style
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {isLiveCanvas && activeEntry ? (
                    <div className="h-full overflow-y-auto">
                      <StyleInspector
                        node={selectedNode}
                        entryFile={activeEntry}
                        onPatched={handlePatched}
                        sourceFile={selectedSourceFile}
                        sourceId={selectedSourceId}
                        onDirectEdit={handleDirectEdit}
                        onRecordMutation={handleRecordMutation}
                      />
                    </div>
                  ) : (
                    <DisabledPanel
                      label="Style inspector needs Live Canvas"
                      hint="Direct Edit mode doesn't expose element selection. Use the Workspace Code editor."
                    />
                  )}
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}

function LeftTabBtn({
  active,
  onClick,
  icon: Icon,
  label,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof FileText;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? `${label} (not available in Direct Edit mode)` : label}
      className={cn(
        "flex flex-1 items-center justify-center gap-1 rounded-sm px-1.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "bg-accent text-accent-fg"
          : disabled
          ? "text-fg-faint/50"
          : "text-fg-muted hover:bg-hover hover:text-fg",
      )}
    >
      <Icon className="h-3 w-3" />
      <span className="hidden truncate sm:inline">{label}</span>
    </button>
  );
}

function DisabledPanel({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-4 text-center">
      <p className="text-[11px] font-medium text-fg-faint">{label}</p>
      {hint ? <p className="mt-1 text-[10px] text-fg-faint/80">{hint}</p> : null}
    </div>
  );
}

function findNode(root: VisualNode, id: string): VisualNode | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}
