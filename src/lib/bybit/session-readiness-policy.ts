import { AutonomousError, decimal, formatDecimal, isShortPlan, moneyCents, shortSettingsFor, type AutonomousPlan } from "./autonomous-policy";

export type SessionReadiness = {
  status: "needs_attention" | "existing_session";
  title: string;
  message: string;
  nextAction: string;
};
export type ReviewLimits = { maxOrder: string; maxExposure: string; maxDailyLoss: string; maxPositions: number; maxLeverage: string };
type Quote = { ask: string; bid: string; mark?: string; step: string; tick: string; minQty: string; minNotional: string; fee: string; atMs: number };
const scale=1000000000000n;
const ceil=(a:bigint,b:bigint)=>(a+b-1n)/b;
const dollars=(c:bigint)=>`${c/100n}.${String(c%100n).padStart(2,"0")}`;

// A lower bound, not a promised fill or a trading recommendation. Fail before
// paying for inference when even the exchange's minimum cannot fit the rules.
export function checkSessionMinimum(plan:AutonomousPlan,symbol:string,q:Quote,limits:ReviewLimits,now=Date.now()) {
  if(!Number.isSafeInteger(q.atMs)||q.atMs>now+1000||now-q.atMs>10000)throw new AutonomousError(`${symbol}: fresh market data is required for the size review.`);
  const ask=decimal(q.ask),bid=decimal(q.bid),step=decimal(q.step),fee=decimal(q.fee,true),mark=q.mark?decimal(q.mark):ask;
  if(bid>ask||fee>scale/10n)throw new AutonomousError(`${symbol}: market price or fee data is inconsistent.`);
  const qty=ceil([decimal(q.minQty),ceil(decimal(q.minNotional)*scale,bid)].reduce((a,b)=>a>b?a:b),step)*step;
  const basis=isShortPlan(plan)&&mark>ask?mark:ask;
  const gross=ceil(qty*basis*100n*BigInt(10000+plan.slippageBps),scale*scale*10000n);
  const fees=ceil(gross*fee*(isShortPlan(plan)?2n:1n),scale);
  const maxOrder=BigInt(Math.min(moneyCents(plan.maxOrder),moneyCents(limits.maxOrder),moneyCents(limits.maxExposure)));
  if(gross+fees>maxOrder)throw new AutonomousError(`${symbol}: the exchange minimum is ${formatDecimal(qty)} ${symbol.replace(/USDT$/,"")}, about ${dollars(gross+fees)} USDT including the reviewed price allowance and fees. Your effective order/exposure limit is ${dollars(maxOrder)} USDT. Choose an instrument with a smaller minimum or review larger limits; leverage does not reduce order notional.`);
  const margin=isShortPlan(plan)?ceil(gross*scale,decimal(shortSettingsFor(plan,symbol).leverage))+fees:gross+fees;
  if(margin>BigInt(moneyCents(plan.capital)))throw new AutonomousError(`${symbol}: the minimum order needs at least ${dollars(margin)} USDT of capital before stop reserves; the draft allocates ${plan.capital} USDT.`);
  return {symbol,minimumQuantity:formatDecimal(qty),minimumOrder:dollars(gross+fees),effectiveOrderLimit:dollars(maxOrder)};
}
