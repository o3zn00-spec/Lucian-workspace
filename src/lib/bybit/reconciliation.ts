import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { bybitRequest, getBybitConfig } from "./client";

const eligible = ["executing", "submitted", "reconciliation_required", "partially_filled", "exchange_open"];
type Row = Record<string, unknown>;
type Page = { category?: string; list?: Row[]; nextPageCursor?: string };
const decimal = (value: unknown, positive = false) => {
  if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || Number(value) < 0 || (positive && Number(value) === 0)) throw Error("Malformed exchange quantity or price.");
  return Number(value);
};

export async function reconciliationCandidates(userId: string) {
  const intents = await db.liveTradeIntent.findMany({where:{userId,initiatedBy:"user",state:{in:eligible}},orderBy:{createdAt:"desc"},take:21,select:{id:true,productId:true,tradingMode:true,state:true,updatedAt:true}});
  return {intents:intents.slice(0,20),hasMore:intents.length>20,message:intents.length?"Check each reservation against exchange records. This never submits or cancels an order.":"No unresolved owner order reservations. No exchange fill or recovery has been proven by this empty list."};
}

export async function reconcileTerminalOrder(userId: string, intentId: string) {
  const intent=await db.liveTradeIntent.findFirst({where:{id:intentId,userId,initiatedBy:"user"}});
  if(!intent || !eligible.includes(intent.state)) throw Error("No eligible owner order reservation.");
  if(intent.state==="executing" && Date.now()-intent.updatedAt.getTime()<120000) throw Error("Submission may still be in progress. Wait before reconciliation.");
  if(!["spot","linear"].includes(intent.category) || !["bybit_live","bybit_testnet"].includes(intent.tradingMode)) throw Error("Unsupported reservation category or environment.");
  const now=Date.now(),startTime=intent.createdAt.getTime()-60000;
  if(now-startTime>7*86400000 || startTime>now) throw Error("Reservation is outside the supported seven-day reconciliation window. Review older history manually; it has not been released.");
  const config=await getBybitConfig(userId);
  if(!config.configured || config.environment!==(intent.tradingMode==="bybit_live"?"mainnet":"testnet")) throw Error("Saved exchange environment does not match this reservation.");
  const category=intent.category,symbol=intent.productId,orderLinkId=intent.clientOrderId;
  const read = (path:string,query:Record<string,string|number>)=>bybitRequest<Page>(userId,path,{query:{category,symbol,orderLinkId,...query}},config);
  const pageRows=(page:Page)=>{if(page.category!==category || !Array.isArray(page.list) || page.list.length>100 || (page.nextPageCursor!==undefined && typeof page.nextPageCursor!=="string")) throw Error("Malformed exchange records.");return page.list;};
  // Order history is the fallback when Bybit's recent closed-order cache is cleared.
  const orderPageRows=(page:Page)=>{const rows=pageRows(page);if(page.nextPageCursor) throw Error("Order history is incomplete. Reservation retained.");return rows;};
  let source="realtime",orderRows=orderPageRows(await read("/v5/order/realtime",{limit:50}));
  if(!orderRows.length){source="history";orderRows=orderPageRows(await read("/v5/order/history",{limit:50,startTime,endTime:now}));}
  if(!orderRows.length) return {intentId,state:intent.state,resolved:false,message:"No matching exchange order yet. Reservation retained; no resubmission is permitted."};
  if(orderRows.length!==1) throw Error("Ambiguous exchange order identity. Reservation retained.");
  const order=orderRows[0];
  const side=intent.side.toLowerCase()==="buy"?"Buy":"Sell";
  const matches=(row:Row)=>row.symbol===symbol && row.side===side && row.orderLinkId===orderLinkId && typeof row.orderId==="string" && !!row.orderId && (!intent.providerOrderId || row.orderId===intent.providerOrderId);
  if(!matches(order) || typeof order.orderStatus!=="string") throw Error("Exchange order identity mismatch. Reservation retained.");
  const cumulative=decimal(order.cumExecQty),leaves=decimal(order.leavesQty);
  const updated=Number(order.updatedTime);
  if(!Number.isSafeInteger(updated) || updated<startTime || updated>now+30000) throw Error("Invalid exchange order timestamp.");
  const previous=intent.execution && typeof intent.execution==="object" && !Array.isArray(intent.execution)?intent.execution:{};
  const last=previous.reconciliation;
  if(last && typeof last==="object" && !Array.isArray(last) && typeof last.updatedTime==="string" && updated<Number(last.updatedTime)) throw Error("Exchange order snapshot regressed. Reservation retained.");
  const fills:Row[]=[],seen=new Map<string,string>(),cursors=new Set<string>();let cursor="";
  for(let i=0;i<4;i++){
    const page=await read("/v5/execution/list",{orderId:order.orderId as string,startTime,endTime:now,limit:100,...(cursor?{cursor}:{})});
    for(const row of pageRows(page)){
      if(!matches(row) || row.orderId!==order.orderId || typeof row.execId!=="string" || !row.execId || row.execType!=="Trade") throw Error("Unexpected execution identity/type. Reservation retained.");
      decimal(row.execQty,true);decimal(row.execPrice,true);
      const time=Number(row.execTime);if(!Number.isSafeInteger(time) || time<startTime || time>now+30000) throw Error("Invalid fill timestamp.");
      if(typeof row.execFee!=="string" || !/^-?\d+(\.\d+)?$/.test(row.execFee) || !Number.isFinite(Number(row.execFee))) throw Error("Malformed fill fee.");
      const fingerprint=JSON.stringify([row.orderId,row.execQty,row.execPrice,row.execFee,row.feeCurrency,row.execTime]);
      if(seen.has(row.execId)){if(seen.get(row.execId)!==fingerprint) throw Error("Conflicting duplicate execution.");continue;}
      seen.set(row.execId,fingerprint);
      fills.push({execId:row.execId,orderId:row.orderId,execQty:row.execQty,execPrice:row.execPrice,execFee:row.execFee,feeCurrency:typeof row.feeCurrency==="string"?row.feeCurrency:null,execTime:row.execTime});
    }
    cursor=page.nextPageCursor??"";if(!cursor) break;
    if(cursors.has(cursor) || i===3) throw Error("Execution history is incomplete. Reservation retained.");cursors.add(cursor);
  }
  const filled=fills.reduce((sum,f)=>sum+Number(f.execQty),0);
  if(!Number.isFinite(filled) || Math.abs(filled-cumulative)>Math.max(1e-12,cumulative*1e-9)) throw Error("Order and execution quantities disagree. Reservation retained; retry after exchange records settle.");
  const status=order.orderStatus;
  let state:string;
  if(status==="Filled" && cumulative>0 && leaves===0) state="filled";
  else if(["Cancelled","PartiallyFilledCanceled","Rejected","Deactivated"].includes(status)) state=cumulative>0?"cancelled_with_fills":status==="Rejected"?"rejected":"cancelled";
  else if(status==="PartiallyFilled" && cumulative>0 && leaves>0) state="partially_filled";
  else if(["New","Untriggered","Triggered"].includes(status) && cumulative===0) state="exchange_open";
  else throw Error("Unsupported or inconsistent exchange status. Reservation retained.");
  const report={observedAt:new Date(now).toISOString(),source,orderLinkId,orderId:order.orderId,status,updatedTime:String(updated),cumExecQty:order.cumExecQty,leavesQty:order.leavesQty,fills,feesByCurrencyOnly:true,protectionVerified:false};
  await db.$transaction(async tx=>{
    const changed=await tx.liveTradeIntent.updateMany({where:{id:intent.id,userId,state:intent.state,updatedAt:intent.updatedAt},data:{state,providerOrderId:order.orderId as string,execution:{...previous,reconciliation:report} as Prisma.InputJsonValue}});
    if(changed.count!==1) throw Error("Reservation changed during reconciliation. Refresh and review before retrying.");
    await tx.tradingAuditEvent.create({data:{userId,action:"order.reconcile",tradingMode:intent.tradingMode,status:state,symbol,intentId:intent.id,details:report as Prisma.InputJsonValue}});
  });
  return {intentId,state,resolved:["filled","cancelled_with_fills","cancelled","rejected"].includes(state),report,message:"Exchange records matched. No order submitted/cancelled, no wallet credited, and no protective exits certified."};
}
