"use client";

/* LUCIAN Markets — Order Details panel.
 *
 * Replaces the Instruments panel in the left contextual area when the
 * user clicks "New order" in the chart toolbar. Shows market/pending
 * order flows for the currently selected instrument.
 *
 *   ┌────────────────────────────────────┐
 *   │ {SYMBOL} order details         X   │  header
 *   ├────────────────────────────────────┤
 *   │ Market order  |  Pending order      │  tabs
 *   ├────────────────────────────────────┤
 *   │ Sell          |          Buy        │
 *   │ SELL_PRICE    |        BUY_PRICE    │
 *   ├────────────────────────────────────┤
 *   │ Order volume     0.01  [−] [+]      │
 *   │ Monetary equivalent    $X.XX        │
 *   │ Take Profit              +          │
 *   │ Stop Loss                 +         │
 *   │ Required / Free margin   $X / $Y     │
 *   ├────────────────────────────────────┤
 *   │ [        Open order        ]        │
 *   └────────────────────────────────────┘
 *
 * Behavior:
 *  - "Open order" / "Place order" wires into the Virtual (paper) trading
 *    engine via useMarketsStore.placeMarketOrder / placePending.
 *  - Pending entry price stepper also propagates a price line on the chart
 *    via onPendingPriceChange (so the user sees where their pending order
 *    will trigger).
 *  - X closes Order Details and returns the left panel to Instruments.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMarketsStore } from "@/store/markets";
import { getInstrumentBySymbol } from "@/lib/markets/catalog";
import { isSupportedCrypto } from "@/lib/markets/symbol-mapping";
import {
  getSpecForSymbol,
  requiredMargin as calcRequiredMargin,
  notionalValue,
  formatVolume,
  validateVolume,
} from "@/lib/markets/instrument-spec";
import type { DataStatus, OrderType } from "@/lib/markets/types";
import { BybitOrderForm } from "@/components/markets/bybit-order-form";

type OrderTab = "market" | "pending";

interface Props {
  onClose: () => void;
  onPendingPriceChange: (price: number | null) => void;
  /** Phase 3: when the chart's quick-trade BUY/SELL button is clicked,
   *  MarketsFrame sets this to preselect the market-order tab with the
   *  chosen side already highlighted. The panel consumes it once on
   *  mount via `onSideConsumed`. */
  preselectedSide?: "buy" | "sell" | null;
  onSideConsumed?: () => void;
}

