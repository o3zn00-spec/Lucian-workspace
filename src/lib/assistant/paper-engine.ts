import { cents, validatePaperPlan, type PaperPlan } from "./paper-policy";
import { evaluatePaperEntry, fixedPaperDecimal, type PaperQuote } from "./paper-risk";
import type { PaperReview } from "./paper-research";
export type PaperPosition = { symbol: string; quantity: string; stopPrice: string; takeProfit: string; debitCents: number; riskCents: number };
export type PaperFill = { atMs: number; symbol: string; side: "buy" | "sell"; quantity: string; amountCents: number; reason: string };
export type PaperSession = {
  id: string; revision: string; generation: string; planRevision: string; plan: PaperPlan;
  provider: "gemini" | "openai" | "anthropic" | "openrouter" | "deepseek";
  model: string; effort: "low" | "medium" | "high";
  status: "running" | "paused" | "closing" | "stopped";
  startedAtMs: number; updatedAtMs: number; nextTickAtMs: number; nextReviewAtMs: number;
  cashCents: number; equityCents: number; ordersPlaced: number; positions: PaperPosition[];
  fills: PaperFill[]; history: {atMs: number; equityCents: number}[];
  lastMessage: string; error: string | null; runId: string | null;
  reviewCount?: number; reviews?: PaperReview[];
  lease: { token: string; untilMs: number } | null;
};
export type PaperProposal = ({action:"hold"} | {action:"sell";symbol:string} | {action:"buy";symbol:string;quantity:string;stopPrice:string;takeProfit:string}) & {rationale?:string};
export function parsePaperProposal(raw: string): PaperProposal {
  if (raw.length > 3000) throw Error("Proposal too large.");
  const p = JSON.parse(raw);
  if (!p || Array.isArray(p) || typeof p !== "object") throw Error("Invalid proposal.");
  const keys = p.action === "hold" ? ["action"] : p.action === "sell" ? ["action","symbol"] : p.action === "buy" ? ["action","symbol","quantity","stopPrice","takeProfit"] : [];
  if ("rationale" in p) {if(typeof p.rationale!=="string" || p.rationale.length>500)throw Error("Invalid rationale.");keys.push("rationale");}
  if (!keys.length || keys.length !== Object.keys(p).length || Object.keys(p).some(k => !keys.includes(k))) throw Error("Invalid proposal fields.");
  if (p.action !== "hold" && (typeof p.symbol !== "string" || !/^[A-Z0-9]{2,16}USDT$/.test(p.symbol))) throw Error("Invalid symbol.");
  if (p.action === "buy") for (const field of [p.quantity,p.stopPrice,p.takeProfit]) fixedPaperDecimal(field);
  return p;
}
export function paperExitProceeds(position: Pick<PaperPosition,"quantity">, quote: PaperQuote, plan: PaperPlan): number {
  const gross = fixedPaperDecimal(position.quantity) * fixedPaperDecimal(quote.bid) * 100n * BigInt(10000-plan.slippageBps) / (100000000n * 100000000n * 10000n);
  const fee = (gross * BigInt(plan.feeBps) + 9999n) / 10000n;
  if (gross-fee > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("Proceeds out of range.");
  return Number(gross-fee);
}
export function validatePaperSession(s: PaperSession): PaperSession {
  validatePaperPlan(s.plan);
  if (!s.id || !s.revision || !s.generation || !s.planRevision || !["running","paused","closing","stopped"].includes(s.status) || !["gemini","openai","anthropic","openrouter","deepseek"].includes(s.provider) || !["low","medium","high"].includes(s.effort) || typeof s.model !== "string" || !s.model || s.model.length>150) throw Error("Invalid session identity.");
  for (const n of [s.startedAtMs,s.updatedAtMs,s.nextTickAtMs,s.nextReviewAtMs,s.cashCents,s.equityCents,s.ordersPlaced]) if (!Number.isSafeInteger(n) || n < 0) throw Error("Invalid session ledger.");
  if (!Array.isArray(s.positions) || s.positions.length>10 || new Set(s.positions.map(p=>p.symbol)).size!==s.positions.length || !Array.isArray(s.fills) || s.fills.length>200 || !Array.isArray(s.history) || s.history.length>200) throw Error("Invalid history.");
  for (const p of s.positions) {
    if (!s.plan.symbols.includes(p.symbol) || !Number.isSafeInteger(p.debitCents) || p.debitCents <= 0 || !Number.isSafeInteger(p.riskCents) || p.riskCents < 0) throw Error("Invalid position.");
    for (const n of [p.quantity,p.stopPrice,p.takeProfit]) fixedPaperDecimal(n);
    if (fixedPaperDecimal(p.takeProfit)<=fixedPaperDecimal(p.stopPrice)) throw Error("Invalid exits.");
  }
  if (s.ordersPlaced>s.plan.maxOrders || s.positions.length>s.plan.maxPositions || (s.status==="stopped" && s.positions.length) || typeof s.lastMessage!=="string" || s.lastMessage.length>2000 || (s.error!==null && (typeof s.error!=="string" || s.error.length>2000)) || (s.runId!==null && (typeof s.runId!=="string" || s.runId.length>300))) throw Error("Invalid session metadata.");
  if(s.reviewCount!==undefined && (!Number.isInteger(s.reviewCount) || s.reviewCount<0 || s.reviewCount>30))throw Error("Invalid review budget.");
  if(s.reviews!==undefined && (!Array.isArray(s.reviews) || s.reviews.length>20 || s.reviews.some(r=>!Number.isSafeInteger(r.atMs) || r.atMs<s.startedAtMs || r.atMs>s.updatedAtMs || !["hold","buy","sell","unavailable"].includes(r.action) || typeof r.rationale!=="string" || r.rationale.length>500 || typeof r.outcome!=="string" || r.outcome.length>2000)))throw Error("Invalid review history.");
  for(const review of s.reviews??[]) {
    const r=review.research;if(r===null)continue;
    if(!r || !Number.isSafeInteger(r.observedAtMs) || r.observedAtMs<s.startedAtMs || r.observedAtMs>review.atMs || !Array.isArray(r.markets) || r.markets.length>s.plan.symbols.length*2 || !Array.isArray(r.announcements) || r.announcements.length>20 || !Array.isArray(r.warnings) || r.warnings.length>3 || r.warnings.some(w=>typeof w!=="string" || w.length>500))throw Error("Invalid research report.");
    for(const m of r.markets) {
      if(!s.plan.symbols.includes(m.symbol) || ![5,60].includes(m.intervalMinutes) || m.source!==`https://api.bybit.com/v5/market/kline?category=spot&symbol=${m.symbol}&interval=${m.intervalMinutes}&limit=61` || !Array.isArray(m.candles) || m.candles.length>60 || [m.changePercent,m.sma20,m.sma50,m.rangePercent].some(n=>!Number.isFinite(n)))throw Error("Invalid research market.");
      let previous=0;for(const c of m.candles){if(!Number.isSafeInteger(c.atMs) || c.atMs<=previous || c.atMs>=r.observedAtMs || !Number.isFinite(c.close) || c.close<=0)throw Error("Invalid research series.");previous=c.atMs;}
    }
    for(const a of r.announcements){const url=new URL(a.url);if(url.protocol!=="https:" || !["announcements.bybit.com","www.bybit.com","bybit.com"].includes(url.hostname) || url.username || url.password || typeof a.title!=="string" || a.title.length>180 || !Number.isSafeInteger(a.publishedAtMs) || a.publishedAtMs>r.observedAtMs)throw Error("Invalid research source.");}
  }
  let balance=BigInt(cents(s.plan.capital)),buys=0,previous=0;
  const quantities=new Map<string,bigint>();
  for (const f of s.fills) {
    if (!s.plan.symbols.includes(f.symbol) || !["buy","sell"].includes(f.side) || !Number.isSafeInteger(f.atMs) || f.atMs<s.startedAtMs || f.atMs<previous || f.atMs>s.updatedAtMs || !Number.isSafeInteger(f.amountCents) || f.amountCents<0 || typeof f.reason!=="string" || f.reason.length>200) throw Error("Invalid fill history.");
    const qty=fixedPaperDecimal(f.quantity);previous=f.atMs;
    balance+=BigInt(f.amountCents)*(f.side==="buy"?-1n:1n);
    if(f.side==="buy") {buys++;if(quantities.has(f.symbol))throw Error("Duplicate paper entry.");quantities.set(f.symbol,qty);}
    else {if(quantities.get(f.symbol)!==qty)throw Error("Invalid paper exit.");quantities.delete(f.symbol);}
  }
  if (balance!==BigInt(s.cashCents) || buys!==s.ordersPlaced || quantities.size!==s.positions.length || s.positions.some(p=>quantities.get(p.symbol)!==fixedPaperDecimal(p.quantity))) throw Error("Paper ledger does not reconcile.");
  previous=0;
  for(const h of s.history) {if(!Number.isSafeInteger(h.atMs) || h.atMs<s.startedAtMs || h.atMs<previous || h.atMs>s.updatedAtMs || !Number.isSafeInteger(h.equityCents) || h.equityCents<0)throw Error("Invalid equity history.");previous=h.atMs;}
  if (s.lease && (typeof s.lease.token!=="string" || !Number.isSafeInteger(s.lease.untilMs) || s.lease.untilMs<0)) throw Error("Invalid lease.");
  return s;
}
export function applyPaperCycle(input: PaperSession, quotes: Record<string,PaperQuote>, proposal: PaperProposal | null, nowMs: number): PaperSession {
  const s = structuredClone(validatePaperSession(input));
  if (s.status === "stopped") return s;
  if (!Number.isSafeInteger(nowMs) || nowMs<s.updatedAtMs) throw Error("Invalid cycle time.");
  // A cycle needs prices for all allowed symbols. Failure produces no invented fills.
  for (const symbol of s.plan.symbols) {
    const q=quotes[symbol];
    if (!q || q.symbol!==symbol || !q.instrumentVerified || !Number.isSafeInteger(q.observedAtMs) || q.observedAtMs>nowMs || nowMs-q.observedAtMs>s.plan.maxDataAgeSeconds*1000 || fixedPaperDecimal(q.bid)>fixedPaperDecimal(q.ask)) throw Error("Fresh verified quotes required.");
  }
  const expired = nowMs-s.startedAtMs>=s.plan.durationHours*3600000;
  s.equityCents=s.cashCents+s.positions.reduce((total,p)=>total+paperExitProceeds(p,quotes[p.symbol],s.plan),0);
  const lossReached=cents(s.plan.capital)-s.equityCents>=cents(s.plan.maxLoss);
  if (expired || lossReached) s.status="closing";
  for (const p of [...s.positions]) {
    const q=quotes[p.symbol], price=fixedPaperDecimal(q.bid);
    const exit = s.status==="closing" ? (expired?"Session expired":lossReached?"Session loss limit":"Owner stop") : price<=fixedPaperDecimal(p.stopPrice)?"Stop loss":price>=fixedPaperDecimal(p.takeProfit)?"Take profit":proposal?.action==="sell" && proposal.symbol===p.symbol && s.status==="running"?"Model exit":null;
    if (!exit) continue;
    const proceeds=paperExitProceeds(p,q,s.plan);
    s.cashCents+=proceeds; s.positions=s.positions.filter(other=>other.symbol!==p.symbol);
    s.fills.push({atMs:nowMs,symbol:p.symbol,side:"sell",quantity:p.quantity,amountCents:proceeds,reason:exit});
    s.lastMessage=exit+" · "+p.symbol;
  }
  s.equityCents=s.cashCents+s.positions.reduce((total,p)=>total+paperExitProceeds(p,quotes[p.symbol],s.plan),0);
  if (s.status==="closing" && !s.positions.length) {s.status="stopped";s.lastMessage=expired?"Session expired; paper positions closed.":lossReached?"Loss limit reached; paper positions closed.":"Stopped; paper positions closed.";}
  if (proposal?.action==="buy" && s.status==="running") {
    if (s.positions.some(p=>p.symbol===proposal.symbol)) s.lastMessage="Entry rejected: a position already exists for this symbol.";
    else if (!quotes[proposal.symbol] || fixedPaperDecimal(proposal.takeProfit)<=fixedPaperDecimal(quotes[proposal.symbol].ask)) s.lastMessage="Entry rejected: invalid take-profit price.";
    else {
      const result=evaluatePaperEntry(s.plan,{status:"running",authorized:true,emergencyStop:false,startedAtMs:s.startedAtMs,snapshotAtMs:nowMs,cashCents:s.cashCents,exposureCents:s.positions.reduce((a,p)=>a+p.debitCents,0),equityCents:s.equityCents,openRiskCents:s.positions.reduce((a,p)=>a+p.riskCents,0),ordersPlaced:s.ordersPlaced,positionSymbols:s.positions.map(p=>p.symbol)},proposal,quotes[proposal.symbol],nowMs);
      if (!result.allowed) s.lastMessage="Entry rejected: "+result.reason;
      else {
        s.cashCents-=result.debitCents;s.ordersPlaced++;
        s.positions.push({symbol:proposal.symbol,quantity:proposal.quantity,stopPrice:proposal.stopPrice,takeProfit:proposal.takeProfit,debitCents:result.debitCents,riskCents:result.riskCents});
        s.fills.push({atMs:nowMs,symbol:proposal.symbol,side:"buy",quantity:proposal.quantity,amountCents:result.debitCents,reason:"Model paper entry"});
        s.lastMessage="Paper entry · "+proposal.symbol;
      }
    }
  } else if (proposal?.action==="hold" && s.status==="running") s.lastMessage="Model reviewed markets and chose to hold.";
  s.equityCents=s.cashCents+s.positions.reduce((total,p)=>total+paperExitProceeds(p,quotes[p.symbol],s.plan),0);
  s.updatedAtMs=nowMs;s.error=null;s.lease=null;s.nextTickAtMs=nowMs+60000;
  if (proposal) s.nextReviewAtMs=nowMs+s.plan.reviewMinutes*60000;
  s.history.push({atMs:nowMs,equityCents:s.equityCents});s.history=s.history.slice(-200);s.fills=s.fills.slice(-200);
  return s;
}
