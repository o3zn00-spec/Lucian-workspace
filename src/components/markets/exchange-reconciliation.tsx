"use client";
import {useState} from "react";
type Candidate={id:string;productId:string;tradingMode:string;state:string};
export function ExchangeReconciliation(){
  const [intents,setIntents]=useState<Candidate[]>([]),[message,setMessage]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false),[report,setReport]=useState<unknown>(null);
  const check=async(id?:string)=>{setBusy(true);setError("");try{
    const response=await fetch("/api/bybit/reconciliation",id?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({intentId:id}),signal:AbortSignal.timeout(120000)}:{cache:"no-store",signal:AbortSignal.timeout(120000)});
    const data=await response.json();if(!response.ok)throw Error(data.error??"Reconciliation unavailable.");
    if(id){setReport(data);setMessage(data.message);setIntents(current=>data.resolved?current.filter(i=>i.id!==id):current.map(i=>i.id===id?{...i,state:data.state}:i));}
    else{setIntents(data.intents);setMessage(data.message+(data.hasMore?" Showing the newest 20; older reservations remain retained.":""));setReport(null);}
  }catch(e){setError(e instanceof Error?e.message:"Reconciliation unavailable.");}finally{setBusy(false);}};
  return <section aria-label="Exchange reconciliation" className="mt-4 space-y-2 border-t border-line pt-3 text-sm"><h3 className="font-medium">Exchange order reconciliation</h3><p>Check existing owner orders against exchange order and fill records. This does not place, retry or cancel orders, move money, or certify protective exits.</p><button type="button" disabled={busy} onClick={()=>void check()} className="focus-ring rounded-lg border border-line px-3 py-2 disabled:opacity-50">{busy?"Checking exchange records…":"Check exchange reconciliation"}</button>{error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}{intents.map(i=><div key={i.id} className="flex flex-wrap items-center gap-2"><span>{i.productId} · {i.tradingMode} · {i.state}</span><button type="button" disabled={busy} onClick={()=>void check(i.id)} className="focus-ring rounded-lg border border-line px-3 py-2">Reconcile {i.productId}</button></div>)}{report!==null&&<details><summary>Matched records and limitations</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(report,null,2)}</pre></details>}</section>;
}
