"use client";
import { StrategyValidation } from "./strategy-validation";
import { useCallback, useEffect, useState, useRef } from "react";
import { useSharedAIConfig } from "@/store/shared-ai-config";
import type { PaperSession } from "@/lib/assistant/paper-engine";
import { PaperSessionResults } from "./paper-session-results";
const amount=(cents:number)=>(cents/100).toFixed(2);
export function PaperSessionControls({planRevision,ready}:{planRevision:string|null;ready:boolean}) {
  const [s,setSession]=useState<PaperSession|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[confirmation,setConfirmation]=useState("");
  const [observedAt,setObservedAt]=useState(0);
  const [runtimeCheck,setRuntimeCheck]=useState<{status:string;message:string}|null>(null);
  const requestVersion=useRef(0);
  const [verified,setVerified]=useState(false);
  const provider=useSharedAIConfig(state=>state.overrides["economic-agent"]?.provider??state.globalProvider);
  const model=useSharedAIConfig(state=>state.overrides["economic-agent"]?.model??state.globalModel);
  const config={provider,model};
  const effort=useSharedAIConfig(state=>state.reasoningEffort);
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    const version=++requestVersion.current;
    const response=await fetch("/api/assistant/paper-session",{cache:"no-store",signal});const data=await response.json();
    if(!response.ok || !data.ok)throw Error(data.error??"Session unavailable.");if(version===requestVersion.current && !signal?.aborted){setObservedAt(Date.now());setRuntimeCheck(data.runtimeCheck??null);setSession(data.session);setError(null);}
  },[]);
  useEffect(()=>{
    const controller=new AbortController();
    void Promise.resolve().then(()=>refresh(controller.signal)).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    const timer=setInterval(()=>{if(document.visibilityState==="visible")void refresh(controller.signal).catch(e=>{if(!controller.signal.aborted)setError(e.message);});},15000);
    return()=>{controller.abort();clearInterval(timer);};
  },[refresh]);
  const action=async(action:string)=>{
    ++requestVersion.current;setBusy(true);setError(null);
    try {
      const body=action==="verify"?{action}:action==="start"?{action,revision:planRevision,confirmation,provider:config.provider,model:config.model,effort}:{action,id:s?.id,revision:s?.revision};
      const response=await fetch("/api/assistant/paper-session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const data=await response.json();
      if(!response.ok || !data.ok)throw Error(data.error??"Control failed.");setObservedAt(Date.now());setRuntimeCheck(data.runtimeCheck??null);setSession(data.session);setConfirmation("");
    }catch(e){await refresh().catch(()=>{});setError((e as Error).message);}finally{setBusy(false);}
  };
  return <section aria-label="Paper session runtime" className="mt-5 space-y-3 border-t border-line pt-4 text-sm">
    <h3 className="font-medium">Background paper session</h3>
    <p className="text-fg-muted">Simulated money only. The worker checks exits approximately every minute, reviews at your interval, and continues with this page closed. Prices can gap past stops; infrastructure outages can delay checks. Model calls use your connected provider credits.</p>
    <button disabled={busy} type="button" onClick={()=>void action("verify")} className="focus-ring rounded-lg border border-line px-3 py-2">Check runtime without trading</button>
    {runtimeCheck && <p role="status">Runtime check: {runtimeCheck.status} · {runtimeCheck.message}</p>}
    {error && <p role="alert">{error}</p>}
    {s && <>
      <p role="status">Status: <strong>{s.status}</strong> · Paper cash {amount(s.cashCents)} USDT · Equity {amount(s.equityCents)} USDT · P/L {amount(s.equityCents-Number(s.plan.capital)*100)} USDT</p>
      <p className="text-fg-muted">{s.lastMessage} Last successful check: {s.history.length?new Date(s.history[s.history.length-1].atMs).toLocaleString():"not yet"}. Model: {s.model} · {s.effort}. {s.runId?"Worker dispatched.":"Worker not dispatched; recover to retry."}</p>
      {s.error && <p role="alert">{s.error}</p>}
      {s.status!=="stopped" && observedAt-(s.history.at(-1)?.atMs??s.startedAtMs)>180000 && <p role="alert">Checks are delayed. Refresh or recover the worker. No fresh execution is assumed.</p>}
      {s.status!=="stopped" && <div className="flex flex-wrap gap-2">
        {s.status==="running" && <button disabled={busy} type="button" onClick={()=>void action("pause")} className="focus-ring rounded-lg border border-line px-3 py-2">Pause entries</button>}
        {s.status==="paused" && <button disabled={busy} type="button" onClick={()=>void action("resume")} className="focus-ring rounded-lg border border-line px-3 py-2">Resume entries</button>}
        <button disabled={busy} type="button" onClick={()=>void action("stop")} className="focus-ring rounded-lg border border-line px-3 py-2">Stop and close paper positions</button>
        <button disabled={busy} type="button" onClick={()=>void action("recover")} className="focus-ring rounded-lg border border-line px-3 py-2">Recover worker</button>
      </div>}
      <div className="overflow-x-auto"><table className="w-full text-left"><caption className="text-left text-fg-muted">Open paper positions</caption><thead><tr><th>Symbol</th><th>Quantity</th><th>Stop</th><th>Take profit</th></tr></thead><tbody>{s.positions.map(p=><tr key={p.symbol}><td>{p.symbol}</td><td>{p.quantity}</td><td>{p.stopPrice}</td><td>{p.takeProfit}</td></tr>)}</tbody></table>{!s.positions.length && <p>No open paper positions.</p>}</div>
      <details><summary className="cursor-pointer">Paper fills ({s.fills.length})</summary>{[...s.fills].reverse().map((f,i)=><p key={i}>{new Date(f.atMs).toLocaleString()} · {f.side} {f.quantity} {f.symbol} · {amount(f.amountCents)} USDT · {f.reason}</p>)}</details>
      <PaperSessionResults session={s} />
      <details><summary className="cursor-pointer">Equity history</summary>{s.history.slice(-20).map((h,i)=><p key={i}>{new Date(h.atMs).toLocaleString()} · {amount(h.equityCents)} USDT</p>)}</details>
      <p className="text-fg-muted">Active rules are frozen at start. Draft edits apply only to a new session. Pause retains protective exits; recovery keeps the same capital, positions and authorization.</p>
    </>}
    <StrategyValidation />
    {(!s || s.status==="stopped") && <div className="space-y-3">
      <p>Starting uses {config.provider} / {config.model} ({effort}). Review the saved plan above. The model interprets strategy notes; numerical limits are enforced by the server. Unsupported requests must result in Hold.</p>
      <label className="flex gap-2"><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)} />I reviewed the saved limits and authorize background paper trading and model usage.</label>
      <label className="block">Type START PAPER<input aria-label="Paper start confirmation" value={confirmation} onChange={e=>setConfirmation(e.target.value)} className="mt-1 block w-full rounded-lg border border-line bg-surface-2 p-2" /></label>
      <button type="button" disabled={busy || !ready || !planRevision || !verified || confirmation!=="START PAPER"} onClick={()=>void action("start")} className="focus-ring rounded-lg bg-accent px-4 py-2 text-black disabled:opacity-50">Start paper session</button>
    </div>}
    <button type="button" disabled={busy} onClick={()=>void refresh().catch(e=>setError(e.message))} className="focus-ring rounded-lg border border-line px-3 py-2">Refresh session</button>
  </section>;
}
