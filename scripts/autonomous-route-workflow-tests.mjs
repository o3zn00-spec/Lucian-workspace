import assert from 'node:assert/strict';
import {build} from 'esbuild';
process.on('uncaughtException',e=>{console.error(e.name,e.message);process.exit(1);});
async function bundle(entry,mocks){const r=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});return import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));}
const f=globalThis.autonomousRouteFixture={owner:true,authorizations:0,controls:0,starts:[],records:[],queueFail:false,session:{id:'session',generation:'generation',status:'running',supervisorRunId:null}};
const mocks={
 '@/lib/auth/errors':'export class AuthError extends Error {statusCode=401;}',
 '@/lib/auth/owner':`import {AuthError} from '@/lib/auth/errors';export async function requireOwnerId(){if(!globalThis.autonomousRouteFixture.owner)throw new AuthError();return 'owner';}`,
 '@/lib/bybit/autonomous-session':`const f=globalThis.autonomousRouteFixture;export async function autonomousSnapshot(){return {session:f.session};}export async function previewAutonomousSession(){return {draft:{id:'draft'}};}export async function startAutonomousSession(){f.authorizations++;return f.session;}export async function renewAutonomousExit(){return f.session;}export async function controlAutonomousSession(){f.controls++;return f.session;}export async function recordAutonomousRun(...args){f.records.push(args);}`,
 '@/workflows/autonomous-trading':'export const autonomousTradingWorkflow=async()=>{};export const autonomousTradingSupervisor=async()=>{};',
 'workflow/api':`export async function start(fn,args,opts){const f=globalThis.autonomousRouteFixture;f.starts.push({name:fn.name,args,opts});if(f.queueFail)throw Error('sensitive queue token');return {runId:'run-'+f.starts.length};}`
};
const route=await bundle('app/api/bybit/autonomous-session/route.ts',mocks);process.env.AUTH_APP_URL='https://example.test';
const req=(body,origin='https://example.test')=>new Request('https://example.test/api/bybit/autonomous-session',{method:'POST',headers:{origin},body:typeof body==='string'?body:JSON.stringify(body)});
f.owner=false;assert.equal((await route.GET()).status,401);assert.equal((await route.POST(req({action:'start'}))).status,401);f.owner=true;assert.equal((await route.POST(req({action:'start'},'https://evil.test'))).status,403);for(const bad of ['{','[]','null','x'.repeat(10001)])assert.equal((await route.POST(req(bad))).status,400);assert.equal(f.authorizations,0);assert.equal(f.starts.length,0);
assert.equal((await route.POST(req({action:'preview'}))).status,200);assert.equal(f.starts.length,0);f.queueFail=true;const failedDispatch=await route.POST(req({action:'start'}));assert.equal(failedDispatch.status,200);assert.equal(f.authorizations,1);assert.equal(f.starts.length,2);assert.equal(f.records.at(-1)[3],null);assert.ok(!(await failedDispatch.text()).includes('sensitive'));assert.equal((await route.GET()).headers.get('Cache-Control'),'private, no-store');
f.session.status='stopped';await route.POST(req({action:'close'}));assert.equal(f.starts.length,2);
console.log('PASS session route owner/same-origin boundary, bounded JSON, read-only preview, saved grant on queue failure, private cache and redacted dispatch errors. Strict grant bodies tested in DB integration.');
const w=globalThis.autonomousWorkflowFixture={ticks:[],sleeps:[],starts:[],records:[],doneAt:2,recover:null,stopped:false};
const workflow=await bundle('src/workflows/autonomous-trading.ts',{
 'workflow':`export async function sleep(t){globalThis.autonomousWorkflowFixture.sleeps.push(t);}`,
 'workflow/api':`export async function start(fn,args,opts){const f=globalThis.autonomousWorkflowFixture;f.starts.push({name:fn.name,args,opts});return {runId:'child'};}`,
 '@/lib/bybit/autonomous-session':`const f=globalThis.autonomousWorkflowFixture;export async function tickAutonomousSession(...args){f.ticks.push(args);return {done:f.ticks.length===f.doneAt,fast:f.ticks.length===1};}export async function recordAutonomousRun(...args){f.records.push(args);}export async function recordAutonomousSupervisor(...args){f.records.push(args);}export async function recoverAutonomousSession(){const s=f.recover;f.recover=null;return s;}export async function autonomousSnapshot(){return {session:f.stopped?null:{id:'session',status:'running'}};}`
});
await workflow.autonomousTradingWorkflow('owner','session','generation');assert.deepEqual(w.sleeps,['10s']);assert.equal(w.starts.length,0);
Object.assign(w,{ticks:[],sleeps:[],starts:[],records:[],doneAt:999});await workflow.autonomousTradingWorkflow('owner','session','generation');assert.equal(w.ticks.length,60);assert.equal(w.sleeps[0],'10s');assert.equal(w.sleeps[1],'60s');assert.deepEqual(w.starts[0].args,['owner','session','generation']);assert.equal(w.starts[0].opts.region,'cpt1');assert.equal(w.records[0][3],'child');
Object.assign(w,{ticks:[],sleeps:[],starts:[],records:[],recover:{generation:'replacement'},stopped:true});await workflow.autonomousTradingSupervisor('owner','session');assert.deepEqual(w.sleeps,['3m']);assert.deepEqual(w.starts[0].args,['owner','session','replacement']);assert.equal(w.records[0][2],'replacement');
console.log('PASS workflow control flow: fast exchange polling, normal research polling, stopped worker exits, bounded continuation and recovery generation. SDK compilation verified by production build; this fixture does not simulate the durable runtime.');
delete globalThis.autonomousRouteFixture;delete globalThis.autonomousWorkflowFixture;
