import assert from 'node:assert/strict';
import {build} from 'esbuild';
const mocks={
  'server-only':'',
  '@/lib/db':`export const db={liveTradeIntent:{findMany:async({where})=>{globalThis.fixture.candidateStates=where.state.in;return where.state.in.includes(globalThis.fixture.intent.state)?[globalThis.fixture.intent]:[];},findFirst:async({where})=>where.userId==='owner'?globalThis.fixture.intent:null},$transaction:async(fn)=>fn({liveTradeIntent:{updateMany:async({data,where})=>{globalThis.fixture.writes++;if(globalThis.fixture.race)return {count:0};globalThis.fixture.saved=data;return {count:1};}},tradingAuditEvent:{create:async()=>{globalThis.fixture.audits++;}}})};`,
  './client':`export const getBybitConfig=async()=>({configured:true,environment:globalThis.fixture.environment??'mainnet'});export const bybitRequest=async(user,path,options)=>{if(options.method==='POST')throw Error('No financial mutation permitted');globalThis.fixture.calls.push({path,query:options.query});if(globalThis.fixture.fail)throw Error('timeout');return globalThis.fixture.responses.shift();};`
};
const b=await build({entryPoints:['src/lib/bybit/reconciliation.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {reconcileTerminalOrder,reconciliationCandidates}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const setup=(status='Filled',cum='0.003',leaves='0')=>{
  const now=Date.now();const identity={symbol:'BTCUSDT',side:'Buy',orderLinkId:'stable',orderId:'exchange-one'};
  const order={...identity,orderStatus:status,cumExecQty:cum,leavesQty:leaves,updatedTime:String(now)};
  const fill=(id,qty)=>({...identity,execId:id,execType:'Trade',execQty:qty,execPrice:'80000',execFee:'0.02',feeCurrency:'USDT',execTime:String(now)});
  globalThis.fixture={intent:{id:'one',userId:'owner',initiatedBy:'user',state:'reconciliation_required',tradingMode:'bybit_live',category:'spot',productId:'BTCUSDT',side:'BUY',clientOrderId:'stable',providerOrderId:null,createdAt:new Date(now-3600000),updatedAt:new Date(now-600000),execution:{error:'ambiguous timeout'}},responses:[{category:'spot',list:[order]},{category:'spot',list:[fill('a','0.001')],nextPageCursor:'page-two'},{category:'spot',list:[fill('a','0.001'),fill('b','0.002')],nextPageCursor:''}],calls:[],writes:0,audits:0};return globalThis.fixture;
};
let f=setup();const result=await reconcileTerminalOrder('owner','one');assert.equal(result.state,'filled');assert.equal(result.report.fills.length,2);assert.equal(result.report.protectionVerified,false);assert.equal(f.saved.execution.error,'ambiguous timeout');assert.equal(f.calls[0].query.orderLinkId,'stable');assert.equal(f.calls[2].query.cursor,'page-two');assert.equal(f.audits,1);
f=setup();f.responses[0].nextPageCursor='orders-two';f.responses.splice(1,0,{category:'spot',list:[],nextPageCursor:''});assert.equal((await reconcileTerminalOrder('owner','one')).state,'filled');assert.equal(f.calls[1].query.cursor,'orders-two');
f=setup('PartiallyFilled','0.003','0.004');assert.equal((await reconcileTerminalOrder('owner','one')).state,'partially_filled');
f=setup('PartiallyFilledCanceled','0.003','0.004');const cancelled=await reconcileTerminalOrder('owner','one');assert.equal(cancelled.state,'cancelled_with_fills');assert.equal(cancelled.resolved,false);assert.match(cancelled.message,/exposure and protection review/);
f=setup('PartiallyFilledCanceled','0.003','0.004');f.intent.state='cancelled_with_fills';assert.equal((await reconciliationCandidates('owner')).intents.length,1);assert.ok(f.candidateStates.includes('cancelled_with_fills'));assert.equal((await reconcileTerminalOrder('owner','one')).resolved,false);
f=setup('Rejected','0','0');f.responses[1]={category:'spot',list:[]};assert.equal((await reconcileTerminalOrder('owner','one')).state,'rejected');
f=setup();f.responses=[{category:'spot',list:[]},{category:'spot',list:[]}];assert.equal((await reconcileTerminalOrder('owner','one')).resolved,false);assert.equal(f.writes,0);
f=setup();f.responses=[{category:'spot',list:[]},f.responses[0],...f.responses.slice(1)];assert.equal((await reconcileTerminalOrder('owner','one')).report.source,'history');
for(const change of [f=>{f.fail=true;},f=>{f.responses[0].nextPageCursor='more-orders';},f=>{f.intent.execution.reconciliation={updatedTime:String(Date.now()+1000)};},f=>{f.responses[0].list[0].orderLinkId='foreign';},f=>{f.responses[0].category='linear';},f=>{f.responses[2].list[0].execQty='0.004';},f=>{f.responses[0].list[0].cumExecQty='0.01';},f=>{f.responses[2].nextPageCursor='page-two';},f=>{f.environment='testnet';},f=>{f.intent.createdAt=new Date(Date.now()-8*86400000);},f=>{f.intent.state='executing';f.intent.updatedAt=new Date();}]){
  f=setup();change(f);await assert.rejects(reconcileTerminalOrder('owner','one'));assert.equal(f.writes,0);
}
f=setup();f.race=true;await assert.rejects(reconcileTerminalOrder('owner','one'),/changed/);assert.equal(f.audits,0);
f=setup();await assert.rejects(reconcileTerminalOrder('other-owner','one'));assert.equal(f.calls.length,0);
console.log('PASS exchange reconciliation: owner/environment identity, history fallback, paginated fill deduplication, partial/cancelled fills, retained unknowns, malformed/delayed data and write races. No exchange mutation/network calls.');
