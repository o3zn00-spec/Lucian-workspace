import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
// Exercise production adapters with an in-memory credential reader and intercepted
// fetch. Never contact an external model or read real owner credentials.
const bundled=await build({entryPoints:['src/lib/agent/providers.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'isolated-credentials',setup(b){b.onResolve({filter:/owner-credentials$/},()=>({path:'credentials',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export async function readOwnerCredential(){return undefined;}'}));}}]});
const {getProvider}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const image={url:`data:image/png;base64,${(await readFile('public/branding/icon-32.png')).toString('base64')}`};
let calls=[];
globalThis.fetch=async(url,init={})=>{calls.push({url:String(url),...init,body:init.body?JSON.parse(init.body):undefined});return Response.json({candidates:[{content:{parts:[{text:'First'},{text:'Second'}]}}],content:[{type:'text',text:'First'},{type:'text',text:'Second'}],choices:[{message:{content:'First'}}],data:[{id:'fixture'}]});};
for(const [provider,key] of [['gemini','GEMINI_API_KEY'],['openai','OPENAI_API_KEY'],['anthropic','ANTHROPIC_API_KEY'],['openrouter','OPENROUTER_API_KEY'],['deepseek','DEEPSEEK_API_KEY'],['custom','CUSTOM_AI_API_KEY']]){
 process.env[key]='disposable-fixture';process.env.CUSTOM_AI_BASE_URL='http://127.0.0.1/mock';
 const adapter=await getProvider(provider);assert(adapter);
 calls=[];const reply=await adapter.chat({model:provider==='openai'?'o3':'fixture',messages:[{role:'user',content:'Inspect screenshot',images:[image]}],reasoningEffort:'high'});assert(reply.content);
 const request=calls[0];assert.equal(calls.length,1);assert(!request.url.includes('disposable-fixture'));assert(request.signal);
 if(provider==='gemini'){assert.equal(request.body.contents[0].parts[1].inlineData.mimeType,'image/png');assert.equal(reply.content,'First\nSecond');assert.equal(request.headers['x-goog-api-key'],'disposable-fixture');}
 else if(provider==='anthropic'){assert.equal(request.body.messages[0].content[1].source.media_type,'image/png');assert.equal(reply.content,'First\nSecond');}
 else {assert.equal(request.body.messages[0].content[1].image_url.url,image.url);if(provider==='openai'){assert.equal(request.body.reasoning_effort,'high');assert(!('temperature' in request.body));}}
 calls=[];assert.equal((await adapter.test()).success,true);assert.equal(calls.length,1);assert.equal(calls[0].method??'GET','GET');assert(calls[0].url.endsWith('/models'));assert(!calls[0].body);
}
console.log('PASS: six provider payloads, image content, reasoning, combined text, secret-free URLs and read-only connection checks. No network or paid inference.');
const storeBundle=await build({entryPoints:['src/store/economic-agent.ts'],bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent'});
const {conversationWindow}=await import(`data:text/javascript;base64,${Buffer.from(storeBundle.outputFiles[0].text).toString('base64')}`);
const history=conversationWindow({messages:[{id:'old',role:'user',content:'Earlier image',attachments:[image]},{id:'reply',role:'assistant',content:'Earlier reply'},{id:'latest',role:'user',content:'Latest image',attachments:[image]},{id:'pending',role:'assistant',content:'',status:'streaming'}]});
assert.equal(history.messages.length,3);assert(!history.messages[0].images);assert.equal(history.messages[2].images[0].url,image.url);
const {discoverModels}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
calls=[];globalThis.fetch=async(url,init)=>{calls.push({url:String(url),...init});return Response.json(calls.length===1?{models:[{name:'models/gemini-fixture',supportedGenerationMethods:['generateContent']}],nextPageToken:'page-two'}:{models:[{name:'models/gemini-fixture',supportedGenerationMethods:['generateContent']},{name:'models/embedding',supportedGenerationMethods:['embedContent']},{name:'models/gemini-second',supportedGenerationMethods:['generateContent']}]});};
const catalog=await discoverModels('gemini','disposable-owner');assert.deepEqual(catalog.models,['gemini-fixture','gemini-second']);assert.equal(catalog.complete,true);assert.equal(calls.length,2);assert(calls[1].url.includes('pageToken=page-two'));assert(calls.every(c=>!c.url.includes('disposable-fixture')));
console.log('PASS: latest image batch survives history/retry window; catalog pagination deduplicates and excludes embedding models.');

const capabilityBundle=await build({entryPoints:['src/lib/agent/model-capabilities.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {imageSupport}=await import(`data:text/javascript;base64,${Buffer.from(capabilityBundle.outputFiles[0].text).toString('base64')}`);
assert.equal(imageSupport('openai','o3-mini'),'unsupported');assert.equal(imageSupport('openrouter','openai/o3-mini'),'unsupported');assert.equal(imageSupport('openai','gpt-4o-audio-preview'),'unverified');assert.equal(imageSupport('gemini','gemini-embedding-001'),'unsupported');assert.equal(imageSupport('openai','gpt-4o-mini'),'supported');
console.log('PASS: text-only reasoning and audio/embedding variants do not inherit image support.');
