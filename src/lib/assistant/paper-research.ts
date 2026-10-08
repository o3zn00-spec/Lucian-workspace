import "server-only";
export type ResearchMarket = {symbol:string; intervalMinutes:number; candles:{atMs:number;close:number}[]; changePercent:number;sma20:number;sma50:number;rangePercent:number;source:string};
export type PaperResearch = {observedAtMs:number;markets:ResearchMarket[];announcements:{title:string;url:string;publishedAtMs:number}[];warnings:string[]};
export type PaperReview = {atMs:number;research:PaperResearch|null;action:string;rationale:string;outcome:string};
async function publicData(url:URL) {
  const r=await fetch(url,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error("Public research unavailable.");
  const raw=await r.text();if(raw.length>200000)throw Error("Research response too large.");
  const b=JSON.parse(raw);if(b.retCode!==0 || !Number.isSafeInteger(b.time) || Math.abs(Date.now()-b.time)>10000 || !Array.isArray(b.result?.list))throw Error("Invalid research response.");
  return b;
}
export function parseResearchCandles(rows:unknown, symbol:string, intervalMinutes:number, observedAtMs:number):ResearchMarket {
  if(!Array.isArray(rows) || rows.length>61)throw Error("Invalid candles.");
  const candles=rows.map(row=>{
    if(!Array.isArray(row) || row.length!==7 || row.some(v=>typeof v!=="string"))throw Error("Invalid candle row.");
    const [atMs,open,high,low,close,volume,turnover]=row.map(Number);
    if(!Number.isSafeInteger(atMs) || atMs<=0 || atMs% (intervalMinutes*60000)!==0 || [open,high,low,close].some(v=>!Number.isFinite(v) || v<=0 || v>1e12) || high<Math.max(open,close) || low>Math.min(open,close) || high<low || !Number.isFinite(volume) || volume<0 || !Number.isFinite(turnover) || turnover<0)throw Error("Invalid candle values.");
    return {atMs,close,high,low};
  }).filter(c=>c.atMs+intervalMinutes*60000<=observedAtMs).sort((a,b)=>a.atMs-b.atMs).slice(-60);
  if(candles.length<50 || candles.some((c,i)=>i>0 && c.atMs-candles[i-1].atMs!==intervalMinutes*60000) || observedAtMs-(candles.at(-1)!.atMs+intervalMinutes*60000)>intervalMinutes*60000)throw Error("Incomplete or stale candle history.");
  const average=(n:number)=>candles.slice(-n).reduce((sum,c)=>sum+c.close,0)/n;
  const first=candles[0].close,last=candles.at(-1)!.close;
  return {symbol,intervalMinutes,candles:candles.map(({atMs,close})=>({atMs,close})),changePercent:(last/first-1)*100,sma20:average(20),sma50:average(50),rangePercent:(Math.max(...candles.map(c=>c.high))/Math.min(...candles.map(c=>c.low))-1)*100,source:`https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${intervalMinutes}&limit=61`};
}
export async function collectPaperResearch(symbols:string[]):Promise<PaperResearch> {
  if(!symbols.length || symbols.length>10 || symbols.some(s=>!/^[A-Z0-9]{2,16}USDT$/.test(s)))throw Error("Invalid research symbols.");
  const markets=await Promise.all(symbols.flatMap(symbol=>[5,60].map(async interval=>{
    const url=new URL("https://api.bybit.com/v5/market/kline");url.search=new URLSearchParams({category:"spot",symbol,interval:String(interval),limit:"61"}).toString();
    const b=await publicData(url);if(b.result.symbol!==symbol || b.result.category!=="spot")throw Error("Research symbol mismatch.");
    return parseResearchCandles(b.result.list,symbol,interval,b.time);
  })));
  const warnings:string[]=[],announcements:PaperResearch["announcements"]=[];
  try {
    const url=new URL("https://api.bybit.com/v5/announcements/index?locale=en-US&limit=20");const b=await publicData(url);
    for(const item of b.result.list.slice(0,20)) {
      if(typeof item.title!=="string" || typeof item.url!=="string" || !Number.isSafeInteger(item.publishTime) || item.publishTime>b.time || b.time-item.publishTime>7*86400000)continue;
      const link=new URL(item.url);if(link.protocol!=="https:" || !["announcements.bybit.com","www.bybit.com","bybit.com"].includes(link.hostname) || link.username || link.password)continue;
      announcements.push({title:item.title.replace(/<[^>]*>/g,"").slice(0,180),url:link.href,publishedAtMs:item.publishTime});
    }
  }catch{warnings.push("Exchange announcements unavailable. No news conclusion is supported.");}
  warnings.push("Research covers Bybit public candles and recent exchange announcements only; it is not comprehensive financial or macroeconomic research.");
  return {observedAtMs:Date.now(),markets,announcements,warnings};
}
