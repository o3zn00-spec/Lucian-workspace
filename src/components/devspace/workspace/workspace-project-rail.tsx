"use client";

import {
  ChevronLeft,
  ChevronRight,
  FileCode2,
  FolderKanban,
  Library,
  Plus,
} from "lucide-react";

import { useWorkspaceStore } from "@/store/workspace";
import { cn } from "@/lib/utils";

interface WorkspaceProjectRailProps {
  collapsed?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
}

export function WorkspaceProjectRail({
  collapsed = false,
  onCollapse,
  onExpand,
}: WorkspaceProjectRailProps) {
  const projects = useWorkspaceStore((state) => state.projects);
  const activeProject = useWorkspaceStore((state) => state.activeProject);
  const openProject = useWorkspaceStore((state) => state.openProject);
  const setView = useWorkspaceStore((state) => state.setView);
  const openTabs = useWorkspaceStore((state) => state.openTabs);
  const activeTab = useWorkspaceStore((state) => state.activeTab);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);

  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center border-r border-line-muted bg-surface-2 py-2">
        <button
          type="button"
          onClick={onExpand}
          title="Expand projects"
          aria-label="Expand projects"
          className="focus-ring flex h-7 w-7 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
        <FolderKanban className="mt-3 h-4 w-4 text-accent" />
        <span className="mt-2 [writing-mode:vertical-rl] text-[9px] font-semibold uppercase tracking-[0.18em] text-fg-faint">
          Projects
        </span>
      </div>
    );
  }

  const availableProjects = projects.filter((project) => !project.trashedAt);

  return (
    <aside className="flex h-full min-w-0 flex-col border-r border-line-muted bg-surface-2 text-fg">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line-muted px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <FolderKanban className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.12em]">Projects</span>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          title="Collapse projects"
          aria-label="Collapse projects"
          className="focus-ring flex h-6 w-6 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-line-muted p-2">
        <button
          type="button"
          onClick={() => setView("library")}
          className="focus-ring flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5 text-[10px] font-medium text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Library className="h-3 w-3" /> Library
        </button>
        <button
          type="button"
          onClick={() => setView("library")}
          title="Create or import a project in the library"
          className="focus-ring flex h-7 w-7 items-center justify-center rounded-md border border-line bg-surface text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="mb-1 px-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-fg-faint">
          All projects
        </div>
        <div className="space-y-0.5">
          {availableProjects.map((project) => (
            <button
              type="button"
              key={project.id}
              onClick={() => void openProject(project.id)}
              className={cn(
                "focus-ring flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
                activeProject?.id === project.id
                  ? "bg-accent/15 text-fg ring-1 ring-accent/25"
                  : "text-fg-muted hover:bg-hover hover:text-fg",
              )}
            >
              <span className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold",
                activeProject?.id === project.id
                  ? "border-accent/30 bg-accent/15 text-accent"
                  : "border-line bg-surface text-fg-faint",
              )}>
                {project.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-medium">{project.name}</span>
                <span className="block truncate text-[9px] text-fg-faint">{project.fileCount} files · {project.framework}</span>
              </span>
            </button>
          ))}
          {availableProjects.length === 0 && (
            <button
              type="button"
              onClick={() => setView("library")}
              className="w-full rounded-md border border-dashed border-line px-3 py-5 text-center text-[10px] text-fg-faint hover:bg-hover"
            >
              Create or import your first project
            </button>
          )}
        </div>

        <div className="mb-1 mt-5 px-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-fg-faint">
          Working set
        </div>
        <div className="space-y-0.5">
          {openTabs.map((tab) => (
            <button
              type="button"
              aria-label={`Open file ${tab.path}`}
              key={tab.path}
              onClick={() => setActiveTab(tab.path)}
              className={cn(
                "focus-ring flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-[10px]",
                activeTab === tab.path ? "bg-hover text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
              )}
            >
              <FileCode2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{tab.path}</span>
              {tab.dirty && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" title="Unsaved" />}
            </button>
          ))}
          {openTabs.length === 0 && (
            <p className="px-2 py-2 text-[10px] leading-relaxed text-fg-faint">
              Files you open appear here as your current coding tasks.
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}
