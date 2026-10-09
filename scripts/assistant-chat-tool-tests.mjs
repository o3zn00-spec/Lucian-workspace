import assert from 'node:assert/strict';
import { build } from 'esbuild';
const events=[];
globalThis.chatToolEvents=events;
let reply='ordinary reply';
globalThis.chatToolReply=()=>reply;
globalThis.chatToolOwner='owner-fixture';
globalThis.chatToolAuditFail=false;
globalThis.toolPermissions=new Map();
globalThis.permissionQueries=[];
globalThis.savedQueries=[];
globalThis.savedReadFail=false;
globalThis.bybitCalls=[];
globalThis.bybitFixture={list:[{accountType:"UNIFIED",totalEquity:"0",totalWalletBalance:"0",totalAvailableBalance:"",coin:[]}]};
globalThis.bybitConfigured=true;
globalThis.bybitFailure=false;
globalThis.bybitRevoke=false;
globalThis.activityFixtures=null;
globalThis.activityFailure=null;
globalThis.activityRevoke=false;
const mocks={
 'server-only':'',
 'next/server':'export const NextResponse={json:(body,init)=>Response.json(body,init)};',
 '@/lib/db':`const memory={findMany:async(query)=>{if(!query?.where?.key?.in)return [];globalThis.permissionQueries.push(query);return query.where.key.in.map(key=>({key,value:globalThis.toolPermissions.get(query.where.userId+':'+key)??'deny'}));},findUnique:async({where})=>({value:globalThis.toolPermissions.get(where.userId_key.userId+':'+where.userId_key.key)??(where.userId_key.key.endsWith('saved.read')?globalThis.toolPermissions.get(where.userId_key.userId):null)??'deny'}),upsert:async({where,update})=>{globalThis.toolPermissions.set(where.userId_key.userId+':'+where.userId_key.key,update.value);return update;}};const activity={create:async({data})=>{if(globalThis.chatToolAuditFail)throw Error('Audit unavailable');globalThis.chatToolEvents.push(data);return data;},findMany:async({where})=>globalThis.chatToolEvents.filter(e=>e.userId===where.userId)};export const db={assistantMemory:memory,assistantActivity:activity,savedItem:{findMany:async(query)=>{globalThis.savedQueries.push(query);if(globalThis.savedReadFail)throw Error('Read unavailable');return [{title:'Example saved favorite',source:'news',type:'article',createdAt:new Date('2026-10-07')}] }},$transaction:async(fn)=>fn({assistantMemory:memory,assistantActivity:activity})};`,
 '@/lib/bybit/client':`export class BybitApiError extends Error {} export const getBybitConfig=async()=>({environment:'mainnet',configured:globalThis.bybitConfigured,apiKey:'SECRET-KEY',apiSecret:'SECRET-VALUE'});export const bybitRequest=async(...args)=>{globalThis.bybitCalls.push(args);if(globalThis.bybitRevoke)globalThis.toolPermissions.set(args[0]+':_tool_permission:trading.read','deny');if(globalThis.bybitFailure)throw Error('SECRET-VALUE');if(globalThis.activityFixtures&&args[1]!=='/v5/account/wallet-balance'){const key=args[1]+':'+args[2].query.category;if(globalThis.activityRevoke)globalThis.toolPermissions.set(args[0]+':_tool_permission:trading.activity.read','deny');if(globalThis.activityFailure===key)throw Error('SECRET-VALUE');return globalThis.activityFixtures[key];}return globalThis.bybitFixture;};`,
 '@/lib/auth/owner':`import {AuthError} from '@/lib/auth/errors';export const requireOwnerId=async()=>{if(!globalThis.chatToolOwner)throw new AuthError('unauthorized','Owner required',403);return globalThis.chatToolOwner;};`,
 '@/lib/agent/providers':`export const isProviderConfigured=async()=>true;export const getProvider=async()=>({chat:async(params)=>{globalThis.lastChatParameters=params;return {content:globalThis.chatToolReply(),fromModel:true};}});`,
};
async function bundle(entry){
 const r=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));}}]});
 return import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0].text).toString('base64')}`);
}
const {resolveChatTool}=await bundle('src/lib/assistant/chat-tools.ts');
assert.equal(await resolveChatTool('owner-A','Hello.'),'Hello.');assert.equal(events.length,0);
assert.equal(await resolveChatTool('owner-A','{"other":"data"}'),' {"other":"data"}'.trim());
const nav=await resolveChatTool('owner-A',JSON.stringify({lucian_tool:'app.navigate',arguments:{module:'markets'}}));
assert.match(nav,/\[Markets\]\(\/markets\)/);assert.equal(events.at(-1).userId,'owner-A');assert.equal(events.at(-1).status,'completed');
for(const p of [
 {lucian_tool:'trading.execute',arguments:{}},
 {lucian_tool:'workspace.edit',arguments:{}},
 {lucian_tool:'app.navigate',arguments:{module:'markets',url:'https://evil.test'}},
 {lucian_tool:'app.navigate',arguments:{module:'../settings'}},
 {lucian_tool:'app.capabilities',arguments:{ownerUserId:'owner-B'}},
 {lucian_tool:'app.capabilities',arguments:{},ownerUserId:'owner-B'},
 {lucian_tool:'app.capabilities',arguments:null},
]){assert.match(await resolveChatTool('owner-A',JSON.stringify(p)),/unavailable/);assert.equal(events.at(-1).status,'denied');assert.equal(events.at(-1).userId,'owner-A');}
assert.match(await resolveChatTool('owner-A',JSON.stringify({lucian_tool:'trading.setup',arguments:{}})),/paperSetup=1/);
assert.match(await resolveChatTool('owner-A',JSON.stringify({lucian_tool:'trading.setup',arguments:{mode:'live'}})),/unavailable/);
const savedEnvelope=JSON.stringify({lucian_tool:'saved.read',arguments:{}});
assert.match(await resolveChatTool('owner-A',savedEnvelope),/access is off/);
assert.equal(globalThis.savedQueries.length,0);
globalThis.toolPermissions.set('owner-A','allow');
assert.match(await resolveChatTool('owner-A',savedEnvelope),/Example saved favorite/);
assert.equal(globalThis.savedQueries.at(-1).where.userId,'owner-A');
assert.equal(globalThis.savedQueries.at(-1).take,12);
assert.deepEqual(Object.keys(globalThis.savedQueries.at(-1).select).sort(),['createdAt','source','title','type']);
assert.equal(events.at(-2).status,'started');assert.equal(events.at(-1).status,'completed');
assert.match(await resolveChatTool('owner-B',savedEnvelope),/access is off/);
const readCount=globalThis.savedQueries.length;
assert.match(await resolveChatTool('owner-A',JSON.stringify({lucian_tool:'saved.read',arguments:{ownerUserId:'owner-B'}})),/unavailable/);
assert.equal(globalThis.savedQueries.length,readCount);
globalThis.savedReadFail=true;assert.match(await resolveChatTool('owner-A',savedEnvelope),/could not be read/);assert.equal(events.at(-1).status,'failed');globalThis.savedReadFail=false;
globalThis.toolPermissions.set('owner-A','deny');assert.match(await resolveChatTool('owner-A',savedEnvelope),/access is off/);
const accessAPI=await bundle('app/api/assistant/tools/route.ts');
process.env.AUTH_APP_URL='https://fixture.test';
const permissionRequest=(body,origin='https://fixture.test')=>new Request('https://fixture.test/api/assistant/tools',{method:'PUT',headers:{origin},body:JSON.stringify(body)});
assert.equal((await accessAPI.PUT(permissionRequest({savedRead:true},'https://evil.test'))).status,403);
assert.equal((await accessAPI.PUT(permissionRequest({savedRead:true,ownerUserId:'owner-B'}))).status,400);
assert.equal((await accessAPI.PUT(permissionRequest({savedRead:true}))).status,200);
assert.equal((await (await accessAPI.GET()).json()).savedRead,true);
assert.equal(globalThis.toolPermissions.get('owner-fixture:_tool_permission:saved.read'),'allow');
assert.equal((await accessAPI.PUT(permissionRequest({savedRead:false}))).status,200);
assert.equal((await (await accessAPI.GET()).json()).savedRead,false);
assert.equal((await accessAPI.PUT(permissionRequest({tradingRead:true}))).status,200);
assert.equal((await (await accessAPI.GET()).json()).tradingRead,true);
assert.equal((await accessAPI.PUT(permissionRequest({tradingRead:false}))).status,200);
assert.equal((await (await accessAPI.GET()).json()).tradingRead,false);
for(const permission of ['recordsRead','workspaceRead']) {
 assert.equal((await accessAPI.PUT(permissionRequest({[permission]:true}))).status,200);
 assert.equal((await (await accessAPI.GET()).json())[permission],true);
 assert.equal((await accessAPI.PUT(permissionRequest({[permission]:false}))).status,200);
 assert.equal((await accessAPI.PUT(permissionRequest({[permission]:'true'}))).status,400);
}
const beforeSnapshot=globalThis.permissionQueries.length;
assert.equal((await accessAPI.GET()).status,200);
assert.equal(globalThis.permissionQueries.length,beforeSnapshot+1);
assert.equal(globalThis.permissionQueries.at(-1).where.userId,'owner-fixture');
assert.equal(globalThis.permissionQueries.at(-1).take,5);
assert.deepEqual(globalThis.permissionQueries.at(-1).select,{key:true,value:true});
assert.equal(globalThis.permissionQueries.at(-1).where.key.in.length,5);
const tradingEnvelope=JSON.stringify({lucian_tool:'trading.read',arguments:{}});
assert.match(await resolveChatTool('owner-A',tradingEnvelope),/access is off/);
assert.equal(globalThis.bybitCalls.length,0);
globalThis.toolPermissions.set('owner-A:_tool_permission:trading.read','allow');
let balance=await resolveChatTool('owner-A',tradingEnvelope);
assert.match(balance,/Total equity \(USD\): 0/);assert.match(balance,/Available balance.*Unavailable/);assert.match(balance,/Mainnet/);assert.doesNotMatch(balance,/SECRET/);
assert.deepEqual(globalThis.bybitCalls.at(-1).slice(0,3),['owner-A','/v5/account/wallet-balance',{method:'GET',query:{accountType:'UNIFIED'}}]);
assert.equal(events.at(-2).status,'started');assert.equal(events.at(-1).status,'completed');
globalThis.bybitFixture={list:[{accountType:'UNIFIED',totalEquity:'12.5',coin:Array.from({length:15},()=>({coin:'BTC',walletBalance:'1',equity:'1',usdValue:'12.5',apiKey:'SECRET-KEY'}))}]};
balance=await resolveChatTool('owner-A',tradingEnvelope);assert.equal((balance.match(/- BTC:/g)??[]).length,12);assert.doesNotMatch(balance,/SECRET/);
const before=globalThis.bybitCalls.length;
assert.match(await resolveChatTool('owner-B',tradingEnvelope),/access is off/);
assert.match(await resolveChatTool('owner-A',JSON.stringify({lucian_tool:'trading.read',arguments:{environment:'testnet'}})),/unavailable/);
assert.equal(globalThis.bybitCalls.length,before);
globalThis.bybitFixture={list:[]};assert.match(await resolveChatTool('owner-A',tradingEnvelope),/could not be verified/);assert.equal(events.at(-1).status,'failed');
globalThis.bybitFailure=true;balance=await resolveChatTool('owner-A',tradingEnvelope);assert.match(balance,/no zero balance is confirmed/);assert.doesNotMatch(balance,/SECRET/);globalThis.bybitFailure=false;
globalThis.bybitConfigured=false;assert.match(await resolveChatTool('owner-A',tradingEnvelope),/not configured/);globalThis.bybitConfigured=true;
globalThis.bybitRevoke=true;assert.match(await resolveChatTool('owner-A',tradingEnvelope),/revoked/);assert.equal(events.at(-1).status,'denied');globalThis.bybitRevoke=false;
// Order/position reads have an independent, default-off permission.
assert.equal((await (await accessAPI.GET()).json()).tradingActivityRead,false);
assert.equal((await accessAPI.PUT(permissionRequest({tradingActivityRead:true}))).status,200);
assert.equal((await (await accessAPI.GET()).json()).tradingActivityRead,true);
assert.equal((await accessAPI.PUT(permissionRequest({tradingActivityRead:false}))).status,200);
assert.equal((await accessAPI.PUT(permissionRequest({tradingActivityRead:'true'}))).status,400);
assert.equal((await accessAPI.PUT(permissionRequest({tradingActivityRead:true,tradingRead:true}))).status,400);
const activityEnvelope=JSON.stringify({lucian_tool:'trading.activity.read',arguments:{}});
let callCount=globalThis.bybitCalls.length;
assert.match(await resolveChatTool('owner-A',activityEnvelope),/access is off/);
assert.equal(globalThis.bybitCalls.length,callCount);
globalThis.toolPermissions.set('owner-A:_tool_permission:trading.activity.read','allow');
globalThis.activityFixtures={
 '/v5/order/realtime:spot':{list:[{symbol:'BTCUSDT',side:'Buy',orderType:'Limit',orderStatus:'New',qty:'0.1',price:'50000',cumExecQty:'0',leavesQty:'0.1',orderId:'SECRET-KEY'}]},
 '/v5/order/realtime:linear':{list:[]},
 '/v5/position/list:linear':{list:[{symbol:'ETHUSDT',side:'Buy',size:'1',avgPrice:'2000',unrealisedPnl:'-1.5',leverage:'2',stopLoss:'',takeProfit:'0'}]},
};
let activity=await resolveChatTool('owner-A',activityEnvelope);
assert.match(activity,/All three requested reads succeeded/);assert.match(activity,/filled quantity 0/);assert.match(activity,/unrealized P\/L -1.5/);assert.match(activity,/stop loss Unavailable/);assert.doesNotMatch(activity,/SECRET/);
assert.deepEqual(globalThis.bybitCalls.slice(-3).map(c=>c.slice(0,3)),[
 ['owner-A','/v5/order/realtime',{method:'GET',query:{category:'spot',openOnly:0,limit:50}}],
 ['owner-A','/v5/order/realtime',{method:'GET',query:{category:'linear',settleCoin:'USDT',openOnly:0,limit:50}}],
 ['owner-A','/v5/position/list',{method:'GET',query:{category:'linear',settleCoin:'USDT',limit:50}}],
]);
assert.equal(events.at(-1).status,'completed');assert.doesNotMatch(events.at(-1).reason,/ETHUSDT|2000/);
callCount=globalThis.bybitCalls.length;
assert.match(await resolveChatTool('owner-B',activityEnvelope),/access is off/);
assert.match(await resolveChatTool('owner-A',JSON.stringify({lucian_tool:'trading.activity.read',arguments:{category:'inverse'}})),/unavailable/);
assert.equal(globalThis.bybitCalls.length,callCount);
globalThis.activityFixtures['/v5/order/realtime:spot'].nextPageCursor='SECRET-CURSOR';
activity=await resolveChatTool('owner-A',activityEnvelope);assert.match(activity,/Partial snapshot/);assert.doesNotMatch(activity,/SECRET/);assert.equal(events.at(-1).status,'failed');
globalThis.activityFixtures['/v5/order/realtime:spot']={list:Array.from({length:15},()=>({symbol:'BTCUSDT',side:'Buy',qty:'1'}))};
activity=await resolveChatTool('owner-A',activityEnvelope);assert.equal((activity.match(/- BTCUSDT/g)??[]).length,12);assert.match(activity,/Partial snapshot/);
globalThis.activityFailure='/v5/position/list:linear';
activity=await resolveChatTool('owner-A',activityEnvelope);assert.match(activity,/USDT linear positions\nUnavailable/);assert.match(activity,/Incomplete snapshot/);assert.doesNotMatch(activity,/SECRET/);
globalThis.activityFailure=null;globalThis.activityFixtures['/v5/position/list:linear']={list:[null]};
assert.match(await resolveChatTool('owner-A',activityEnvelope),/invalid data/);
globalThis.bybitConfigured=false;callCount=globalThis.bybitCalls.length;
assert.match(await resolveChatTool('owner-A',activityEnvelope),/not configured/);assert.equal(globalThis.bybitCalls.length,callCount);globalThis.bybitConfigured=true;
globalThis.activityRevoke=true;assert.match(await resolveChatTool('owner-A',activityEnvelope),/revoked/);assert.equal(events.at(-1).status,'denied');globalThis.activityRevoke=false;
globalThis.toolPermissions.set('owner-A:_tool_permission:trading.activity.read','allow');
globalThis.chatToolAuditFail=true;callCount=globalThis.bybitCalls.length;
await assert.rejects(resolveChatTool('owner-A',activityEnvelope),/Audit unavailable/);assert.equal(globalThis.bybitCalls.length,callCount);globalThis.chatToolAuditFail=false;
const {assistantCommand}=await bundle('src/lib/assistant/service.ts');
await assert.rejects(assistantCommand('owner-A',{action:'memory',key:'_tool_permission:saved.read',value:'allow'}),/tool permissions/);
await assert.rejects(assistantCommand('owner-A',{action:'memory',key:'_paper_session:plan',value:'allow'}),/tool permissions/);
globalThis.toolPermissions.set('owner-A:_tool_permission:trading.read','allow');
globalThis.chatToolAuditFail=true;
const beforeAudit=globalThis.bybitCalls.length;
await assert.rejects(resolveChatTool('owner-A',tradingEnvelope),/Audit unavailable/);assert.equal(globalThis.bybitCalls.length,beforeAudit);
await assert.rejects(resolveChatTool('owner-A','{"lucian_tool":"app.navigate","arguments":{"module":"markets"}}'),/Audit unavailable/);
globalThis.chatToolAuditFail=false;
const {POST}=await bundle('app/api/ai/chat/route.ts');
process.env.AUTH_APP_URL='https://fixture.test';
const request=(origin='https://fixture.test',stream=false)=>new Request('https://fixture.test/api/ai/chat',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({provider:'openrouter',model:'fixture',messages:[{role:'user',content:'Open Markets'}],behavior:{rememberConversations:false},stream})});
reply='{"lucian_tool":"app.navigate","arguments":{"module":"markets"}}';
let res=await POST(request());assert.equal(res.status,200);assert.match((await res.json()).content,/\[Markets\]\(\/markets\)/);
assert.match(globalThis.lastChatParameters.systemPrompt,/SERVER APP TOOLS/);
reply='{"lucian_tool":"trading.execute","arguments":{}}';
res=await POST(request('https://fixture.test',true));const stream=await res.text();assert.match(stream,/unavailable/);assert.doesNotMatch(stream,/lucian_tool/);
assert.equal((await POST(request('https://evil.test'))).status,403);
globalThis.chatToolOwner=null;assert.equal((await POST(request())).status,403);assert.equal((await accessAPI.PUT(permissionRequest({savedRead:true}))).status,403);
console.log('PASS: Independent bounded spot/USDT linear order/position reads, partial pagination, invalid rows, per-query failure, revocation and audit checks.  model chat invokes audited app utilities; validated navigation; unknown/financial/edit tools denied; owner spoofing and arbitrary URLs rejected; audit failure closes access; normal replies preserved; streaming resolves tool envelopes; auth/origin checked. Saved reads require owner grant, revoke immediately, select bounded metadata only, isolate owners and report failures; permission API enforces owner/origin/schema; memory cannot grant tool access. Bybit balances require separate owner permission, bounded fixed GET, owner isolation, distinguish unavailable from zero, redact unexpected fields/errors, reject missing accounts and suppress in-flight revoked results. No network or paid inference.');
