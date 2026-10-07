"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  ChevronLeft,
  ChevronRight,
  Code2,
  Eye,
  Files,
  Maximize2,
  Minimize2,
  PanelsTopLeft,
  Rows3,
  Search,
  TerminalSquare,
} from "lucide-react";
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from "react-resizable-panels";

import { FileExplorer } from "./file-explorer";
import { CodeEditorPane } from "./code-editor-pane";
import { PreviewPane } from "./preview-pane";
import { LiveRuntimePane } from "./live-runtime-pane";
import { WorkspaceToolbar } from "./workspace-toolbar";
import { WorkspaceEmptyState } from "./workspace-empty-state";
import { WorkspaceProjectRail } from "./workspace-project-rail";
import { WorkspaceSearchPanel } from "./workspace-search-panel";

import { useWorkspaceStore } from "@/store/workspace";
import { cn } from "@/lib/utils";

type WorkbenchTab = "files" | "search" | "code" | "preview" | "runtime" | "split";
type MobileSection = "projects" | "workspace";
type FullscreenMode = "workspace" | "preview" | null;

const WORKBENCH_TABS: Array<{
  id: WorkbenchTab;
  label: string;
  icon: typeof Files;
}> = [
  { id: "files", label: "Files", icon: Files },
  { id: "search", label: "Search", icon: Search },
  { id: "code", label: "Code", icon: Code2 },
  { id: "preview", label: "Preview", icon: Eye },
  { id: "runtime", label: "Terminal", icon: TerminalSquare },
  { id: "split", label: "Split", icon: Rows3 },
];

function isWorkbenchTab(value: string | null): value is WorkbenchTab {
  return WORKBENCH_TABS.some((tab) => tab.id === value);
}

