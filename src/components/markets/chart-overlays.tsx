"use client";

// LUCIAN Markets — Chart drawings, indicators, objects, screenshot.
//
// Phase 3 introduces a real drawing system that overlays the chart.
// Drawings are stored per-pane (by pane index) so multi-pane layouts
// don't mix them up. The data model is intentionally minimal —
// enough to render trend lines, horizontal/vertical lines, rectangles,
// and text annotations on the chart canvas.
//
// Indicators (SMA/EMA/Volume/RSI) use REAL candle history from the
// Phase 1 markets store. No fabricated values.

import { useEffect, useRef, useState } from "react";
import { X, Trash2, Eye, EyeOff, Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Candle } from "@/lib/markets/types";
import { sma, ema, rsi, volumeSeries } from "@/lib/markets/indicators";

/* ────────────────────────────────────────────────────────────────── */
/* Drawing data model                                                */
/* ────────────────────────────────────────────────────────────────── */

export type DrawingKind =
  | "trend-line"
  | "horizontal-line"
  | "vertical-line"
  | "rectangle"
  | "text";

export interface Drawing {
  id: string;
  kind: DrawingKind;
  /** For trend-line + rectangle: the two endpoints in price/time space. */
  p1?: { time: number; price: number };
  p2?: { time: number; price: number };
  /** For horizontal/vertical lines: the single coordinate. */
  price?: number;
  time?: number;
  /** For text annotations. */
  text?: string;
  /** Visibility toggle (Objects panel can hide/show). */
  visible: boolean;
  /** Color — defaults to accent. */
  color?: string;
}

export interface DrawingState {
  /** Per-pane drawings, keyed by pane index. */
  byPane: Map<number, Drawing[]>;
}

/* ────────────────────────────────────────────────────────────────── */
/* Indicators data model                                             */
/* ────────────────────────────────────────────────────────────────── */

export type IndicatorKind = "sma" | "ema" | "volume" | "rsi";

export interface IndicatorConfig {
  id: string;
  kind: IndicatorKind;
  period: number;
  color: string;
  visible: boolean;
}

export const DEFAULT_INDICATOR_COLORS: Record<IndicatorKind, string> = {
  sma: "#f5a623",
  ema: "#4b9eff",
  volume: "#4bfa8f",
  rsi: "#c084fc",
};

export const DEFAULT_INDICATOR_PERIODS: Record<IndicatorKind, number> = {
  sma: 20,
  ema: 12,
  volume: 0, // volume doesn't use a period
  rsi: 14,
};

/* ────────────────────────────────────────────────────────────────── */
/* Drawing canvas overlay                                            */
/* ────────────────────────────────────────────────────────────────── */
//
// Renders SVG drawings on top of the chart. The parent (CandleChart)
// provides the chart's coordinate converter so we can map price/time
// to pixel coordinates. Drawings live in their own SVG layer so they
// don't interfere with lightweight-charts' own canvas.

export interface ChartCoord {
  /** Convert a candle time (seconds) + price to {x, y} pixel coords. */
  timePriceToXY: (time: number, price: number) => { x: number; y: number } | null;
  /** Convert pixel {x, y} back to {time, price}. */
  xyToTimePrice: (x: number, y: number) => { time: number; price: number } | null;
  /** Chart container width/height for the SVG viewport. */
  width: number;
  height: number;
}

