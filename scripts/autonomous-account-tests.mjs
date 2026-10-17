import assert from 'node:assert/strict';
import {build} from 'esbuild';
process.on('uncaughtException', e => { console.error(e.name, e.message.slice(0,1000)); process.exit(1); });
const f=globalThis.accountFixture={};
function reset(){Object.assign(f,{marginMode:'REGULAR_MARGIN',leverage:'10.0',autoAddMargin:0,idx:0,longSize:'0',size:'0',available:'50',equity:'100',usd:'100',im:'0.2',mm:'0.05',riskMax:'100',maintenance:0.005,initial:0.01,reads:0,writes:0});}
const client=`export const getBybitConfig=async()=>({environment:'mainnet'});
export async function bybitPublicRequest(){const f=globalThis.accountFixture;return {list:[{symbol:'BTCUSDT',riskLimitValue:'1000',maxLeverage:f.riskMax,maintenanceMargin:f.maintenance,initialMargin:f.initial}]};}
export async function bybitRequest(u,path,o={}){const f=globalThis.accountFixture;f.reads++;if(o.method==='POST'){f.writes++;throw Error('No mutations permitted');}
if(path.endsWith('/info'))return {marginMode:f.marginMode};
if(path.endsWith('/list')){const p={symbol:'BTCUSDT',positionIdx:f.idx,size:f.size,side:f.size==='0'?'':'Sell',positionStatus:'Normal',leverage:f.leverage,autoAddMargin:f.autoAddMargin};return {list:f.idx===2?[{...p,positionIdx:1,size:f.longSize,side:f.longSize==='0'?'':'Buy'},p]:[p]};}
if(path.endsWith('wallet-balance'))return {list:[{accountType:'UNIFIED',totalAvailableBalance:f.available,accountIMRate:f.im,accountMMRate:f.mm,coin:[{coin:'USDT',walletBalance:'100',locked:'5',totalPositionIM:'10',totalOrderIM:'5',spotBorrow:'2',bonus:'3',equity:f.equity,usdValue:f.usd}]}]};throw Error('Unexpected path');}`;
const mocks={'server-only':'','./client':client};
const b=await build({entryPoints:['src/lib/bybit/autonomous-short.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
reset();const settings=await api.detectShortAccount('owner',['BTCUSDT']);assert.equal(settings.positions.BTCUSDT.leverage,'10');assert.equal(settings.marginMode,'REGULAR_MARGIN');
assert.equal(await api.shortAvailable('owner','ISOLATED_MARGIN'),75n*10n**12n);
assert.equal(await api.shortAvailable('owner','REGULAR_MARGIN'),50n*10n**12n);
f.usd='200';assert.equal(await api.shortAvailable('owner','REGULAR_MARGIN'),25n*10n**12n);
f.usd='50';assert.equal(await api.shortAvailable('owner','REGULAR_MARGIN'),75n*10n**12n);
f.available='-1';assert.equal(await api.shortAvailable('owner','REGULAR_MARGIN'),0n);
f.available='50';f.mm='1';assert.equal(await api.shortAvailable('owner','REGULAR_MARGIN'),0n);
f.mm='0.1';f.available='';await assert.rejects(()=>api.shortAvailable('owner','REGULAR_MARGIN'));
reset();f.idx=2;assert.equal((await api.detectShortAccount('owner',['BTCUSDT'])).positions.BTCUSDT.positionIdx,2);f.longSize='1';await assert.rejects(()=>api.detectShortAccount('owner',['BTCUSDT']),/unrelated hedge/);
reset();f.leverage='5';await assert.rejects(()=>api.assertShortAccount('owner','BTCUSDT',true,settings),/changed since review/);
reset();f.marginMode='ISOLATED_MARGIN';const isolated=await api.detectShortAccount('owner',['BTCUSDT']);f.autoAddMargin=1;await assert.rejects(()=>api.assertShortAccount('owner','BTCUSDT',true,isolated),/changed since review/);reset();f.autoAddMargin=undefined;await api.assertShortAccount('owner','BTCUSDT',true,settings);
const plan={product:'linear_short',symbols:['BTCUSDT'],shortSettings:settings,slippageBps:50};
const d={symbol:'BTCUSDT',quantity:'0.05',stopPrice:'105'};const q={ask:'100',bid:'99.9',mark:'100',fee:'0.001'};
reset();await api.assertShortEntryMargin('owner',plan,d,q);
await assert.rejects(()=>api.assertShortEntryMargin('owner',plan,{...d,stopPrice:'110'},q),/maintenance margin/);
f.riskMax='5';await assert.rejects(()=>api.assertShortEntryMargin('owner',plan,d,q),/risk tier/);
reset();f.available='0.01';await assert.rejects(()=>api.assertShortEntryMargin('owner',plan,d,q),/Available margin/);
reset();await assert.rejects(()=>api.assertShortEntryMargin('owner',plan,d,{...q,mark:undefined}));
assert.equal(f.writes,0);
console.log('PASS account detection, hedge ownership, settings drift, Cross USD valuation and collateral caps, missing data, margin tiers and pre-entry stop solvency; no financial or settings writes.');
