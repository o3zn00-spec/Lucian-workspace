import assert from 'node:assert/strict';import {build} from 'esbuild';
globalThis.fixture={state:'previewed',calls:0,fail:false};
const mocks={
'server-only':'',
'@/lib/auth/password':'export const verifyPassword=async()=>true;',
'@/lib/bybit/trading':'export const getTradingProfile=async()=>({emergencyStop:false});',
'@/lib/bybit/client':`export const getBybitConfig=async()=>({configured:true,environment:'testnet'});export const bybitPublicRequest=async()=>({});export async function bybitRequest(){globalThis.fixture.calls++;if(globalThis.fixture.fail)throw Error('ambiguous timeout');return {orderId:'order-one'};}`,
'@/lib/db':`export const db={tradingAuditEvent:{create:async()=>({})},liveTradeIntent:{findFirst:async()=>({id:'intent',userId:'owner',state:globalThis.fixture.state,expiresAt:new Date(Date.now()+60000),initiatedBy:'user',tradingMode:'bybit_testnet',category:'spot',productId:'BTCUSDT',side:'BUY',orderType:'Market',baseSize:0.001,clientOrderId:'stable-link-id',preview:{}}),updateMany:async()=>{if(globalThis.fixture.state!=='previewed')return {count:0};globalThis.fixture.state='executing';return {count:1};},update:async({data})=>{globalThis.fixture.state=data.state;globalThis.fixture.execution=data.execution;}}};`
};
const b=await build({entryPoints:['src/lib/bybit/terminal.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {executeTerminalOrder}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const input={intentId:'intent',confirmation:'CONFIRM BYBIT TESTNET ORDER'};
await assert.rejects(executeTerminalOrder('owner',{...input,confirmation:'yes'}));assert.equal(globalThis.fixture.calls,0);
const answers=await Promise.allSettled([executeTerminalOrder('owner',input),executeTerminalOrder('owner',input)]);assert.equal(answers.filter(r=>r.status==='fulfilled').length,1);assert.equal(globalThis.fixture.calls,1);assert.equal(globalThis.fixture.state,'submitted');
globalThis.fixture={state:'previewed',calls:0,fail:true};await assert.rejects(executeTerminalOrder('owner',input));assert.equal(globalThis.fixture.state,'reconciliation_required');assert.equal(globalThis.fixture.execution.orderLinkId,'stable-link-id');await assert.rejects(executeTerminalOrder('owner',input));assert.equal(globalThis.fixture.calls,1);
console.log('PASS mocked exchange execution: exact confirmation, concurrent single reservation, ambiguous submission retained for reconciliation, no resubmission. No exchange network calls.');
