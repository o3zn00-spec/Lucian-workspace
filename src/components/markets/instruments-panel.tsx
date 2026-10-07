"use client";

/* LUCIAN Markets — Instruments panel (left sidebar inside Markets page).
 *
 * Layout matches the reference trading terminal:
 *   ┌────────────────────────────────────┐
 *   │ Instruments                    X   │  header (close button works)
 *   ├────────────────────────────────────┤
 *   │ 🔍 Search instruments               │
 *   ├────────────────────────────────────┤
 *   │ ★ All  Forex  Crypto  Indices  Metals │  chip row 1 (★ = favorites)
 *   │ Energies  Intraday                  │  chip row 2
 *   ├────────────────────────────────────┤
 *   │ ★ [icon] LINKUSD    11.612 11.700   │  row (★ invisible until hover)
 *   │          +0.08% S:8.8  L:11.588 H:11.678 │
 *   │   ⋮                                    │
 *   └────────────────────────────────────┘
 *
 * Behaviors:
 *  - Search filters the visible list by symbol or name
 *  - Chip filters by UI category; the leading ★ chip filters to favorites
 *  - Each row has a star button on the LEFT:
 *      * hidden by default if not favorited
 *      * appears on row hover
 *      * click toggles favorite; favorited stars stay visible (filled)
 *  - Favorites persist to localStorage
 *  - List scrolls smoothly
 *  - Clicking a row selects it (highlight persists)
 *  - X close button calls onClose prop
 */

import { useMemo, useState } from "react";
import { Search, Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  filterByCategory,
  type InstrumentCategory,
} from "@/lib/markets/catalog";
import { InstrumentIcon } from "@/components/markets/instrument-icon";
import { useFavorites } from "@/hooks/use-favorites";
import { useMarketsStore } from "@/store/markets";
import { isSupportedCrypto } from "@/lib/markets/symbol-mapping";
import type { DataStatus } from "@/lib/markets/types";

/* Filter chips arranged in two clean rows, matching the reference:
   Row 1: ★ All Forex Crypto Indices
   Row 2: Metals Energies Intraday */
const CHIP_ROW_1: InstrumentCategory[] = [
  "favorites",
  "all",
  "crypto",
];
const CHIP_ROW_2: InstrumentCategory[] = [];

const UP = "#4bfa8f";
const DOWN = "#ff5b5b";
const NEUTRAL = "#9ea3ab";

interface Props {
  /** Optional callback when an instrument is selected. */
  onSelect?: (symbol: string) => void;
  /** Close handler — the X button calls this. The parent decides
      what "close" means (typically hide the panel entirely). */
  onClose?: () => void;
  /** Initially selected symbol. */
  initialSelected?: string;
}

