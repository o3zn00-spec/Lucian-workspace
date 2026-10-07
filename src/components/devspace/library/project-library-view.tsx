"use client";

import { useEffect, useRef, useState } from "react";
import {
  FolderPlus,
  FileArchive,
  Search,
  MoreVertical,
  Trash2,
  Pencil,
  ExternalLink,
  Copy,
  FolderInput,
  Loader2,
  FileCode2,
  Calendar,
  AlertCircle,
  Database,
  CheckCircle2,
  XCircle,
  Cloud,
  Key,
  Server,
  Github,
} from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { Button } from "@/components/ui-devspace/button";
import { Input } from "@/components/ui-devspace/input";
import { Card } from "@/components/ui-devspace/card";
import { Badge } from "@/components/ui-devspace/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui-devspace/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui-devspace/dropdown-menu";
import { Label } from "@/components/ui-devspace/label";
import { Textarea } from "@/components/ui-devspace/textarea";
import { toast } from "@/hooks/use-toast";
import {
  importFolderToFiles,
  importZipToFiles,
} from "@/lib/workspace/project";
import { saveProject } from "@/lib/workspace/db";
import { importFromGitHub } from "@/lib/workspace/github";
import { formatBytes } from "@/lib/workspace/filesystem";
import { countMissing } from "@/lib/workspace/project-scanner";
import { frameworkLabel } from "@/lib/workspace/filesystem";
import { cn } from "@/lib/utils";
import type { DetectedFramework, Project, ScanResult } from "@/types/workspace";

const FRAMEWORK_COLOR: Record<DetectedFramework, string> = {
  html: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  "react-jsx": "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  "react-tsx": "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "react-vite": "bg-purple-500/15 text-purple-700 dark:text-purple-300",
  nextjs: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  vue: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  static: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  unknown: "bg-zinc-500/15 text-zinc-500",
};

