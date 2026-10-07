"use client";

import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  File as FileIcon,
  FilePlus,
  FolderPlus,
  Trash2,
  Pencil,
  Move,
  Folder,
  FolderOpen,
  Search,
  X,
  Loader2,
} from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { Button } from "@/components/ui-devspace/button";
import { Input } from "@/components/ui-devspace/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui-devspace/context-menu";
import {
  buildFileTree,
  getExtension,
  searchByFilename,
  type TreeNode,
  type SearchHit,
} from "@/lib/workspace/filesystem";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const FILE_ICON_COLORS: Record<string, string> = {
  jsx: "text-cyan-500",
  tsx: "text-blue-500",
  js: "text-yellow-500",
  ts: "text-blue-500",
  json: "text-amber-500",
  html: "text-orange-500",
  css: "text-pink-500",
  scss: "text-pink-500",
  md: "text-zinc-500",
  vue: "text-emerald-500",
  svg: "text-violet-500",
  png: "text-violet-500",
  jpg: "text-violet-500",
  jpeg: "text-violet-500",
};

const ROW_HEIGHT = 28; // px per tree row
const MAX_RENDER_ROWS = 200; // cap concurrent DOM nodes for perf

export function FileExplorer() {
  const {
    activeProject,
    openTab,
    activeTab,
    createFile,
    createFolder,
    deletePath,
    movePath,
  } = useWorkspaceStore();
  const [creating, setCreating] = useState<{ parent: string; kind: "file" | "folder" } | null>(null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [search, setSearch] = useState("");

  const tree = useMemo(
    () => buildFileTree(activeProject?.files ?? [], activeProject?.directories ?? []),
    [activeProject?.files, activeProject?.directories],
  );

  // Flatten the tree into visible rows, respecting collapsed state.
  // We default to collapsed for projects with >50 files at the root level
  // to keep the initial render fast.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    if ((activeProject?.files?.length ?? 0) > 50) {
      // Auto-collapse top-level dirs for huge projects.
      const set = new Set<string>();
      for (const child of tree.children) {
        if (child.isDir) set.add(child.path);
      }
      return set;
    }
    return new Set();
  });

  // Reset collapsed state when project changes. This is the "adjusting state
  // when prop changes" pattern from the React docs — we track the previous
  // project id and only recompute when it actually changes.
  const [lastProjectId, setLastProjectId] = useState<string | null>(null);
  if (activeProject?.id !== lastProjectId) {
    setLastProjectId(activeProject?.id ?? null);
    if ((activeProject?.files?.length ?? 0) > 50) {
      const set = new Set<string>();
      for (const child of tree.children) {
        if (child.isDir) set.add(child.path);
      }
      setCollapsed(set);
    } else {
      setCollapsed(new Set());
    }
  }

  const flatRows = useMemo(() => {
    const rows: { node: TreeNode; depth: number }[] = [];
    function walk(node: TreeNode, depth: number) {
      for (const child of node.children) {
        rows.push({ node: child, depth });
        if (child.isDir && !collapsed.has(child.path)) {
          walk(child, depth + 1);
        }
      }
    }
    walk(tree, 0);
    return rows;
  }, [tree, collapsed]);

  // Search results (filename-only; content search happens via the
  // dedicated search panel).
  const searchHits: SearchHit[] = useMemo(() => {
    if (!search.trim()) return [];
    return searchByFilename(activeProject?.files ?? [], search).slice(0, 100);
  }, [search, activeProject?.files]);

  const toggleCollapsed = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  if (!activeProject) return null;

  const handleCreate = async (parent: string) => {
    const createKind = creating?.kind;
    if (!createKind) return;
    if (!newName.trim()) {
      setCreating(null);
      return;
    }
    const fullPath = parent ? `${parent}/${newName.trim()}` : newName.trim();
    if (newName.includes("/")) {
      // Allow path-style names — they create nested folders automatically
      // when we save the file. We just need to expand all parent dirs.
      const parts = fullPath.split("/");
      for (let i = 1; i < parts.length; i++) {
        const dirPath = parts.slice(0, i).join("/");
        setCollapsed((prev) => {
          const next = new Set(prev);
          next.delete(dirPath);
          return next;
        });
      }
    }
    try {
      if (createKind === "folder") await createFolder(fullPath);
      else await createFile(fullPath, "");
      setCreating(null);
      setNewName("");
      setCollapsed((previous) => {
        const next = new Set(previous);
        next.delete(parent);
        return next;
      });
      toast({ title: createKind === "folder" ? "Folder created" : "File created", description: fullPath });
    } catch (error) {
      toast({
        title: "Create failed",
        description: error instanceof Error ? error.message : String(error),
        variant: "destructive",
      });
    }
  };

  const handleRename = async (oldPath: string) => {
    if (!renameVal.trim() || renameVal.includes("/")) {
      setRenaming(null);
      return;
    }
    const parent = oldPath.includes("/") ? oldPath.slice(0, oldPath.lastIndexOf("/")) : "";
    const newPath = parent ? `${parent}/${renameVal.trim()}` : renameVal.trim();
    if (newPath !== oldPath) {
      try {
        await movePath(oldPath, newPath);
        toast({ title: "Renamed", description: `${oldPath} → ${newPath}` });
      } catch (error) {
        toast({
          title: "Rename failed",
          description: error instanceof Error ? error.message : String(error),
          variant: "destructive",
        });
      }
    }
    setRenaming(null);
    setRenameVal("");
  };

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Header */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b px-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Files ({activeProject.fileCount})
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => {
              setCreating({ parent: "", kind: "file" });
              setNewName("");
            }}
            title="New file"
          >
            <FilePlus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => {
              setCreating({ parent: "", kind: "folder" });
              setNewName("");
            }}
            title="New folder"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Search bar */}
      <div className="border-b p-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by filename..."
            className="h-7 pl-7 pr-7 text-xs"
          />
          {search && (
            <button
              type="button"
              aria-label="Clear file search"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Tree / search results */}
      <div className="flex-1 overflow-y-auto py-1 text-sm">
        {creating && (
          <div className="px-2 py-1">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => handleCreate(creating.parent)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate(creating.parent);
                else if (e.key === "Escape") setCreating(null);
              }}
              placeholder={creating.kind === "folder" ? "path/to/folder" : "path/to/file.tsx"}
              className="h-7 text-xs"
            />
          </div>
        )}

        {search.trim() ? (
          // Search results mode
          <div>
            {searchHits.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                No files matching &quot;{search}&quot;
              </div>
            ) : (
              <div>
                <div className="px-3 py-1 text-[10px] uppercase text-muted-foreground">
                  {searchHits.length} match{searchHits.length !== 1 ? "es" : ""}
                </div>
                {searchHits.map((hit) => {
                  const ext = getExtension(hit.path);
                  const iconColor = FILE_ICON_COLORS[ext] ?? "text-muted-foreground";
                  const isActive = activeTab === hit.path;
                  const parts = hit.path.split("/");
                  const name = parts.pop();
                  const dir = parts.join("/");
                  return (
                    <button
                      key={hit.path}
                      onClick={() => openTab(hit.path)}
                      className={cn(
                        "flex w-full flex-col items-start gap-0 px-3 py-1.5 text-left hover:bg-accent",
                        isActive && "bg-accent",
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <FileIcon className={cn("h-3.5 w-3.5 shrink-0", iconColor)} />
                        <span className="text-sm font-medium">{name}</span>
                      </div>
                      {dir && (
                        <span className="pl-5 text-[10px] text-muted-foreground">
                          {dir}/
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : flatRows.length === 0 && !creating ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No files yet. Click <FilePlus className="inline h-3 w-3" /> to add one.
          </div>
        ) : (
          // Tree mode — render only the visible window.
          <VirtualizedTree
            rows={flatRows}
            activeTab={activeTab}
            collapsed={collapsed}
            onToggle={toggleCollapsed}
            onOpen={openTab}
            onDelete={async (path) => {
              try {
                await deletePath(path);
                toast({ title: "Deleted", description: `${path} · recovery snapshot saved` });
              } catch (error) {
                toast({
                  title: "Delete failed",
                  description: error instanceof Error ? error.message : String(error),
                  variant: "destructive",
                });
              }
            }}
            onMove={async (oldPath) => {
              const destination = prompt("Move to project path:", oldPath);
              if (!destination || destination === oldPath) return;
              try {
                await movePath(oldPath, destination);
                toast({ title: "Moved", description: `${oldPath} → ${destination}` });
              } catch (error) {
                toast({
                  title: "Move failed",
                  description: error instanceof Error ? error.message : String(error),
                  variant: "destructive",
                });
              }
            }}
            onCreate={(parent, kind) => {
              setCreating({ parent, kind });
              setNewName("");
            }}
            onRename={(p) => {
              setRenaming(p);
              setRenameVal(p.split("/").pop() ?? "");
            }}
            renaming={renaming}
            renameVal={renameVal}
            setRenameVal={setRenameVal}
            onRenameSubmit={handleRename}
            onRenameCancel={() => setRenaming(null)}
          />
        )}
      </div>
    </div>
  );
}

interface VirtualizedTreeProps {
  rows: { node: TreeNode; depth: number }[];
  activeTab: string | null;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onDelete: (path: string) => Promise<unknown>;
  onMove: (path: string) => Promise<void>;
  onCreate: (parent: string, kind: "file" | "folder") => void;
  onRename: (path: string) => void;
  renaming: string | null;
  renameVal: string;
  setRenameVal: (v: string) => void;
  onRenameSubmit: (oldPath: string) => Promise<void>;
  onRenameCancel: () => void;
}

function VirtualizedTree(props: VirtualizedTreeProps) {
  const { rows } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const resizeObserver = new ResizeObserver(() => {
      setViewportHeight(el.clientHeight);
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    resizeObserver.observe(el);
    setViewportHeight(el.clientHeight);
    return () => {
      el.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
    };
  }, []);

  const totalHeight = rows.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 10);
  const endIndex = Math.min(
    rows.length,
    startIndex + Math.ceil(viewportHeight / ROW_HEIGHT) + 20,
  );
  const visibleRows = rows.slice(startIndex, endIndex);

  return (
    <div
      ref={scrollRef}
      className="relative h-full overflow-y-auto"
      style={{ contain: "strict" }}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div style={{ position: "absolute", top: startIndex * ROW_HEIGHT, left: 0, right: 0 }}>
          {visibleRows.map(({ node, depth }, i) => (
            <TreeRow
              key={node.path}
              node={node}
              depth={depth}
              activeTab={props.activeTab}
              collapsed={props.collapsed}
              onToggle={props.onToggle}
              onOpen={props.onOpen}
              onDelete={props.onDelete}
              onMove={props.onMove}
              onCreate={props.onCreate}
              onRename={props.onRename}
              renaming={props.renaming}
              renameVal={props.renameVal}
              setRenameVal={props.setRenameVal}
              onRenameSubmit={props.onRenameSubmit}
              onRenameCancel={props.onRenameCancel}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  activeTab: string | null;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onDelete: (path: string) => Promise<unknown>;
  onMove: (path: string) => Promise<void>;
  onCreate: (parent: string, kind: "file" | "folder") => void;
  onRename: (path: string) => void;
  renaming: string | null;
  renameVal: string;
  setRenameVal: (v: string) => void;
  onRenameSubmit: (oldPath: string) => Promise<void>;
  onRenameCancel: () => void;
}

function TreeRow({
  node,
  depth,
  activeTab,
  collapsed,
  onToggle,
  onOpen,
  onDelete,
  onMove,
  onCreate,
  onRename,
  renaming,
  renameVal,
  setRenameVal,
  onRenameSubmit,
  onRenameCancel,
}: TreeRowProps) {
  const isCollapsed = collapsed.has(node.path);
  const handleContextAction = (action: "delete" | "rename" | "move") => {
    if (action === "delete") {
      if (confirm(`Delete ${node.path}? A recovery snapshot will be created first.`)) void onDelete(node.path);
    } else if (action === "move") {
      void onMove(node.path);
    } else {
      onRename(node.path);
    }
  };

  if (renaming === node.path) {
    return (
      <div
        className="flex items-center px-2"
        style={{ paddingLeft: `${depth * 12 + 8}px`, height: ROW_HEIGHT }}
      >
        <Input
          autoFocus
          value={renameVal}
          onChange={(event) => setRenameVal(event.target.value)}
          onBlur={() => void onRenameSubmit(node.path)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void onRenameSubmit(node.path);
            else if (event.key === "Escape") onRenameCancel();
          }}
          className="h-6 text-xs"
        />
      </div>
    );
  }

  if (node.isDir) {
    return (
      <div style={{ height: ROW_HEIGHT }}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              onClick={() => onToggle(node.path)}
              className="flex w-full items-center gap-1 px-2 text-left hover:bg-accent"
              style={{ paddingLeft: `${depth * 12 + 8}px`, height: ROW_HEIGHT }}
            >
              {isCollapsed ? (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )}
              {isCollapsed ? (
                <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              ) : (
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              )}
              <span className="truncate text-sm">{node.name}</span>
              {node.children.length > 0 && (
                <span className="ml-auto pr-2 text-[10px] text-muted-foreground">
                  {node.children.length}
                </span>
              )}
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => onCreate(node.path, "file")}>
              <FilePlus className="mr-2 h-4 w-4" /> New File Here
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onCreate(node.path, "folder")}>
              <FolderPlus className="mr-2 h-4 w-4" /> New Folder Here
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => onRename(node.path)}>
              <Pencil className="mr-2 h-4 w-4" /> Rename
            </ContextMenuItem>
            <ContextMenuItem onClick={() => handleContextAction("move")}>
              <Move className="mr-2 h-4 w-4" /> Move…
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => handleContextAction("delete")}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
    );
  }

  const ext = getExtension(node.path);
  const iconColor = FILE_ICON_COLORS[ext] ?? "text-muted-foreground";
  const isActive = activeTab === node.path;

  return (
    <div style={{ height: ROW_HEIGHT }}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            onClick={() => onOpen(node.path)}
            className={cn(
              "flex w-full items-center gap-1 px-2 text-left text-sm hover:bg-accent",
              isActive && "bg-accent",
            )}
            style={{ paddingLeft: `${depth * 12 + 24}px`, height: ROW_HEIGHT }}
          >
            <FileIcon className={cn("h-3.5 w-3.5 shrink-0", iconColor)} />
            <span className={cn("truncate", isActive && "font-medium")}>{node.name}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => onOpen(node.path)}>
            <FileIcon className="mr-2 h-4 w-4" /> Open
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onRename(node.path)}>
            <Pencil className="mr-2 h-4 w-4" /> Rename
          </ContextMenuItem>
          <ContextMenuItem onClick={() => handleContextAction("move")}>
            <Move className="mr-2 h-4 w-4" /> Move…
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => handleContextAction("delete")}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

// Suppress unused-import warnings for icons referenced elsewhere.
void Loader2;
