import { requireOwnerId } from "@/lib/auth/owner";
import { AuthError } from "@/lib/auth/errors";
import { publicData,collectPaperResearch } from "@/lib/assistant/paper-research";
import { parseReplayBars,replayStrategy } from "@/lib/assistant/strategy-replay";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=60;
export async function GET(){
  try{
    await requireOwnerId();
    const symbols=["BTCUSDT","ETHUSDT"];
    const [research,...replays]=await Promise.all([collectPaperResearch(symbols),...symbols.map(async symbol=>{
      const source=`https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=60&limit=1000`;
      const data=await publicData(new URL(source));if(data.result?.symbol!==symbol||data.result?.category!=="spot")throw Error("Historical market mismatch.");
      const bars=parseReplayBars(data.result.list,data.time);
      return {symbol,source,baseline:replayStrategy(bars,10,5),stressed:replayStrategy(bars,20,20),holdout:replayStrategy(bars,10,5,bars.length-168)};
    })]);
    return Response.json({ok:true,observedAtMs:Date.now(),research,replays,limitations:"Historical reference SMA20/50 strategy; not Lilthe's real-time model. Signals use prior closes, next-open fills, adverse stop-first OHLC path, 50 USDT positions, 20 USDT loss-entry cutoff, 1% stop/2% target, 24h exit. Last 7 days are a fixed reporting segment, not statistically independent out-of-sample proof. No queue/partial-fill/order-book model. USD references are not USDT execution quotes. Live readiness is not inferred."},{headers:{"Cache-Control":"private, no-store"}});
  }catch(e){return Response.json({ok:false,error:e instanceof AuthError?e.message:"Validation research unavailable or incomplete. No strategy result is inferred."},{status:e instanceof AuthError?e.statusCode:503});}
}
