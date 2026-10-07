"use client";

// Style Inspector for the Visual Editor — Phase 12 upgraded.
//
// Shows properties of the currently selected element. Edits write back
// to the REAL source file via the appropriate mutator:
//
//   - JSX/TSX files → jsx-ast.ts (AST mutation + validate)
//   - HTML files     → visual-editor.ts (DOMParser mutation)
//   - Tailwind       → tailwind-mutator.ts (utility mutation on static className)
//
// Property editors:
//   - Text content (static JSX text; falls back to Direct Edit for expressions)
//   - Spacing (padding / margin / gap)
//   - Typography (font size / weight / alignment / line height)
//   - Colors (text / background / border)
//   - Appearance (border width / radius / opacity)
//   - Image (src / alt / width / height / object-fit)
//   - Tailwind utilities (static className mutation with responsive prefixes)
//   - Responsive breakpoint selection
//   - Insert / Duplicate / Delete / Move Up / Move Down
//   - Direct Edit (opens Monaco at the source location)

import { useEffect, useState } from "react";
import { ChevronUp, ChevronDown, Columns3, Copy, Grid3X3, Trash2, Plus, Code2, Rows3, Wand2 } from "lucide-react";
import { Input } from "@/components/ui-devspace/input";
import { Label } from "@/components/ui-devspace/label";
import { Button } from "@/components/ui-devspace/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui-devspace/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-devspace/dialog";
import { useWorkspaceStore } from "@/store/workspace";
import { useSettingsStore } from "@/store/settings";
import {
  insertHtmlChild,
  mutateHtmlStructure,
  patchFileContent,
  type VisualElementSpec,
  type VisualMutationRecord,
  type VisualNode,
} from "@/lib/workspace/visual-editor";
import {
  setClassName,
  setJsxText,
  setInlineStyle,
  setJsxAttribute,
  deleteJsxElement,
  duplicateJsxElement,
  moveJsxElement,
  insertJsxChild,
  type MutationResult,
} from "@/lib/workspace/jsx-ast";
import {
  setTailwindUtility,
  getTailwindUtility,
  type TwCategory,
  type Breakpoint,
} from "@/lib/workspace/tailwind-mutator";
import { resolveSourceMapping, type SourceMapping } from "@/lib/workspace/source-map";
import { toast } from "@/hooks/use-toast";

interface StyleInspectorProps {
  /** Currently selected node from the iframe (or null). */
  node: VisualNode | null;
  /** Path of the file the canvas is currently rendering. */
  entryFile: string;
  /** Called after a successful source patch — the caller refreshes the canvas. */
  onPatched: () => void;
  /** Source mapping from the preview instrumentation (Phase 12). */
  sourceFile: string | null;
  sourceId: string | null;
  /** Called when the user requests a Direct Edit. */
  onDirectEdit: (sourceFile: string, sourceId: string) => void;
  onRecordMutation: (record: VisualMutationRecord) => void;
}

const BREAKPOINTS: { id: Breakpoint; label: string }[] = [
  { id: "base", label: "Base" },
  { id: "sm", label: "sm" },
  { id: "md", label: "md" },
  { id: "lg", label: "lg" },
  { id: "xl", label: "xl" },
  { id: "2xl", label: "2xl" },
];

