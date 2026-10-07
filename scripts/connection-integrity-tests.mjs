import assert from 'node:assert/strict';
import { build } from 'esbuild';
async function bundle(entry, mocks={}) {
 const result=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/^server-only$|^next\/server$|^@\//},a=>mocks[a.path]!==undefined||a.path==='server-only'?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]??''}));}}]});
 return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const {runtimeDatabaseUrl}=await bundle('src/lib/database-url.ts');
assert.equal(runtimeDatabaseUrl(undefined),undefined);
const pooled=new URL(runtimeDatabaseUrl('postgres://fixture:secret@db.prisma.io:5432/postgres?sslmode=require'));
assert.equal(pooled.hostname,'pooled.db.prisma.io');assert.equal(pooled.searchParams.get('pgbouncer'),'true');assert.equal(pooled.searchParams.get('connection_limit'),'1');assert.equal(pooled.searchParams.get('sslmode'),'require');
const local=new URL(runtimeDatabaseUrl('postgres://fixture@localhost/local?connection_limit=3'));
assert.equal(local.hostname,'localhost');assert.equal(local.searchParams.get('connection_limit'),'3');assert.equal(local.searchParams.has('pgbouncer'),false);
const mocks={
 '@/lib/db':'export const db={tradingAuditEvent:{findMany:async()=>[]},liveTradeIntent:{findMany:async()=>[]}};',
 '@/lib/auth/password':'export const verifyPassword=async()=>false;',
 '@/lib/bybit/client':`export const getBybitConfig=async()=>({environment:'mainnet',configured:true});export const bybitPublicRequest=async()=>({list:[]});export const bybitRequest=async(_u,path)=>path.includes('wallet-balance')?globalThis.walletFixture:{list:[]};`,
 '@/lib/bybit/trading':'export const getTradingProfile=async()=>({maxOrderUsd:10,maxPositionUsd:20,maxDailyLossUsd:5,maxOpenPositions:1,maxLeverage:1,requireApproval:true,emergencyStop:false});',
};
const {terminalSnapshot}=await bundle('src/lib/bybit/terminal.ts',mocks);
globalThis.walletFixture={list:[]};await assert.rejects(terminalSnapshot('fixture',{mode:'bybit_live'}),/no Unified account/);
globalThis.walletFixture={list:[{accountType:'UNIFIED',totalEquity:'0',coin:[]}]};
let snapshot=await terminalSnapshot('fixture',{mode:'bybit_live'});assert.equal(snapshot.portfolio.totalEquity,'0');assert.equal(snapshot.portfolio.totalAvailableBalance,'');assert.equal(snapshot.serverLocks.liveEnabled,false);
globalThis.walletFixture={list:[{accountType:'CONTRACT',totalEquity:'200'}]};await assert.rejects(terminalSnapshot('fixture',{mode:'bybit_live'}),/no Unified account/);
const {POST}=await bundle('app/api/economic-agent/test/route.ts',{
 'next/server':'export const NextResponse={json:(body,init)=>Response.json(body,init)};',
 '@/lib/auth/owner':'export const requireOwnerId=async()=>"fixture";',
 '@/lib/agent/providers':`export const isProviderConfigured=async()=>true;export const getProvider=async()=>({test:async()=>globalThis.authFixture});export const discoverModels=async()=>{globalThis.catalogCalls++;return {models:['fixture-model']};};`,
});
globalThis.catalogCalls=0;globalThis.authFixture={success:false,message:'Invalid API key'};
const request=()=>new Request('https://fixture.test/api/economic-agent/test',{method:'POST',headers:{origin:'https://fixture.test','content-type':'application/json'},body:JSON.stringify({provider:'openrouter',model:'fixture-model'})});
assert.equal((await (await POST(request())).json()).success,false);assert.equal(globalThis.catalogCalls,0);
globalThis.authFixture={success:true};assert.equal((await (await POST(request())).json()).success,true);assert.equal(globalThis.catalogCalls,1);
console.log('PASS: runtime database pooling, explicit pool overrides, missing wallets unavailable, genuine zero retained, unknown totals blank, live execution locked, provider authentication precedes public catalog. No network or transactions.');