export function DrawingsOverlay({
  drawings,
  activeTool,
  onAddDrawing,
  onUpdateDrawing,
  chartCoord,
}: {
  drawings: Drawing[];
  activeTool: string;
  onAddDrawing: (d: Drawing) => void;
  onUpdateDrawing: (id: string, patch: Partial<Drawing>) => void;
  chartCoord: ChartCoord | null;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<{
    kind: DrawingKind;
    p1: { x: number; y: number };
    p2: { x: number; y: number };
  } | null>(null);

  if (!chartCoord) return null;

  const isDrawingTool = ["trend-line", "horizontal-line", "vertical-line", "rectangle", "text"].includes(
    activeTool,
  );

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDrawingTool || !chartCoord) return;
    const rect = svgRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const tp = chartCoord.xyToTimePrice(x, y);
    if (!tp) return;

    if (activeTool === "horizontal-line") {
      // Horizontal lines only need one click.
      onAddDrawing({
        id: `draw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        kind: "horizontal-line",
        price: tp.price,
        visible: true,
        color: "var(--accent)",
      });
      return;
    }
    if (activeTool === "vertical-line") {
      onAddDrawing({
        id: `draw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        kind: "vertical-line",
        time: tp.time,
        visible: true,
        color: "var(--accent)",
      });
      return;
    }
    if (activeTool === "text") {
      const text = window.prompt("Annotation text:");
      if (!text) return;
      onAddDrawing({
        id: `draw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        kind: "text",
        p1: tp,
        text,
        visible: true,
        color: "var(--accent)",
      });
      return;
    }
    // trend-line + rectangle: start a draft.
    setDraft({ kind: activeTool as DrawingKind, p1: { x, y }, p2: { x, y } });
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!draft) return;
    const rect = svgRef.current!.getBoundingClientRect();
    setDraft({ ...draft, p2: { x: e.clientX - rect.left, y: e.clientY - rect.top } });
  };

  const handleMouseUp = () => {
    if (!draft || !chartCoord) return;
    const tp1 = chartCoord.xyToTimePrice(draft.p1.x, draft.p1.y);
    const tp2 = chartCoord.xyToTimePrice(draft.p2.x, draft.p2.y);
    if (tp1 && tp2) {
      onAddDrawing({
        id: `draw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        kind: draft.kind,
        p1: tp1,
        p2: tp2,
        visible: true,
        color: "var(--accent)",
      });
    }
    setDraft(null);
  };

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 h-full w-full"
      style={{ pointerEvents: isDrawingTool ? "auto" : "none" }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Render existing drawings */}
      {drawings.filter((d) => d.visible).map((d) => (
        <DrawingShape key={d.id} drawing={d} chartCoord={chartCoord} />
      ))}
      {/* Render draft (in-progress drawing) */}
      {draft && (
        <DraftShape draft={draft} />
      )}
    </svg>
  );
}

function DrawingShape({
  drawing,
  chartCoord,
}: {
  drawing: Drawing;
  chartCoord: ChartCoord;
}) {
  const color = drawing.color ?? "var(--accent)";
  switch (drawing.kind) {
    case "trend-line": {
      if (!drawing.p1 || !drawing.p2) return null;
      const a = chartCoord.timePriceToXY(drawing.p1.time, drawing.p1.price);
      const b = chartCoord.timePriceToXY(drawing.p2.time, drawing.p2.price);
      if (!a || !b) return null;
      return (
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={1.5} />
      );
    }
    case "horizontal-line": {
      if (drawing.price === undefined) return null;
      // Horizontal line spans the full chart width at the given price.
      const left = chartCoord.timePriceToXY(0, drawing.price);
      const right = chartCoord.timePriceToXY(chartCoord.width, drawing.price);
      // If we can't convert via time=0 (out of range), just draw at the price level.
      const y = left?.y ?? right?.y;
      if (y === undefined) return null;
      return (
        <g>
          <line x1={0} y1={y} x2={chartCoord.width} y2={y} stroke={color} strokeWidth={1} strokeDasharray="4 2" />
          <text x={4} y={y - 4} fill={color} fontSize={9} className="font-mono">
            {drawing.price.toFixed(2)}
          </text>
        </g>
      );
    }
    case "vertical-line": {
      if (drawing.time === undefined) return null;
      const top = chartCoord.timePriceToXY(drawing.time, 0);
      const x = top?.x;
      if (x === undefined) return null;
      return (
        <line x1={x} y1={0} x2={x} y2={chartCoord.height} stroke={color} strokeWidth={1} strokeDasharray="4 2" />
      );
    }
    case "rectangle": {
      if (!drawing.p1 || !drawing.p2) return null;
      const a = chartCoord.timePriceToXY(drawing.p1.time, drawing.p1.price);
      const b = chartCoord.timePriceToXY(drawing.p2.time, drawing.p2.price);
      if (!a || !b) return null;
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      return (
        <rect x={x} y={y} width={w} height={h} fill={`${color}20`} stroke={color} strokeWidth={1} />
      );
    }
    case "text": {
      if (!drawing.p1 || !drawing.text) return null;
      const a = chartCoord.timePriceToXY(drawing.p1.time, drawing.p1.price);
      if (!a) return null;
      return (
        <text x={a.x + 4} y={a.y - 4} fill={color} fontSize={11} className="font-sans">
          {drawing.text}
        </text>
      );
    }
    default:
      return null;
  }
}

