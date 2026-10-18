import assert from 'node:assert/strict';
import {build} from 'esbuild';
const plan={product:'linear_short',mode:'bybit_live',symbols:['BTCUSDT'],capital:'10',maxOrder:'10',maxLoss:'.50',maxRiskPerTrade:'.25',maxTrades:1,reviewMinutes:5,durationHours:1,maxModelCalls:24,slippageBps:10,strategy:'Use reviewed settings'};
plan.maxLoss='0.50';plan.maxRiskPerTrade='0.25';
const f=globalThis.eligibilityFixture={};
function reset(){Object.assign(f,{auditFail:false,allow:true,reads:[],audits:[],session:null,complete:true,revision:'r1',plan,quoteFail:null,revoke:false,changed:false,profile:{maxOrderUsd:6,maxPositionUsd:10,maxDailyLossUsd:1,maxOpenPositions:1,maxLeverage:10,emergencyStop:false},reservation:null,available:40n*10n**12n,leverage:'10',mode:'mainnet'});}
const mocks={
 'server-only':'',
 '@/lib/db':`const f=globalThis.eligibilityFixture;export const db={assistantActivity:{create:async({data})=>{if(f.auditFail)throw Error('SECRET');f.audits.push(data);}},liveTradeIntent:{findFirst:async()=>f.reservation}};`,
 './tool-access':`export async function tradingReadAllowed(){return globalThis.eligibilityFixture.allow;}export const tradingActivityReadAllowed=tradingReadAllowed;`,
 './trading-plan':`export async function tradingPlanSnapshot(){const f=globalThis.eligibilityFixture;return {revision:f.changed&&f.reads.length?'changed':f.revision,complete:f.complete,missing:['strategy'],draft:{rules:f.plan}};}`,
 '@/lib/bybit/autonomous-session':`export async function autonomousSnapshot(){return {session:globalThis.eligibilityFixture.session};}`,
 '@/lib/bybit/client':`export async function getBybitConfig(){return {configured:true,environment:globalThis.eligibilityFixture.mode,apiKey:'SECRET'};}`,
 '@/lib/bybit/trading':`export async function getTradingProfile(){return globalThis.eligibilityFixture.profile;}`,
 '@/lib/bybit/autonomous-short':`export function assertShortEnabled(){}export async function detectShortAccount(owner,symbols){const f=globalThis.eligibilityFixture;f.reads.push({owner,symbol:symbols[0]});return {marginMode:'REGULAR_MARGIN',positions:{[symbols[0]]:{leverage:f.leverage,positionIdx:0,autoAddMargin:0}}};}export async function shortAvailable(){return globalThis.eligibilityFixture.available;}export async function assertOwnedShortOrders(){}`,
 '@/lib/bybit/autonomous-market':`export const connectionIdentity=c=>c.environment+c.apiKey;export async function autonomousWallet(){return [{coin:'USDT',available:globalThis.eligibilityFixture.available,total:globalThis.eligibilityFixture.available}];}export async function autonomousQuote(owner,symbol){const f=globalThis.eligibilityFixture;if(f.revoke)f.allow=false;if(f.quoteFail===symbol)throw Error('SECRET-VALUE');return {ask:symbol==='BTCUSDT'?'81450':'1',bid:symbol==='BTCUSDT'?'81449':'1',mark:symbol==='BTCUSDT'?'81450':'1',step:symbol==='BTCUSDT'?'0.001':'1',tick:'0.01',minQty:symbol==='BTCUSDT'?'0.001':'1',minNotional:'5',fee:'0.001',atMs:Date.now()};}`,
};
const b=await build({entryPoints:['src/lib/assistant/trading-eligibility.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]}));}}]});
const {readTradingEligibility:read}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
reset();let r=await read('owner-A',{});assert.equal(r.status,'checked');assert.equal(r.results.length,5);assert.equal(r.results[0].status,'blocked');assert.match(r.results[0].reason,/81\./);assert.equal(r.results[1].status,'minimum_size_fits');assert.equal(r.results[1].minimumOrder,'5.03');assert.equal(r.accountLimits.maxOrder,'6');assert.equal(f.reads.every(x=>x.owner==='owner-A'),true);assert.equal(r.financialAction,false);assert.doesNotMatch(JSON.stringify(r),/SECRET/);assert.equal(plan.symbols[0],'BTCUSDT');
for(const args of [{owner:'x'},{symbols:[]},{symbols:['BTCUSDT','BTCUSDT']},{symbols:['../../bad']},{symbols:Array(6).fill('BTCUSDT')}]){reset();assert.equal((await read('owner-A',args)).status,'invalid_request');assert.equal(f.reads.length,0);}
reset();f.allow=false;assert.equal((await read('owner-A',{})).status,'permission_required');assert.equal(f.reads.length,0);
for(const status of ['running','paused','closing','stopped']){reset();f.session={id:'existing',status,active:{quantity:'1'}};assert.equal((await read('owner-A',{})).status,'existing_session');assert.equal(f.reads.length,0);}
reset();f.complete=false;assert.equal((await read('owner-A',{})).status,'incomplete_plan');assert.equal(f.reads.length,0);
reset();f.revoke=true;assert.equal((await read('owner-A',{symbols:['XRPUSDT']})).status,'permission_revoked');
reset();f.changed=true;assert.equal((await read('owner-A',{})).status,'state_changed');
reset();f.quoteFail='XRPUSDT';r=await read('owner-A',{symbols:['XRPUSDT','DOGEUSDT']});assert.equal(r.results[0].status,'unavailable');assert.equal(r.results[1].status,'minimum_size_fits');assert.doesNotMatch(JSON.stringify(r),/SECRET/);
reset();f.leverage='20';assert.equal((await read('owner-A',{symbols:['XRPUSDT']})).results[0].status,'blocked');
reset();f.available=0n;assert.match((await read('owner-A',{symbols:['XRPUSDT']})).results[0].reason,/available/);
reset();f.profile.emergencyStop=true;f.reservation={id:'private'};r=await read('owner-A',{});assert.equal(r.globalBlockers.length,2);assert.doesNotMatch(JSON.stringify(r),/private/);
reset();f.mode='testnet';assert.equal((await read('owner-A',{})).status,'connection_mismatch');assert.equal(f.reads.length,0);
reset();f.auditFail=true;await assert.rejects(()=>read('owner-A',{}));assert.equal(f.reads.length,0);
console.log('PASS bounded eligibility: BTC too large, smaller minimum fits, owner isolation, permissions/revocation, active sessions, unknown data, unchanged draft/limits, state races, global blockers and redacted failures. No exchange writes.');
