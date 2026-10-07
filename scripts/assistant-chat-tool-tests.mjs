import assert from 'node:assert/strict';
import { build } from 'esbuild';
const events=[];
globalThis.chatToolEvents=events;
let reply='ordinary reply';
globalThis.chatToolReply=()=>reply;
globalThis.chatToolOwner='owner-fixture';
globalThis.chatToolAuditFail=false;
const mocks={
 'server-only':'',
 'next/server':'export const NextResponse={json:(body,init)=>Response.json(body,init)};',
 '@/lib/db':`export const db={assistantMemory:{findMany:async()=>[]},assistantActivity:{create:async({data})=>{if(globalThis.chatToolAuditFail)throw Error('Audit unavailable');globalThis.chatToolEvents.push(data);return data;}}};`,
 '@/lib/auth/owner':`export const requireOwnerId=async()=>{if(!globalThis.chatToolOwner)throw Error('Owner required');return globalThis.chatToolOwner;};`,
 '@/lib/agent/providers':`export const isProviderConfigured=async()=>true;export const getProvider=async()=>({chat:async(params)=>{globalThis.lastChatParameters=params;return {content:globalThis.chatToolReply(),fromModel:true};}});`,
};
async function bundle(entry){
 const r=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]}));}}]});
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
globalThis.chatToolOwner=null;assert.equal((await POST(request())).status,403);
console.log('PASS: model chat invokes audited app utilities; validated navigation; unknown/financial/file tools denied; owner spoofing and arbitrary URLs rejected; audit failure closes access; normal replies preserved; streaming resolves tool envelopes; auth/origin checked. No network or paid inference.');