export function OrderDetailsPanel({
  onClose,
  onPendingPriceChange,
  preselectedSide,
  onSideConsumed,
}: Props) {
  // OrderDetails follows the ACTIVE chart pane — not just pane 0. This
  // means clicking any chart pane instantly updates which instrument's
  // order details are shown here, matching the Phase 1 active-pane
  // synchronization requirement.
  const activePaneIndex = useMarketsStore((s) => s.activePaneIndex);
  const accountMode = useMarketsStore((s) => s.accountMode);
  const paneStates = useMarketsStore((s) => s.paneStates);
  const pane = paneStates[activePaneIndex] ?? paneStates[0];
  const liveSymbol = pane?.symbol ?? null;
  const liveTimeframe = pane?.timeframe ?? "M1";

  // Subscribe to live price + ticker for the active pane symbol.
  const livePrice = useMarketsStore((s) =>
    liveSymbol ? s.prices.get(liveSymbol) : undefined,
  );
  const ticker = useMarketsStore((s) =>
    liveSymbol ? s.tickers.get(liveSymbol) : undefined,
  );
  const status: DataStatus = useMarketsStore((s) =>
    liveSymbol
      ? s.statusBySymbol.get(liveSymbol) ??
        (isSupportedCrypto(liveSymbol) ? "live" : "setup-required")
      : "setup-required",
  );
  const [tab, setTab] = useState<OrderTab>("market");
  // Phase 3: highlighted side — derived directly from the preselectedSide
  // prop. When MarketsFrame passes a side (chart BUY/SELL quick-trade
  // clicked), we switch to the market tab + highlight the matching card.
  // The highlight clears when MarketsFrame sets preselectedSide back to
  // null (via onSideConsumed). No useEffect needed — derived state only.
  const highlightedSide = preselectedSide;
  // Default the tab to "market" whenever a side is preselected. Done via
  // a derived tab value rather than an effect to avoid cascading renders.
  const effectiveTab = preselectedSide ? "market" : tab;

  // Look up the instrument's bid/ask/changePct from the catalog.
  const inst = useMemo(
    () =>
      (liveSymbol ? getInstrumentBySymbol(liveSymbol) : null) ??
      getInstrumentBySymbol("BTCUSD")!,
    [liveSymbol],
  );

  // Live bid/ask: prefer ticker bid/ask → live trade price → catalog snapshot.
  // For non-crypto (no provider), this falls back to the catalog snapshot.
  const SELL_PRICE = ticker?.bidPrice ?? livePrice ?? inst.bid;
  const BUY_PRICE = ticker?.askPrice ?? livePrice ?? inst.ask;

  // Status badge shown next to the symbol in the panel header.
  const isLive = isSupportedCrypto(inst.symbol);

  return (
    <div className="themed flex h-full min-h-0 w-full flex-col bg-surface text-fg">
      {/* ── Header ── */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line-muted px-3">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] font-semibold tracking-wide text-fg">
            {inst.symbol} order details
          </span>
          <OrderStatusPill status={status} live={isLive} timeframe={liveTimeframe} />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close order details"
          title="Close"
          className="text-fg-faint transition-colors hover:text-fg"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Tab strip ── */}
      {accountMode === "paper" && <div className="flex shrink-0 border-b border-line-muted">
        <TabBtn
          label="Market order"
          active={effectiveTab === "market"}
          onClick={() => {
            setTab("market");
            // Consuming the preselected side clears the highlight.
            onSideConsumed?.();
          }}
        />
        <TabBtn
          label="Pending order"
          active={effectiveTab === "pending"}
          onClick={() => {
            setTab("pending");
            onSideConsumed?.();
          }}
        />
      </div>}

      {/* ── Body ── */}
      <div className="min-h-0 flex-1 overflow-y-auto themed">
        {accountMode !== "paper" ? (
          <BybitOrderForm symbol={inst.symbol} marketPrice={(SELL_PRICE + BUY_PRICE) / 2} />
        ) : effectiveTab === "market" ? (
          <MarketOrderBody
            sellPrice={SELL_PRICE}
            buyPrice={BUY_PRICE}
            symbol={inst.symbol}
            highlightedSide={highlightedSide}
          />
        ) : (
          <PendingOrderBody
            sellPrice={SELL_PRICE}
            buyPrice={BUY_PRICE}
            symbol={inst.symbol}
            precision={inst.pricePrecision}
            onPendingPriceChange={onPendingPriceChange}
          />
        )}
      </div>
    </div>
  );
}

/* ── Market order body ── */

