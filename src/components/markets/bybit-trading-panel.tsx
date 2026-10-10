"use client";

import { ExchangeReconciliation } from "./exchange-reconciliation";
import { BybitCancelOrder } from "./bybit-cancel-order";
import { useEffect, useMemo, useState } from "react";
import { AlertOctagon, ChevronDown, ChevronUp, Loader2, Maximize2, RefreshCw, ShieldCheck } from "lucide-react";
import { useMarketsStore } from "@/store/markets";
import { getLucianBase } from "@/lib/markets/symbol-mapping";
import { useSharedBybitTerminal } from "@/hooks/use-bybit-terminal";

type Tab = "positions" | "orders" | "pnl" | "portfolio" | "history" | "orderbook" | "risk" | "approvals" | "audit";
type Row = Record<string, string>;

function value(input: unknown, digits = 4) { const number = input === undefined || input === null || String(input).trim() === "" ? NaN : Number(input); return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits: digits }) : "—"; }
function shortTime(input: unknown) { const date = new Date(Number(input) || String(input)); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(); }

function useOrderBook(mode: "bybit_testnet" | "bybit_live", symbol: string) {
  const [book, setBook] = useState<{ bids: Array<[string, string]>; asks: Array<[string, string]>; state: string }>({ bids: [], asks: [], state: "connecting" });
  useEffect(() => {
    const levels = { bids: new Map<string, string>(), asks: new Map<string, string>() };
    const ws = new WebSocket(mode === "bybit_live" ? "wss://stream.bybit.com/v5/public/spot" : "wss://stream-testnet.bybit.com/v5/public/spot");
    function publish() {
      const bids = [...levels.bids].sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 15);
      const asks = [...levels.asks].sort((a, b) => Number(a[0]) - Number(b[0])).slice(0, 15);
      setBook({ bids, asks, state: "live" });
    }
    ws.onopen = () => ws.send(JSON.stringify({ op: "subscribe", args: [`orderbook.50.${symbol}`] }));
    ws.onmessage = (event) => { try {
      const payload = JSON.parse(event.data) as { type?: string; data?: { b?: Array<[string, string]>; a?: Array<[string, string]> } };
      if (!payload.data) return;
      if (payload.type === "snapshot") { levels.bids.clear(); levels.asks.clear(); }
      for (const [price, size] of payload.data.b ?? []) Number(size) === 0 ? levels.bids.delete(price) : levels.bids.set(price, size);
      for (const [price, size] of payload.data.a ?? []) Number(size) === 0 ? levels.asks.delete(price) : levels.asks.set(price, size);
      publish();
    } catch { /* ignore malformed frames */ } };
    ws.onerror = () => setBook((current) => ({ ...current, state: "error" }));
    ws.onclose = () => setBook((current) => ({ ...current, state: "disconnected" }));
    return () => { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; if (ws.readyState < 2) ws.close(); };
  }, [mode, symbol]);
  return book;
}

