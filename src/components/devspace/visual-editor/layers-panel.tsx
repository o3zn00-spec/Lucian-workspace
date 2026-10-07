"use client";

import { ChevronDown, ChevronRight, GripVertical, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { VisualNode } from "@/lib/workspace/visual-editor";
import { cn } from "@/lib/utils";

interface LayersPanelProps {
  root: VisualNode | null;
  entryFile: string;
  selectedId: string | null;
  onSelect: (id: string | null, sourceFile?: string | null, sourceId?: string | null) => void;
  onReorder: (sourceId: string, targetSourceId: string, position: "before" | "after", sourceFile?: string) => void;
}

export function LayersPanel({ root, entryFile, selectedId, onSelect, onReorder }: LayersPanelProps) {
  const [query, setQuery] = useState("");
  const visibleRoots = useMemo(() => {
    if (!root) return [];
    if (!query.trim()) return root.children;
    return filterTree(root.children, query.trim().toLowerCase());
  }, [root, query]);

  if (!root) {
    return <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">Rendering layers from the current page…</div>;
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative shrink-0 p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-faint" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search layers" className="h-7 w-full rounded-md border border-line bg-input/30 pl-7 pr-2 text-[11px] outline-none focus:border-accent" />
      </div>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1 pb-2 text-xs">
        {visibleRoots.map((child) => (
          <LayerNode key={child.id} node={child} entryFile={entryFile} depth={0} selectedId={selectedId} onSelect={onSelect} onReorder={onReorder} forceExpanded={!!query.trim()} />
        ))}
      </ul>
    </div>
  );
}

function LayerNode({ node, entryFile, depth, selectedId, onSelect, onReorder, forceExpanded }: {
  node: VisualNode;
  entryFile: string;
  depth: number;
  selectedId: string | null;
  onSelect: (id: string | null, sourceFile?: string | null, sourceId?: string | null) => void;
  onReorder: (sourceId: string, targetSourceId: string, position: "before" | "after", sourceFile?: string) => void;
  forceExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  const isSelected = selectedId === node.id;
  const sourceFile = node.attributes["data-lucian-source-file"] || entryFile;
  const sourceId = node.attributes["data-lucian-source-id"] || node.id;

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-lucian-layer", JSON.stringify({ sourceId, sourceFile }));
        }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          try {
            const dragged = JSON.parse(event.dataTransfer.getData("application/x-lucian-layer")) as { sourceId: string; sourceFile?: string };
            if (!dragged.sourceId || dragged.sourceId === sourceId || dragged.sourceFile !== sourceFile) return;
            const rect = event.currentTarget.getBoundingClientRect();
            onReorder(dragged.sourceId, sourceId, event.clientY < rect.top + rect.height / 2 ? "before" : "after", sourceFile);
          } catch {
            // Ignore drops that did not originate from this layer tree.
          }
        }}
        onClick={() => onSelect(isSelected ? null : node.id, isSelected ? null : sourceFile, isSelected ? null : sourceId)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(isSelected ? null : node.id, isSelected ? null : sourceFile, isSelected ? null : sourceId);
          }
        }}
        style={{ paddingLeft: 4 + depth * 12 }}
        className={cn("group flex cursor-pointer items-center gap-1 rounded-sm py-1 pr-2 transition-colors", isSelected ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-hover hover:text-fg")}
      >
        <GripVertical className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-50" />
        {hasChildren ? (
          <button type="button" aria-label={`${expanded || forceExpanded ? "Collapse" : "Expand"} ${node.tag} layer`} aria-expanded={expanded || forceExpanded} onClick={(event) => { event.stopPropagation(); setExpanded((value) => !value); }} className="flex h-3 w-3 shrink-0 items-center justify-center opacity-70">
            {(expanded || forceExpanded) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        ) : <span className="w-3 shrink-0" />}
        <span className="shrink-0 font-mono text-[10px] opacity-65">{node.tag}</span>
        <span className="truncate text-[11px]">{layerLabel(node)}</span>
      </div>
      {hasChildren && (expanded || forceExpanded) ? (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <LayerNode key={child.id} node={child} entryFile={entryFile} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} onReorder={onReorder} forceExpanded={forceExpanded} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function layerLabel(node: VisualNode) {
  const named = node.attributes.id || node.attributes["aria-label"] || node.attributes.alt;
  if (named) return named;
  if (node.text) return node.text;
  const className = node.className.split(/\s+/).filter(Boolean)[0];
  return className ? `.${className}` : "Layer";
}

function filterTree(nodes: VisualNode[], query: string): VisualNode[] {
  const output: VisualNode[] = [];
  for (const node of nodes) {
    const children = filterTree(node.children, query);
    const haystack = `${node.tag} ${node.text} ${node.className} ${Object.values(node.attributes).join(" ")}`.toLowerCase();
    if (haystack.includes(query) || children.length) output.push({ ...node, children });
  }
  return output;
}
