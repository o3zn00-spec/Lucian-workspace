import assert from 'node:assert/strict';
import {build} from 'esbuild';
const config={configured:true,environment:'mainnet',apiKey:'fixture-key',apiSecret:'fixture-secret'};
const reset=()=>globalThis.spotFixture={row:null,coins:[{coin:'USDT',walletBalance:'40',locked:'0',spotBorrow:'0',borrowAmount:'0'}],fills:[],transactions:[],positions:[],orders:[],writes:0};
reset();
const mocks={
'server-only':'',
'@/lib/db':`export const db={assistantMemory:{findUnique:async()=>globalThis.spotFixture.row,create:async({data})=>{if(globalThis.spotFixture.row)throw Error('unique');globalThis.spotFixture.row=data;return data;}},tradingAuditEvent:{create:async()=>({})}};`,
'@/lib/bybit/client':`export const getBybitConfig=async()=>(${JSON.stringify(config)});export async function bybitRequest(id,path,options){const f=globalThis.spotFixture;if(options.method==='POST'){f.writes++;throw Error('financial write forbidden');}if(path.includes('wallet-balance'))return {list:[{accountType:'UNIFIED',coin:f.coins}]};if(path.includes('position/list'))return {list:f.positions};if(path.includes('order/realtime'))return {list:f.orders};if(path.includes('execution/list'))return {list:f.fills,nextPageCursor:f.cursor??''};if(path.includes('transaction-log'))return {list:f.transactions};throw Error(path);}`,
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
globalThis.spotFixture.row.value=JSON.stringify({...anchor,startMs:now-7*86400000});await assert.rejects(readSpotRisk('owner',config),/expired/);
for(const change of [{coins:[{coin:'BTC',walletBalance:'1',locked:'0',spotBorrow:'0',borrowAmount:'0'}]},{positions:[{size:'1'}]},{orders:[{orderId:'open'}]},{coins:[{coin:'USDT',walletBalance:'40',locked:'0',spotBorrow:'1',borrowAmount:'0'}]},{fills:[{execId:'during-init'}]}]){reset();Object.assign(globalThis.spotFixture,change);await assert.rejects(initializeSpotRisk('owner','bybit_live'));assert.equal(globalThis.spotFixture.row,null);assert.equal(globalThis.spotFixture.writes,0);}
console.log('PASS Spot accounting service: flat baseline, immutable initialization, fill/fee wallet reconciliation, expired/changed credentials, transfers, incomplete history and unflat/borrowed initialization rejection. No exchange writes.');
