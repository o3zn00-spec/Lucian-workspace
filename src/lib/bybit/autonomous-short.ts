import "server-only";
import { createHash } from "node:crypto";
import { bybitRequest } from "./client";
import { readCompleteBybitList } from "./pagination";
import { AutonomousError, decimal, floorCents, linearFillTotals, signedDecimal, type ExecutionFill } from "./autonomous-policy";
type Row = Record<string, unknown>;
const scale = 1000000000000n;
const fail = (message: string): never => { throw new AutonomousError(message); };
async function rows(userId: string, path: string, query: Record<string, string | number>) {
  return (await readCompleteBybitList<Row>(cursor => bybitRequest(userId, path, { query: { ...query, ...(cursor ? { cursor } : {}) } }), "Short session records")).list!;
}
export function assertShortEnabled(mode: string) {
  if (mode === "bybit_live" && process.env.BYBIT_LIVE_SPOT_ONLY !== "false") fail("Live account remains Spot-only. Short sessions require separately configured derivatives access; existing limits are unchanged.");
}
// Never mutate leverage, margin mode or position mode as a side effect of a session.
export async function shortPosition(userId: string, symbol: string) {
  const list = await rows(userId, "/v5/position/list", { category: "linear", symbol, limit: 200 });
  if (list.length !== 1 || list[0].symbol !== symbol || list[0].positionIdx !== 0) fail("Short sessions require an existing one-way USDT perpetual position slot.");
  const p = list[0], quantity = decimal(p.size, true);
  if (quantity > 0n && (p.side !== "Sell" || p.positionStatus !== "Normal")) fail("Short position side/status differs from the owned journal. Reconcile on Bybit.");
  return { quantity, row: p };
}
export async function assertShortAccount(userId: string, symbol: string, flat = false) {
  const [info, p] = await Promise.all([bybitRequest<Row>(userId, "/v5/account/info", {}), shortPosition(userId, symbol)]);
  const blockers: string[] = [];
  if (info.marginMode !== "ISOLATED_MARGIN") {
    const current = info.marginMode === "REGULAR_MARGIN" ? "Cross" : info.marginMode === "PORTFOLIO_MARGIN" ? "Portfolio" : "unavailable";
    blockers.push(`Account margin mode is ${current}; Isolated is required`);
  }
  let leverage: bigint | null = null;
  try { leverage = decimal(p.row.leverage); } catch { /* Missing exchange data must remain blocked. */ }
  if (leverage !== scale) {
    const current = typeof p.row.leverage === "string" && /^\d{1,4}(?:\.\d{1,8})?$/.test(p.row.leverage) ? `${p.row.leverage}x` : "unavailable";
    blockers.push(`${symbol} leverage is ${current}; 1x is required`);
  }
  if (p.row.autoAddMargin !== 0) blockers.push(`${symbol} automatic margin additions are ${p.row.autoAddMargin === 1 ? "on" : "unavailable"}; off is required`);
  if (blockers.length) fail(`Short setup blocked: ${blockers.join(". ")}. No account settings were changed and no order was sent by this check.`);
  if (flat && p.quantity !== 0n) fail("Selected perpetual already has a position. Short sessions start flat.");
  return p;
}
export async function shortAvailable(userId: string) {
  const b = await bybitRequest<{list?: Row[]}>(userId, "/v5/account/wallet-balance", {query:{accountType:"UNIFIED"}});
  if (b.list?.length !== 1 || b.list[0].accountType !== "UNIFIED" || !Array.isArray(b.list[0].coin)) fail("Unified margin balance unavailable.");
  const coins = (b.list![0].coin as Row[]).filter(c=>c.coin === "USDT");
  if (coins.length !== 1) fail("USDT margin balance unavailable.");
  const c=coins[0];
  const available=decimal(c.walletBalance,true)-decimal(c.locked,true)-decimal(c.totalPositionIM,true)-decimal(c.totalOrderIM,true)-decimal(c.spotBorrow??"0",true)-decimal(c.bonus,true);
  if(available<0n)fail("USDT margin liabilities exceed wallet balance.");
  return available;
}
export async function assertOwnedShortOrders(userId: string, symbol: string, ids: string[]) {
  const orders=await rows(userId,"/v5/order/realtime",{category:"linear",symbol,openOnly:0,limit:50});
  if(orders.some(o=>o.symbol!==symbol || typeof o.orderId!=="string" || !ids.includes(o.orderId)))fail("An unrelated perpetual order exists. Session ownership requires reconciliation.");
}
export type ShortFill = ExecutionFill & {execId?: unknown;orderId?:unknown;execTime?:unknown};
// Match every financial journal row to the exclusive position window. Unknown
// external trades/margin operations retain ownership and stop further entries.
export async function shortLedger(userId:string,symbol:string,startedAtMs:number,fills:ShortFill[]) {
  const end=Date.now();
  if(!Number.isSafeInteger(startedAtMs)||startedAtMs>end||end-startedAtMs>8*86400000)fail("Short accounting window unavailable.");
  const all:Row[]=[], executions:Row[]=[];
  for(let start=startedAtMs;start<=end;start+=6*86400000+1) {
    const range={startTime:start,endTime:Math.min(end,start+6*86400000)};
    all.push(...await rows(userId,"/v5/account/transaction-log",{accountType:"UNIFIED",category:"linear",currency:"USDT",...range,limit:50}));
    executions.push(...await rows(userId,"/v5/execution/list",{category:"linear",symbol,...range,limit:100}));
  }
  for(const e of executions){
    if(e.symbol!==symbol || typeof e.execId!=="string" || !Number.isSafeInteger(Number(e.execTime)) || Number(e.execTime)<startedAtMs || Number(e.execTime)>end)fail("Unmatched perpetual execution history.");
    if(e.execType==="Trade") { if(!fills.some(f=>f.execId===e.execId&&f.orderId===e.orderId))fail("External perpetual execution detected. Ownership retained."); }
    else if(e.execType==="Funding") { if(!all.some(r=>r.symbol===symbol&&r.type==="SETTLEMENT"&&Number(r.transactionTime)===Number(e.execTime)&&signedDecimal(r.funding)===-signedDecimal(e.execFee)))fail("Funding ledger has not caught up with exchange execution history."); }
    else fail("Liquidation or other unowned execution requires reconciliation.");
  }
  if(fills.some(f=>!executions.some(e=>e.execId===f.execId&&e.orderId===f.orderId)))fail("Perpetual execution history is incomplete.");
  const matched=new Set<string>(),seen=new Map<string,string>();let net=0n,funding=0n,fees=0n;
  for(const r of all){
    if(r.symbol!==symbol)continue;
    const at=Number(r.transactionTime);
    if(r.category!=="linear"||r.currency!=="USDT"||typeof r.id!=="string"||!r.id||!Number.isSafeInteger(at)||at<startedAtMs||at>end)fail("Malformed short ledger identity.");
    const fingerprint=JSON.stringify(r);if(seen.has(String(r.id))){if(seen.get(String(r.id))!==fingerprint)fail("Conflicting short ledger records.");continue;}seen.set(String(r.id),fingerprint);
    const flow=signedDecimal(r.cashFlow),fee=signedDecimal(r.fee),fund=signedDecimal(r.funding),change=signedDecimal(r.change);
    if(change!==flow+fund-fee || r.transSubType && r.transSubType!=="")fail("Short ledger contains an untracked account operation.");
    if(r.type==="TRADE"){
      const f=fills.find(f=>f.execId===r.tradeId && f.orderId===r.orderId);
      if(!f || matched.has(String(r.tradeId)) || decimal(r.qty)!==decimal(f.execQty) || decimal(r.tradePrice)!==decimal(f.execPrice) || fee!==signedDecimal(f.execFee))fail("Short ledger does not match the owned fills.");
      matched.add(String(r.tradeId));
    } else if(r.type!=="SETTLEMENT" || r.side!=="Sell" || flow!==0n || fee!==0n)fail("Unowned perpetual activity requires reconciliation.");
    net+=change;funding+=fund;fees+=fee;
  }
  if(fills.some(f=>typeof f.execId!=="string"||!matched.has(f.execId)))fail("Exchange transaction ledger is still catching up with fills. Ownership retained.");
  return {tradingCents:floorCents(net-funding),netCents:floorCents(net),fundingCents:floorCents(funding),feesCents:-floorCents(-fees),fingerprint:createHash("sha256").update(JSON.stringify([...seen].sort())).digest("hex"),rowIds:[...seen.keys()],observedAtMs:end};
}
export function shortMark(entries:ExecutionFill[],exits:ExecutionFill[],ask:string,fee:string,fundingCents=0){
  const entry=linearFillTotals(entries),exit=linearFillTotals(exits),remaining=entry.quantity-exit.quantity;
  if(remaining<0n)fail("Short exits exceed owned entry.");
  const estimatedCover=remaining*decimal(ask)/scale;
  return {quantity:remaining,netCents:floorCents(entry.quote-exit.quote-estimatedCover-entry.fees-exit.fees-estimatedCover*decimal(fee,true)/scale)+fundingCents};
}

