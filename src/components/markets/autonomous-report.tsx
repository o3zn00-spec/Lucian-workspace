"use client";
import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { AutonomousReport, ReportOrder } from "@/lib/bybit/autonomous-report-data";
const button = "focus-ring rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50";
const cash = (cents: number) => `${(cents / 100).toFixed(2)} USDT`;
function Orders({ orders }: { orders: ReportOrder[] }) {
  return <div className="space-y-2">{orders.map(order => <details key={order.id} className="rounded-lg border border-line p-3"><summary className="cursor-pointer break-words">{order.side} {order.symbol} · {order.state} · {order.fills.length} recorded fills</summary><p className="mt-2 break-all text-xs text-fg-muted">Exchange order: {order.providerOrderId ?? "Not confirmed"} · Reconciled: {order.observedAt ? new Date(order.observedAt).toLocaleString() : "Unavailable"}</p><div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr><th className="p-2">Quantity</th><th className="p-2">Price (USDT)</th><th className="p-2">Actual fee</th><th className="p-2">Execution time</th></tr></thead><tbody>{order.fills.map((fill, i) => <tr key={i}><td className="p-2">{fill.quantity}</td><td className="p-2">{fill.price}</td><td className="whitespace-nowrap p-2">{fill.fee} {fill.currency}</td><td className="p-2">{fill.atMs ? new Date(fill.atMs).toLocaleString() : "Unavailable"}</td></tr>)}</tbody></table></div>{!order.fills.length && <p className="mt-2 text-fg-muted">No matched fills recorded for this order. A pending order is not a completed trade.</p>}</details>)}</div>;
}
export function AutonomousReportButton({ sessionId }: { sessionId?: string }) {
  const [open, setOpen] = useState(false), [report, setReport] = useState<AutonomousReport | null>(null);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [pages, setPages] = useState({ sessionPage: 0, tradePage: 0, decisionPage: 0 });
  const acting = useRef(false);
  async function load(id = report?.session?.id ?? sessionId, next = pages) {
    if (acting.current) return;
    acting.current = true; setBusy(true); setError(null);
    try {
      const query = new URLSearchParams({ sessionPage: String(next.sessionPage), tradePage: String(next.tradePage), decisionPage: String(next.decisionPage), ...(id ? { sessionId: id } : {}) });
      const response = await fetch(`/api/bybit/autonomous-report?${query}`, { cache: "no-store", signal: AbortSignal.timeout(30000) }), data = await response.json();
      if (!response.ok || !data.ok) throw Error(data.error ?? "Report unavailable.");
      setReport(data.report); setPages(next);
    } catch (e) { setError(e instanceof Error ? e.message : "Report unavailable. Previously loaded evidence is retained with its timestamp."); }
    finally { acting.current = false; setBusy(false); }
  }
  function changeOpen(next: boolean) { setOpen(next); if (next) void load(); }
  const sessions = report?.sessions ?? [];
  const options = report?.session && !sessions.some(s => s.id === report.session!.id) ? [report.session, ...sessions] : sessions;
  const paginate = (key: keyof typeof pages, more: boolean) => <div className="mt-3 flex items-center gap-2"><button type="button" className={button} disabled={busy || pages[key] === 0} onClick={() => void load(undefined, { ...pages, [key]: pages[key] - 1 })}>Newer</button><span className="text-xs text-fg-muted">Page {pages[key] + 1}</span><button type="button" className={button} disabled={busy || !more} onClick={() => void load(undefined, { ...pages, [key]: pages[key] + 1 })}>Older</button></div>;
  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger asChild><button type="button" className={button}>Research and trade reports</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[190] bg-black/60" /><Dialog.Content className="themed fixed left-1/2 top-1/2 z-[191] max-h-[90dvh] w-[min(60rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-surface p-5 text-sm text-fg shadow-pop">
      <Dialog.Title className="pr-8 text-xl font-semibold">Research and trade reports</Dialog.Title><Dialog.Description className="mt-2 text-fg-muted">Saved decisions, source timestamps and actual exchange evidence. Detailed source and settlement snapshots are collected from this release onward; older sessions can have incomplete detail.</Dialog.Description>
      <Dialog.Close asChild><button type="button" aria-label="Close trading report" className="absolute right-3 top-3 p-2"><X size={18} /></button></Dialog.Close>
      {error && <p role="alert" className="mt-3 text-red-400">{error}</p>}{busy && <p role="status" className="mt-3">Loading saved evidence…</p>}
      <button type="button" className={`${button} mt-3`} disabled={busy} onClick={() => void load()}>Refresh report</button>
      {report && <div className="mt-4 space-y-5">
        <p className="text-xs text-fg-muted">Report read {new Date(report.recordedAtMs).toLocaleString()}. Values below are a snapshot, not a live price feed.</p>
        {options.length > 0 ? <label className="block">Session<select value={report.session?.id ?? ""} disabled={busy} className="focus-ring mt-1 w-full rounded-lg border border-line bg-surface-2 p-2" onChange={e => void load(e.target.value, { ...pages, tradePage: 0, decisionPage: 0 })}>{options.map(s => <option value={s.id} key={s.id}>{new Date(s.startedAtMs).toLocaleString()} · {s.mode === "bybit_live" ? "Live" : "Testnet"} · {s.status} · {s.id.slice(0, 8)}</option>)}</select></label> : <p>No authorized autonomous session is recorded.</p>}
        {(report.moreSessions || pages.sessionPage > 0) && <div><p>Archived session pages</p>{paginate("sessionPage", report.moreSessions)}</div>}
        {report.session && <><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-surface-2 p-3">Realized after settled trades<strong className="block">{cash(report.session.realizedCents)}</strong></div><div className="rounded-lg bg-surface-2 p-3">Completed trades<strong className="block">{report.session.trades}</strong></div><div className="rounded-lg bg-surface-2 p-3">Model calls used<strong className="block">{report.session.modelCalls}</strong></div></div><p className="break-words">Model: {report.session.model} · Entry deadline: {new Date(report.session.deadlineMs).toLocaleString()}</p>{report.session.error && <p role="status">{report.session.error}</p>}
          {report.active && <section className="space-y-3 rounded-xl border border-line p-4"><h3 className="font-semibold">Current owned trade</h3><p>{report.session.protection}</p>{report.active.unrealized ? <div><p>Estimated unrealized result: <strong>{cash(report.active.unrealized.unrealizedCents)}</strong></p><p className="mt-1 text-fg-muted">Remaining {report.active.unrealized.quantity} · basis {cash(report.active.unrealized.remainingBasisCents)} · bid {report.active.unrealized.bid} at {new Date(report.active.unrealized.atMs).toLocaleString()}. Uses the current taker fee; excludes slippage and future price changes. This is not settled profit.</p></div> : <p>{report.active.unavailable}</p>}<Orders orders={report.active.orders} /></section>}
          <section className="space-y-3"><h3 className="text-base font-semibold">Settled trades</h3>{!report.trades.length && <p className="text-fg-muted">No detailed settled-trade records on this page. This does not certify pending trades as empty or closed.</p>}{report.trades.map(trade => <details className="rounded-xl border border-line p-3" key={trade.id}><summary className="cursor-pointer font-medium">{trade.symbol} · {cash(trade.proceedsCents - trade.costCents)} · {new Date(trade.atMs).toLocaleString()}</summary><p className="my-3">Actual entry cost {cash(trade.costCents)} · net exit proceeds {cash(trade.proceedsCents)} · residual dust {trade.remainingQuantity}. Includes matched execution fees; reporting uses conservative cent rounding.</p>{!trade.fillsComplete && <p className="mb-3">The fill display is incomplete or capped at 200 fills per order; the settlement totals remain separately recorded.</p>}<Orders orders={trade.orders} /></details>)}{paginate("tradePage", report.moreTrades)}</section>
          <section className="space-y-3"><h3 className="text-base font-semibold">Research and decisions</h3>{!report.decisions.length && <p className="text-fg-muted">No source-linked decisions on this page.</p>}{report.decisions.map(record => <details className="rounded-xl border border-line p-3" key={record.id}><summary className="cursor-pointer font-medium">{record.decision?.action ?? "Invalid response"} · {new Date(record.atMs).toLocaleString()}</summary><p className="mt-3 whitespace-pre-wrap break-words">{record.decision?.rationale ?? record.outcome}</p><p className="mt-2 text-fg-muted">{record.outcome}</p><p className="mt-2 text-xs text-fg-muted">Research collected {new Date(record.researchAtMs).toLocaleString()}</p>{record.decision?.action === "buy" && <p className="mt-2">Proposed {record.decision.symbol} · quantity {record.decision.quantity} · stop {record.decision.stopPrice} · target {record.decision.takeProfit}</p>}<ul className="mt-3 space-y-2">{record.warnings.map((warning, i) => <li key={i} className="text-fg-muted">{warning}</li>)}</ul><ul className="mt-3 space-y-3">{record.sources.map((source, i) => <li key={i} className="rounded-lg bg-surface-2 p-3"><a className="focus-ring break-words underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a><p className="mt-1 text-xs text-fg-muted">Source time {new Date(source.atMs).toLocaleString()}</p><p className="mt-1 break-words">{source.summary}</p></li>)}</ul></details>)}{paginate("decisionPage", report.moreDecisions)}</section>
        </>}
      </div>}
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
