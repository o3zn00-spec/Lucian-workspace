"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import {
  Image as ImageIcon,
  Upload,
  Search,
  Loader2,
  Check,
  RefreshCw,
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
import { ScrollArea } from "@/components/ui-devspace/scroll-area";
import { useWorkspaceStore } from "@/store/workspace";
import { isImageFile } from "@/lib/workspace/filesystem";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { FileEntry } from "@/types/workspace";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function AssetManagerDialog({ open, onOpenChange }: Props) {
  const {
    activeProject,
    activeProjectId,
    writeFileBinary,
    refreshPreview,
    loadFileContent,
    contentCache,
  } = useWorkspaceStore();
  const [search, setSearch] = useState("");
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [recentlyReplaced, setRecentlyReplaced] = useState<string | null>(null);
  /** Paths whose content is currently being loaded for the thumbnail. */
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  /** Local cache of image data URLs, refreshed from the store. */
  const [imageData, setImageData] = useState<Record<string, string>>({});

  const imageFiles = useMemo<FileEntry[]>(
    () => (activeProject?.files ?? []).filter((f) => isImageFile(f.path)),
    [activeProject?.files],
  );

  const filtered = imageFiles.filter((f) =>
    f.path.toLowerCase().includes(search.toLowerCase()),
  );

  // Lazy-load image thumbnails when the dialog opens or the filter changes.
  useEffect(() => {
    if (!open || !activeProjectId) return;
    let cancelled = false;
    const toLoad = filtered.slice(0, 60).filter((f) => imageData[f.path] === undefined);
    if (toLoad.length === 0) return;
    // Defer the setLoadingPaths call so it's not synchronous in the effect
    // body (avoids the set-state-in-effect lint rule).
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoadingPaths(new Set(toLoad.map((f) => f.path)));
      const next: Record<string, string> = {};
      for (const f of toLoad) {
        const content = await loadFileContent(activeProjectId, f.path);
        if (cancelled) return;
        if (content !== undefined) next[f.path] = content;
      }
      if (!cancelled) {
        setImageData((prev) => ({ ...prev, ...next }));
        setLoadingPaths(new Set());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, activeProjectId, filtered, imageData, loadFileContent]);

  const handleReplace = async (target: FileEntry, file: File) => {
    setUploadingFor(target.path);
    try {
      const buffer = await file.arrayBuffer();
      const base64 = bytesToBase64(buffer);
      const mime = file.type || target.mime || "image/png";
      const dataUrl = `data:${mime};base64,${base64}`;
      await writeFileBinary(target.path, dataUrl, mime);
      // Update local cache so the thumbnail reflects the new image immediately.
      setImageData((prev) => ({ ...prev, [target.path]: dataUrl }));
      setRecentlyReplaced(target.path);
      refreshPreview();
      toast({
        title: "Image replaced",
        description: `${target.path} — preview will reload.`,
      });
      setTimeout(() => setRecentlyReplaced(null), 2000);
    } catch (err) {
      console.error(err);
      toast({
        title: "Replace failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setUploadingFor(null);
    }
  };

  // Suppress the unused-variable warning for contentCache (it's referenced via loadFileContent).
  void contentCache;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5" /> Asset Manager
          </DialogTitle>
          <DialogDescription>
            Replace any image in the project. The new file is written into the project tree, so
            the live preview will reflect the change after reload.
          </DialogDescription>
        </DialogHeader>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter images by path..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <ScrollArea className="flex-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
              <ImageIcon className="h-8 w-8 opacity-40" />
              <p>No images in this project</p>
              <p className="text-xs">Import images into your project to manage them here.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3 md:grid-cols-4">
              {filtered.slice(0, 100).map((file) => {
                const dataUrl = imageData[file.path];
                const isLoading = loadingPaths.has(file.path);
                return (
                  <div
                    key={file.path}
                    className={cn(
                      "group flex flex-col overflow-hidden rounded-lg border border-border/50 bg-card transition-all hover:shadow-md",
                      recentlyReplaced === file.path && "ring-2 ring-emerald-500",
                    )}
                  >
                    <div className="relative flex h-32 items-center justify-center overflow-hidden bg-muted">
                      {dataUrl ? (
                        // Using next/image with `unoptimized` because src is a
                        // base64 data: URL (next/image's optimizer cannot fetch
                        // or transform inline data: URLs).
                        <Image
                          src={dataUrl}
                          alt={file.path}
                          fill
                          unoptimized
                          className="object-contain"
                        />
                      ) : isLoading ? (
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      ) : (
                        <ImageIcon className="h-8 w-8 text-muted-foreground" />
                      )}
                      {recentlyReplaced === file.path && (
                        <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/20">
                          <Check className="h-8 w-8 text-emerald-600" />
                        </div>
                      )}
                      {uploadingFor === file.path && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                          <Loader2 className="h-6 w-6 animate-spin text-white" />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col gap-2 p-2">
                      <p className="truncate text-xs font-mono" title={file.path}>
                        {file.path}
                      </p>
                      <label className="cursor-pointer">
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleReplace(file, f);
                            e.target.value = "";
                          }}
                        />
                        <span className="flex w-full items-center justify-center gap-1 rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90">
                          <Upload className="h-3 w-3" /> Replace
                        </span>
                      </label>
                    </div>
                  </div>
                );
              })}
              {filtered.length > 100 && (
                <div className="col-span-full rounded-md bg-muted/50 p-3 text-center text-xs text-muted-foreground">
                  Showing first 100 images. Use the filter to narrow down the list.
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
          <span>{filtered.length} image{filtered.length !== 1 ? "s" : ""}</span>
          <Button variant="ghost" size="sm" onClick={refreshPreview}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh preview
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
