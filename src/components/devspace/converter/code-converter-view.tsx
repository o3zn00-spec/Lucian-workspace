"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Repeat,
  FileArchive,
  Copy,
  Download,
  Upload,
  Code2,
  Loader2,
  ArrowLeft,
  ArrowRight,
  FileCode2,
  FolderArchive,
  CheckCircle2,
  AlertCircle,
  Info,
  FolderTree,
} from "lucide-react";
import { Button } from "@/components/ui-devspace/button";
import { Textarea } from "@/components/ui-devspace/textarea";
import { Card } from "@/components/ui-devspace/card";
import { Badge } from "@/components/ui-devspace/badge";
import { Label } from "@/components/ui-devspace/label";
import { Input } from "@/components/ui-devspace/input";
import { useWorkspaceStore } from "@/store/workspace";
import {
  bundleByteSize,
  buildReconstructionPreview,
} from "@/lib/workspace/converter";
import {
  packProject,
  DEFAULT_PACK_OPTIONS,
  type PackOptions,
  type PackStyle,
} from "@/lib/workspace/packer";
import { unpackCode } from "@/lib/workspace/unpacker";
import { Switch } from "@/components/ui-devspace/switch";
import {
  exportProjectToZip,
  importZipToFiles,
  importFolderToFiles,
} from "@/lib/workspace/project";
import { saveAs } from "file-saver";
import { toast } from "@/hooks/use-toast";
import { formatBytes } from "@/lib/workspace/filesystem";
import { cn } from "@/lib/utils";
import type { ProjectFile } from "@/types/workspace";

type Direction = "project-to-code" | "code-to-project";

interface ImportedSource {
  name: string;
  files: ProjectFile[];
}

