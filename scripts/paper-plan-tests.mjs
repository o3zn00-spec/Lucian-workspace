import assert from 'node:assert/strict';
import { build } from 'esbuild';
globalThis.paperRows=new Map();globalThis.paperEvents=[];globalThis.paperOwner='owner-A';globalThis.paperAuditFailure=false;
const mocks={
 'server-only':'',
 '@/lib/auth/owner':`import {AuthError} from '@/lib/auth/errors';export async function requireOwnerId(){if(!globalThis.paperOwner)throw new AuthError('unauthorized','Owner required',403);return globalThis.paperOwner;}`,
 '@/lib/db':`const rows=()=>globalThis.paperRows;const id=w=>w.userId_key.userId+':'+w.userId_key.key;
 const memory={findUnique:async({where})=>rows().get(id(where))??null,create:async({data})=>{const k=data.userId+':'+data.key;if(rows().has(k))throw Error('Duplicate');rows().set(k,data);return data;},updateMany:async({where,data})=>{const k=where.userId+':'+where.key;const r=rows().get(k);if(!r||r.value!==where.value)return {count:0};rows().set(k,{...r,...data});return {count:1};}};
 const activity={create:async({data})=>{if(globalThis.paperAuditFailure)throw Error('Audit down');globalThis.paperEvents.push(data);return data;}};
 export const db={assistantMemory:memory,$transaction:async fn=>{const prior=new Map(rows()),count=globalThis.paperEvents.length;try{return await fn({assistantMemory:memory,assistantActivity:activity});}catch(e){globalThis.paperRows=prior;globalThis.paperEvents.length=count;throw e;}}};`,
};
async function bundle(entry){const result=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'mocks',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));}}]});return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));}
const {isAssistantDestination}=await bundle('src/lib/assistant/contracts.ts');
assert.equal(isAssistantDestination('/markets?paperSetup=1'),true);
for(const path of ['/markets?paperSetup=live','//evil.test','https://evil.test','/markets?paperSetup=1&mode=live'])assert.equal(isAssistantDestination(path),false);
const {validatePaperPlan,cents}=await bundle('src/lib/assistant/paper-policy.ts');
const plan={mode:'paper',exchange:'bybit',category:'spot',currency:'USDT',leverage:1,capital:'1000',maxOrder:'100',maxExposure:'500',maxLoss:'50',maxRiskPerTrade:'10',symbols:['BTCUSDT'],maxOrders:10,maxPositions:2,reviewMinutes:5,durationHours:24,maxDataAgeSeconds:60,feeBps:10,slippageBps:5,strategy:'Example fixture: wait for verified strategy; no trades.',additionalRules:''};
assert.equal(cents('0.10'),10);assert.equal(cents('1.01'),101);assert.equal(validatePaperPlan(plan).mode,'paper');
for(const change of [{mode:'live'},{exchange:'coinbase'},{leverage:2},{capital:1000},{capital:'NaN'},{capital:'-1'},{capital:'1.001'},{maxOrder:'501'},{maxExposure:'1001'},{maxRiskPerTrade:'51'},{maxLoss:'1001'},{maxLoss:'0'},{maxPositions:0},{durationHours:0},{reviewMinutes:1.1},{feeBps:-1},{slippageBps:1001},{maxDataAgeSeconds:301},{symbols:['BTCUSDT','BTCUSDT']},{symbols:['BTCUSD']},{strategy:''},{unexpected:'field'}])assert.throws(()=>validatePaperPlan({...plan,...change}));
const api=await bundle('app/api/assistant/paper-plan/route.ts');process.env.AUTH_APP_URL='https://fixture.test';
const req=(body,origin='https://fixture.test')=>new Request('https://fixture.test/api/assistant/paper-plan',{method:'PUT',headers:{origin},body:JSON.stringify(body)});
assert.equal((await (await api.GET()).json()).plan,null);
assert.equal((await api.PUT(req({plan,revision:null},'https://evil.test'))).status,403);
assert.equal((await api.PUT(req({plan,revision:null,ownerUserId:'owner-B'}))).status,400);
assert.equal((await api.PUT(req({plan:{...plan,mode:'live'},revision:null}))).status,400);
let response=await api.PUT(req({plan,revision:null}));assert.equal(response.status,200);let snapshot=await response.json();assert.equal(snapshot.status,'draft');assert.equal(snapshot.runtimeAvailable,false);assert.ok(snapshot.revision);
assert.equal(globalThis.paperEvents.at(-1).userId,'owner-A');assert.doesNotMatch(globalThis.paperEvents.at(-1).reason,/1000|BTCUSDT/);
assert.equal((await api.PUT(req({plan,revision:null}))).status,409);
const saved=await (await api.GET()).json();assert.deepEqual(saved.plan,plan);assert.equal(saved.revision,snapshot.revision);
globalThis.paperOwner='owner-B';assert.equal((await (await api.GET()).json()).plan,null);assert.equal((await api.PUT(req({plan,revision:snapshot.revision}))).status,409);
globalThis.paperOwner='owner-A';
response=await api.PUT(req({plan:{...plan,capital:'2000'},revision:snapshot.revision}));assert.equal(response.status,200);const changed=await response.json();assert.notEqual(changed.revision,snapshot.revision);
assert.equal((await api.PUT(req({plan,revision:snapshot.revision}))).status,409);
globalThis.paperAuditFailure=true;assert.equal((await api.PUT(req({plan,revision:changed.revision}))).status,503);assert.equal((await (await api.GET()).json()).plan.capital,'2000');globalThis.paperAuditFailure=false;
globalThis.paperOwner=null;assert.equal((await api.GET()).status,403);assert.equal((await api.PUT(req({plan,revision:changed.revision}))).status,403);
console.log('PASS: paper-only strict boundaries; decimal money; owner/origin/schema isolation; draft persistence/reload; stale revision rejection; audit rollback; no runtime, account call, trade or migration.');
