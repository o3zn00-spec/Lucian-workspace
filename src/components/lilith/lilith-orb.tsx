"use client";

/* LilithOrb — the animated futuristic orb.
 *
 * Renders a layered SVG with:
 *   - outer rotating ring
 *   - inner counter-rotating ring
 *   - central breathing sphere
 *   - orbiting particles
 *   - state-driven visual changes (idle/listening/thinking/speaking/attention)
 *
 * All colors are driven by CSS variables set on the parent container
 * (--lilith-primary, --lilith-glow, --lilith-pulse) so changing the
 * color preset updates the entire visual system instantly.
 *
 * Animation is CSS-based (no JS rAF loop) for performance. Reduced
 * motion slows/stops rotations but keeps the breathing glow.
 */

import { useEffect, useState } from "react";
import {
  useLilithStore,
  type LilithStatus,
  getColorPreset,
  shouldReduceMotion,
} from "@/store/lilith";

export function LilithOrb() {
  const status = useLilithStore((s) => s.status);
  const settings = useLilithStore((s) => s.settings);
  const colorPreset = getColorPreset(settings.color);
  const reduceMotion = shouldReduceMotion(settings);

  // Animation intensity scales the CSS animation-duration multiplier.
  const speedMultiplier =
    settings.animationIntensity === "high"
      ? 0.7
      : settings.animationIntensity === "low"
      ? 1.6
      : 1;

  // Glow intensity scales the box-shadow / filter blur.
  const glowOpacity =
    settings.glowIntensity === "high"
      ? 0.7
      : settings.glowIntensity === "low"
      ? 0.25
      : 0.45;

  return (
    <div
      className="lilith-orb relative h-full w-full"
      style={
        {
          "--lilith-primary": colorPreset.primary,
          "--lilith-glow": colorPreset.glow,
          "--lilith-pulse": colorPreset.pulse,
          "--lilith-glow-opacity": String(glowOpacity),
          "--lilith-speed": String(speedMultiplier),
        } as React.CSSProperties
      }
      data-status={status}
      data-reduce-motion={reduceMotion ? "true" : "false"}
    >
      <OrbSVG status={status} reduceMotion={reduceMotion} />
    </div>
  );
}

/* ── SVG orb ── */

function OrbSVG({
  status,
  reduceMotion,
}: {
  status: LilithStatus;
  reduceMotion: boolean;
}) {
  // Particle positions — 6 evenly-spaced points around the outer ring.
  const particles = Array.from({ length: 6 }, (_, i) => {
    const angle = (i / 6) * Math.PI * 2;
    const r = 38;
    return {
      cx: 50 + r * Math.cos(angle),
      cy: 50 + r * Math.sin(angle),
    };
  });

  return (
    <svg
      viewBox="0 0 100 100"
      className="h-full w-full overflow-visible"
      aria-hidden="true"
    >
      {/* ── Speaking pulse rings (only visible when speaking) ── */}
      <g className="lilith-speaking-pulse" style={{ opacity: status === "speaking" ? 1 : 0 }}>
        <circle cx="50" cy="50" r="42" fill="none" stroke="var(--lilith-pulse)" strokeWidth="0.5" className="lilith-pulse-ring lilith-pulse-ring-1" />
        <circle cx="50" cy="50" r="46" fill="none" stroke="var(--lilith-pulse)" strokeWidth="0.4" className="lilith-pulse-ring lilith-pulse-ring-2" />
        <circle cx="50" cy="50" r="49" fill="none" stroke="var(--lilith-pulse)" strokeWidth="0.3" className="lilith-pulse-ring lilith-pulse-ring-3" />
      </g>

      {/* ── Listening ripples ── */}
      <g className="lilith-listening-ripple" style={{ opacity: status === "listening" ? 1 : 0 }}>
        <circle cx="50" cy="50" r="35" fill="none" stroke="var(--lilith-glow)" strokeWidth="0.6" className="lilith-listen-ring lilith-listen-ring-1" />
        <circle cx="50" cy="50" r="40" fill="none" stroke="var(--lilith-glow)" strokeWidth="0.4" className="lilith-listen-ring lilith-listen-ring-2" />
      </g>

      {/* ── Outer rotating ring ── */}
      <g className={reduceMotion ? "" : "lilith-rotate-cw"}>
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke="var(--lilith-primary)"
          strokeWidth="0.8"
          strokeOpacity="0.5"
          strokeDasharray="3 6"
        />
      </g>

      {/* ── Inner counter-rotating ring ── */}
      <g className={reduceMotion ? "" : "lilith-rotate-ccw"}>
        <circle
          cx="50"
          cy="50"
          r="34"
          fill="none"
          stroke="var(--lilith-primary)"
          strokeWidth="0.6"
          strokeOpacity="0.4"
          strokeDasharray="2 4"
        />
      </g>

      {/* ── Thinking nodes (orbiting dots, only when thinking) ── */}
      <g className="lilith-thinking-nodes" style={{ opacity: status === "thinking" ? 1 : 0 }}>
        <g className={reduceMotion ? "" : "lilith-rotate-cw-fast"}>
          {particles.map((p, i) => (
            <circle
              key={i}
              cx={p.cx}
              cy={p.cy}
              r="1.2"
              fill="var(--lilith-pulse)"
              className="lilith-thinking-node"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </g>
      </g>

      {/* ── Central sphere (breathing glow) ── */}
      <g className={reduceMotion ? "" : "lilith-breathe"}>
        {/* Glow halo */}
        <circle
          cx="50"
          cy="50"
          r="22"
          fill="var(--lilith-glow)"
          fillOpacity="var(--lilith-glow-opacity)"
          className="lilith-halo"
        />
        {/* Core */}
        <circle
          cx="50"
          cy="50"
          r="14"
          fill="var(--lilith-primary)"
          fillOpacity="0.15"
          stroke="var(--lilith-primary)"
          strokeWidth="0.5"
        />
        {/* Inner bright dot */}
        <circle
          cx="50"
          cy="50"
          r="5"
          fill="var(--lilith-pulse)"
          className="lilith-core"
        />
      </g>

      {/* ── Attention indicator (small dot at top-right) ── */}
      {status === "attention" && (
        <circle
          cx="74"
          cy="26"
          r="3"
          fill="#f59e0b"
          className="lilith-attention-blink"
        />
      )}
    </svg>
  );
}

/* ── Client-only mount guard (prevents hydration flash) ── */

export function LilithOrbMounted() {
  const [mounted, setMounted] = useState(false);
  // Defer setState to a microtask to avoid synchronous setState in the
  // effect body (React 19 set-state-in-effect rule).
  useEffect(() => {
    const id = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(id);
  }, []);
  if (!mounted) return null;
  return <LilithOrb />;
}