export async function shortFundingLoss(userId:string) {
  const end=Date.now(),start=end-86400000;
  const log=await rows(userId,"/v5/account/transaction-log",{accountType:"UNIFIED",category:"linear",currency:"USDT",startTime:start,endTime:end,limit:50});
  const seen=new Set<string>();let debits=0n;
  for(const row of log){
    if(row.category!=="linear"||row.currency!=="USDT"||typeof row.id!=="string"||!row.id||!Number.isSafeInteger(Number(row.transactionTime))||Number(row.transactionTime)<start||Number(row.transactionTime)>end)fail("Daily funding risk records unavailable.");
    if(seen.has(String(row.id)))fail("Duplicate daily funding records.");seen.add(String(row.id));
    const funding=signedDecimal(row.funding);if(funding<0n)debits-=funding;
  }
  return -floorCents(-debits)/100;
}

export async function assertShortHistory(userId:string,symbol:string,startedAtMs:number,fills:ShortFill[]) {
  const end=Date.now();if(!Number.isSafeInteger(startedAtMs)||startedAtMs>end||end-startedAtMs>8*86400000)fail("Short ownership window unavailable.");
  const found=new Set<string>();
  for(let start=startedAtMs;start<=end;start+=6*86400000+1){
    const records=await rows(userId,"/v5/execution/list",{category:"linear",symbol,startTime:start,endTime:Math.min(end,start+6*86400000),limit:100});
    for(const e of records){
      if(e.symbol!==symbol||typeof e.execId!=="string")fail("Unknown perpetual execution identity.");
      if(e.execType==="Funding")continue;
      const f=fills.find(f=>f.execId===e.execId&&f.orderId===e.orderId);
      if(e.execType!=="Trade"||!f||decimal(e.execQty)!==decimal(f.execQty)||decimal(e.execPrice)!==decimal(f.execPrice))fail("Unowned or liquidation execution detected. Reconcile on Bybit before further session actions.");
      found.add(String(e.execId));
    }
  }
  if(fills.some(f=>typeof f.execId!=="string"||!found.has(f.execId)))fail("Complete position ownership history unavailable.");
}
