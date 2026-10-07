"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelRightClose, PanelRightOpen, Newspaper, Filter, ExternalLink, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMarketsStore } from "@/store/markets";
import { getInstrumentBySymbol } from "@/lib/markets/catalog";
import type { NewsItem, NewsFilters, MarketCategory } from "@/lib/markets/intelligence-types";
import { DEFAULT_NEWS_FILTERS } from "@/lib/markets/intelligence-types";

export function IntelligencePanel({ open: controlledOpen, onOpenChange }: { open?: boolean; onOpenChange?: (value: boolean) => void }) {
  const [localOpen, setLocalOpen] = useState(true);
  const open = controlledOpen ?? localOpen;
  const toggle = () => { if (onOpenChange) onOpenChange(!open); else setLocalOpen(!open); };
  return <aside className="flex shrink-0 flex-col border-l border-line-muted bg-surface" style={{width: open ? 320 : 32}} aria-label="Market news">
    <button type="button" onClick={toggle} aria-label={open ? "Collapse market news" : "Expand market news"} className="flex h-8 items-center justify-center border-b border-line-muted text-fg-muted">
      {open ? <><Newspaper className="mr-2 h-3.5 w-3.5" />Feed<PanelRightClose className="ml-2 h-3.5 w-3.5" /></> : <PanelRightOpen className="h-4 w-4" />}
    </button>
    {open && <FeedTab />}
  </aside>;
}

