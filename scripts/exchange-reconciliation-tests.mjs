import assert from 'node:assert/strict';
import {build} from 'esbuild';
const mocks={
  'server-only':'',
  '@/lib/db':`export const db={liveTradeIntent:{findMany:async({where})=>{globalThis.fixture.candidateQueries??=[];globalThis.fixture.candidateQueries.push(where);if(where.state.in.includes("cancelled_with_fills"))globalThis.fixture.candidateStates=where.state.in;return where.state.in.includes(globalThis.fixture.intent.state)?[globalThis.fixture.intent]:[];},findFirst:async({where})=>where.userId==='owner'?globalThis.fixture.intent:null},$transaction:async(fn)=>fn({liveTradeIntent:{updateMany:async({data,where})=>{globalThis.fixture.writes++;if(globalThis.fixture.race)return {count:0};globalThis.fixture.saved=data;return {count:1};}},userNotification:{upsert:async(input)=>{if(globalThis.fixture.notificationFailure)throw Error("notification unavailable");globalThis.fixture.notifications.push(input);}},tradingAuditEvent:{create:async()=>{globalThis.fixture.audits++;}}})};`,
  './client':`export const getBybitConfig=async()=>({configured:true,environment:globalThis.fixture.environment??'mainnet'});export const bybitRequest=async(user,path,options)=>{if(options.method==='POST')throw Error('No financial mutation permitted');globalThis.fixture.calls.push({path,query:options.query});if(globalThis.fixture.fail)throw Error('timeout');return globalThis.fixture.responses.shift();};`
};
const b=await build({entryPoints:['src/lib/bybit/reconciliation.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {reconcileTerminalOrder,reconciliationCandidates}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const setup=(status='Filled',cum='0.003',leaves='0')=>{
  const now=Date.now();const identity={symbol:'BTCUSDT',side:'Buy',orderLinkId:'stable',orderId:'exchange-one'};
  const order={...identity,orderStatus:status,qty:String(Number(cum)+Number(leaves)||0.003),cumExecQty:cum,leavesQty:leaves,updatedTime:String(now)};
  const fill=(id,qty)=>({...identity,execId:id,execType:'Trade',execQty:qty,execPrice:'80000',execFee:'0.02',feeCurrency:'USDT',execTime:String(now)});
  globalThis.fixture={intent:{id:'one',userId:'owner',initiatedBy:'user',state:'reconciliation_required',tradingMode:'bybit_live',category:'spot',productId:'BTCUSDT',side:'BUY',baseSize:String(Number(cum)+Number(leaves)||0.003),clientOrderId:'stable',providerOrderId:null,createdAt:new Date(now-3600000),updatedAt:new Date(now-600000),execution:{error:'ambiguous timeout'}},responses:[{category:'spot',list:[order]},{category:'spot',list:[fill('a','0.001')],nextPageCursor:'page-two'},{category:'spot',list:[fill('a','0.001'),fill('b','0.002')],nextPageCursor:''}],calls:[],writes:0,audits:0,notifications:[]};return globalThis.fixture;
};
let f=setup();const result=await reconcileTerminalOrder('owner','one');assert.equal(result.state,'filled');assert.equal(result.report.fills.length,2);assert.equal(result.report.protectionVerified,false);assert.equal(f.saved.execution.error,'ambiguous timeout');assert.equal(f.calls[0].query.orderLinkId,'stable');assert.equal(f.calls[2].query.cursor,'page-two');assert.equal(f.audits,1);assert.equal(f.notifications.length,1);assert.equal(f.notifications[0].create.userId,'owner');assert.equal(f.notifications[0].create.deepLink,'/markets');assert.equal(f.notifications[0].create.actionable,true);assert.deepEqual(f.notifications[0].update,{});assert.match(f.notifications[0].create.message,/does not verify protective orders/);assert.ok(!JSON.stringify(f.notifications).includes('ambiguous timeout'));
f=setup();f.responses[0].nextPageCursor='orders-two';f.responses.splice(1,0,{category:'spot',list:[],nextPageCursor:''});assert.equal((await reconcileTerminalOrder('owner','one')).state,'filled');assert.equal(f.calls[1].query.cursor,'orders-two');
f=setup('PartiallyFilled','0.003','0.004');assert.equal((await reconcileTerminalOrder('owner','one')).state,'partially_filled');
f=setup('PartiallyFilledCanceled','0.003','0.004');const cancelled=await reconcileTerminalOrder('owner','one');assert.equal(cancelled.state,'cancelled_with_fills');assert.equal(cancelled.resolved,false);assert.match(cancelled.message,/exposure and protection review/);
f=setup('PartiallyFilledCanceled','0.003','0.004');f.intent.state='cancelled_with_fills';assert.equal((await reconciliationCandidates('owner')).intents.length,1);assert.ok(f.candidateStates.includes('cancelled_with_fills'));assert.equal((await reconcileTerminalOrder('owner','one')).resolved,false);assert.equal(f.notifications.length,0);
f=setup();f.intent.state='filled';f.intent.execution={error:'private provider error',token:'secret',reconciliation:result.report};
const history=await reconciliationCandidates('owner');assert.equal(history.intents.length,0);assert.equal(history.completed.length,1);assert.equal(history.completed[0].report.status,'Filled');assert.equal(history.completed[0].report.fills.length,2);assert.equal(history.completed[0].report.protectionVerified,false);assert.ok(!JSON.stringify(history).includes('private provider error'));assert.ok(!JSON.stringify(history).includes('secret'));assert.ok(f.candidateQueries.every(q=>q.userId==='owner'&&JSON.stringify(q.initiatedBy)===JSON.stringify({in:['user','owner_session']})));assert.ok(f.candidateQueries[1].updatedAt.gte instanceof Date);
f=setup();f.intent.state='cancelled';f.intent.execution={error:'private',reconciliation:null};assert.equal((await reconciliationCandidates('owner')).completed.length,0);
f=setup();f.intent.initiatedBy='owner_session';f.intent.state='session_settled';f.intent.execution={reconciliation:{...result.report,status:'PartiallyFilledCanceled'},sessionSettlement:{sessionId:'closed-session'},token:'private'};const settledHistory=await reconciliationCandidates('owner');assert.equal(settledHistory.intents.length,0);assert.equal(settledHistory.completed.length,1);assert.equal(settledHistory.completed[0].report.status,'PartiallyFilledCanceled');assert.equal(settledHistory.completed[0].report.fills.length,2);assert.ok(!JSON.stringify(settledHistory).includes('private'));await assert.rejects(reconcileTerminalOrder('owner','one'),/No eligible owner order reservation/);assert.equal(f.calls.length,0);
f=setup('Rejected','0','0');f.responses[1]={category:'spot',list:[]};assert.equal((await reconcileTerminalOrder('owner','one')).state,'rejected');assert.equal(f.notifications.length,0);
f=setup();f.responses=[{category:'spot',list:[]},{category:'spot',list:[]}];assert.equal((await reconcileTerminalOrder('owner','one')).resolved,false);assert.equal(f.writes,0);
f=setup();f.responses=[{category:'spot',list:[]},f.responses[0],...f.responses.slice(1)];assert.equal((await reconcileTerminalOrder('owner','one')).report.source,'history');
for(const change of [f=>{f.responses[0].list[0].qty='0.02';},f=>{f.responses[0].list[0].leavesQty='0.001';},f=>{f.intent.baseSize=null;},f=>{f.fail=true;},f=>{f.responses[0].nextPageCursor='more-orders';},f=>{f.intent.execution.reconciliation={updatedTime:String(Date.now()+1000)};},f=>{f.intent.execution.reconciliation={updatedTime:String(Date.now()-1000),cumExecQty:'0.004'};},f=>{f.responses[0].list[0].orderLinkId='foreign';},f=>{f.responses[0].category='linear';},f=>{f.responses[2].list[0].execQty='0.004';},f=>{f.responses[0].list[0].cumExecQty='0.01';},f=>{f.responses[2].nextPageCursor='page-two';},f=>{f.environment='testnet';},f=>{f.intent.createdAt=new Date(Date.now()-731*86400000);},f=>{f.intent.state='executing';f.intent.updatedAt=new Date();}]){
  f=setup();change(f);await assert.rejects(reconcileTerminalOrder('owner','one'));assert.equal(f.writes,0);
}
f=setup();f.race=true;await assert.rejects(reconcileTerminalOrder('owner','one'),/changed/);assert.equal(f.audits,0);
f=setup();await assert.rejects(reconcileTerminalOrder('other-owner','one'));assert.equal(f.calls.length,0);
f=setup();f.notificationFailure=true;await assert.rejects(reconcileTerminalOrder('owner','one'),/notification unavailable/);
console.log('PASS exchange reconciliation: owner/environment identity, history fallback, paginated fill deduplication, partial/cancelled fills, retained unknowns, malformed/delayed data and write races. No exchange mutation/network calls.');

// Nine-day reservations: query old windows instead of rejecting by age.
f=setup();f.intent.createdAt=new Date(Date.now()-9*86400000);f.intent.providerOrderId='exchange-one';
const oldOrder={...f.responses[0].list[0],updatedTime:String(f.intent.createdAt.getTime()+3600000)};
const oldFills=f.responses.slice(1).map(p=>({...p,list:p.list.map(row=>({...row,execTime:oldOrder.updatedTime}))}));
f.responses=[{category:'spot',list:[]},{category:'spot',list:[]},{category:'spot',list:[oldOrder]},{category:'spot',list:[]},...oldFills];
assert.equal((await reconcileTerminalOrder('owner','one')).state,'filled');
assert.equal(f.calls.length,6);assert.ok(f.calls.every(c=>c.query.orderId==='exchange-one'));
for(const c of f.calls.slice(1)) assert.ok(c.query.endTime-c.query.startTime<7*86400000);
assert.equal(f.calls[2].query.endTime+1,f.calls[1].query.startTime);
assert.equal(f.calls[4].query.endTime+1,f.calls[3].query.startTime);
// An empty old history is not cancellation evidence.
f=setup();f.intent.createdAt=new Date(Date.now()-9*86400000);f.responses=Array.from({length:3},()=>({category:'spot',list:[]}));
const missingOld=await reconcileTerminalOrder('owner','one');assert.equal(missingOld.resolved,false);assert.match(missingOld.message,/Absence is not proof/);assert.equal(f.writes,0);
// An old live order can receive fills in multiple windows; collect all of them.
f=setup();f.intent.createdAt=new Date(Date.now()-9*86400000);
f.responses=[f.responses[0],{category:'spot',list:[f.responses[1].list[0]]},{category:'spot',list:[{...f.responses[2].list[1],execTime:String(f.intent.createdAt.getTime()+1000)}]}];
assert.equal((await reconcileTerminalOrder('owner','one')).report.fills.length,2);
// A later history-page failure must leave the reservation untouched.
f=setup();f.intent.createdAt=new Date(Date.now()-9*86400000);f.responses=[{category:'spot',list:[]},{category:'spot',list:[]}];
await assert.rejects(reconcileTerminalOrder('owner','one'));assert.equal(f.writes,0);
// A fill cannot claim a timestamp before the reservation lifetime.
f=setup();f.responses[1].list[0].execTime=String(f.intent.createdAt.getTime()-120000);
await assert.rejects(reconcileTerminalOrder('owner','one'),/timestamp/);assert.equal(f.writes,0);
console.log('PASS historical reconciliation: gap-free seven-day requests, old filled orders, multi-window fills, exact identity, retained missing/failed history.');

f=setup('Cancelled','0','0');f.intent.createdAt=new Date(Date.now()-9*86400000);f.responses=[f.responses[0],{category:'spot',list:[]},{category:'spot',list:[]}];
assert.equal((await reconcileTerminalOrder('owner','one')).state,'cancelled');assert.equal(f.saved.execution.reconciliation.fills.length,0);
console.log('PASS old confirmed cancellation releases only on matched exchange evidence.');

// Exact-ID queries can repeat historical fills outside the requested date window.
f=setup();f.intent.createdAt=new Date(Date.now()-9*86400000);
const repeatedOldFill={...f.responses[1].list[0],execQty:'0.003',execTime:String(f.intent.createdAt.getTime()+1000)};
f.responses=[f.responses[0],{category:'spot',list:[repeatedOldFill]},{category:'spot',list:[repeatedOldFill]}];
assert.equal((await reconcileTerminalOrder('owner','one')).report.fills.length,1);
console.log('PASS exact-ID fill responses use lifetime bounds and cross-window deduplication.');
