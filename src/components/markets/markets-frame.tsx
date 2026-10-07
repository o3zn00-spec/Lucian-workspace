"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeftRight,
  History,
  Sun,
  Moon,
  BellRing,
} from "lucide-react";
import { BrandMark } from "@/components/branding/BrandMark";
import { InstrumentsPanel } from "@/components/markets/instruments-panel";
import { OrderDetailsPanel } from "@/components/markets/order-details-panel";
import { ChartWorkspace } from "@/components/markets/chart-workspace";
import { IntelligencePanel } from "@/components/markets/intelligence-panel";
import { PriceAlertsDialog } from "@/components/markets/price-alerts-dialog";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/theme/ThemeProvider";
import type { ThemeId } from "@/lib/themes";
import { useMarketsStore } from "@/store/markets";
import {
  AccountActionDialog,
  OperationHistoryDrawer,
  type AccountActionKind,
} from "@/components/markets/account-dialogs";
import { useBybitTerminal } from "@/hooks/use-bybit-terminal";
import { getLucianBase } from "@/lib/markets/symbol-mapping";

/* ------------------------------------------------------------------ */
/* Theme-aware tokens                                                  */
/* ------------------------------------------------------------------ */
/* Markets uses the global LUCIAN theme system (data-theme on <html>).
   These tokens map the global CSS variables to local classnames so the
   Markets page re-themes together with the rest of the workspace. */