function FeedTab() {
  const [filters, setFilters] = useState<NewsFilters>(DEFAULT_NEWS_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerLabel, setProviderLabel] = useState<string | null>(null);

  // The current instrument is shared from the markets store so the
  // "current instrument only" filter works. We follow the ACTIVE chart
  // pane so the Feed filters apply to whatever pane the trader is
  // currently focused on.
  const activePaneIndex = useMarketsStore((s) => s.activePaneIndex);
  const paneStates = useMarketsStore((s) => s.paneStates);
  const pane = paneStates[activePaneIndex] ?? paneStates[0];
  const selectedSymbol = pane?.symbol ?? null;
  const inst = useMemo(
    () => getInstrumentBySymbol(selectedSymbol ?? "BTCUSD") ?? getInstrumentBySymbol("BTCUSD")!,
    [selectedSymbol],
  );

  // Determine the market category to filter on based on the selected
  // instrument's asset class (only when currentInstrumentOnly is true).
  const effectiveFilters: NewsFilters = useMemo(() => {
    if (!filters.currentInstrumentOnly) return filters;
    const map: Record<string, MarketCategory> = {
      forex: "forex",
      crypto: "crypto",
      stocks: "stocks",
      indices: "indices",
      metals: "metals",
      energies: "energy",
      commodities: "metals",
    };
    return {
      ...filters,
      market: map[inst.assetClass] ?? filters.market,
    };
  }, [filters, inst.assetClass]);

  const fetchNews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        market: effectiveFilters.market,
        breaking: String(effectiveFilters.content.breaking),
        news: String(effectiveFilters.content.news),
        analysis: String(effectiveFilters.content.analysis),
        economicEvents: String(effectiveFilters.content.economicEvents),
        currentInstrumentOnly: String(effectiveFilters.currentInstrumentOnly),
      });
      const res = await fetch(`/api/markets/news?${params.toString()}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as {
        items: NewsItem[];
        provider?: { label?: string };
        error?: string;
        message?: string;
      };
      if (data.provider?.label) setProviderLabel(data.provider.label);
      setItems(data.items ?? []);
      if (data.error) setError(data.message ?? "Feed unavailable");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load market feed.",
      );
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [effectiveFilters]);

  useEffect(() => {
    // Defer the initial fetch to a microtask so we don't call setState
    // synchronously inside the effect body (React 19 rule).
    const id = window.setTimeout(() => {
      void fetchNews();
    }, 0);
    return () => window.clearTimeout(id);
  }, [fetchNews]);

  

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Filter button row */}
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line-muted px-2 themed">
        <button
          type="button"
          onClick={() => setFilterOpen((v) => !v)}
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors themed",
            filterOpen
              ? "bg-active text-fg"
              : "text-fg-muted hover:bg-hover hover:text-fg",
          )}
        >
          <Filter className="h-2.5 w-2.5" />
          Filters
        </button>
        {filters.currentInstrumentOnly && (
          <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[9px] font-medium text-[var(--accent)]">
            {inst.symbol} only
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={fetchNews}
          title="Refresh"
          className="text-[9px] text-fg-faint hover:text-fg"
        >
          ↻
        </button>
      </div>

      {/* Filter drawer */}
      {filterOpen && (
        <FilterDrawer
          filters={filters}
          onChange={setFilters}
          onClose={() => setFilterOpen(false)}
          onReset={() => setFilters(DEFAULT_NEWS_FILTERS)}
          onApply={() => setFilterOpen(false)}
        />
      )}

      {/* Feed list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-3 py-8 text-center text-[10px] text-fg-faint">
            Loading live market feed…
          </div>
        ) : error ? (
          <div className="px-3 py-6 text-center">
            <p className="text-[11px] font-medium text-amber-500">
              Live feed unavailable
            </p>
            <p className="mt-1 text-[10px] text-fg-muted">{error}</p>
            <p className="mt-2 text-[9px] text-fg-faint">
              {providerLabel
                ? `Provider: ${providerLabel}`
                : "Configure a market-news provider in .env"}
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="px-3 py-8 text-center text-[10px] text-fg-faint">
            No stories match the current filters.
          </div>
        ) : (
          items.map((item) => (
            <FeedCard key={item.id} item={item}  />
          ))
        )}
      </div>
    </div>
  );
}

/* ── Filter drawer ── */

function FilterDrawer({
  filters,
  onChange,
  onClose,
  onReset,
  onApply,
}: {
  filters: NewsFilters;
  onChange: (f: NewsFilters) => void;
  onClose: () => void;
  onReset: () => void;
  onApply: () => void;
}) {
  return (
    <div className="shrink-0 space-y-2 border-b border-line-muted bg-surface-2 px-3 py-2 themed">
      {/* Market */}
      <div>
        <p className="mb-1 text-[9px] uppercase tracking-wide text-fg-faint">
          Market
        </p>
        <div className="flex flex-wrap gap-1">
          {(
            [
              "all",
              "forex",
              "crypto",
              "stocks",
              "indices",
              "metals",
              "energy",
            ] as MarketCategory[]
          ).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange({ ...filters, market: m })}
              className={cn(
                "rounded px-1.5 py-0.5 text-[9px] font-medium capitalize transition-colors themed",
                filters.market === m
                  ? "bg-active text-fg"
                  : "bg-surface text-fg-muted hover:text-fg",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div>
        <p className="mb-1 text-[9px] uppercase tracking-wide text-fg-faint">
          Content
        </p>
        <div className="flex flex-wrap gap-2">
          <FilterCheck
            label="Breaking"
            checked={filters.content.breaking}
            onChange={(v) =>
              onChange({
                ...filters,
                content: { ...filters.content, breaking: v },
              })
            }
          />
          <FilterCheck
            label="News"
            checked={filters.content.news}
            onChange={(v) =>
              onChange({
                ...filters,
                content: { ...filters.content, news: v },
              })
            }
          />
          <FilterCheck
            label="Analysis"
            checked={filters.content.analysis}
            onChange={(v) =>
              onChange({
                ...filters,
                content: { ...filters.content, analysis: v },
              })
            }
          />
          <FilterCheck
            label="Economic events"
            checked={filters.content.economicEvents}
            onChange={(v) =>
              onChange({
                ...filters,
                content: { ...filters.content, economicEvents: v },
              })
            }
          />
        </div>
      </div>

      {/* Instrument */}
      <div>
        <p className="mb-1 text-[9px] uppercase tracking-wide text-fg-faint">
          Instrument
        </p>
        <label className="flex items-center gap-1.5 text-[10px] text-fg-muted">
          <input
            type="checkbox"
            checked={filters.currentInstrumentOnly}
            onChange={(e) =>
              onChange({
                ...filters,
                currentInstrumentOnly: e.target.checked,
              })
            }
            className="h-2.5 w-2.5 accent-[var(--accent)]"
          />
          Current instrument only
        </label>
      </div>

      {/* Phase 3: the "Time" filter selector was removed because it was a
          non-interactive div styled as a dropdown. The Feed always shows
          the latest articles (server-side sort by publishedAt desc). */}

      {/* Actions */}
      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={onReset}
          className="text-[10px] text-fg-muted hover:text-fg"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={onApply}
          className="rounded bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-fg)]"
        >
          Apply
        </button>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="absolute right-2 top-2 text-fg-faint hover:text-fg"
        aria-label="Close filters"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function FilterCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-[10px] text-fg-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-2.5 w-2.5 accent-[var(--accent)]"
      />
      {label}
    </label>
  );
}

/* ── Feed card ── */

function FeedCard({
  item,
}: {
  item: NewsItem;
}) {
  // Compute relative time ONCE in a lazy useState initializer — Date.now()
  // is impure and cannot be called during render (React 19 purity rule).
  // The card is mounted once and the relative time is fine to be fixed
  // at mount (feed cards are short-lived UI).
  const [minsAgo] = useState(() =>
    Math.max(0, Math.round((Date.now() - item.publishedAt) / 60000)),
  );
  const timeLabel =
    minsAgo < 1 ? "now" : minsAgo < 60 ? `${minsAgo}m` : `${Math.floor(minsAgo / 60)}h`;

  const typeColor =
    item.type === "breaking"
      ? "text-red-400"
      : item.type === "analysis"
      ? "text-[var(--accent)]"
      : item.type === "economic-event"
      ? "text-amber-400"
      : "text-fg-muted";

  return (
    <div className="border-b border-line-muted/60 px-3 py-2 themed hover:bg-hover/30">
      {/* Header: type + time */}
      <div className="mb-1 flex items-center gap-1.5 text-[8px] uppercase tracking-wide">
        <span className={cn("font-bold", typeColor)}>
          {item.type === "economic-event" ? "Economic" : item.type}
        </span>
        <span className="text-fg-faint">·</span>
        <span className="text-fg-faint">{timeLabel}</span>
        {item.symbols.length > 0 && (
          <>
            <span className="text-fg-faint">·</span>
            <span className="font-mono text-fg-muted">
              {item.symbols.slice(0, 3).join(" · ")}
            </span>
          </>
        )}
      </div>

      {/* Headline */}
      <p className="text-[11px] font-semibold leading-snug text-fg">
        {item.headline}
      </p>

      {/* Summary */}
      {item.summary && (
        <p className="mt-1 text-[10px] leading-relaxed text-fg-muted line-clamp-3">
          {item.summary}
        </p>
      )}

      {/* Footer: source + actions */}
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[9px] text-fg-faint">
          {item.source}
        </span>
        <div className="flex items-center gap-1">
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] text-fg-muted hover:bg-hover hover:text-fg"
          >
            <ExternalLink className="h-2 w-2" />
            Read
          </a>
          
        </div>
      </div>
    </div>
  );
}

