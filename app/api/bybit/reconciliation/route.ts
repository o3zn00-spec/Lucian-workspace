import {requireOwnerId} from "@/lib/auth/owner";
import {AuthError} from "@/lib/auth/errors";
import {reconciliationCandidates,reconcileTerminalOrder} from "@/lib/bybit/reconciliation";
import {start} from "workflow/api";
import {orderWatchWorkflow} from "@/workflows/order-watch";
import {claimOrderWatch,recordOrderWatch,orderWatchSummaries,stopOrderWatch} from "@/lib/bybit/order-watch";
import {launchWatchSupervisor} from "@/lib/bybit/watch-supervision";
import {reviewOrderProtection} from "@/lib/bybit/protection-review";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=120;
const failure=(e:unknown)=>Response.json({error:e instanceof AuthError?"Owner authentication required.":e instanceof Error?e.message:"Reconciliation unavailable."},{status:e instanceof AuthError?e.statusCode:400,headers:{"Cache-Control":"private, no-store"}});
export async function GET(){try{
 const userId=await requireOwnerId();const candidates=await reconciliationCandidates(userId);
 const watches=await orderWatchSummaries(userId,candidates.intents.map(i=>i.id));
 return Response.json({...candidates,intents:candidates.intents.map(i=>({...i,watch:watches[i.id]??null}))},{headers:{"Cache-Control":"private, no-store"}});
}catch(e){return failure(e);}}
export async function POST(req:Request){try{
  const userId=await requireOwnerId();
  if(req.headers.get("origin")!==new URL(process.env.AUTH_APP_URL??req.url).origin) return Response.json({error:"Same-origin request required."},{status:403});
  const raw=await req.text();if(raw.length>300)throw Error("Request too large.");const body=JSON.parse(raw);
  if(!body || Object.keys(body).some(k=>!["intentId","action"].includes(k)) || (body.action!==undefined && !["watch","stop_watch","protection"].includes(body.action)) || typeof body.intentId!=="string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.intentId))throw Error("Choose an owner reservation.");
  if(body.action==="protection") {
    return Response.json({message:"Protective order evidence refreshed. No order was changed.",protection:await reviewOrderProtection(userId,body.intentId)},{headers:{"Cache-Control":"private, no-store"}});
  }
  if(body.action==="stop_watch") {
    await stopOrderWatch(userId,body.intentId);
    return Response.json({message:"Read-only monitoring stopped. Existing exchange orders and protective exits were not changed.",watch:(await orderWatchSummaries(userId,[body.intentId]))[body.intentId]??null},{headers:{"Cache-Control":"private, no-store"}});
  }
  if(body.action==="watch") {
    const claim=await claimOrderWatch(userId,body.intentId);
    if(claim.claimed) {
      await launchWatchSupervisor(userId,body.intentId,claim.state);
      try { const run=await start(orderWatchWorkflow,[userId,body.intentId,claim.state.generation],{region:"cpt1"});await recordOrderWatch(userId,body.intentId,claim.state.generation,run.runId); }
      catch {await recordOrderWatch(userId,body.intentId,claim.state.generation,null);throw Error("Monitoring could not start. No financial action was performed; retry monitoring.");}
    }
    return Response.json({message:claim.claimed?"Read-only exchange monitoring started for up to 24 hours. No trade is placed or managed.":"Read-only monitoring is already active. No duplicate worker was requested.",watch:(await orderWatchSummaries(userId,[body.intentId]))[body.intentId]??null},{headers:{"Cache-Control":"private, no-store"}});
  }
  return Response.json(await reconcileTerminalOrder(userId,body.intentId),{headers:{"Cache-Control":"private, no-store"}});
}catch(e){return failure(e);}}