function MarketOrderBody({
  sellPrice,
  buyPrice,
  symbol,
  highlightedSide,
}: {
  sellPrice: number;
  buyPrice: number;
  symbol: string;
  highlightedSide?: "buy" | "sell" | null;
}) {
  const spec = getSpecForSymbol(symbol);
  const [volume, setVolume] = useState(spec.minVolume);
  const [tpOpen, setTpOpen] = useState(false);
  const [slOpen, setSlOpen] = useState(false);
  const [tpValue, setTpValue] = useState(0);
  const [slValue, setSlValue] = useState(0);
  const [result, setResult] = useState<string | null>(null);

  const placeMarketOrder = useMarketsStore((s) => s.placeMarketOrder);
  const account = useMarketsStore((s) => s.account);

  // Validate volume against the spec (min/max/step).
  const volCheck = validateVolume(spec, volume);
  const safeVolume = volCheck.ok ? volCheck.volume : spec.minVolume;

  // Notional exposure (full position value, NOT margin).
  const mid = (sellPrice + buyPrice) / 2;
  const notional = notionalValue(spec, safeVolume, mid);
  // Required margin = notional / leverage.
  const margin = calcRequiredMargin(spec, safeVolume, mid);
  const freeMargin = account?.freeMargin ?? 0;
  const insufficient = margin > freeMargin;

  const setVol = (next: number) => {
    const v = validateVolume(spec, next);
    if (v.ok) setVolume(v.volume);
  };

  const handleSell = () => {
    if (!volCheck.ok) {
      setResult(volCheck.error);
      setTimeout(() => setResult(null), 2500);
      return;
    }
    if (insufficient) {
      setResult(`Insufficient free margin: need $${margin.toFixed(2)}, have $${freeMargin.toFixed(2)}.`);
      setTimeout(() => setResult(null), 2500);
      return;
    }
    const r = placeMarketOrder(
      symbol,
      "sell",
      sellPrice,
      safeVolume,
      slValue,
      tpValue,
    );
    setResult(r.success ? "Sell order opened" : r.error ?? "Order failed");
    setTimeout(() => setResult(null), 2000);
  };
  const handleBuy = () => {
    if (!volCheck.ok) {
      setResult(volCheck.error);
      setTimeout(() => setResult(null), 2500);
      return;
    }
    if (insufficient) {
      setResult(`Insufficient free margin: need $${margin.toFixed(2)}, have $${freeMargin.toFixed(2)}.`);
      setTimeout(() => setResult(null), 2500);
      return;
    }
    const r = placeMarketOrder(
      symbol,
      "buy",
      buyPrice,
      safeVolume,
      slValue,
      tpValue,
    );
    setResult(r.success ? "Buy order opened" : r.error ?? "Order failed");
    setTimeout(() => setResult(null), 2000);
  };

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* Sell / Buy price cards */}
      <div className="grid grid-cols-2 gap-2">
        <PriceCard label="Sell" price={sellPrice} color="#f23645" onClick={handleSell} highlighted={highlightedSide === "sell"} />
        <PriceCard label="Buy" price={buyPrice} color="#089981" onClick={handleBuy} highlighted={highlightedSide === "buy"} />
      </div>

      {/* Order volume stepper */}
      <Field label={`Order volume (lots, min ${spec.minVolume})`}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] tabular-nums text-white">
            {formatVolume(spec, volume)}
          </span>
          <div className="ml-auto flex gap-1">
            <StepBtn
              onClick={() => setVol(+(volume - spec.volumeStep).toFixed(4))}
              label="−"
            />
            <StepBtn
              onClick={() => setVol(+(volume + spec.volumeStep).toFixed(4))}
              label="+"
            />
          </div>
        </div>
      </Field>

      <Field label="Notional exposure">
        <span className="font-mono text-[12px] tabular-nums text-white">
          ${notional.toFixed(2)}
        </span>
      </Field>

      <Field label={`Required / Free margin (${spec.leverage}× leverage)`}>
        <span
          className={cn(
            "font-mono text-[12px] tabular-nums",
            insufficient ? "text-[#f23645]" : "text-white",
          )}
        >
          ${margin.toFixed(2)} / ${freeMargin.toFixed(2)}
        </span>
      </Field>

      {!volCheck.ok && (
        <div className="rounded border border-[#f5a623]/40 bg-[#f5a623]/10 px-2 py-1 text-[10px] text-[#f5a623]">
          {volCheck.error}
        </div>
      )}
      {insufficient && volCheck.ok && (
        <div className="rounded border border-[#f23645]/40 bg-[#f23645]/10 px-2 py-1 text-[10px] text-[#f23645]">
          Insufficient free margin for this trade size.
        </div>
      )}

      {/* Expandable Take Profit */}
      <Expandable
        label="Take Profit"
        open={tpOpen}
        onToggle={() => setTpOpen((v) => !v)}
      >
        <div className="flex items-center gap-2 pb-2">
          <input
            type="number"
            value={tpValue || ""}
            onChange={(e) => setTpValue(+e.target.value)}
            placeholder="0.00"
            className="w-full rounded bg-surface-2 px-2 py-1 text-[11px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)] themed"
          />
        </div>
      </Expandable>

      {/* Expandable Stop Loss */}
      <Expandable
        label="Stop Loss"
        open={slOpen}
        onToggle={() => setSlOpen((v) => !v)}
      >
        <div className="flex items-center gap-2 pb-2">
          <input
            type="number"
            value={slValue || ""}
            onChange={(e) => setSlValue(+e.target.value)}
            placeholder="0.00"
            className="w-full rounded bg-surface-2 px-2 py-1 text-[11px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)] themed"
          />
        </div>
      </Expandable>

      {/* Submit + result message */}
      {result && (
        <div className="rounded border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-2 py-1 text-[10px] text-fg">
          {result}
        </div>
      )}
    </div>
  );
}