export function StyleInspector({
  node,
  entryFile,
  onPatched,
  sourceFile,
  sourceId,
  onDirectEdit,
  onRecordMutation,
}: StyleInspectorProps) {
  const activeProject = useWorkspaceStore((s) => s.activeProject);
  const loadFileContent = useWorkspaceStore((s) => s.loadFileContent);
  const writeFile = useWorkspaceStore((s) => s.writeFile);
  const refreshPreview = useWorkspaceStore((s) => s.refreshPreview);
  // Settings → DevWorkspace → Visual Editor → showSourceMapping.
  // Controls visibility of the source file + strategy info line.
  const showSourceMapping = useSettingsStore((s) => s.devWorkspace.visualEditor.showSourceMapping);
  const [saving, setSaving] = useState(false);
  const [insertOpen, setInsertOpen] = useState(false);
  const [breakpoint, setBreakpoint] = useState<Breakpoint>("base");

  // Publish the current breakpoint to a window slot so the VisualCanvas's
  // resize handler can pick it up when committing a Tailwind resize.
  // (One setState-in-effect for the window mirror — this is the React-
  // recommended place for syncing to external systems, and we explicitly
  // need to update on breakpoint change.)
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as unknown as { __lucianResizeBreakpoint?: string }).__lucianResizeBreakpoint = breakpoint;
  }, [breakpoint]);

  // Resolve the source mapping (JSX AST / HTML DOM / CSS rule / Direct Edit).
  // Phase 12: we key off `${sourceFile}:${sourceId}` so the mapping is
  // re-resolved only when the selection actually changes — no need to
  // reset mapping to null in an effect (which would add a lint error).
  const mappingKey = `${sourceFile ?? ""}:${sourceId ?? ""}`;
  const [mapping, setMapping] = useState<SourceMapping | null>(null);
  const [lastMappingKey, setLastMappingKey] = useState<string | null>(null);
  if (mappingKey !== lastMappingKey) {
    setLastMappingKey(mappingKey);
    // Don't setMapping(null) here — that would cause a flash. Instead,
    // the effect below will resolve the new mapping and replace it.
    // We only clear if the new key is empty (no selection).
    if (!sourceFile || !sourceId) {
      if (mapping !== null) setMapping(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (!activeProject || !sourceFile || !sourceId) return;
    void resolveSourceMapping(
      activeProject,
      sourceFile,
      sourceId,
      node,
      async (path) => loadFileContent(activeProject.id, path),
    ).then((m) => {
      if (cancelled) return;
      setMapping(m);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProject, sourceFile, sourceId, node, loadFileContent]);

  // Local editable drafts.
  // Phase 12: we use uncontrolled inputs with `key={node?.id}` (or the
  // source id) so they remount when the selection changes, picking up the
  // new default value without needing a setState-in-effect sync.
  const [textDraft, setTextDraft] = useState("");
  const [srcDraft, setSrcDraft] = useState("");
  const [altDraft, setAltDraft] = useState("");
  // Track the last node id we synced from so we re-initialize on selection
  // change without an effect. This is the React-recommended pattern for
  // "derived state that resets when a prop changes".
  const [lastSyncedNodeId, setLastSyncedNodeId] = useState<string | null>(null);
  if (node && node.id !== lastSyncedNodeId) {
    setLastSyncedNodeId(node.id);
    setTextDraft(node.text ?? "");
    setSrcDraft(node.attributes?.src ?? "");
    setAltDraft(node.attributes?.alt ?? "");
  }

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
        Select an element on the canvas or in the Layers panel to inspect its properties.
      </div>
    );
  }

  // ── Write helpers ──
  const applyMutation = async (
    mutator: (source: string) => MutationResult,
    successMsg: string,
    errMsg: string,
    snapshotLabel?: string,
  ) => {
    if (!mapping) {
      toast({ title: "Source not resolved", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      // Phase 12: before a significant edit, create a recoverable project
      // version snapshot so the user can roll back. We use the same IndexedDB
      // versions store as the manual History dialog + the Project Agent.
      if (snapshotLabel && activeProject) {
        try {
          const { saveVersion } = await import("@/lib/workspace/db");
          const { newId } = await import("@/lib/workspace/project");
          const files = await useWorkspaceStore.getState().getActiveProjectFiles();
          await saveVersion({
            id: newId("ver"),
            projectId: activeProject.id,
            label: snapshotLabel.slice(0, 80),
            createdAt: Date.now(),
            files,
            previewMode: useWorkspaceStore.getState().previewMode,
          });
        } catch {
          // Non-fatal — snapshot failure should not block the edit.
        }
      }
      const source = mapping.sourceContent;
      const result = mutator(source);
      if (result.status === "ok") {
        await writeFile(mapping.filePath, result.source);
        onRecordMutation({ filePath: mapping.filePath, before: source, after: result.source, label: successMsg || "Visual edit" });
        refreshPreview();
        onPatched();
        if (successMsg) toast({ title: successMsg });
      } else if (result.status === "dynamic") {
        toast({
          title: "Cannot edit visually",
          description: "This property uses a dynamic expression. Use Direct Edit.",
          variant: "destructive",
        });
        onDirectEdit(mapping.filePath, sourceId ?? "");
      } else if (result.status === "parse-error") {
        toast({
          title: "Source parse failed",
          description: result.error ?? "The generated source was invalid. Rolled back.",
          variant: "destructive",
        });
      } else if (result.status === "not-found") {
        toast({
          title: "Element not found",
          description: "The source may have changed since selection. Refresh and try again.",
          variant: "destructive",
        });
      } else {
        toast({ title: errMsg, description: result.error, variant: "destructive" });
      }
    } catch (err) {
      toast({
        title: errMsg,
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // ── Text content ──
  const handleApplyText = () => {
    if (!mapping) return;
    if (mapping.strategy === "jsx-ast" || mapping.strategy === "tailwind-static") {
      void applyMutation(
        (src) => setJsxText(src, sourceId!, mapping.filePath, textDraft),
        "Text updated",
        "Couldn't update text",
      );
    } else if (mapping.strategy === "html-dom") {
      void applyHtmlPatch(
        { kind: "text", value: textDraft },
        "Text updated",
        "Couldn't update text",
      );
    } else {
      onDirectEdit(mapping.filePath, sourceId ?? "");
    }
  };

  // ── Inline style ──
  const handleApplyStyle = (property: string, value: string) => {
    if (!mapping) return;
    if (mapping.strategy === "jsx-ast" || mapping.strategy === "tailwind-static") {
      void applyMutation(
        (src) => setInlineStyle(src, sourceId!, mapping.filePath, property, value),
        "Style updated",
        "Couldn't update style",
      );
    } else if (mapping.strategy === "html-dom") {
      void applyHtmlPatch(
        { kind: "style", property, value },
        "Style updated",
        "Couldn't update style",
      );
    } else {
      onDirectEdit(mapping.filePath, sourceId ?? "");
    }
  };

  // ── Attribute ──
  const handleApplyAttribute = (attrName: string, value: string) => {
    if (!mapping) return;
    if (mapping.strategy === "jsx-ast" || mapping.strategy === "tailwind-static") {
      void applyMutation(
        (src) => setJsxAttribute(src, sourceId!, mapping.filePath, attrName, value),
        "Attribute updated",
        "Couldn't update attribute",
      );
    } else if (mapping.strategy === "html-dom") {
      void applyHtmlPatch(
        { kind: "attribute", property: attrName, value },
        "Attribute updated",
        "Couldn't update attribute",
      );
    } else {
      onDirectEdit(mapping.filePath, sourceId ?? "");
    }
  };

  // ── Tailwind utility ──
  const handleApplyTailwind = (category: TwCategory, body: string) => {
    if (!mapping || !mapping.jsxElement) return;
    if (mapping.jsxElement.classNameIsDynamic) {
      toast({
        title: "Dynamic className",
        description: "className uses an expression (cn/clsx/template). Use Direct Edit.",
        variant: "destructive",
      });
      onDirectEdit(mapping.filePath, sourceId ?? "");
      return;
    }
    const currentClassName = mapping.jsxElement.className ?? "";
    const newClassName = setTailwindUtility(currentClassName, body, category, breakpoint);
    void applyMutation(
      (src) => setClassName(src, sourceId!, mapping.filePath, newClassName),
      "Tailwind updated",
      "Couldn't update Tailwind",
    );
  };

  // ── HTML patch helper (for HTML files) ──
  const applyHtmlPatch = async (
    patch: { kind: "text" | "style" | "attribute"; property?: string; value: string },
    successMsg: string,
    errMsg: string,
  ) => {
    if (!mapping) return;
    setSaving(true);
    try {
      const patched = patchFileContent(mapping.filePath, mapping.sourceContent, node.id, patch);
      await writeFile(mapping.filePath, patched);
      onRecordMutation({ filePath: mapping.filePath, before: mapping.sourceContent, after: patched, label: successMsg || "Visual edit" });
      refreshPreview();
      onPatched();
      if (successMsg) toast({ title: successMsg });
    } catch (err) {
      toast({
        title: errMsg,
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  // ── Structural actions ──
  const handleDelete = () => {
    if (!mapping) return;
    if (mapping.strategy === "jsx-ast" || mapping.strategy === "tailwind-static") {
      void applyMutation(
        (src) => deleteJsxElement(src, sourceId!, mapping.filePath),
        "Element deleted",
        "Couldn't delete element",
        `Visual Edit — Deleted ${mapping.jsxElement?.name ?? "element"}`,
      );
    } else if (mapping.strategy === "html-dom") {
      void applyHtmlStructure("delete", "Element deleted");
    } else {
      onDirectEdit(mapping.filePath, sourceId ?? "");
    }
  };

  const handleDuplicate = () => {
    if (!mapping) return;
    if (mapping.strategy === "jsx-ast" || mapping.strategy === "tailwind-static") {
      void applyMutation(
        (src) => duplicateJsxElement(src, sourceId!, mapping.filePath),
        "Element duplicated",
        "Couldn't duplicate element",
        `Visual Edit — Duplicated ${mapping.jsxElement?.name ?? "element"}`,
      );
    } else if (mapping.strategy === "html-dom") {
      void applyHtmlStructure("duplicate", "Element duplicated");
    } else {
      onDirectEdit(mapping.filePath, sourceId ?? "");
    }
  };

  const handleMove = (direction: "up" | "down") => {
    if (!mapping) return;
    if (mapping.strategy === "jsx-ast" || mapping.strategy === "tailwind-static") {
      void applyMutation(
        (src) => moveJsxElement(src, sourceId!, mapping.filePath, direction),
        `Moved ${direction}`,
        `Couldn't move ${direction}`,
        `Visual Edit — Moved ${direction}`,
      );
    } else if (mapping.strategy === "html-dom") {
      void applyHtmlStructure(direction, `Moved ${direction}`);
    } else {
      onDirectEdit(mapping.filePath, sourceId ?? "");
    }
  };

  const handleInsert = (spec: VisualElementSpec) => {
    if (!mapping) return;
    if (mapping.strategy === "jsx-ast" || mapping.strategy === "tailwind-static") {
      void applyMutation(
        (src) => insertJsxChild(src, sourceId!, mapping.filePath, spec),
        `Inserted ${spec.tagName}`,
        "Couldn't insert element",
        `Visual Edit — Inserted ${spec.tagName}`,
      );
    } else if (mapping.strategy === "html-dom") {
      const before = mapping.sourceContent;
      void (async () => {
        setSaving(true);
        try {
          await useWorkspaceStore.getState().createSnapshot(`Visual Edit — Inserted ${spec.tagName}`);
          const after = insertHtmlChild(before, node.id, spec);
          await writeFile(mapping.filePath, after);
          onRecordMutation({ filePath: mapping.filePath, before, after, label: `Inserted ${spec.tagName}` });
          refreshPreview();
          onPatched();
          toast({ title: `Inserted ${spec.tagName}` });
        } catch (error) {
          toast({ title: "Couldn't insert element", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
        } finally {
          setSaving(false);
        }
      })();
    } else {
      onDirectEdit(mapping.filePath, sourceId ?? "");
    }
    setInsertOpen(false);
  };

  const applyHtmlStructure = async (operation: "delete" | "duplicate" | "up" | "down", label: string) => {
    if (!mapping) return;
    setSaving(true);
    try {
      await useWorkspaceStore.getState().createSnapshot(`Visual Edit — ${label}`);
      const before = mapping.sourceContent;
      const after = mutateHtmlStructure(before, node.id, operation);
      await writeFile(mapping.filePath, after);
      onRecordMutation({ filePath: mapping.filePath, before, after, label });
      refreshPreview();
      onPatched();
      toast({ title: label });
    } catch (error) {
      toast({ title: `Couldn't ${operation} element`, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleApplyStyles = (styles: Record<string, string>, label: string) => {
    if (!mapping) return;
    if (mapping.strategy === "jsx-ast" || mapping.strategy === "tailwind-static") {
      void applyMutation((initial) => {
        let result: MutationResult = { source: initial, status: "ok" };
        for (const [property, value] of Object.entries(styles)) {
          result = setInlineStyle(result.source, sourceId!, mapping.filePath, property, value);
          if (result.status !== "ok") return result;
        }
        return result;
      }, label, `Couldn't apply ${label.toLowerCase()}`, `Visual Edit — ${label}`);
      return;
    }
    if (mapping.strategy === "html-dom") {
      setSaving(true);
      void (async () => {
        try {
          await useWorkspaceStore.getState().createSnapshot(`Visual Edit — ${label}`);
          let after = mapping.sourceContent;
          for (const [property, value] of Object.entries(styles)) {
            after = patchFileContent(mapping.filePath, after, node.id, { kind: "style", property, value });
          }
          await writeFile(mapping.filePath, after);
          onRecordMutation({ filePath: mapping.filePath, before: mapping.sourceContent, after, label });
          refreshPreview();
          onPatched();
          toast({ title: label });
        } catch (error) {
          toast({ title: `Couldn't apply ${label.toLowerCase()}`, description: error instanceof Error ? error.message : String(error), variant: "destructive" });
        } finally {
          setSaving(false);
        }
      })();
      return;
    }
    onDirectEdit(mapping.filePath, sourceId ?? "");
  };

  // ── Render ──

  const isImage = node.tag === "img" || (mapping?.jsxElement?.name === "Image");
  const currentClassName = mapping?.jsxElement?.className ?? "";
  const isDynamicClassName = mapping?.jsxElement?.classNameIsDynamic ?? false;
  const hasDynamicChildren = mapping?.jsxElement?.hasDynamicChildren ?? false;

  return (
    <div className="space-y-3 p-3 text-xs">
      {/* Element header */}
      <div className="rounded-md border border-border/50 bg-muted/40 px-2 py-1.5">
        <div className="flex items-center justify-between">
          <code className="font-mono text-[11px]">{node.tag}</code>
          <code className="text-[10px] text-muted-foreground">#{node.id}</code>
        </div>
        {node.className ? (
          <p className="mt-1 truncate text-[10px] text-muted-foreground">
            .{node.className.split(" ").slice(0, 3).join(" .")}
          </p>
        ) : null}
          {showSourceMapping && mapping ? (
            <p className="mt-1 truncate text-[9px] text-fg-faint" title={mapping.strategyReason}>
              {mapping.filePath} · {mapping.strategy}
            </p>
          ) : null}
      </div>

      {/* Structural actions */}
      <div className="grid grid-cols-4 gap-1">
        <Button variant="ghost" size="sm" className="h-7 p-0" disabled={saving || !mapping} onClick={() => handleMove("up")} title="Move up">
          <ChevronUp className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 p-0" disabled={saving || !mapping} onClick={() => handleMove("down")} title="Move down">
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 p-0" disabled={saving || !mapping} onClick={handleDuplicate} title="Duplicate">
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="sm" className="h-7 p-0 text-red-500 hover:text-red-600" disabled={saving || !mapping} onClick={handleDelete} title="Delete">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <Button variant="outline" size="sm" className="h-7 w-full" disabled={saving || !mapping} onClick={() => setInsertOpen(true)}>
        <Plus className="mr-1 h-3 w-3" /> Insert child
      </Button>
      <Button variant="outline" size="sm" className="h-7 w-full" disabled={saving || !mapping} onClick={() => mapping && onDirectEdit(mapping.filePath, sourceId ?? "")}>
        <Code2 className="mr-1 h-3 w-3" /> Direct Edit
      </Button>

      {/* Responsive breakpoint selector */}
      <section>
        <Label className="mb-1 text-[11px]">Breakpoint</Label>
        <Select value={breakpoint} onValueChange={(v) => setBreakpoint(v as Breakpoint)}>
          <SelectTrigger className="h-7 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BREAKPOINTS.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.label}
                {b.id !== "base" ? " (responsive)" : " (all breakpoints)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-[9px] text-fg-faint">
          {breakpoint === "base"
            ? "Tailwind edits apply to the base layout."
            : `Tailwind edits apply at ${breakpoint} and wider. Inline styles remain global.`}
        </p>
      </section>

      {/* Framer-style layout presets */}
      <section>
        <Label className="mb-1 text-[11px]">Layout</Label>
        <div className="grid grid-cols-3 gap-1">
          <Button variant="outline" size="sm" className="h-8 px-1 text-[10px]" disabled={saving || !mapping} onClick={() => handleApplyStyles({ display: "flex", flexDirection: "column", gap: "16px" }, "Vertical stack")} title="Stack children vertically">
            <Rows3 className="mr-1 h-3 w-3" /> Stack
          </Button>
          <Button variant="outline" size="sm" className="h-8 px-1 text-[10px]" disabled={saving || !mapping} onClick={() => handleApplyStyles({ display: "flex", flexDirection: "row", gap: "16px", alignItems: "center" }, "Horizontal stack")} title="Stack children horizontally">
            <Columns3 className="mr-1 h-3 w-3" /> Row
          </Button>
          <Button variant="outline" size="sm" className="h-8 px-1 text-[10px]" disabled={saving || !mapping} onClick={() => handleApplyStyles({ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "16px" }, "Responsive grid")} title="Create a three-column grid">
            <Grid3X3 className="mr-1 h-3 w-3" /> Grid
          </Button>
        </div>
        <div className="mt-1 grid grid-cols-3 gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-1 text-[9px]" disabled={saving || !mapping} onClick={() => handleApplyStyles({ width: "100%" }, "Width set to Fill")}>Fill</Button>
          <Button variant="ghost" size="sm" className="h-7 px-1 text-[9px]" disabled={saving || !mapping} onClick={() => handleApplyStyles({ width: "max-content" }, "Width set to Fit")}>Fit</Button>
          <Button variant="ghost" size="sm" className="h-7 px-1 text-[9px]" disabled={saving || !mapping} onClick={() => handleApplyStyles({ width: "auto", height: "auto" }, "Size reset to Auto")}>Auto</Button>
        </div>
        <div className="mt-1 space-y-1">
          {["display", "position", "flex-direction", "grid-template-columns", "justify-content", "align-items", "gap", "padding", "margin", "width", "height", "min-width", "max-width", "min-height", "max-height"].map((prop) => (
            <StyleRow key={prop} prop={prop} value={node.style?.[prop] ?? ""} onApply={handleApplyStyle} disabled={saving || !mapping} />
          ))}
        </div>
      </section>

      {/* Text content */}
      <section>
        <Label className="mb-1 text-[11px]">Text content</Label>
        <textarea
          value={textDraft}
          onChange={(e) => setTextDraft(e.target.value)}
          className="w-full rounded-md border bg-input/30 px-2 py-1.5 text-xs"
          rows={2}
          disabled={saving || !mapping}
        />
        {hasDynamicChildren ? (
          <p className="mt-1 text-[9px] text-amber-600 dark:text-amber-400">
            This element has dynamic children (expressions). Text edits fall back to Direct Edit.
          </p>
        ) : null}
        <Button
          size="sm"
          className="mt-1 h-6 w-full"
          disabled={saving || !mapping || textDraft === node.text}
          onClick={handleApplyText}
        >
          Apply text
        </Button>
      </section>

      {/* Tailwind utilities (only for JSX elements with static className) */}
      {mapping?.jsxElement && !isDynamicClassName ? (
        <section>
          <Label className="mb-1 text-[11px]">Tailwind utilities</Label>
          <div className="space-y-1">
            <TailwindRow
              label="Padding"
              category="padding"
              currentClassName={currentClassName}
              breakpoint={breakpoint}
              onApply={handleApplyTailwind}
              disabled={saving}
            />
            <TailwindRow
              label="Margin"
              category="margin"
              currentClassName={currentClassName}
              breakpoint={breakpoint}
              onApply={handleApplyTailwind}
              disabled={saving}
            />
            <TailwindRow
              label="Font size"
              category="fontSize"
              currentClassName={currentClassName}
              breakpoint={breakpoint}
              onApply={handleApplyTailwind}
              disabled={saving}
            />
            <TailwindRow
              label="Font weight"
              category="fontWeight"
              currentClassName={currentClassName}
              breakpoint={breakpoint}
              onApply={handleApplyTailwind}
              disabled={saving}
            />
            <TailwindRow
              label="Radius"
              category="borderRadius"
              currentClassName={currentClassName}
              breakpoint={breakpoint}
              onApply={handleApplyTailwind}
              disabled={saving}
            />
          </div>
          <details className="mt-1">
            <summary className="cursor-pointer text-[9px] text-fg-faint">Current classes</summary>
            <p className="mt-1 break-all font-mono text-[9px] text-fg-muted">{currentClassName || "(none)"}</p>
          </details>
        </section>
      ) : mapping?.jsxElement && isDynamicClassName ? (
        <section>
          <Label className="mb-1 text-[11px]">Tailwind utilities</Label>
          <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-600 dark:text-amber-400">
            className is dynamic (cn/clsx/template). Tailwind mutations fall back to Direct Edit.
          </p>
        </section>
      ) : null}

      {/* Typography */}
      <section>
        <Label className="mb-1 text-[11px]">Typography</Label>
        <div className="space-y-1">
          {["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align"].map((prop) => (
            <StyleRow
              key={prop}
              prop={prop}
              value={node.style?.[prop] ?? ""}
              onApply={handleApplyStyle}
              disabled={saving || !mapping}
            />
          ))}
        </div>
      </section>

      {/* Fill, stroke and effects */}
      <section>
        <Label className="mb-1 text-[11px]">Fill &amp; Stroke</Label>
        <div className="space-y-1">
          <ColorRow label="Text" prop="color" value={node.style?.color ?? ""} onApply={handleApplyStyle} disabled={saving || !mapping} />
          <ColorRow label="Fill" prop="background-color" value={node.style?.["background-color"] ?? ""} onApply={handleApplyStyle} disabled={saving || !mapping} />
          <ColorRow label="Border" prop="border-color" value={node.style?.["border-color"] ?? ""} onApply={handleApplyStyle} disabled={saving || !mapping} />
          {['border', 'border-radius', 'opacity', 'box-shadow', 'overflow'].map((prop) => (
            <StyleRow key={prop} prop={prop} value={node.style?.[prop] ?? ""} onApply={handleApplyStyle} disabled={saving || !mapping} />
          ))}
        </div>
      </section>

      {/* Image attributes */}
      {isImage ? (
        <section>
          <Label className="mb-1 text-[11px]">Image attributes</Label>
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">src</span>
              <Input
                value={srcDraft}
                onChange={(e) => setSrcDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleApplyAttribute("src", srcDraft); }}
                className="h-6 flex-1 text-[11px]"
                disabled={saving || !mapping}
              />
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={saving || !mapping} onClick={() => handleApplyAttribute("src", srcDraft)} title="Apply">✓</Button>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">alt</span>
              <Input
                value={altDraft}
                onChange={(e) => setAltDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleApplyAttribute("alt", altDraft); }}
                className="h-6 flex-1 text-[11px]"
                disabled={saving || !mapping}
              />
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={saving || !mapping} onClick={() => handleApplyAttribute("alt", altDraft)} title="Apply">✓</Button>
            </div>
            <StyleRow prop="width" value={node.style?.width ?? ""} onApply={handleApplyStyle} disabled={saving || !mapping} />
            <StyleRow prop="height" value={node.style?.height ?? ""} onApply={handleApplyStyle} disabled={saving || !mapping} />
            <StyleRow prop="object-fit" value={node.style?.["object-fit"] ?? ""} onApply={handleApplyStyle} disabled={saving || !mapping} />
          </div>
        </section>
      ) : null}

      {/* Other attributes */}
      {Object.keys(node.attributes).length > 0 ? (
        <section>
          <Label className="mb-1 text-[11px]">Attributes</Label>
          <div className="space-y-1">
            {Object.entries(node.attributes)
              .filter(([name]) => name !== "src" && name !== "alt")
              .slice(0, 6)
              .map(([name, value]) => (
                <div key={name} className="flex items-center gap-1">
                  <span className="w-28 shrink-0 truncate font-mono text-[10px] text-muted-foreground">{name}</span>
                  <AttributeInput
                    name={name}
                    value={value}
                    onApply={handleApplyAttribute}
                    disabled={saving || !mapping}
                  />
                </div>
              ))}
          </div>
        </section>
      ) : null}

      {mapping?.parseError ? (
        <p className="rounded-md bg-red-500/10 px-2 py-1.5 text-[10px] text-red-600 dark:text-red-400">
          {mapping.parseError}
        </p>
      ) : null}

      <p className="rounded-md bg-muted/40 px-2 py-1.5 text-[10px] text-muted-foreground">
        Edits write back to <code className="font-mono">{mapping?.filePath ?? entryFile}</code> in the real project source. The canvas refreshes to reflect the change.
      </p>

      {/* Insert dialog */}
      <InsertDialog open={insertOpen} onOpenChange={setInsertOpen} onInsert={handleInsert} />
    </div>
  );
}

function StyleRow({
  prop,
  value,
  onApply,
  disabled,
}: {
  prop: string;
  value: string;
  onApply: (prop: string, value: string) => void;
  disabled: boolean;
}) {
  // Phase 12: derived-state-with-reset pattern (no setState-in-effect).
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }
  return (
    <div className="flex items-center gap-1">
      <span className="w-28 shrink-0 font-mono text-[10px] text-muted-foreground">{prop}</span>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onApply(prop, draft); }}
        className="h-6 flex-1 text-[11px]"
        disabled={disabled}
      />
      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={disabled} onClick={() => onApply(prop, draft)} title="Apply">✓</Button>
    </div>
  );
}

function AttributeInput({
  name,
  value,
  onApply,
  disabled,
}: {
  name: string;
  value: string;
  onApply: (name: string, value: string) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }
  return (
    <>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onApply(name, draft); }}
        className="h-6 flex-1 text-[11px]"
        disabled={disabled}
      />
      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={disabled} onClick={() => onApply(name, draft)} title="Apply">✓</Button>
    </>
  );
}

function ColorRow({
  label,
  prop,
  value,
  onApply,
  disabled,
}: {
  label: string;
  prop: string;
  value: string;
  onApply: (prop: string, value: string) => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }
  return (
    <div className="flex items-center gap-1">
      <span className="w-16 shrink-0 text-[10px] text-muted-foreground">{label}</span>
      <input
        type="color"
        value={colorInputValue(draft)}
        onChange={(event) => { setDraft(event.target.value); onApply(prop, event.target.value); }}
        disabled={disabled}
        className="h-6 w-7 cursor-pointer rounded border border-line bg-transparent p-0.5 disabled:cursor-not-allowed"
        aria-label={`${label} color`}
      />
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") onApply(prop, draft); }}
        className="h-6 min-w-0 flex-1 font-mono text-[10px]"
        disabled={disabled}
      />
      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={disabled} onClick={() => onApply(prop, draft)} title="Apply">✓</Button>
    </div>
  );
}

function colorInputValue(value: string) {
  if (/^#[0-9a-f]{6}$/i.test(value.trim())) return value.trim();
  const rgb = value.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
  if (!rgb) return "#000000";
  return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0")).join("")}`;
}

function TailwindRow({
  label,
  category,
  currentClassName,
  breakpoint,
  onApply,
  disabled,
}: {
  label: string;
  category: TwCategory;
  currentClassName: string;
  breakpoint: Breakpoint;
  onApply: (category: TwCategory, body: string) => void;
  disabled: boolean;
}) {
  const current = getTailwindUtility(currentClassName, category, breakpoint);
  const [draft, setDraft] = useState(current ?? "");
  const [lastCurrent, setLastCurrent] = useState<string | null>(current ?? null);
  const [lastBreakpoint, setLastBreakpoint] = useState<Breakpoint>(breakpoint);
  if ((current ?? null) !== lastCurrent || breakpoint !== lastBreakpoint) {
    setLastCurrent(current ?? null);
    setLastBreakpoint(breakpoint);
    setDraft(current ?? "");
  }
  return (
    <div className="flex items-center gap-1">
      <span className="w-20 shrink-0 text-[10px] text-muted-foreground">{label}</span>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") onApply(category, draft); }}
        placeholder={current ?? "(none)"}
        className="h-6 flex-1 text-[11px]"
        disabled={disabled}
      />
      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" disabled={disabled} onClick={() => onApply(category, draft)} title="Apply">✓</Button>
    </div>
  );
}

const INSERT_OPTIONS: Array<{
  tagName: string;
  label: string;
  attrs?: Array<{ name: string; value: string }>;
  text?: string;
  selfClosing?: boolean;
}> = [
  { tagName: "div", label: "Container / div" },
  { tagName: "section", label: "Section" },
  { tagName: "h1", label: "Heading", text: "New Heading" },
  { tagName: "h2", label: "Subheading", text: "Subheading" },
  { tagName: "p", label: "Paragraph", text: "New paragraph text." },
  { tagName: "button", label: "Button", text: "Click me" },
  { tagName: "a", label: "Link", text: "Link", attrs: [{ name: "href", value: "#" }] },
  { tagName: "img", label: "Image", selfClosing: true, attrs: [{ name: "src", value: "" }, { name: "alt", value: "" }] },
  { tagName: "input", label: "Input", selfClosing: true, attrs: [{ name: "type", value: "text" }] },
];

function InsertDialog({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onInsert: (spec: { tagName: string; attrs?: Array<{ name: string; value: string }>; text?: string; selfClosing?: boolean }) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Wand2 className="h-4 w-4 text-accent" /> Insert element
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 p-2">
          {INSERT_OPTIONS.map((opt) => (
            <Button
              key={opt.label}
              variant="outline"
              size="sm"
              className="h-9 justify-start text-[11px]"
              onClick={() => onInsert(opt)}
            >
              <code className="font-mono text-[10px] text-accent">&lt;{opt.tagName}&gt;</code>
              <span className="ml-1 truncate">{opt.label}</span>
            </Button>
          ))}
        </div>
        <p className="px-3 pb-3 text-[10px] text-muted-foreground">
          Inserts as a child of the selected element. Source is written to the real file + hot reloaded.
        </p>
      </DialogContent>
    </Dialog>
  );
}
