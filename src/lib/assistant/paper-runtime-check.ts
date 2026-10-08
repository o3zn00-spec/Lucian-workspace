import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { PaperPlanError } from "./paper-policy";
import { paperMarketQuotes } from "./paper-market";
import { runPaperTick } from "./paper-runtime";
const key="_paper_session:runtime_check";
export async function runtimeCheckSnapshot(userId:string) {
  const row=await db.assistantMemory.findUnique({where:{userId_key:{userId,key}}});
  if(!row)return null;
  const check=JSON.parse(row.value);
  return {id:check.id,status:check.status,startedAtMs:check.startedAtMs,checkedAtMs:check.checkedAtMs??null,message:check.message};
}
export async function reserveRuntimeCheck(userId:string) {
  return db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"paper-check:"+userId}))::text`;
    const old=await tx.assistantMemory.findUnique({where:{userId_key:{userId,key}}});
    if(old && Date.now()-JSON.parse(old.value).startedAtMs<60000)throw new PaperPlanError("Wait one minute before another runtime check.",429);
    const check={id:randomUUID(),status:"queued",startedAtMs:Date.now(),message:"Checking database, public prices and durable wake-up. No session or funds."};
    await tx.assistantMemory.upsert({where:{userId_key:{userId,key}},create:{userId,key,value:JSON.stringify(check)},update:{value:JSON.stringify(check)}});
    return check;
  });
}
export async function runtimeCheckStage(userId:string,id:string,final:boolean,dispatchFailed=false) {
  let ok=false;
  if(!dispatchFailed)try {
    await paperMarketQuotes(["BTCUSDT"]);
    // Impossible synthetic session identity exercises the real transaction/lease path.
    // It cannot match a session UUID and therefore cannot reserve or execute a fill.
    ok=(await runPaperTick(userId,"verification:"+id,"verification")).done;
  }catch{ok=false;}
  await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"paper-check:"+userId}))::text`;
    const row=await tx.assistantMemory.findUnique({where:{userId_key:{userId,key}}});
    if(!row)return;const check=JSON.parse(row.value);if(check.id!==id)return;
    if(check.status==="failed")return;
    check.status=ok?(final?"passed":"waiting"):"failed";check.checkedAtMs=Date.now();
    check.message=ok?(final?"Database, public Bybit quotes and durable sleep/wake passed. No paper or live session started.":"Database and public quotes passed; waiting for durable wake-up."):"Runtime check failed. No trading session or financial action occurred.";
    await tx.assistantMemory.update({where:{userId_key:{userId,key}},data:{value:JSON.stringify(check)}});
  });
}
