import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const database=new URL(process.env.DATABASE_URL??'http://invalid');
assert(['localhost','127.0.0.1'].includes(database.hostname)&&database.pathname==='/lucian_restoration_dev_20261007','Named local database required; production forbidden.');
const {PrismaClient}=createRequire(import.meta.url)('@prisma/client');
const db=new PrismaClient();
globalThis.fillDb={$transaction:fn=>db.$transaction(async tx=>fn(globalThis.failNotification?new Proxy(tx,{get(target,key){if(key==='userNotification')return {upsert:async()=>{throw Error('notification unavailable');}};return target[key];}}):tx)),liveTradeIntent:db.liveTradeIntent};
globalThis.fillRead=async(_user,path,{query})=>{
 assert(!path.includes('create')&&!path.includes('cancel'));
 const row=globalThis.fillOrder;
 assert.equal(query.orderLinkId,row.orderLinkId);
 return {category:'spot',list:path==='/v5/execution/list'?[{symbol:row.symbol,side:row.side,orderLinkId:row.orderLinkId,orderId:row.orderId,execId:'one-fill',execType:'Trade',execQty:row.cumExecQty,execPrice:'81750',execFee:'0.00000007',feeCurrency:'BTC',execTime:row.updatedTime}]:[row],nextPageCursor:''};
};
const mocks={'server-only':'','@/lib/db':'export const db=globalThis.fillDb;','./client':`export const getBybitConfig=async()=>({configured:true,environment:'mainnet'});export const bybitRequest=(...args)=>globalThis.fillRead(...args);`};
const r=await build({entryPoints:['src/lib/bybit/reconciliation.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'isolated',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const {reconcileTerminalOrder}=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
const owner=randomUUID();
async function create(){
 const intent=await db.liveTradeIntent.create({data:{userId:owner,clientOrderId:randomUUID(),productId:'BTCUSDT',side:'BUY',category:'spot',tradingMode:'bybit_live',orderType:'Limit',baseSize:'0.00007',state:'submitted'}});
 globalThis.fillOrder={symbol:'BTCUSDT',side:'Buy',orderLinkId:intent.clientOrderId,orderId:randomUUID(),qty:'0.00007',cumExecQty:'0.00007',leavesQty:'0',orderStatus:'Filled',updatedTime:String(Date.now())};return intent;
}
try{
 await db.user.create({data:{id:owner,username:'fill-'+owner,email:owner+'@example.test'}});
 let intent=await create();
 const results=await Promise.allSettled(Array.from({length:6},()=>reconcileTerminalOrder(owner,intent.id)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await db.liveTradeIntent.findUnique({where:{id:intent.id}})).state,'filled');
 assert.equal(await db.userNotification.count({where:{userId:owner}}),1);
 assert.equal(await db.tradingAuditEvent.count({where:{userId:owner,intentId:intent.id}}),1);
 const n=await db.userNotification.findFirst({where:{userId:owner}});
 await db.userNotification.update({where:{id:n.id},data:{dismissedAt:new Date(),readAt:new Date()}});
 // A replayed recovered intent reuses the alert identity and preserves dismissal.
 await db.liveTradeIntent.update({where:{id:intent.id},data:{state:'submitted'}});
 await reconcileTerminalOrder(owner,intent.id);
 assert.equal(await db.userNotification.count({where:{userId:owner}}),1);
 assert.ok((await db.userNotification.findUnique({where:{id:n.id}})).dismissedAt);
 intent=await create();globalThis.failNotification=true;
 await assert.rejects(reconcileTerminalOrder(owner,intent.id),/notification unavailable/);
 assert.equal((await db.liveTradeIntent.findUnique({where:{id:intent.id}})).state,'submitted');
 assert.equal(await db.tradingAuditEvent.count({where:{userId:owner,intentId:intent.id}}),0);
 globalThis.failNotification=false;await reconcileTerminalOrder(owner,intent.id);
 assert.equal(await db.userNotification.count({where:{userId:owner}}),2);
 await assert.rejects(reconcileTerminalOrder('other',intent.id));
 console.log('PASS local PostgreSQL fill handoff: six competing checks yield one fill/audit/notification; replay preserves dismissal; notification failure rolls back intent and audit; retry succeeds. Exchange fixtures only; no network or financial writes.');
}finally{await db.user.deleteMany({where:{id:owner}});await db.$disconnect();delete globalThis.fillDb;delete globalThis.fillRead;delete globalThis.fillOrder;delete globalThis.failNotification;}
