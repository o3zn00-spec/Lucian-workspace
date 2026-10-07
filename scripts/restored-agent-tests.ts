import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {PrismaClient} from "@prisma/client";
async function main(){
 const database=new URL(process.env.DATABASE_URL!);assert(["localhost","127.0.0.1"].includes(database.hostname)&&database.pathname==="/lucian_restoration_dev_20261007");
 const base="http://127.0.0.1:43183",db=new PrismaClient(),cookies=new Map<string,string>();
 const receive=(r:Response)=>{for(const c of r.headers.getSetCookie()){const p=c.split(";")[0],n=p.indexOf("=");cookies.set(p.slice(0,n),p.slice(n+1));}};
 const header=()=>[...cookies].map(([k,v])=>`${k}=${v}`).join("; ");
 const paths=["/api/assistant/restored","/api/health/ai-probe?provider=custom","/api/user/agent-memory","/api/ai/models?provider=custom"];
 for(const p of paths)assert([401,403].includes((await fetch(base+p)).status));
 const csrf=await fetch(base+"/api/auth/csrf");receive(csrf);const token=(await csrf.json()).csrfToken;
 const login=await fetch(base+"/api/auth/callback/credentials",{method:"POST",redirect:"manual",headers:{"Content-Type":"application/x-www-form-urlencoded",Cookie:header(),Origin:base},body:new URLSearchParams({csrfToken:token,username:process.env.LUCIAN_OWNER_EMAIL!,password:process.env.LUCIAN_OWNER_PASSWORD!,callbackUrl:base})});receive(login);
 async function call(path:string,body?:unknown,method=body?"POST":"GET",origin=base){const r=await fetch(base+path,{method,headers:{Cookie:header(),Origin:origin,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
 const owner=(await db.user.findUniqueOrThrow({where:{email:process.env.LUCIAN_OWNER_EMAIL}})).id;
 const profile=await db.assistantProfile.findUnique({where:{userId:owner}}),id=randomUUID(),outsider=randomUUID(),foreign=randomUUID();
 try{
 const conversation={id,title:"Disposable restored integration",pinned:false,archived:false,messages:[{id:randomUUID(),role:"user",content:"Local test",fromModel:false}]};
 const first=await call(paths[0],{id,conversation});assert.equal(first.status,200);
 assert.equal((await call(paths[0],{id,conversation})).status,409);
 const changed=await call(paths[0],{id,conversation:{...conversation,title:"Renamed",pinned:true,archived:true},baseVersion:first.data.serverVersion});assert.equal(changed.status,200);
 const snapshot=await call(paths[0]);const saved=snapshot.data.conversations.find((c:{id:string})=>c.id===id);assert.equal(saved.title,"Renamed");assert.equal(saved.pinned,true);assert.equal(saved.archived,true);assert.equal(saved.messages.length,1);
 assert.equal((await call(paths[0],{action:"activate",id})).status,200);
 assert.equal((await call(paths[0],{id,conversation,baseVersion:changed.data.serverVersion},"POST","https://untrusted.example")).status,403);
 await db.user.create({data:{id:outsider,username:`test-${outsider}`,email:`${outsider}@example.test`}});await db.assistantConversation.create({data:{id:foreign,userId:outsider,title:"Foreign"}});
 for(const action of ["activate","delete"])assert.equal((await call(paths[0],{id:foreign,action})).status,404);
 assert.equal((await call(paths[0],{id:foreign,conversation:{...conversation,id:foreign}})).status,404);
 assert.equal((await call(paths[1])).data.configured,true);
 const response=await call("/api/ai/chat",{provider:"custom",model:"local-fixture-model",messages:[{role:"user",content:"Local transport check"}],systemPrompt:"Test fixture",stream:false});assert.equal(response.status,200);assert.match(response.data.content,/Local mock reply/);
 assert.equal((await call("/api/ai/chat",{provider:"custom",model:"local-fixture-model",messages:[{role:"system",content:"Forbidden client role"}]})).status,400);
 const image={url:`data:image/png;base64,${(await readFile("public/branding/icon-32.png")).toString("base64")}`};
 const imageRequest={provider:"custom",model:"local-fixture-model",messages:[{role:"user",content:"Review screenshot",images:[image]}],behavior:{rememberConversations:false}};
 const vision=await call("/api/ai/chat",imageRequest);assert.equal(vision.status,200);assert.match(vision.data.content,/Image payload received: 1/);
 for(const invalid of [{url:"https://example.test/image.png"},{url:"data:image/png;base64,aGVsbG8="},{url:"data:image/svg+xml;base64,PHN2Zz4="}])assert.equal((await call("/api/ai/chat",{...imageRequest,messages:[{role:"user",content:"Test",images:[invalid]}]})).status,400);
 assert.equal((await call("/api/ai/chat",{...imageRequest,messages:[{role:"assistant",content:"Invalid",images:[image]}]})).status,400);
 assert.equal((await call("/api/ai/chat",{...imageRequest,messages:[{role:"user",content:"Too many",images:Array(9).fill(image)}]})).status,400);
 assert.equal((await call("/api/ai/chat",{...imageRequest,provider:"deepseek",model:"deepseek-chat"})).status,400);
 const checked=await call("/api/economic-agent/test",{provider:"custom",model:"local-fixture-model"});assert.equal(checked.status,200);assert.equal(checked.data.modelListed,true);assert.equal(checked.data.inferenceVerified,false);
 const missing=await call("/api/economic-agent/test",{provider:"custom",model:"not-listed"});assert.equal(missing.data.modelListed,false);assert.equal(missing.data.inferenceVerified,false);
 assert.equal((await call("/api/ai/models?provider=custom")).status,200);
 assert.equal((await call("/api/ai/models?provider=invalid")).status,400);
 assert.equal((await call("/api/ai/chat",{provider:"custom",model:"local-fixture-model",reasoningEffort:"invalid",messages:[{role:"user",content:"Test"}]})).status,400);
 const preview={id:"fixture-image",name:"Screenshot.png",url:"data:image/png;base64,aGVsbG8="};
 const withImage=await call(paths[0],{id,conversation:{...conversation,messages:[{...conversation.messages[0],attachments:[preview]}]},baseVersion:changed.data.serverVersion});assert.equal(withImage.status,200);
 const imageSnapshot=await call(paths[0]);assert.equal(imageSnapshot.data.conversations.find((c:{id:string})=>c.id===id).messages[0].attachments[0].url,preview.url);
 const bulk=await call(paths[0],{id,baseVersion:withImage.data.serverVersion,conversation:{...conversation,messages:Array.from({length:100},(_,n)=>({id:randomUUID(),role:"user",content:`Disposable bulk ${n}`,fromModel:false}))}});assert.equal(bulk.status,200);
 const retained=(await call(paths[0])).data.conversations.find((c:{id:string})=>c.id===id).messages.map((m:{id:string})=>m.id);
 const delta=await call(paths[0],{id,baseVersion:bulk.data.serverVersion,retainedMessageIds:retained,conversation:{...conversation,messages:[]}});assert.equal(delta.status,200);assert.equal((await call(paths[0])).data.conversations.find((c:{id:string})=>c.id===id).messages.length,100);
 const badImage=await call(paths[0],{id,baseVersion:bulk.data.serverVersion,conversation:{...conversation,messages:[{...conversation.messages[0],attachments:[{...preview,url:"https://untrusted.example/image"}]}]}});assert.equal(badImage.status,400);

 assert.equal((await call("/api/ai/chat",{provider:"custom",model:"local-fixture-model",messages:[{role:"user",content:"Test"}]},"POST","https://untrusted.example")).status,403);
 assert.equal((await call("/api/economic-agent/test",{provider:"not-a-provider",model:"x"})).status,400);
 const memory=await call(paths[2],{scope:"personal",key:`test-${id}`,value:"Disposable memory"},"PUT");assert.equal(memory.status,200);assert((await call(paths[2])).data.entries.some((e:{id:string})=>e.id===memory.data.entry.id));
 assert.equal((await call(paths[2]+`?id=${memory.data.entry.id}`,undefined,"DELETE")).status,200);
 assert.equal((await call(paths[0],{action:"delete",id})).status,200);assert(!(await call(paths[0])).data.conversations.some((c:{id:string})=>c.id===id));assert((await db.assistantConversation.findUniqueOrThrow({where:{id}})).deletedAt);
 console.log("PASS: restored owner isolation, revision conflicts, rename/pin/archive, deduped messages, soft deletion, memory CRUD, provider discovery, reasoning validation, persisted image metadata, batch/delta saves, origin/input checks and local mock chat round trip.");
 }finally{await db.assistantConversation.deleteMany({where:{id,userId:owner}});await db.assistantMemory.deleteMany({where:{userId:owner,key:`personal:test-${id}`}});await db.user.deleteMany({where:{id:outsider}});if(profile)await db.assistantProfile.update({where:{userId:owner},data:{activeConversationId:profile.activeConversationId}});await db.$disconnect();}
}
main().catch(e=>{console.error(e?.code==="ERR_ASSERTION"?e.message:"Restored integration failed; inspect local diagnostics without exposing credentials.");process.exitCode=1;});
