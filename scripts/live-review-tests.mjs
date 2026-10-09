import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
async function bundle(entry,mocks={}) {const r=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));}}]});return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));}
const f={rows:new Map(),queue:Promise.resolve(),calls:0,active:true,mainnet:true,pending:false,partial:false,fail:false,emergency:false,during:null,reply:'{"stance":"owner_review","rationale":"Mixed trends need owner review; no validated profitable strategy."}'};globalThis.liveResearchFixture=f;
const memory={findUnique:async({where})=>f.rows.get(where.userId_key.userId+':'+where.userId_key.key)??null,upsert:async({where,create,update})=>{const k=where.userId_key.userId+':'+where.userId_key.key;f.rows.set(k,f.rows.has(k)?{...f.rows.get(k),...update}:create);},create:async({data})=>{const k=data.userId+':'+data.key;if(f.rows.has(k))throw Error('duplicate');f.rows.set(k,data);}};
const db={$queryRaw:async()=>[],assistantMemory:memory,assistantActivity:{create:async()=>{}},user:{findUnique:async({where})=>where.id==='owner'?{email:'owner@test.invalid',status:f.active?'active':'disabled'}:null},$transaction:async fn=>{const prior=f.queue;let release;f.queue=new Promise(r=>release=r);await prior;const before=structuredClone(f.rows);try{return await fn(db);}catch(e){f.rows=before;throw e;}finally{release();}}};f.db=db;
const mocks={
 'server-only':'','@/lib/db':'export const db=globalThis.liveResearchFixture.db;',
 '@/lib/auth/owner-identity':`export const isConfiguredOwnerEmail=e=>e==='owner@test.invalid';`,
 '@/lib/bybit/client':`export const getBybitConfig=async()=>({configured:true,environment:globalThis.liveResearchFixture.mainnet?'mainnet':'testnet'});`,
 '@/lib/bybit/trading':`export const getTradingProfile=async()=>({emergencyStop:globalThis.liveResearchFixture.emergency,maxOrderUsd:6,maxPositionUsd:10,maxDailyLossUsd:1,maxOpenPositions:1});`,
 '@/lib/bybit/reconciliation':`export async function reconciliationCandidates(){const f=globalThis.liveResearchFixture;if(f.fail)throw Error('secret provider payload');return {hasMore:f.partial,intents:f.pending?[{id:'entry',productId:'BTCUSDT',state:'exchange_open'}]:[],completed:[]};}export async function reconcileTerminalOrder(){const f=globalThis.liveResearchFixture;if(f.fail)throw Error('secret provider payload');return {resolved:false};}`,
 './paper-research':`export const collectPaperResearch=async()=>({observedAtMs:Date.now(),markets:[{source:'https://api.bybit.com/v5/market/kline'}],context:[],warnings:[],announcements:[]});`,
 '@/lib/agent/providers':`export async function getProvider(){return {chat:async()=>{const f=globalThis.liveResearchFixture;f.calls++;if(f.during)await f.during();return {fromModel:true,content:f.reply};}};}`
};
const rt=await bundle('src/lib/assistant/live-review-runtime.ts',mocks),policy=await bundle('src/lib/assistant/live-review-policy.ts');
const plan={symbols:['BTCUSDT'],strategy:'Review trends and fees; hold with uncertainty.',reviewMinutes:5,durationHours:1,maxReviews:2};
for(const bad of [{...plan,symbols:['BTCUSDT','BTCUSDT']},{...plan,maxReviews:31},{...plan,durationHours:25},{...plan,reviewMinutes:0},{...plan,mode:'live'}])assert.throws(()=>policy.validateLiveReviewPlan(bad));
for(const raw of ['{"stance":"buy","rationale":"go"}','{"stance":"hold","rationale":"ok","execute":true}'])assert.throws(()=>policy.parseLiveReview(raw));
const start={action:'start',plan,provider:'openrouter',model:'fixture',effort:'medium'};
f.mainnet=false;await assert.rejects(rt.startLiveReview('owner',start));f.mainnet=true;
let s=await rt.startLiveReview('owner',start);await assert.rejects(rt.startLiveReview('owner',start));
assert.equal((await rt.liveReviewSnapshot('other')).session,null);
await Promise.all(Array.from({length:8},()=>rt.tickLiveReview('owner',s.id,s.generation)));
let snap=(await rt.liveReviewSnapshot('owner')).session;
assert.equal(f.calls,1);assert.equal(snap.reviews.length,1);assert.equal(snap.reviewsUsed,1);assert.equal(snap.lease,undefined);assert.equal(snap.generation,undefined);assert.equal((await rt.liveReviewSnapshot('owner')).automaticExecution,false);
const stored=()=>JSON.parse(f.rows.get('owner:_live_review:active').value);
const due=()=>{const r=f.rows.get('owner:_live_review:active'),v=JSON.parse(r.value);v.nextReviewAtMs=0;r.value=JSON.stringify(v);};
const control=async action=>{const v=stored();return rt.controlLiveReview('owner',{action,id:v.id,revision:v.revision});};
due();f.pending=true;await rt.tickLiveReview('owner',s.id,s.generation);snap=(await rt.liveReviewSnapshot('owner')).session;
assert.equal(snap.reviews.at(-1).stance,'hold');assert.match(snap.reviews.at(-1).rationale,/reservation/);assert.equal(f.calls,2);
due();await rt.tickLiveReview('owner',s.id,s.generation);assert.equal(f.calls,2);assert.equal(stored().reviewsUsed,2);
const deadline=stored().deadlineMs;s=await control('pause');assert.equal((await rt.tickLiveReview('owner',s.id,s.generation)).done,false);
s=await control('recover');assert.equal(s.deadlineMs,deadline);assert.equal(s.reviewsUsed,2);assert.equal(s.status,'paused');
await assert.rejects(control('resume'),/budget/);
await assert.rejects(rt.controlLiveReview('other',{action:'stop',id:s.id,revision:s.revision}));
await control('stop');s=await rt.startLiveReview('owner',start);assert.ok([...f.rows.keys()].some(k=>k.startsWith('owner:_live_review:archive:')));
// In-flight owner pause discards the answer; stale generations do not call model.
f.pending=false;f.during=async()=>{await control('pause');};await rt.tickLiveReview('owner',s.id,s.generation);assert.equal(stored().status,'paused');assert.equal(stored().reviews.length,0);f.during=null;
const old=s;s=await control('resume');await rt.tickLiveReview('owner',old.id,old.generation);assert.equal(f.calls,3);
due();f.fail=true;await rt.tickLiveReview('owner',s.id,s.generation);assert.match(stored().error,/unavailable/);assert.doesNotMatch(stored().error,/secret/);assert.equal(f.calls,3);f.fail=false;
due();f.partial=true;await rt.tickLiveReview('owner',s.id,s.generation);assert.equal(f.calls,3);f.partial=false;
due();f.emergency=true;await rt.tickLiveReview('owner',s.id,s.generation);assert.equal(f.calls,3);assert.equal(stored().reviews.at(-1).stance,'hold');f.emergency=false;
due();f.active=false;await rt.tickLiveReview('owner',s.id,s.generation);assert.equal(stored().status,'stopped');assert.equal(f.calls,3);f.active=true;
s=await rt.startLiveReview('owner',start);const row=f.rows.get('owner:_live_review:active'),expired=stored();expired.startedAtMs=Date.now()-3600001;expired.deadlineMs=expired.startedAtMs+3600000;row.value=JSON.stringify(expired);
await assert.rejects(control('recover'),/expired/);await rt.tickLiveReview('owner',s.id,s.generation);assert.equal(stored().status,'stopped');
// Audit stores cannot be overwritten through ordinary assistant memory tools.
const privateState=await bundle('src/lib/assistant/private-state.ts');assert.equal(privateState.isPrivateAssistantKey('_live_review:active'),true);
// The runtime dependency surface has no financial adapter or executable proposal.
const source=await readFile('src/lib/assistant/live-review-runtime.ts','utf8');assert.doesNotMatch(source,/executeTerminalOrder|cancelTerminalOrder|bybitRequest\(|\/v5\/order\/create|password/);
const api=await bundle('app/api/assistant/live-review/route.ts',{
 ...mocks,'@/lib/auth/owner':`import {AuthError} from '@/lib/auth/errors';export const requireOwnerId=async()=>{if(!globalThis.liveResearchFixture.active)throw new AuthError('denied','Denied',403);return 'owner';};`,
 '@/lib/assistant/live-review-runtime':`export const liveReviewSnapshot=async()=>({session:null,automaticExecution:false});export const startLiveReview=async()=>({id:'id',generation:'gen',status:'running'});export const controlLiveReview=async()=>({id:'id',generation:'gen',status:'stopped'});export const recordLiveReviewRun=async()=>{};`,
 '@/workflows/live-review':'export async function liveReviewWorkflow(){};','workflow/api':`export async function start(){return {runId:'fixture'};}`
});process.env.AUTH_APP_URL='https://fixture.test';
const request=(body,origin='https://fixture.test')=>new Request('https://fixture.test/api/assistant/live-review',{method:'POST',headers:{origin},body:JSON.stringify(body)});
assert.equal((await api.POST(request(start,'https://evil.test'))).status,403);assert.equal((await api.POST(request([]))).status,400);assert.equal((await api.POST(request(start))).status,200);
f.active=false;assert.equal((await api.GET()).status,403);assert.equal((await api.POST(request(start))).status,403);
console.log('PASS: live research rules, eight competing claims, bounded paid calls, reservation Hold, recovery/paused budget preservation, stale workers, in-flight pause, owner disable, expiry, unknown exchange data, private state, authenticated same-origin route. Fixtures only; no network or financial writes.');
