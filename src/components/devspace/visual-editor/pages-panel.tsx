"use client";

import { FileText, Home, Plus } from "lucide-react";
import { Button } from "@/components/ui-devspace/button";
import type { ProjectAnalysis } from "@/lib/workspace/visual-editor";
import { cn } from "@/lib/utils";

interface PagesPanelProps {
  analysis: ProjectAnalysis;
  activeEntry: string;
  onSelect: (path: string) => void;
  onCreate: () => void;
}

export function PagesPanel({ analysis, activeEntry, onSelect, onCreate }: PagesPanelProps) {
  const pages = [...new Set([
    ...(analysis.entryFile ? [analysis.entryFile] : []),
    ...analysis.htmlFiles,
    ...analysis.routes,
  ])];

  return (
    <div className="p-2 text-xs">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">Site pages</span>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onCreate} title="Create page">
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      {pages.length ? (
        <ul className="space-y-0.5">
          {pages.map((path, index) => (
            <li key={path}>
              <button
                type="button"
                onClick={() => onSelect(path)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left",
                  path === activeEntry ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
                )}
                title={`Open ${path} on the canvas`}
              >
                {index === 0 ? <Home className="h-3 w-3 shrink-0" /> : <FileText className="h-3 w-3 shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{pageLabel(path)}</span>
                <span className="max-w-20 truncate font-mono text-[9px] opacity-60">{pageRoute(path)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-md border border-dashed border-line p-3 text-center text-[10px] text-fg-faint">
          No renderable page was detected. Create one or open the Code workspace.
        </div>
      )}
      <p className="mt-3 px-1 text-[9px] leading-4 text-fg-faint">
        Selecting a page changes the canvas entry. New pages are written into the real project folder.
      </p>
    </div>
  );
}

function pageLabel(path: string) {
  if (/(^|\/)page\.(jsx?|tsx?)$/i.test(path)) {
    const parts = path.split("/");
    const parent = parts.at(-2);
    return parent === "app" ? "Home" : title(parent ?? "Page");
  }
  const name = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path;
  return name.toLowerCase() === "index" ? "Home" : title(name);
}

function pageRoute(path: string) {
  if (/\.html?$/i.test(path)) return path.endsWith("index.html") ? "/" : `/${path.replace(/\.html?$/i, "")}`;
  const match = path.match(/(?:^|\/)app\/(.*)\/page\.(?:jsx?|tsx?)$/i);
  if (match) return match[1] ? `/${match[1]}` : "/";
  return "/";
}

function title(value: string) {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