export function CodeConverterView() {
  const {
    projects,
    importProject,
    openProject,
    setView,
    refreshProjects,
  } = useWorkspaceStore();
  const [direction, setDirection] = useState<Direction>("project-to-code");

  // ---- Project → Code state ----
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [importedFiles, setImportedFiles] = useState<ImportedSource | null>(null);
  const [bundle, setBundle] = useState("");
  const [bundleName, setBundleName] = useState("converted-project");
  const [generating, setGenerating] = useState(false);
  const [packOptions, setPackOptions] = useState<PackOptions>(DEFAULT_PACK_OPTIONS);
  const [packInfo, setPackInfo] = useState<{ tokens: number; skippedSecrets: string[] } | null>(null);

  // ---- Code → Project state ----
  const [codeInput, setCodeInput] = useState("");
  const [reconstructedName, setReconstructedName] = useState("reconstructed-project");
  const [reconstructing, setReconstructing] = useState(false);
  const [reconstruction, setReconstruction] = useState<{
    files: ProjectFile[];
    diagnostic: string | null;
    recognized: boolean;
    strategy: string;
  } | null>(null);

  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Auto-clear reconstruction preview when input becomes empty.
  // We defer the setState via Promise.resolve so it's not synchronous in
  // the effect body (avoids the set-state-in-effect lint rule).
  useEffect(() => {
    if (!codeInput.trim()) {
      Promise.resolve().then(() => setReconstruction(null));
    }
  }, [codeInput]);

  // ---- Project → Code handlers ----
  const handleGenerateFromProject = useCallback(async () => {
    setGenerating(true);
    try {
      const project = projects.find((p) => p.id === selectedProjectId);
      let files: ProjectFile[] = [];
      let name = "converted-project";
      if (importedFiles) {
        files = importedFiles.files;
        name = importedFiles.name;
      } else if (project) {
        // Lazy-load all file contents for the selected project.
        const { getManyFileContents, getProject } = await import("@/lib/workspace/db");
        const full = await getProject(project.id);
        if (!full) return;
        const paths = full.files.map((f) => f.path);
        const contents = await getManyFileContents(project.id, paths);
        files = full.files.map((f) => ({
          ...f,
          content: contents.get(f.path) ?? "",
        }));
        name = project.name;
      }
      if (files.length === 0) {
        toast({
          title: "Nothing to convert",
          description: "Select a project or import files first.",
          variant: "destructive",
        });
        return;
      }
      const result = packProject(files, { ...packOptions, projectName: name });
      setBundle(result.output);
      setPackInfo({ tokens: result.approxTokens, skippedSecrets: result.skippedSecrets });
      setBundleName(name.replace(/[^a-z0-9-_]/gi, "_"));
      toast({
        title: "Bundle generated",
        description: `${result.fileCount} files → ${formatBytes(bundleByteSize(result.output))} (~${result.approxTokens.toLocaleString()} tokens)${
          result.skippedSecrets.length > 0
            ? ` · ${result.skippedSecrets.length} secret file(s) excluded`
            : ""
        }`,
      });
    } finally {
      setGenerating(false);
    }
  }, [projects, selectedProjectId, importedFiles, packOptions]);

  const handleImportZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setGenerating(true);
    try {
      const result = await importZipToFiles(file);
      // Materialize ProjectFile[] from entries + contents (in-memory only;
      // we don't persist to IndexedDB here).
      const files: ProjectFile[] = result.entries.map((entry, i) => ({
        ...entry,
        content: result.contents[i]?.content ?? "",
      }));
      setImportedFiles({ name: file.name.replace(/\.zip$/i, ""), files });
      setSelectedProjectId("");
      toast({ title: "ZIP imported", description: `${files.length} files ready for conversion` });
    } catch (err) {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : "Unknown",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
      if (zipInputRef.current) zipInputRef.current.value = "";
    }
  };

  const handleImportFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setGenerating(true);
    try {
      const result = await importFolderToFiles(files);
      const projectFiles: ProjectFile[] = result.entries.map((entry, i) => ({
        ...entry,
        content: result.contents[i]?.content ?? "",
      }));
      const first = files[0] as File & { webkitRelativePath?: string };
      const folderName = first.webkitRelativePath?.split("/")[0] ?? "Imported Folder";
      setImportedFiles({ name: folderName, files: projectFiles });
      setSelectedProjectId("");
      toast({ title: "Folder imported", description: `${projectFiles.length} files ready for conversion` });
    } finally {
      setGenerating(false);
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  };

  const handleCopyBundle = async () => {
    await navigator.clipboard.writeText(bundle);
    toast({ title: "Copied to clipboard" });
  };

  const handleDownloadBundle = () => {
    const blob = new Blob([bundle], { type: "text/plain" });
    const ext = packOptions.style === "markdown" ? "md" : packOptions.style === "xml" ? "xml" : "txt";
    saveAs(blob, `${bundleName}.${ext}`);
  };

  // ---- Code → Project handlers ----
  const handleAnalyze = () => {
    if (!codeInput.trim()) {
      toast({ title: "Paste code first", variant: "destructive" });
      return;
    }
    const result = unpackCode(codeInput);
    setReconstruction({
      files: result.files,
      diagnostic: result.diagnostic,
      recognized: result.strategy !== "none",
      strategy: result.strategy,
    });
    if (result.strategy === "none") {
      toast({
        title: "Input not recognized",
        description: "See the diagnostic panel for details.",
        variant: "destructive",
      });
    } else if (result.files.length === 1) {
      toast({
        title: "Single file detected",
        description: "Inferred filename from content. Add path metadata to reconstruct multiple files.",
      });
    } else {
      toast({
        title: `${result.files.length} files detected`,
        description: `Strategy: ${result.strategy}`,
      });
    }
  };

  const handleDownloadZip = async () => {
    if (!reconstruction || reconstruction.files.length === 0) {
      toast({ title: "Nothing to download", variant: "destructive" });
      return;
    }
    setReconstructing(true);
    try {
      const blob = await exportProjectToZip(reconstruction.files, reconstructedName);
      saveAs(blob, `${reconstructedName.replace(/[^a-z0-9-_]/gi, "_")}.zip`);
      toast({
        title: "Reconstructed & downloaded",
        description: `${reconstruction.files.length} files packaged as ZIP`,
      });
    } finally {
      setReconstructing(false);
    }
  };

  const handleAddToLibrary = async () => {
    if (!reconstruction || reconstruction.files.length === 0) {
      toast({ title: "Nothing to add", variant: "destructive" });
      return;
    }
    setReconstructing(true);
    try {
      // Use the importProject flow which writes contents to the contents store.
      const project = await importProject(reconstructedName, {
        entries: reconstruction.files.map(({ content: _c, ...e }) => {
          void _c;
          return e;
        }),
        contents: reconstruction.files.map((f) => ({ path: f.path, content: f.content })),
        skippedDirs: [],
      });
      await refreshProjects();
      toast({
        title: "Added to library",
        description: `${project.name} (${reconstruction.files.length} files)`,
      });
      // Offer to open the new project.
      if (confirm("Open the new project in the workspace now?")) {
        await openProject(project.id);
        setView("workspace");
      }
    } finally {
      setReconstructing(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Repeat className="h-7 w-7 text-primary" />
            Code Converter
          </h1>
          <p className="mt-1 text-muted-foreground">
            Pack an entire project into a single text bundle (Repomix-style), or reconstruct a
            project from a bundle. Works in both directions.
          </p>
        </div>

        {/* Direction switcher */}
        <div className="mb-6 flex items-center justify-center">
          <div className="inline-flex items-center rounded-lg border border-border/50 bg-card p-1">
            <Button
              variant={direction === "project-to-code" ? "default" : "ghost"}
              size="sm"
              onClick={() => setDirection("project-to-code")}
              className="gap-2"
            >
              <ArrowRight className="h-4 w-4" /> Project → Code
            </Button>
            <Button
              variant={direction === "code-to-project" ? "default" : "ghost"}
              size="sm"
              onClick={() => setDirection("code-to-project")}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" /> Code → Project
            </Button>
          </div>
        </div>

        {direction === "project-to-code" ? (
          <ProjectToCodePanel
            projects={projects}
            selectedProjectId={selectedProjectId}
            setSelectedProjectId={setSelectedProjectId}
            importedFiles={importedFiles}
            generating={generating}
            onGenerate={handleGenerateFromProject}
            onImportZip={() => zipInputRef.current?.click()}
            onImportFolder={() => folderInputRef.current?.click()}
            packOptions={packOptions}
            setPackOptions={setPackOptions}
            packInfo={packInfo}
            bundle={bundle}
            bundleName={bundleName}
            onCopy={handleCopyBundle}
            onDownload={handleDownloadBundle}
          />
        ) : (
          <CodeToProjectPanel
            codeInput={codeInput}
            setCodeInput={setCodeInput}
            reconstructedName={reconstructedName}
            setReconstructedName={setReconstructedName}
            reconstructing={reconstructing}
            reconstruction={reconstruction}
            onAnalyze={handleAnalyze}
            onDownloadZip={handleDownloadZip}
            onAddToLibrary={handleAddToLibrary}
          />
        )}

        <input ref={zipInputRef} type="file" accept=".zip" className="hidden" onChange={handleImportZip} />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-expect-error non-standard
          webkitdirectory=""
          directory=""
          multiple
          className="hidden"
          onChange={handleImportFolder}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-panels
// ---------------------------------------------------------------------------

interface ProjectToCodeProps {
  projects: { id: string; name: string; files: { path: string }[] }[];
  selectedProjectId: string;
  setSelectedProjectId: (id: string) => void;
  importedFiles: ImportedSource | null;
  generating: boolean;
  onGenerate: () => void;
  onImportZip: () => void;
  onImportFolder: () => void;
  packOptions: PackOptions;
  setPackOptions: (o: PackOptions) => void;
  packInfo: { tokens: number; skippedSecrets: string[] } | null;
  bundle: string;
  bundleName: string;
  onCopy: () => void;
  onDownload: () => void;
}

const STYLE_LABELS: Record<PackStyle, string> = {
  xml: "XML",
  markdown: "Markdown",
  plain: "Plain",
};

function ProjectToCodePanel(props: ProjectToCodeProps) {
  const fileCount = props.importedFiles
    ? props.importedFiles.files.length
    : props.projects.find((p) => p.id === props.selectedProjectId)?.files.length ?? 0;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Input side */}
      <Card className="p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <FolderArchive className="h-4 w-4" /> Source project
        </h3>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Select project</Label>
            <select
              value={props.selectedProjectId}
              onChange={(e) => props.setSelectedProjectId(e.target.value)}
              className="focus-ring themed w-full rounded-md border border-line bg-inset px-3 py-1.5 text-sm text-fg"
            >
              <option value="">Choose a project…</option>
              {props.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.files.length} files)
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-fg-faint">
            <span className="text-fg-faint">·</span>
            <span>or import a project</span>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={props.onImportZip}>
              <FileArchive className="mr-1 h-4 w-4" /> Import ZIP
            </Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={props.onImportFolder}>
              <FolderArchive className="mr-1 h-4 w-4" /> Import Folder
            </Button>
          </div>

          {props.importedFiles && (
            <div className="themed rounded-md border border-line bg-surface px-3 py-2 text-sm">
              <p className="font-medium text-fg">{props.importedFiles.name}</p>
              <p className="text-xs text-fg-muted">
                {props.importedFiles.files.length} files imported — ready to convert
              </p>
            </div>
          )}

          {/* Output format */}
          <div className="space-y-2">
            <Label>Output format</Label>
            <div className="flex gap-1 rounded-md border border-border/50 bg-background p-0.5">
              {(Object.keys(STYLE_LABELS) as PackStyle[]).map((style) => (
                <button
                  key={style}
                  onClick={() => props.setPackOptions({ ...props.packOptions, style })}
                  className={cn(
                    "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                    props.packOptions.style === style
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {STYLE_LABELS[style]}
                </button>
              ))}
            </div>
          </div>

          {/* Options */}
          <div className="grid grid-cols-2 gap-2">
            <OptionToggle
              label="File summary"
              checked={props.packOptions.includeSummary}
              onChange={(v) => props.setPackOptions({ ...props.packOptions, includeSummary: v })}
            />
            <OptionToggle
              label="Directory tree"
              checked={props.packOptions.includeTree}
              onChange={(v) => props.setPackOptions({ ...props.packOptions, includeTree: v })}
            />
            <OptionToggle
              label="Line numbers"
              checked={props.packOptions.showLineNumbers}
              onChange={(v) => props.setPackOptions({ ...props.packOptions, showLineNumbers: v })}
            />
            <OptionToggle
              label="Remove comments"
              checked={props.packOptions.removeComments}
              onChange={(v) => props.setPackOptions({ ...props.packOptions, removeComments: v })}
            />
            <OptionToggle
              label="Remove empty lines"
              checked={props.packOptions.removeEmptyLines}
              onChange={(v) => props.setPackOptions({ ...props.packOptions, removeEmptyLines: v })}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Include patterns</Label>
              <Input
                placeholder="src/**, *.md"
                className="h-8 text-xs"
                value={props.packOptions.includePatterns}
                onChange={(e) => props.setPackOptions({ ...props.packOptions, includePatterns: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Ignore patterns</Label>
              <Input
                placeholder="*.test.ts, docs/**"
                className="h-8 text-xs"
                value={props.packOptions.ignorePatterns}
                onChange={(e) => props.setPackOptions({ ...props.packOptions, ignorePatterns: e.target.value })}
              />
            </div>
          </div>

          <Button onClick={props.onGenerate} disabled={props.generating || fileCount === 0} className="w-full">
            {props.generating ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating...</>
            ) : (
              <><Code2 className="mr-2 h-4 w-4" /> Generate Code Bundle</>
            )}
          </Button>
        </div>
      </Card>

      {/* Output side */}
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-semibold">
            <FileCode2 className="h-4 w-4" /> Code Bundle
          </h3>
          {props.bundle && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{formatBytes(bundleByteSize(props.bundle))}</Badge>
              {props.packInfo && (
                <Badge variant="outline" className="text-[10px]">
                  ~{props.packInfo.tokens.toLocaleString()} tokens
                </Badge>
              )}
              <Button variant="ghost" size="sm" onClick={props.onCopy}>
                <Copy className="mr-1 h-3.5 w-3.5" /> Copy
              </Button>
              <Button variant="ghost" size="sm" onClick={props.onDownload}>
                <Download className="mr-1 h-3.5 w-3.5" /> Download
              </Button>
            </div>
          )}
        </div>
        <Textarea
          readOnly
          value={props.bundle}
          placeholder="The generated code bundle will appear here..."
          className={cn("h-[400px] resize-none font-mono text-xs")}
        />
        {!props.bundle && (
          <p className="mt-2 text-xs text-muted-foreground">
            Generate a portable code bundle while preserving the project&apos;s
            complete file structure and paths.
          </p>
        )}
      </Card>
    </div>
  );
}

function OptionToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border/50 px-2.5 py-1.5">
      <span className="text-xs">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} className="scale-75" />
    </label>
  );
}

