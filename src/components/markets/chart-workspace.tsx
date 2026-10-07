"use client";

/* LUCIAN Markets — central trading workspace.
 *
 * Recreates the red-boxed trading workspace from the reference
 * screenshot. Layout (top to bottom):
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ TOP CHART TOOLBAR                                        │
 *   │ EURUSD  -0.03%  ★  ⓘ ⓘ  M1  [New order]  ⊕        ⚙    │
 *   ├─┬────────────────────────────────────────────────────────┤
 *   │D│  [SELL] [− 0.01 +] [BUY]                               │
 *   │R│  O 1.16795 H 1.16806 L 1.16795 C 1.16803 −0.00008      │
 *   │A│                                                        │
 *   │W│             CANDLESTICK CHART                          │
 *   │I│             (lightweight-charts)                       │
 *   │N│                                                        │
 *   │G│                                                        │
 *   ├─┴────────────────────────────────────────────────────────┤
 *   │ Market 0  Pending 0  Closed       Floating profit $0  Close │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Behavior rules:
 *  - Visual structure only — no fake trading logic, no fake account activity
 *  - Real candlestick chart from lightweight-charts (live Bybit V5 data for crypto,
 *    reference snapshot for non-crypto)
 *  - Timeframe selector cycles M1/M5/M15/M30/H1/H4/D1/W
 *  - Drawing toolbar icons are visual only for this stage
 *  - Bottom strip tabs are visual only for this stage
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  createChart,
  CrosshairMode,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type UTCTimestamp,
  type IPriceLine,
} from "lightweight-charts";
import {
  Star,
  Settings,
  Minus,
  Plus,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Save,
  FolderOpen,
  HelpCircle,
  Check,
  X,
  LayoutGrid,
  Columns2,
  Rows2,
  Columns3,
  Grid2x2,
  Square,
  Search,
  MousePointer2,
  Crosshair,
  TrendingUp,
  Minus as HorizontalLine,
  MoveVertical as VerticalLine,
  Type as TypeIcon,
  Camera,
  Trash2,
  Layers,
  Calculator,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMarketsStore, paneKey, type LucianTimeframe } from "@/store/markets";
import {
  getInstrumentBySymbol,
  INSTRUMENT_CATALOG,
} from "@/lib/markets/catalog";
import { InstrumentIcon } from "@/components/markets/instrument-icon";
import { useFavorites } from "@/hooks/use-favorites";
import { isSupportedCrypto } from "@/lib/markets/symbol-mapping";
import type { Candle, DataStatus } from "@/lib/markets/types";
import { BybitTradingPanel } from "@/components/markets/bybit-trading-panel";
import {
  type Drawing,
  type DrawingKind,
  type IndicatorConfig,
  type IndicatorKind,
  type ChartCoord,
  DrawingsOverlay,
  IndicatorLines,
  IndicatorsPopover,
  ObjectsPanel,
  captureChartScreenshot,
  DEFAULT_INDICATOR_COLORS,
  DEFAULT_INDICATOR_PERIODS,
} from "@/components/markets/chart-overlays";

/* ── Phase 3: persisted drawings + indicators storage ── */
const DRAWINGS_KEY = "lucian-markets-drawings";
const INDICATORS_KEY = "lucian-markets-indicators";

function loadDrawings(): Map<number, Drawing[]> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = localStorage.getItem(DRAWINGS_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Array<[number, Drawing[]]>;
    return new Map(parsed);
  } catch {
    return new Map();
  }
}
function saveDrawings(m: Map<number, Drawing[]>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DRAWINGS_KEY, JSON.stringify(Array.from(m.entries())));
  } catch {
    // storage unavailable
  }
}
function loadIndicators(): Map<number, IndicatorConfig[]> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = localStorage.getItem(INDICATORS_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Array<[number, IndicatorConfig[]]>;
    return new Map(parsed);
  } catch {
    return new Map();
  }
}
function saveIndicators(m: Map<number, IndicatorConfig[]>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(INDICATORS_KEY, JSON.stringify(Array.from(m.entries())));
  } catch {
    // storage unavailable
  }
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W"] as const;
// Human-readable labels for the timeframe tooltip + the chart-pane Escape
// handler. Maps to the Bybit intervals (1m/5m/15m/30m/1h/4h/1d/1w).
const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  M1: "1 minute",
  M5: "5 minutes",
  M15: "15 minutes",
  M30: "30 minutes",
  H1: "1 hour",
  H4: "4 hours",
  D1: "1 day",
  W: "1 week",
};
// `Timeframe` is aliased further down (after PaneState) to LucianTimeframe
// from the store, so all references in this file share the same type.

/* Chart layout modes — controls how many chart panes are visible
   and how they are arranged. */
type ChartLayout =
  | "single"
  | "double-columns"
  | "double-rows"
  | "triple"
  | "quadruple";

/* Layout option metadata — drives both the popup UI and the grid
   container arrangement. */
const LAYOUT_OPTIONS: {
  id: ChartLayout;
  label: string;
  icon: typeof LayoutGrid;
  /* CSS grid template — columns × rows */
  cols: number;
  rows: number;
  /* Optional col-span overrides for cells (1-indexed) used to build
     asymmetric layouts like "triple" (1 big + 2 small). */
  spans?: { col: number; row: number }[];
}[] = [
  { id: "single", label: "Single", icon: Square, cols: 1, rows: 1 },
  {
    id: "double-columns",
    label: "Double in columns",
    icon: Columns2,
    cols: 2,
    rows: 1,
  },
  {
    id: "double-rows",
    label: "Double in rows",
    icon: Rows2,
    cols: 1,
    rows: 2,
  },
  { id: "triple", label: "Triple", icon: Columns3, cols: 2, rows: 2, spans: [{ col: 1, row: 2 }] },
  { id: "quadruple", label: "Quadruple", icon: Grid2x2, cols: 2, rows: 2 },
];

/* Number of chart panes each layout renders. */
const PANE_COUNT: Record<ChartLayout, number> = {
  single: 1,
  "double-columns": 2,
  "double-rows": 2,
  triple: 3,
  quadruple: 4,
};

/* Reference colors — match the screenshot palette. */
const C_BG = "#131722"; // chart background
const C_PANEL = "#1e222d"; // toolbar / drawing rail / bottom strip
const C_BORDER = "#2a2e39";
const C_GRID = "#1e222d";
const C_TEXT = "#d1d4dc";
const C_TEXT_MUTED = "#787b86";
const C_UP = "#089981"; // bullish green
const C_DOWN = "#f23645"; // bearish red
const C_BLUE = "#2962ff"; // action blue
const C_ACTIVE_TOOL = "#7c3aed"; // purple active-tool indicator

/* ------------------------------------------------------------------ */
/* Chart settings state + persistence                                  */
/* ------------------------------------------------------------------ */

const CHART_SETTINGS_KEY = "lucian-markets-chart-settings";

interface ChartSettings {
  showBid: boolean;
  showAsk: boolean;
  showMarketOrders: boolean;
  showPendingOrders: boolean;
}

const DEFAULT_SETTINGS: ChartSettings = {
  showBid: true,
  showAsk: true,
  showMarketOrders: true,
  showPendingOrders: true,
};

