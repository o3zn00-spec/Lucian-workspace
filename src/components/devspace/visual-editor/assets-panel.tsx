"use client";
/* eslint-disable @next/next/no-img-element -- IndexedDB object/data URLs are local editor previews, not deployable page images. */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Braces,
  ChevronDown,
  FileCode2,
  ImageIcon,
  Plus,
  Search,
  Type,
} from "lucide-react";
import { Button } from "@/components/ui-devspace/button";
import { Input } from "@/components/ui-devspace/input";
import { useWorkspaceStore } from "@/store/workspace";
import type { ProjectAnalysis, VisualElementSpec } from "@/lib/workspace/visual-editor";
import { toast } from "@/hooks/use-toast";

interface AssetsPanelProps {
  analysis: ProjectAnalysis;
  onOpenSource: (path: string) => void;
  onInsertElement: (spec: VisualElementSpec, label: string) => void;
  canInsert: boolean;
}

export function AssetsPanel({ analysis, onOpenSource, onInsertElement, canInsert }: AssetsPanelProps) {
  const project = useWorkspaceStore((state) => state.activeProject);
  const writeFileBinary = useWorkspaceStore((state) => state.writeFileBinary);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);

  const componentFiles = useMemo(
    () => analysis.componentFiles.filter((path) => !/(^|\/)(page|layout|route|main|App)\.(jsx?|tsx?)$/i.test(path)),
    [analysis.componentFiles],
  );
  const mediaFiles = useMemo(
    () => project?.files.filter((file) => file.binary && /^(image|video|audio)\//.test(file.mime ?? "")) ?? [],
    [project],
  );
  const fontFiles = useMemo(
    () => project?.files.filter((file) => file.binary && (/^font\//.test(file.mime ?? "") || /\.(woff2?|ttf|otf)$/i.test(file.path))) ?? [],
    [project],
  );
  const vectorFiles = useMemo(
    () => project?.files.filter((file) => /\.svg$/i.test(file.path)) ?? [],
    [project],
  );
  const matches = (value: string) => !query.trim() || value.toLowerCase().includes(query.trim().toLowerCase());

  const handleUpload = async (files: FileList | null) => {
    if (!project || !files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const dataUrl = await readAsDataUrl(file);
        const base = project.framework === "nextjs" ? "public/assets" : "assets";
        const safeName = file.name.replace(/[^a-z0-9._-]/gi, "-");
        await writeFileBinary(`${base}/${safeName}`, dataUrl, file.type || "application/octet-stream");
      }
      toast({ title: files.length === 1 ? "Asset uploaded" : `${files.length} assets uploaded` });
    } catch (error) {
      toast({
        title: "Asset upload failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2 p-2 text-xs">
      <div className="flex gap-1">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-faint" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search assets" className="h-7 pl-7 text-[11px]" />
        </div>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(event) => void handleUpload(event.target.files)} />
        <Button variant="outline" size="sm" className="h-7 px-2" disabled={uploading} onClick={() => inputRef.current?.click()} title="Upload image, video, audio, or font">
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      <AssetSection title="Components" icon={Box} count={componentFiles.filter(matches).length}>
        {componentFiles.filter(matches).map((path) => (
          <AssetRow key={path} icon={Braces} label={componentName(path)} detail={path} onClick={() => onOpenSource(path)} />
        ))}
      </AssetSection>

      <AssetSection title="Styles" icon={Type} count={analysis.styleFiles.filter(matches).length}>
        {analysis.styleFiles.filter(matches).map((path) => (
          <AssetRow key={path} icon={FileCode2} label={fileName(path)} detail={path} onClick={() => onOpenSource(path)} />
        ))}
      </AssetSection>

      <AssetSection title="Media" icon={ImageIcon} count={mediaFiles.filter((file) => matches(file.path)).length}>
        <div className="grid grid-cols-2 gap-1.5 p-1">
          {mediaFiles.filter((file) => matches(file.path)).map((file) => (
            <MediaTile
              key={file.path}
              path={file.path}
              mime={file.mime}
              onUse={() => onInsertElement({
                tagName: "img",
                selfClosing: true,
                attrs: [
                  { name: "src", value: publicAssetPath(file.path) },
                  { name: "alt", value: fileName(file.path).replace(/\.[^.]+$/, "") },
                  { name: "style", value: "max-width: 100%; height: auto;" },
                ],
              }, `Inserted ${fileName(file.path)}`)}
              canInsert={canInsert}
            />
          ))}
        </div>
      </AssetSection>

      <AssetSection title="Vectors" icon={Braces} count={vectorFiles.filter((file) => matches(file.path)).length}>
        <div className="grid grid-cols-2 gap-1.5 p-1">
          {vectorFiles.filter((file) => matches(file.path)).map((file) => (
            <VectorTile key={file.path} path={file.path} onOpen={() => onOpenSource(file.path)} onUse={() => onInsertElement({ tagName: "img", selfClosing: true, attrs: [{ name: "src", value: publicAssetPath(file.path) }, { name: "alt", value: fileName(file.path).replace(/\.[^.]+$/, "") }] }, `Inserted ${fileName(file.path)}`)} canInsert={canInsert} />
          ))}
        </div>
      </AssetSection>

      <AssetSection title="Fonts" icon={Type} count={fontFiles.filter((file) => matches(file.path)).length}>
        {fontFiles.filter((file) => matches(file.path)).map((file) => (
          <AssetRow key={file.path} icon={Type} label={fileName(file.path)} detail={file.path} onClick={() => onOpenSource(file.path)} />
        ))}
      </AssetSection>
    </div>
  );
}

function AssetSection({
  title,
  icon: Icon,
  count,
  children,
}: {
  title: string;
  icon: typeof Box;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <details open className="group rounded-md border border-line-muted bg-surface/40">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 font-medium text-fg">
        <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-0 -rotate-90" />
        <Icon className="h-3 w-3 text-fg-faint" />
        <span className="flex-1">{title}</span>
        <span className="text-[10px] font-normal text-fg-faint">{count}</span>
      </summary>
      <div className="border-t border-line-muted">{count ? children : <p className="px-3 py-2 text-[10px] text-fg-faint">Nothing here yet.</p>}</div>
    </details>
  );
}

function AssetRow({ icon: Icon, label, detail, onClick }: { icon: typeof Box; label: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-hover">
      <Icon className="h-3 w-3 shrink-0 text-fg-faint" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] text-fg">{label}</span>
        <span className="block truncate font-mono text-[9px] text-fg-faint">{detail}</span>
      </span>
    </button>
  );
}

function MediaTile({ path, mime, onUse, canInsert }: { path: string; mime?: string; onUse: () => void; canInsert: boolean }) {
  const project = useWorkspaceStore((state) => state.activeProject);
  const loadFileContent = useWorkspaceStore((state) => state.loadFileContent);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!project || !/^image\//.test(mime ?? "")) return;
    void loadFileContent(project.id, path).then((content) => {
      if (!cancelled && content) setSrc(content);
    });
    return () => { cancelled = true; };
  }, [project, path, mime, loadFileContent]);
  return (
    <div className="group overflow-hidden rounded border border-line-muted bg-canvas">
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-checkerboard">
        {src ? <img src={src} alt="" className="h-full w-full object-contain" /> : <ImageIcon className="h-5 w-5 text-fg-faint" />}
      </div>
      <div className="flex items-center gap-1 p-1">
        <span className="min-w-0 flex-1 truncate text-[9px] text-fg-muted" title={path}>{fileName(path)}</span>
        <button type="button" disabled={!canInsert || !/^image\//.test(mime ?? "")} onClick={onUse} className="rounded px-1 text-[9px] text-accent hover:bg-hover disabled:opacity-30" title={canInsert ? "Insert into selected layer" : "Select a parent layer first"}>Use</button>
      </div>
    </div>
  );
}

function VectorTile({ path, onOpen, onUse, canInsert }: { path: string; onOpen: () => void; onUse: () => void; canInsert: boolean }) {
  const project = useWorkspaceStore((state) => state.activeProject);
  const loadFileContent = useWorkspaceStore((state) => state.loadFileContent);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!project) return;
    void loadFileContent(project.id, path).then((content) => {
      if (!cancelled && content) setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`);
    });
    return () => { cancelled = true; };
  }, [project, path, loadFileContent]);
  return (
    <div className="overflow-hidden rounded border border-line-muted bg-canvas">
      <button type="button" onClick={onOpen} className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-checkerboard" title="Open SVG source">
        {src ? <img src={src} alt="" className="h-full w-full object-contain" /> : <Braces className="h-5 w-5 text-fg-faint" />}
      </button>
      <div className="flex items-center gap-1 p-1">
        <span className="min-w-0 flex-1 truncate text-[9px] text-fg-muted">{fileName(path)}</span>
        <button type="button" disabled={!canInsert} onClick={onUse} className="rounded px-1 text-[9px] text-accent hover:bg-hover disabled:opacity-30" title={canInsert ? "Insert vector into selected layer" : "Select a parent layer first"}>Use</button>
      </div>
    </div>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

function fileName(path: string) {
  return path.split("/").pop() ?? path;
}

function componentName(path: string) {
  return fileName(path).replace(/\.[^.]+$/, "");
}

function publicAssetPath(path: string) {
  return path.startsWith("public/") ? `/${path.slice("public/".length)}` : path;
}
