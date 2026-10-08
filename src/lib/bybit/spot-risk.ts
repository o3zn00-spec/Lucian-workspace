import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { bybitRequest, getBybitConfig } from "@/lib/bybit/client";
import { spotLedger, type SpotFill, type SpotLots } from "@/lib/bybit/spot-ledger";

type Config = Awaited<ReturnType<typeof getBybitConfig>>;
type Row = Record<string,string>;
type Anchor = {version:1; startMs:number; usdt:number; connection:string};
const key = "_spot_risk:flat_anchor";
const week = 7*86_400_000;
const day = 86_400_000;
const checkpointKey = "_spot_risk:fifo_checkpoint";
type Checkpoint = { version:1; anchorStartMs:number; throughMs:number; usdt:number; connection:string; lots:SpotLots; realized:number; executions:number };
async function history(userId:string, config:Config, path:string, query:Record<string,string|number>, startMs:number, endMs:number) {
  // Each exchange request remains within the documented seven-day window.
  // A long unattended gap requires review rather than an unbounded request.
  if(endMs-startMs>28*day) throw new Error("Spot accounting has more than 28 days of unreviewed history. Manual ledger recovery is required; no losses were reset.");
  const result:Row[]=[];
  for(let from=startMs;from<=endMs;) {
    const to=Math.min(from+week-1,endMs);
    result.push(...await rows(userId,config,path,{...query,startTime:from,endTime:to}));
    from=to+1;
  }
  return result;
}
function connection(config: Config) { return createHash("sha256").update(`${config.environment}:${config.apiKey}`).digest("hex"); }
function amount(value: unknown) {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new Error("Spot wallet accounting data is malformed.");
  return Number(value);
}
async function rows(userId:string, config:Config, path:string, query:Record<string,string|number>) {
  const output: Row[] = [], seen = new Set<string>();
  let cursor = "";
  for(let page=0;page<20;page++) {
    const response = await bybitRequest<{list?:Row[]; nextPageCursor?:string; category?:string}>(userId,path,{query:{...query,...(cursor?{cursor}:{})}},config);
    if(!Array.isArray(response.list) || (response.category && query.category && response.category !== query.category)) throw new Error("Spot accounting history is unavailable or mismatched.");
    output.push(...response.list);
    if(!response.nextPageCursor) return output;
    if(seen.has(response.nextPageCursor)) throw new Error("Spot accounting pagination repeated.");
    cursor=response.nextPageCursor;seen.add(cursor);
  }
  throw new Error("Spot accounting history exceeds the bounded read. Review is required.");
}
async function wallet(userId:string, config:Config) {
  const result=await bybitRequest<{list?:Array<{accountType:string;coin?:Row[]}>}>(userId,"/v5/account/wallet-balance",{query:{accountType:"UNIFIED"}},config);
  if(!Array.isArray(result.list) || result.list.length!==1 || result.list[0].accountType!=="UNIFIED" || !Array.isArray(result.list[0].coin)) throw new Error("Unified accounting wallet is unavailable.");
  const coins=result.list[0].coin, seen=new Set<string>();
  for(const coin of coins) {
    if(!coin.coin || seen.has(coin.coin) || amount(coin.walletBalance)<0 || amount(coin.spotBorrow)!==0 || amount(coin.borrowAmount)!==0) throw new Error("Spot accounting requires unique, unborrowed wallet balances.");
    seen.add(coin.coin);
  }
  return coins;
}

/** Owner-only non-financial initialization. An existing anchor cannot be reset to erase losses. */
export async function initializeSpotRisk(userId:string, mode:unknown) {
  const config=await getBybitConfig(userId);
  if(!config.configured) throw new Error("Bybit is not connected.");
  if((mode!=="bybit_live" && mode!=="bybit_testnet") || config.environment !== (mode==="bybit_live"?"mainnet":"testnet")) throw new Error("Choose the accounting mode that matches the saved Bybit connection.");
  const existing=await db.assistantMemory.findUnique({where:{userId_key:{userId,key}}});
  if(existing) return readSpotRisk(userId,config);
  const startMs=Date.now();
  const [coins,positions,spotOrders,linearOrders]=await Promise.all([
    wallet(userId,config), rows(userId,config,"/v5/position/list",{category:"linear",settleCoin:"USDT",limit:200}),
    rows(userId,config,"/v5/order/realtime",{category:"spot",openOnly:0,limit:50}),
    rows(userId,config,"/v5/order/realtime",{category:"linear",settleCoin:"USDT",openOnly:0,limit:50}),
  ]);
  if(coins.some(c=>(c.coin!=="USDT" && amount(c.walletBalance)!==0) || amount(c.locked)!==0) || positions.some(p=>amount(p.size)!==0) || spotOrders.length || linearOrders.length) throw new Error("Initialize Spot accounting only with a flat, unlocked USDT Unified account and no open orders or derivatives.");
  const [fills,transactions]=await Promise.all([
    rows(userId,config,"/v5/execution/list",{category:"spot",startTime:startMs,endTime:Date.now(),limit:100}),
    rows(userId,config,"/v5/account/transaction-log",{accountType:"UNIFIED",startTime:startMs,endTime:Date.now(),limit:50}),
  ]);
  if(fills.length || transactions.length) throw new Error("Account activity occurred during initialization. Retry after the account settles.");
  const latest=await getBybitConfig(userId);
  if(latest.apiKey!==config.apiKey || latest.apiSecret!==config.apiSecret || latest.environment!==config.environment) throw new Error("Bybit connection changed during accounting initialization.");
  const anchor:Anchor={version:1,startMs,usdt:amount(coins.find(c=>c.coin==="USDT")?.walletBalance ?? "0"),connection:connection(config)};
  // Unique create protects two concurrent initializations; never overwrite an old baseline.
  await db.assistantMemory.create({data:{userId,key,value:JSON.stringify(anchor)}});
  await db.tradingAuditEvent.create({data:{userId,action:"spot.accounting.initialize",tradingMode:config.environment==="mainnet"?"bybit_live":"bybit_testnet",status:"initialized",details:{startMs,usdt:anchor.usdt}}});
  return readSpotRisk(userId,config);
}

