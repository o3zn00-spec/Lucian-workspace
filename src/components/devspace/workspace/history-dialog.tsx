"use client";

import { useCallback, useEffect, useState } from "react";
import {
  History,
  Save,
  RotateCcw,
  Download,
  Trash2,
  Eye,
  Loader2,
  PlusCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui-devspace/dialog";
import { Button } from "@/components/ui-devspace/button";
import { Input } from "@/components/ui-devspace/input";
import { Badge } from "@/components/ui-devspace/badge";
import { ScrollArea } from "@/components/ui-devspace/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui-devspace/alert-dialog";
import { useWorkspaceStore } from "@/store/workspace";
import { useSettingsStore } from "@/store/settings";
import {
  listVersions,
  saveVersion,
  deleteVersion,
  getVersion,
  saveProject,
  setManyFileContents,
  commitProjectMutation,
  trimProjectHistory,
} from "@/lib/workspace/db";
import { exportProjectToZip } from "@/lib/workspace/project";
import { buildPreviewDoc } from "@/lib/workspace/preview-engine";
import { saveAs } from "file-saver";
import { toast } from "@/hooks/use-toast";
import type { ProjectFile, ProjectVersion } from "@/types/workspace";
import { formatBytes, totalSize } from "@/lib/workspace/filesystem";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function HistoryDialog({ open, onOpenChange }: Props) {
  const { activeProject, previewMode, refreshProjects, getActiveProjectFiles } = useWorkspaceStore();
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [label, setLabel] = useState("");
  const [viewing, setViewing] = useState<ProjectVersion | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<ProjectVersion | null>(null);
  const [restoreChoice, setRestoreChoice] = useState<"override" | "new" | null>(null);

  // Define loadVersions BEFORE the useEffect that calls it (avoids the
  // "accessed before declaration" lint error). We use useCallback so the
  // function identity is stable across renders and the effect's deps array
  // is correct.
  const loadVersions = useCallback(async () => {
    if (!activeProject) return;
    setLoading(true);
    try {
      const list = await listVersions(activeProject.id);
      setVersions(list);
    } finally {
      setLoading(false);
    }
  }, [activeProject]);

  useEffect(() => {
    if (!open || !activeProject) return;
    let cancelled = false;
    // Defer the async load so the setLoading(true) call inside
    // loadVersions doesn't happen synchronously in the effect body.
    Promise.resolve().then(() => {
      if (cancelled) return;
      void loadVersions();
    });
    return () => {
      cancelled = true;
    };
  }, [open, activeProject, loadVersions]);

  const handleSave = async () => {
    if (!activeProject) return;
    setSaving(true);
    try {
      // Load all file contents so the snapshot has the full state.
      const files = await getActiveProjectFiles();
      const version: ProjectVersion = {
        id: `ver_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
        projectId: activeProject.id,
        label: label.trim() || `Version ${versions.length + 1}`,
        createdAt: Date.now(),
        files,
        previewMode,
        directories: [...(activeProject.directories ?? [])],
      };
      await saveVersion(version);
      // Enforce maxLocalHistory retention (Settings → DevWorkspace → Projects).
      // Trims oldest versions first; never deletes project data.
      await trimProjectHistory(activeProject.id, useSettingsStore.getState().devWorkspace.projects.maxLocalHistory);
      setLabel("");
      await loadVersions();
      toast({ title: "Preview saved", description: version.label });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (v: ProjectVersion) => {
    if (!confirm(`Delete ${v.label}?`)) return;
    await deleteVersion(v.id);
    await loadVersions();
    toast({ title: "Version deleted" });
  };

  const handleDownload = async (v: ProjectVersion) => {
    const blob = await exportProjectToZip(v.files, `${activeProject?.name ?? "project"}-${v.label}`, v.directories);
    saveAs(blob, `${(activeProject?.name ?? "project").replace(/[^a-z0-9-_]/gi, "_")}-${v.label.replace(/[^a-z0-9-_]/gi, "_")}.zip`);
    toast({ title: "Version downloaded", description: v.label });
  };

  const handleRestore = async () => {
    if (!restoreTarget || !restoreChoice || !activeProject) return;
    if (restoreChoice === "override") {
      const files = restoreTarget.files.map((f) => ({ ...f }));
      const entries = files.map(({ content: _c, ...entry }) => {
        void _c;
        return entry;
      });
      await commitProjectMutation(
        {
          ...activeProject,
          files: entries,
          directories: [...(restoreTarget.directories ?? [])],
          fileCount: entries.length,
          totalSize: totalSize(entries),
        },
        [
          ...activeProject.files.map((file) => ({ type: "delete" as const, path: file.path })),
          ...files.map((file) => ({ type: "put" as const, path: file.path, content: file.content })),
        ],
      );
      await useWorkspaceStore.getState().openProject(activeProject.id);
      useWorkspaceStore.getState().refreshPreview();
      toast({
        title: "Project restored",
        description: `${restoreTarget.label} — current project overwritten.`,
      });
    } else {
      // Create a new project from the version.
      const now = Date.now();
      const newProjectId = `prj_${Math.random().toString(36).slice(2, 10)}${now.toString(36).slice(-4)}`;
      // Persist the version's file contents under the new project id.
      await setManyFileContents(
        newProjectId,
        restoreTarget.files.map((f) => ({ path: f.path, content: f.content })),
      );
      const newProject = {
        ...activeProject,
        id: newProjectId,
        name: `${activeProject.name} — ${restoreTarget.label}`,
        createdAt: now,
        updatedAt: now,
        files: restoreTarget.files.map(({ content: _c, ...entry }) => {
          void _c;
          return entry;
        }),
        directories: [...(restoreTarget.directories ?? [])],
        fileCount: restoreTarget.files.length,
        totalSize: totalSize(restoreTarget.files),
      };
      await saveProject(newProject);
      await refreshProjects();
      toast({
        title: "New project created",
        description: `${newProject.name} created from ${restoreTarget.label}.`,
      });
    }
    setRestoreTarget(null);
    setRestoreChoice(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5" /> Project History
          </DialogTitle>
          <DialogDescription>
            Save snapshots of your project, inspect old versions, and restore or download them anytime.
          </DialogDescription>
        </DialogHeader>

        {/* Save new version */}
        <div className="flex items-center gap-2 border-b pb-4">
          <Input
            placeholder={`Label for this version (default: Version ${versions.length + 1})`}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            Save Preview
          </Button>
        </div>

        {/* Versions list */}
        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading...
            </div>
          ) : versions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
              <PlusCircle className="h-8 w-8 opacity-40" />
              <p>No saved versions yet</p>
              <p className="text-xs">Save your first preview to create a historical snapshot.</p>
            </div>
          ) : (
            <div className="space-y-2 py-2">
              {versions.map((v, idx) => (
                <div
                  key={v.id}
                  className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent/50"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    {versions.length - idx}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{v.label}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {v.previewMode}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(v.createdAt).toLocaleString()} · {v.files.length} files · {formatBytes(totalSize(v.files))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewing(v)}
                      title="Preview this version"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownload(v)}
                      title="Download this version as ZIP"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRestoreTarget(v)}
                      title="Restore this version"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(v)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>

      {/* Version preview dialog */}
      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="flex h-[85vh] max-w-5xl flex-col">
          <DialogHeader>
            <DialogTitle>{viewing?.label}</DialogTitle>
            <DialogDescription>
              {viewing && new Date(viewing.createdAt).toLocaleString()} ·{" "}
              {viewing?.files.length ?? 0} files
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden rounded-lg border border-border/50 bg-background">
            {viewing && (
              <iframe
                title="version-preview"
                srcDoc={buildPreviewDoc({
                  files: viewing.files,
                  framework: useWorkspaceStore.getState().activeProject?.framework ?? "static",
                  mode: viewing.previewMode,
                  envVars: [],
                })}
                sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"
                className="h-full w-full border-0"
              />
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => viewing && handleDownload(viewing)}
            >
              <Download className="mr-1 h-4 w-4" /> Download
            </Button>
            <Button onClick={() => setRestoreTarget(viewing)}>
              <RotateCcw className="mr-1 h-4 w-4" /> Restore
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Restore choice dialog */}
      <AlertDialog
        open={!!restoreTarget && restoreChoice === null}
        onOpenChange={(o) => {
          if (!o) {
            setRestoreTarget(null);
            setRestoreChoice(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this version?</AlertDialogTitle>
            <AlertDialogDescription>
              Choose how to restore <strong>{restoreTarget?.label}</strong>. Override replaces the
              current project; Create New keeps the current project intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => setRestoreChoice("override")}
            >
              Override Current
            </AlertDialogAction>
            <AlertDialogAction onClick={() => setRestoreChoice("new")}>
              Create New Project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm restore */}
      <AlertDialog open={!!restoreChoice} onOpenChange={(o) => !o && setRestoreChoice(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {restoreChoice === "override" ? "Overwrite current project?" : "Create new project?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {restoreChoice === "override"
                ? "This will permanently replace the current files with the selected version. This cannot be undone."
                : "A new project will be created from this version. Your current project will remain unchanged."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestore}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