/** Hook: load + persist chart view settings (4 toggles) in localStorage. */
function loadChartSettings(): ChartSettings {
  try {
    const raw = localStorage.getItem(CHART_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ChartSettings>;
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_SETTINGS;
}

function useChartSettings() {
  // Hydrate persisted settings via lazy useState initializer (avoids
  // React 19 set-state-in-effect rule).
  const [settings, setSettings] = useState<ChartSettings>(loadChartSettings);

  const update = useCallback((patch: Partial<ChartSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(CHART_SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  return { settings, update };
}

/* ------------------------------------------------------------------ */
/* Save / Load full chart config                                       */
/* ------------------------------------------------------------------ */

const CHART_CONFIG_KEY = "lucian-markets-chart-config";

interface SavedChartConfig {
  symbol: string;
  timeframe: Timeframe;
  showBid: boolean;
  showAsk: boolean;
  showMarketOrders: boolean;
  showPendingOrders: boolean;
  savedAt: number;
}

function saveChartConfig(config: SavedChartConfig): boolean {
  try {
    localStorage.setItem(CHART_CONFIG_KEY, JSON.stringify(config));
    return true;
  } catch {
    return false;
  }
}

function loadChartConfig(): SavedChartConfig | null {
  try {
    const raw = localStorage.getItem(CHART_CONFIG_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedChartConfig;
  } catch {
    return null;
  }
}

export function ChartWorkspace({
  pendingOrderPriceOverride,
  onQuickTrade,
}: {
  pendingOrderPriceOverride?: number | null;
  /** Called when the chart's CompactQuickTrade BUY/SELL button is clicked.
   *  MarketsFrame uses this to open the OrderDetails panel with the
   *  preselected side. */
  onQuickTrade?: (side: "buy" | "sell") => void;
}) {
  const { settings, update } = useChartSettings();
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [bottomExpanded, setBottomExpanded] = useState(false);
  const [internalPendingPrice, setInternalPendingPrice] = useState<number | null>(null);
  // Chart layout — controls how many chart panes are visible.
  const [chartLayout, setChartLayout] = useState<ChartLayout>("single");
  const [layoutPopupOpen, setLayoutPopupOpen] = useState(false);
  // Active drawing tool — shared across all chart panes.
  const [activeTool, setActiveTool] = useState<string>("cursor");

  // ── Phase 3: per-pane drawings + indicators + popovers ──
  // Drawings + indicators are stored per-pane (keyed by pane index) and
  // persisted to localStorage so they survive refresh.
  const [drawingsByPane, setDrawingsByPane] = useState<Map<number, Drawing[]>>(() => loadDrawings());
  const [indicatorsByPane, setIndicatorsByPane] = useState<Map<number, IndicatorConfig[]>>(() => loadIndicators());
  const [indicatorsPane, setIndicatorsPane] = useState<number | null>(null);
  const [objectsPane, setObjectsPane] = useState<number | null>(null);
  // Maximize — the active pane expands to fill the workspace.
  const [maximizedPane, setMaximizedPane] = useState<number | null>(null);

  // Escape restores a maximized pane. Phase 3 spec: "Click again / Escape
  // → restore previous layout."
  useEffect(() => {
    if (maximizedPane === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMaximizedPane(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [maximizedPane]);

  // Persist drawings/indicators to localStorage on change.
  useEffect(() => {
    saveDrawings(drawingsByPane);
  }, [drawingsByPane]);
  useEffect(() => {
    saveIndicators(indicatorsByPane);
  }, [indicatorsByPane]);

  // Clear maximized pane when chart layout changes (the pane index may
  // no longer exist in the new layout). Done via the layout-change
  // callback rather than a useEffect to avoid the cascading-render lint
  // rule that fires when setState is called synchronously inside an effect.
  const handleChartLayoutChange = useCallback((l: ChartLayout) => {
    setChartLayout(l);
    setLayoutPopupOpen(false);
    setMaximizedPane(null);
  }, []);

  // Active pane index from the store — drawings/indicators/screenshot
  // operate on the active pane.
  const activePaneIndex = useMarketsStore((s) => s.activePaneIndex);

  // Helper: get drawings/indicators for the active pane (or pane 0 if
  // the active pane index doesn't exist).
  const drawingsTargetPane = maximizedPane ?? activePaneIndex;
  const activeDrawings = drawingsByPane.get(drawingsTargetPane) ?? [];
  const activeIndicators = indicatorsByPane.get(drawingsTargetPane) ?? [];

  // Drawing mutations scoped to the active pane.
  const addDrawing = useCallback((d: Drawing) => {
    setDrawingsByPane((prev) => {
      const next = new Map(prev);
      const list = next.get(drawingsTargetPane) ?? [];
      next.set(drawingsTargetPane, [...list, d]);
      return next;
    });
  }, [drawingsTargetPane]);
  const updateDrawing = useCallback((id: string, patch: Partial<Drawing>) => {
    setDrawingsByPane((prev) => {
      const next = new Map(prev);
      const list = next.get(drawingsTargetPane) ?? [];
      next.set(drawingsTargetPane, list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
      return next;
    });
  }, [drawingsTargetPane]);
  const removeDrawing = useCallback((id: string) => {
    setDrawingsByPane((prev) => {
      const next = new Map(prev);
      const list = next.get(drawingsTargetPane) ?? [];
      next.set(drawingsTargetPane, list.filter((d) => d.id !== id));
      return next;
    });
  }, [drawingsTargetPane]);
  const clearDrawings = useCallback(() => {
    setDrawingsByPane((prev) => {
      const next = new Map(prev);
      next.set(drawingsTargetPane, []);
      return next;
    });
  }, [drawingsTargetPane]);

  // Indicator mutations scoped to the active pane.
  const addIndicator = useCallback((kind: IndicatorKind) => {
    setIndicatorsByPane((prev) => {
      const next = new Map(prev);
      const list = next.get(drawingsTargetPane) ?? [];
      const newInd: IndicatorConfig = {
        id: `ind_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        kind,
        period: DEFAULT_INDICATOR_PERIODS[kind],
        color: DEFAULT_INDICATOR_COLORS[kind],
        visible: true,
      };
      next.set(drawingsTargetPane, [...list, newInd]);
      return next;
    });
  }, [drawingsTargetPane]);
  const toggleIndicator = useCallback((id: string) => {
    setIndicatorsByPane((prev) => {
      const next = new Map(prev);
      const list = next.get(drawingsTargetPane) ?? [];
      next.set(drawingsTargetPane, list.map((i) => (i.id === id ? { ...i, visible: !i.visible } : i)));
      return next;
    });
  }, [drawingsTargetPane]);
  const changeIndicatorPeriod = useCallback((id: string, period: number) => {
    setIndicatorsByPane((prev) => {
      const next = new Map(prev);
      const list = next.get(drawingsTargetPane) ?? [];
      next.set(drawingsTargetPane, list.map((i) => (i.id === id ? { ...i, period } : i)));
      return next;
    });
  }, [drawingsTargetPane]);
  const removeIndicator = useCallback((id: string) => {
    setIndicatorsByPane((prev) => {
      const next = new Map(prev);
      const list = next.get(drawingsTargetPane) ?? [];
      next.set(drawingsTargetPane, list.filter((i) => i.id !== id));
      return next;
    });
  }, [drawingsTargetPane]);

  // ── Per-pane state (now owned by the markets store so OrderDetails +
  // Intelligence panels can follow the active pane). The store keeps the
  // authoritative array; ChartWorkspace just observes and dispatches
  // symbol/timeframe changes back into the store. ──
  const paneStates = useMarketsStore((s) => s.paneStates);
  const setPaneState = useMarketsStore((s) => s.setPaneState);
  const setPaneCount = useMarketsStore((s) => s.setPaneCount);

  // Screenshot — captures the active chart pane.
  const activeChartContainerRef = useRef<HTMLDivElement | null>(null);
  const handleScreenshot = useCallback(async () => {
    const container = activeChartContainerRef.current;
    if (!container) return;
    const pane = paneStates[drawingsTargetPane];
    const filename = `lucian-${pane?.symbol ?? "chart"}-${pane?.timeframe ?? ""}-${Date.now()}.png`;
    const result = await captureChartScreenshot(container, filename);
    if (!result.ok) {
      // Honest error — show a toast-like message via the store's toast.
      console.error("[markets] Screenshot failed:", result.error);
    }
  }, [paneStates, drawingsTargetPane]);

  // Resize paneStates when chartLayout changes.
  useEffect(() => {
    const count = PANE_COUNT[chartLayout];
    setPaneCount(count);
  }, [chartLayout, setPaneCount]);

  const pendingOrderPrice =
    pendingOrderPriceOverride !== undefined
      ? pendingOrderPriceOverride
      : internalPendingPrice;

  const handleSave = useCallback(() => {
    const ok = saveChartConfig({
      symbol: paneStates[0]?.symbol ?? "BTCUSD",
      timeframe: paneStates[0]?.timeframe ?? "M1",
      showBid: settings.showBid,
      showAsk: settings.showAsk,
      showMarketOrders: settings.showMarketOrders,
      showPendingOrders: settings.showPendingOrders,
      savedAt: Date.now(),
    });
    setSaveMessage(ok ? "Chart saved" : "Save failed");
    setTimeout(() => setSaveMessage(null), 1800);
  }, [settings, paneStates]);

  const handleLoad = useCallback(() => {
    const cfg = loadChartConfig();
    if (!cfg) {
      setSaveMessage("No saved chart found");
      setTimeout(() => setSaveMessage(null), 1800);
      return;
    }
    setPaneState(0, { symbol: cfg.symbol, timeframe: cfg.timeframe });
    update({
      showBid: cfg.showBid,
      showAsk: cfg.showAsk,
      showMarketOrders: cfg.showMarketOrders,
      showPendingOrders: cfg.showPendingOrders,
    });
    setSaveMessage("Chart loaded");
    setTimeout(() => setSaveMessage(null), 1800);
  }, [update, setPaneState]);

  return (
    <div className="themed flex h-full min-h-0 min-w-0 flex-1 flex-col bg-canvas">
      {/* ── Body: drawing rail + layout strip + chart panes ── */}
      <div className="relative flex min-h-0 flex-1">
        <DrawingRail
          selected={activeTool}
          onSelect={setActiveTool}
          onAction={(action) => {
            if (action === "indicators") {
              setIndicatorsPane(drawingsTargetPane);
              setObjectsPane(null);
            } else if (action === "objects") {
              setObjectsPane(drawingsTargetPane);
              setIndicatorsPane(null);
            } else if (action === "screenshot") {
              void handleScreenshot();
            } else if (action === "trash") {
              clearDrawings();
            }
          }}
        />

        {/* Layout strip — slim column with the Layout button at top.
            The popup opens to the right of this strip. */}
        <LayoutStrip
          popupOpen={layoutPopupOpen}
          onTogglePopup={() => setLayoutPopupOpen((v) => !v)}
          currentLayout={chartLayout}
          onSelectLayout={handleChartLayoutChange}
          onClosePopup={() => setLayoutPopupOpen(false)}
        />

        {/* Chart container fills the rest */}
        <div className="relative min-w-0 flex-1 bg-[#131722]">
          {/* Multi-pane chart layout — each pane has independent state.
              When maximized, only the maximized pane renders (full size). */}
          <ChartPaneGrid
            layout={chartLayout}
            paneStates={paneStates}
            onPaneSymbolChange={(index, symbol) =>
              setPaneState(index, { symbol })
            }
            onPaneTimeframeChange={(index, timeframe) =>
              setPaneState(index, { timeframe })
            }
            settings={settings}
            onToggleSettings={(key) =>
              update({ [key]: !settings[key] } as Partial<ChartSettings>)
            }
            onSave={handleSave}
            onLoad={handleLoad}
            saveMessage={saveMessage}
            pendingOrderPrice={pendingOrderPrice}
            onNewOrder={() => useMarketsStore.getState().setLeftPanelMode("order")}
            onQuickTrade={onQuickTrade}
            activeTool={activeTool}
            drawingsByPane={drawingsByPane}
            indicatorsByPane={indicatorsByPane}
            onAddDrawing={addDrawing}
            onUpdateDrawing={updateDrawing}
            maximizedPane={maximizedPane}
            onToggleMaximize={(idx) => setMaximizedPane((cur) => (cur === idx ? null : idx))}
            activeChartContainerRef={activeChartContainerRef}
          />

          {/* Phase 3: Indicators popover (positioned over the chart area) */}
          {indicatorsPane !== null && (
            <IndicatorsPopover
              indicators={indicatorsByPane.get(indicatorsPane) ?? []}
              onToggle={toggleIndicator}
              onPeriodChange={changeIndicatorPeriod}
              onAdd={addIndicator}
              onRemove={removeIndicator}
              onClose={() => setIndicatorsPane(null)}
            />
          )}
          {/* Phase 3: Objects panel */}
          {objectsPane !== null && (
            <ObjectsPanel
              drawings={drawingsByPane.get(objectsPane) ?? []}
              onToggleVisible={(id) => updateDrawing(id, { visible: !(drawingsByPane.get(objectsPane) ?? []).find((d) => d.id === id)?.visible })}
              onDelete={removeDrawing}
              onClearAll={clearDrawings}
              onClose={() => setObjectsPane(null)}
            />
          )}
        </div>
      </div>

      {/* ── Bottom trading strip + optional expanded panel ── */}
      <BottomPanel
        expanded={bottomExpanded}
        onToggleExpand={() => setBottomExpanded((v) => !v)}
        onPendingPriceChange={setInternalPendingPrice}
        onMaximize={() => setMaximizedPane((cur) => (cur === null ? activePaneIndex : null))}
        isMaximized={maximizedPane !== null}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Per-pane state type                                                 */
/* ------------------------------------------------------------------ */

// The local Timeframe type ("M1" | "M5" | … | "W") matches the store's
// LucianTimeframe type. We keep the local alias so we don't have to
// refactor every reference in this file.
type Timeframe = LucianTimeframe;

interface PaneState {
  symbol: string;
  timeframe: Timeframe;
}

/* ------------------------------------------------------------------ */
/* Layout strip — slim column with the Layout button                    */
/* ------------------------------------------------------------------ */

function LayoutStrip({
  popupOpen,
  onTogglePopup,
  currentLayout,
  onSelectLayout,
  onClosePopup,
}: {
  popupOpen: boolean;
  onTogglePopup: () => void;
  currentLayout: ChartLayout;
  onSelectLayout: (l: ChartLayout) => void;
  onClosePopup: () => void;
}) {
  return (
    <div
      className="relative flex w-7 shrink-0 flex-col items-center border-r themed"
      style={{ background: C_PANEL, borderColor: C_BORDER }}
    >
      <button
        type="button"
        title="Layout setup"
        aria-label="Layout setup"
        aria-expanded={popupOpen}
        onClick={onTogglePopup}
        className={cn(
          "flex h-7 w-7 items-center justify-center transition-colors",
          popupOpen
            ? "bg-[#2a2e39] text-white"
            : "text-[#787b86] hover:bg-[#2a2e39] hover:text-white",
        )}
      >
        <LayoutGrid className="h-4 w-4" />
      </button>

      {/* Popup opens to the right of this strip */}
      {popupOpen && (
        <LayoutSetupPopover
          className="absolute left-full top-0 ml-1"
          currentLayout={currentLayout}
          onSelect={onSelectLayout}
          onClose={onClosePopup}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chart pane — independent chart with compact header                  */
/* ------------------------------------------------------------------ */

function ChartPane({
  paneIndex,
  symbol,
  timeframe,
  onSymbolChange,
  onTimeframeChange,
  settings,
  onToggleSettings,
  settingsOpen,
  onToggleSettingsOpen,
  onSave,
  onLoad,
  saveMessage,
  pendingOrderPrice,
  onNewOrder,
  onQuickTrade,
  isPrimary,
  activeTool,
  drawings,
  indicators,
  onAddDrawing,
  onUpdateDrawing,
  isMaximized,
  onToggleMaximize,
  activeChartContainerRef,
}: {
  paneIndex: number;
  symbol: string;
  timeframe: Timeframe;
  onSymbolChange: (symbol: string) => void;
  onTimeframeChange: (tf: Timeframe) => void;
  settings: ChartSettings;
  onToggleSettings: (key: keyof ChartSettings) => void;
  settingsOpen: boolean;
  onToggleSettingsOpen: () => void;
  onSave: () => void;
  onLoad: () => void;
  saveMessage: string | null;
  pendingOrderPrice: number | null;
  onNewOrder: () => void;
  onQuickTrade?: (side: "buy" | "sell") => void;
  isPrimary: boolean;
  activeTool: string;
  drawings: Drawing[];
  indicators: IndicatorConfig[];
  onAddDrawing: (d: Drawing) => void;
  onUpdateDrawing: (id: string, patch: Partial<Drawing>) => void;
  isMaximized: boolean;
  onToggleMaximize: () => void;
  activeChartContainerRef?: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const [changeInstOpen, setChangeInstOpen] = useState(false);
  const inst = useMemo(
    () => getInstrumentBySymbol(symbol) ?? getInstrumentBySymbol("BTCUSD")!,
    [symbol],
  );

  // ── Live market state from the store ──
  // The store owns the WebSocket lifecycle for this (symbol, timeframe)
  // pair. We subscribe on mount and unsubscribe on cleanup so we never
  // leave duplicate streams running.
  const subscribePane = useMarketsStore((s) => s.subscribePane);
  const unsubscribePane = useMarketsStore((s) => s.unsubscribePane);
  const retryPane = useMarketsStore((s) => s.retryPane);
  const setActivePaneIndex = useMarketsStore((s) => s.setActivePaneIndex);
  const livePrice = useMarketsStore((s) => s.prices.get(symbol));
  const ticker = useMarketsStore((s) => s.tickers.get(symbol));
  const status = useMarketsStore(
    (s) => s.statusBySymbol.get(symbol) ?? (isSupportedCrypto(symbol) ? "live" : "setup-required"),
  );

  useEffect(() => {
    subscribePane(symbol, timeframe);
    return () => unsubscribePane(symbol, timeframe);
  }, [symbol, timeframe, subscribePane, unsubscribePane]);

  // Display prices: live ticker bid/ask → live trade price → catalog bid/ask.
  const sellPrice = ticker?.bidPrice ?? livePrice ?? inst.bid;
  const buyPrice = ticker?.askPrice ?? livePrice ?? inst.ask;
  const changePct = ticker?.priceChangePercent ?? inst.changePct;
  const chgColor = (changePct ?? 0) < 0 ? C_DOWN : C_UP;
  const chgText =
    changePct === null
      ? "0.00%"
      : `${(changePct ?? 0) >= 0 ? "+" : ""}${changePct!.toFixed(2)}%`;

  return (
    <div
      className="relative flex h-full w-full flex-col bg-[#131722]"
      onClick={() => setActivePaneIndex(paneIndex)}
    >
      {/* ── Compact header ── */}
      <div
        className="flex h-8 shrink-0 items-center gap-1 border-b px-2 themed"
        style={{ background: C_PANEL, borderColor: C_BORDER }}
      >
        {/* Instrument icon */}
        <InstrumentIcon
          symbol={inst.symbol}
          base={inst.base}
          assetClass={inst.assetClass}
          badge={inst.badge}
        />

        {/* Symbol + dropdown — opens Change Instrument popover */}
        <button
          type="button"
          aria-label={`Change instrument, current selection ${inst.symbol}`}
          aria-expanded={changeInstOpen}
          onClick={() => setChangeInstOpen((v) => !v)}
          className="flex items-center gap-0.5 rounded px-0.5 py-0.5 text-[11px] font-bold text-white transition-colors hover:bg-[#2a2e39]"
        >
          {inst.symbol}
          <ChevronDown className="h-2.5 w-2.5 text-[#787b86]" />
        </button>

        {/* Live status badge */}
        <LiveStatusBadge status={status} live={isSupportedCrypto(symbol)} />

        {/* Change% badge */}
        <span
          className="rounded px-1 py-0.5 text-[9px] font-bold text-white"
          style={{ background: chgColor }}
        >
          {chgText}
        </span>

        {/* Compact timeframe selector — all 8 TFs inline (M1/M5/M15/M30/H1/H4/D1/W).
            Phase 3: previously only the first 4 were exposed; now all 8 are
            available so the user can switch to any provider-supported interval. */}
        <div
          className="ml-1 flex items-center gap-0.5 rounded p-0.5"
          style={{ background: "#2a2e39" }}
        >
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => onTimeframeChange(tf)}
              title={TIMEFRAME_LABELS[tf]}
              className={cn(
                "rounded px-1 py-0.5 text-[9px] font-medium transition-colors",
                timeframe === tf
                  ? "bg-[#363a45] text-white"
                  : "text-[#787b86] hover:text-white",
              )}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* New order button */}
        <button
          type="button"
          onClick={onNewOrder}
          className="ml-auto flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold text-white transition-colors hover:opacity-90"
          style={{ background: C_BLUE }}
        >
          <Plus className="h-2.5 w-2.5" />
          New order
        </button>

        {/* Maximize / restore — Phase 3. */}
        <button
          type="button"
          title={isMaximized ? "Restore (Esc)" : "Maximize pane"}
          aria-label={isMaximized ? "Restore" : "Maximize"}
          onClick={onToggleMaximize}
          className="flex h-5 w-5 items-center justify-center rounded text-[#787b86] transition-colors hover:bg-[#2a2e39] hover:text-white"
        >
          {isMaximized ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <Maximize2 className="h-3 w-3" />
          )}
        </button>

        {/* Settings gear */}
        <button
          type="button"
          title="Chart settings"
          aria-label="Chart settings"
          aria-expanded={settingsOpen}
          onClick={onToggleSettingsOpen}
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded transition-colors",
            settingsOpen
              ? "bg-[#2a2e39] text-white"
              : "text-[#787b86] hover:bg-[#2a2e39] hover:text-white",
          )}
        >
          <Settings className="h-3 w-3" />
        </button>
      </div>

      {/* ── Chart body ── */}
      <div className="relative min-h-0 flex-1">
        <CandleChart
          timeframe={timeframe}
          symbol={symbol}
          settings={isPrimary ? settings : { ...settings, showBid: false, showAsk: false }}
          bidPrice={sellPrice}
          askPrice={buyPrice}
          pendingOrderPrice={isPrimary ? pendingOrderPrice : null}
          status={status}
          onRetry={() => retryPane(symbol, timeframe)}
          activeTool={activeTool}
          drawings={drawings}
          indicators={indicators}
          onAddDrawing={onAddDrawing}
          onUpdateDrawing={onUpdateDrawing}
          containerRef={activeChartContainerRef}
        />

        {/* Compact Sell/Buy overlay — upper-left */}
        <CompactQuickTrade
          sellPrice={sellPrice}
          buyPrice={buyPrice}
          onQuickTrade={onQuickTrade}
        />

        {/* Change instrument popover */}
        {changeInstOpen && (
          <ChangeInstrumentPopover
            currentSymbol={symbol}
            onSelect={(s) => {
              onSymbolChange(s);
              setChangeInstOpen(false);
            }}
            onClose={() => setChangeInstOpen(false)}
          />
        )}

        {/* Chart settings popover (shared global settings) */}
        {settingsOpen && (
          <ChartSettingsPopover
            settings={settings}
            onToggle={onToggleSettings}
            onSave={onSave}
            onLoad={onLoad}
            onClose={onToggleSettingsOpen}
            message={saveMessage}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Live status badge — small colored pill next to the symbol that tells
   the user whether the chart is showing LIVE provider data, reference
   catalog prices, or live data that has gone temporarily unavailable. */
/* ------------------------------------------------------------------ */

function LiveStatusBadge({
  status,
  live,
}: {
  status: DataStatus;
  live: boolean;
}) {
  if (!live) {
    return (
      <span
        title="No live provider — showing reference catalog prices"
        className="rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[#9ea3ab] border border-[#363a45]"
      >
        Reference
      </span>
    );
  }
  switch (status) {
    case "live":
      return (
        <span
          title="Live — provider connected"
          className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[#4bfa8f] border border-[#4bfa8f]/40"
        >
          <span className="h-1 w-1 rounded-full bg-[#4bfa8f]" />
          Live
        </span>
      );
    case "delayed":
      return (
        <span
          title="Delayed data"
          className="rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[#f5a623] border border-[#f5a623]/40"
        >
          Delayed
        </span>
      );
    case "disconnected":
      return (
        <span
          title="Live data temporarily unavailable — previous candles shown"
          className="rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[#ff5b5b] border border-[#ff5b5b]/40"
        >
          Unavailable
        </span>
      );
    case "setup-required":
    default:
      return (
        <span
          title="Provider setup required"
          className="rounded px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[#9ea3ab] border border-[#363a45]"
        >
          Setup
        </span>
      );
  }
}

/* ------------------------------------------------------------------ */
/* Compact Sell/Buy block (per-pane overlay)                          */
/* ------------------------------------------------------------------ */

function CompactQuickTrade({
  sellPrice,
  buyPrice,
  onQuickTrade,
}: {
  sellPrice: number;
  buyPrice: number;
  onQuickTrade?: (side: "buy" | "sell") => void;
}) {
  const [size, setSize] = useState(0.01);
  return (
    <div className="pointer-events-none absolute left-1.5 top-1.5 z-10">
      <div
        className="pointer-events-auto flex overflow-hidden rounded text-[9px] font-bold text-white shadow-md"
        style={{ background: C_PANEL, border: `1px solid ${C_BORDER}` }}
      >
        {/* Sell — opens OrderDetails with preselected "sell" side.
            Does NOT immediately place a trade (per Phase 3 spec: "Do not
            immediately place a trade with hidden/default volume unless
            the existing UI very clearly supports one-click trading"). */}
        <button
          type="button"
          title="Open order panel to place a SELL"
          onClick={() => onQuickTrade?.("sell")}
          className="flex flex-col items-center justify-center px-1.5 py-1 transition-opacity hover:opacity-90"
          style={{ background: C_DOWN }}
        >
          <span className="text-[7px] uppercase opacity-90">Sell</span>
          <span className="font-mono text-[10px] tabular-nums">{sellPrice.toFixed(5)}</span>
        </button>

        {/* Size controls — kept visible so the trader sees the current
            default volume, but the actual trade placement happens in
            OrderDetailsPanel where the spec-aware margin + risk checks run. */}
        <div className="flex flex-col items-center justify-center px-1 py-1">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-label="Decrease order size"
              onClick={() => setSize((s) => Math.max(0.01, +(s - 0.01).toFixed(2)))}
              className="flex h-4 w-4 items-center justify-center rounded text-[#787b86] hover:bg-[#2a2e39] hover:text-white"
            >
              <Minus className="h-2.5 w-2.5" />
            </button>
            <span className="w-7 text-center font-mono text-[10px] tabular-nums text-white">
              {size.toFixed(2)}
            </span>
            <button
              type="button"
              aria-label="Increase order size"
              onClick={() => setSize((s) => +(s + 0.01).toFixed(2))}
              className="flex h-4 w-4 items-center justify-center rounded text-[#787b86] hover:bg-[#2a2e39] hover:text-white"
            >
              <Plus className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>

        {/* Buy — opens OrderDetails with preselected "buy" side. */}
        <button
          type="button"
          aria-label="Close instrument selector"
          title="Open order panel to place a BUY"
          onClick={() => onQuickTrade?.("buy")}
          className="flex flex-col items-center justify-center px-1.5 py-1 transition-opacity hover:opacity-90"
          style={{ background: C_UP }}
        >
          <span className="text-[7px] uppercase opacity-90">Buy</span>
          <span className="font-mono text-[10px] tabular-nums">{buyPrice.toFixed(5)}</span>
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Change Instrument popover (per-pane)                                */
/* ------------------------------------------------------------------ */

function ChangeInstrumentPopover({
  currentSymbol,
  onSelect,
  onClose,
}: {
  currentSymbol: string;
  onSelect: (symbol: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const { favorites, toggle } = useFavorites();

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!e.composedPath().includes(rootRef.current)) onClose();
    };
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  const visible = useMemo(() => {
    if (!search.trim()) return INSTRUMENT_CATALOG;
    const q = search.toLowerCase();
    return INSTRUMENT_CATALOG.filter(
      (i) =>
        i.symbol.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q),
    );
  }, [search]);

  return (
    <div
      ref={rootRef}
      className="absolute left-1.5 top-1.5 z-40 flex max-h-[300px] w-[200px] flex-col overflow-hidden rounded-md shadow-xl themed"
      style={{
        background: "#1e1e2d",
        border: "1px solid #2a2a3c",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pb-1.5 pt-2">
        <span className="text-[11px] font-semibold text-white">Change instrument</span>
        <button
          type="button"
          aria-label="Close instrument selector"
          onClick={onClose}
          className="text-fg-faint hover:text-fg"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Search */}
      <div className="px-2 pb-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-1.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-fg-faint" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="h-6 w-full rounded bg-surface-2 pl-6 pr-2 text-[10px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)] themed"
          />
        </div>
      </div>

      {/* Scrollable list */}
      <div className="min-h-0 flex-1 overflow-y-auto themed">
        {visible.map((inst) => {
          const isFav = favorites.has(inst.symbol);
          const isCurrent = inst.symbol === currentSymbol;
          return (
            <button
              key={inst.symbol}
              type="button"
              aria-label={`Select ${inst.symbol}`}
              aria-pressed={isCurrent}
              onClick={() => onSelect(inst.symbol)}
              className={cn(
                "flex w-full items-center gap-2 px-2 py-1.5 text-left text-[10px] transition-colors themed",
                isCurrent
                  ? "bg-active text-fg"
                  : "text-[#c4cbde] hover:bg-[#2a2a3c] hover:text-white",
              )}
            >
              <InstrumentIcon
                symbol={inst.symbol}
                base={inst.base}
                assetClass={inst.assetClass}
                badge={inst.badge}
              />
              <span className="flex-1 truncate font-medium">{inst.symbol}</span>
              <span
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(inst.symbol);
                }}
                className="flex h-4 w-4 items-center justify-center"
              >
                <Star
                  className={cn(
                    "h-2.5 w-2.5 transition-colors",
                    isFav
                      ? "fill-[var(--accent)] text-[var(--accent)]"
                      : "text-fg-faint hover:text-fg",
                  )}
                />
              </span>
            </button>
          );
        })}
        {visible.length === 0 && (
          <div className="px-3 py-4 text-center text-[10px] text-fg-faint">
            No instruments found.
          </div>
        )}
      </div>
    </div>
  );
}

function Separator() {
  return <div className="h-4 w-px" style={{ background: C_BORDER }} />;
}

/* ------------------------------------------------------------------ */
/* Chart Settings popover                                              */
/* ------------------------------------------------------------------ */

function ChartSettingsPopover({
  settings,
  onToggle,
  onSave,
  onLoad,
  onClose,
  message,
}: {
  settings: ChartSettings;
  onToggle: (key: keyof ChartSettings) => void;
  onSave: () => void;
  onLoad: () => void;
  onClose: () => void;
  message: string | null;
}) {
  // Close on outside click + Escape key.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handlePointer = (e: MouseEvent) => {
      if (!rootRef.current) return;
      // Use composedPath so clicks inside shadow DOM or chart canvas
      // are correctly detected as "outside" the popover.
      if (!e.composedPath().includes(rootRef.current)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Defer attaching by one tick so the click that opened the popover
    // doesn't immediately close it.
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
      className="absolute right-3 top-3 z-30 w-[230px] overflow-hidden rounded-md shadow-xl themed"
      style={{
        background: "#1e1e2d",
        border: "1px solid #2a2a3c",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
      }}
    >
      {/* Header */}
      <div className="px-4 pb-2 pt-3">
        <span className="text-[13px] font-semibold text-white">Chart settings</span>
      </div>

      {/* Save / Load rows */}
      <div className="pb-1">
        <SettingsRow icon={Save} label="Save current chart" onClick={onSave} />
        <SettingsRow icon={FolderOpen} label="Load saved chart" onClick={onLoad} />
      </div>

      {/* Divider */}
      <div className="mx-4 my-1 h-px" style={{ background: "#2e2e3e" }} />

      {/* Subheading */}
      <div className="px-4 pb-1 pt-1">
        <span className="text-[11px] text-[#8a8a9a]">
          Select the trading tools you want to view.
        </span>
      </div>

      {/* Checkbox rows */}
      <div className="pb-2">
        <CheckRow
          label="Show Bid price"
          checked={settings.showBid}
          onChange={() => onToggle("showBid")}
        />
        <CheckRow
          label="Show Ask price"
          checked={settings.showAsk}
          onChange={() => onToggle("showAsk")}
        />
        <CheckRow
          label="Show Market orders"
          checked={settings.showMarketOrders}
          onChange={() => onToggle("showMarketOrders")}
        />
        <CheckRow
          label="Show Pending orders"
          checked={settings.showPendingOrders}
          onChange={() => onToggle("showPendingOrders")}
        />
      </div>

      {/* Optional transient message (Save/Load feedback) */}
      {message && (
        <div className="border-t px-4 py-1.5 text-[10px] text-[#8a8a9a]" style={{ borderColor: "#2e2e3e" }}>
          {message}
        </div>
      )}
    </div>
  );
}

function SettingsRow({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Save;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-[12px] text-[#e0e0e0] transition-colors hover:bg-[#2a2a3c]"
    >
      <Icon className="h-3.5 w-3.5 text-[#8a8a9a]" />
      <span>{label}</span>
    </button>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className="flex cursor-pointer items-center justify-between px-4 py-2 transition-colors hover:bg-[#252535]"
    >
      <span className="flex items-center gap-1.5 text-[12px] text-[#e0e0e0]">
        {label}
        <HelpCircle className="h-3 w-3 text-[#6a6a7a]" />
      </span>
      <button
        type="button"
        role="checkbox"
        aria-label={label}
        aria-checked={checked}
        onClick={onChange}
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded transition-colors",
          checked
            ? "border-0 bg-[#4b9eff] text-white"
            : "border border-[#3a3a4c] bg-[#2a2a3c] text-transparent",
        )}
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </button>
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Chart layout popover + multi-pane grid                              */
/* ------------------------------------------------------------------ */

function LayoutSetupPopover({
  currentLayout,
  onSelect,
  onClose,
  className,
}: {
  currentLayout: ChartLayout;
  onSelect: (l: ChartLayout) => void;
  onClose: () => void;
  className?: string;
}) {
  // Close on outside click + Escape key.
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
      className={cn(
        "z-30 w-[220px] overflow-hidden rounded-md shadow-xl themed",
        className,
      )}
      style={{
        background: "#1e1e2d",
        border: "1px solid #2a2a3c",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <span className="text-[13px] font-semibold text-white">Layout setup</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close layout popup"
          title="Close"
          className="text-fg-faint transition-colors hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Layout option rows */}
      <div className="pb-2">
        {LAYOUT_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = currentLayout === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onSelect(opt.id)}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-2 text-left text-[12px] transition-colors themed",
                active
                  ? "text-[var(--accent)]"
                  : "text-[#c4cbde] hover:bg-[#2a2a3c] hover:text-white",
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4",
                  active ? "text-[var(--accent)]" : "text-[#787b86]",
                )}
              />
              <span className="font-medium">{opt.label}</span>
              {active && (
                <Check
                  className="ml-auto h-3 w-3 text-[var(--accent)]"
                  strokeWidth={3}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Renders N independent chart panes arranged according to the selected
    layout. Each pane has its own symbol, timeframe, compact header,
    QuickTrade overlay, and Change Instrument popover. */
function ChartPaneGrid({
  layout,
  paneStates,
  onPaneSymbolChange,
  onPaneTimeframeChange,
  settings,
  onToggleSettings,
  onSave,
  onLoad,
  saveMessage,
  pendingOrderPrice,
  onNewOrder,
  onQuickTrade,
  activeTool,
  drawingsByPane,
  indicatorsByPane,
  onAddDrawing,
  onUpdateDrawing,
  maximizedPane,
  onToggleMaximize,
  activeChartContainerRef,
}: {
  layout: ChartLayout;
  paneStates: PaneState[];
  onPaneSymbolChange: (index: number, symbol: string) => void;
  onPaneTimeframeChange: (index: number, tf: Timeframe) => void;
  settings: ChartSettings;
  onToggleSettings: (key: keyof ChartSettings) => void;
  onSave: () => void;
  onLoad: () => void;
  saveMessage: string | null;
  pendingOrderPrice: number | null;
  onNewOrder: () => void;
  onQuickTrade?: (side: "buy" | "sell") => void;
  activeTool: string;
  drawingsByPane: Map<number, Drawing[]>;
  indicatorsByPane: Map<number, IndicatorConfig[]>;
  onAddDrawing: (d: Drawing) => void;
  onUpdateDrawing: (id: string, patch: Partial<Drawing>) => void;
  maximizedPane: number | null;
  onToggleMaximize: (idx: number) => void;
  activeChartContainerRef: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const meta = LAYOUT_OPTIONS.find((o) => o.id === layout)!;
  const paneCount = PANE_COUNT[layout];
  const [settingsPane, setSettingsPane] = useState<number | null>(null);

  // Build the grid template.
  const gridStyle: React.CSSProperties =
    layout === "triple"
      ? {
          gridTemplateColumns: "1.4fr 1fr",
          gridTemplateRows: "1fr 1fr",
        }
      : {
          gridTemplateColumns: `repeat(${meta.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${meta.rows}, minmax(0, 1fr))`,
        };

  return (
    <div
      className="grid h-full w-full"
      style={{
        ...gridStyle,
        background: "#131722",
        gap: "1px",
      }}
    >
      {Array.from({ length: paneCount }).map((_, i) => {
        const isPrimary = i === 0;
        const cellStyle: React.CSSProperties =
          layout === "triple" && i === 0
            ? { gridColumn: "1", gridRow: "1 / span 2" }
            : {};
        const paneState = paneStates[i] ?? { symbol: "BTCUSD", timeframe: "M1" as Timeframe };
        // When a pane is maximized, hide all other panes.
        if (maximizedPane !== null && maximizedPane !== i) return null;
        return (
          <div
            key={i}
            className="relative min-w-0 overflow-hidden bg-[#131722]"
            style={
              maximizedPane === i
                ? { gridColumn: "1 / -1", gridRow: "1 / -1" }
                : cellStyle
            }
          >
            <ChartPane
              paneIndex={i}
              symbol={paneState.symbol}
              timeframe={paneState.timeframe}
              onSymbolChange={(s) => onPaneSymbolChange(i, s)}
              onTimeframeChange={(tf) => onPaneTimeframeChange(i, tf)}
              settings={settings}
              onToggleSettings={onToggleSettings}
              settingsOpen={settingsPane === i}
              onToggleSettingsOpen={() =>
                setSettingsPane((prev) => (prev === i ? null : i))
              }
              onSave={onSave}
              onLoad={onLoad}
              saveMessage={saveMessage}
              pendingOrderPrice={isPrimary ? pendingOrderPrice : null}
              onNewOrder={onNewOrder}
              onQuickTrade={onQuickTrade}
              isPrimary={isPrimary}
              activeTool={activeTool}
              drawings={drawingsByPane.get(i) ?? []}
              indicators={indicatorsByPane.get(i) ?? []}
              onAddDrawing={onAddDrawing}
              onUpdateDrawing={onUpdateDrawing}
              isMaximized={maximizedPane === i}
              onToggleMaximize={() => onToggleMaximize(i)}
              activeChartContainerRef={isPrimary ? activeChartContainerRef : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drawing rail (left vertical chart toolbar)                          */
/* ------------------------------------------------------------------ */

interface RailTool {
  /** Stable ID — also used as the cursor/drawing mode key. */
  id: string;
  /** Lucide icon component. */
  icon: typeof MousePointer2;
  /** Tooltip label. */
  label: string;
  /** If present, clicking this tool opens a popup with these variants.
      The first variant is the default sub-tool. */
  variants?: { id: string; label: string; icon: typeof MousePointer2 }[];
}

// Phase 3: the rail was audited and trimmed to only the tools that
// actually work. Removed dead tools: measure, brush, pencil, ai-assistant,
// visibility, magnet, zoom, fibonacci (parent + all 3 variants), and the
// trend-line variants extended-line / arrow / ray / path. The remaining
// tools all have real implementations in DrawingsOverlay or trigger real
// actions via onAction.
const RAIL_GROUPS: RailTool[][] = [
  /* Group 1 — selection */
  [
    { id: "cursor", icon: MousePointer2, label: "Cursor" },
    { id: "crosshair", icon: Crosshair, label: "Crosshair" },
  ],
  /* Group 2 — line tools (opens Trend Lines popup) */
  [
    {
      id: "trend-line",
      icon: TrendingUp,
      label: "Trend Lines",
      variants: [
        { id: "trend-line", label: "Trend Line", icon: TrendingUp },
        { id: "horizontal-line", label: "Horizontal Line", icon: HorizontalLine },
        { id: "vertical-line", label: "Vertical Line", icon: VerticalLine },
      ],
    },
    { id: "horizontal-line", icon: HorizontalLine, label: "Horizontal Line" },
    { id: "vertical-line", icon: VerticalLine, label: "Vertical Line" },
  ],
  /* Group 3 — shapes */
  [
    { id: "rectangle", icon: Square, label: "Rectangle" },
  ],
  /* Group 4 — annotation */
  [
    { id: "text", icon: TypeIcon, label: "Text" },
  ],
  /* Group 5 — indicators + objects + capture + settings (actions) */
  [
    { id: "indicators", icon: Calculator, label: "Indicators" },
    { id: "objects", icon: Layers, label: "Objects" },
    { id: "screenshot", icon: Camera, label: "Screenshot" },
    { id: "trash", icon: Trash2, label: "Remove drawings" },
  ],
];

function DrawingRail({
  selected,
  onSelect,
  onAction,
}: {
  selected: string;
  onSelect: (id: string) => void;
  /** Phase 3: action buttons (indicators / objects / screenshot / trash)
   *  call this instead of `onSelect` because they don't select a drawing
   *  tool — they trigger a one-shot action. */
  onAction?: (action: "indicators" | "objects" | "screenshot" | "trash") => void;
}) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  // Close the open menu on outside click or Escape.
  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent) => {
      if (!railRef.current) return;
      if (!e.composedPath().includes(railRef.current)) setOpenMenu(null);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpenMenu(null);
        onSelect("cursor");
      }
    };
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", handler);
      document.addEventListener("keydown", keyHandler);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [openMenu, onSelect]);

  return (
    <div
      ref={railRef}
      className="relative flex w-9 shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r py-1 themed"
      style={{ background: C_PANEL, borderColor: C_BORDER }}
    >
      {RAIL_GROUPS.map((group, gi) => (
        <div key={gi} className="flex flex-col items-center gap-0.5">
          {group.map((tool) => {
            const isAction = ["indicators", "objects", "screenshot", "trash"].includes(tool.id);
            return (
              <RailButton
                key={tool.id}
                tool={tool}
                active={selected === tool.id}
                menuOpen={openMenu === tool.id}
                onClick={() => {
                  if (isAction) {
                    // Action buttons trigger a one-shot callback.
                    onAction?.(tool.id as "indicators" | "objects" | "screenshot" | "trash");
                    return;
                  }
                  if (tool.variants) {
                    setOpenMenu((prev) => (prev === tool.id ? null : tool.id));
                  }
                  onSelect(tool.id);
                }}
                onVariantSelect={(variantId) => {
                  onSelect(variantId);
                  setOpenMenu(null);
                }}
              />
            );
          })}
          {gi < RAIL_GROUPS.length - 1 && (
            <div className="my-1 h-px w-5" style={{ background: C_BORDER }} />
          )}
        </div>
      ))}
    </div>
  );
}

function RailButton({
  tool,
  active,
  menuOpen,
  onClick,
  onVariantSelect,
}: {
  tool: RailTool;
  active: boolean;
  menuOpen: boolean;
  onClick: () => void;
  onVariantSelect: (variantId: string) => void;
}) {
  const Icon = tool.icon;
  return (
    <div className="relative">
      <button
        type="button"
        title={tool.label}
        aria-label={tool.label}
        onClick={onClick}
        className={cn(
          "relative flex h-7 w-7 items-center justify-center rounded transition-colors",
          active
            ? "text-white"
            : "text-[#787b86] hover:bg-[#2a2e39] hover:text-white",
        )}
        style={active ? { background: "#2a2e39" } : undefined}
      >
        {active && (
          <span
            aria-hidden
            className="absolute left-[-4px] top-0 h-full w-[3px] rounded-r"
            style={{ background: C_ACTIVE_TOOL }}
          />
        )}
        <Icon className="h-[18px] w-[18px]" />
        {tool.variants && (
          <ChevronDown
            className="absolute -right-0.5 -bottom-0.5 h-2 w-2 text-[#787b86]"
            style={{ transform: menuOpen ? "rotate(180deg)" : undefined }}
          />
        )}
      </button>
      {/* Tool menu popup — opens to the right of the rail */}
      {tool.variants && menuOpen && (
        <ToolMenuPopup
          title={tool.label}
          variants={tool.variants}
          selectedId={active ? tool.id : undefined}
          onSelect={onVariantSelect}
        />
      )}
    </div>
  );
}

function ToolMenuPopup({
  title,
  variants,
  selectedId,
  onSelect,
}: {
  title: string;
  variants: { id: string; label: string; icon: typeof MousePointer2 }[];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      className="absolute left-full top-0 z-30 ml-1 w-[180px] overflow-hidden rounded-md shadow-xl themed"
      style={{
        background: "#1e1e2d",
        border: "1px solid #2a2a3c",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 pb-1.5 pt-2">
        <span className="text-[11px] font-semibold text-white">{title}</span>
      </div>
      {/* Variants list */}
      <div className="max-h-[280px] overflow-y-auto pb-1">
        {variants.map((v) => {
          const Icon = v.icon;
          const isActive = v.id === selectedId;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => onSelect(v.id)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors themed",
                isActive
                  ? "bg-active text-[var(--accent)]"
                  : "text-[#c4cbde] hover:bg-[#2a2a3c] hover:text-white",
              )}
            >
              <Icon
                className={cn(
                  "h-3 w-3",
                  isActive ? "text-[var(--accent)]" : "text-[#787b86]",
                )}
              />
              <span className="flex-1">{v.label}</span>
              {isActive && <Check className="h-3 w-3 text-[var(--accent)]" strokeWidth={3} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Candlestick chart (lightweight-charts)                              */
/* ------------------------------------------------------------------ */

function CandleChart({
  timeframe,
  symbol,
  settings,
  bidPrice,
  askPrice,
  pendingOrderPrice,
  status,
  onRetry,
  activeTool,
  drawings,
  indicators,
  onAddDrawing,
  onUpdateDrawing,
  containerRef: externalContainerRef,
}: {
  timeframe: Timeframe;
  symbol: string;
  settings: ChartSettings;
  bidPrice: number;
  askPrice: number;
  pendingOrderPrice: number | null;
  status: DataStatus;
  onRetry: () => void;
  activeTool: string;
  drawings: Drawing[];
  indicators: IndicatorConfig[];
  onAddDrawing: (d: Drawing) => void;
  onUpdateDrawing: (id: string, patch: Partial<Drawing>) => void;
  /** External ref the parent uses for screenshot capture. */
  containerRef?: React.MutableRefObject<HTMLDivElement | null>;
}) {
  const internalContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = externalContainerRef ?? internalContainerRef;
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const bidLineRef = useRef<IPriceLine | null>(null);
  const askLineRef = useRef<IPriceLine | null>(null);
  const pendingLineRef = useRef<IPriceLine | null>(null);
  // chartCoord — exposes the chart's coordinate converter to the
  // DrawingsOverlay + IndicatorLines. Updated whenever the chart is
  // created or candles change.
  const [chartCoord, setChartCoord] = useState<ChartCoord | null>(null);

  // Build a chartCoord object from the current chart instance.
  // The function body is defined INSIDE the chart-creation effect below
  // (as a local closure over chart/series/container) — this avoids both
  // the React 19 preserve-manual-memoization warning (useCallback wrapping
  // a function that reads mutable refs cannot be preserved by the
  // compiler) AND the set-state-in-effect warning when called from the
  // ResizeObserver callback.

  // Live candles come from the markets store. The store's `subscribePane`
  // (called by ChartPane) owns the WebSocket + initial historical fetch.
  // For non-crypto (no provider), we generate reference candles from the
  // catalog snapshot — these are honestly labeled "REFERENCE" by the
  // header badge and never presented as live.
  const paneKeyStr = paneKey(symbol, timeframe);
  const liveCandles = useMarketsStore((s) => s.candlesByKey.get(paneKeyStr));
  const midPrice = useMemo(() => (bidPrice + askPrice) / 2, [bidPrice, askPrice]);

  const candles: CandlestickData<UTCTimestamp>[] = useMemo(() => {
    if (liveCandles && liveCandles.length > 0) {
      return liveCandles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
    }
    // Non-crypto OR crypto before first data arrives: reference candles.
    // For crypto, this branch only briefly fills the gap before the live
    // history fetch lands; the moment Bybit responds, the store
    // replaces the candles and we re-render with real data.
    if (isSupportedCrypto(symbol)) {
      // Crypto with no candles yet + disconnected status = DON'T fabricate.
      // Render an empty array; the unavailable overlay below takes over.
      if (status === "disconnected") return [];
      // Otherwise show reference candles as a "loading" placeholder.
      return generateReferenceCandles(timeframe, 120, midPrice, symbol);
    }
    return generateReferenceCandles(timeframe, 120, midPrice, symbol);
  }, [liveCandles, midPrice, symbol, timeframe, status]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: C_BG },
        textColor: C_TEXT,
        fontSize: 10,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      },
      grid: {
        vertLines: { color: C_GRID },
        horzLines: { color: C_GRID },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#363a45", width: 1, style: 2, labelBackgroundColor: "#363a45" },
        horzLine: { color: "#363a45", width: 1, style: 2, labelBackgroundColor: "#363a45" },
      },
      rightPriceScale: {
        borderColor: C_BORDER,
      },
      timeScale: {
        borderColor: C_BORDER,
        timeVisible: true,
        secondsVisible: false,
      },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });
    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: C_UP,
      downColor: C_DOWN,
      borderUpColor: C_UP,
      borderDownColor: C_DOWN,
      wickUpColor: C_UP,
      wickDownColor: C_DOWN,
    });
    seriesRef.current = series;
    series.setData(candles);

    // Local closure: builds a chartCoord snapshot from the chart + series
    // + container that exist inside this effect's scope. Avoids tripping
    // preserve-manual-memoization (no useCallback wrapper needed).
    const buildChartCoord = (): ChartCoord | null => {
      const container = containerRef.current;
      if (!container) return null;
      const w = container.clientWidth;
      const h = container.clientHeight;
      return {
        timePriceToXY: (time: number, price: number) => {
          try {
            const ts = time as UTCTimestamp;
            const x = chart.timeScale().timeToCoordinate(ts);
            const y = series.priceToCoordinate(price);
            if (x === null || y === null || x === undefined || y === undefined) return null;
            return { x, y };
          } catch {
            return null;
          }
        },
        xyToTimePrice: (x: number, y: number) => {
          try {
            const time = chart.timeScale().coordinateToTime(x);
            const price = series.coordinateToPrice(y);
            if (time === null || price === null || time === undefined || price === undefined) return null;
            return { time: time as number, price };
          } catch {
            return null;
          }
        },
        width: w,
        height: h,
      };
    };

    // Resize observer keeps the chart filling its container
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      chart.resize(e.contentRect.width, e.contentRect.height);
      // Update chartCoord dimensions on resize so drawings/indicators
      // stay aligned after the chart is resized. setState is called
      // inside the ResizeObserver async callback — not synchronously
      // inside the effect body.
      setChartCoord(buildChartCoord());
    });
    ro.observe(containerRef.current);

    // Build the initial chartCoord now that the chart exists. Deferred
    // to a microtask to avoid synchronous setState in the effect body.
    const initId = window.setTimeout(() => setChartCoord(buildChartCoord()), 0);

    return () => {
      window.clearTimeout(initId);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      bidLineRef.current = null;
      askLineRef.current = null;
      pendingLineRef.current = null;
      setChartCoord(null);
    };
  }, [candles, containerRef]);

  // Live candle updates — when the store's kline WS pushes a new candle
  // we patch the forming candle in place instead of recreating the chart.
  const lastCandle = liveCandles?.[liveCandles.length - 1];
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !lastCandle) return;
    series.update({
      time: lastCandle.time as UTCTimestamp,
      open: lastCandle.open,
      high: lastCandle.high,
      low: lastCandle.low,
      close: lastCandle.close,
    });
  }, [lastCandle]);

  // Sync Bid price line with settings.showBid.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    if (bidLineRef.current) {
      series.removePriceLine(bidLineRef.current);
      bidLineRef.current = null;
    }

    if (settings.showBid) {
      bidLineRef.current = series.createPriceLine({
        price: bidPrice,
        color: C_DOWN,
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title: "Bid",
      });
    }
  }, [settings.showBid, bidPrice, candles]);

  // Sync Ask price line with settings.showAsk.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    if (askLineRef.current) {
      series.removePriceLine(askLineRef.current);
      askLineRef.current = null;
    }

    if (settings.showAsk) {
      askLineRef.current = series.createPriceLine({
        price: askPrice,
        color: C_UP,
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title: "Ask",
      });
    }
  }, [settings.showAsk, askPrice, candles]);

  // Sync pending-order price line.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    if (pendingLineRef.current) {
      series.removePriceLine(pendingLineRef.current);
      pendingLineRef.current = null;
    }

    if (pendingOrderPrice !== null && Number.isFinite(pendingOrderPrice)) {
      pendingLineRef.current = series.createPriceLine({
        price: pendingOrderPrice,
        color: "#7c3aed", // purple — matches the rail active-tool color
        lineWidth: 1,
        lineStyle: 0, // solid
        axisLabelVisible: true,
        title: "Pending order",
      });
    }
  }, [pendingOrderPrice, candles]);

  // Fit content when candles change
  useEffect(() => {
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // ── Bybit failure overlay ──
  // When the live provider is disconnected AND there are no cached
  // candles to show, we render an honest "Live Market Data Temporarily
  // Unavailable" overlay with a Retry button instead of fabricating
  // synthetic candles. If we still have valid cached candles, we keep
  // them visible but mark the chart as stale via the header badge
  // (handled by LiveStatusBadge in the parent ChartPane).
  const showUnavailableOverlay =
    isSupportedCrypto(symbol) &&
    status === "disconnected" &&
    (!liveCandles || liveCandles.length === 0);

  return (
    <div className="absolute inset-0 h-full w-full">
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />
      {/* Phase 3: indicator lines (SVG over the chart). Rendered BELOW
          drawings so drawings appear on top. */}
      <IndicatorLines
        candles={liveCandles ?? []}
        indicators={indicators}
        chartCoord={chartCoord}
      />
      {/* Phase 3: drawings overlay (SVG over the chart). Captures mouse
          events only when a drawing tool is active; otherwise passes
          through to the chart. */}
      <DrawingsOverlay
        drawings={drawings}
        activeTool={activeTool}
        onAddDrawing={onAddDrawing}
        onUpdateDrawing={onUpdateDrawing}
        chartCoord={chartCoord}
      />
      {showUnavailableOverlay && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#131722]/95">
          <div className="max-w-xs rounded border border-[#ff5b5b]/30 bg-[#1a1f2c] px-4 py-3 text-center">
            <div className="mb-1 text-[11px] font-semibold text-[#ff5b5b]">
              Live Market Data Temporarily Unavailable
            </div>
            <div className="mb-3 text-[10px] text-[#787b86]">
              Bybit market data could not be reached for {symbol} {timeframe}.
              Previous candles are not available.
            </div>
            <button
              type="button"
              onClick={onRetry}
              className="rounded bg-[#2962ff] px-3 py-1.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Generate reference candles for non-crypto symbols using catalog snapshot prices.
    These are NOT live data — they are based on the static reference snapshot
    in the instrument catalog. Crypto symbols use real Bybit V5 data instead. */
function generateReferenceCandles(
  timeframe: Timeframe,
  count: number,
  midPrice: number,
  symbol: string,
): CandlestickData<UTCTimestamp>[] {
  // Seed shifts per timeframe + symbol so the chart visibly changes
  // when either is changed in the toolbar.
  let symbolSeed = 0;
  for (let i = 0; i < symbol.length; i++) {
    symbolSeed = (symbolSeed * 31 + symbol.charCodeAt(i)) >>> 0;
  }
  const seedMap: Record<Timeframe, number> = {
    M1: 1,
    M5: 5,
    M15: 15,
    M30: 30,
    H1: 60,
    H4: 240,
    D1: 1440,
    W: 10080,
  };
  const seed = seedMap[timeframe] + symbolSeed;
  const baseTime = Math.floor(Date.now() / 1000);
  // Time delta per timeframe (in seconds)
  const deltaMap: Record<Timeframe, number> = {
    M1: 60,
    M5: 300,
    M15: 900,
    M30: 1800,
    H1: 3600,
    H4: 14400,
    D1: 86400,
    W: 604800,
  };
  const delta = deltaMap[timeframe];

  // Volatility scales relative to price — bigger for crypto (BTC, ETH…),
  // tiny for forex majors. Use 0.25% by default.
  const isCrypto =
    symbol.startsWith("BTC") ||
    symbol.startsWith("ETH") ||
    symbol.startsWith("SOL") ||
    symbol.startsWith("XRP");
  const volPct = isCrypto ? 0.01 : 0.0025;
  const moveScale = midPrice * volPct;
  const wickScale = moveScale * 0.5;

  let price = midPrice;
  const out: CandlestickData<UTCTimestamp>[] = [];
  for (let i = 0; i < count; i++) {
    const s = (seed + i) * 9301 + 49297;
    const rnd = ((s % 233280) / 233280) * 2 - 1; // -1..1
    const open = price;
    const move = rnd * moveScale;
    const close = open + move;
    const high = Math.max(open, close) + Math.abs(rnd) * wickScale;
    const low = Math.min(open, close) - Math.abs(rnd) * wickScale;
    out.push({
      time: (baseTime - (count - i - 1) * delta) as UTCTimestamp,
      open,
      high,
      low,
      close,
    });
    price = close;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Bottom trading panel (strip + expandable tables + close popup)       */
/* ------------------------------------------------------------------ */

function BottomPanel({
  expanded,
  onToggleExpand,
  onPendingPriceChange,
  onMaximize,
  isMaximized,
}: {
  expanded: boolean;
  onToggleExpand: () => void;
  onPendingPriceChange: (price: number | null) => void;
  /** Phase 3: maximize / restore the active chart pane. */
  onMaximize: () => void;
  isMaximized: boolean;
}) {
  const accountMode = useMarketsStore((s) => s.accountMode);
  const [tab, setTab] = useState<"market" | "pending" | "closed">("market");
  const [closePopupOpen, setClosePopupOpen] = useState(false);
  const positions = useMarketsStore((s) => s.positions);
  const pendingOrders = useMarketsStore((s) => s.pendingOrders);
  const closedPositions = useMarketsStore((s) => s.closedPositions);
  const account = useMarketsStore((s) => s.account);

  const floating = account?.floatingPnl ?? 0;
  const floatingColor = floating > 0 ? C_UP : floating < 0 ? C_DOWN : "#ffffff";

  if (accountMode !== "paper") {
    return <BybitTradingPanel expanded={expanded} onToggleExpand={onToggleExpand} onMaximize={onMaximize} isMaximized={isMaximized} />;
  }

  return (
    <div
      className="shrink-0 border-t themed"
      style={{ background: C_PANEL, borderColor: C_BORDER }}
    >
      {/* ── Strip row ── */}
      <div className="flex h-9 items-center gap-2 px-3">
        <StripTab
          label="Market"
          count={positions.length}
          active={tab === "market" && expanded}
          onClick={() => {
            setTab("market");
            if (!expanded) onToggleExpand();
          }}
        />
        <StripTab
          label="Pending"
          count={pendingOrders.length}
          active={tab === "pending" && expanded}
          onClick={() => {
            setTab("pending");
            if (!expanded) onToggleExpand();
          }}
        />
        <StripTab
          label="Closed"
          count={closedPositions.length}
          active={tab === "closed" && expanded}
          onClick={() => {
            setTab("closed");
            if (!expanded) onToggleExpand();
          }}
        />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Floating profit + close */}
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-[#787b86]">Floating profit:</span>
          <span
            className="font-mono tabular-nums"
            style={{ color: floatingColor }}
          >
            ${floating.toFixed(2)}
          </span>
        </div>

        <Separator />

        {/* Close button — opens the close-positions popup */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setClosePopupOpen((v) => !v)}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-white transition-colors hover:opacity-90"
            style={{ background: "#2a2e39" }}
          >
            Close
            <ChevronDown className="h-3 w-3" />
          </button>
          {closePopupOpen && (
            <ClosePositionsPopup
              onClose={() => setClosePopupOpen(false)}
            />
          )}
        </div>

        {/* Expand/collapse toggle */}
        <button
          type="button"
          onClick={onToggleExpand}
          title={expanded ? "Collapse" : "Expand"}
          aria-label={expanded ? "Collapse" : "Expand"}
          className="flex h-6 w-6 items-center justify-center rounded text-[#787b86] transition-colors hover:bg-[#2a2e39] hover:text-white"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          title={isMaximized ? "Restore (Esc)" : "Maximize chart"}
          aria-label={isMaximized ? "Restore" : "Maximize"}
          onClick={onMaximize}
          className="flex h-6 w-6 items-center justify-center rounded text-[#787b86] transition-colors hover:bg-[#2a2e39] hover:text-white"
        >
          {isMaximized ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* ── Expanded table area ── */}
      {expanded && (
        <div
          className="h-[220px] overflow-auto border-t themed"
          style={{ borderColor: C_BORDER, background: "#161922" }}
        >
          {tab === "market" && (
            <PositionsTable positions={positions} />
          )}
          {tab === "pending" && (
            <PendingOrdersTable
              orders={pendingOrders}
              onPendingPriceChange={onPendingPriceChange}
            />
          )}
          {tab === "closed" && (
            <ClosedTable closed={closedPositions} />
          )}
        </div>
      )}
    </div>
  );
}

function StripTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 text-[11px] transition-colors",
        active
          ? "text-white"
          : "text-[#787b86] hover:text-white",
      )}
      style={active ? { borderBottom: `2px solid ${C_BLUE}` } : undefined}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span
          className="flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold"
          style={{
            background: active ? C_BLUE : "#2a2e39",
            color: "#ffffff",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/* ── Close-positions popup ── */

function ClosePositionsPopup({ onClose }: { onClose: () => void }) {
  const [choice, setChoice] = useState<
    "all" | "profitable" | "losing" | "long" | "short"
  >("all");
  const closeMatching = useMarketsStore((s) => s.closeMatching);
  const positions = useMarketsStore((s) => s.positions);

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!e.composedPath().includes(rootRef.current)) onClose();
    };
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  const handleConfirm = () => {
    closeMatching(choice);
    onClose();
  };

  const options: { id: typeof choice; label: string }[] = [
    { id: "all", label: "All currently open" },
    { id: "profitable", label: "All profitable" },
    { id: "losing", label: "All losing" },
    { id: "long", label: "All long" },
    { id: "short", label: "All short" },
  ];

  return (
    <div
      ref={rootRef}
      className="absolute bottom-9 right-0 z-30 w-[280px] overflow-hidden rounded-md shadow-xl themed"
      style={{
        background: "#1e1e2d",
        border: "1px solid #2a2a3c",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
      }}
    >
      <div className="px-4 pb-2 pt-3 text-[12px] text-white">
        Which positions would you like
        <br />
        to close at market prices?
      </div>
      <div className="px-2 pb-2">
        {options.map((opt) => (
          <label
            key={opt.id}
            className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-[12px] text-[#e0e0e0] hover:bg-[#2a2a3c] rounded"
          >
            <input
              type="radio"
              name="close-choice"
              checked={choice === opt.id}
              onChange={() => setChoice(opt.id)}
              className="h-3 w-3 accent-[#4b9eff]"
            />
            {opt.label}
          </label>
        ))}
      </div>
      <div className="flex gap-2 border-t px-3 py-2" style={{ borderColor: "#2e2e3e" }}>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={positions.length === 0}
          className="flex-1 rounded bg-[#2962ff] px-3 py-1.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={onClose}
          className="flex-1 rounded bg-[#2a2e39] px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-[#363a45]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ── Trading tables ── */

function PositionsTable({ positions }: { positions: ReturnType<typeof useMarketsStore.getState>["positions"] }) {
  // Live prices flow in from the markets store so "Current price" + "Price
  // change" columns reflect real market data for any position whose symbol
  // has a live provider (crypto). For non-crypto positions, we fall back to
  // the entry price as an honest "no live data" display.
  const prices = useMarketsStore((s) => s.prices);
  if (positions.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-[11px] text-[#787b86]">
        No open positions. Place an order from the Order Details panel.
      </div>
    );
  }
  return (
    <table className="w-full text-[11px] text-[#d1d4dc]">
      <thead className="text-[10px] uppercase text-[#787b86] sticky top-0 bg-[#161922]">
        <tr>
          <Th>Instrument</Th>
          <Th>Direction</Th>
          <Th>Volume</Th>
          <Th>Open time</Th>
          <Th>Open price</Th>
          <Th>Current price</Th>
          <Th>SL</Th>
          <Th>TP</Th>
          <Th>Price change</Th>
          <Th>P/L</Th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => {
          const livePrice = prices.get(p.symbol);
          const currentPrice = livePrice ?? p.entryPrice;
          const priceChange =
            livePrice !== undefined && p.entryPrice > 0
              ? ((livePrice - p.entryPrice) / p.entryPrice) * 100
              : 0;
          const priceChangeColor =
            priceChange > 0 ? C_UP : priceChange < 0 ? C_DOWN : "#787b86";
          return (
            <tr key={p.id} className="border-t border-[#2a2e39]">
              <Td className="font-semibold text-white">{p.symbol}</Td>
              <Td>
                <span
                  className="rounded px-1.5 py-0.5 text-[9px] font-bold text-white"
                  style={{ background: p.side === "buy" ? C_UP : C_DOWN }}
                >
                  {p.side === "buy" ? "Buy" : "Sell"}
                </span>
              </Td>
              <Td className="font-mono tabular-nums">{p.volume.toFixed(2)}</Td>
              <Td className="font-mono tabular-nums">{new Date(p.openedAt).toLocaleString()}</Td>
              <Td className="font-mono tabular-nums">{p.entryPrice.toFixed(5)}</Td>
              <Td className="font-mono tabular-nums">{currentPrice.toFixed(5)}</Td>
              <Td className="font-mono tabular-nums">{p.stopLoss ? p.stopLoss.toFixed(5) : "—"}</Td>
              <Td className="font-mono tabular-nums">{p.takeProfit ? p.takeProfit.toFixed(5) : "—"}</Td>
              <Td className="font-mono tabular-nums" style={{ color: priceChangeColor }}>
                {priceChange >= 0 ? "+" : ""}{priceChange.toFixed(2)}%
              </Td>
              <Td>
                <span
                  className="font-mono tabular-nums"
                  style={{
                    color:
                      p.unrealizedPnl > 0 ? C_UP : p.unrealizedPnl < 0 ? C_DOWN : "#fff",
                  }}
                >
                  ${p.unrealizedPnl.toFixed(2)}
                </span>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function PendingOrdersTable({
  orders,
  onPendingPriceChange,
}: {
  orders: ReturnType<typeof useMarketsStore.getState>["pendingOrders"];
  onPendingPriceChange: (price: number | null) => void;
}) {
  // Live prices so the Pending table can show the current market price
  // next to the trigger price — the trader can see how far away the
  // trigger is at a glance.
  const prices = useMarketsStore((s) => s.prices);

  // When the pending tab is shown, propagate the first pending order's
  // entry price to the chart so the pending-order line shows.
  useEffect(() => {
    if (orders.length > 0) {
      onPendingPriceChange(orders[0].price);
    } else {
      onPendingPriceChange(null);
    }
    return () => onPendingPriceChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders.length, orders[0]?.price]);

  if (orders.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-[11px] text-[#787b86]">
        No pending orders. Configure one from the Order Details → Pending tab.
      </div>
    );
  }
  return (
    <table className="w-full text-[11px] text-[#d1d4dc]">
      <thead className="text-[10px] uppercase text-[#787b86] sticky top-0 bg-[#161922]">
        <tr>
          <Th>Instrument</Th>
          <Th>Type</Th>
          <Th>Direction</Th>
          <Th>Volume</Th>
          <Th>Entry trigger</Th>
          <Th>Current price</Th>
          <Th>Created</Th>
          <Th>SL</Th>
          <Th>TP</Th>
          <Th></Th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => {
          const livePrice = prices.get(o.symbol);
          // Distance from current price to trigger, in points.
          const distance =
            livePrice !== undefined
              ? Math.abs(o.price - livePrice) * Math.pow(10, 5)
              : 0;
          return (
            <tr key={o.id} className="border-t border-[#2a2e39]">
              <Td className="font-semibold text-white">{o.symbol}</Td>
              <Td className="capitalize">{o.orderType.replace("_", " ")}</Td>
              <Td>
                <span
                  className="rounded px-1.5 py-0.5 text-[9px] font-bold text-white"
                  style={{ background: o.side === "buy" ? C_UP : C_DOWN }}
                >
                  {o.side === "buy" ? "Buy" : "Sell"}
                </span>
              </Td>
              <Td className="font-mono tabular-nums">{o.volume.toFixed(2)}</Td>
              <Td className="font-mono tabular-nums">{o.price.toFixed(5)}</Td>
              <Td className="font-mono tabular-nums text-[#787b86]">
                {livePrice !== undefined ? (
                  <>
                    {livePrice.toFixed(5)}
                    <span className="ml-1 text-[9px] text-[#787b86]">
                      ({distance.toFixed(1)} pts)
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </Td>
              <Td className="font-mono tabular-nums">{new Date(o.createdAt).toLocaleString()}</Td>
              <Td className="font-mono tabular-nums">{o.stopLoss ? o.stopLoss.toFixed(5) : "—"}</Td>
              <Td className="font-mono tabular-nums">{o.takeProfit ? o.takeProfit.toFixed(5) : "—"}</Td>
              <Td>
                <button
                  type="button"
                  onClick={() => useMarketsStore.getState().cancelPending(o.id)}
                  className="text-[10px] text-[#787b86] hover:text-white"
                >
                  Cancel
                </button>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ClosedTable({ closed }: { closed: ReturnType<typeof useMarketsStore.getState>["closedPositions"] }) {
  if (closed.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-[11px] text-[#787b86]">
        No closed positions yet.
      </div>
    );
  }

  // Group closed positions by date for the history layout.
  const groups = new Map<string, typeof closed>();
  for (const c of closed) {
    const key = new Date(c.closedAt).toLocaleDateString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }

  return (
    <div className="text-[11px] text-[#d1d4dc]">
      {Array.from(groups.entries()).map(([date, items]) => (
        <div key={date}>
          <div className="sticky top-0 bg-[#1e222d] px-3 py-1 text-[10px] font-bold uppercase text-[#787b86]">
            {date}
          </div>
          <table className="w-full">
            <thead className="text-[10px] uppercase text-[#787b86]">
              <tr>
                <Th>Instrument</Th>
                <Th>Direction</Th>
                <Th>Volume</Th>
                <Th>Opened</Th>
                <Th>Closed</Th>
                <Th>Open price</Th>
                <Th>Close price</Th>
                <Th>Price change</Th>
                <Th>Reason</Th>
                <Th>P/L</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-t border-[#2a2e39]">
                  <Td className="font-semibold text-white">{c.symbol}</Td>
                  <Td>
                    <span
                      className="rounded px-1.5 py-0.5 text-[9px] font-bold text-white"
                      style={{ background: c.side === "buy" ? C_UP : C_DOWN }}
                    >
                      {c.side === "buy" ? "Buy" : "Sell"}
                    </span>
                  </Td>
                  <Td className="font-mono tabular-nums">{c.volume.toFixed(2)}</Td>
                  <Td className="font-mono tabular-nums">
                    {new Date(c.openedAt).toLocaleString()}
                  </Td>
                  <Td className="font-mono tabular-nums">
                    {new Date(c.closedAt).toLocaleTimeString()}
                  </Td>
                  <Td className="font-mono tabular-nums">{c.entryPrice.toFixed(5)}</Td>
                  <Td className="font-mono tabular-nums">{c.exitPrice.toFixed(5)}</Td>
                  <Td className="font-mono tabular-nums">
                    {((c.exitPrice - c.entryPrice) / c.entryPrice * 100).toFixed(2)}%
                  </Td>
                  <Td className="text-[9px] text-[#787b86] capitalize">
                    {c.closeReason.replace("_", " ")}
                  </Td>
                  <Td>
                    <span
                      className="font-mono tabular-nums"
                      style={{
                        color:
                          c.realizedPnl > 0 ? C_UP : c.realizedPnl < 0 ? C_DOWN : "#fff",
                      }}
                    >
                      ${c.realizedPnl.toFixed(2)}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-1.5 text-left font-medium">{children}</th>;
}

function Td({
  children,
  className,
  style,
}: {
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return <td className={cn("px-3 py-1.5", className)} style={style}>{children}</td>;
}