export async function readSpotRisk(userId:string, config:Config) {
  const row=await db.assistantMemory.findUnique({where:{userId_key:{userId,key}}});
  if(!row) throw new Error("Spot loss accounting needs a flat-account baseline. Initialize it in Markets → Risk before live entries.");
  const anchor=JSON.parse(row.value) as Anchor, endMs=Date.now();
  if(anchor.version!==1 || !Number.isSafeInteger(anchor.startMs) || anchor.startMs>endMs || !Number.isFinite(anchor.usdt) || anchor.usdt<0 || anchor.connection!==connection(config)) throw new Error("Spot accounting baseline is invalid or the connection changed. Review the ledger; losses cannot be reset automatically.");
  const saved=await db.assistantMemory.findUnique({where:{userId_key:{userId,key:checkpointKey}}});
  const checkpoint=saved?JSON.parse(saved.value) as Checkpoint:null;
  if(checkpoint && (checkpoint.version!==1 || checkpoint.anchorStartMs!==anchor.startMs || checkpoint.connection!==anchor.connection || !Number.isSafeInteger(checkpoint.throughMs) || checkpoint.throughMs<anchor.startMs || checkpoint.throughMs>endMs-day || !Number.isFinite(checkpoint.usdt) || checkpoint.usdt<0 || !Number.isFinite(checkpoint.realized) || !Number.isSafeInteger(checkpoint.executions) || checkpoint.executions<0)) throw new Error("Spot FIFO checkpoint is invalid. Ledger review is required.");
  const fromMs=checkpoint?checkpoint.throughMs+1:anchor.startMs;
  const [fills,transactions,coins]=await Promise.all([
    history(userId,config,"/v5/execution/list",{category:"spot",limit:100},fromMs,endMs),
    history(userId,config,"/v5/account/transaction-log",{accountType:"UNIFIED",limit:50},fromMs,endMs),
    wallet(userId,config),
  ]);
  // Transfers, conversions, interest and derivative cash flows invalidate a Spot-only baseline.
  if(transactions.some(t=>t.type!=="TRADE" || t.category!=="spot")) throw new Error("Non-Spot account activity requires ledger review before new live entries.");
  const ledger=spotLedger(fills as SpotFill[],fromMs,endMs,endMs-day,checkpoint?.lots);
  const openingCash=checkpoint?.usdt??anchor.usdt;
  const expected:Record<string,number>={...ledger.inventory,USDT:openingCash+ledger.cashDelta};
  const observed=Object.fromEntries(coins.map(c=>[c.coin,amount(c.walletBalance)]));
  for(const coin of new Set([...Object.keys(expected),...Object.keys(observed)])) {
    const tolerance=coin==="USDT"?0.000001:0.0000000001;
    if(Math.abs((observed[coin]??0)-(expected[coin]??0))>tolerance) throw new Error("Spot fills and wallet balances do not reconcile. New live entries are blocked pending review.");
  }
  const latest=await getBybitConfig(userId);
  if(latest.apiKey!==config.apiKey || latest.apiSecret!==config.apiSecret || latest.environment!==config.environment) throw new Error("Bybit connection changed during ledger review.");
  // Keep two days replayable for exchange settling and the complete daily-loss window.
  // Only older, fully wallet-reconciled fills can become a durable FIFO checkpoint.
  const throughMs=endMs-2*day;
  if(throughMs>fromMs+day) {
    const older=spotLedger((fills as SpotFill[]).filter(f=>Number(f.execTime)<=throughMs),fromMs,throughMs,throughMs+1,checkpoint?.lots);
    const next:Checkpoint={version:1,anchorStartMs:anchor.startMs,throughMs,usdt:openingCash+older.cashDelta,connection:anchor.connection,lots:older.lots,realized:(checkpoint?.realized??0)+older.realized,executions:(checkpoint?.executions??0)+older.executions};
    await db.$transaction(async tx=>{
      if(saved) {
        const changed=await tx.assistantMemory.updateMany({where:{userId,key:checkpointKey,value:saved.value},data:{value:JSON.stringify(next)}});
        if(changed.count!==1) throw new Error("Spot checkpoint changed during review. Retry with the retained ledger.");
      } else await tx.assistantMemory.create({data:{userId,key:checkpointKey,value:JSON.stringify(next)}});
      await tx.assistantMemory.create({data:{userId,key:`_spot_risk:archive:${throughMs}`,value:JSON.stringify({previous:checkpoint,checkpoint:next})}});
      await tx.tradingAuditEvent.create({data:{userId,action:"spot.accounting.rollover",tradingMode:config.environment==="mainnet"?"bybit_live":"bybit_testnet",status:"reconciled",details:{throughMs,realized:next.realized,executions:next.executions}}});
    });
  }
  return {startMs:anchor.startMs,observedAtMs:endMs,checkpointThroughMs:checkpoint?.throughMs??null,...ledger,realized:(checkpoint?.realized??0)+ledger.realized,executions:(checkpoint?.executions??0)+ledger.executions};
}
