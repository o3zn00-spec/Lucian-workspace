import "server-only";
import { fixedPaperDecimal, type PaperQuote } from "./paper-risk";
async function bybit(path: string, symbol: string) {
  const url=new URL("https://api.bybit.com/v5/market/"+path);url.searchParams.set("category","spot");url.searchParams.set("symbol",symbol);
  const response=await fetch(url,{cache:"no-store",signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw Error("Bybit public market data unavailable.");
  const body=await response.json();
  if (body.retCode!==0 || !Array.isArray(body.result?.list) || body.result.list.length!==1 || !Number.isSafeInteger(body.time)) throw Error("Invalid Bybit public market response.");
  return {row:body.result.list[0],time:body.time};
}
export async function paperMarketQuotes(symbols: string[]): Promise<Record<string,PaperQuote>> {
  if (!symbols.length || symbols.length>10 || symbols.some(s=>!/^[A-Z0-9]{2,16}USDT$/.test(s))) throw Error("Invalid market symbols.");
  const results=await Promise.all(symbols.map(async symbol=>{
    const [instrument,ticker]=await Promise.all([bybit("instruments-info",symbol),bybit("tickers",symbol)]);
    const i=instrument.row,t=ticker.row;
    if (i.symbol!==symbol || i.status!=="Trading" || i.quoteCoin!=="USDT" || t.symbol!==symbol) throw Error("Spot instrument unavailable.");
    const quote:PaperQuote={symbol,bid:t.bid1Price,ask:t.ask1Price,observedAtMs:ticker.time,instrumentVerified:true,quantityStep:i.lotSizeFilter?.basePrecision,minQuantity:i.lotSizeFilter?.minOrderQty,minNotional:i.lotSizeFilter?.minOrderAmt};
    for (const decimal of [quote.bid,quote.ask,quote.quantityStep,quote.minQuantity,quote.minNotional]) fixedPaperDecimal(decimal);
    if (fixedPaperDecimal(quote.bid)>fixedPaperDecimal(quote.ask) || Math.abs(Date.now()-quote.observedAtMs)>10000) throw Error("Invalid or stale spot quote.");
    return [symbol,quote] as const;
  }));
  return Object.fromEntries(results);
}
