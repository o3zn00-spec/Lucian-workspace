import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { readCompleteBybitList } from "./pagination";
import { bybitRequest, getBybitConfig } from "./client";

const eligible = ["executing", "submitted", "reconciliation_required", "partially_filled", "exchange_open", "cancelled_with_fills"];
type Row = Record<string, unknown>;
type Page = { category?: string; list?: Row[]; nextPageCursor?: string };
const decimal = (value: unknown, positive = false) => {
  if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || Number(value) < 0 || (positive && Number(value) === 0)) throw Error("Malformed exchange quantity or price.");
  return Number(value);
};

export async function reconciliationCandidates(userId: string) {
  const intents = await db.liveTradeIntent.findMany({where:{userId,initiatedBy:"user",state:{in:eligible}},orderBy:{createdAt:"desc"},take:21,select:{id:true,productId:true,tradingMode:true,state:true,updatedAt:true}});
  // Completed orders must not disappear when the background watcher resolves
  // their reservation. Keep these separate so history cannot crowd out pending
  // risk reservations. Never expose the surrounding execution/error payload.
  const recent = await db.liveTradeIntent.findMany({where:{userId,initiatedBy:"user",state:{in:["filled","cancelled","rejected"]},updatedAt:{gte:new Date(Date.now()-7*86400000)}},orderBy:{updatedAt:"desc"},take:21,select:{id:true,productId:true,tradingMode:true,state:true,updatedAt:true,execution:true}});
  const completed = recent.slice(0,20).flatMap(({execution,...intent})=>{
    if(!execution || typeof execution!=="object" || Array.isArray(execution)) return [];
    const report=execution.reconciliation;
    if(!report || typeof report!=="object" || Array.isArray(report) || typeof report.observedAt!=="string" || typeof report.status!=="string" || typeof report.cumExecQty!=="string" || typeof report.leavesQty!=="string" || !Array.isArray(report.fills)) return [];
    return [{...intent,report:{observedAt:report.observedAt,status:report.status,cumExecQty:report.cumExecQty,leavesQty:report.leavesQty,fills:report.fills.map(fill=>{
      if(!fill || typeof fill!=="object" || Array.isArray(fill)) return null;
      return {execId:fill.execId,execQty:fill.execQty,execPrice:fill.execPrice,execFee:fill.execFee,feeCurrency:fill.feeCurrency,execTime:fill.execTime};
    }).filter(fill=>fill!==null),protectionVerified:false}}];
  });
  return {intents:intents.slice(0,20),completed,hasMore:intents.length>20,hasMoreCompleted:recent.length>20,message:intents.length?"Check each reservation against exchange records. This never submits or cancels an order.":"No unresolved owner order reservations. Review matched completed records below; an empty list does not prove a fill or recovery."};
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
  const orderPages=async(path:string,query:Record<string,string|number>)=>{
    const result=await readCompleteBybitList<Row>(async cursor=>{
      const page=await read(path,{...query,...(cursor?{cursor}:{})});
      pageRows(page); // Preserve category and per-page size validation.
      return page;
    },"Order history");
    return result.list!;
  };
  let source="realtime",orderRows=await orderPages("/v5/order/realtime",{limit:50});
  if(!orderRows.length){source="history";orderRows=await orderPages("/v5/order/history",{limit:50,startTime,endTime:now});}
  if(!orderRows.length) return {intentId,state:intent.state,resolved:false,message:"No matching exchange order yet. Reservation retained; no resubmission is permitted."};
  if(orderRows.length!==1) throw Error("Ambiguous exchange order identity. Reservation retained.");
  const order=orderRows[0];
  const side=intent.side.toLowerCase()==="buy"?"Buy":"Sell";
  const matches=(row:Row)=>row.symbol===symbol && row.side===side && row.orderLinkId===orderLinkId && typeof row.orderId==="string" && !!row.orderId && (!intent.providerOrderId || row.orderId===intent.providerOrderId);
  if(!matches(order) || typeof order.orderStatus!=="string") throw Error("Exchange order identity mismatch. Reservation retained.");
  const cumulative=decimal(order.cumExecQty),leaves=decimal(order.leavesQty);
  const requested=decimal(intent.baseSize?.toString(),true);
  const tolerance=Math.max(1e-12,requested*1e-9);
  if(Math.abs(decimal(order.qty,true)-requested)>tolerance || cumulative>requested+tolerance || leaves>requested+tolerance) throw Error("Exchange quantity does not match the owner reservation. Reservation retained.");
  if(["New","Untriggered","Triggered","PartiallyFilled","Filled"].includes(order.orderStatus) && Math.abs(cumulative+leaves-requested)>tolerance) throw Error("Exchange filled and remaining quantities do not match the reservation. Reservation retained.");
  const updated=Number(order.updatedTime);
  if(!Number.isSafeInteger(updated) || updated<startTime || updated>now+30000) throw Error("Invalid exchange order timestamp.");
  const previous=intent.execution && typeof intent.execution==="object" && !Array.isArray(intent.execution)?intent.execution:{};
  const last=previous.reconciliation;
  if(last && typeof last==="object" && !Array.isArray(last) && typeof last.updatedTime==="string" && updated<Number(last.updatedTime)) throw Error("Exchange order snapshot regressed. Reservation retained.");
  if(last && typeof last === "object" && !Array.isArray(last) && typeof last.cumExecQty === "string" && cumulative + tolerance < decimal(last.cumExecQty)) throw Error("Exchange filled quantity regressed. Reservation retained.");
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
    // Persist the handoff atomically with the matched fill. A retry/replay of
    // the same state cannot duplicate or re-open a dismissed notification.
    if (state !== intent.state && ["filled", "partially_filled", "cancelled_with_fills"].includes(state)) {
      const title = state === "filled" ? `${symbol} order filled — review exposure and exits` : `${symbol} partial fill needs review`;
      const message = `Exchange matched ${order.cumExecQty} filled and ${order.leavesQty} remaining. Fees are recorded in their exchange currencies. A fill does not verify protective orders, an exit or profit. Review Orders, Portfolio and matched records before another submission. No financial action was performed by this check.`;
      await tx.userNotification.upsert({
        where: { userId_dedupeKey: { userId, dedupeKey: `order-fill-review:${intent.id}:${state}` } },
        create: { userId, source: "markets", title, message, level: "warning", actionable: true, dedupeKey: `order-fill-review:${intent.id}:${state}`, entityRef: intent.id, deepLink: "/markets" },
        update: {},
      });
    }
  });
  return {intentId,state,resolved:["filled","cancelled","rejected"].includes(state),report,message:state==="cancelled_with_fills"?"The order was cancelled after partial fills. Its reservation remains blocked for exposure and protection review; you can recheck the exchange records. No order was submitted or cancelled by this check.":"Exchange records matched. No order submitted/cancelled, no wallet credited, and no protective exits certified."};
}
