"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Editor from "@monaco-editor/react";
import {
  BoxSelect, Check, ChevronDown, ChevronRight, Circle, Copy, Download,
  Ellipsis, FileCode2, FolderInput, Group, History, Image as ImageIcon,
  Layers3, Loader2, Minus, MousePointer2, MoveDown, MoveUp, PencilLine,
  Plus, Redo2, Save, Shapes, Spline, Square, Trash2, Type, Undo2,
  Upload, Wand2, ZoomIn, ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui-devspace/button";
import { Input } from "@/components/ui-devspace/input";
import { Label } from "@/components/ui-devspace/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui-devspace/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui-devspace/tabs";
import { useTheme } from "@/components/theme/ThemeProvider";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  defaultSettingsForMode, fileToImageData, optimizeSvg, svgToPdfBlob,
  svgToPngBlob, traceImageData, type TraceMode, type TraceSettings,
} from "@/lib/workspace/vector-studio";
import {
  addSvgShape, cleanSvgForExport, composeTransform, deleteSvgLayer,
  duplicateSvgLayer, inspectPathNodes, inspectSvgLayers, moveSvgLayer,
  normalizeEditableSvg, parseTransform, previewSvg, svgDimensions,
  updatePathNode, updateSvgLayer, updateSvgText, type SvgLayer,
  type SvgPathNode, type SvgShapeKind,
} from "@/lib/workspace/svg-editor";
import {
  commitVectorRevision, createVectorProject, dataUrlToFile,
  deleteVectorProject, listVectorProjects, moveVectorHistory,
  renameVectorProject, saveVectorProject, type VectorProject,
} from "@/lib/workspace/vector-projects";
import { useWorkspaceStore } from "@/store/workspace";

const MODE_LABELS: Record<TraceMode, string> = {
  logo: "Logo", icon: "Icon", illustration: "Illustration", photo: "Photo", lineart: "Line art",
};
type PreviewMode = "vector" | "original" | "split";