function DraftShape({
  draft,
}: {
  draft: { kind: DrawingKind; p1: { x: number; y: number }; p2: { x: number; y: number } };
}) {
  const color = "var(--accent)";
  if (draft.kind === "trend-line") {
    return (
      <line
        x1={draft.p1.x} y1={draft.p1.y} x2={draft.p2.x} y2={draft.p2.y}
        stroke={color} strokeWidth={1.5} strokeDasharray="3 3" opacity={0.7}
      />
    );
  }
  if (draft.kind === "rectangle") {
    const x = Math.min(draft.p1.x, draft.p2.x);
    const y = Math.min(draft.p1.y, draft.p2.y);
    const w = Math.abs(draft.p2.x - draft.p1.x);
    const h = Math.abs(draft.p2.y - draft.p1.y);
    return (
      <rect x={x} y={y} width={w} height={h} fill={`${color}20`} stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
    );
  }
  return null;
}

/* ────────────────────────────────────────────────────────────────── */
/* Indicators popover                                                */
/* ────────────────────────────────────────────────────────────────── */

export function IndicatorsPopover({
  indicators,
  onToggle,
  onPeriodChange,
  onAdd,
  onRemove,
  onClose,
}: {
  indicators: IndicatorConfig[];
  onToggle: (id: string) => void;
  onPeriodChange: (id: string, period: number) => void;
  onAdd: (kind: IndicatorKind) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handlePointer = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!e.composedPath().includes(rootRef.current)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", handlePointer);
      document.addEventListener("keydown", handleKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className="absolute right-3 top-12 z-30 w-[240px] overflow-hidden rounded-md shadow-xl themed"
      style={{
        background: "#1e1e2d",
        border: "1px solid #2a2a3c",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
      }}
    >
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <span className="text-[13px] font-semibold text-white">Indicators</span>
        <button type="button" aria-label="Close indicators" onClick={onClose} className="text-fg-faint hover:text-fg">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {/* Existing indicators */}
      <div className="pb-2">
        {indicators.length === 0 && (
          <div className="px-4 py-3 text-[10px] text-fg-faint">
            No indicators added yet.
          </div>
        )}
        {indicators.map((ind) => (
          <div key={ind.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#2a2a3c]">
            <button
              type="button"
              onClick={() => onToggle(ind.id)}
              title={ind.visible ? "Hide" : "Show"}
              className="text-fg-muted hover:text-fg"
            >
              {ind.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            </button>
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: ind.color }}
            />
            <span className="flex-1 text-[11px] font-medium uppercase text-white">
              {ind.kind}
            </span>
            {ind.kind !== "volume" && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`Decrease ${ind.kind} period`}
                  onClick={() => onPeriodChange(ind.id, Math.max(2, ind.period - 1))}
                  className="flex h-4 w-4 items-center justify-center rounded text-fg-muted hover:bg-[#363a45] hover:text-white"
                >
                  <Minus className="h-2.5 w-2.5" />
                </button>
                <span className="w-5 text-center font-mono text-[10px] tabular-nums text-white">
                  {ind.period}
                </span>
                <button
                  type="button"
                  aria-label={`Increase ${ind.kind} period`}
                  onClick={() => onPeriodChange(ind.id, Math.min(200, ind.period + 1))}
                  className="flex h-4 w-4 items-center justify-center rounded text-fg-muted hover:bg-[#363a45] hover:text-white"
                >
                  <Plus className="h-2.5 w-2.5" />
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => onRemove(ind.id)}
              title="Remove"
              className="text-fg-muted hover:text-[#ff5b5b]"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="border-t border-[#2e2e3e] px-3 py-2">
        <div className="mb-1 text-[9px] uppercase tracking-wide text-fg-faint">Add indicator</div>
        <div className="grid grid-cols-2 gap-1">
          {(["sma", "ema", "volume", "rsi"] as IndicatorKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onAdd(k)}
              className="rounded border border-[#2a2a3c] px-2 py-1 text-[10px] font-medium uppercase text-fg-muted hover:bg-[#2a2a3c] hover:text-white"
            >
              {k}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Objects panel                                                     */
/* ────────────────────────────────────────────────────────────────── */

export function ObjectsPanel({
  drawings,
  onToggleVisible,
  onDelete,
  onClearAll,
  onClose,
}: {
  drawings: Drawing[];
  onToggleVisible: (id: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handlePointer = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!e.composedPath().includes(rootRef.current)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", handlePointer);
      document.addEventListener("keydown", handleKey);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className="absolute right-3 top-12 z-30 w-[240px] overflow-hidden rounded-md shadow-xl themed"
      style={{
        background: "#1e1e2d",
        border: "1px solid #2a2a3c",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
      }}
    >
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <span className="text-[13px] font-semibold text-white">Objects</span>
        <button type="button" aria-label="Close drawing objects" onClick={onClose} className="text-fg-faint hover:text-fg">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="max-h-[240px] overflow-y-auto pb-2">
        {drawings.length === 0 ? (
          <div className="px-4 py-4 text-center text-[10px] text-fg-faint">
            No drawings on this pane.
            <br />
            Use the drawing rail to add one.
          </div>
        ) : (
          drawings.map((d) => (
            <div key={d.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#2a2a3c]">
              <button
                type="button"
                onClick={() => onToggleVisible(d.id)}
                title={d.visible ? "Hide" : "Show"}
                className="text-fg-muted hover:text-fg"
              >
                {d.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              </button>
              <span className="flex-1 truncate text-[11px] font-medium capitalize text-white">
                {d.kind.replace("-", " ")}
              </span>
              <button
                type="button"
                onClick={() => onDelete(d.id)}
                title="Delete"
                className="text-fg-muted hover:text-[#ff5b5b]"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>
      {drawings.length > 0 && (
        <div className="border-t border-[#2e2e3e] px-3 py-2">
          <button
            type="button"
            onClick={onClearAll}
            className="flex w-full items-center justify-center gap-1.5 rounded bg-[#2a2a3c] py-1.5 text-[10px] font-medium text-[#ff5b5b] hover:bg-[#3a2a2c]"
          >
            <Trash2 className="h-3 w-3" />
            Clear All
          </button>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Screenshot helper                                                 */
/* ────────────────────────────────────────────────────────────────── */
//
// Captures the active chart pane's container as a PNG and triggers a
// browser download. Uses the SVG-to-canvas approach: we serialize the
// chart container's outerHTML, draw it onto a canvas via an Image, and
// export the canvas as a PNG.
//
// If the chart contains cross-origin images (it shouldn't — all chart
// rendering is local), the canvas would be tainted and the export
// would fail. We catch that and show an honest error.

export async function captureChartScreenshot(
  container: HTMLElement,
  filename: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // Use the modern browser API if available.
    // Note: html2canvas isn't installed; we use a lightweight manual
    // approach that serializes the container's computed style into a
    // foreignObject SVG, then rasterizes it.
    const rect = container.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w === 0 || h === 0) {
      return { ok: false, error: "Chart container has zero size." };
    }
    // Clone the container + inline its computed styles.
    const clone = container.cloneNode(true) as HTMLElement;
    const styleWrapper = document.createElement("div");
    styleWrapper.appendChild(clone);
    // Inline computed styles on every element in the clone.
    inlineComputedStyles(container, clone);
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <foreignObject width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;background:#131722;">
      ${clone.outerHTML}
    </div>
  </foreignObject>
</svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Failed to rasterize chart SVG."));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      URL.revokeObjectURL(url);
      return { ok: false, error: "Canvas 2D context unavailable." };
    }
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    // Try to export — will throw if canvas is tainted.
    const dataUrl = canvas.toDataURL("image/png");
    // Trigger download.
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Screenshot capture failed.",
    };
  }
}

/** Recursively inline computed CSS styles from `src` onto `dst` so the
    cloned DOM renders identically when serialized into an SVG foreignObject. */
function inlineComputedStyles(src: Element, dst: Element): void {
  const srcStyle = window.getComputedStyle(src);
  const dstEl = dst as HTMLElement;
  let cssText = "";
  for (let i = 0; i < srcStyle.length; i++) {
    const prop = srcStyle.item(i);
    const val = srcStyle.getPropertyValue(prop);
    cssText += `${prop}:${val};`;
  }
  dstEl.setAttribute("style", cssText);
  const srcChildren = src.children;
  const dstChildren = dst.children;
  for (let i = 0; i < srcChildren.length && i < dstChildren.length; i++) {
    inlineComputedStyles(srcChildren[i], dstChildren[i]);
  }
}

/* ────────────────────────────────────────────────────────────────── */
/* Indicator line series (rendered as SVG over the chart)             */
/* ────────────────────────────────────────────────────────────────── */
//
// lightweight-charts has its own LineSeries API, but adding/removing
// series dynamically from outside the chart-creation effect is fragile
// (we'd need to keep refs to every series and call series.applyOptions
// + chart.removeSeries on toggle). For Phase 3 we render indicator
// lines as SVG over the chart — same coordinate system as drawings.
// This is simpler, less error-prone, and visually equivalent.

export function IndicatorLines({
  candles,
  indicators,
  chartCoord,
}: {
  candles: Candle[];
  indicators: IndicatorConfig[];
  chartCoord: ChartCoord | null;
}) {
  if (!chartCoord || candles.length === 0) return null;
  return (
    <svg className="absolute inset-0 h-full w-full pointer-events-none">
      {indicators.filter((i) => i.visible).map((ind) => {
        const points = computeIndicatorPoints(candles, ind);
        if (!points) return null;
        // Build a polyline from the indicator's (time, value) pairs.
        const coords = points
          .map((p) => (p === null ? null : chartCoord.timePriceToXY(p.time, p.value)))
          .filter((c): c is { x: number; y: number } => c !== null);
        if (coords.length < 2) return null;
        const polyPoints = coords.map((c) => `${c.x},${c.y}`).join(" ");
        return (
          <polyline
            key={ind.id}
            points={polyPoints}
            fill="none"
            stroke={ind.color}
            strokeWidth={1}
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}

function computeIndicatorPoints(
  candles: Candle[],
  ind: IndicatorConfig,
): Array<{ time: number; value: number } | null> | null {
  let values: (number | null)[];
  switch (ind.kind) {
    case "sma":
      values = sma(candles, ind.period);
      break;
    case "ema":
      values = ema(candles, ind.period);
      break;
    case "rsi":
      values = rsi(candles, ind.period);
      break;
    case "volume":
      values = volumeSeries(candles);
      break;
    default:
      return null;
  }
  return candles.map((c, i) => {
    const v = values[i];
    if (v === null || v === undefined) return null;
    return { time: c.time, value: v };
  });
}