/* ── Pending order body ──
 *
 * Phase 2: replaces the ambiguous "Sell Stop / Buy Limit" 2-card layout
 * with 4 explicit order-type cards. The selected card's `orderType` is
 * stored EXACTLY as the engine expects it — no more UI label vs stored
 * type mismatch.
 *
 *   Buy Limit  → buy when price FALLS to or below entry  (entry < current)
 *   Buy Stop   → buy when price RISES to or above entry (entry > current)
 *   Sell Limit → sell when price RISES to or above entry (entry > current)
 *   Sell Stop  → sell when price FALLS to or below entry (entry < current)
 *
 * Each card also pre-loads the entry price with a sensible default
 * (slightly below for Buy Limit / Sell Stop; slightly above for Buy
 * Stop / Sell Limit) so the trader can confirm + adjust rather than
 * type from scratch.
 */

const PENDING_ORDER_TYPES: Array<{
  orderType: Exclude<OrderType, "market">;
  label: string;
  color: string;
  description: string;
}> = [
  {
    orderType: "buy_limit",
    label: "Buy Limit",
    color: "#089981",
    description: "Buy when price falls to entry",
  },
  {
    orderType: "buy_stop",
    label: "Buy Stop",
    color: "#089981",
    description: "Buy when price rises to entry",
  },
  {
    orderType: "sell_limit",
    label: "Sell Limit",
    color: "#f23645",
    description: "Sell when price rises to entry",
  },
  {
    orderType: "sell_stop",
    label: "Sell Stop",
    color: "#f23645",
    description: "Sell when price falls to entry",
  },
];

