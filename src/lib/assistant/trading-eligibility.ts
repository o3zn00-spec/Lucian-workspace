import "server-only";
import { db } from "@/lib/db";
import { getBybitConfig } from "@/lib/bybit/client";
import { getTradingProfile } from "@/lib/bybit/trading";
import { autonomousSnapshot } from "@/lib/bybit/autonomous-session";
import { autonomousQuote, autonomousWallet, connectionIdentity } from "@/lib/bybit/autonomous-market";
import { assertShortEnabled, detectShortAccount, shortAvailable, assertOwnedShortOrders, shortResearchEvidence } from "@/lib/bybit/autonomous-short";
import { AutonomousError, validateAutonomousPlan, isShortPlan, decimal, formatDecimal, moneyCents } from "@/lib/bybit/autonomous-policy";
import { checkSessionMinimum } from "@/lib/bybit/session-readiness-policy";
import { tradingPlanSnapshot } from "./trading-plan";
import { tradingReadAllowed, tradingActivityReadAllowed } from "./tool-access";

import { LIVE_CRYPTO_LUCIAN_SYMBOLS, toBybitSymbol } from "@/lib/markets/symbol-mapping";

const allowed = async (owner: string) => await tradingReadAllowed(owner) && await tradingActivityReadAllowed(owner);
const sample = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT"];
export async function readTradingEligibility(owner: string, args: Record<string, unknown>) {
  if (args.scope !== undefined && args.scope !== "configured" || args.products !== undefined && (!Array.isArray(args.products) || !args.products.length || args.products.length > 2 || new Set(args.products).size !== args.products.length || args.products.some(p => p !== "spot" && p !== "linear_short")) || Object.keys(args).some(k => k !== "symbols" && k !== "products" && k !== "scope") || args.symbols !== undefined && (!Array.isArray(args.symbols) || args.symbols.length < 1 || args.symbols.length > 5 || args.symbols.some(s => typeof s !== "string" || !/^[A-Z0-9]{2,16}USDT$/.test(s)) || new Set(args.symbols).size !== args.symbols.length)) return { status: "invalid_request", message: "Use 1–5 unique USDT symbols or scope configured; optional products contains spot and/or linear_short. No owner, URL, limits or settings arguments are accepted." };
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
    const symbols = args.symbols as string[] | undefined ?? (args.scope === "configured" ? [...new Set([...plan.symbols,...sample,...LIVE_CRYPTO_LUCIAN_SYMBOLS.map(toBybitSymbol)])] : [...new Set([...plan.symbols,...sample])].slice(0,5));
    const products = (args.products ?? [plan.product ?? "spot"]) as Array<"spot" | "linear_short">;
    const globalBlockers: string[] = [];
    if(profile.emergencyStop)globalBlockers.push("Emergency stop is active.");
    if(await db.liveTradeIntent.findFirst({where:{userId:owner,state:{in:["queued","executing","submitted","reconciliation_required","partially_filled","exchange_open","cancelled_with_fills"]}},select:{id:true}}))globalBlockers.push("An exchange reservation requires reconciliation in the session review.");
    const results = [];
    const detailed = {spot:0,linear_short:0};
    // Batches of four independent candidate reads, bounded by catalog and elapsed time.
    // No automatic retry, exchange mutation or inference per candidate.
    const started = Date.now();
    const check = async (symbol: string, product: "spot" | "linear_short") => {
      if(Date.now()-started>45000){return {symbol,product,status:"unavailable",reason:"Read budget reached; this symbol was not checked."};}
      if(!await allowed(owner))return {status:"permission_revoked",message:"Read permission changed; results withheld."};
      try {
        const candidate = {...plan,product,symbols:[symbol]};
        delete candidate.shortSettings;
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
        // Keep whole-catalog responses below the chat tool's output budget.
        // Additional minimum fits remain explicit candidates for a targeted read.
        if (args.scope === "configured" && detailed[product] >= 2) {
          return {product,status:"minimum_size_fits",...minimum,observedAt:new Date(quote.atMs).toISOString(),detail:"Minimum fit only; request targeted eligibility for fees, collateral and protection review before selecting this candidate."};
        }
        detailed[product]++;
        // Preserve the actual evidence already fetched, rather than making the
        // model spend another turn asking for fees, funding and margin facts.
        let accountEvidence = null;
        let accountEvidenceError: string | null = null;
        if (isShortPlan(candidate)) {
          try { accountEvidence = await shortResearchEvidence(owner,candidate); }
          catch (e) { accountEvidenceError = e instanceof AutonomousError ? e.message : "Current collateral, order and risk-tier evidence unavailable."; }
        }
        return {product,status:"minimum_size_fits",...minimum,availableUSDT:formatDecimal(available),shortSettings:candidate.shortSettings??null,quote,accountEvidence,accountEvidenceError,observedAt:new Date(quote.atMs).toISOString(),remainingChecks:"Session review and execution must refresh these observations and validate the chosen quantity, stop and target against current limits. Quote fee is the account taker rate; funding null means unavailable, not zero. Bid/ask is a snapshot, not a guaranteed fill or measured market impact. Protection is planned until exchange acknowledgement. No authorization is granted."};
      } catch(e) {
        return {symbol,product,status:e instanceof AutonomousError?"blocked":"unavailable",reason:e instanceof AutonomousError?e.message:"Current instrument/account data could not be verified. No eligibility assumed."};
      }
    }
    const candidates = symbols.flatMap(symbol => products.map(product => ({symbol,product})));
    for (let offset = 0; offset < candidates.length; offset += 4) {
      const batch = await Promise.all(candidates.slice(offset,offset+4).map(c => check(c.symbol,c.product)));
      results.push(...batch);
      if (!await allowed(owner)) return {status:"permission_revoked",message:"Read permission changed; results withheld."};
    }
    const [latest,latestConfig,latestProfile,current]=await Promise.all([tradingPlanSnapshot(owner),getBybitConfig(owner),getTradingProfile(owner),autonomousSnapshot(owner)]);
    if(!await allowed(owner))return {status:"permission_revoked",message:"Read permission changed; results withheld."};
    if(latest.revision!==saved.revision||connectionIdentity(latestConfig)!==connectionIdentity(config)||JSON.stringify(latestProfile)!==JSON.stringify(profile)||current.session&&(current.session.status!=="stopped"||current.session.active))return {status:"state_changed",message:"Plan, account limits, connection or session changed during checks. Read again before proposing a draft."};
    await db.assistantActivity.create({data:{userId:owner,tool:"trading.eligibility.read",module:"markets",status:"completed",reason:`Returned ${results.length} candidate results, including explicit unavailable reads; no draft, financial request or account setting changed.`}});
    return {status:"checked",revision:saved.revision,product:plan.product??"spot",comparedProducts:products,requestedCandidates:symbols.length*products.length,draftRules:plan,session:{status:session?.status??"none",hasOwnedHolding:false},accountLimits:limits,globalBlockers,results,coverage:"Bounded candidate sample, not every exchange instrument. Minimum-size fit is not full trading eligibility. Values can change; session review and execution recheck them.",nextAction:"If the owner requested an alternative and a candidate fits, update only the unapproved draft symbols, explicitly requested product and obsolete settings wording using this revision; preserve dollar limits. Name the evidence and remaining checks. If none fit, report exact blockers; do not invent an alternative or raise limits.",financialAction:false};
  } catch {
    return {status:"unavailable",message:"Eligibility data unavailable. Do not claim a fitting instrument or expose provider errors. No financial action occurred."};
  }
}