export function VectorStudioView() {
  const [projects, setProjects] = useState<VectorProject[]>([]);
  const [active, setActive] = useState<VectorProject | null>(null);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const [draftSvg, setDraftSvg] = useState("");
  const [sourceDirty, setSourceDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("vector");
  const [zoom, setZoom] = useState(1);
  const [leftTab, setLeftTab] = useState<"layers" | "trace">("layers");
  const [bottomTab, setBottomTab] = useState<"source" | "history">("source");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeWorkspaceProject = useWorkspaceStore((state) => state.activeProject);
  const { theme } = useTheme();

  if (active && active.id !== loadedProjectId) {
    setLoadedProjectId(active.id);
    setDraftSvg(active.svg);
    setSourceDirty(false);
    setSelectedId(null);
  }

  useEffect(() => {
    let cancelled = false;
    void listVectorProjects().then(async (stored) => {
      if (cancelled) return;
      if (stored.length) {
        setProjects(stored);
        setActive(stored[0]!);
      } else {
        const project = createVectorProject();
        await saveVectorProject(project);
        if (!cancelled) { setProjects([project]); setActive(project); }
      }
      if (!cancelled) setBusy(false);
    }).catch((error) => {
      if (!cancelled) {
        setBusy(false);
        toast({ title: "Vector projects could not be loaded", description: message(error), variant: "destructive" });
      }
    });
    return () => { cancelled = true; };
  }, []);

  const layers = useMemo(() => {
    if (!active) return [];
    try { return inspectSvgLayers(active.svg); } catch { return []; }
  }, [active]);
  const selected = useMemo(() => layers.find((layer) => layer.id === selectedId) ?? null, [layers, selectedId]);
  const dimensions = useMemo(() => {
    if (!active) return { width: 1200, height: 800 };
    try { return svgDimensions(active.svg); } catch { return { width: active.sourceWidth, height: active.sourceHeight }; }
  }, [active]);
  const renderedSvg = useMemo(() => {
    if (!active) return "";
    try { return previewSvg(active.svg, selectedId); } catch { return ""; }
  }, [active, selectedId]);

  const persist = useCallback(async (project: VectorProject) => {
    setActive(project);
    setDraftSvg(project.svg);
    setSourceDirty(false);
    setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)].sort((a, b) => b.updatedAt - a.updatedAt));
    await saveVectorProject(project);
  }, []);

  const commitSvg = useCallback(async (svg: string, label: string, nextSelectedId?: string | null) => {
    if (!active) return;
    try {
      const next = commitVectorRevision(active, normalizeEditableSvg(svg), label);
      await persist(next);
      if (nextSelectedId !== undefined) setSelectedId(nextSelectedId);
    } catch (error) {
      toast({ title: "Vector change was not saved", description: message(error), variant: "destructive" });
    }
  }, [active, persist]);

  const createNew = useCallback(async () => {
    const name = window.prompt("Vector project name", "Untitled Vector");
    if (name) await persist(createVectorProject(name));
  }, [persist]);
  const renameCurrent = useCallback(async () => {
    if (!active) return;
    const name = window.prompt("Rename vector project", active.name);
    if (name) await persist(renameVectorProject(active, name));
  }, [active, persist]);
  const removeCurrent = useCallback(async () => {
    if (!active || !window.confirm(`Delete “${active.name}”? This cannot be undone.`)) return;
    await deleteVectorProject(active.id);
    const remaining = projects.filter((item) => item.id !== active.id);
    if (remaining.length) { setProjects(remaining); setActive(remaining[0]!); }
    else {
      const replacement = createVectorProject();
      await saveVectorProject(replacement);
      setProjects([replacement]); setActive(replacement);
    }
  }, [active, projects]);

  const handleFile = useCallback(async (file: File) => {
    if (!active) return;
    if (file.size > 8 * 1024 * 1024) {
      toast({ title: "File too large", description: "Vector Studio accepts source files up to 8 MB.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) {
        const svg = normalizeEditableSvg(await file.text());
        const size = svgDimensions(svg);
        const seeded = { ...active, sourceDataUrl: dataUrl, sourceName: file.name, sourceMime: "image/svg+xml", sourceWidth: size.width, sourceHeight: size.height };
        await persist(commitVectorRevision(seeded, svg, "Imported SVG"));
        setPreviewMode("vector");
      } else {
        if (!file.type.startsWith("image/")) throw new Error("Upload PNG, JPG, WEBP, BMP, GIF, or SVG.");
        const size = await probeImage(dataUrl);
        await persist({ ...active, sourceDataUrl: dataUrl, sourceName: file.name, sourceMime: file.type || "image/png", sourceWidth: size.width, sourceHeight: size.height, updatedAt: Date.now() });
        setPreviewMode("split"); setLeftTab("trace");
        toast({ title: "Image loaded", description: "Adjust tracing controls and choose Trace." });
      }
    } catch (error) {
      toast({ title: "Import failed", description: message(error), variant: "destructive" });
    } finally { setBusy(false); }
  }, [active, persist]);

  const trace = useCallback(async () => {
    if (!active?.sourceDataUrl || !active.sourceName || !active.sourceMime || active.sourceMime === "image/svg+xml") return;
    setBusy(true);
    try {
      const file = dataUrlToFile(active.sourceDataUrl, active.sourceName, active.sourceMime);
      const result = await traceImageData(await fileToImageData(file), active.settings);
      await commitSvg(result.svg, `Traced ${MODE_LABELS[active.settings.mode]}`);
      setPreviewMode("split");
      toast({ title: "Tracing complete", description: `${result.pathCount} paths · ${result.detectedColors.length} colors · ${result.traceTimeMs} ms` });
    } catch (error) {
      toast({ title: "Tracing failed", description: message(error), variant: "destructive" });
    } finally { setBusy(false); }
  }, [active, commitSvg]);

  const updateSettings = useCallback(async <K extends keyof TraceSettings>(key: K, value: TraceSettings[K]) => {
    if (active) await persist({ ...active, settings: { ...active.settings, [key]: value }, updatedAt: Date.now() });
  }, [active, persist]);
  const setMode = useCallback(async (mode: TraceMode) => {
    if (active) await persist({ ...active, settings: defaultSettingsForMode(mode), updatedAt: Date.now() });
  }, [active, persist]);
  const saveSource = useCallback(async () => {
    if (active && sourceDirty) await commitSvg(draftSvg, "Edited SVG source");
  }, [active, commitSvg, draftSvg, sourceDirty]);
  const undo = useCallback(async () => {
    if (active && active.historyIndex > 0) await persist(moveVectorHistory(active, active.historyIndex - 1));
  }, [active, persist]);
  const redo = useCallback(async () => {
    if (active && active.historyIndex < active.history.length - 1) await persist(moveVectorHistory(active, active.historyIndex + 1));
  }, [active, persist]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "s") { event.preventDefault(); void saveSource(); }
      if (event.key.toLowerCase() === "z") {
        if ((event.target as HTMLElement | null)?.closest(".monaco-editor")) return;
        event.preventDefault();
        if (event.shiftKey) void redo(); else void undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, saveSource, undo]);

  const addShape = useCallback(async (kind: SvgShapeKind) => {
    if (!active) return;
    const added = addSvgShape(active.svg, kind);
    await commitSvg(added.svg, `Added ${kind}`, added.id);
  }, [active, commitSvg]);
  const updateSelected = useCallback(async (patch: Record<string, string | null>, label: string) => {
    if (active && selectedId) await commitSvg(updateSvgLayer(active.svg, selectedId, patch), label);
  }, [active, commitSvg, selectedId]);
  const updateText = useCallback(async (text: string) => {
    if (active && selectedId) await commitSvg(updateSvgText(active.svg, selectedId, text), "Edited vector text");
  }, [active, commitSvg, selectedId]);
  const duplicateSelected = useCallback(async () => {
    if (!active || !selectedId) return;
    const duplicated = duplicateSvgLayer(active.svg, selectedId);
    await commitSvg(duplicated.svg, "Duplicated layer", duplicated.id);
  }, [active, commitSvg, selectedId]);
  const deleteSelected = useCallback(async () => {
    if (active && selectedId) await commitSvg(deleteSvgLayer(active.svg, selectedId), "Deleted layer", null);
  }, [active, commitSvg, selectedId]);
  const moveSelected = useCallback(async (direction: "up" | "down") => {
    if (active && selectedId) await commitSvg(moveSvgLayer(active.svg, selectedId, direction), `Moved layer ${direction}`);
  }, [active, commitSvg, selectedId]);
  const updateNode = useCallback(async (node: SvgPathNode, axis: "x" | "y", value: number) => {
    if (!selected?.attributes.d) return;
    await updateSelected({ d: updatePathNode(selected.attributes.d, node, axis, value) }, `Moved path node ${node.label}`);
  }, [selected, updateSelected]);

  const download = useCallback(async (kind: "svg" | "png" | "pdf") => {
    if (!active) return;
    setExporting(true);
    try {
      const clean = optimizeSvg(cleanSvgForExport(active.svg));
      const blob = kind === "svg" ? new Blob([clean], { type: "image/svg+xml" }) : kind === "png" ? await svgToPngBlob(clean, dimensions.width, dimensions.height, 2) : await svgToPdfBlob(clean, dimensions.width, dimensions.height);
      downloadBlob(blob, `${slug(active.name)}.${kind}`);
      toast({ title: `${kind.toUpperCase()} exported` });
    } catch (error) { toast({ title: "Export failed", description: message(error), variant: "destructive" }); }
    finally { setExporting(false); }
  }, [active, dimensions]);
  const copySvg = useCallback(async () => {
    if (!active) return;
    await navigator.clipboard.writeText(cleanSvgForExport(active.svg));
    toast({ title: "SVG copied" });
  }, [active]);

  const addToWorkspace = useCallback(async (openEditor: boolean) => {
    if (!active || !activeWorkspaceProject) {
      toast({ title: "Open a workspace project first", description: "Select a project from the Project Library before adding this vector." });
      return;
    }
    const root = activeWorkspaceProject.framework === "html" || activeWorkspaceProject.framework === "static" ? "assets" : "public/assets";
    const requested = window.prompt("Save vector into the current project", active.workspacePath ?? `${root}/${slug(active.name)}.svg`);
    if (!requested) return;
    const path = requested.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!path.toLowerCase().endsWith(".svg")) { toast({ title: "Use an .svg filename", variant: "destructive" }); return; }
    try {
      const store = useWorkspaceStore.getState();
      await store.createSnapshot(`Before adding vector ${active.name}`);
      const result = await store.writeFile(path, cleanSvgForExport(active.svg));
      await persist({ ...active, workspacePath: path, updatedAt: Date.now() });
      if (openEditor) store.setView("visual-editor");
      toast({ title: openEditor ? "Opened in Visual Editor" : "Added to current project", description: result.warnings.length ? result.warnings.join(" ") : path });
    } catch (error) { toast({ title: "Could not add vector", description: message(error), variant: "destructive" }); }
  }, [active, activeWorkspaceProject, persist]);

  if (busy && !active) return <div className="flex h-full items-center justify-center gap-2 bg-canvas text-sm text-fg-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading Vector Studio…</div>;

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas text-fg">
      <input ref={fileInputRef} type="file" accept=".svg,.png,.jpg,.jpeg,.webp,.bmp,.gif,image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleFile(file); event.target.value = ""; }} />
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line-muted px-2">
        <div className="flex min-w-0 items-center gap-1">
          <Spline className="ml-1 h-4 w-4 shrink-0 text-accent" />
          <Select value={active?.id} onValueChange={(id) => { const next = projects.find((item) => item.id === id); if (next) setActive(next); }}>
            <SelectTrigger className="h-7 w-44 border-0 bg-transparent text-xs"><SelectValue placeholder="Vector project" /></SelectTrigger>
            <SelectContent>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent>
          </Select>
          <IconButton title="New vector project" onClick={createNew}><Plus /></IconButton>
          <IconButton title="Rename project" onClick={renameCurrent}><PencilLine /></IconButton>
          <IconButton title="Delete project" onClick={removeCurrent}><Trash2 /></IconButton>
          <span className="mx-1 h-5 w-px bg-line-muted" />
          <IconButton title="Undo" disabled={!active || active.historyIndex <= 0} onClick={undo}><Undo2 /></IconButton>
          <IconButton title="Redo" disabled={!active || active.historyIndex >= active.history.length - 1} onClick={redo}><Redo2 /></IconButton>
          <span className="ml-1 text-[10px] text-fg-faint">{sourceDirty ? "Unsaved source" : "Saved"}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => fileInputRef.current?.click()}><Upload className="mr-1 h-3 w-3" /> Import</Button>
          <Button variant="ghost" size="sm" className="h-7 text-[11px]" disabled={!active?.sourceDataUrl || active.sourceMime === "image/svg+xml" || busy} onClick={trace}>{busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Wand2 className="mr-1 h-3 w-3" />}Trace</Button>
          <Button variant="ghost" size="sm" className="h-7 text-[11px]" disabled={!activeWorkspaceProject} onClick={() => addToWorkspace(false)}><FolderInput className="mr-1 h-3 w-3" /> Add to project</Button>
          <Button size="sm" className="h-7 text-[11px]" disabled={!activeWorkspaceProject} onClick={() => addToWorkspace(true)}><MousePointer2 className="mr-1 h-3 w-3" /> Open in Visual Editor</Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col border-r border-line-muted bg-surface-2/40">
          <Tabs value={leftTab} onValueChange={(value) => setLeftTab(value as typeof leftTab)} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="h-9 shrink-0 rounded-none border-b border-line-muted bg-transparent p-0">
              <TabsTrigger value="layers" className="h-9 flex-1 rounded-none text-[11px]"><Layers3 className="mr-1 h-3 w-3" />Layers</TabsTrigger>
              <TabsTrigger value="trace" className="h-9 flex-1 rounded-none text-[11px]"><Wand2 className="mr-1 h-3 w-3" />Trace</TabsTrigger>
            </TabsList>
            <TabsContent value="layers" className="m-0 min-h-0 flex-1 overflow-auto">
              <ShapeToolbar onAdd={addShape} />
              <LayerTree layers={layers} selectedId={selectedId} expanded={expanded} onExpanded={setExpanded} onSelect={setSelectedId} />
            </TabsContent>
            <TabsContent value="trace" className="m-0 min-h-0 flex-1 overflow-auto">{active ? <TraceControls project={active} onMode={setMode} onUpdate={updateSettings} /> : null}</TabsContent>
          </Tabs>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-line-muted bg-surface px-2">
            <div className="flex items-center gap-1">{(["original", "vector", "split"] as PreviewMode[]).map((mode) => <button key={mode} type="button" onClick={() => setPreviewMode(mode)} className={cn("rounded px-2 py-1 text-[10px] capitalize", previewMode === mode ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-hover")}>{mode}</button>)}</div>
            <div className="flex items-center gap-1">
              <IconButton title="Zoom out" onClick={() => setZoom((value) => Math.max(.2, value - .1))}><ZoomOut /></IconButton>
              <button type="button" onClick={() => setZoom(1)} className="w-12 text-center font-mono text-[10px] text-fg-muted">{Math.round(zoom * 100)}%</button>
              <IconButton title="Zoom in" onClick={() => setZoom((value) => Math.min(4, value + .1))}><ZoomIn /></IconButton>
              <span className="ml-2 font-mono text-[10px] text-fg-faint">{Math.round(dimensions.width)} × {Math.round(dimensions.height)}</span>
            </div>
          </div>
          <VectorCanvas project={active} svg={renderedSvg} mode={previewMode} zoom={zoom} busy={busy} selectedId={selectedId} onSelect={setSelectedId} />
          <div className="h-56 shrink-0 border-t border-line-muted bg-surface-2/50">
            <Tabs value={bottomTab} onValueChange={(value) => setBottomTab(value as typeof bottomTab)} className="flex h-full flex-col">
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-line-muted px-2">
                <TabsList className="h-8 bg-transparent p-0"><TabsTrigger value="source" className="h-8 text-[11px]"><FileCode2 className="mr-1 h-3 w-3" />SVG Source</TabsTrigger><TabsTrigger value="history" className="h-8 text-[11px]"><History className="mr-1 h-3 w-3" />History {active ? `(${active.history.length})` : ""}</TabsTrigger></TabsList>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-7 text-[10px]" disabled={!sourceDirty} onClick={saveSource}><Save className="mr-1 h-3 w-3" />Save source</Button>
                  <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={copySvg}><Copy className="mr-1 h-3 w-3" />Copy</Button>
                  {(["svg", "png", "pdf"] as const).map((kind) => <Button key={kind} variant="ghost" size="sm" className="h-7 px-2 text-[10px]" disabled={!active || exporting} onClick={() => download(kind)}><Download className="mr-1 h-3 w-3" />{kind.toUpperCase()}</Button>)}
                </div>
              </div>
              <TabsContent value="source" className="m-0 min-h-0 flex-1"><Editor height="100%" language="xml" value={draftSvg} theme={theme === "natural-white" || theme === "creamy-light" ? "light" : "vs-dark"} onChange={(value) => { setDraftSvg(value ?? ""); setSourceDirty((value ?? "") !== active?.svg); }} options={{ minimap: { enabled: false }, fontSize: 11, lineNumbers: "on", scrollBeyondLastLine: false, wordWrap: "on", automaticLayout: true }} /></TabsContent>
              <TabsContent value="history" className="m-0 min-h-0 flex-1 overflow-auto p-2"><HistoryList project={active} onRestore={async (index) => { if (active) await persist(moveVectorHistory(active, index)); }} /></TabsContent>
            </Tabs>
          </div>
        </section>

        <aside className="w-72 shrink-0 overflow-auto border-l border-line-muted bg-surface-2/40">
          <LayerInspector layer={selected} onPatch={updateSelected} onText={updateText} onNode={updateNode} onDuplicate={duplicateSelected} onDelete={deleteSelected} onMove={moveSelected} />
        </aside>
      </div>
    </div>
  );
}

function ShapeToolbar({ onAdd }: { onAdd: (kind: SvgShapeKind) => void }) {
  const tools: { kind: SvgShapeKind; icon: typeof Square; label: string }[] = [
    { kind: "rect", icon: Square, label: "Rectangle" }, { kind: "circle", icon: Circle, label: "Circle" },
    { kind: "ellipse", icon: Ellipsis, label: "Ellipse" }, { kind: "line", icon: Minus, label: "Line" },
    { kind: "path", icon: Spline, label: "Path" }, { kind: "text", icon: Type, label: "Text" },
    { kind: "group", icon: Group, label: "Group" },
  ];
  return <div className="flex flex-wrap gap-1 border-b border-line-muted p-2">{tools.map(({ kind, icon: Icon, label }) => <IconButton key={kind} title={`Add ${label}`} onClick={() => onAdd(kind)}><Icon /></IconButton>)}</div>;
}

function LayerTree({ layers, selectedId, expanded, onExpanded, onSelect }: { layers: SvgLayer[]; selectedId: string | null; expanded: Set<string>; onExpanded: (value: Set<string>) => void; onSelect: (id: string) => void }) {
  const parents = new Set(layers.map((layer) => layer.parentId).filter(Boolean));
  const visible = layers.filter((layer) => {
    let parent = layer.parentId;
    while (parent) { if (!expanded.has(parent)) return false; parent = layers.find((item) => item.id === parent)?.parentId ?? null; }
    return true;
  });
  if (!layers.length) return <p className="p-3 text-[11px] text-fg-faint">No editable SVG layers.</p>;
  return <div className="py-1">{visible.map((layer) => {
    const hasChildren = parents.has(layer.id);
    return <button key={layer.id} type="button" onClick={() => onSelect(layer.id)} className={cn("flex h-7 w-full items-center gap-1 pr-2 text-left text-[11px] hover:bg-hover", selectedId === layer.id && "bg-accent/15 text-accent")} style={{ paddingLeft: 6 + layer.depth * 14 }}>
      <span role="button" tabIndex={-1} onClick={(event) => { event.stopPropagation(); if (!hasChildren) return; const next = new Set(expanded); if (next.has(layer.id)) next.delete(layer.id); else next.add(layer.id); onExpanded(next); }} className="flex h-4 w-4 items-center justify-center">{hasChildren ? expanded.has(layer.id) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" /> : null}</span>
      <LayerIcon tag={layer.tag} /><span className="truncate">{layer.label}</span><span className="ml-auto font-mono text-[9px] uppercase text-fg-faint">{layer.tag}</span>
    </button>;
  })}</div>;
}

function VectorCanvas({ project, svg, mode, zoom, busy, selectedId, onSelect }: { project: VectorProject | null; svg: string; mode: PreviewMode; zoom: number; busy: boolean; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const panels: Array<"original" | "vector"> = mode === "split" ? ["original", "vector"] : [mode];
  return <div className="relative min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle,#71717a33_1px,transparent_1px)] bg-[size:16px_16px] p-8">
    {busy ? <div className="absolute inset-0 z-20 flex items-center justify-center bg-canvas/60"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div> : null}
    <div className={cn("mx-auto flex min-h-full items-center justify-center gap-6", mode === "split" && "min-w-max")}>{panels.map((panel) => <div key={panel} className="flex flex-col gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-faint">{panel}</span>
      <div className="flex h-[min(58vh,680px)] w-[min(42vw,820px)] items-center justify-center overflow-auto border border-line bg-white shadow-xl" onClick={(event) => { if (panel !== "vector") return; const element = (event.target as Element).closest?.("[data-lucian-vector-id]"); onSelect(element?.getAttribute("data-lucian-vector-id") ?? null); }}>
        <div style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}>{panel === "original" ? project?.sourceDataUrl ? <Image src={project.sourceDataUrl} alt={project.sourceName ?? "Original source"} width={Math.min(project.sourceWidth, 760)} height={Math.min(project.sourceHeight, 620)} unoptimized className="max-h-[620px] max-w-[760px] object-contain" draggable={false} /> : <EmptyPreview icon={ImageIcon} label="No original image" /> : svg ? <div className={cn("h-[min(54vh,620px)] w-[min(38vw,760px)] [&_svg]:h-full [&_svg]:w-full", selectedId && "cursor-default")} dangerouslySetInnerHTML={{ __html: svg }} /> : <EmptyPreview icon={Spline} label="SVG preview unavailable" />}</div>
      </div>
    </div>)}</div>
  </div>;
}

function TraceControls({ project, onMode, onUpdate }: { project: VectorProject; onMode: (mode: TraceMode) => void; onUpdate: <K extends keyof TraceSettings>(key: K, value: TraceSettings[K]) => void }) {
  const settings = project.settings;
  return <div className="space-y-4 p-3">
    <Control label="Mode"><Select value={settings.mode} onValueChange={(value) => onMode(value as TraceMode)}><SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(MODE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Control>
    <Slider label="Colors" value={settings.numberOfColors} min={2} max={64} onChange={(value) => onUpdate("numberOfColors", value)} />
    <Slider label="Smoothing" value={settings.smoothing} min={0} max={100} onChange={(value) => onUpdate("smoothing", value)} />
    <Slider label="Detail" value={settings.detail} min={0} max={100} onChange={(value) => onUpdate("detail", value)} />
    <Slider label="Minimum path" value={settings.minPathSize} min={0} max={32} onChange={(value) => onUpdate("minPathSize", value)} />
    <Slider label="Pre-blur" value={settings.blurRadius} min={0} max={5} onChange={(value) => onUpdate("blurRadius", value)} />
    <Slider label="Output scale" value={settings.scale} min={.5} max={3} step={.5} onChange={(value) => onUpdate("scale", value)} />
    <div className="border-t border-line-muted pt-3 text-[10px] text-fg-faint">{project.sourceName ? <><p className="truncate text-[11px] text-fg">{project.sourceName}</p><p>{project.sourceWidth} × {project.sourceHeight}</p></> : "Import a raster image to trace, or import SVG to edit it directly."}</div>
  </div>;
}

function LayerInspector({ layer, onPatch, onText, onNode, onDuplicate, onDelete, onMove }: { layer: SvgLayer | null; onPatch: (patch: Record<string, string | null>, label: string) => void; onText: (text: string) => void; onNode: (node: SvgPathNode, axis: "x" | "y", value: number) => void; onDuplicate: () => void; onDelete: () => void; onMove: (direction: "up" | "down") => void }) {
  if (!layer) return <div className="flex h-full flex-col items-center justify-center p-6 text-center"><BoxSelect className="mb-2 h-6 w-6 text-fg-faint" /><p className="text-xs text-fg-muted">Select a vector layer to edit its geometry and appearance.</p></div>;
  const attrs = layer.attributes;
  const geometry: Record<string, string[]> = { rect: ["x", "y", "width", "height", "rx", "ry"], circle: ["cx", "cy", "r"], ellipse: ["cx", "cy", "rx", "ry"], line: ["x1", "y1", "x2", "y2"], image: ["x", "y", "width", "height"], text: ["x", "y", "font-size", "font-family", "text-anchor"] };
  const transform = parseTransform(attrs.transform);
  const nodes = layer.tag === "path" && attrs.d ? inspectPathNodes(attrs.d) : [];
  return <div className="space-y-4 p-3">
    <div><p className="text-[10px] font-semibold uppercase tracking-wider text-fg-faint">Selected layer</p><div className="mt-1 flex items-center gap-2"><LayerIcon tag={layer.tag} /><span className="truncate text-xs font-medium">{layer.label}</span><span className="ml-auto font-mono text-[9px] uppercase text-fg-faint">{layer.tag}</span></div></div>
    <div className="flex gap-1"><IconButton title="Move up" onClick={() => onMove("up")}><MoveUp /></IconButton><IconButton title="Move down" onClick={() => onMove("down")}><MoveDown /></IconButton><IconButton title="Duplicate" onClick={onDuplicate}><Copy /></IconButton><IconButton title="Delete" onClick={onDelete}><Trash2 /></IconButton></div>
    {layer.tag === "text" ? <Section title="Text"><Property key={`${layer.id}-text-${layer.label}`} label="Content" value={layer.label} onCommit={onText} /></Section> : null}
    {geometry[layer.tag]?.length ? <Section title="Geometry"><div className="grid grid-cols-2 gap-2">{geometry[layer.tag]!.map((name) => <Property key={`${layer.id}-${name}-${attrs[name]}`} label={name} value={attrs[name] ?? ""} onCommit={(value) => onPatch({ [name]: value }, `Changed ${name}`)} />)}</div></Section> : null}
    <Section title="Appearance"><Property key={`${layer.id}-fill-${attrs.fill}`} label="Fill" value={attrs.fill ?? (layer.tag === "g" ? "" : "#000000")} onCommit={(value) => onPatch({ fill: value }, "Changed fill")} color /><Property key={`${layer.id}-stroke-${attrs.stroke}`} label="Stroke" value={attrs.stroke ?? "none"} onCommit={(value) => onPatch({ stroke: value }, "Changed stroke")} color /><div className="grid grid-cols-2 gap-2"><Property key={`${layer.id}-stroke-width-${attrs["stroke-width"]}`} label="Stroke width" value={attrs["stroke-width"] ?? "0"} onCommit={(value) => onPatch({ "stroke-width": value }, "Changed stroke width")} /><Property key={`${layer.id}-opacity-${attrs.opacity}`} label="Opacity" value={attrs.opacity ?? "1"} onCommit={(value) => onPatch({ opacity: value }, "Changed opacity")} /></div></Section>
    <Section title="Transform"><div className="grid grid-cols-2 gap-2">{(["x", "y", "rotate", "scaleX", "scaleY"] as const).map((name) => <Property key={`${layer.id}-transform-${name}-${transform[name]}`} label={name} value={String(transform[name])} onCommit={(value) => onPatch({ transform: composeTransform({ ...transform, [name]: Number(value) || 0 }) }, `Changed transform ${name}`)} />)}</div></Section>
    {layer.tag === "path" ? <Section title={`Path nodes (${nodes.length})`}><div className="max-h-56 space-y-2 overflow-auto">{nodes.map((node) => <div key={`${layer.id}-${node.index}`} className="rounded border border-line-muted p-2"><p className="mb-1 font-mono text-[9px] text-fg-faint">{node.label}{node.command === node.command.toLowerCase() ? " · relative" : ""}</p><div className="grid grid-cols-2 gap-2">{node.x !== undefined ? <Property label="X" value={String(node.x)} onCommit={(value) => onNode(node, "x", Number(value))} /> : <span />}{node.y !== undefined ? <Property label="Y" value={String(node.y)} onCommit={(value) => onNode(node, "y", Number(value))} /> : null}</div></div>)}</div><Property key={`${layer.id}-d-${attrs.d}`} label="Path data" value={attrs.d ?? ""} onCommit={(value) => onPatch({ d: value }, "Edited path data")} /></Section> : null}
  </div>;
}

function HistoryList({ project, onRestore }: { project: VectorProject | null; onRestore: (index: number) => void }) {
  if (!project) return null;
  return <div className="space-y-1">{project.history.map((revision, index) => <button key={revision.id} type="button" onClick={() => onRestore(index)} className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] hover:bg-hover", index === project.historyIndex && "bg-accent/15 text-accent")}><span className="flex h-4 w-4 items-center justify-center">{index === project.historyIndex ? <Check className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-line" />}</span><span className="truncate">{revision.label}</span><span className="ml-auto shrink-0 font-mono text-[9px] text-fg-faint">{new Date(revision.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></button>)}</div>;
}

function Property({ label, value, onCommit, color = false }: { label: string; value: string; onCommit: (value: string) => void; color?: boolean }) {
  const [draft, setDraft] = useState(value);
  const isHex = /^#[0-9a-f]{6}$/i.test(draft);
  return <label className="block min-w-0"><span className="mb-1 block text-[9px] uppercase tracking-wide text-fg-faint">{label}</span><span className="flex items-center gap-1">{color && isHex ? <input type="color" value={draft} onChange={(event) => { setDraft(event.target.value); onCommit(event.target.value); }} className="h-7 w-7 shrink-0 rounded border border-line bg-transparent p-0" /> : null}<Input value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft !== value) onCommit(draft); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} className="h-7 min-w-0 px-2 font-mono text-[10px]" /></span></label>;
}
function Slider({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) { return <Control label={`${label} · ${value}`}><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="h-1 w-full cursor-pointer appearance-none rounded-full bg-line accent-accent" /></Control>; }
function Control({ label, children }: { label: string; children: React.ReactNode }) { return <div className="space-y-1.5"><Label className="text-[10px] text-fg-muted">{label}</Label>{children}</div>; }
function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className="space-y-2 border-t border-line-muted pt-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-fg-faint">{title}</p>{children}</section>; }
function IconButton({ title, disabled, onClick, children }: { title: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" title={title} disabled={disabled} onClick={onClick} className="flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-30 [&_svg]:h-3.5 [&_svg]:w-3.5">{children}</button>; }
function LayerIcon({ tag }: { tag: string }) { const Icon = tag === "text" ? Type : tag === "path" ? Spline : tag === "g" ? Group : tag === "circle" || tag === "ellipse" ? Circle : tag === "line" ? Minus : Shapes; return <Icon className="h-3 w-3 shrink-0 text-fg-faint" />; }
function EmptyPreview({ icon: Icon, label }: { icon: typeof ImageIcon; label: string }) { return <div className="flex h-52 w-72 flex-col items-center justify-center gap-2 text-xs text-zinc-400"><Icon className="h-6 w-6" />{label}</div>; }

async function readAsDataUrl(file: File): Promise<string> { return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error ?? new Error("File read failed.")); reader.readAsDataURL(file); }); }
async function probeImage(dataUrl: string): Promise<{ width: number; height: number }> { return await new Promise((resolve, reject) => { const image = new window.Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error("The image could not be decoded.")); image.src = dataUrl; }); }
function downloadBlob(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0); }
function slug(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "vector"; }
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