function PendingOrderBody({
  sellPrice,
  buyPrice,
  symbol,
  precision,
  onPendingPriceChange,
}: {
  sellPrice: number;
  buyPrice: number;
  symbol: string;
  precision: number;
  onPendingPriceChange: (price: number | null) => void;
}) {
  const spec = getSpecForSymbol(symbol);
  const mid = (sellPrice + buyPrice) / 2;

  // Default entry price: a small offset from mid so the pending order
  // is actually pending (not immediately triggered). One tick below
  // for buy_limit/sell_stop, one tick above for buy_stop/sell_limit.
  const tick = Math.pow(10, -precision);
  const computeDefaultEntry = (orderType: Exclude<OrderType, "market">) => {
    const isBelow = orderType === "buy_limit" || orderType === "sell_stop";
    return +(mid + (isBelow ? -tick * 10 : tick * 10)).toFixed(precision);
  };
  const [selectedType, setSelectedTypeRaw] = useState<Exclude<OrderType, "market">>("buy_limit");
  const [entryPrice, setEntryPrice] = useState<number>(() => computeDefaultEntry("buy_limit"));
  // When the user changes the order type, re-seed the entry price to a
  // sensible default so the chart's pending-order line jumps to the
  // right place immediately. Done inside the click handler (not an
  // effect) so we don't trigger cascading renders.
  const setSelectedType = (next: Exclude<OrderType, "market">) => {
    setSelectedTypeRaw(next);
    setEntryPrice(computeDefaultEntry(next));
  };
  const [volume, setVolume] = useState(spec.minVolume);
  const [tpOpen, setTpOpen] = useState(false);
  const [slOpen, setSlOpen] = useState(false);
  const [tpValue, setTpValue] = useState(0);
  const [slValue, setSlValue] = useState(0);
  const [result, setResult] = useState<string | null>(null);

  const placePending = useMarketsStore((s) => s.placePending);
  const account = useMarketsStore((s) => s.account);

  // Validate volume against the spec.
  const volCheck = validateVolume(spec, volume);
  const safeVolume = volCheck.ok ? volCheck.volume : spec.minVolume;

  // Distance from current mid → entry price (in points).
  const distance = Math.abs(entryPrice - mid) * Math.pow(10, precision);
  const notional = notionalValue(spec, safeVolume, entryPrice);
  const margin = calcRequiredMargin(spec, safeVolume, entryPrice);
  const freeMargin = account?.freeMargin ?? 0;
  const insufficient = margin > freeMargin;

  const setVol = (next: number) => {
    const v = validateVolume(spec, next);
    if (v.ok) setVolume(v.volume);
  };

  // Propagate the entry price to the chart's pending-order line.
  useEffect(() => {
    onPendingPriceChange(entryPrice);
    return () => onPendingPriceChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryPrice]);

  const handlePlace = () => {
    if (!volCheck.ok) {
      setResult(volCheck.error);
      setTimeout(() => setResult(null), 2500);
      return;
    }
    if (insufficient) {
      setResult(`Insufficient free margin: need $${margin.toFixed(2)}, have $${freeMargin.toFixed(2)}.`);
      setTimeout(() => setResult(null), 2500);
      return;
    }
    // Derive side from the order type — this guarantees the stored
    // `orderType` and `side` are always consistent.
    const side = selectedType.startsWith("buy") ? "buy" : "sell";
    const r = placePending(
      symbol,
      side,
      selectedType,
      entryPrice,
      safeVolume,
      slValue,
      tpValue,
    );
    setResult(
      r.success
        ? `${PENDING_ORDER_TYPES.find((t) => t.orderType === selectedType)?.label} placed`
        : r.error ?? "Order failed",
    );
    setTimeout(() => setResult(null), 2500);
  };

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* 4 explicit order-type cards */}
      <div className="grid grid-cols-2 gap-2">
        {PENDING_ORDER_TYPES.map((t) => (
          <OrderTypeCard
            key={t.orderType}
            label={t.label}
            description={t.description}
            color={t.color}
            selected={selectedType === t.orderType}
            onClick={() => setSelectedType(t.orderType)}
          />
        ))}
      </div>

      {/* Create pending order caption */}
      <div className="pt-1 text-[10px] text-fg-muted">Create pending order</div>

      {/* Entry price stepper */}
      <Field label="Entry price">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] tabular-nums text-white">
            {entryPrice.toFixed(precision)}
          </span>
          <div className="ml-auto flex gap-1">
            <StepBtn
              onClick={() =>
                setEntryPrice((p) => +(p - tick).toFixed(precision))
              }
              label="−"
            />
            <StepBtn
              onClick={() =>
                setEntryPrice((p) => +(p + tick).toFixed(precision))
              }
              label="+"
            />
          </div>
        </div>
      </Field>

      {/* Distance */}
      <Field label="Distance from market">
        <span className="font-mono text-[12px] tabular-nums text-white">
          {distance.toFixed(1)} points
        </span>
      </Field>

      {/* Order volume */}
      <Field label={`Order volume (lots, min ${spec.minVolume})`}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] tabular-nums text-white">
            {formatVolume(spec, volume)}
          </span>
          <div className="ml-auto flex gap-1">
            <StepBtn
              onClick={() => setVol(+(volume - spec.volumeStep).toFixed(4))}
              label="−"
            />
            <StepBtn
              onClick={() => setVol(+(volume + spec.volumeStep).toFixed(4))}
              label="+"
            />
          </div>
        </div>
      </Field>

      <Field label="Notional exposure">
        <span className="font-mono text-[12px] tabular-nums text-white">
          ${notional.toFixed(2)}
        </span>
      </Field>

      <Field label={`Required / Free margin (${spec.leverage}× leverage)`}>
        <span
          className={cn(
            "font-mono text-[12px] tabular-nums",
            insufficient ? "text-[#f23645]" : "text-white",
          )}
        >
          ${margin.toFixed(2)} / ${freeMargin.toFixed(2)}
        </span>
      </Field>

      {!volCheck.ok && (
        <div className="rounded border border-[#f5a623]/40 bg-[#f5a623]/10 px-2 py-1 text-[10px] text-[#f5a623]">
          {volCheck.error}
        </div>
      )}
      {insufficient && volCheck.ok && (
        <div className="rounded border border-[#f23645]/40 bg-[#f23645]/10 px-2 py-1 text-[10px] text-[#f23645]">
          Insufficient free margin for this trade size.
        </div>
      )}

      {/* Expandable SL/TP */}
      <Expandable label="Take Profit" open={tpOpen} onToggle={() => setTpOpen((v) => !v)}>
        <input
          type="number"
          value={tpValue || ""}
          onChange={(e) => setTpValue(+e.target.value)}
          placeholder="0.00"
          className="w-full rounded bg-surface-2 px-2 py-1 text-[11px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)] themed"
        />
      </Expandable>
      <Expandable label="Stop Loss" open={slOpen} onToggle={() => setSlOpen((v) => !v)}>
        <input
          type="number"
          value={slValue || ""}
          onChange={(e) => setSlValue(+e.target.value)}
          placeholder="0.00"
          className="w-full rounded bg-surface-2 px-2 py-1 text-[11px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)] themed"
        />
      </Expandable>

      {/* Submit + result */}
      {result && (
        <div className="rounded border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-2 py-1 text-[10px] text-fg">
          {result}
        </div>
      )}

      {/* Place order button — uses the selected orderType, not a hardcoded side. */}
      <button
        type="button"
        onClick={handlePlace}
        className="mt-1 rounded bg-[#2962ff] py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
      >
        Place {PENDING_ORDER_TYPES.find((t) => t.orderType === selectedType)?.label}
      </button>
    </div>
  );
}