export function InstrumentsPanel({
  onSelect,
  onClose,
  initialSelected,
}: Props) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<InstrumentCategory>("all");
  const [selected, setSelected] = useState<string | null>(
    initialSelected ?? null,
  );
  const { favorites, toggle } = useFavorites();

  // ── Live data subscriptions ──
  // Pull the live prices map + tickers map + status map from the store.
  // These are Map<string, …> so React's default Object.is comparison won't
  // detect mutations — the store creates a new Map instance on every update
  // so the component re-renders whenever a new price/ticker lands.
  const prices = useMarketsStore((s) => s.prices);
  const tickers = useMarketsStore((s) => s.tickers);
  const statusBySymbol = useMarketsStore((s) => s.statusBySymbol);
  const selectSymbol = useMarketsStore((s) => s.selectSymbol);
  const setActivePaneIndex = useMarketsStore((s) => s.setActivePaneIndex);

  const visible = useMemo(() => {
    let list = filterByCategory(category);
    if (category === "favorites") {
      list = list.filter((i) => favorites.has(i.symbol));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (i) =>
          i.symbol.toLowerCase().includes(q) ||
          i.name.toLowerCase().includes(q),
      );
    }
    return list;
  }, [category, search, favorites]);

  const handleSelect = (sym: string) => {
    setSelected(sym);
    // 1. Push the symbol into the store's selectedSymbol so legacy
    //    consumers (Intelligence panel, etc.) pick it up.
    selectSymbol(sym);
    // 2. Mark pane 0 as the active pane — clicking an instrument in the
    //    list should focus the primary chart pane.
    setActivePaneIndex(0);
    onSelect?.(sym);
  };

  return (
    <div className="themed flex h-full min-h-0 w-full flex-col bg-surface text-fg">
      {/* ── Header ── */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line-muted px-3">
        <span className="text-[12px] font-semibold tracking-wide text-fg">
          Instruments
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close instruments panel"
          title="Close"
          className="text-fg-faint transition-colors hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Search ── */}
      <div className="shrink-0 px-2.5 pt-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-faint" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search instruments"
            className="h-7 w-full rounded bg-surface-2 pl-7 pr-2 text-[11px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)] themed"
          />
        </div>
      </div>

      {/* ── Filter chips (two clean rows) ── */}
      <div className="shrink-0 space-y-1 px-2.5 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {CHIP_ROW_1.map((cat) => (
            <Chip
              key={cat}
              cat={cat}
              active={category === cat}
              onClick={() => setCategory(cat)}
              favoritesCount={
                cat === "favorites" ? favorites.size : undefined
              }
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {CHIP_ROW_2.map((cat) => (
            <Chip
              key={cat}
              cat={cat}
              active={category === cat}
              onClick={() => setCategory(cat)}
            />
          ))}
        </div>
      </div>

      {/* ── List (scrollable) ── */}
      <div className="min-h-0 flex-1 overflow-y-auto themed">
        {visible.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-fg-faint">
            {category === "favorites" ? (
              <>
                No favorites yet.
                <br />
                Click ★ on a row to add.
              </>
            ) : search.trim() ? (
              <>
                No instruments match &quot;{search}&quot;.
              </>
            ) : (
              <>No instruments.</>
            )}
          </div>
        ) : (
          <ul className="m-0 list-none p-0">
            {visible.map((inst) => {
              const isSel = selected === inst.symbol;
              const isFav = favorites.has(inst.symbol);
              // ── Live data resolution ──
              const livePrice = prices.get(inst.symbol);
              const ticker = tickers.get(inst.symbol);
              const live = isSupportedCrypto(inst.symbol);
              const status: DataStatus = statusBySymbol.get(inst.symbol) ??
                (live ? "live" : "setup-required");
              // Display price: live ticker bidPrice → live price → catalog bid.
              const displayBid = ticker?.bidPrice ?? livePrice ?? inst.bid;
              const displayAsk = ticker?.askPrice ?? livePrice ?? inst.ask;
              const displayLow = ticker?.lowPrice ?? inst.low;
              const displayHigh = ticker?.highPrice ?? inst.high;
              const displayChange = ticker?.priceChangePercent ?? inst.changePct;
              const chgColor = !inst.marketOpen
                ? NEUTRAL
                : (displayChange ?? 0) > 0
                ? UP
                : (displayChange ?? 0) < 0
                ? DOWN
                : NEUTRAL;
              const priceColor = !inst.marketOpen
                ? "var(--fg)"
                : (displayChange ?? 0) > 0
                ? UP
                : (displayChange ?? 0) < 0
                ? DOWN
                : "var(--fg)";
              return (
                <li key={inst.symbol} className="group relative">
                  <button
                    type="button"
                    onClick={() => handleSelect(inst.symbol)}
                    className={cn(
                      "relative flex w-full items-stretch gap-1.5 border-b border-line-muted/60 px-2.5 py-2 text-left transition-colors themed",
                      isSel ? "bg-active" : "hover:bg-hover",
                    )}
                  >
                    {/* Selected left-bar accent */}
                    {isSel && (
                      <span
                        aria-hidden
                        className="absolute left-0 top-0 h-full w-[2px] bg-[var(--accent)]"
                      />
                    )}

                    {/* Favorite star — invisible by default, appears on hover or when favorited */}
                    <span className="flex w-3 shrink-0 items-start pt-0.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(inst.symbol);
                        }}
                        aria-label={
                          isFav
                            ? `Remove ${inst.symbol} from favorites`
                            : `Add ${inst.symbol} to favorites`
                        }
                        title={
                          isFav ? "Remove from favorites" : "Add to favorites"
                        }
                        className={cn(
                          "transition-opacity",
                          isFav
                            ? "opacity-100"
                            : "opacity-0 group-hover:opacity-100 focus:opacity-100",
                        )}
                      >
                        <Star
                          className={cn(
                            "h-3 w-3 transition-colors",
                            isFav
                              ? "fill-[var(--accent)] text-[var(--accent)]"
                              : "text-fg-faint hover:text-fg",
                          )}
                        />
                      </button>
                    </span>

                    {/* Instrument identity icon (researched per asset) */}
                    <InstrumentIcon
                      symbol={inst.symbol}
                      base={inst.base}
                      assetClass={inst.assetClass}
                      badge={inst.badge}
                    />

                    {/* Symbol + status */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="truncate text-[11px] font-semibold text-fg">
                          {inst.symbol}
                        </span>
                        <StatusDot status={status} live={live} />
                      </div>
                      <div className="truncate text-[9px] leading-tight">
                        {!inst.marketOpen ? (
                          <span style={{ color: NEUTRAL }}>Market closed</span>
                        ) : (
                          <span style={{ color: chgColor }}>
                            {(displayChange ?? 0) >= 0 ? "+" : ""}
                            {(displayChange ?? 0).toFixed(2)}%{" "}
                            <span style={{ color: NEUTRAL }}>
                              S: {inst.spread.toFixed(1)}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Bid / Ask columns */}
                    <div className="flex shrink-0 gap-2 text-right">
                      <PriceCol
                        label="L"
                        price={displayBid}
                        precision={inst.pricePrecision}
                        color={priceColor}
                        subValue={displayLow}
                        subPrecision={inst.pricePrecision}
                        marketOpen={inst.marketOpen}
                      />
                      <PriceCol
                        label="H"
                        price={displayAsk}
                        precision={inst.pricePrecision}
                        color={priceColor}
                        subValue={displayHigh}
                        subPrecision={inst.pricePrecision}
                        marketOpen={inst.marketOpen}
                      />
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Footer status ── */}
      <div className="flex h-6 shrink-0 items-center justify-between border-t border-line-muted px-3 text-[9px] text-fg-faint themed">
        <span>{visible.length} instruments</span>
        <span className="flex items-center gap-1">
          <Star className="h-2.5 w-2.5" />
          {favorites.size} favorites
        </span>
      </div>
    </div>
  );
}

/* ── Status dot — small colored circle next to the symbol that tells the
   user at a glance whether this row is showing live provider data,
   reference catalog prices, or no provider (Setup Required). */
function StatusDot({ status, live }: { status: DataStatus; live: boolean }) {
  const { color, label } = statusDotStyle(status, live);
  return (
    <span
      title={label}
      aria-label={label}
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

/** Visual style for a row's data status. Used by both the row's StatusDot
    and the tooltip on the status badge. */
function statusDotStyle(status: DataStatus, live: boolean): { color: string; label: string } {
  if (!live) {
    // Non-crypto instruments have no provider configured at all.
    return { color: "#9ea3ab", label: "Reference — provider required" };
  }
  switch (status) {
    case "live":
      return { color: "#4bfa8f", label: "Live — provider connected" };
    case "delayed":
      return { color: "#f5a623", label: "Delayed" };
    case "disconnected":
      return { color: "#ff5b5b", label: "Disconnected — retrying" };
    case "setup-required":
      return { color: "#9ea3ab", label: "Setup required" };
    default:
      return { color: "#9ea3ab", label: "Reference" };
  }
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Chip({
  cat,
  active,
  onClick,
  favoritesCount,
}: {
  cat: InstrumentCategory;
  active: boolean;
  onClick: () => void;
  favoritesCount?: number;
}) {
  /* Favorites chip: single neutral outline star only — no duplicate
     star, no fill, no accent color even when active. Keeps the same
     height and padding as the other chips so the strip stays uniform. */
  if (cat === "favorites") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Filter favorites"
        title="Favorites"
        className={cn(
          "flex h-5 items-center justify-center gap-1 rounded px-2 text-[10px] font-medium transition-colors themed",
          active
            ? "bg-active text-fg"
            : "bg-surface-2 text-fg-muted hover:bg-hover hover:text-fg",
        )}
      >
        <Star className="h-3 w-3" />
        {favoritesCount !== undefined && favoritesCount > 0 && (
          <span className="text-[8px] text-fg-faint">({favoritesCount})</span>
        )}
      </button>
    );
  }

  /* Standard text chip */
  const label = cat === "all" ? "All" : cap(cat);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-5 items-center rounded px-2 text-[10px] font-medium transition-colors themed",
        active
          ? "bg-active text-fg"
          : "bg-surface-2 text-fg-muted hover:bg-hover hover:text-fg",
      )}
    >
      {label}
    </button>
  );
}

function PriceCol({
  label,
  price,
  precision,
  color,
  subValue,
  subPrecision,
  marketOpen,
}: {
  label: string;
  price: number;
  precision: number;
  color: string;
  subValue: number;
  subPrecision: number;
  marketOpen: boolean;
}) {
  return (
    <div className="leading-tight">
      <div
        className="font-mono text-[11px] tabular-nums"
        style={{ color }}
      >
        {marketOpen ? price.toFixed(precision) : price.toFixed(precision)}
      </div>
      <div className="font-mono text-[8px] tabular-nums text-fg-faint">
        {label}: {subValue.toFixed(subPrecision)}
      </div>
    </div>
  );
}
