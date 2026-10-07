"use client";

/* LUCIAN Settings — Appearance section.
 *
 * Live preview + Mode (system/dark/light) + Theme + Accent + Interface
 * (density, font scale, animations, rounded).
 *
 * Theme + accent are stored via ThemeProvider (existing localStorage
 * keys `lucian-theme` and `lucian-accent`). Mode + interface prefs are
 * stored in useSettingsStore. All of them apply immediately via
 * dataset attributes (see AppearanceApplier).
 */

import { Check } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { useSettingsStore } from "@/store/settings";
import { THEMES, ACCENTS } from "@/lib/themes";
import { SettingsGroup, SettingsRow, SettingsSectionHeader } from "@/components/settings/primitives";
import { cn } from "@/lib/utils";

export function AppearanceSection() {
  const { theme, accent, setTheme, setAccent } = useTheme();
  const appearance = useSettingsStore((s) => s.appearance);
  const setAppearance = useSettingsStore((s) => s.setAppearance);

  return (
    <div>
      <SettingsSectionHeader
        title="Appearance"
        subtitle="Customize how LUCIAN looks and feels."
      />

      {/* Live preview */}
      <LivePreview theme={theme} accent={accent} />

      {/* Mode */}
      <SettingsGroup title="Appearance Mode">
        <div className="themed flex items-center gap-2 py-2">
          {(["system", "dark", "light"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setAppearance({ mode: m })}
              className={cn(
                "themed rounded-md border px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                appearance.mode === m
                  ? "border-accent bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))] text-fg"
                  : "border-line bg-surface text-fg-muted hover:bg-hover hover:text-fg",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </SettingsGroup>

      {/* Themes */}
      <SettingsGroup title="Theme">
        <div className="grid grid-cols-1 gap-2.5 py-2 min-[430px]:grid-cols-2 md:grid-cols-3">
          {THEMES.map((t) => {
            const selected = theme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                aria-pressed={selected}
                className={cn(
                  "focus-ring themed group relative rounded-lg border p-2.5 text-left transition-colors",
                  selected
                    ? "border-accent bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))]"
                    : "border-line bg-surface-2/50 hover:border-fg-faint",
                )}
              >
                <span
                  className="flex h-9 w-full overflow-hidden rounded-md border"
                  style={{ borderColor: t.preview[2] }}
                >
                  <span className="flex-[2]" style={{ backgroundColor: t.preview[0] }} />
                  <span className="flex-[2]" style={{ backgroundColor: t.preview[1] }} />
                  <span className="flex-1" style={{ backgroundColor: t.preview[2] }} />
                  <span className="flex flex-1 items-center justify-center" style={{ backgroundColor: t.preview[0] }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: t.preview[3] }} />
                  </span>
                </span>
                <span className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-fg">{t.name}</span>
                  {selected && (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
                      <Check size={10} strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-fg-muted">{t.description}</span>
              </button>
            );
          })}
        </div>
      </SettingsGroup>

      {/* Accent */}
      <SettingsGroup title="Accent">
        <div className="grid grid-cols-2 gap-2.5 py-2 min-[430px]:grid-cols-3 md:grid-cols-4">
          {ACCENTS.map((a) => {
            const selected = accent === a.id;
            return (
              <button
                key={a.id}
                onClick={() => setAccent(a.id)}
                aria-pressed={selected}
                className={cn(
                  "focus-ring themed flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors",
                  selected
                    ? "border-accent bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))]"
                    : "border-line bg-surface-2/50 hover:border-fg-faint",
                )}
              >
                <span
                  className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-black/20"
                  style={{ backgroundColor: a.color }}
                >
                  {selected && (
                    <Check size={12} strokeWidth={3.5} className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]" />
                  )}
                </span>
                <span className="truncate text-[13px] font-medium text-fg">{a.name}</span>
              </button>
            );
          })}
        </div>
      </SettingsGroup>

      {/* Interface */}
      <SettingsGroup title="Interface">
        <SettingsRow title="Density" description="Comfortable or compact spacing across the interface.">
          <Segmented
            value={appearance.density}
            options={[{ value: "comfortable", label: "Comfortable" }, { value: "compact", label: "Compact" }]}
            onChange={(v) => setAppearance({ density: v as typeof appearance.density })}
          />
        </SettingsRow>
        <SettingsRow title="Font size" description="Small / Default / Large.">
          <Segmented
            value={appearance.fontScale}
            options={[{ value: "small", label: "Small" }, { value: "default", label: "Default" }, { value: "large", label: "Large" }]}
            onChange={(v) => setAppearance({ fontScale: v as typeof appearance.fontScale })}
          />
        </SettingsRow>
        <SettingsRow title="Animations" description="Full or reduced motion.">
          <Segmented
            value={appearance.animations}
            options={[{ value: "full", label: "Full" }, { value: "reduced", label: "Reduced" }]}
            onChange={(v) => setAppearance({ animations: v as typeof appearance.animations })}
          />
        </SettingsRow>
        <SettingsRow title="Rounded interface" description="Default or reduced corner radius.">
          <Segmented
            value={appearance.rounded}
            options={[{ value: "default", label: "Default" }, { value: "reduced", label: "Reduced" }]}
            onChange={(v) => setAppearance({ rounded: v as typeof appearance.rounded })}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

/* ── Live preview ── */

function LivePreview({ theme, accent }: { theme: string; accent: string }) {
  // Use the theme's preview palette directly so the preview reflects
  // the selected theme + accent in real time.
  const t = THEMES.find((x) => x.id === theme) ?? THEMES[0];
  const a = ACCENTS.find((x) => x.id === accent) ?? ACCENTS[0];

  return (
    <div
      className="themed mb-4 overflow-hidden rounded-lg border border-line"
      style={{ backgroundColor: t.preview[0], color: t.preview[3] }}
    >
      {/* Mini sidebar */}
      <div className="flex">
        <div
          className="flex w-12 shrink-0 flex-col items-center gap-2 py-3"
          style={{ backgroundColor: t.preview[1], borderRight: `1px solid ${t.preview[2]}` }}
        >
          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.preview[2] }} />
          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: t.preview[2] }} />
          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: a.color }} />
        </div>
        {/* Content */}
        <div className="flex-1 p-3">
          <div className="text-[10px] font-medium opacity-70">LUCIAN</div>
          <div
            className="mt-2 rounded-md p-2.5"
            style={{ backgroundColor: t.preview[1], border: `1px solid ${t.preview[2]}` }}
          >
            <div className="text-[11px] font-semibold">Sample card</div>
            <div className="mt-1 text-[10px] opacity-70">Changes apply immediately.</div>
            <button
              type="button"
              disabled
              aria-disabled="true"
              title="Theme preview only"
              className="mt-2 rounded px-2 py-1 text-[10px] font-semibold text-black"
              style={{ backgroundColor: a.color }}
            >
              Accent button
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: a.color }} />
            <span className="text-[10px] opacity-70">Accent example</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Segmented control ── */

function Segmented<T extends string>({
  value, options, onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="themed inline-flex rounded-md border border-line-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "themed rounded px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.value
              ? "bg-active text-fg"
              : "text-fg-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