/* ── Order-type card — selectable, with label + description ── */
function OrderTypeCard({
  label,
  description,
  color,
  selected,
  onClick,
}: {
  label: string;
  description: string;
  color: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-start rounded border px-2 py-1.5 text-left transition-colors",
        selected
          ? "border-2 text-white"
          : "border-line-muted text-fg hover:bg-hover",
      )}
      style={selected ? { borderColor: color, background: `${color}20` } : {}}
    >
      <span
        className="text-[11px] font-bold uppercase tracking-wide"
        style={{ color: selected ? color : undefined }}
      >
        {label}
      </span>
      <span className="text-[9px] text-fg-faint">{description}</span>
    </button>
  );
}

/* ── Sub-components ── */

function TabBtn({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 py-2 text-[11px] font-medium transition-colors themed",
        active
          ? "border-b-2 border-[var(--accent)] text-fg"
          : "text-fg-muted hover:text-fg",
      )}
    >
      {label}
    </button>
  );
}

function PriceCard({
  label,
  price,
  color,
  onClick,
  highlighted = false,
}: {
  label: string;
  price: number;
  color: string;
  onClick: () => void;
  highlighted?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col items-center rounded px-3 py-2 text-white transition-all hover:opacity-90",
        highlighted && "ring-2 ring-white ring-offset-1 ring-offset-transparent",
      )}
      style={{ background: color }}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide opacity-90">
        {label}
      </span>
      <span className="font-mono text-[13px] tabular-nums font-bold">
        {price.toFixed(5)}
      </span>
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between rounded bg-surface-2/60 px-2 py-1.5 themed">
      <span className="text-[10px] text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

function StepBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-5 w-5 items-center justify-center rounded bg-surface-2 text-[12px] font-bold text-fg-muted transition-colors hover:bg-hover hover:text-fg"
    >
      {label}
    </button>
  );
}

function Expandable({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded bg-surface-2/60 themed">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-2 py-1.5 text-left text-[10px] text-fg-muted hover:text-fg"
      >
        <span>{label}</span>
        <Plus
          className={cn(
            "h-3 w-3 transition-transform",
            open && "rotate-45",
          )}
        />
      </button>
      {open && <div className="px-2 pb-1">{children}</div>}
    </div>
  );
}

/* ── Status pill shown in the OrderDetails header ──
   Tells the user at a glance whether the prices they're about to trade on
   are LIVE (provider-connected), REFERENCE (catalog snapshot — no live
   provider for this asset class), or UNAVAILABLE (live provider is
   temporarily disconnected). The active timeframe is shown alongside
   so the trader knows which candle context the order is anchored to. */
function OrderStatusPill({
  status,
  live,
  timeframe,
}: {
  status: DataStatus;
  live: boolean;
  timeframe: string;
}) {
  if (!live) {
    return (
      <span className="rounded border border-line-muted px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide text-fg-faint">
        {timeframe} · Reference
      </span>
    );
  }
  const label =
    status === "live"
      ? "Live"
      : status === "disconnected"
      ? "Unavailable"
      : status === "delayed"
      ? "Delayed"
      : "Setup";
  const color =
    status === "live"
      ? "#4bfa8f"
      : status === "disconnected"
      ? "#ff5b5b"
      : status === "delayed"
      ? "#f5a623"
      : "#9ea3ab";
  return (
    <span
      className="flex items-center gap-0.5 rounded border px-1 py-0.5 text-[8px] font-bold uppercase tracking-wide"
      style={{ color, borderColor: `${color}40` }}
    >
      {status === "live" && (
        <span
          className="h-1 w-1 rounded-full"
          style={{ background: color }}
        />
      )}
      {timeframe} · {label}
    </span>
  );
}
