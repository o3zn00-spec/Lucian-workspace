import assert from 'node:assert/strict';
import { build } from 'esbuild';
const events=[];
globalThis.chatToolEvents=events;
let reply='ordinary reply';
globalThis.chatToolReply=()=>reply;
globalThis.chatToolOwner='owner-fixture';
globalThis.chatToolAuditFail=false;
globalThis.toolPermissions=new Map();
globalThis.savedQueries=[];
globalThis.savedReadFail=false;
const mocks={
 'server-only':'',
 'next/server':'export const NextResponse={json:(body,init)=>Response.json(body,init)};',
 '@/lib/db':`const memory={findMany:async()=>[],findUnique:async({where})=>({value:globalThis.toolPermissions.get(where.userId_key.userId)??'deny'}),upsert:async({where,update})=>{globalThis.toolPermissions.set(where.userId_key.userId,update.value);return update;}};const activity={create:async({data})=>{if(globalThis.chatToolAuditFail)throw Error('Audit unavailable');globalThis.chatToolEvents.push(data);return data;},findMany:async({where})=>globalThis.chatToolEvents.filter(e=>e.userId===where.userId)};export const db={assistantMemory:memory,assistantActivity:activity,savedItem:{findMany:async(query)=>{globalThis.savedQueries.push(query);if(globalThis.savedReadFail)throw Error('Read unavailable');return [{title:'Example saved favorite',source:'news',type:'article',createdAt:new Date('2026-10-07')}] }},$transaction:async(fn)=>fn({assistantMemory:memory,assistantActivity:activity})};`,
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
assert.equal(globalThis.toolPermissions.get('owner-fixture'),'allow');
assert.equal((await accessAPI.PUT(permissionRequest({savedRead:false}))).status,200);
assert.equal((await (await accessAPI.GET()).json()).savedRead,false);
const {assistantCommand}=await bundle('src/lib/assistant/service.ts');
await assert.rejects(assistantCommand('owner-A',{action:'memory',key:'_tool_permission:saved.read',value:'allow'}),/tool permissions/);
globalThis.chatToolAuditFail=true;
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
console.log('PASS: model chat invokes audited app utilities; validated navigation; unknown/financial/file tools denied; owner spoofing and arbitrary URLs rejected; audit failure closes access; normal replies preserved; streaming resolves tool envelopes; auth/origin checked. Saved reads require owner grant, revoke immediately, select bounded metadata only, isolate owners and report failures; permission API enforces owner/origin/schema; memory cannot grant tool access. No network or paid inference.');
