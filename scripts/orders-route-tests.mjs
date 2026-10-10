import assert from 'node:assert/strict';import {build} from 'esbuild';
const f=globalThis.ordersRoute={owner:true,cancels:0,executes:0,previews:0};
const mocks={
 'next/server':'export const NextResponse={json:Response.json};',
 '@/lib/auth/errors':'export class AuthError extends Error{statusCode=401;}',
 '@/lib/auth/owner':`import {AuthError} from '@/lib/auth/errors';export async function requireOwnerId(){if(!globalThis.ordersRoute.owner)throw new AuthError();return 'owner';}`,
 '@/lib/bybit/terminal':'import {OrderCancellationError} from "@/lib/bybit/cancellation-error";export async function cancelTerminalOrder(){globalThis.ordersRoute.cancels++;if(globalThis.ordersRoute.dispatchState)throw new OrderCancellationError("test failure",globalThis.ordersRoute.dispatchState);if(globalThis.ordersRoute.unclassified)throw Error("unexpected failure");return {};}export async function previewTerminalOrder(){globalThis.ordersRoute.previews++;return {};}',
 '@/lib/bybit/observed-execution':'export async function executeObservedOrder(){globalThis.ordersRoute.executes++;return {};}',
 '@/lib/bybit/trading':'export async function listBybitOrders(){return [];}',
};
const r=await build({entryPoints:['app/api/bybit/orders/route.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));}}]});const route=await import('data:text/javascript;base64,'+Buffer.from(r.outputFiles[0].text).toString('base64'));
process.env.AUTH_APP_URL='https://example.test';
const req=(body,method='DELETE',origin='https://example.test')=>new Request('https://example.test/api/bybit/orders',{method,headers:origin?{origin}:{},body:JSON.stringify(body)});
for(const method of ['DELETE','POST']){f.owner=false;assert.equal((await route[method](req({},method))).status,401);f.owner=true;for(const origin of ['https://evil.test',''])assert.equal((await route[method](req({},method,origin))).status,403);for(const body of [null,[], 'x'.repeat(17000)])assert.equal((await route[method](req(body,method))).status,400);}
assert.equal((await route.DELETE(req({unexpected:true}))).status,400);assert.equal(f.cancels+f.executes+f.previews,0);
assert.equal((await route.DELETE(req({mode:'bybit_testnet',category:'spot',symbol:'BTCUSDT',orderId:'one',confirmation:'CANCEL BYBIT TESTNET ORDER one'}))).status,200);assert.equal(f.cancels,1);
await route.POST(req({},'POST'));await route.POST(req({confirmed:true},'POST'));assert.equal(f.previews,1);assert.equal(f.executes,1);assert.equal((await route.GET()).headers.get('Cache-Control'),'private, no-store');
console.log('PASS owner and same-origin fencing, bounded object bodies, cancellation field whitelist and private order responses. Fixtures only.');

for(const dispatchState of ['not_sent','unknown']){f.dispatchState=dispatchState;const response=await route.DELETE(req({}));assert.equal(response.status,400);assert.equal((await response.json()).dispatchState,dispatchState);}
delete f.dispatchState;f.unclassified=true;assert.equal((await(await route.DELETE(req({}))).json()).dispatchState,'unknown');
f.owner=false;assert.equal((await(await route.DELETE(req({}))).json()).dispatchState,'not_sent');
f.owner=true;assert.equal((await(await route.DELETE(req({unexpected:true}))).json()).dispatchState,'not_sent');
console.log('PASS cancellation dispatch classification survives HTTP; unclassified exchange errors remain unknown, owner/body rejection is not sent.');
