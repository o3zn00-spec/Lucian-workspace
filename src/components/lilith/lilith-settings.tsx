"use client";

/* LilithSettings — settings panel for Lilith, integrated into the
 * existing LUCIAN Settings modal. Placed directly under "General"
 * in the settings navigation.
 */

import { useState } from "react";
import {
  Sparkles,
  Eye,
  Move,
  Maximize2,
  Zap,
  Sun,
  Volume2,
  MessageSquare,
  RotateCcw,
  Save,
  Check,
  Plug,
} from "lucide-react";
import {
  useLilithStore,
  LILITH_COLORS,
  type LilithColorId,
  type LilithSize,
} from "@/store/lilith";
import { EconomicAgentConnection } from "@/components/lilith/economic-agent-connection";
import { cn } from "@/lib/utils";

export function LilithSettings() {
  const settings = useLilithStore((s) => s.settings);
  const updateSettings = useLilithStore((s) => s.updateSettings);
  const resetSettings = useLilithStore((s) => s.resetSettings);
  const resetPosition = useLilithStore((s) => s.resetPosition);
  const [nameDraft, setNameDraft] = useState(settings.name);
  const [nameSaved, setNameSaved] = useState(false);

  const handleSaveName = () => {
    updateSettings({ name: nameDraft.trim() || "Lilthe" });
    setNameSaved(true);
    setTimeout(() => setNameSaved(false), 1500);
  };

  return (
    <div className="space-y-6">
      {/* ── Identity ── */}
      <SettingsSection icon={Sparkles} title="Identity">
        <div className="space-y-2">
          <label className="text-[13px] font-medium text-fg">Assistant name</label>
          <div className="flex gap-2">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
              className="flex-1 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[13px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)] themed"
              placeholder="Lilthe"
            />
            <button
              type="button"
              onClick={handleSaveName}
              className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-semibold text-[var(--accent-fg)] hover:opacity-90"
            >
              {nameSaved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
              {nameSaved ? "Saved" : "Save"}
            </button>
          </div>
        </div>
      </SettingsSection>

      {/* ── Color ── */}
      <SettingsSection icon={Sparkles} title="Lilthe Color">
        <div className="grid grid-cols-5 gap-2">
          {LILITH_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => updateSettings({ color: c.id as LilithColorId })}
              title={c.name}
              className={cn(
                "relative flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all",
                settings.color === c.id
                  ? "border-fg scale-110"
                  : "border-transparent hover:scale-105",
              )}
              style={{ background: c.primary }}
            >
              {settings.color === c.id && (
                <Check className="h-4 w-4 text-white drop-shadow" />
              )}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-fg-muted">
          {LILITH_COLORS.find((c) => c.id === settings.color)?.name}
        </p>
      </SettingsSection>

      {/* ── Visibility ── */}
      <SettingsSection icon={Eye} title="Visibility">
        <ToggleRow
          label="Show Lilthe"
          description="Display the floating orb across the application"
          checked={settings.visible}
          onChange={(v) => updateSettings({ visible: v })}
        />
        <ToggleRow
          label="Show on startup"
          description="Automatically show Lilthe when the app loads"
          checked={settings.showOnStartup}
          onChange={(v) => updateSettings({ showOnStartup: v })}
        />
      </SettingsSection>

      {/* ── Position ── */}
      <SettingsSection icon={Move} title="Position">
        <ToggleRow
          label="Allow dragging"
          description="Enable drag-to-move the orb"
          checked={settings.allowDragging}
          onChange={(v) => updateSettings({ allowDragging: v })}
        />
        <ToggleRow
          label="Remember position"
          description="Persist orb position across sessions"
          checked={settings.rememberPosition}
          onChange={(v) => updateSettings({ rememberPosition: v })}
        />
        <ToggleRow
          label="Lock position"
          description="Prevent dragging entirely"
          checked={settings.lockPosition}
          onChange={(v) => updateSettings({ lockPosition: v })}
        />
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={resetPosition}
            className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-fg-muted hover:text-fg"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset position
          </button>
        </div>
      </SettingsSection>

      {/* ── Size ── */}
      <SettingsSection icon={Maximize2} title="Lilthe Size">
        <div className="flex gap-2">
          {(["small", "medium", "large"] as LilithSize[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => updateSettings({ size: s })}
              className={cn(
                "flex-1 rounded-md border px-3 py-2 text-[12px] font-medium capitalize transition-colors",
                settings.size === s
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-fg"
                  : "border-line bg-surface-2 text-fg-muted hover:text-fg",
              )}
            >
              {s}
              <span className="ml-1 text-[10px] text-fg-faint">
                ({s === "small" ? "56" : s === "medium" ? "78" : "104"}px)
              </span>
            </button>
          ))}
        </div>
      </SettingsSection>

      {/* ── Animation ── */}
      <SettingsSection icon={Zap} title="Animation">
        <div className="space-y-2">
          <label className="text-[13px] font-medium text-fg">Animation intensity</label>
          <div className="flex gap-2">
            {(["low", "normal", "high"] as const).map((i) => (
              <button
                key={i}
                type="button"
                onClick={() => updateSettings({ animationIntensity: i })}
                className={cn(
                  "flex-1 rounded-md border px-3 py-1.5 text-[12px] font-medium capitalize",
                  settings.animationIntensity === i
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-fg"
                    : "border-line bg-surface-2 text-fg-muted hover:text-fg",
                )}
              >
                {i}
              </button>
            ))}
          </div>
        </div>
        <ToggleRow
          label="Reduced motion"
          description="Use calmer animations (respects accessibility)"
          checked={settings.reducedMotion}
          onChange={(v) => updateSettings({ reducedMotion: v })}
        />
      </SettingsSection>

      {/* ── Glow ── */}
      <SettingsSection icon={Sun} title="Glow">
        <div className="space-y-2">
          <label className="text-[13px] font-medium text-fg">Glow intensity</label>
          <div className="flex gap-2">
            {(["low", "normal", "high"] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => updateSettings({ glowIntensity: g })}
                className={cn(
                  "flex-1 rounded-md border px-3 py-1.5 text-[12px] font-medium capitalize",
                  settings.glowIntensity === g
                    ? "border-[var(--accent)] bg-[var(--accent)]/10 text-fg"
                    : "border-line bg-surface-2 text-fg-muted hover:text-fg",
                )}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </SettingsSection>

      {/* ── Voice ── */}
      <SettingsSection icon={Volume2} title="Voice">
        <ToggleRow
          label="Voice responses"
          description="Enable browser speech input and spoken responses"
          checked={settings.voiceEnabled}
          onChange={(v) => updateSettings({ voiceEnabled: v })}
        />
        <ToggleRow
          label="Auto speak responses"
          description="Automatically speak AI responses"
          checked={settings.autoSpeak}
          onChange={(v) => updateSettings({ autoSpeak: v })}
        />
        <ToggleRow
          label="Push to talk"
          description="Hold the microphone button while speaking"
          checked={settings.pushToTalk}
          onChange={(v) => updateSettings({ pushToTalk: v })}
        />
        <div className="space-y-1">
          <label className="text-[13px] font-medium text-fg">Speech speed</label>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={settings.speechSpeed}
            onChange={(e) => updateSettings({ speechSpeed: Number(e.target.value) })}
            className="w-full accent-[var(--accent)]"
          />
          <div className="flex justify-between text-[10px] text-fg-faint">
            <span>0.5×</span>
            <span>{settings.speechSpeed.toFixed(1)}×</span>
            <span>2.0×</span>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[13px] font-medium text-fg">Volume</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.volume}
            onChange={(e) => updateSettings({ volume: Number(e.target.value) })}
            className="w-full accent-[var(--accent)]"
          />
          <div className="flex justify-between text-[10px] text-fg-faint">
            <span>0%</span>
            <span>{Math.round(settings.volume * 100)}%</span>
            <span>100%</span>
          </div>
        </div>
      </SettingsSection>

      {/* ── Personality ── */}
      <SettingsSection icon={MessageSquare} title="Response Style">
        <div className="flex gap-2">
          {(["balanced", "concise", "detailed"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => updateSettings({ responseStyle: s })}
              className={cn(
                "flex-1 rounded-md border px-3 py-1.5 text-[12px] font-medium capitalize",
                settings.responseStyle === s
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-fg"
                  : "border-line bg-surface-2 text-fg-muted hover:text-fg",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </SettingsSection>

      {/* ── Lilith model connection ── */}
      <SettingsSection icon={Plug} title="Lilthe Model Connection">
        <EconomicAgentConnection />
      </SettingsSection>

      {/* ── Reset ── */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            resetSettings();
            resetPosition();
          }}
          className="flex items-center gap-1.5 rounded-md border border-line bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-fg-muted hover:text-fg"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset all Lilthe settings
        </button>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function SettingsSection({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Sparkles;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line-muted bg-surface/50 p-4 themed">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-fg-muted" />
        <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-[13px] font-medium text-fg">{label}</div>
        {description && (
          <div className="text-[11px] text-fg-faint">{description}</div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 rounded-full transition-colors",
          checked ? "bg-[var(--accent)]" : "bg-surface-2",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
