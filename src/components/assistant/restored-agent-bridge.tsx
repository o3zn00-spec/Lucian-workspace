"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useEconomicAgentStore, type Conversation } from "@/store/economic-agent";

const ReadyContext=createContext(false);
export function useRestoredAssistantReady(){return useContext(ReadyContext);}

/** Hydrate the original UI from the new owner-scoped tables, then serialize writes.
 * Historical unscoped browser keys are preserved and never imported silently. */
export function RestoredAgentBridge({children}:{children:React.ReactNode}) {
  const {data:session,status}=useSession(); const owner=session?.user?.id;
  const [retry,setRetry]=useState(0);
  const [ready,setReady]=useState<string|null>(null);const [error,setError]=useState<string|null>(null);
  useEffect(()=>{
    if(status!=="authenticated" || !owner)return;
    let disposed=false;let syncing=false;let pending=false;let timer:ReturnType<typeof setTimeout>;
    const versions=new Map<string,string>(); const signatures=new Map<string,string>();
    const signature=(c:Conversation)=>JSON.stringify({title:c.title,pinned:c.pinned,archived:c.archived,summary:c.summary,capabilities:c.capabilities,messages:c.messages.filter(m=>m.status!=="streaming")});let known=new Set<string>();let stop=()=>{}; let updatingVersion=false;
    const cacheKey=`lucian-economic-agent-restored-${owner}`;
    let cached: {conversations?: Conversation[]}={};
    try { cached=JSON.parse(localStorage.getItem(cacheKey)??"{}").state??{}; } catch { /* damaged cache must not break startup */ }
    async function call(body?:unknown){const response=await fetch("/api/assistant/restored",{method:body?"POST":"GET",cache:"no-store",headers:body?{"Content-Type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined});const result=await response.json();if(!response.ok)throw new Error(result.error??"Conversation sync failed.");return result;}
    async function sync(){
      if(disposed)return;if(syncing){pending=true;return;}syncing=true;
      try{
        const state=useEconomicAgentStore.getState();
        for(const c of state.conversations){if(disposed)return;const fingerprint=signature(c);if(signatures.get(c.id)===fingerprint)continue;const result=await call({id:c.id,conversation:c,baseVersion:versions.get(c.id)});versions.set(c.id,result.serverVersion);signatures.set(c.id,fingerprint);
          updatingVersion=true;useEconomicAgentStore.setState(s=>({conversations:s.conversations.map(item=>item.id===c.id?{...item,serverVersion:result.serverVersion}:item)}));updatingVersion=false;}
        for(const id of known)if(!state.conversations.some(c=>c.id===id))await call({action:"delete",id});
        known=new Set(state.conversations.map(c=>c.id));
        if(state.activeId && known.has(state.activeId))await call({action:"activate",id:state.activeId});
        if(!disposed)setError(null);
      }catch(e){if(!disposed)setError((e as Error).message);}
      finally{syncing=false;if(pending){pending=false;void sync();}}
    }
    useEconomicAgentStore.persist.setOptions({name:`lucian-economic-agent-restored-${owner}`});
    call().then(result=>{
      if(disposed)return;
      for(const c of result.conversations){versions.set(c.id,c.serverVersion);signatures.set(c.id,signature(c));}
      known=new Set(result.conversations.map((c:{id:string})=>c.id));
      const merged = result.conversations.map((server: Conversation)=>{
        const local=cached.conversations?.find((c:Conversation)=>c.id===server.id);
        return local && local.serverVersion===server.serverVersion && local.updatedAt>server.updatedAt ? local : server;
      });
      for(const local of cached.conversations??[])if(!known.has(local.id) && !local.serverVersion)merged.push(local);
      useEconomicAgentStore.setState({busy:false,error:null,contextItems:[],conversations:merged,activeId:known.has(result.activeId)?result.activeId:null});
      setReady(owner);setError(null);
      stop=useEconomicAgentStore.subscribe((state,previous)=>{
        if(updatingVersion)return;
        if(state.conversations===previous.conversations && state.activeId===previous.activeId)return;
        clearTimeout(timer);timer=setTimeout(()=>void sync(),250);
      });
      if(JSON.stringify(merged)!==JSON.stringify(result.conversations))void sync();
    }).catch(e=>{if(!disposed)setError((e as Error).message);});
    return()=>{disposed=true;stop();clearTimeout(timer);};
  },[owner,status,retry]);
  return <ReadyContext.Provider value={status==="authenticated" && ready===owner}>
    {error && <div role="alert" className="fixed bottom-2 left-2 z-[150] max-w-lg rounded-lg border border-line bg-surface p-3 text-sm">{error} Local messages are retained. <button onClick={()=>setRetry(n=>n+1)} className="ml-2 underline">Retry sync</button></div>}
    {children}
  </ReadyContext.Provider>;
}