const SURFACE_RAIL = "themed bg-surface border-r border-line-muted";
const SURFACE_TOP = "themed bg-surface border-b border-line-muted";
const SURFACE_ACCT = "themed bg-surface border-b border-line-muted";
const INACTIVE = "text-fg-faint hover:bg-hover hover:text-fg";
const ACTIVE = "bg-active text-fg";
const RAIL_SEPARATOR = "border-b border-line-muted/60";
const TOPBAR_LABEL = "text-fg-muted";
const TOPBAR_VALUE = "text-fg";
const TOGGLE_BASE = "text-fg-faint hover:bg-hover hover:text-fg themed";

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function MarketsFrame() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [panelOpen, setPanelOpen] = useState(true);
  const leftPanelMode = useMarketsStore((s) => s.leftPanelMode);
  const setLeftPanelMode = useMarketsStore((s) => s.setLeftPanelMode);
  const setToggleInstrumentsHandler = useMarketsStore(
    (s) => s.setToggleInstrumentsHandler,
  );

  // ── Phase 3: account mode + live account state ──
  const accountMode = useMarketsStore((s) => s.accountMode);
  const setAccountMode = useMarketsStore((s) => s.setAccountMode);
  const account = useMarketsStore((s) => s.account);

  // ── Phase 3: pending-order side preselect (for chart BUY/SELL quick-trade) ──
  // When the chart's CompactQuickTrade BUY/SELL button is clicked, the
  // chart-pane calls `setLeftPanelMode("order")` + sets a pending side
  // preference that OrderDetailsPanel reads to default its tab.
  const [pendingOrderSide, setPendingOrderSide] = useState<"buy" | "sell" | null>(null);

  // Format currency for account display
  const fmt = (n: number) =>
    n.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const paneStates = useMarketsStore((s) => s.paneStates);
  const activePaneIndex = useMarketsStore((s) => s.activePaneIndex);
  const terminalSymbol = `${getLucianBase(paneStates[activePaneIndex]?.symbol ?? "BTCUSD")}USDT`;
  const bybitMode = accountMode === "paper" ? null : accountMode;
  const terminal = useBybitTerminal(bybitMode, terminalSymbol, "linear");

  // Account values from the paper engine or the authenticated Bybit account.
  // For Real mode these are null because no broker is connected —
  // the strip shows honest "Not connected" values in that case.
  const isVirtual = accountMode === "paper";
  const balance = isVirtual ? (account?.balance ?? 0) : null;
  const equity = isVirtual ? (account?.equity ?? 0) : Number(terminal.data?.portfolio.totalEquity ?? 0);
  const margin = isVirtual ? (account?.margin ?? 0) : Number(terminal.data?.portfolio.totalInitialMargin ?? 0);
  const freeMargin = isVirtual ? (account?.freeMargin ?? 0) : Number(terminal.data?.portfolio.totalAvailableBalance ?? 0);
  const marginLevel = isVirtual ? (account?.marginLevel ?? 0) : margin && equity ? (equity / margin) * 100 : 0;
  const floatingPnl = isVirtual ? (account?.floatingPnl ?? 0) : Number(terminal.data?.portfolio.totalPerpUPL ?? 0);

  // ── Dialog state ──
  const [accountAction, setAccountAction] = useState<AccountActionKind | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Phase 10: price alerts dialog state.
  const [alertsOpen, setAlertsOpen] = useState(false);

  const isLight = useMemo(() => {
    return (
      theme === "natural-white" ||
      theme === "creamy-light"
    );
  }, [theme]);

  const toggleTheme = () => {
    const next: ThemeId = isLight ? "midnight-gray" : "natural-white";
    setTheme(next);
  };

  // Register the toggleInstruments handler in the store so the chart
  // toolbar (which lives deep inside ChartWorkspace) can toggle the
  // Instruments panel without prop drilling. Updates on every render
  // so the latest panelOpen is captured.
  useEffect(() => {
    setToggleInstrumentsHandler(() => () => {
      setPanelOpen((v) => !v);
      // Always switch back to "instruments" mode when toggling via the
      // chart toolbar so the user sees the Instruments list, not Order
      // Details, after clicking the symbol.
      setLeftPanelMode("instruments");
    });
    return () => setToggleInstrumentsHandler(undefined);
  }, [setToggleInstrumentsHandler, setLeftPanelMode]);

  // Initialize the markets store + refresh trading state on mount.
  useEffect(() => {
    useMarketsStore.getState().initialize();
    useMarketsStore.getState().refreshTrading();
  }, []);

  const handleRailInstrumentsClick = () => {
    if (!panelOpen) {
      setPanelOpen(true);
      setLeftPanelMode("instruments");
    } else if (leftPanelMode === "instruments") {
      setPanelOpen(false);
    } else {
      // Panel is open in "order" mode → clicking the rail's Instruments
      // button switches back to instruments mode.
      setLeftPanelMode("instruments");
    }
  };

  return (
    <div className="themed flex h-full min-h-0 overflow-hidden bg-canvas text-fg">
      {/* ── LEFT VERTICAL RAIL (88px) — desktop only ── */}
      {/* Phase 17 responsive: rail is hidden on mobile (lg:flex). Mobile
          users get a horizontal scrollable toolbar rendered below the
          account metrics strip. */}
      <div
        className={cn(
          "hidden lg:flex w-[88px] shrink-0 flex-col items-center py-3",
          SURFACE_RAIL,
        )}
      >
        {/* LUCIAN logo at top */}
        <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-line-muted bg-surface-2">
          <BrandMark size={24} />
        </div>

        {/* Thin separator under logo */}
        <div className="mb-2 h-px w-12 bg-line-muted/60" />

        {/* Tools: icon → label → separator */}
        <RailBtn
          icon={BarChart3}
          label="Instruments"
          active={panelOpen && leftPanelMode === "instruments"}
          onClick={handleRailInstrumentsClick}
        />
        <RailBtn
          icon={ArrowDownToLine}
          label="Deposit"
          onClick={() => setAccountAction("deposit")}
        />
        <RailBtn
          icon={ArrowUpFromLine}
          label="Withdraw"
          onClick={() => setAccountAction("withdraw")}
        />
        <RailBtn
          icon={ArrowLeftRight}
          label="Transfer"
          onClick={() => setAccountAction("transfer")}
        />
        <RailBtn
          icon={History}
          label="Operation History"
          twoLine
          onClick={() => setHistoryOpen(true)}
        />
        <RailBtn
          icon={BellRing}
          label="Price Alerts"
          twoLine
          onClick={() => setAlertsOpen(true)}
        />

        {/* Spacer pushes the toggle to the bottom */}
        <div className="flex-1" />

        {/* Light / Dark toggle — uses the real LUCIAN theme system */}
        <button
          type="button"
          title={isLight ? "Switch to Dark" : "Switch to Light"}
          aria-label={isLight ? "Switch to Dark" : "Switch to Light"}
          onClick={toggleTheme}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-md transition-colors",
            TOGGLE_BASE,
          )}
        >
          {isLight ? (
            <Moon className="h-[18px] w-[18px]" />
          ) : (
            <Sun className="h-[18px] w-[18px]" />
          )}
        </button>
      </div>

      {/* ── LEFT CONTEXTUAL PANEL (260px) ── conditional on panelOpen.
          Phase 17 responsive: on mobile, this becomes a slide-over drawer
          (fixed inset-y-0 left-0, full-height, max-w-[85vw]) with a backdrop.
          On lg+, it stays as a static flex sibling. */}
      {panelOpen && (
        <>
          {/* Mobile backdrop */}
          <div
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            onClick={() => setPanelOpen(false)}
            aria-hidden
          />
          <aside
            className={cn(
              "themed w-[260px] max-w-[85vw] shrink-0 border-r border-line-muted bg-surface",
              "fixed inset-y-0 left-0 z-40 lg:static lg:z-0 lg:max-w-none",
            )}
          >
            {leftPanelMode === "instruments" ? (
              <InstrumentsPanel
                onClose={() => setPanelOpen(false)}
                onSelect={(symbol) => {
                  useMarketsStore.getState().selectSymbol(symbol);
                }}
              />
            ) : (
              <OrderDetailsPanel
                onClose={() => setLeftPanelMode("instruments")}
                onPendingPriceChange={() => {}}
                preselectedSide={pendingOrderSide}
                onSideConsumed={() => setPendingOrderSide(null)}
              />
            )}
          </aside>
        </>
      )}

      {/* ── RIGHT SIDE: strips + chart workspace ── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* ── THIN TOP STRIP (32px) ── */}
        <div
          className={cn(
            "flex h-8 shrink-0 items-center px-4",
            SURFACE_TOP,
          )}
        >
          <span className="animate-pulse text-[11px] font-semibold tracking-wide text-[var(--accent)]">
            LUCIAN Markets
          </span>
          {/* Mode indicator on the left of the strip */}
          <span className="ml-3 text-[10px] font-medium uppercase tracking-wide text-fg-faint">
            {accountMode === "paper" ? "Paper" : accountMode === "bybit_testnet" ? "Bybit Testnet" : "Bybit Live · Real Funds"}
          </span>
        </div>

        {/* ── ACCOUNT METRICS STRIP (48px) ──
            Phase 17 responsive: horizontally scrollable on mobile so the
            metrics never overflow the viewport. The mobile toolbar (Instruments,
            Deposit, Withdraw, etc.) is rendered below this strip. */}
        <div
          className={cn(
            "flex h-12 shrink-0 items-center px-4 overflow-x-auto",
            SURFACE_ACCT,
          )}
        >
          {/* LUCIAN brand wordmark at far left — large empty area after it */}
          <span className="mr-2 shrink-0 text-[13px] font-bold text-fg">LUCIAN</span>

          {/* Push account-information group toward the right, near Deposit */}
          <div className="ml-auto flex items-center gap-4">
            {/* Account metrics — live from the paper-trading engine in
                Virtual mode; honest "—" placeholders in Real mode. */}
            <Metric
              label="Margin"
              value={margin !== null ? fmt(margin) : "—"}
            />
            <Metric
              label="Free margin"
              value={freeMargin !== null ? fmt(freeMargin) : "—"}
            />
            <Metric
              label="Margin level"
              value={
                marginLevel !== null
                  ? marginLevel > 0
                    ? `${marginLevel.toFixed(2)}%`
                    : "0.00%"
                  : "—"
              }
            />
            <Metric
              label="Equity"
              value={equity !== null ? fmt(equity) : "—"}
            />
            <Metric
              label="Floating profit"
              value={
                floatingPnl !== null
                  ? fmt(floatingPnl)
                  : "—"
              }
              valueColor={
                floatingPnl !== null
                  ? floatingPnl > 0
                    ? "#4bfa8f"
                    : floatingPnl < 0
                    ? "#ff5b5b"
                    : TOPBAR_VALUE
                  : undefined
              }
            />

            {/* Separator between numeric metrics and Virtual/Real */}
            <div className="h-5 w-px bg-line-muted" />

            {/* Three explicit modes; live is never implied by a generic “real” toggle. */}
            <div className="flex items-center gap-1 rounded border border-line-muted bg-surface-2 p-1">
              <button type="button" aria-label="Use Paper trading mode" aria-pressed={accountMode === "paper"} onClick={() => setAccountMode("paper")}>
              <AccountPill
                label="Paper"
                value={isVirtual && balance !== null ? fmt(balance) : "—"}
                accent="green"
                active={isVirtual}
              />
              </button>
              <button type="button" aria-label="Use Bybit Testnet mode" aria-pressed={accountMode === "bybit_testnet"} onClick={() => setAccountMode("bybit_testnet")}>
              <AccountPill
                label="Bybit Testnet"
                value={accountMode === "bybit_testnet" ? terminal.data ? `${Number(terminal.data.portfolio.totalEquity).toFixed(2)} USDT` : terminal.loading ? "Connecting…" : "Setup required" : "—"}
                accent="blue"
                active={accountMode === "bybit_testnet"}
              />
              </button>
              <button type="button" aria-label="Use Bybit Live mode with real funds" aria-pressed={accountMode === "bybit_live"} onClick={() => setAccountMode("bybit_live")}>
                <AccountPill label="Bybit Live" value={accountMode === "bybit_live" ? terminal.data ? `${Number(terminal.data.portfolio.totalEquity).toFixed(2)} USDT` : terminal.loading ? "Connecting…" : "Locked / setup" : "—"} accent="red" active={accountMode === "bybit_live"} />
              </button>
            </div>

            {!isVirtual && terminal.error && (
              <button
                type="button"
                data-navigation-target="/settings?section=connections"
                onClick={() => router.push("/settings?section=connections")}
                className="shrink-0 rounded-[6px] border border-line-muted px-3 py-1.5 text-[11px] font-semibold text-fg hover:bg-hover"
              >
                Configure Bybit
              </button>
            )}

            {/* Deposit button — opens the account-action dialog (Virtual:
                Reset to $1,000; Real: broker-required state). */}
            <button
              type="button"
              data-navigation-target={!isVirtual ? "/vault" : undefined}
              onClick={() => { if (!isVirtual) router.push("/vault"); else setAccountAction("deposit"); }}
              className="shrink-0 rounded-[6px] bg-[var(--accent)] px-5 py-1.5 text-[12px] font-semibold text-[var(--accent-fg)] shadow-sm transition-colors hover:bg-[var(--accent-hover)] themed"
            >
              {isVirtual ? "Add sandbox funds" : "Open Vault"}
            </button>
          </div>
        </div>

        {/* ── MOBILE TOOLBAR (lg:hidden) ──
            Phase 17 responsive: replaces the desktop left rail on mobile.
            Horizontally scrollable strip of icon+label buttons matching
            the rail's actions. */}
        <div
          className={cn(
            "flex h-12 shrink-0 items-center gap-2 overflow-x-auto px-3 lg:hidden",
            SURFACE_RAIL,
          )}
        >
          <MobileRailBtn
            icon={BarChart3}
            label="Instruments"
            active={panelOpen && leftPanelMode === "instruments"}
            onClick={handleRailInstrumentsClick}
          />
          <MobileRailBtn
            icon={ArrowDownToLine}
            label="Deposit"
            onClick={() => setAccountAction("deposit")}
          />
          <MobileRailBtn
            icon={ArrowUpFromLine}
            label="Withdraw"
            onClick={() => setAccountAction("withdraw")}
          />
          <MobileRailBtn
            icon={ArrowLeftRight}
            label="Transfer"
            onClick={() => setAccountAction("transfer")}
          />
          <MobileRailBtn
            icon={History}
            label="History"
            onClick={() => setHistoryOpen(true)}
          />
          <MobileRailBtn
            icon={BellRing}
            label="Alerts"
            onClick={() => setAlertsOpen(true)}
          />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              title={isLight ? "Switch to Dark" : "Switch to Light"}
              aria-label={isLight ? "Switch to Dark" : "Switch to Light"}
              onClick={toggleTheme}
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors",
                TOGGLE_BASE,
              )}
            >
              {isLight ? (
                <Moon className="h-[18px] w-[18px]" />
              ) : (
                <Sun className="h-[18px] w-[18px]" />
              )}
            </button>
          </div>
        </div>

        {/* Center + right: chart workspace and Intelligence panel share
            the remaining width as flex siblings so the chart resizes
            when the Intelligence panel expands/collapses.
            Phase 17 responsive: IntelligencePanel is hidden on mobile
            (lg:flex). Its chat + feed features are desktop-only; mobile
            users see only the chart workspace. */}
        <div className="flex min-h-0 min-w-0 flex-1">
          {/* Center trading workspace (chart + drawing rail + bottom panel) */}
          <ChartWorkspace
            pendingOrderPriceOverride={null}
            onQuickTrade={(side) => {
              // Chart BUY/SELL quick-trade button → open OrderDetails
              // with the active pane's symbol + preselected side.
              setLeftPanelMode("order");
              setPanelOpen(true);
              setPendingOrderSide(side);
            }}
          />

          {/* Right Markets intelligence area (Chat + Feed) — desktop only */}
          <div className="hidden lg:flex">
            <IntelligencePanel />
          </div>
        </div>
      </div>

      {/* ── Dialogs ── */}
      {accountAction && (
        <AccountActionDialog
          action={accountAction}
          onClose={() => setAccountAction(null)}
        />
      )}
      {historyOpen && (
        <OperationHistoryDrawer onClose={() => setHistoryOpen(false)} />
      )}
      {/* Phase 10: Price Alerts dialog — user-defined alerts on the
          existing live-price stream. */}
      <PriceAlertsDialog open={alertsOpen} onClose={() => setAlertsOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function RailBtn({
  icon: Icon,
  label,
  active = false,
  twoLine = false,
  onClick,
}: {
  icon: typeof BarChart3;
  label: string;
  active?: boolean;
  twoLine?: boolean;
  onClick?: () => void;
}) {
  const parts = twoLine ? splitTwoLine(label) : [label];
  return (
    <div className="mb-2.5 flex w-full flex-col items-center">
      <button
        type="button"
        title={label}
        onClick={onClick}
        className={cn(
          "flex h-9 w-12 flex-col items-center justify-center rounded-md transition-colors themed",
          active ? ACTIVE : INACTIVE,
        )}
      >
        <Icon className="h-[18px] w-[18px]" />
        <span className="mt-0.5 text-[9px] font-medium leading-tight tracking-tight">
          {parts.map((p, i) => (
            <span key={i} className="block text-center">
              {p}
            </span>
          ))}
        </span>
      </button>
      {/* Thin horizontal separator under each tool item */}
      <div className={cn("mt-2 h-px w-10", RAIL_SEPARATOR)} />
    </div>
  );
}

function splitTwoLine(label: string): string[] {
  /* Breaks a two-word label like "Operation History" into two lines:
     "Operation" / "History" */
  const idx = label.lastIndexOf(" ");
  if (idx < 0) return [label];
  return [label.slice(0, idx), label.slice(idx + 1)];
}

/* ── Mobile toolbar button (Phase 17 responsive) ──
 * Horizontally-scrollable icon+label button that replaces the desktop
 * vertical RailBtn on mobile. Renders the same action set in a compact
 * horizontal strip below the account metrics. */
function MobileRailBtn({
  icon: Icon,
  label,
  active = false,
  onClick,
}: {
  icon: typeof BarChart3;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={cn(
        "flex h-9 shrink-0 flex-col items-center justify-center rounded-md px-2 transition-colors themed",
        active ? ACTIVE : INACTIVE,
      )}
    >
      <Icon className="h-[16px] w-[16px]" />
      <span className="mt-0.5 text-[9px] font-medium leading-tight tracking-tight">
        {label}
      </span>
    </button>
  );
}

function Metric({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex shrink-0 flex-col items-start leading-tight">
      <span className={cn("text-[10px] font-medium", TOPBAR_LABEL)}>
        {label}
      </span>
      <span
        className={cn("font-mono text-[12px] tabular-nums font-medium", TOPBAR_VALUE)}
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </span>
    </div>
  );
}

function AccountPill({
  label,
  value,
  accent,
  active,
}: {
  label: string;
  value: string;
  accent: "green" | "blue" | "red";
  active: boolean;
}) {
  const dot = accent === "green" ? "bg-[#10b981]" : accent === "red" ? "bg-[#ef4444]" : "bg-[#3b82f6]";
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col items-start rounded px-2 py-1 leading-tight transition-opacity",
        active ? "opacity-100" : "opacity-50",
      )}
      style={active ? { background: accent === "green" ? "#10b98120" : accent === "red" ? "#ef444420" : "#3b82f620" } : undefined}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
        <span className={cn("text-[10px] font-medium", TOPBAR_LABEL)}>
          {label}
        </span>
      </div>
      <span
        className={cn(
          "ml-3 font-mono text-[11px] tabular-nums font-medium",
          TOPBAR_VALUE,
        )}
      >
        {value}
      </span>
    </div>
  );
}