export function ProjectLibraryView() {
  const {
    projects,
    loadingProjects,
    refreshProjects,
    createProject,
    importProject,
    openProject,
    removeProject,
    renameProject,
  } = useWorkspaceStore();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [scanTarget, setScanTarget] = useState<Project | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ name: string; count: number } | null>(null);
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubUrl, setGithubUrl] = useState("");
  // Phase 11: optional explicit branch override. Token field removed —
  // LUCIAN does not store a GitHub PAT, so private repos return an honest
  // "auth-required" error from the server route.
  const [githubBranch, setGithubBranch] = useState("");

  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  const filtered = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()),
  );

  const handleCreate = async () => {
    if (!newName.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    const project = await createProject(newName, newDesc);
    setCreateOpen(false);
    setNewName("");
    setNewDesc("");
    toast({ title: "Project created", description: project.name });
  };

  const handleRename = async () => {
    const name = renameValue.trim();
    if (renameSaving || !renameTarget || !name) return;

    setRenameSaving(true);
    try {
      await renameProject(renameTarget.id, name);
      setRenameTarget(null);
      toast({ title: "Project renamed" });
    } catch (error) {
      toast({
        title: "Could not rename project",
        description: error instanceof Error ? error.message : "The project name was not changed.",
        variant: "destructive",
      });
    } finally {
      setRenameSaving(false);
    }
  };

  const handleZipImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportProgress({ name: file.name, count: 0 });
    try {
      const result = await importZipToFiles(file);
      if (result.entries.length === 0) {
        toast({
          title: "ZIP was empty or filtered out",
          description: "All files were inside ignored directories (node_modules, .next, etc.).",
          variant: "destructive",
        });
        return;
      }
      setImportProgress({ name: file.name, count: result.entries.length });
      const baseName = file.name.replace(/\.zip$/i, "");
      const project = await importProject(baseName, result);
      toast({
        title: "Project imported",
        description: `${project.name} — ${result.entries.length} files${
          result.skippedDirs.length > 0
            ? ` · skipped: ${result.skippedDirs.slice(0, 3).join(", ")}${result.skippedDirs.length > 3 ? "..." : ""}`
            : ""
        }`,
      });
    } catch (err) {
      console.error(err);
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
      setImportProgress(null);
      if (zipInputRef.current) zipInputRef.current.value = "";
    }
  };

  const handleGitHubImport = async () => {
    if (!githubUrl.trim()) {
      toast({ title: "GitHub URL required", variant: "destructive" });
      return;
    }
    setGithubOpen(false);
    setImporting(true);
    setImportProgress({ name: "Downloading from GitHub...", count: 0 });
    try {
      const result = await importFromGitHub(githubUrl);
      if (result.entries.length === 0) {
        toast({
          title: "Repository was empty or filtered out",
          description: "All files were inside ignored directories (node_modules, .next, etc.).",
          variant: "destructive",
        });
        return;
      }
      setImportProgress({ name: result.repoName, count: result.entries.length });
      const project = await importProject(result.repoName, result);
      toast({
        title: "GitHub repository imported",
        description: `${project.name} (${result.branch}) — ${result.entries.length} files`,
      });
      setGithubUrl("");
      setGithubBranch("");
    } catch (err) {
      toast({
        title: "GitHub import failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  const handleFolderImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setImporting(true);
    setImportProgress({ name: "Importing folder...", count: 0 });
    try {
      const result = await importFolderToFiles(files);
      if (result.entries.length === 0) {
        toast({
          title: "Folder was empty or filtered out",
          description: "All files were inside ignored directories (node_modules, .next, etc.).",
          variant: "destructive",
        });
        return;
      }
      setImportProgress({ name: "Folder", count: result.entries.length });
      const first = files[0] as File & { webkitRelativePath?: string };
      const folderName = first.webkitRelativePath?.split("/")[0] ?? "Imported Folder";
      const project = await importProject(folderName, result);
      toast({
        title: "Folder imported",
        description: `${project.name} — ${result.entries.length} files${
          result.skippedDirs.length > 0
            ? ` · skipped: ${result.skippedDirs.slice(0, 3).join(", ")}${result.skippedDirs.length > 3 ? "..." : ""}`
            : ""
        }`,
      });
    } catch (err) {
      console.error(err);
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
      setImportProgress(null);
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  };

  const handleDuplicate = async (project: Project) => {
    const now = Date.now();
    // Duplicate is a shallow re-import of the same metadata; contents will
    // be shared via the contents store keyed by project ID. We need to
    // re-persist contents under the new project ID.
    const { getManyFileContents, setManyFileContents } = await import("@/lib/workspace/db");
    const paths = project.files.map((f) => f.path);
    const contents = await getManyFileContents(project.id, paths);
    const newId = `prj_${Math.random().toString(36).slice(2, 10)}${now.toString(36).slice(-4)}`;
    await setManyFileContents(
      newId,
      Array.from(contents.entries()).map(([path, content]) => ({ path, content })),
    );
    const copy: Project = {
      ...project,
      id: newId,
      name: `${project.name} (copy)`,
      createdAt: now,
      updatedAt: now,
      files: project.files.map((f) => ({ ...f })),
    };
    await saveProject(copy);
    await refreshProjects();
    toast({ title: "Project duplicated", description: copy.name });
  };

  const handleDelete = async (project: Project) => {
    // Soft-delete: project goes to the Recycle Bin. Restore or permanently
    // delete from the Storage Manager. No `confirm()` prompt needed since
    // the action is reversible from the Recycle Bin.
    await removeProject(project.id);
    toast({
      title: "Moved to Recycle Bin",
      description: `${project.name} — restore it from the Storage Manager if needed.`,
    });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Project Library</h1>
            <p className="mt-1 text-muted-foreground">
              Create, import, edit, preview, and export projects from one connected workspace.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={zipInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={handleZipImport}
            />
            <input
              ref={folderInputRef}
              type="file"
              // @ts-expect-error webkitdirectory is non-standard but widely supported
              webkitdirectory=""
              directory=""
              multiple
              className="hidden"
              onChange={handleFolderImport}
            />
            <Button variant="outline" onClick={() => folderInputRef.current?.click()} disabled={importing}>
              {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderInput className="mr-2 h-4 w-4" />}
              Import Folder
            </Button>
            <Button variant="outline" onClick={() => zipInputRef.current?.click()} disabled={importing}>
              {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileArchive className="mr-2 h-4 w-4" />}
              Import ZIP
            </Button>
            <Dialog open={githubOpen} onOpenChange={setGithubOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" disabled={importing}>
                  {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Github className="mr-2 h-4 w-4" />}
                  Import from GitHub
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Import from GitHub</DialogTitle>
                  <DialogDescription>
                    Paste a repository URL. Branch and subfolder URLs work too
                    (e.g. https://github.com/owner/repo/tree/main/apps/web).
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label htmlFor="gh-url">Repository URL</Label>
                    <Input
                      id="gh-url"
                      placeholder="https://github.com/owner/repo"
                      value={githubUrl}
                      onChange={(e) => setGithubUrl(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="gh-branch">
                      Branch <span className="text-muted-foreground">(optional — defaults to HEAD/main/master)</span>
                    </Label>
                    <Input
                      id="gh-branch"
                      type="text"
                      placeholder="main"
                      value={githubBranch}
                      onChange={(e) => setGithubBranch(e.target.value)}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Public repositories only. Private repository authentication is not configured —
                    LUCIAN will return an honest error if the repo is private.
                  </p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setGithubOpen(false)}>Cancel</Button>
                  <Button onClick={handleGitHubImport}>
                    <Github className="mr-2 h-4 w-4" /> Import Repository
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>
                  <FolderPlus className="mr-2 h-4 w-4" />
                  New Project
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create new project</DialogTitle>
                  <DialogDescription>
                    Start with an empty project. You can import files later.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label htmlFor="proj-name">Project name</Label>
                    <Input
                      id="proj-name"
                      placeholder="e.g. Gift Card Website"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="proj-desc">Description (optional)</Label>
                    <Textarea
                      id="proj-desc"
                      placeholder="Short note about what this project is for"
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                      rows={3}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreate}>Create Project</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Import progress banner */}
        {importProgress && (
          <div className="themed mb-3 flex items-center gap-2.5 rounded-md border border-line-muted bg-surface px-3 py-2 text-xs text-fg-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
            <span>
              Importing <strong className="font-medium text-fg">{importProgress.name}</strong>
              {importProgress.count > 0 && ` — ${importProgress.count} files processed`}
              …
            </span>
          </div>
        )}

        {/* Search */}
        <div className="relative mb-6 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Grid */}
        {loadingProjects ? (
          <div className="flex h-48 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading...
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState onCreate={() => setCreateOpen(true)} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((project) => (
              <Card
                key={project.id}
                className="group relative flex cursor-pointer flex-col overflow-hidden p-0 transition-all hover:shadow-md hover:ring-2 hover:ring-primary/20"
                onClick={() => openProject(project.id)}
              >
                <div className="flex h-32 items-center justify-center bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
                  <FileCode2 className="h-12 w-12 text-primary/40" />
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold leading-tight">{project.name}</h3>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onClick={() => openProject(project.id)}>
                          <ExternalLink className="mr-2 h-4 w-4" /> Open
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setRenameTarget(project);
                            setRenameValue(project.name);
                          }}
                        >
                          <Pencil className="mr-2 h-4 w-4" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDuplicate(project)}>
                          <Copy className="mr-2 h-4 w-4" /> Duplicate
                        </DropdownMenuItem>
                        {project.scanResult && (
                          <DropdownMenuItem onClick={() => setScanTarget(project)}>
                            <Cloud className="mr-2 h-4 w-4" /> What&apos;s needed to go live
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => handleDelete(project)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {project.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {project.description}
                    </p>
                  )}
                  <div className="mt-auto flex items-center justify-between pt-2">
                    <Badge
                      variant="secondary"
                      className={FRAMEWORK_COLOR[project.framework]}
                    >
                      {frameworkLabel(project.framework)}
                    </Badge>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Database className="h-3 w-3" />
                      {project.fileCount} files · {formatBytes(project.totalSize)}
                    </span>
                  </div>
                  {/* "What&apos;s needed to go live" badge */}
                  {project.scanResult && (() => {
                    const missing = countMissing(project.scanResult);
                    if (missing.total === 0 && project.scanResult.services.length === 0 && project.scanResult.envVars.length === 0) {
                      return null;
                    }
                    return (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setScanTarget(project);
                        }}
                        className={cn(
                          "flex items-center gap-1 rounded text-[10px] px-1.5 py-0.5 transition-colors",
                          missing.total === 0
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                            : "bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20",
                        )}
                      >
                        {missing.total === 0 ? (
                          <><CheckCircle2 className="h-3 w-3" /> All configured</>
                        ) : (
                          <><AlertCircle className="h-3 w-3" /> {missing.total} missing · click to view</>
                        )}
                      </button>
                    );
                  })()}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {new Date(project.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  {project.skippedDirs.length > 0 && (
                    <div className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400" title={`Skipped: ${project.skippedDirs.join(", ")}`}>
                      <AlertCircle className="h-3 w-3" />
                      Skipped {project.skippedDirs.length} dir(s) during import
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && !renameSaving && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename project</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)} disabled={renameSaving}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleRename()}
              disabled={renameSaving || !renameValue.trim()}
              aria-busy={renameSaving}
            >
              {renameSaving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {renameSaving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scan results dialog — "what's needed to go live" checklist */}
      <ScanChecklistDialog
        project={scanTarget}
        onClose={() => setScanTarget(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScanChecklistDialog — shows the "what's needed to go live" checklist
// ---------------------------------------------------------------------------

function ScanChecklistDialog({
  project,
  onClose,
}: {
  project: Project | null;
  onClose: () => void;
}) {
  const { openProject, setView } = useWorkspaceStore();
  const [opening, setOpening] = useState(false);
  if (!project || !project.scanResult) return null;

  const scan = project.scanResult;
  const missing = countMissing(scan);

  const handleOpen = async () => {
    if (opening) return;
    setOpening(true);
    try {
      await openProject(project.id);
      setView("workspace");
      onClose();
    } catch (error) {
      toast({
        title: "Could not open project",
        description: error instanceof Error ? error.message : "The workspace could not be prepared.",
        variant: "destructive",
      });
    } finally {
      setOpening(false);
    }
  };

  return (
    <Dialog open={!!project} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5" /> What&apos;s needed to go live
          </DialogTitle>
          <DialogDescription>
            <strong>{project.name}</strong> — scanned {scan.envVars.length + scan.services.length} items.
            {missing.total === 0
              ? " Everything is configured. This project can run in Real mode."
              : ` ${missing.total} item${missing.total !== 1 ? "s" : ""} need attention before the real backend will work.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Services section */}
          {scan.services.length > 0 && (
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Server className="h-4 w-4" /> Services detected
              </h3>
              <div className="space-y-1.5">
                {scan.services.map((s) => (
                  <div
                    key={s.name}
                    className="flex items-center justify-between rounded-md border border-border/50 p-2"
                  >
                    <div className="flex items-center gap-2">
                      {s.configured ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-amber-500" />
                      )}
                      <div>
                        <span className="text-sm font-medium">{s.name}</span>
                        <span className="ml-2 text-[10px] uppercase text-muted-foreground">{s.type}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      {s.configured ? (
                        <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                          Configured
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
                          Needs config
                        </Badge>
                      )}
                      {s.detectedIn && (
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          via {s.detectedIn}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Env vars section */}
          {scan.envVars.length > 0 && (
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Key className="h-4 w-4" /> Environment variables
              </h3>
              <div className="space-y-1">
                {scan.envVars.map((e) => (
                  <div
                    key={e.key}
                    className="flex items-center justify-between rounded-md border border-border/50 px-2 py-1.5"
                  >
                    <div className="flex items-center gap-2">
                      {e.configured ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-amber-500" />
                      )}
                      <code className="text-xs font-mono">{e.key}</code>
                    </div>
                    <div className="flex items-center gap-2">
                      {e.hint && (
                        <span className="text-[10px] text-muted-foreground">{e.hint}</span>
                      )}
                      <Badge
                        variant="outline"
                        className="text-[9px] uppercase"
                      >
                        {e.source}
                      </Badge>
                      {e.configured ? (
                        <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                          Set
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 dark:text-amber-400">
                          Missing
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {scan.services.length === 0 && scan.envVars.length === 0 && (
            <div className="rounded-md border border-dashed border-muted/40 p-6 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
              No external services or env vars detected. This project appears to be self-contained.
            </div>
          )}

          {/* Action buttons */}
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={opening}
            >
              Close
            </Button>
            <Button
              onClick={() => void handleOpen()}
              disabled={opening}
              aria-busy={opening}
            >
              {opening ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <ExternalLink className="mr-1 h-4 w-4" />
              )}
              {opening ? "Opening…" : "Open & Configure"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({
  onCreate,
}: {
  onCreate: () => void;
}) {
  return (
    <Card className="flex flex-col items-center justify-center gap-4 p-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <FolderPlus className="h-8 w-8 text-muted-foreground" />
      </div>
      <div>
        <h3 className="text-lg font-semibold">No projects yet</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a new project or import an existing one from a ZIP / folder.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={onCreate}>
          <FolderPlus className="mr-2 h-4 w-4" /> New Project
        </Button>
      </div>
    </Card>
  );
}
