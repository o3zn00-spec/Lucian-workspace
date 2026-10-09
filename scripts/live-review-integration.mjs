import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const database=new URL(process.env.DATABASE_URL??'http://invalid');
assert(['localhost','127.0.0.1'].includes(database.hostname)&&database.pathname==='/lucian_restoration_dev_20261007','Named local database required; production forbidden.');
const {PrismaClient}=createRequire(import.meta.url)('@prisma/client');const db=new PrismaClient();globalThis.liveReviewDb=db;globalThis.liveReviewCalls=0;
const mocks={
 'server-only':'','@/lib/db':'export const db=globalThis.liveReviewDb;','@/lib/auth/owner-identity':'export const isConfiguredOwnerEmail=()=>true;',
 '@/lib/bybit/client':`export const getBybitConfig=async()=>({configured:true,environment:'mainnet'});`,
 '@/lib/bybit/trading':`export const getTradingProfile=async()=>({emergencyStop:false,maxOrderUsd:6,maxPositionUsd:10,maxDailyLossUsd:1,maxOpenPositions:1});`,
 '@/lib/bybit/reconciliation':`export const reconciliationCandidates=async()=>({hasMore:false,intents:[],completed:[]});export async function reconcileTerminalOrder(){throw Error('Unexpected exchange read');}`,
 './paper-research':`export const collectPaperResearch=async()=>({observedAtMs:Date.now(),markets:[],context:[],warnings:[],announcements:[]});`,
 '@/lib/agent/providers':`export const getProvider=async()=>({chat:async()=>{globalThis.liveReviewCalls++;return {fromModel:true,content:'{"stance":"hold","rationale":"Integration fixture, no network."}'};}});`
};
const r=await build({entryPoints:['src/lib/assistant/live-review-runtime.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'isolated',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]}));}}]});
const rt=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64')),owner=randomUUID();
try{
 await db.user.create({data:{id:owner,username:'review-'+owner,email:owner+'@example.test'}});
 const body={action:'start',provider:'openrouter',model:'fixture',effort:'medium',plan:{symbols:['BTCUSDT'],strategy:'Fixture',reviewMinutes:5,durationHours:1,maxReviews:2}};
 const starts=await Promise.allSettled(Array.from({length:8},()=>rt.startLiveReview(owner,body)));
 assert.equal(starts.filter(r=>r.status==='fulfilled').length,1);
 const s=starts.find(r=>r.status==='fulfilled').value;
 await Promise.all(Array.from({length:8},()=>rt.tickLiveReview(owner,s.id,s.generation)));
 let snap=(await rt.liveReviewSnapshot(owner)).session;assert.equal(globalThis.liveReviewCalls,1);assert.equal(snap.reviews.length,1);assert.equal(snap.reviewsUsed,1);
 const recovered=await rt.controlLiveReview(owner,{action:'recover',id:snap.id,revision:snap.revision});assert.equal(recovered.deadlineMs,s.deadlineMs);assert.equal(recovered.reviewsUsed,1);
 await rt.tickLiveReview(owner,s.id,s.generation);assert.equal(globalThis.liveReviewCalls,1);
 const where={userId_key:{userId:owner,key:'_live_review:active'}},row=await db.assistantMemory.findUnique({where}),due=JSON.parse(row.value);due.nextReviewAtMs=0;await db.assistantMemory.update({where,data:{value:JSON.stringify(due)}});
 await db.user.update({where:{id:owner},data:{status:'disabled'}});await rt.tickLiveReview(owner,recovered.id,recovered.generation);
 snap=(await rt.liveReviewSnapshot(owner)).session;assert.equal(snap.status,'stopped');assert.equal(globalThis.liveReviewCalls,1);
 assert.equal(await db.liveTradeIntent.count({where:{userId:owner}}),0);
 console.log('PASS actual isolated PostgreSQL: eight starts produce one session, eight ticks consume one model review, recovery keeps budget/deadline, old generation cannot overwrite, disabled owner stops, zero trade intents. Fixture exchange/model only.');
}finally{await db.user.deleteMany({where:{id:owner}});await db.$disconnect();delete globalThis.liveReviewDb;delete globalThis.liveReviewCalls;}
