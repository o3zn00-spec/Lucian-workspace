import assert from 'node:assert/strict';
import {build} from 'esbuild';
const now=Date.now();
const plan={mode:'paper',exchange:'bybit',category:'spot',currency:'USDT',leverage:1,capital:'1000',maxOrder:'100',maxExposure:'500',maxLoss:'50',maxRiskPerTrade:'10',symbols:['BTCUSDT'],maxOrders:10,maxPositions:2,reviewMinutes:1,durationHours:1,maxDataAgeSeconds:60,feeBps:10,slippageBps:5,strategy:'Fixture paper simulation',additionalRules:''};
const q=()=>({BTCUSDT:{symbol:'BTCUSDT',bid:'49999',ask:'50000',observedAtMs:Date.now(),instrumentVerified:true,quantityStep:'0.000001',minQuantity:'0.000001',minNotional:'5'}});
async function bundle(entry,mocks={}){const r=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));}}]});return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));}
const engine=await bundle('src/lib/assistant/paper-engine.ts');
const initial={id:'id',revision:'revision',generation:'generation',planRevision:'plan-revision',plan,provider:'openrouter',model:'fixture-model',effort:'medium',status:'running',startedAtMs:now,updatedAtMs:now,nextTickAtMs:now,nextReviewAtMs:now,cashCents:100000,equityCents:100000,ordersPlaced:0,positions:[],fills:[],history:[],lastMessage:'',error:null,runId:null,lease:null};
const buy={action:'buy',symbol:'BTCUSDT',quantity:'0.001',stopPrice:'49000',takeProfit:'52000'};
let s=engine.applyPaperCycle(initial,q(),buy,Date.now());assert.equal(s.positions.length,1);assert.equal(s.cashCents,94991);assert.equal(s.fills.length,1);assert.equal(initial.fills.length,0);
s=engine.applyPaperCycle(s,q(),buy,Date.now());assert.equal(s.positions.length,1);assert.equal(s.fills.length,1);assert.match(s.lastMessage,/already exists/);
let paused=engine.applyPaperCycle({...s,status:'paused'},q(),buy,Date.now());assert.equal(paused.fills.length,1);
const gap=q();gap.BTCUSDT.bid='40000';gap.BTCUSDT.ask='40001';
let exited=engine.applyPaperCycle({...s,status:'paused'},gap,null,Date.now());assert.equal(exited.positions.length,0);assert.equal(exited.fills[1].reason,'Stop loss');assert.equal(exited.fills[1].amountCents,3994);assert.equal(exited.cashCents,98985);assert.equal(exited.status,'paused');
exited=engine.applyPaperCycle({...s,plan:{...plan,maxLoss:'10'}},gap,null,Date.now());assert.equal(exited.status,'stopped');assert.equal(exited.fills[1].reason,'Session loss limit');
const mildGap=q();mildGap.BTCUSDT.bid='48000';mildGap.BTCUSDT.ask='48001';
exited=engine.applyPaperCycle({...s,status:'paused'},mildGap,null,Date.now());assert.equal(exited.positions.length,0);assert.equal(exited.fills[1].reason,'Stop loss');assert.equal(exited.fills[1].amountCents,4792);assert.equal(exited.status,'paused');
const profit=q();profit.BTCUSDT.bid='53000';profit.BTCUSDT.ask='53001';
exited=engine.applyPaperCycle(s,profit,null,Date.now());assert.equal(exited.fills[1].reason,'Take profit');assert.ok(exited.cashCents>100000);
exited=engine.applyPaperCycle(s,q(),{action:'sell',symbol:'BTCUSDT'},Date.now());assert.equal(exited.fills[1].reason,'Model exit');
exited=engine.applyPaperCycle({...s,status:'closing'},q(),buy,Date.now());assert.equal(exited.status,'stopped');assert.equal(exited.ordersPlaced,1);
const future=now+3600000;const futureQuotes=q();futureQuotes.BTCUSDT.observedAtMs=future;
exited=engine.applyPaperCycle(s,futureQuotes,buy,future);assert.equal(exited.status,'stopped');assert.equal(exited.fills[1].reason,'Session expired');
assert.throws(()=>engine.applyPaperCycle(s,{},buy,Date.now()));
for(const p of [{action:'live'},{action:'hold',extra:1},{action:'buy',...buy,endpoint:'evil'},{...buy,quantity:'-1'}])assert.throws(()=>engine.parsePaperProposal(JSON.stringify(p)));
for(const bad of [{...s,cashCents:s.cashCents+1},{...s,ordersPlaced:2},{...s,fills:[...s.fills,{...s.fills[0],side:'sell',quantity:'0.002'}]},{...s,history:[{atMs:Date.now()+100000,equityCents:0}]}])assert.throws(()=>engine.validatePaperSession(bad));
assert.deepEqual(engine.parsePaperProposal('{"action":"hold"}'),{action:'hold'});
// Actual server store with transaction rollback and serialized competing requests.
globalThis.rtRows=new Map();globalThis.rtEvents=[];globalThis.rtQuotes=q();globalThis.rtMarketFail=false;globalThis.rtAuditFail=false;globalThis.rtModelFail=false;globalThis.rtReply=JSON.stringify(buy);globalThis.rtCalls=0;globalThis.rtOwner='owner-A';globalThis.rtActive=true;globalThis.rtQueue=Promise.resolve();globalThis.rtDuringModel=null;
const mocks={
 'server-only':'',
 '@/lib/auth/owner':`import {AuthError} from '@/lib/auth/errors';export async function requireOwnerId(){if(!globalThis.rtOwner)throw new AuthError('unauthorized','Denied',403);return globalThis.rtOwner;}`,
 '@/lib/auth/owner-identity':`export const configuredOwnerEmail=()=> 'owner@fixture.test';`,
 '@/lib/agent/providers':`export async function getProvider(){return {chat:async()=>{globalThis.rtCalls++;if(globalThis.rtDuringModel)await globalThis.rtDuringModel();if(globalThis.rtModelFail)throw Error('Model unavailable');return {content:globalThis.rtReply,fromModel:true};}};}`,
 './paper-research':`export async function collectPaperResearch(){if(globalThis.rtResearchFail)throw Error('Research unavailable');return {observedAtMs:Date.now(),markets:[],announcements:[],warnings:[]};}`,
 './paper-market':`export async function paperMarketQuotes(){if(globalThis.rtMarketFail)throw Error('Quotes unavailable');const q=structuredClone(globalThis.rtQuotes);q.BTCUSDT.observedAtMs=Date.now();return q;}`,
 '@/lib/db':`const id=w=>w.userId_key.userId+':'+w.userId_key.key;const memory={findUnique:async({where})=>globalThis.rtRows.get(id(where))??null,upsert:async({where,create,update})=>{const k=id(where),row=globalThis.rtRows.get(k);globalThis.rtRows.set(k,row?{...row,...update}:create);},create:async({data})=>{const k=data.userId+':'+data.key;if(globalThis.rtRows.has(k))throw Error('Duplicate');globalThis.rtRows.set(k,data);}};memory.update=async({where,data})=>{const k=id(where);globalThis.rtRows.set(k,{...globalThis.rtRows.get(k),...data});};const activity={create:async({data})=>{if(globalThis.rtAuditFail)throw Error('Audit unavailable');globalThis.rtEvents.push(data);}};export const db={assistantMemory:memory,user:{findUnique:async()=>({email:'owner@fixture.test',status:globalThis.rtActive?'active':'disabled'})},$transaction:async(fn)=>{const prior=globalThis.rtQueue;let release;globalThis.rtQueue=new Promise(r=>release=r);await prior;const rows=new Map(globalThis.rtRows),len=globalThis.rtEvents.length;try{return await fn({assistantMemory:memory,assistantActivity:activity,$queryRaw:async()=>[]});}catch(e){globalThis.rtRows=rows;globalThis.rtEvents.length=len;throw e;}finally{release();}}};`
};
const rt=await bundle('src/lib/assistant/paper-runtime.ts',mocks);
const startBody={action:'start',revision:'p1',confirmation:'START PAPER',provider:'openrouter',model:'fixture-model',effort:'medium'};
const draft={userId:'owner-A',key:'_paper_session:plan',value:JSON.stringify({plan,revision:'p1',savedAt:new Date().toISOString()})};globalThis.rtRows.set('owner-A:_paper_session:plan',draft);
await assert.rejects(rt.createPaperSession('owner-A',{...startBody,confirmation:'yes'}));
await assert.rejects(rt.createPaperSession('owner-A',{...startBody,revision:'stale'}));
await assert.rejects(rt.createPaperSession('owner-A',{...startBody,mode:'live'}));
let session=await rt.createPaperSession('owner-A',startBody);assert.equal(session.status,'running');assert.equal((await rt.paperSessionSnapshot('owner-B')).session,null);
await assert.rejects(rt.createPaperSession('owner-A',startBody),/already exists/);
await Promise.all([rt.runPaperTick('owner-A',session.id,session.generation),rt.runPaperTick('owner-A',session.id,session.generation)]);
let snapshot=(await rt.paperSessionSnapshot('owner-A')).session;assert.equal(snapshot.fills.length,1);assert.equal(globalThis.rtCalls,1);assert.equal(snapshot.generation,undefined);assert.equal(snapshot.lease,undefined);
await rt.runPaperTick('owner-A',session.id,session.generation);assert.equal((await rt.paperSessionSnapshot('owner-A')).session.fills.length,1);
const control=action=>rt.controlPaperSession('owner-A',{action,id:snapshot.id,revision:snapshot.revision});
await assert.rejects(rt.controlPaperSession('owner-B',{action:'stop',id:snapshot.id,revision:snapshot.revision}));
await assert.rejects(rt.controlPaperSession('owner-A',{action:'stop',id:snapshot.id,revision:'stale'}));
let changed=await control('pause');snapshot=(await rt.paperSessionSnapshot('owner-A')).session;assert.equal(snapshot.status,'paused');
await rt.runPaperTick('owner-A',changed.id,changed.generation);assert.equal(globalThis.rtCalls,1);
snapshot=(await rt.paperSessionSnapshot('owner-A')).session;changed=await control('recover');
await rt.runPaperTick('owner-A',session.id,session.generation);assert.equal((await rt.paperSessionSnapshot('owner-A')).session.fills.length,1);
snapshot=(await rt.paperSessionSnapshot('owner-A')).session;assert.equal(snapshot.status,'paused');
changed=await control('stop');globalThis.rtMarketFail=true;
await rt.runPaperTick('owner-A',changed.id,changed.generation);snapshot=(await rt.paperSessionSnapshot('owner-A')).session;assert.equal(snapshot.status,'closing');assert.equal(snapshot.positions.length,1);assert.match(snapshot.error,/unavailable/);
globalThis.rtMarketFail=false;changed=await control('recover');await rt.runPaperTick('owner-A',changed.id,changed.generation);snapshot=(await rt.paperSessionSnapshot('owner-A')).session;assert.equal(snapshot.status,'stopped');assert.equal(snapshot.positions.length,0);assert.equal(snapshot.fills.length,2);
// Replacement archives prior session. Audit failure cannot partially start a new one.
globalThis.rtAuditFail=true;await assert.rejects(rt.createPaperSession('owner-A',startBody));assert.equal((await rt.paperSessionSnapshot('owner-A')).session.id,snapshot.id);globalThis.rtAuditFail=false;
session=await rt.createPaperSession('owner-A',startBody);assert.ok(globalThis.rtRows.has('owner-A:_paper_session:archive:'+snapshot.id));
// Owner pause while model is in flight invalidates its proposal.
globalThis.rtDuringModel=async()=>{const current=(await rt.paperSessionSnapshot('owner-A')).session;await rt.controlPaperSession('owner-A',{action:'pause',id:current.id,revision:current.revision});};
await rt.runPaperTick('owner-A',session.id,session.generation);snapshot=(await rt.paperSessionSnapshot('owner-A')).session;assert.equal(snapshot.status,'paused');assert.equal(snapshot.fills.length,0);globalThis.rtDuringModel=null;
changed=await control('resume');const resumeRow=globalThis.rtRows.get('owner-A:_paper_session:active');const resumeDue=JSON.parse(resumeRow.value);resumeDue.nextReviewAtMs=0;resumeRow.value=JSON.stringify(resumeDue);globalThis.rtModelFail=true;await rt.runPaperTick('owner-A',changed.id,changed.generation);snapshot=(await rt.paperSessionSnapshot('owner-A')).session;assert.equal(snapshot.fills.length,0);assert.match(snapshot.error,/Model review failed/);globalThis.rtModelFail=false;
changed=await control('recover');globalThis.rtReply='{"action":"hold"}';await rt.runPaperTick('owner-A',changed.id,changed.generation);snapshot=(await rt.paperSessionSnapshot('owner-A')).session;assert.equal(snapshot.fills.length,0);
// Protective exits are persisted even if the subsequent model review fails.
globalThis.rtReply=JSON.stringify(buy);const stored=globalThis.rtRows.get('owner-A:_paper_session:active');const scheduled=JSON.parse(stored.value);scheduled.nextReviewAtMs=0;stored.value=JSON.stringify(scheduled);changed=await control('recover');await rt.runPaperTick('owner-A',changed.id,changed.generation);snapshot=(await rt.paperSessionSnapshot('owner-A')).session;assert.equal(snapshot.positions.length,1);
globalThis.rtQuotes=mildGap;globalThis.rtModelFail=true;const openStored=globalThis.rtRows.get('owner-A:_paper_session:active');const due=JSON.parse(openStored.value);due.nextReviewAtMs=0;openStored.value=JSON.stringify(due);changed=await control('recover');await rt.runPaperTick('owner-A',changed.id,changed.generation);snapshot=(await rt.paperSessionSnapshot('owner-A')).session;assert.equal(snapshot.positions.length,0);assert.equal(snapshot.fills.at(-1).reason,'Stop loss');assert.match(snapshot.error,/Model review failed/);globalThis.rtModelFail=false;globalThis.rtQuotes=q();
// Missing research blocks entries; exhausted review budget never calls the provider.
globalThis.rtResearchFail=true;const rr=globalThis.rtRows.get('owner-A:_paper_session:active');let rs=JSON.parse(rr.value);rs.nextReviewAtMs=0;rr.value=JSON.stringify(rs);snapshot=(await rt.paperSessionSnapshot('owner-A')).session;changed=await control('recover');const beforeResearch=globalThis.rtCalls;await rt.runPaperTick('owner-A',changed.id,changed.generation);snapshot=(await rt.paperSessionSnapshot('owner-A')).session;assert.equal(snapshot.positions.length,0);assert.equal(globalThis.rtCalls,beforeResearch);assert.equal(snapshot.reviews.at(-1).action,'unavailable');globalThis.rtResearchFail=false;
const capRow=globalThis.rtRows.get('owner-A:_paper_session:active');rs=JSON.parse(capRow.value);rs.reviewCount=30;rs.nextReviewAtMs=0;capRow.value=JSON.stringify(rs);snapshot=(await rt.paperSessionSnapshot('owner-A')).session;changed=await control('recover');await rt.runPaperTick('owner-A',changed.id,changed.generation);snapshot=(await rt.paperSessionSnapshot('owner-A')).session;assert.equal(globalThis.rtCalls,beforeResearch);assert.equal(snapshot.reviewCount,30);assert.match(snapshot.lastMessage,/budget exhausted/);
// The actual nonfinancial check reserves once, never targets a financial session,
// survives its waiting state, and cannot turn an earlier failure into a pass.
const probe=await bundle('src/lib/assistant/paper-runtime-check.ts',{...mocks,'./paper-runtime':`export async function runPaperTick(userId,id){if(!id.startsWith('verification:'))throw Error('Unsafe check');return {done:true};}`});
let check=await probe.reserveRuntimeCheck('owner-A');await assert.rejects(probe.reserveRuntimeCheck('owner-A'));
await probe.runtimeCheckStage('owner-A',check.id,false);assert.equal((await probe.runtimeCheckSnapshot('owner-A')).status,'waiting');
await probe.runtimeCheckStage('owner-A',check.id,true);assert.equal((await probe.runtimeCheckSnapshot('owner-A')).status,'passed');
check=await probe.reserveRuntimeCheck('owner-B');globalThis.rtMarketFail=true;await probe.runtimeCheckStage('owner-B',check.id,false);globalThis.rtMarketFail=false;await probe.runtimeCheckStage('owner-B',check.id,true);assert.equal((await probe.runtimeCheckSnapshot('owner-B')).status,'failed');
// Route fixtures test owner/origin/exact arguments, without dispatching real workflows.
const api=await bundle('app/api/assistant/paper-session/route.ts',{...mocks,'@/lib/assistant/paper-runtime':`export const paperSessionSnapshot=async()=>({session:null});export const createPaperSession=async()=>({id:'id',generation:'generation'});export const controlPaperSession=async()=>({id:'id',generation:'generation'});export const recordPaperRun=async()=>{};`,'@/lib/assistant/paper-runtime-check':`export const reserveRuntimeCheck=async()=>({id:'fixture'});export const runtimeCheckStage=async()=>{};export const runtimeCheckSnapshot=async()=>null;`,'@/workflows/paper-session':`export async function paperSessionWorkflow(){};export async function paperRuntimeCheckWorkflow(){}`,'workflow/api':`export async function start(){return {runId:'fixture'};}`});
process.env.AUTH_APP_URL='https://fixture.test';
const request=(body,origin='https://fixture.test')=>new Request('https://fixture.test/api/assistant/paper-session',{method:'POST',headers:{origin},body:JSON.stringify(body)});
assert.equal((await api.POST(request(startBody,'https://evil.test'))).status,403);globalThis.rtOwner=null;assert.equal((await api.GET()).status,403);assert.equal((await api.POST(request(startBody))).status,403);
console.log('PASS: paper engine buys/exits/gaps/expiry/pause; durable store owner/revision isolation, duplicate cycles, archive preservation, audit rollback, market/model failure, recovery, old generation denial and in-flight pause. No network or real funds.');