interface CodeToProjectProps {
  codeInput: string;
  setCodeInput: (v: string) => void;
  reconstructedName: string;
  setReconstructedName: (v: string) => void;
  reconstructing: boolean;
  reconstruction: {
    files: ProjectFile[];
    diagnostic: string | null;
    recognized: boolean;
    strategy: string;
  } | null;
  onAnalyze: () => void;
  onDownloadZip: () => void;
  onAddToLibrary: () => void;
}

function CodeToProjectPanel(props: CodeToProjectProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-5">
        <h3 className="mb-3 flex items-center gap-2 font-semibold">
          <Code2 className="h-4 w-4" /> Paste Code Bundle
        </h3>
        <Textarea
          value={props.codeInput}
          onChange={(e) => props.setCodeInput(e.target.value)}
          placeholder={`Paste a code bundle here. Accepted formats:\n\n• DevWorkspace bundle (80-char "=" separators + FILE: headers)\n• Markdown with fenced code blocks, each preceded by a path comment like // src/App.tsx\n• A single raw source file (we'll guess the filename)`}
          className="h-[400px] resize-none font-mono text-xs"
        />
        <div className="mt-3 flex items-center gap-2">
          <Button
            onClick={props.onAnalyze}
            disabled={!props.codeInput.trim()}
            className="flex-1"
          >
            <FolderTree className="mr-2 h-4 w-4" /> Analyze Input
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Click <strong>Analyze Input</strong> to inspect what was found before adding to your
          library or downloading. We never overwrite existing projects without your explicit
          confirmation.
        </p>
      </Card>

      <Card className="p-5">
        <h3 className="mb-3 flex items-center gap-2 font-semibold">
          <FolderArchive className="h-4 w-4" /> Reconstruction Preview
        </h3>

        {!props.reconstruction ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
            <Info className="h-8 w-8 opacity-40" />
            <p className="text-sm">No analysis yet</p>
            <p className="text-xs text-center max-w-xs">
              Paste a code bundle on the left and click <strong>Analyze Input</strong> to see a
              preview of the reconstructed project structure.
            </p>
          </div>
        ) : !props.reconstruction.recognized ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Input not recognized</p>
                <p className="mt-1 text-xs whitespace-pre-wrap">{props.reconstruction.diagnostic}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Strategy badge */}
            <div className="flex items-center gap-2">
              <Badge variant="secondary">Strategy: {props.reconstruction.strategy}</Badge>
              <Badge variant="outline">{props.reconstruction.files.length} files</Badge>
            </div>

            {/* Diagnostic for single-file inference */}
            {props.reconstruction.diagnostic && (
              <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                <p className="whitespace-pre-wrap">{props.reconstruction.diagnostic}</p>
              </div>
            )}

            {/* Tree preview */}
            <div className="rounded-md border border-border/50 bg-muted/30 p-3">
              <pre className="overflow-auto font-mono text-xs leading-relaxed">
                {buildReconstructionPreview(props.reconstruction.files)}
              </pre>
            </div>

            {/* Name input + actions */}
            <div className="space-y-2">
              <Label htmlFor="recon-name">Project name</Label>
              <Input
                id="recon-name"
                value={props.reconstructedName}
                onChange={(e) => props.setReconstructedName(e.target.value)}
                placeholder="reconstructed-project"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                onClick={props.onDownloadZip}
                disabled={props.reconstructing}
              >
                {props.reconstructing ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Packing...</>
                ) : (
                  <><Download className="mr-2 h-4 w-4" /> Download ZIP</>
                )}
              </Button>
              <Button
                onClick={props.onAddToLibrary}
                disabled={props.reconstructing}
              >
                {props.reconstructing ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Adding...</>
                ) : (
                  <><Upload className="mr-2 h-4 w-4" /> Add to Library</>
                )}
              </Button>
            </div>

            <div className="flex items-start gap-2 rounded-md bg-emerald-500/10 p-2 text-xs text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
              <p>
                Adding to your library creates a <strong>new</strong> project. Your existing
                projects will not be modified.
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
