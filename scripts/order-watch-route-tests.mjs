import assert from 'node:assert/strict';import {build} from 'esbuild';
globalThis.routeWatch={owner:true,claimed:true,starts:0,records:[],fail:false};
const mocks={
 '@/lib/auth/errors':'export class AuthError extends Error { statusCode=401; }',
 '@/lib/auth/owner':`import {AuthError} from '@/lib/auth/errors';export async function requireOwnerId(){if(!globalThis.routeWatch.owner)throw new AuthError();return 'owner';}`,
 '@/lib/bybit/reconciliation':`export async function reconciliationCandidates(){return {intents:[{id:'one'}]};}export async function reconcileTerminalOrder(){return {state:'exchange_open'};}`,
 'workflow/api':`export async function start(){const f=globalThis.routeWatch;f.starts++;if(f.fail)throw Error('sensitive queue detail');return {runId:'run'};}`,
 '@/workflows/order-watch':'export const orderWatchWorkflow=async()=>{};',
 '@/lib/bybit/order-watch':`export async function claimOrderWatch(){return {claimed:globalThis.routeWatch.claimed,state:{generation:'generation'}};}export async function recordOrderWatch(_u,_i,_g,run){globalThis.routeWatch.records.push(run);}export async function orderWatchSummaries(){return {one:{status:'watching'}};}`
};
const r=await build({entryPoints:['app/api/bybit/reconciliation/route.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}]});const route=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
process.env.AUTH_APP_URL='https://example.test';const f=globalThis.routeWatch;
const req=(body,origin='https://example.test')=>new Request('https://example.test/api/bybit/reconciliation',{method:'POST',headers:{origin},body:JSON.stringify(body)});
f.owner=false;assert.equal((await route.POST(req({intentId:'one',action:'watch'}))).status,401);f.owner=true;
assert.equal((await route.POST(req({intentId:'one',action:'watch'},'https://evil.test'))).status,403);
for(const b of [{intentId:'one',action:'submit'},{intentId:'one',action:'watch',extra:true},{intentId:'../secret',action:'watch'}])assert.equal((await route.POST(req(b))).status,400);
assert.equal(f.starts,0);assert.equal((await route.POST(req({intentId:'one',action:'watch'}))).status,200);assert.equal(f.starts,1);assert.equal(f.records.at(-1),'run');
f.claimed=false;await route.POST(req({intentId:'one',action:'watch'}));assert.equal(f.starts,1);
f.claimed=true;f.fail=true;const failed=await route.POST(req({intentId:'one',action:'watch'}));assert.equal(failed.status,400);assert.equal(f.records.at(-1),null);assert.ok(!(await failed.text()).includes('sensitive'));
assert.equal((await route.GET()).headers.get('Cache-Control'),'private, no-store');
console.log('PASS monitoring route owner auth, same-origin, exact body, duplicate exclusion, queue failure redaction and private state response. Fixtures only.');