export function BybitTradingPanel({ expanded, onToggleExpand, onMaximize, isMaximized }: { expanded: boolean; onToggleExpand: () => void; onMaximize: () => void; isMaximized: boolean }) {
  const modeValue = useMarketsStore((state) => state.accountMode);
  const mode = modeValue === "bybit_live" ? "bybit_live" : "bybit_testnet";
  const panes = useMarketsStore((state) => state.paneStates);
  const active = useMarketsStore((state) => state.activePaneIndex);
  const symbol = `${getLucianBase(panes[active]?.symbol ?? "BTCUSD")}USDT`;
  const [tab, setTab] = useState<Tab>("positions");
  const { data, error, loading, refresh } = useSharedBybitTerminal();
  const book = useOrderBook(mode, symbol);
  const [riskDraft, setRiskDraft] = useState<Record<string, string>>({});
  const [riskDirty, setRiskDirty] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [accountingMessage, setAccountingMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.risk || riskDirty || actionBusy) return;
    const timer = window.setTimeout(() => setRiskDraft(Object.fromEntries(Object.entries(data.risk).filter(([, item]) => typeof item === "number").map(([key, item]) => [key, String(item)]))), 0);
    return () => window.clearTimeout(timer);
  }, [data?.risk, riskDirty, actionBusy]);
  const readKeys:Partial<Record<Tab,string[]>>={positions:["positions"],orders:["spotOrders","linearOrders"],pnl:["closedPnl"],history:["transactions"]};
  const readError=(readKeys[tab]??[]).map(key=>data?.readErrors?.[key]).filter(Boolean).join("; ");
  const floating = error ? undefined : data?.portfolio.totalPerpUPL;
  const tabs: Array<[Tab, string, number?]> = [["positions", "Positions", data?.readErrors?.positions?undefined:data?.positions.filter((row) => Number(row.size) > 0).length], ["orders", "Orders", data?.readErrors?.spotOrders || data?.readErrors?.linearOrders?undefined:data?.openOrders.length], ["pnl", "P/L"], ["portfolio", "Portfolio"], ["history", "Transactions"], ["orderbook", "Order Book"], ["risk", "Risk"], ["approvals", "Approvals", data?.approvals.length], ["audit", "Audit"]];

  async function post(url: string, body: Record<string, unknown>, method = "POST") {
    setActionBusy(true); setActionError(null);
    try { const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error || "Action failed."); if (url === "/api/bybit/risk" && method === "POST") setAccountingMessage("Spot accounting initialized and wallet reconciled. Live execution still requires its other readiness checks."); await refresh(); if (url === "/api/bybit/risk" && method === "PATCH") setRiskDirty(false); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : "Action failed."); }
    finally { setActionBusy(false); }
  }

  return <div className="shrink-0 border-t border-[#2a2e39] bg-[#161922] text-[#d1d4dc]">
    <div className="flex h-9 items-center gap-1 overflow-x-auto px-3">
      {tabs.map(([id, label, count]) => <button key={id} onClick={() => { setTab(id); if (!expanded) onToggleExpand(); }} className={`shrink-0 border-b-2 px-2 py-2 text-[10px] ${expanded && tab === id ? "border-[#2962ff] text-white" : "border-transparent text-[#787b86] hover:text-white"}`}>{label}{count !== undefined ? ` ${count}` : ""}</button>)}
      <div className="flex-1" />
      <span className="shrink-0 text-[10px] text-[#787b86]">Floating P/L <strong className={Number(floating) < 0 ? "text-red-400" : "text-emerald-400"}>{value(floating, 2)} USD</strong></span>
      <button title="Refresh" onClick={() => void refresh()} className="p-1 text-[#787b86] hover:text-white"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></button>
      <button type="button" aria-label={expanded ? "Collapse Bybit trading panel" : "Expand Bybit trading panel"} aria-expanded={expanded} onClick={onToggleExpand} className="p-1 text-[#787b86]">{expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}</button>
      <button title={isMaximized ? "Restore chart" : "Maximize chart"} onClick={onMaximize} className="p-1 text-[#787b86]"><Maximize2 className="h-3.5 w-3.5" /></button>
    </div>
    {expanded && <div className="h-[260px] overflow-auto border-t border-[#2a2e39] p-3">
      <div className="mb-2 flex items-center gap-2 text-[10px]"><span className={`rounded px-2 py-1 font-bold ${mode === "bybit_live" ? "bg-red-500/20 text-red-300" : "bg-amber-500/20 text-amber-300"}`}>{mode === "bybit_live" ? "BYBIT LIVE · REAL FUNDS" : "BYBIT TESTNET"}</span><span className="text-[#787b86]">{symbol} · {data?.environment ?? "not connected"}</span>{data?.risk.emergencyStop && <span className="rounded bg-red-500 px-2 py-1 font-bold text-white">EMERGENCY STOP ACTIVE</span>}</div>
      {(error || actionError) && <div className="mb-2 rounded border border-red-500/40 bg-red-500/10 p-2 text-[10px] text-red-300">{error || actionError}</div>}
      {loading && !data ? <div className="flex h-32 items-center justify-center gap-2 text-[11px] text-[#787b86]"><Loader2 className="h-4 w-4 animate-spin" />Synchronizing directly with Bybit…</div> : error && !data && tab !== "orderbook" ? <div className="py-12 text-center text-[11px] text-[#787b86]">Account data unavailable. Resolve the connection error and retry.</div> : readError ? <p role="alert" className="py-8 text-center text-sm">Account records unavailable or incomplete: {readError}</p> : <>
        {tab === "positions" && <SimpleTable columns={["symbol", "side", "size", "avgPrice", "markPrice", "leverage", "unrealisedPnl", "liqPrice"]} rows={(data?.positions ?? []).filter((row) => Number(row.size) > 0)} />}
        {tab === "orders" && <SimpleTable columns={["symbol", "category", "side", "orderType", "qty", "price", "orderStatus", "createdTime"]} rows={data?.openOrders ?? []} action={(row) => <BybitCancelOrder key={`${mode}:${row.category}:${row.symbol}:${row.orderId}`} mode={mode} order={row} refresh={refresh} />} />}
        {tab === "pnl" && <><SummaryCards values={[["Unrealized P/L", data?.portfolio.totalPerpUPL], ["Wallet balance", data?.portfolio.totalWalletBalance], ["Equity", data?.portfolio.totalEquity]]} /><SimpleTable columns={["symbol", "side", "qty", "avgEntryPrice", "avgExitPrice", "closedPnl", "createdTime"]} rows={data?.closedPnl ?? []} /></>}
        {tab === "portfolio" && <><p className="mb-2 text-[10px] text-[#9aa0ae]">Unified trading account · USD totals</p><SummaryCards values={[["Total equity", data?.portfolio.totalEquity], ["Available", data?.portfolio.totalAvailableBalance], ["Wallet balance", data?.portfolio.totalWalletBalance]]} /><SimpleTable columns={["coin", "equity", "walletBalance", "unrealisedPnl"]} rows={data?.portfolio.coins ?? []} /><h3 className="mt-4 mb-2 text-xs font-semibold">Funding wallet · separate from trading</h3><p className="mb-2 text-[10px] text-[#9aa0ae]">Balances below are in each coin, not USD. To fund trading, use Bybit → Assets → Transfer → Funding to Unified Trading. Moving funds does not start Lilthe or place an order.</p>{data?.readErrors?.funding ? <p role="alert" className="text-red-300">{data.readErrors.funding}</p> : <SimpleTable columns={["coin", "walletBalance", "transferBalance"]} rows={(data?.funding ?? []).filter(row => Number(row.walletBalance) > 0)} />}</>}
        {tab === "history" && <SimpleTable columns={["currency", "type", "change", "cashFlow", "fee", "transactionTime"]} rows={data?.transactions ?? []} />}
        {tab === "orderbook" && <OrderBook book={book} />}
        {tab === "risk" && <div className="grid gap-3 lg:grid-cols-[1fr_1fr]"><div className="grid grid-cols-2 gap-2">{[["maxOrderUsd", "Max order (USDT)"], ["maxPositionUsd", "Max position (USDT)"], ["maxDailyLossUsd", "Daily loss stop (USDT)"], ["maxOpenPositions", "Open positions"], ["maxLeverage", "Leverage"]].map(([key, label]) => <label key={key} className="text-[10px] text-[#9aa0ae]">{label}<input className="mt-1 w-full rounded border border-[#2a2e39] bg-[#131722] px-2 py-1.5 text-white" value={riskDraft[key] ?? ""} onChange={(event) => { setRiskDirty(true); setRiskDraft((current) => ({ ...current, [key]: event.target.value })); }} /></label>)}<button disabled={actionBusy} onClick={() => void post("/api/bybit/risk", { ...riskDraft, mode }, "PATCH")} className="rounded bg-[#2962ff] px-3 py-2 font-semibold text-white disabled:opacity-50"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" />Save server risk limits</button></div><div><div className="mb-3 rounded border border-[#2a2e39] p-3"><div className="font-semibold">Spot loss accounting</div><p className="my-2 text-[10px] text-[#9aa0ae]">Start with a flat USDT Unified wallet and no open orders. Filled trades and fees then count toward the daily loss stop. Transfers or unreconciled balances block new live entries. The baseline cannot erase existing losses. FIFO checkpoints preserve costs and realized losses across rollover. Two days remain replayable; gaps beyond 28 days require ledger recovery.</p><button disabled={actionBusy} onClick={() => void post("/api/bybit/risk", { mode })} className="rounded bg-[#2962ff] px-3 py-2 text-white disabled:opacity-50">Initialize Spot accounting</button>{accountingMessage && <p role="status" className="mt-2 text-[10px] text-[#9aa0ae]">{accountingMessage}</p>}</div><div className="rounded border border-red-500/30 bg-red-500/5 p-3"><div className="font-semibold text-red-300">Emergency stop</div><p className="my-2 text-[10px] text-[#9aa0ae]">Blocks all new orders and sends cancel-all to both Spot and USDT Perpetual. It does not market-close positions.</p><button disabled={actionBusy} onClick={() => void post("/api/bybit/emergency-stop", { mode, active: !data?.risk.emergencyStop })} className="rounded bg-red-500 px-3 py-2 font-bold text-white disabled:opacity-50"><AlertOctagon className="mr-1 inline h-4 w-4" />{data?.risk.emergencyStop ? "Release emergency stop" : "STOP AND CANCEL ALL"}</button></div></div></div>}
        {tab === "approvals" && <><ExchangeReconciliation /><SimpleTable columns={["createdAt", "productId", "side", "category", "orderType", "quoteSize", "tradingMode", "state", "providerOrderId"]} rows={(data?.approvals ?? []) as unknown as Row[]} /></>}
        {tab === "audit" && <SimpleTable columns={["createdAt", "action", "tradingMode", "status", "symbol"]} rows={(data?.audits ?? []) as unknown as Row[]} />}
      </>}
    </div>}
  </div>;
}

function SummaryCards({ values }: { values: Array<[string, string | undefined]> }) { return <div className="mb-3 grid grid-cols-3 gap-2">{values.map(([label, amount]) => <div key={label} className="rounded border border-[#2a2e39] bg-[#131722] p-2"><div className="text-[9px] uppercase text-[#787b86]">{label}</div><div className="font-mono text-sm text-white">{value(amount, 2)} USD</div></div>)}</div>; }
function SimpleTable({ columns, rows, action }: { columns: string[]; rows: Row[]; action?: (row: Row) => React.ReactNode }) { if (!rows.length) return <div className="py-12 text-center text-[11px] text-[#787b86]">No records returned by Bybit.</div>; return <table className="w-full text-left text-[10px]"><thead className="sticky top-0 bg-[#161922] uppercase text-[#787b86]"><tr>{columns.map((column) => <th className="px-2 py-1" key={column}>{column.replace(/([A-Z])/g, " $1")}</th>)}{action && <th />}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.orderId ?? row.id ?? index)} className="border-t border-[#2a2e39]">{columns.map((column) => <td className="whitespace-nowrap px-2 py-1.5 font-mono" key={column}>{column.toLowerCase().includes("time") || column === "createdAt" ? shortTime(row[column]) : row[column] || "—"}</td>)}{action && <td>{action(row)}</td>}</tr>)}</tbody></table>; }
function OrderBook({ book }: { book: { bids: Array<[string, string]>; asks: Array<[string, string]>; state: string } }) { const max = useMemo(() => Math.max(1, ...book.bids.map(([, q]) => Number(q)), ...book.asks.map(([, q]) => Number(q))), [book]); return <div className="mx-auto max-w-2xl"><div className="mb-2 flex justify-between text-[10px] text-[#787b86]"><span>Price (USDT)</span><span>Size · {book.state}</span></div>{[...book.asks].reverse().slice(-10).map(([price, qty]) => <Depth key={`a${price}`} price={price} qty={qty} max={max} ask />)}<div className="my-1 border-t border-[#2a2e39]" />{book.bids.slice(0, 10).map(([price, qty]) => <Depth key={`b${price}`} price={price} qty={qty} max={max} />)}</div>; }
function Depth({ price, qty, max, ask = false }: { price: string; qty: string; max: number; ask?: boolean }) { return <div className="relative flex justify-between px-2 py-0.5 font-mono text-[10px]"><div className={`absolute inset-y-0 right-0 opacity-15 ${ask ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, Number(qty) / max * 100)}%` }} /><span className={ask ? "text-red-400" : "text-emerald-400"}>{price}</span><span>{qty}</span></div>; }
