import assert from 'node:assert/strict';
import {build} from 'esbuild';
const mocks={
'@/lib/auth/owner':`export async function requireOwnerId(){if(globalThis.chartFixture.unauthorized)throw Error('unauthorized');return 'owner';}`,
'@/lib/bybit/client':`export async function bybitPublicRequest(env,path,query){globalThis.chartFixture.calls.push({env,path,query});if(globalThis.chartFixture.failed)throw Error('upstream');return {list:[['1770000000000','100','105','95','101','2']]};}`,
'next/server':`export const NextResponse={json:(body,options={})=>new Response(JSON.stringify(body),{...options,headers:{'Content-Type':'application/json',...options.headers}})};`
};
const route=await build({entryPoints:['app/api/markets/bybit/route.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {GET}=await import('data:text/javascript;base64,'+Buffer.from(route.outputFiles[0].text).toString('base64'));
globalThis.chartFixture={calls:[]};
const req=(q)=>new Request('https://lucian.test/api/markets/bybit?'+q);
let r=await GET(req('kind=kline&symbol=BTCUSDT&interval=60&limit=200'));assert.equal(r.status,200);assert.match(r.headers.get('Cache-Control'),/no-store/);assert.deepEqual(globalThis.chartFixture.calls[0],{env:'mainnet',path:'/v5/market/kline',query:{category:'spot',symbol:'BTCUSDT',interval:'60',limit:200}});
for(const q of ['kind=withdraw&symbol=BTCUSDT','kind=kline&symbol=https://other.test','kind=kline&symbol=BTCUSDT&limit=1001','kind=kline&symbol=BTCUSDT&interval=bad'])assert.equal((await GET(req(q))).status,400);
assert.equal(globalThis.chartFixture.calls.length,1);globalThis.chartFixture.unauthorized=true;assert.equal((await GET(req('kind=tickers&symbol=BTCUSDT'))).status,401);assert.equal(globalThis.chartFixture.calls.length,1);globalThis.chartFixture.unauthorized=false;globalThis.chartFixture.failed=true;assert.equal((await GET(req('kind=tickers&symbol=BTCUSDT'))).status,502);
const bundle=await build({entryPoints:['src/lib/markets/bybit-provider.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {BybitProvider}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
let rows=[['1770000060000','101','106','96','102','3'],['1770000000000','100','105','95','101','2']];
globalThis.fetch=async(url)=>{assert.ok(url.startsWith('/api/markets/bybit?kind=kline'));return Response.json({retCode:0,result:{list:rows}});};
let candles=await BybitProvider.getCandles('BTCUSDT','1m',200);assert.equal(candles.length,2);assert.ok(candles[0].time<candles[1].time);assert.equal(candles[0].close,101);
rows=[['1770000000000','100','bad','95','101','2']];await assert.rejects(BybitProvider.getCandles('BTCUSDT','1m',200),/malformed/);rows=[];await assert.rejects(BybitProvider.getCandles('BTCUSDT','1m',200),/no chart/);
console.log('PASS chart REST boundary: owner-only fixed public endpoints, bounded input, upstream error, sorted candles and malformed-data rejection. Fixtures only; no trades.');
