"use client";

/* LUCIAN Settings — DevWorkspace section.
 *
 * Reads / writes the existing DevWorkspace preferences. Settings
 * becomes the canonical home for editor, project, preview, visual
 * editor, and GitHub prefs; DevWorkspace components that need them
 * read from useSettingsStore.
 *
 * GitHub status is displayed honestly: public import is supported;
 * private repo authentication is NOT yet implemented (the existing
 * app/api/dev-workspace/github-import/route.ts handles public only).
 */

import { useSettingsStore } from "@/store/settings";
import { SettingsGroup, SettingsRow, SettingsSectionHeader, StatusPill } from "@/components/settings/primitives";
import { Switch } from "@/components/ui-devspace/switch";
import { Input } from "@/components/ui-devspace/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui-devspace/select";

export function DevWorkspaceSection() {
  const editor = useSettingsStore((s) => s.devWorkspace.editor);
  const projects = useSettingsStore((s) => s.devWorkspace.projects);
  const preview = useSettingsStore((s) => s.devWorkspace.preview);
  const visualEditor = useSettingsStore((s) => s.devWorkspace.visualEditor);
  const setEditor = useSettingsStore((s) => s.setDevWorkspaceEditor);
  const setProjects = useSettingsStore((s) => s.setDevWorkspaceProjects);
  const setPreview = useSettingsStore((s) => s.setDevWorkspacePreview);
  const setVisualEditor = useSettingsStore((s) => s.setDevWorkspaceVisualEditor);

  return (
    <div>
      <SettingsSectionHeader
        title="DevWorkspace"
        subtitle="Editor, project history, preview, visual editor, and GitHub preferences."
      />

      <SettingsGroup title="Editor">
        <SettingsRow title="Font size" description="Code editor font size in pixels.">
          <Input
            type="number"
            min={8}
            max={32}
            value={editor.fontSize}
            onChange={(e) => setEditor({ fontSize: Math.max(8, Math.min(32, parseInt(e.target.value, 10) || 14)) })}
            className="w-24"
          />
        </SettingsRow>
        <SettingsRow title="Tab size" description="Indentation width in spaces.">
          <Input
            type="number"
            min={1}
            max={8}
            value={editor.tabSize}
            onChange={(e) => setEditor({ tabSize: Math.max(1, Math.min(8, parseInt(e.target.value, 10) || 2)) })}
            className="w-24"
          />
        </SettingsRow>
        <SettingsRow title="Word wrap" description="Wrap long lines in the editor.">
          <Switch checked={editor.wordWrap} onCheckedChange={(v) => setEditor({ wordWrap: v })} />
        </SettingsRow>
        <SettingsRow title="Minimap" description="Show the code minimap.">
          <Switch checked={editor.minimap} onCheckedChange={(v) => setEditor({ minimap: v })} />
        </SettingsRow>
        <SettingsRow title="Autosave" description="Automatically save file changes.">
          <Switch checked={editor.autosave} onCheckedChange={(v) => setEditor({ autosave: v })} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Projects">
        <SettingsRow title="Restore last project" description="Reopen the last project when DevWorkspace loads.">
          <Switch checked={projects.restoreLastProject} onCheckedChange={(v) => setProjects({ restoreLastProject: v })} />
        </SettingsRow>
        <SettingsRow title="Create history before significant edits" description="Snapshot the project before structural edits.">
          <Switch checked={projects.createHistoryBeforeEdits} onCheckedChange={(v) => setProjects({ createHistoryBeforeEdits: v })} />
        </SettingsRow>
        <SettingsRow title="Maximum local history" description="Number of history snapshots to keep per project.">
          <Input
            type="number"
            min={0}
            max={500}
            value={projects.maxLocalHistory}
            onChange={(e) => setProjects({ maxLocalHistory: Math.max(0, Math.min(500, parseInt(e.target.value, 10) || 50)) })}
            className="w-24"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Preview">
        <SettingsRow title="Default device" description="Default responsive preview device.">
          <Select
            value={preview.defaultDevice}
            onValueChange={(v) => setPreview({ defaultDevice: v as typeof preview.defaultDevice })}
          >
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="desktop">Desktop</SelectItem>
              <SelectItem value="tablet">Tablet</SelectItem>
              <SelectItem value="mobile">Mobile</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow title="Auto refresh" description="Refresh the preview automatically when files change.">
          <Switch checked={preview.autoRefresh} onCheckedChange={(v) => setPreview({ autoRefresh: v })} />
        </SettingsRow>
        <SettingsRow title="Start runtime automatically" description="Auto-start the WebContainer runtime when a project opens.">
          <Switch checked={preview.startRuntimeAutomatically} onCheckedChange={(v) => setPreview({ startRuntimeAutomatically: v })} />
        </SettingsRow>
        <SettingsRow title="Show runtime diagnostics" description="Show runtime status diagnostics in the preview pane.">
          <Switch checked={preview.showRuntimeDiagnostics} onCheckedChange={(v) => setPreview({ showRuntimeDiagnostics: v })} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Visual Editor">
        <SettingsRow title="Prefer Visual Edit when safe" description="Use the visual editor when the edit is safe.">
          <Switch
            checked={visualEditor.preferVisualEditWhenSafe}
            onCheckedChange={(v) => setVisualEditor({ preferVisualEditWhenSafe: v })}
          />
        </SettingsRow>
        <SettingsRow title="Fallback to Direct Edit" description="Fall back to direct source edit when visual edit is unsafe.">
          <Switch
            checked={visualEditor.fallbackToDirectEdit}
            onCheckedChange={(v) => setVisualEditor({ fallbackToDirectEdit: v })}
          />
        </SettingsRow>
        <SettingsRow title="Show source mapping" description="Show which source lines a visual edit affected.">
          <Switch
            checked={visualEditor.showSourceMapping}
            onCheckedChange={(v) => setVisualEditor({ showSourceMapping: v })}
          />
        </SettingsRow>
        <SettingsRow title="Snapshot before structural edit" description="Take a project snapshot before structural visual edits.">
          <Switch
            checked={visualEditor.snapshotBeforeStructuralEdit}
            onCheckedChange={(v) => setVisualEditor({ snapshotBeforeStructuralEdit: v })}
          />
        </SettingsRow>
        <SettingsRow title="Default responsive breakpoint" description="Initial preview width for visual edits.">
          <Select
            value={visualEditor.defaultResponsiveBreakpoint}
            onValueChange={(v) => setVisualEditor({ defaultResponsiveBreakpoint: v as typeof visualEditor.defaultResponsiveBreakpoint })}
          >
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="desktop">Desktop</SelectItem>
              <SelectItem value="tablet">Tablet</SelectItem>
              <SelectItem value="mobile">Mobile</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <div className="py-2 text-[11px] text-fg-muted">
          Unsafe visual transformations remain protected — Settings does not expose a toggle to disable visual-edit safety.
        </div>
      </SettingsGroup>

      <SettingsGroup title="GitHub">
        <SettingsRow title="Public GitHub Import" description="Import a public GitHub repository as a DevWorkspace project.">
          <StatusPill status="ready" label="Available" />
        </SettingsRow>
        <SettingsRow title="Private repositories" description="Private repository import requires GitHub account authentication.">
          <StatusPill status="setup_required" label="Authentication not configured" />
        </SettingsRow>
        <div className="py-2 text-[11px] text-fg-muted">
          GitHub account connection is not yet implemented. Public import works without authentication.
        </div>
      </SettingsGroup>
    </div>
  );
}
