import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const database=new URL(process.env.DATABASE_URL??'http://invalid');
assert(['localhost','127.0.0.1'].includes(database.hostname)&&database.pathname==='/lucian_restoration_dev_20261007','Named local database required; production forbidden.');
const {PrismaClient}=createRequire(import.meta.url)('@prisma/client');const db=new PrismaClient();globalThis.watchDb=db;globalThis.watchReads=0;
const mocks={'server-only':'','@/lib/db':'export const db=globalThis.watchDb;','@/lib/auth/owner-identity':'export const isConfiguredOwnerEmail=()=>true;','./order-observer':'export async function observeOrder(){globalThis.watchReads++;return {done:false};}'};
const r=await build({entryPoints:['src/lib/bybit/order-watch.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'isolated',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});
const watch=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));const owner=randomUUID();
try {
 await db.user.create({data:{id:owner,username:'watch-'+owner,email:owner+'@example.test'}});
 const intent=await db.liveTradeIntent.create({data:{userId:owner,clientOrderId:randomUUID(),productId:'BTCUSDT',side:'BUY',state:'exchange_open',baseSize:'0.00007'}});
 const claims=await Promise.all(Array.from({length:8},()=>watch.claimOrderWatch(owner,intent.id)));assert.equal(claims.filter(c=>c.claimed).length,1);
 const claim=claims.find(c=>c.claimed);await watch.recordOrderWatch(owner,intent.id,claim.state.generation,'first');
 await watch.tickOrderWatch(owner,intent.id,claim.state.generation);assert.equal(globalThis.watchReads,1);
 const summaries=await watch.orderWatchSummaries(owner,[intent.id]);assert.equal(summaries[intent.id].status,'watching');assert.ok(!JSON.stringify(summaries).includes(claim.state.generation));assert.deepEqual(await watch.orderWatchSummaries('other',[intent.id]),{});
 const where={userId_key:{userId:owner,key:'_order_watch:'+intent.id}};const row=await db.assistantMemory.findUnique({where});const state=JSON.parse(row.value);state.heartbeatMs=Date.now()-181000;await db.assistantMemory.update({where,data:{value:JSON.stringify(state)}});
 const replacement=await watch.claimOrderWatch(owner,intent.id);assert.equal(replacement.claimed,true);assert.notEqual(replacement.state.generation,claim.state.generation);
 await watch.recordOrderWatch(owner,intent.id,claim.state.generation,null);await watch.tickOrderWatch(owner,intent.id,claim.state.generation);assert.equal(globalThis.watchReads,1);
 assert.equal(JSON.parse((await db.assistantMemory.findUnique({where})).value).generation,replacement.state.generation);
 await db.user.update({where:{id:owner},data:{status:'disabled'}});await watch.tickOrderWatch(owner,intent.id,replacement.state.generation);assert.equal(globalThis.watchReads,1);
 assert.equal((await db.liveTradeIntent.findUnique({where:{id:intent.id}})).state,'exchange_open');
 console.log('PASS actual isolated PostgreSQL: eight concurrent watch requests create one generation; stale worker cannot overwrite replacement; disabled owner stops reads; original order unchanged. No exchange calls.');
}finally{await db.user.deleteMany({where:{id:owner}});await db.$disconnect();delete globalThis.watchDb;delete globalThis.watchReads;}
