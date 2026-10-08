import assert from 'node:assert/strict';
import {build} from 'esbuild';
async function bundle(path){const b=await build({entryPoints:[path],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'server',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server',namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:''}));}}]});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const r=await bundle('src/lib/assistant/paper-research.ts');
const interval=300000,time=Math.floor(Date.now()/interval)*interval+10000;
const rows=Array.from({length:61},(_,i)=>[String(time-10000-i*interval),'100','102','99','101','5','505']);
const m=r.parseResearchCandles(rows,'BTCUSDT',5,time);assert.equal(m.candles.length,60);assert.equal(m.candles.at(-1).atMs,time-10000-interval);assert.equal(m.sma20,101);assert.equal(m.changePercent,0);
await assert.rejects(async()=>r.parseResearchCandles(rows.slice(0,10),'BTCUSDT',5,time));
const duplicate=structuredClone(rows);duplicate[4]=duplicate[3];assert.throws(()=>r.parseResearchCandles(duplicate,'BTCUSDT',5,time));
const corrupt=structuredClone(rows);corrupt[2][2]='90';assert.throws(()=>r.parseResearchCandles(corrupt,'BTCUSDT',5,time));assert.throws(()=>r.parseResearchCandles(rows,'BTCUSDT',5,time+3*interval));
// Fixed public endpoints only. Partial-news outage is explicit, missing candles fail closed.
const oldFetch=globalThis.fetch;
globalThis.fetch=async(url)=>{if(url.pathname.includes('announcements'))throw Error('offline');const n=Number(url.searchParams.get('interval')),unit=n*60000,t=Math.floor(Date.now()/unit)*unit;return Response.json({retCode:0,time:Date.now(),result:{category:'spot',symbol:url.searchParams.get('symbol'),list:Array.from({length:61},(_,i)=>[String(t-i*unit),'100','102','99','101','5','505'])}});};
const report=await r.collectPaperResearch(['BTCUSDT']);assert.equal(report.markets.length,2);assert.equal(report.announcements.length,0);assert.match(report.warnings[0],/unavailable/);
globalThis.fetch=async()=>Response.json({retCode:0,time:Date.now(),result:{category:'spot',symbol:'ETHUSDT',list:rows}});await assert.rejects(r.collectPaperResearch(['BTCUSDT']),/mismatch/);await assert.rejects(r.collectPaperResearch(['BTCUSDT&url=evil']));globalThis.fetch=oldFetch;
const results=await bundle('src/lib/assistant/paper-results.ts');
const s={plan:{capital:'1000'},cashCents:98985,equityCents:98985,positions:[],fills:[{side:'buy',symbol:'BTCUSDT',amountCents:5009},{side:'sell',symbol:'BTCUSDT',amountCents:3994}],history:[{equityCents:100000},{equityCents:98985}]};
assert.deepEqual(results.paperResults(s),{realizedCents:-1015,unrealizedCents:0,totalCents:-1015,closedTrades:1,wins:0,maxDrawdownCents:1015,openCostCents:0});
const open={...s,cashCents:94991,equityCents:99900,positions:[{debitCents:5009}],fills:s.fills.slice(0,1)};const stats=results.paperResults(open);assert.equal(stats.realizedCents,0);assert.equal(stats.unrealizedCents,-100);assert.equal(stats.totalCents,-100);
console.log('PASS research: closed candles, sorted continuity, stale/invalid/mismatched data, fixed endpoints, visible news outage; net closed/open P/L reconciles.');
