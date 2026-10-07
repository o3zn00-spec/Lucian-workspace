"use client";

/* LUCIAN Settings — Accessibility & Shortcuts section.
 *
 * Accessibility toggles apply immediately via dataset attributes
 * (see AppearanceApplier).
 *
 * Shortcuts: only list the ones that genuinely work today. No fake
 * Customize button — customization is not implemented, so we say so.
 */

import { Keyboard } from "lucide-react";
import { useSettingsStore } from "@/store/settings";
import { SettingsGroup, SettingsRow, SettingsSectionHeader } from "@/components/settings/primitives";
import { Switch } from "@/components/ui-devspace/switch";

interface ShortcutRow {
  keys: string;
  label: string;
  works: boolean;
  note?: string;
}

const SHORTCUTS: ShortcutRow[] = [
  { keys: "Ctrl/Cmd + K", label: "Open Global Search", works: true },
  { keys: "Esc",          label: "Close any open dialog", works: true },
  { keys: "Ctrl/Cmd + S", label: "Save the active file in DevWorkspace", works: true },
  { keys: "Ctrl/Cmd + P", label: "Open file search in DevWorkspace", works: true },
  { keys: "Ctrl/Cmd + /", label: "Focus the Settings search input", works: true },
];

export function AccessibilitySection() {
  const a11y = useSettingsStore((s) => s.accessibility);
  const setA11y = useSettingsStore((s) => s.setAccessibility);

  return (
    <div>
      <SettingsSectionHeader
        title="Accessibility & Shortcuts"
        subtitle="Visual accessibility options and the keyboard shortcuts LUCIAN actually supports."
      />

      <SettingsGroup title="Accessibility">
        <SettingsRow title="Reduce motion" description="Minimize animations across LUCIAN.">
          <Switch checked={a11y.reduceMotion} onCheckedChange={(v) => setA11y({ reduceMotion: v })} />
        </SettingsRow>
        <SettingsRow title="High contrast" description="Increase contrast for better readability.">
          <Switch checked={a11y.highContrast} onCheckedChange={(v) => setA11y({ highContrast: v })} />
        </SettingsRow>
        <SettingsRow title="Larger interface text" description="Larger text size across the interface (additive to Appearance → Font size).">
          <Switch checked={a11y.largerText} onCheckedChange={(v) => setA11y({ largerText: v })} />
        </SettingsRow>
        <SettingsRow title="Keyboard focus indicators" description="Show visible focus rings on keyboard navigation. Disabling only hides them for mouse users.">
          <Switch checked={a11y.keyboardFocusIndicators} onCheckedChange={(v) => setA11y({ keyboardFocusIndicators: v })} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Shortcuts">
        {SHORTCUTS.map((s) => (
          <SettingsRow key={s.keys} title={s.label} description={s.note}>
            <kbd className="themed rounded border border-line-muted bg-surface-2 px-2 py-1 text-xs font-mono text-fg">
              {s.keys}
            </kbd>
          </SettingsRow>
        ))}
        <div className="flex items-center gap-2 py-2 text-[11px] text-fg-muted">
          <Keyboard className="h-3 w-3" />
          Shortcut customization is not implemented. Coming later.
        </div>
      </SettingsGroup>
    </div>
  );
}
