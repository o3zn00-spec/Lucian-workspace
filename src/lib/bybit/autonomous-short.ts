import "server-only";
import { createHash } from "node:crypto";
import { bybitRequest, bybitPublicRequest, getBybitConfig } from "./client";
import { readCompleteBybitList } from "./pagination";
import { AutonomousError, decimal, floorCents, linearFillTotals, signedDecimal, shortSettingsFor, shortAccountFor, formatDecimal, type AutonomousPlan, type AutonomousDecision, type ShortAccountSettings, type ExecutionFill } from "./autonomous-policy";
type Row = Record<string, unknown>;
const scale = 1000000000000n;
const fail = (message: string): never => { throw new AutonomousError(message); };
async function rows(userId: string, path: string, query: Record<string, string | number>) {
  return (await readCompleteBybitList<Row>(cursor => bybitRequest(userId, path, { query: { ...query, ...(cursor ? { cursor } : {}) } }), "Short session records")).list!;
}
export function assertShortEnabled(mode: string) {
  if (mode === "bybit_live" && process.env.BYBIT_LIVE_SPOT_ONLY !== "false") fail("Live account remains Spot-only. Short sessions require separately configured derivatives access; existing limits are unchanged.");
}
// Reading an account must never change its leverage, margin or position mode.
export async function shortPosition(userId: string, symbol: string, positionIdx?: 0 | 2) {
  const list = await rows(userId, "/v5/position/list", { category: "linear", symbol, limit: 200 });
  if (!list.length || list.some(p => p.symbol !== symbol) || new Set(list.map(p => p.positionIdx)).size !== list.length) fail("Ambiguous perpetual position slots.");
  const mode = list.map(p => p.positionIdx).sort().join(",");
  if (mode !== "0" && mode !== "1,2") fail("Unsupported or incomplete perpetual position mode.");
  const idx = positionIdx ?? (mode === "0" ? 0 : 2);
  const p = list.find(p => p.positionIdx === idx);
  if (!p) fail("Reviewed perpetual position mode changed. Existing orders remain reserved.");
  // A second leg on the same symbol would make the shared symbol ledger ambiguous.
  if (list.some(other => other !== p && decimal(other.size, true) !== 0n)) fail("An unrelated hedge position exists on this symbol. Ownership requires reconciliation.");
  const quantity = decimal(p!.size, true);
  if (quantity > 0n && (p!.side !== "Sell" || p!.positionStatus !== "Normal")) fail("Short position side/status differs from the owned journal. Reconcile on Bybit.");
  return { quantity, row: p!, positionIdx: idx };
}
export async function assertShortAccount(userId: string, symbol: string, flat = false, expected?: ShortAccountSettings) {
  const [info, p] = await Promise.all([bybitRequest<Row>(userId, "/v5/account/info", {}), shortPosition(userId, symbol, expected?.positions[symbol]?.positionIdx)]);
  const blockers: string[] = [];
  const marginMode = info.marginMode;
  if (marginMode !== "ISOLATED_MARGIN" && marginMode !== "REGULAR_MARGIN") blockers.push(`Account margin mode is ${marginMode === "PORTFOLIO_MARGIN" ? "Portfolio" : "unavailable"}; this engine supports Cross and Isolated`);
  let leverage: bigint | null = null;
  try { leverage = decimal(p.row.leverage); } catch { /* Missing data is not 1x. */ }
  if (leverage === null || leverage < scale || leverage > 1000n * scale) blockers.push(`${symbol} leverage is unavailable or outside supported numeric bounds`);
  if (marginMode === "ISOLATED_MARGIN" && p.row.autoAddMargin !== 0 && p.row.autoAddMargin !== 1) blockers.push(`${symbol} automatic margin additions are unavailable`);
  if (flat && p.quantity !== 0n) blockers.push(`${symbol} already has a position; short sessions start flat`);
  if (flat && p.row.isReduceOnly === true) blockers.push(`${symbol} is restricted to reduce-only by Bybit`);
  if (blockers.length) fail(`Short setup blocked: ${blockers.join(". ")}. No settings changed or order sent by this check.`);
  const settings = { leverage: formatDecimal(leverage!), positionIdx: p.positionIdx, autoAddMargin: (marginMode === "REGULAR_MARGIN" ? 0 : p.row.autoAddMargin) as 0 | 1 };
  const pinned = expected?.positions[symbol];
  if (expected && (!pinned || expected.marginMode !== marginMode || decimal(pinned.leverage) !== leverage || pinned.positionIdx !== settings.positionIdx || pinned.autoAddMargin !== settings.autoAddMargin)) fail(`${symbol} margin, leverage or automatic margin settings changed since review. New entries require a fresh reviewed session; owned exits remain available.`);
  return { ...p, settings, marginMode: marginMode as ShortAccountSettings["marginMode"] };
}
export async function detectShortAccount(userId: string, symbols: string[]) {
  const positions: ShortAccountSettings["positions"] = {};
  const results = await Promise.allSettled(symbols.map(symbol => assertShortAccount(userId, symbol, true)));
  const blockers = results.flatMap(r => r.status === "rejected" ? [r.reason instanceof Error ? r.reason.message : "Account settings unavailable"] : []);
  if (blockers.length) fail(blockers.join("; "));
  const accounts = results.map(r => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof assertShortAccount>>>).value);
  if (accounts.some(p => p.marginMode !== accounts[0].marginMode)) fail("Margin mode changed during account detection. Load a fresh review.");
  accounts.forEach((p, i) => { positions[symbols[i]] = p.settings; });
  return { marginMode: accounts[0].marginMode, positions };
}
export async function shortAvailable(userId: string, marginMode: ShortAccountSettings["marginMode"] = "ISOLATED_MARGIN") {
  const b = await bybitRequest<{list?: Row[]}>(userId, "/v5/account/wallet-balance", {query:{accountType:"UNIFIED"}});
  if (b.list?.length !== 1 || b.list[0].accountType !== "UNIFIED" || !Array.isArray(b.list[0].coin)) fail("Unified margin balance unavailable.");
  const account = b.list![0], coins = (account.coin as Row[]).filter(c=>c.coin === "USDT");
  if (coins.length !== 1) fail("USDT margin balance unavailable.");
  const c=coins[0];
  let available=decimal(c.walletBalance,true)-decimal(c.locked,true)-decimal(c.totalPositionIM,true)-decimal(c.totalOrderIM,true)-decimal(c.spotBorrow??"0",true)-decimal(c.bonus,true);
  if (marginMode === "REGULAR_MARGIN") {
    // Account-wide cross collateral is USD; convert using the reported USDT
    // equity valuation, then cap by unborrowed USDT. Never spend other coins.
    const equity = signedDecimal(c.equity), usd = signedDecimal(c.usdValue);
    if (equity <= 0n || usd <= 0n) return 0n;
    const cross = signedDecimal(account.totalAvailableBalance) * equity / usd;
    available = cross < available ? cross : available;
    if (decimal(account.accountIMRate,true) >= scale || decimal(account.accountMMRate,true) >= scale) return 0n;
  }
  return available > 0n ? available : 0n;
}
export async function assertShortEntryMargin(userId: string, plan: AutonomousPlan, d: AutonomousDecision, q: {ask:string;bid:string;mark?:string;fee:string}) {
  if (!plan.shortSettings) return; // Legacy grants keep their original checks.
  const config = await getBybitConfig(userId), symbol = d.symbol!;
  const result = await readCompleteBybitList<Row>(cursor => bybitPublicRequest(config.environment, "/v5/market/risk-limit", {category:"linear",symbol,...(cursor ? {cursor} : {})}), "Short risk tiers");
  const qty=decimal(d.quantity), stop=decimal(d.stopPrice), ask=decimal(q.ask), mark=decimal(q.mark), fee=decimal(q.fee,true);
  const basis = mark > ask ? mark : ask;
  const stressed = qty * (stop > basis ? stop : basis) * BigInt(10000 + plan.slippageBps) / (scale * 10000n);
  const tiers = result.list!.filter(t => t.symbol === symbol && decimal(t.riskLimitValue) >= stressed).sort((a,b) => Number(decimal(a.riskLimitValue)-decimal(b.riskLimitValue)));
  if (!tiers.length) fail("Short size exceeds available exchange risk tiers.");
  const tier = tiers[0], leverage = decimal(shortSettingsFor(plan,symbol).leverage);
  if (leverage > decimal(tier.maxLeverage)) fail("Detected leverage exceeds the exchange risk tier for this size.");
  const mm = decimal(String(tier.maintenanceMargin),true), im = decimal(String(tier.initialMargin));
  if (mm >= scale || im > scale || im < mm) fail("Invalid exchange margin rates.");
  const initial = qty*basis/leverage;
  // Conservative standalone solvency at the adverse stop, ignoring deductions
  // and unrelated collateral. Exchange liquidation remains monitored after fill.
  const loss = (qty*stop*BigInt(10000+plan.slippageBps)/10000n - qty*decimal(q.bid)*BigInt(10000-plan.slippageBps)/10000n)/scale;
  const maintenance = stressed*mm/scale;
  const fees = stressed*2n*fee/scale;
  if (initial < qty*basis/scale*im/scale || initial <= loss+maintenance+fees) fail("Stop distance, fees and exchange maintenance margin exceed the detected leverage margin. Choose a closer valid stop or review different account settings.");
  const available = await shortAvailable(userId, shortAccountFor(plan).marginMode);
  if (available < initial+loss+fees) fail("Available margin no longer covers this entry and its stop reserve.");
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
