"use client";

// LUCIAN Storage Manager.
//
// A professional storage utility panel — NOT an AI-generated card stack.
//
// Layout (single column, table-style):
//   ┌──────────────────────────────────────────────┐
//   │ Storage Manager                      [×]      │  ← header w/ ONE close
//   ├──────────────────────────────────────────────┤
//   │ USAGE                                        │
//   │ Used bar ████████░░░░░░░░░░  144 KB / 10 GB  │
//   │                                              │
//   │ PROTECTION                                   │
//   │ [✓] Protected   [Protect Local Storage]       │
//   │                                              │
//   │ PROJECTS (3)                          746 B   │
//   │ ─────────────────────────────────────────── │
//   │ visual-test         HTML  · 3 files  · 746 B │
//   │ coming-soon         HTML  · 5 files  · 1.2 K │
//   │                                              │
//   │ RECYCLE BIN (2)              [Empty bin]     │
//   │ ─────────────────────────────────────────── │
//   │ old-project         trashed 8/22    [Restore]│
//   │ test                trashed 8/20    [Restore]│
//   └──────────────────────────────────────────────┘
//
// Honest throughout: shows real browser estimates, no fake upgrades,
// truthful persistence request result.

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  HardDrive,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-devspace/dialog";
import { Button } from "@/components/ui-devspace/button";
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
import {
  estimateStorage,
  isStoragePersistent,
  requestPersistentStorage,
} from "@/lib/workspace/db";
import { formatBytes } from "@/lib/workspace/filesystem";
import { frameworkLabel } from "@/lib/workspace/filesystem";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface StorageManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StorageManagerDialog({ open, onOpenChange }: StorageManagerDialogProps) {
  const {
    projects,
    trashedProjects,
    refreshProjects,
    refreshTrashedProjects,
    permanentlyDeleteProject,
    restoreProject,
    emptyRecycleBin,
  } = useWorkspaceStore();

  const [storage, setStorage] = useState({ usage: 0, quota: 0 });
  const [persistence, setPersistence] = useState<{ supported: boolean; persisted: boolean }>({
    supported: false,
    persisted: false,
  });
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [est, persisted] = await Promise.all([
        estimateStorage(),
        isStoragePersistent(),
      ]);
      setStorage(est);
      setPersistence(persisted);
      await Promise.all([refreshProjects(), refreshTrashedProjects()]);
    } finally {
      setLoading(false);
    }
  }, [refreshProjects, refreshTrashedProjects]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      void refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [open, refresh]);

  const handleRequestPersistence = async () => {
    setRequesting(true);
    try {
      const result = await requestPersistentStorage();
      setPersistence(result);
      if (!result.supported) {
        toast({
          title: "Persistence not supported",
          description: "This browser does not expose the persistent storage API.",
          variant: "destructive",
        });
      } else if (result.persisted) {
        toast({
          title: "Local storage protected",
          description:
            "Your browser granted persistence. Stored projects will not be evicted automatically.",
        });
      } else {
        toast({
          title: "Persistence request denied",
          description:
            "Your browser declined. Some browsers only grant persistence for installed/PWA sites.",
          variant: "destructive",
        });
      }
    } finally {
      setRequesting(false);
    }
  };

  const handleRestore = async (id: string) => {
    await restoreProject(id);
    toast({ title: "Project restored" });
    void refresh();
  };

  const handlePermanentDelete = async (id: string) => {
    await permanentlyDeleteProject(id);
    setConfirmDelete(null);
    toast({ title: "Project permanently deleted" });
    void refresh();
  };

  const handleEmptyBin = async () => {
    setConfirmEmpty(false);
    await emptyRecycleBin();
    toast({ title: "Recycle Bin emptied" });
    void refresh();
  };

  const usedPct =
    storage.quota > 0 ? Math.min(100, (storage.usage / storage.quota) * 100) : 0;
  const liveTotal = projects.reduce((s, p) => s + p.totalSize, 0);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[88vh] max-w-2xl gap-0 overflow-hidden p-0"
        >
          {/* Header — single close button, no duplicate */}
          <DialogHeader className="flex-row items-center justify-between border-b border-line-muted px-4 py-3">
            <DialogTitle className="flex items-center gap-2 text-sm font-medium">
              <HardDrive className="h-4 w-4 text-fg-muted" />
              Storage Manager
            </DialogTitle>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close Storage Manager"
              className="focus-ring themed inline-flex h-6 w-6 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogHeader>

          <div className="max-h-[calc(88vh-50px)] overflow-y-auto px-4 py-3">
            {/* USAGE */}
            <SectionLabel>Usage</SectionLabel>
            <div className="mb-3 mt-1.5">
              {storage.quota > 0 ? (
                <>
                  <div className="mb-1 flex items-baseline justify-between text-xs">
                    <span className="font-mono text-fg">
                      {formatBytes(storage.usage)}
                    </span>
                    <span className="text-fg-faint">of {formatBytes(storage.quota)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-inset">
                    <div
                      className="h-full rounded-full bg-accent transition-all"
                      style={{ width: `${Math.max(usedPct, 0.5)}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-fg-faint">
                    Per-origin estimate from{" "}
                    <code className="font-mono">navigator.storage.estimate()</code>.
                    Quota is set by the browser and cannot be increased by Lucian.
                  </p>
                </>
              ) : (
                <p className="text-xs text-fg-muted">
                  The browser does not expose storage estimates on this device.
                </p>
              )}
            </div>

            {/* PROTECTION */}
            <SectionLabel>Protection</SectionLabel>
            <div className="mb-3 mt-1.5 flex items-center justify-between rounded-md border border-line bg-surface px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <ShieldCheck
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    persistence.persisted ? "text-accent" : "text-fg-faint",
                  )}
                />
                <span className="text-xs">
                  {persistence.supported ? (
                    persistence.persisted ? "Protected" : "Not protected"
                  ) : (
                    "Unsupported by this browser"
                  )}
                </span>
              </div>
              {persistence.supported && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  disabled={requesting || persistence.persisted}
                  onClick={handleRequestPersistence}
                >
                  {requesting ? (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  ) : (
                    <ShieldCheck className="mr-1.5 h-3 w-3" />
                  )}
                  {persistence.persisted ? "Protected" : "Protect Local Storage"}
                </Button>
              )}
            </div>

            {/* PROJECTS */}
            <SectionLabel
              right={
                <span className="font-mono text-[11px] text-fg-faint">
                  {formatBytes(liveTotal)}
                </span>
              }
            >
              Projects ({projects.length})
            </SectionLabel>
            <div className="mb-3 mt-1.5">
              {projects.length === 0 ? (
                <p className="px-3 py-3 text-xs text-fg-faint">No live projects.</p>
              ) : (
                <ul className="divide-y divide-line-muted border border-line">
                  {projects.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 bg-surface px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-fg">{p.name}</p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-fg-faint">
                          {frameworkLabel(p.framework)} · {p.fileCount} files
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-[11px] text-fg-muted">
                        {formatBytes(p.totalSize)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* RECYCLE BIN */}
            <SectionLabel
              right={
                trashedProjects.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setConfirmEmpty(true)}
                    className="text-[11px] text-[color-mix(in_srgb,var(--accent)_85%,var(--fg))] hover:underline"
                  >
                    Empty bin
                  </button>
                ) : null
              }
            >
              Recycle Bin ({trashedProjects.length})
            </SectionLabel>
            <div className="mt-1.5">
              {trashedProjects.length === 0 ? (
                <p className="px-3 py-3 text-xs text-fg-faint">Empty.</p>
              ) : (
                <ul className="divide-y divide-line-muted border border-line">
                  {trashedProjects.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 bg-surface px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-fg">{p.name}</p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-fg-faint">
                          {p.fileCount} files · {formatBytes(p.totalSize)}
                          {p.trashedAt
                            ? ` · ${new Date(p.trashedAt).toLocaleDateString()}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => handleRestore(p.id)}
                        >
                          <RotateCcw className="mr-1 h-3 w-3" />
                          Restore
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-[color-mix(in_srgb,var(--accent)_85%,var(--fg))]"
                          title="Delete forever"
                          onClick={() => setConfirmDelete(p.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm: empty recycle bin */}
      <AlertDialog open={confirmEmpty} onOpenChange={setConfirmEmpty}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Empty Recycle Bin?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {trashedProjects.length}{" "}
              {trashedProjects.length === 1 ? "project" : "projects"} and all
              of their files. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[color-mix(in_srgb,var(--accent)_70%,#000_25%)] text-accent-fg hover:bg-[color-mix(in_srgb,var(--accent)_55%,#000_35%)]"
              onClick={handleEmptyBin}
            >
              <AlertTriangle className="mr-2 h-4 w-4" />
              Empty Recycle Bin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm: permanently delete one */}
      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project forever?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the project record and all of its files.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[color-mix(in_srgb,var(--accent)_70%,#000_25%)] text-accent-fg hover:bg-[color-mix(in_srgb,var(--accent)_55%,#000_35%)]"
              onClick={() => confirmDelete && handlePermanentDelete(confirmDelete)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SectionLabel({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-t border-line-muted pt-3 first:border-t-0 first:pt-0">
      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
        <ChevronRight className="h-2.5 w-2.5" />
        {children}
      </span>
      {right}
    </div>
  );
}
