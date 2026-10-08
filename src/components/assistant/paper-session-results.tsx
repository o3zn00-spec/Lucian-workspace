"use client";
import { useState } from "react";
import type { PaperSession } from "@/lib/assistant/paper-engine";
import { paperResults } from "@/lib/assistant/paper-results";
const money=(n:number)=>(n/100).toFixed(2);
function Chart({label,points,unit}:{label:string;points:{atMs:number;value:number}[];unit:string}) {
  const [selected,setSelected]=useState<number|null>(null);
  if(!points.length)return <p>{label}: waiting for measured data.</p>;
  const min=Math.min(...points.map(p=>p.value)),max=Math.max(...points.map(p=>p.value));
  const range=max-min||Math.max(Math.abs(min)*0.001,0.01);
  const x=(i:number)=>40+i*520/Math.max(1,points.length-1),y=(v:number)=>150-(v-min)*110/range;
  const i=Math.min(selected??points.length-1,points.length-1),p=points[i];
  return <figure className="rounded-lg bg-surface-2 p-3">
    <figcaption className="font-medium">{label}</figcaption>
    <svg viewBox="0 0 600 190" role="img" aria-label={`${label}, ${points.length} observations; ${min.toFixed(2)} to ${max.toFixed(2)} ${unit}`} className="w-full">
      <text x="40" y="20" fill="currentColor" fontSize="12">{max.toFixed(2)} {unit}</text>
      <line x1="40" x2="560" y1="150" y2="150" stroke="currentColor" opacity="0.2" />
      <polyline points={points.map((p,i)=>`${x(i)},${y(p.value)}`).join(" ")} fill="none" stroke="var(--accent, #d4af37)" strokeWidth="2" />
      <circle cx={x(i)} cy={y(p.value)} r="4" fill="currentColor" />
      <text x="40" y="180" fill="currentColor" fontSize="12">{new Date(points[0].atMs).toLocaleTimeString()}</text>
      <text x="560" y="180" textAnchor="end" fill="currentColor" fontSize="12">{new Date(points.at(-1)!.atMs).toLocaleTimeString()}</text>
    </svg>
    <label className="block text-xs">Inspect observation<input aria-label={`Inspect ${label}`} type="range" min="0" max={Math.max(0,points.length-1)} value={i} onChange={e=>setSelected(Number(e.target.value))} className="block w-full" /></label>
    <p className="text-xs">{new Date(p.atMs).toLocaleString()} · {p.value.toFixed(2)} {unit}</p>
  </figure>;
}
export function PaperSessionResults({session:s}:{session:PaperSession}) {
  const result=paperResults(s),latest=s.reviews?.at(-1),[symbol,setSymbol]=useState(s.plan.symbols[0]),[interval,setInterval]=useState(5);
  const market=latest?.research?.markets.find(m=>m.symbol===symbol && m.intervalMinutes===interval);
  const download=()=>{
    const blob=new Blob([JSON.stringify({kind:"LUCIAN paper results",exportedAt:new Date().toISOString(),simulationCosts:{feeBps:s.plan.feeBps,slippageBps:s.plan.slippageBps},results:result,session:s},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`lucian-paper-${s.id}.json`;a.click();URL.revokeObjectURL(url);
  };
  return <section aria-label="Paper research and results" className="space-y-3">
    <h3 className="font-medium">Research and paper results</h3>
    <div className="grid gap-2 sm:grid-cols-2"><p>Realized P/L: {money(result.realizedCents)} USDT</p><p>Unrealized P/L: {money(result.unrealizedCents)} USDT</p><p>Closed trades: {result.closedTrades} · Profitable: {result.wins}</p><p>Largest sampled drawdown: {money(result.maxDrawdownCents)} USDT</p></div>
    <p className="text-xs text-fg-muted">Net results include assumed fees and slippage. Open positions use net liquidation value. Chart/drawdown use the last 200 samples, not every intraminute price. Paper fills do not model queue priority, partial fills or market impact.</p>
    <Chart label="Paper equity" unit="USDT" points={[{atMs:s.startedAtMs,value:Number(s.plan.capital)},...s.history.map(h=>({atMs:h.atMs,value:h.equityCents/100}))]} />
    <p>Research/model reviews reserved: {s.reviewCount??0} / 30. Provider token cost is not measured; this cap limits attempts, not a dollar budget.</p>
    {latest?.research && <>
      <p>Research observed {new Date(latest.research.observedAtMs).toLocaleString()}.</p>
      <div className="flex gap-2"><label>Market<select aria-label="Research chart market" value={symbol} onChange={e=>setSymbol(e.target.value)} className="ml-2 rounded bg-surface-2 p-1">{s.plan.symbols.map(sym=><option key={sym}>{sym}</option>)}</select></label><label>Interval<select aria-label="Research chart interval" value={interval} onChange={e=>setInterval(Number(e.target.value))} className="ml-2 rounded bg-surface-2 p-1"><option value={5}>5 minutes</option><option value={60}>1 hour</option></select></label></div>
      {market && <><Chart label={`${symbol} closed-candle price`} unit="USDT" points={market.candles.map(c=>({atMs:c.atMs,value:c.close}))} /><p>Window change {market.changePercent.toFixed(2)}% · SMA20 {market.sma20.toFixed(2)} · SMA50 {market.sma50.toFixed(2)} · Range {market.rangePercent.toFixed(2)}%. <a className="underline" href={market.source} target="_blank" rel="noreferrer">Source data</a></p></>}
      <details><summary>Exchange announcements ({latest.research.announcements.length})</summary>{latest.research.announcements.map((a,i)=><p key={i}><a href={a.url} target="_blank" rel="noreferrer" className="underline">{a.title}</a> · {new Date(a.publishedAtMs).toLocaleString()}</p>)}</details>
      {latest.research.warnings.map(w=><p key={w} className="text-xs text-fg-muted">{w}</p>)}
    </>}
    {!latest?.research && <p>No verified research report yet. Missing research cannot support a new entry.</p>}
    <details><summary>Recent decisions ({s.reviews?.length??0})</summary>{[...(s.reviews??[])].reverse().map((r,i)=><div key={i} className="my-2 border-t border-line pt-2"><p>{new Date(r.atMs).toLocaleString()} · {r.action}</p><p>{r.rationale}</p><p className="text-fg-muted">Execution: {r.outcome}</p></div>)}</details>
    <button type="button" onClick={download} className="focus-ring rounded-lg border border-line px-3 py-2">Export paper results</button>
  </section>;
}
