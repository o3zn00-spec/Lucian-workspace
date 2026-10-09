import assert from 'node:assert/strict';
import { build } from 'esbuild';
const memory=new Map();let queue=Promise.resolve(),reads=0;
const fixture={active:true,done:false,fail:false,createdAt:new Date(),state:'exchange_open'};
globalThis.watchFixture={fixture,memory,observe:async()=>{reads++;return {done:fixture.done};},transaction:async(fn)=>{const before=queue;let release;queue=new Promise(r=>{release=r;});await before;try{return await fn(globalThis.watchFixture.db);}finally{release();}}};
const db={
 $transaction:globalThis.watchFixture.transaction,$queryRaw:async()=>[],
 assistantMemory:{findUnique:async({where})=>memory.get(JSON.stringify(where))??null,upsert:async({where,create,update})=>{const key=JSON.stringify(where);const row=memory.has(key)?{...memory.get(key),...update}:create;memory.set(key,row);return row;}},
 liveTradeIntent:{findFirst:async({where})=>where.userId==='owner'&&where.initiatedBy==='user'&&where.state.in.includes(fixture.state)?{createdAt:fixture.createdAt}:null},
 user:{findUnique:async({where})=>where.id==='owner'?{email:'owner@example.com',status:fixture.active?'active':'disabled'}:null}
};globalThis.watchFixture.db=db;
async function bundle(entry,mocks){const r=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]}));}}]});return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));}
const watch=await bundle('src/lib/bybit/order-watch.ts',{'server-only':'','@/lib/db':'export const db=globalThis.watchFixture.db;','@/lib/auth/owner-identity':`export const isConfiguredOwnerEmail=e=>e==='owner@example.com';`,'./order-observer':'export const observeOrder=globalThis.watchFixture.observe;'});
await assert.rejects(watch.claimOrderWatch('other','intent'),/owner order/);
const claims=await Promise.all(Array.from({length:8},()=>watch.claimOrderWatch('owner','intent')));
assert.equal(claims.filter(c=>c.claimed).length,1);let c=claims[0];
await watch.recordOrderWatch('owner','intent',c.state.generation,'run');
assert.deepEqual(await watch.tickOrderWatch('owner','intent','stale'),{done:true});assert.equal(reads,0);
assert.deepEqual(await watch.tickOrderWatch('owner','intent',c.state.generation),{done:false});assert.equal(reads,1);
await watch.recordOrderWatch('owner','intent','stale',null);
assert.equal((await watch.claimOrderWatch('owner','intent')).claimed,false);
fixture.active=false;assert.deepEqual(await watch.tickOrderWatch('owner','intent',c.state.generation),{done:true});assert.equal(reads,1);
fixture.active=true;c=await watch.claimOrderWatch('owner','intent');assert.equal(c.claimed,true);
await watch.recordOrderWatch('owner','intent',c.state.generation,null);
assert.deepEqual(await watch.tickOrderWatch('owner','intent',c.state.generation),{done:true});assert.equal(reads,1);
c=await watch.claimOrderWatch('owner','intent');assert.equal(c.claimed,true);
for(const [k,row] of memory){const s=JSON.parse(row.value);s.expiresAtMs=Date.now()-1;memory.set(k,{...row,value:JSON.stringify(s)});}
assert.deepEqual(await watch.tickOrderWatch('owner','intent',c.state.generation),{done:true});assert.equal(reads,1);
c=await watch.claimOrderWatch('owner','intent');fixture.done=true;await watch.tickOrderWatch('owner','intent',c.state.generation);assert.equal(reads,2);
fixture.createdAt=new Date(Date.now()-7*86400000);await assert.rejects(watch.claimOrderWatch('owner','old'),/recent/);
fixture.createdAt=new Date(Date.now()+86400000);await assert.rejects(watch.claimOrderWatch('owner','future'),/recent/);
const flow={ticks:0,sleeps:0,starts:0,records:0,doneAt:1};globalThis.watchFlow=flow;
const workflow=await bundle('src/workflows/order-watch.ts',{'workflow':'export async function sleep(){globalThis.watchFlow.sleeps++;}','workflow/api':`export async function start(){globalThis.watchFlow.starts++;return {runId:'child'};}`,'@/lib/bybit/order-watch':`export async function tickOrderWatch(){const f=globalThis.watchFlow;return {done:++f.ticks>=f.doneAt};}export async function recordOrderWatch(){globalThis.watchFlow.records++;}`});
await workflow.orderWatchWorkflow('owner','intent','generation');assert.equal(flow.starts,0);assert.equal(flow.sleeps,0);
Object.assign(flow,{ticks:0,doneAt:100});await workflow.orderWatchWorkflow('owner','intent','generation');assert.equal(flow.ticks,61);assert.equal(flow.sleeps,60);assert.equal(flow.starts,1);assert.equal(flow.records,1);
console.log('PASS owner isolation, duplicate claim exclusion, stale generations, disabled owner, dispatch failure recovery, hard deadline, invalid order dates, terminal stop and bounded workflow continuation. Fixtures; no exchange mutations.');
