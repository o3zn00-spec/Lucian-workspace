"use client";

import { Check } from "lucide-react";
import { useTheme } from "@/components/theme/ThemeProvider";
import { ACCENTS, THEMES } from "@/lib/themes";

export function GeneralSettings() {
  const { theme, accent, setTheme, setAccent } = useTheme();

  return (
    <div className="space-y-8">
      {/* -------------------------------------------------- */}
      {/* Background theme                                    */}
      {/* -------------------------------------------------- */}
      <section>
        <h3 className="text-sm font-semibold text-fg">Background theme</h3>
        <p className="mt-0.5 text-[13px] text-fg-muted">
          Sets the base canvas, surfaces, borders and text of the entire
          interface.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-2.5 min-[430px]:grid-cols-2 md:grid-cols-3">
          {THEMES.map((t) => {
            const selected = theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTheme(t.id)}
                aria-pressed={selected}
                className={`focus-ring themed group relative rounded-lg border p-2.5 text-left transition-colors ${
                  selected
                    ? "border-accent bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))]"
                    : "border-line bg-surface-2/50 hover:border-fg-faint"
                }`}
              >
                {/* Palette preview */}
                <span
                  className="flex h-9 w-full overflow-hidden rounded-md border"
                  style={{ borderColor: t.preview[2] }}
                >
                  <span
                    className="flex-[2]"
                    style={{ backgroundColor: t.preview[0] }}
                  />
                  <span
                    className="flex-[2]"
                    style={{ backgroundColor: t.preview[1] }}
                  />
                  <span
                    className="flex-1"
                    style={{ backgroundColor: t.preview[2] }}
                  />
                  <span
                    className="flex flex-1 items-center justify-center"
                    style={{ backgroundColor: t.preview[0] }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: t.preview[3] }}
                    />
                  </span>
                </span>

                <span className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-fg">
                    {t.name}
                  </span>
                  {selected && (
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
                      <Check size={10} strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-fg-muted">
                  {t.description}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="h-px bg-line-muted" />

      {/* -------------------------------------------------- */}
      {/* Accent color                                        */}
      {/* -------------------------------------------------- */}
      <section>
        <h3 className="text-sm font-semibold text-fg">Accent color</h3>
        <p className="mt-0.5 text-[13px] text-fg-muted">
          Used for primary actions, active states, focus rings and highlights.
          Independent from the background theme.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-2.5 min-[430px]:grid-cols-3 md:grid-cols-4">
          {ACCENTS.map((a) => {
            const selected = accent === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setAccent(a.id)}
                aria-pressed={selected}
                className={`focus-ring themed flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
                  selected
                    ? "border-accent bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))]"
                    : "border-line bg-surface-2/50 hover:border-fg-faint"
                }`}
              >
                <span
                  className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-black/20"
                  style={{ backgroundColor: a.color }}
                >
                  {selected && (
                    <Check
                      size={12}
                      strokeWidth={3.5}
                      className="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
                    />
                  )}
                </span>
                <span className="truncate text-[13px] font-medium text-fg">
                  {a.name}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
