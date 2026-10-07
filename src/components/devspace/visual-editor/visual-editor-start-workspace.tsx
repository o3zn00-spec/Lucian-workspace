"use client";

// Visual Editor Studio — Start Workspace.
//
// Shown when no active project is loaded in the DevWorkspace store.
// Replaces the dead "No project loaded" empty state with a smart
// composer that lets the user:
//   - open an existing LUCIAN project (from Project Library)
//   - upload a folder / files / image
//
// The composer is the unique LUCIAN take on a "smart start" — inspired
// conceptually by GitHub's composer / context workflows, but styled as
// LUCIAN's own minimal workstation surface.

import { useCallback, useRef, useState } from "react";
import {
  ChevronDown,
  FolderOpen,
  Image as ImageIcon,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import {
  importZipToFiles,
  importFolderToFiles,
} from "@/lib/workspace/project";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui-devspace/button";
import { cn } from "@/lib/utils";

interface AttachedContext {
  /** A unique id for the attachment row. */
  id: string;
  /** Display label. */
  label: string;
  /** Sub-label. */
  detail: string;
  /** Pre-built import result (when the attachment is a project). */
  kind: "project" | "image" | "file" | "files";
  /** The parsed files to import when the user submits. */
  pendingImport?: {
    entries: { path: string; binary: boolean; size: number; mime?: string; updatedAt: number }[];
    contents: { path: string; content: string }[];
    skippedDirs: string[];
  };
}

export function VisualEditorStartWorkspace() {
  const projects = useWorkspaceStore((s) => s.projects);
  const openProject = useWorkspaceStore((s) => s.openProject);
  const importProject = useWorkspaceStore((s) => s.importProject);
  const setView = useWorkspaceStore((s) => s.setView);

  const [attachments, setAttachments] = useState<AttachedContext[]>([]);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  const handleAttachZip = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const result = await importZipToFiles(file);
      setAttachments((prev) => [
        ...prev,
        {
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          label: file.name,
          detail: `${result.entries.length} files · ${result.skippedDirs.length ? `${result.skippedDirs.length} dirs skipped` : "no skips"}`,
          kind: "project",
          pendingImport: result as unknown as AttachedContext["pendingImport"],
        },
      ]);
    } catch (err) {
      toast({
        title: "Could not read ZIP",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const handleAttachFolder = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = "";
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const result = await importFolderToFiles(files);
      setAttachments((prev) => [
        ...prev,
        {
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          label: `${files.length} files from folder`,
          detail: `${result.entries.length} importable · ${result.skippedDirs.length} dirs skipped`,
          kind: "files",
          pendingImport: result as unknown as AttachedContext["pendingImport"],
        },
      ]);
    } catch (err) {
      toast({
        title: "Could not read folder",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const handleAttachImage = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = "";
    if (!files) return;
    const list: AttachedContext[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      // Read the image as a data URL so we can store it.
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Could not read image."));
        reader.readAsDataURL(file);
      });
      list.push({
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        label: file.name,
        detail: `image · ${(file.size / 1024).toFixed(1)} KB`,
        kind: "image",
        pendingImport: {
          entries: [
            {
              path: `assets/${file.name}`,
              binary: true,
              size: file.size,
              mime: file.type,
              updatedAt: Date.now(),
            },
          ],
          contents: [{ path: `assets/${file.name}`, content: dataUrl }],
          skippedDirs: [],
        },
      });
    }
    if (list.length > 0) {
      setAttachments((prev) => [...prev, ...list]);
    }
  }, []);

  const handleAttachFiles = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    e.target.value = "";
    if (!files || files.length === 0) return;
    const list: AttachedContext[] = [];
    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) {
        // Reuse the image path.
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Could not read file."));
          reader.readAsDataURL(file);
        });
        list.push({
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          label: file.name,
          detail: `file · ${(file.size / 1024).toFixed(1)} KB`,
          kind: "file",
          pendingImport: {
            entries: [
              { path: file.name, binary: true, size: file.size, mime: file.type, updatedAt: Date.now() },
            ],
            contents: [{ path: file.name, content: dataUrl }],
            skippedDirs: [],
          },
        });
      } else {
        const text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Could not read file."));
          reader.readAsText(file);
        });
        list.push({
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          label: file.name,
          detail: `text · ${(file.size / 1024).toFixed(1)} KB`,
          kind: "file",
          pendingImport: {
            entries: [
              { path: file.name, binary: false, size: file.size, updatedAt: Date.now() },
            ],
            contents: [{ path: file.name, content: text }],
            skippedDirs: [],
          },
        });
      }
    }
    if (list.length > 0) {
      setAttachments((prev) => [...prev, ...list]);
    }
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleOpenExistingProject = useCallback(
    async (projectId: string) => {
      setProjectPickerOpen(false);
      await openProject(projectId);
    },
    [openProject],
  );

  const handleSubmit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      // If any attachment has a pending project import, import it now.
      const projectAttachment = attachments.find(
        (a) => a.pendingImport && a.pendingImport.entries.length > 0,
      );
      if (projectAttachment?.pendingImport) {
        const projectName =
          projectAttachment.kind === "project"
            ? projectAttachment.label.replace(/\.zip$/i, "")
            : projectAttachment.label;
        const project = await importProject(projectName, projectAttachment.pendingImport);
        await openProject(project.id);
        toast({ title: "Project imported", description: project.name });
      }
      // Clear only successfully imported attachments.
      setAttachments([]);
    } catch (err) {
      toast({
        title: "Could not start",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }, [attachments, busy, importProject, openProject]);

  return (
    <div className="themed flex h-full w-full items-center justify-center overflow-y-auto bg-canvas p-6 text-fg">
      <div className="w-full max-w-2xl">
        {/* Title */}
        <div className="mb-6 flex items-center gap-2.5">
          <Sparkles className="h-5 w-5 text-accent" />
          <h2 className="text-base font-semibold">Visual Editor Studio</h2>
        </div>
        <p className="mb-6 text-sm text-fg-muted">
          Start by opening a project or importing source files. The editor opens in Direct Edit
          mode when live rendering isn&apos;t available.
        </p>

        {/* Composer */}
        <div className="themed rounded-md border border-line bg-surface">
          <p className="px-3 py-3 text-sm text-fg-muted">Attach a project ZIP, folder, or source file, then import it below.</p>

          {/* Attachments */}
          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 border-t border-line-muted px-2.5 py-2">
              {attachments.map((att) => (
                <span
                  key={att.id}
                  className="themed inline-flex items-center gap-1.5 rounded border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-fg-muted"
                >
                  {att.kind === "image" ? (
                    <ImageIcon className="h-3 w-3 shrink-0 text-accent" />
                  ) : att.kind === "project" ? (
                    <FolderOpen className="h-3 w-3 shrink-0 text-accent" />
                  ) : (
                    <Paperclip className="h-3 w-3 shrink-0 text-fg-faint" />
                  )}
                  <span className="max-w-[180px] truncate">{att.label}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(att.id)}
                    className="text-fg-faint hover:text-fg"
                    aria-label={`Remove ${att.label}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          {/* Composer controls */}
          <div className="flex items-center justify-between border-t border-line-muted px-2.5 py-1.5">
            <div className="flex items-center gap-1">
              {/* + Add menu */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAddMenuOpen((v) => !v)}
                  className="focus-ring themed inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                >
                  <Plus className="h-3 w-3" />
                  Add
                  <ChevronDown className="h-2.5 w-2.5" />
                </button>
                {addMenuOpen ? (
                  <div
                    role="menu"
                    className="themed absolute bottom-full left-0 z-30 mb-1 w-44 rounded-md border border-line bg-overlay p-1 shadow-pop"
                  >
                    <MenuItem icon={Upload} label="ZIP archive" onClick={() => { setAddMenuOpen(false); zipInputRef.current?.click(); }} />
                    <MenuItem icon={FolderOpen} label="Folder / project" onClick={() => { setAddMenuOpen(false); folderInputRef.current?.click(); }} />
                    <MenuItem icon={ImageIcon} label="Image" onClick={() => { setAddMenuOpen(false); imageInputRef.current?.click(); }} />
                    <MenuItem icon={Paperclip} label="Files" onClick={() => { setAddMenuOpen(false); filesInputRef.current?.click(); }} />
                    <MenuItem icon={FolderOpen} label="Existing LUCIAN project" onClick={() => { setAddMenuOpen(false); setProjectPickerOpen(true); }} />
                  </div>
                ) : null}
              </div>

              {/* Hidden file inputs */}
              <input ref={zipInputRef} type="file" accept=".zip,application/zip" onChange={handleAttachZip} className="hidden" />
              <input ref={folderInputRef} type="file" multiple onChange={handleAttachFolder} className="hidden" />
              <input ref={imageInputRef} type="file" accept="image/*" multiple onChange={handleAttachImage} className="hidden" />
              <input ref={filesInputRef} type="file" multiple onChange={handleAttachFiles} className="hidden" />

              {/* Project picker (when "Existing LUCIAN project" is chosen) */}
              {projectPickerOpen ? (
                <div className="themed ml-1 flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[11px]">
                  <select
                    className="bg-transparent text-xs text-fg focus:outline-none"
                    onChange={(e) => e.target.value && handleOpenExistingProject(e.target.value)}
                    value=""
                  >
                    <option value="" disabled>Choose a project…</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setProjectPickerOpen(false)}
                    className="text-fg-faint hover:text-fg"
                    aria-label="Cancel"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : null}

              {/* "Open existing project" shortcut when no attachments yet */}
              {attachments.length === 0 && !projectPickerOpen ? (
                <button
                  type="button"
                  onClick={() => setProjectPickerOpen(true)}
                  className="focus-ring themed inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                >
                  <FolderOpen className="h-3 w-3" />
                  Project
                </button>
              ) : null}
            </div>

            <Button
              size="sm"
              className="h-7"
              disabled={busy || !attachments.some(attachment => attachment.pendingImport?.entries.length)}
              onClick={() => void handleSubmit()}
            >
              <Send className="mr-1.5 h-3 w-3" />
              {attachments.length > 0 ? "Open" : "Start"}
            </Button>
          </div>
        </div>

        {/* Hint row */}
        <div className="mt-3 flex items-center justify-between text-[11px] text-fg-faint">
          <span>
            Tip: <kbd className="rounded border border-line px-1 py-px font-sans">⌘</kbd>{" "}
            <kbd className="rounded border border-line px-1 py-px font-sans">↵</kbd> to submit.
          </span>
          <button
            type="button"
            onClick={() => setView("library")}
            className="focus-ring themed rounded text-fg-muted hover:text-fg"
          >
            Browse all projects →
          </button>
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Upload;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "focus-ring themed flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs text-fg transition-colors hover:bg-hover",
      )}
    >
      <Icon className="h-3 w-3 text-fg-muted" />
      {label}
    </button>
  );
}