export function WorkspaceView() {
  const activeProject = useWorkspaceStore((state) => state.activeProject);
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>("code");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [mobileSection, setMobileSection] = useState<MobileSection>("workspace");
  const [fullscreenMode, setFullscreenMode] = useState<FullscreenMode>(null);
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const projectsRef = useRef<ImperativePanelHandle>(null);

  useEffect(() => {
    const id = window.setTimeout(() => {
      const stored = window.localStorage.getItem("lucian:workspace:workbench-tab");
      if (isWorkbenchTab(stored)) setWorkbenchTab(stored);
      setPreferencesReady(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    window.localStorage.setItem("lucian:workspace:workbench-tab", workbenchTab);
  }, [preferencesReady, workbenchTab]);

  useEffect(() => {
    if (!fullscreenMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreenMode(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [fullscreenMode]);

  if (!activeProject) return <WorkspaceEmptyState />;

  const selectWorkbenchTab = (tab: WorkbenchTab) => {
    setWorkbenchTab(tab);
    setMobileSection("workspace");
  };

  if (fullscreenMode === "preview") {
    return (
      <div className="themed fixed inset-0 z-[120] flex flex-col bg-canvas text-fg">
        <FullscreenHeader
          title={`${activeProject.name} · Preview`}
          onExit={() => setFullscreenMode(null)}
        />
        <div className="min-h-0 flex-1"><PreviewPane /></div>
      </div>
    );
  }

  return (
    <div className={cn(
      "themed flex h-full min-h-0 flex-col bg-canvas text-fg",
      fullscreenMode === "workspace" && "fixed inset-0 z-[120]",
    )}>
      {fullscreenMode === "workspace" ? (
        <FullscreenHeader
          title={`${activeProject.name} · DevWorkspace`}
          onExit={() => setFullscreenMode(null)}
        />
      ) : (
        <WorkspaceToolbar />
      )}

      <MobileSectionTabs value={mobileSection} onChange={setMobileSection} />

      <div className="min-h-0 flex-1 lg:hidden">
        {mobileSection === "projects" && <WorkspaceProjectRail />}
        
        {mobileSection === "workspace" && (
          <Workbench
            activeTab={workbenchTab}
            onTabChange={selectWorkbenchTab}
            onFullscreenWorkspace={() => setFullscreenMode("workspace")}
            onFullscreenPreview={() => setFullscreenMode("preview")}
          />
        )}
      </div>

      <div className="hidden min-h-0 flex-1 lg:block">
        <PanelGroup
          direction="horizontal"
          autoSaveId="lucian-devworkspace-primary-layout-v1"
          className="h-full"
        >
          <Panel
            ref={projectsRef}
            id="projects"
            order={1}
            defaultSize={20}
            minSize={13}
            maxSize={25}
            collapsible
            collapsedSize={4}
            onCollapse={() => setProjectsCollapsed(true)}
            onExpand={() => setProjectsCollapsed(false)}
          >
            <WorkspaceProjectRail
              collapsed={projectsCollapsed}
              onCollapse={() => projectsRef.current?.collapse()}
              onExpand={() => projectsRef.current?.expand(16)}
            />
          </Panel>

          <ResizeHandle label="Resize projects and workspace" />

          <Panel id="workbench" order={2} defaultSize={80} minSize={34}>
            <Workbench
              activeTab={workbenchTab}
              onTabChange={selectWorkbenchTab}
              projectsCollapsed={projectsCollapsed}
              onToggleProjects={() => projectsCollapsed ? projectsRef.current?.expand(16) : projectsRef.current?.collapse()}
              onFullscreenWorkspace={() => setFullscreenMode("workspace")}
              onFullscreenPreview={() => setFullscreenMode("preview")}
            />
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}

function Workbench({
  activeTab,
  onTabChange,
  projectsCollapsed = false,
  onToggleProjects,
  onFullscreenWorkspace,
  onFullscreenPreview,
}: {
  activeTab: WorkbenchTab;
  onTabChange: (tab: WorkbenchTab) => void;
  projectsCollapsed?: boolean;
  onToggleProjects?: () => void;
  onFullscreenWorkspace: () => void;
  onFullscreenPreview: () => void;
}) {
  return (
    <section className="flex h-full min-w-0 flex-col bg-surface" aria-label="Project workspace">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line-muted bg-surface-2 px-2">
        <div className="hidden items-center gap-0.5 xl:flex">
          {onToggleProjects && (
            <button
              type="button"
              onClick={onToggleProjects}
              title={projectsCollapsed ? "Show projects" : "Hide projects"}
              className="focus-ring flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg"
            >
              {projectsCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
            </button>
          )}
          
          <div className="mx-1 h-4 w-px bg-line-muted" />
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {WORKBENCH_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                type="button"
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  "focus-ring flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[10px] font-medium transition-colors",
                  activeTab === tab.id
                    ? "bg-accent/15 text-accent ring-1 ring-accent/20"
                    : "text-fg-muted hover:bg-hover hover:text-fg",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {activeTab === "preview" || activeTab === "split" ? (
            <button
              type="button"
              onClick={onFullscreenPreview}
              title="Full-screen preview"
              aria-label="Full-screen preview"
              className="focus-ring flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onFullscreenWorkspace}
            title="Full-screen workspace"
            aria-label="Full-screen workspace"
            className="focus-ring flex h-7 w-7 items-center justify-center rounded text-fg-muted hover:bg-hover hover:text-fg"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "files" && <FileExplorer />}
        {activeTab === "search" && <WorkspaceSearchPanel onOpenCode={() => onTabChange("code")} />}
        {activeTab === "code" && <CodeEditorPane />}
        {activeTab === "preview" && <PreviewPane />}
        {activeTab === "runtime" && <LiveRuntimePane />}
        {activeTab === "split" && <SplitWorkbench />}
      </div>
    </section>
  );
}

function SplitWorkbench() {
  return (
    <PanelGroup
      direction="horizontal"
      autoSaveId="lucian-devworkspace-code-preview-split-v1"
      className="h-full"
    >
      <Panel id="split-code" order={1} defaultSize={52} minSize={30}>
        <CodeEditorPane />
      </Panel>
      <ResizeHandle label="Resize code and preview" />
      <Panel id="split-preview" order={2} defaultSize={48} minSize={30}>
        <PreviewPane />
      </Panel>
    </PanelGroup>
  );
}

function ResizeHandle({ label }: { label: string }) {
  return (
    <PanelResizeHandle
      aria-label={label}
      className="group relative w-1 shrink-0 bg-line-muted/60 outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent"
    >
      <span className="absolute inset-y-0 -left-1 -right-1" />
    </PanelResizeHandle>
  );
}



function FullscreenHeader({ title, onExit }: { title: string; onExit: () => void }) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-line-muted bg-surface-2 px-3">
      <div className="flex min-w-0 items-center gap-2">
        <PanelsTopLeft className="h-4 w-4 shrink-0 text-accent" />
        <span className="truncate text-xs font-semibold">{title}</span>
        <span className="hidden text-[10px] text-fg-faint sm:inline">Press Esc to exit</span>
      </div>
      <button
        type="button"
        onClick={onExit}
        className="focus-ring flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[10px] text-fg-muted hover:bg-hover hover:text-fg"
      >
        <Minimize2 className="h-3.5 w-3.5" /> Exit full screen
      </button>
    </div>
  );
}

function MobileSectionTabs({
  value,
  onChange,
}: {
  value: MobileSection;
  onChange: (section: MobileSection) => void;
}) {
  const tabs: Array<{ id: MobileSection; label: string; icon: typeof Files }> = [
    { id: "projects", label: "Projects", icon: Files },
    { id: "workspace", label: "Workspace", icon: PanelsTopLeft },
  ];
  return (
    <div className="flex h-10 shrink-0 items-center justify-center gap-1 border-b border-line-muted bg-surface-2 px-2 lg:hidden">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            type="button"
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={cn(
              "focus-ring flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md text-[10px] font-medium",
              value === tab.id ? "bg-accent/15 text-accent" : "text-fg-muted hover:bg-hover",
            )}
          >
            <Icon className="h-3.5 w-3.5" /> {tab.label}
          </button>
        );
      })}
    </div>
  );
}
