import assert from 'node:assert/strict';
import {build} from 'esbuild';
const config={configured:true,environment:'mainnet',apiKey:'fixture-key',apiSecret:'fixture-secret'};
const reset=()=>globalThis.spotFixture={row:null,coins:[{coin:'USDT',walletBalance:'40',locked:'0',spotBorrow:'0',borrowAmount:'0'}],fills:[],transactions:[],positions:[],orders:[],writes:0,checkpoint:null,archives:[],rollovers:0};
reset();
const mocks={
'server-only':'',
'@/lib/db':`const f=()=>globalThis.spotFixture;export const db={assistantMemory:{findUnique:async({where})=>where.userId_key.key==='_spot_risk:flat_anchor'?f().row:f().checkpoint,updateMany:async({where,data})=>{if(f().race||f().checkpoint?.value!==where.value)return {count:0};f().checkpoint={...f().checkpoint,...data};return {count:1};},create:async({data})=>{if(data.key==='_spot_risk:flat_anchor'){if(f().row)throw Error('unique');f().row=data;}else if(data.key==='_spot_risk:fifo_checkpoint'){if(f().checkpoint)throw Error('unique');f().checkpoint=data;}else f().archives.push(data);return data;}},tradingAuditEvent:{create:async({data})=>{if(data.action==='spot.accounting.rollover')f().rollovers++;return {};}},$transaction:async fn=>fn(db)};`,
'@/lib/bybit/client':`export const getBybitConfig=async()=>(${JSON.stringify(config)});export async function bybitRequest(id,path,options){const f=globalThis.spotFixture;if(options.method==='POST'){f.writes++;throw Error('financial write forbidden');}if(path.includes('wallet-balance'))return {list:[{accountType:'UNIFIED',coin:f.coins}]};if(path.includes('position/list'))return {list:f.positions};if(path.includes('order/realtime'))return {list:f.orders};if(path.includes('execution/list'))return {list:f.fills.filter(r=>(!Number.isFinite(Number(r.execTime))||(Number(r.execTime)>=options.query.startTime&&Number(r.execTime)<=options.query.endTime))),nextPageCursor:f.cursor??''};if(path.includes('transaction-log'))return {list:f.transactions};throw Error(path);}`,
};
const b=await build({entryPoints:['src/lib/bybit/spot-risk.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {readSpotRisk,initializeSpotRisk}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
await assert.rejects(readSpotRisk('owner',config),/baseline/);
await assert.rejects(initializeSpotRisk('owner','bybit_testnet'),/mode/);
await initializeSpotRisk('owner','bybit_live');const original=globalThis.spotFixture.row.value;
await initializeSpotRisk('owner','bybit_live');assert.equal(globalThis.spotFixture.row.value,original);
const anchor=JSON.parse(original);
anchor.startMs-=1000;globalThis.spotFixture.row.value=JSON.stringify(anchor);
const now=Date.now();globalThis.spotFixture.fills=[{execId:'a',symbol:'BTCUSDT',side:'Buy',execQty:'0.1',execPrice:'100',execFee:'0.01',feeCurrency:'USDT',execTime:String(now-200),execType:'Trade'},{execId:'b',symbol:'BTCUSDT',side:'Sell',execQty:'0.1',execPrice:'90',execFee:'0.01',feeCurrency:'USDT',execTime:String(now-100),execType:'Trade'}];globalThis.spotFixture.coins[0].walletBalance='38.98';globalThis.spotFixture.transactions=[{type:'TRADE',category:'spot'}];
const result=await readSpotRisk('owner',config);assert.ok(Math.abs(result.dailyRealized+1.02)<1e-8);
globalThis.spotFixture.coins[0].walletBalance='39';await assert.rejects(readSpotRisk('owner',config),/reconcile/);globalThis.spotFixture.coins[0].walletBalance='38.98';
globalThis.spotFixture.transactions.push({type:'TRANSFER_IN',category:'spot'});await assert.rejects(readSpotRisk('owner',config),/Non-Spot/);globalThis.spotFixture.transactions.pop();
globalThis.spotFixture.cursor='same';await assert.rejects(readSpotRisk('owner',config),/pagination/);delete globalThis.spotFixture.cursor;
await assert.rejects(readSpotRisk('owner',{...config,apiKey:'changed'}),/connection changed/);
globalThis.spotFixture.row.value=JSON.stringify({...anchor,startMs:now-29*86400000});await assert.rejects(readSpotRisk('owner',config),/28 days/);
for(const change of [{coins:[{coin:'BTC',walletBalance:'1',locked:'0',spotBorrow:'0',borrowAmount:'0'}]},{positions:[{size:'1'}]},{orders:[{orderId:'open'}]},{coins:[{coin:'USDT',walletBalance:'40',locked:'0',spotBorrow:'1',borrowAmount:'0'}]},{fills:[{execId:'during-init'}]}]){reset();Object.assign(globalThis.spotFixture,change);await assert.rejects(initializeSpotRisk('owner','bybit_live'));assert.equal(globalThis.spotFixture.row,null);assert.equal(globalThis.spotFixture.writes,0);}
// An old acquisition retains its basis after rollover, including today's loss.
reset();await initializeSpotRisk('owner','bybit_live');const f=globalThis.spotFixture,day=86400000;
f.row.value=JSON.stringify({...JSON.parse(f.row.value),startMs:now-10*day});
f.fills=[{execId:'old-buy',symbol:'BTCUSDT',side:'Buy',execQty:'0.1',execPrice:'100',execFee:'0.01',feeCurrency:'USDT',execTime:String(now-9*day),execType:'Trade'},{execId:'today-sell',symbol:'BTCUSDT',side:'Sell',execQty:'0.1',execPrice:'90',execFee:'0.01',feeCurrency:'USDT',execTime:String(now-100),execType:'Trade'}];f.coins[0].walletBalance='38.98';
f.fills.push({...f.fills[0],execId:'older-buy',execTime:String(now-8*day)},{...f.fills[1],execId:'older-sell',execTime:String(now-7*day)});f.coins[0].walletBalance='37.96';
let rolled=await readSpotRisk('owner',config);assert.ok(Math.abs(rolled.dailyRealized+1.02)<1e-8);assert.equal(f.rollovers,1);assert.equal(f.archives.length,1);assert.equal(JSON.parse(f.checkpoint.value).lots.BTC[0].quantity,0.1);
rolled=await readSpotRisk('owner',config);assert.ok(Math.abs(rolled.dailyRealized+1.02)<1e-8);assert.ok(Math.abs(rolled.realized+2.04)<1e-8);assert.equal(rolled.executions,4);assert.equal(f.rollovers,1);
// A bad wallet cannot commit or reset a checkpoint.
const retained=f.checkpoint.value;f.coins[0].walletBalance='40';await assert.rejects(readSpotRisk('owner',config),/reconcile/);assert.equal(f.checkpoint.value,retained);f.coins[0].walletBalance='37.96';
f.checkpoint.value=JSON.stringify({...JSON.parse(retained),throughMs:now});await assert.rejects(readSpotRisk('owner',config),/checkpoint is invalid/);f.checkpoint.value=retained;
// A second rolling write that loses its compare-and-swap is rejected.
f.checkpoint.value=JSON.stringify({...JSON.parse(retained),throughMs:now-4*day});f.race=true;await assert.rejects(readSpotRisk('owner',config),/changed during review/);assert.equal(f.archives.length,1);
console.log('PASS Spot accounting service: flat baseline, immutable initialization, fill/fee wallet reconciliation, retained FIFO rollover/daily losses, long-gap/changed credentials, compare-and-swap races, transfers, incomplete history and unflat/borrowed initialization rejection. No exchange writes.');
