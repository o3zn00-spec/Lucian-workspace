"use client";

// Direct Edit canvas.
//
// Shown when the active project can't be rendered in an iframe (no HTML
// entry, broken structure, missing deps). Instead of disabling the Visual
// Editor, we surface what we CAN honestly understand:
//
//   - Framework + file counts at the top
//   - Honest diagnostics list (each with severity, label, detail, action)
//   - A read-only preview of the project's structure (HTML files, components,
//     styles, assets, config, routes)
//
// The user can still inspect files, ask the Agent to fix issues, and jump
// to the Workspace Code editor to make changes. When they fix the missing
// entry, the analysis re-runs and the editor flips to Live Canvas mode.

import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Code2,
  FileCode2,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Settings2,
} from "lucide-react";
import { useWorkspaceStore } from "@/store/workspace";
import { frameworkLabel, formatBytes } from "@/lib/workspace/filesystem";
import type {
  DiagnosticItem,
  ProjectAnalysis,
} from "@/lib/workspace/visual-editor";
import { Button } from "@/components/ui-devspace/button";
import { cn } from "@/lib/utils";

interface DirectEditCanvasProps {
  analysis: ProjectAnalysis;
}

export function DirectEditCanvas({ analysis }: DirectEditCanvasProps) {
  const activeProject = useWorkspaceStore((s) => s.activeProject);
  const setView = useWorkspaceStore((s) => s.setView);
  if (!activeProject) return null;

  return (
    <div className="themed flex h-full flex-col overflow-y-auto bg-canvas text-fg">
      <div className="mx-auto w-full max-w-3xl px-6 py-8">
        {/* Header — what mode + why */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface-2 text-amber-500 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-medium">Direct Edit mode</p>
              <p className="text-[11px] text-fg-faint">
                Visual preview is limited for this project
              </p>
            </div>
          </div>
          <div className="text-right text-[11px] text-fg-muted">
            <p className="font-mono text-fg">{frameworkLabel(activeProject.framework)}</p>
            <p>{activeProject.fileCount} files · {formatBytes(activeProject.totalSize)}</p>
          </div>
        </div>

        {/* Explanation */}
        <p className="mb-6 rounded-md border border-line-muted bg-surface-2/40 px-3 py-2.5 text-xs text-fg-muted">
          {analysis.explanation}
        </p>

        {/* Diagnostics */}
        <section className="mb-6">
          <SectionLabel>Diagnostics</SectionLabel>
          <ul className="mt-1.5 space-y-1.5">
            {analysis.diagnostics.map((d, i) => (
              <DiagnosticRow key={i} item={d} />
            ))}
          </ul>
        </section>

        {/* Project structure (everything we honestly detected) */}
        <section className="mb-6">
          <SectionLabel>Project structure</SectionLabel>
          <div className="mt-1.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <StructureCard
              icon={FileText}
              label="HTML files"
              files={analysis.htmlFiles}
              emptyText="No HTML files"
            />
            <StructureCard
              icon={FileCode2}
              label="Components / scripts"
              files={analysis.componentFiles}
              emptyText="No component files"
            />
            <StructureCard
              icon={Code2}
              label="Styles"
              files={analysis.styleFiles}
              emptyText="No style files"
            />
            <StructureCard
              icon={ImageIcon}
              label="Assets"
              files={analysis.assetFiles}
              emptyText="No binary assets"
            />
            <StructureCard
              icon={Settings2}
              label="Config"
              files={analysis.configFiles}
              emptyText="No config files"
            />
            <StructureCard
              icon={FolderOpen}
              label="Routes / entries"
              files={analysis.routes}
              emptyText="No routes detected"
            />
          </div>
        </section>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line-muted pt-4">
          <Button variant="secondary" size="sm" onClick={() => setView("workspace")}>
            <Code2 className="mr-1.5 h-3.5 w-3.5" />
            Open in Workspace
          </Button>
          <span className="text-[11px] text-fg-faint">
            Use the code editor to inspect and fix the reported issues.
          </span>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
      {children}
    </span>
  );
}

function DiagnosticRow({ item }: { item: DiagnosticItem }) {
  const Icon = item.severity === "error" ? AlertCircle : item.severity === "warning" ? AlertTriangle : Info;
  const color =
    item.severity === "error"
      ? "text-red-500"
      : item.severity === "warning"
      ? "text-amber-500 dark:text-amber-400"
      : "text-fg-faint";
  return (
    <li className="themed flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2">
      <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", color)} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-fg">{item.label}</p>
        <p className="mt-0.5 text-[11px] text-fg-muted">{item.detail}</p>
        {item.action ? (
          <p className="mt-1 text-[11px] text-fg-faint">
            <span className="font-medium text-fg-muted">Action:</span> {item.action}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function StructureCard({
  icon: Icon,
  label,
  files,
  emptyText,
}: {
  icon: typeof FileText;
  label: string;
  files: string[];
  emptyText: string;
}) {
  return (
    <div className="themed rounded-md border border-line bg-surface px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5">
        <Icon className="h-3 w-3 text-fg-muted" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
          {label}
        </span>
        <span className="ml-auto text-[10px] text-fg-faint">{files.length}</span>
      </div>
      {files.length === 0 ? (
        <p className="px-1 py-1 text-[11px] text-fg-faint">{emptyText}</p>
      ) : (
        <ul className="space-y-0.5">
          {files.slice(0, 8).map((p) => (
            <li key={p} className="truncate font-mono text-[10px] text-fg-muted" title={p}>
              {p}
            </li>
          ))}
          {files.length > 8 ? (
            <li className="px-1 text-[10px] text-fg-faint">+{files.length - 8} more</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

// Suppress unused-import warning for CheckCircle2 (kept for future use).
void CheckCircle2;
