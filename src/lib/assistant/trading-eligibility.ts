import "server-only";
import { db } from "@/lib/db";
import { getBybitConfig } from "@/lib/bybit/client";
import { getTradingProfile } from "@/lib/bybit/trading";
import { autonomousSnapshot } from "@/lib/bybit/autonomous-session";
import { autonomousQuote, autonomousWallet, connectionIdentity } from "@/lib/bybit/autonomous-market";
import { assertShortEnabled, detectShortAccount, shortAvailable, assertOwnedShortOrders } from "@/lib/bybit/autonomous-short";
import { AutonomousError, validateAutonomousPlan, isShortPlan, decimal, formatDecimal, moneyCents } from "@/lib/bybit/autonomous-policy";
import { checkSessionMinimum } from "@/lib/bybit/session-readiness-policy";
import { tradingPlanSnapshot } from "./trading-plan";
import { tradingReadAllowed, tradingActivityReadAllowed } from "./tool-access";

const allowed = async (owner: string) => await tradingReadAllowed(owner) && await tradingActivityReadAllowed(owner);
const sample = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"];
export async function readTradingEligibility(owner: string, args: Record<string, unknown>) {
  if (Object.keys(args).some(k => k !== "symbols") || args.symbols !== undefined && (!Array.isArray(args.symbols) || args.symbols.length < 1 || args.symbols.length > 5 || args.symbols.some(s => typeof s !== "string" || !/^[A-Z0-9]{2,16}USDT$/.test(s)) || new Set(args.symbols).size !== args.symbols.length)) return { status: "invalid_request", message: "Use no arguments for the saved draft plus a bounded sample, or 1–5 unique USDT symbols. No owner, URL, limits or settings arguments are accepted." };
  if (!await allowed(owner)) return { status: "permission_required", message: "Enable Bybit balance and open-order/position reads in Tool activity and permissions to check account eligibility. No exchange data was read." };
  await db.assistantActivity.create({data:{userId:owner,tool:"trading.eligibility.read",module:"markets",status:"started",reason:"Owner-permitted bounded instrument/account feasibility reads; no execution or settings changes."}});
  try {
    const { session } = await autonomousSnapshot(owner);
    if (session && (session.status !== "stopped" || session.active)) return {status:"existing_session",message:"Manage the existing session before preparing another.",session:{id:session.id,status:session.status,hasOwnedHolding:Boolean(session.active)}};
    const saved = await tradingPlanSnapshot(owner);
    if (!saved.complete) return {status:"incomplete_plan",missing:saved.missing,message:"Finish the saved draft rules first; do not invent missing risk limits."};
    const plan = validateAutonomousPlan(saved.draft.rules);
    const config = await getBybitConfig(owner);
    if (!config.configured || config.environment !== (plan.mode === "bybit_live" ? "mainnet" : "testnet")) return {status:"connection_mismatch",message:"Saved plan mode must match the configured Bybit connection."};
    const profile = await getTradingProfile(owner);
    const limits = {maxOrder:String(profile.maxOrderUsd),maxExposure:String(profile.maxPositionUsd),maxDailyLoss:String(profile.maxDailyLossUsd),maxPositions:profile.maxOpenPositions,maxLeverage:String(profile.maxLeverage)};
    const symbols = args.symbols as string[] | undefined ?? [...new Set([...plan.symbols,...sample])].slice(0,5);
    const globalBlockers: string[] = [];
    if(profile.emergencyStop)globalBlockers.push("Emergency stop is active.");
    if(await db.liveTradeIntent.findFirst({where:{userId:owner,state:{in:["queued","executing","submitted","reconciliation_required","partially_filled","exchange_open","cancelled_with_fills"]}},select:{id:true}}))globalBlockers.push("An exchange reservation requires reconciliation in the session review.");
    const results = [];
    // Sequential and bounded: no whole-exchange scan or automatic retry.
    const started = Date.now();
    for (const symbol of symbols) {
      if(Date.now()-started>45000){results.push({symbol,status:"unavailable",reason:"Read budget reached; this symbol was not checked."});continue;}
      if(!await allowed(owner))return {status:"permission_revoked",message:"Read permission changed; results withheld."};
      try {
        const candidate = {...plan,symbols:[symbol]};
        let available: bigint;
        if(isShortPlan(candidate)) {
          assertShortEnabled(candidate.mode);
          candidate.shortSettings = await detectShortAccount(owner,[symbol]);
          if(decimal(candidate.shortSettings.positions[symbol].leverage)>decimal(limits.maxLeverage))throw new AutonomousError(`${symbol} leverage exceeds the saved account leverage limit.`);
          await assertOwnedShortOrders(owner,symbol,[]);
          available = await shortAvailable(owner,candidate.shortSettings.marginMode);
        } else {
          const wallet=await autonomousWallet(owner);
          available=wallet.find(c=>c.coin==="USDT")?.available??0n;
          if(wallet.some(c=>c.coin+"USDT"===symbol&&c.total!==0n))throw new AutonomousError(`${symbol} has existing inventory; it cannot be silently adopted.`);
        }
        if(available*100n/1000000000000n<BigInt(moneyCents(candidate.capital)))throw new AutonomousError("Draft capital exceeds available unborrowed USDT.");
        const quote=await autonomousQuote(owner,symbol,isShortPlan(candidate)?"linear":"spot");
        const minimum=checkSessionMinimum(candidate,symbol,quote,limits);
        results.push({status:"minimum_size_fits",...minimum,availableUSDT:formatDecimal(available),shortSettings:candidate.shortSettings??null,observedAt:new Date(quote.atMs).toISOString(),remainingChecks:"Full review must still pass; an actual entry/stop/target must fit risk, fees, exchange tiers, open orders and current limits. This is not a trade recommendation or an authorization."});
      } catch(e) {
        results.push({symbol,status:e instanceof AutonomousError?"blocked":"unavailable",reason:e instanceof AutonomousError?e.message:"Current instrument/account data could not be verified. No eligibility assumed."});
      }
    }
    const [latest,latestConfig,latestProfile,current]=await Promise.all([tradingPlanSnapshot(owner),getBybitConfig(owner),getTradingProfile(owner),autonomousSnapshot(owner)]);
    if(!await allowed(owner))return {status:"permission_revoked",message:"Read permission changed; results withheld."};
    if(latest.revision!==saved.revision||connectionIdentity(latestConfig)!==connectionIdentity(config)||JSON.stringify(latestProfile)!==JSON.stringify(profile)||current.session&&(current.session.status!=="stopped"||current.session.active))return {status:"state_changed",message:"Plan, account limits, connection or session changed during checks. Read again before proposing a draft."};
    await db.assistantActivity.create({data:{userId:owner,tool:"trading.eligibility.read",module:"markets",status:"completed",reason:`Checked ${results.length} candidates; no draft, financial request or account setting changed.`}});
    return {status:"checked",revision:saved.revision,product:plan.product??"spot",accountLimits:limits,globalBlockers,results,coverage:"Bounded candidate sample, not every exchange instrument. Minimum-size fit is not full trading eligibility. Values can change; session review and execution recheck them.",nextAction:"If the owner requested an alternative and a candidate fits, update only the unapproved draft symbols and obsolete settings wording using this revision; preserve dollar limits. Name the evidence and remaining checks. If none fit, report exact blockers; do not invent an alternative or raise limits.",financialAction:false};
  } catch {
    return {status:"unavailable",message:"Eligibility data unavailable. Do not claim a fitting instrument or expose provider errors. No financial action occurred."};
  }
}
