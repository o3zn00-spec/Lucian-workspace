import assert from 'node:assert/strict';
import { build } from 'esbuild';
const output = await build({entryPoints:['src/lib/assistant/chat-turn.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {runChatTurn}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const tool=(name,args={})=>JSON.stringify({lucian_tool:name,arguments:args});
const params={model:'fixture',messages:[{role:'user',content:'Use $10 from my balance on Bybit'}],systemPrompt:'Fixture'};
let calls=0, writes=0;
const reply=await runChatTurn({chat:async p=>{
  calls++;
  if(calls===1)return {content:tool('trading.plan.read')};
  if(calls===2){assert.match(p.messages.at(-1).content,/revision-1/);assert.match(p.messages[0].content,/\$10/);return {content:tool('trading.plan.update',{revision:'revision-1',changes:{capital:'10',mode:'bybit_live'}})};}
  assert.match(p.messages.at(-1).content,/saved/);return {content:'Your $10 budget is saved. Which assets, and one trade or ongoing?'};
}},params,async request=>{const t=JSON.parse(request);if(t.lucian_tool==='trading.plan.read')return JSON.stringify({revision:'revision-1',draft:{rules:{}}});assert.equal(t.arguments.changes.capital,'10');writes++;return 'saved';});
assert.equal(calls,3);assert.equal(writes,1);assert.match(reply,/\$10 budget/);assert.doesNotMatch(reply,/lucian_tool|revision-1/);
let executions=0;
const repeated=await runChatTurn({chat:async()=>({content:tool('trading.plan.read')})},params,async()=>{executions++;return '{}'});
assert.equal(executions,1);assert.match(repeated,/couldn’t finish/);
calls=0;executions=0;
await runChatTurn({chat:async()=>({content:tool('trading.plan.read',{n:++calls})})},params,async()=>{executions++;return '{}'});
assert.equal(calls,4);assert.equal(executions,3);
calls=0;
const failed=await runChatTurn({chat:async()=>{if(++calls===1)return {content:tool('trading.plan.update')};throw Error('429')}},params,async()=> 'saved');
assert.match(failed,/saved draft/);assert.match(failed,/No trading session was started/);
await assert.rejects(runChatTurn({chat:async()=>{throw Error('401')}},params,async()=>''),/401/);
assert.equal(await runChatTurn({chat:async()=>({content:'Hello'})},params,async()=>{throw Error('unexpected')}),'Hello');
console.log('PASS conversational tool continuation, preserved budget, bounded calls, duplicate suppression, post-write failure, ordinary chat.');

for(const content of [JSON.stringify({lilthe_ui:'trade_review',summary:'Verified candidate details. '.repeat(55)}), '\x60\x60\x60json\n'+JSON.stringify({lilthe_ui:'trade_review',summary:'Saved proposal; review required.'})+'\n\x60\x60\x60']){
const result=await runChatTurn({chat:async()=>({content})},params,async()=>{throw Error('unexpected tool')});assert.equal(JSON.parse(result).lilthe_ui,'trade_review');}
const oversized=await runChatTurn({chat:async()=>({content:JSON.stringify({lilthe_ui:'trade_review',summary:'x'.repeat(4001)})})},params,async()=>{});assert.match(oversized,/couldn’t format/);
const unsafe=await runChatTurn({chat:async()=>({content:JSON.stringify({lilthe_ui:'trade_review',summary:'x',execute:true})})},params,async()=>{});assert.match(unsafe,/couldn’t format/);
console.log('PASS longer/fenced review summaries render; oversized and extra-authority fields still rejected.');

// A complete draft reaches review within the unchanged cost bound.
calls=0;executions=0;
const review=await runChatTurn({chat:async p=>{
  calls++;
  if(calls===1)return {content:tool('trading.eligibility.read',{symbols:['XRPUSDT']})};
  if(calls===2){assert.match(p.messages.at(-1).content,/Cross/);return {content:tool('trading.research',{symbols:['XRPUSDT'],category:'linear'})};}
  if(calls===3)return {content:tool('trading.plan.update',{revision:'r1',changes:{strategy:'Use detected settings within saved limits'}})};
  assert.match(p.systemPrompt,/Do not ask permission to continue/);
  return {content:JSON.stringify({lilthe_ui:'trade_review',summary:'Draft ready for server review. No trade started.'})};
}},params,async request=>{executions++;const t=JSON.parse(request);return JSON.stringify(t.lucian_tool==='trading.eligibility.read'?{revision:'r1',quote:{fee:'0.001'},accountEvidence:{marginLabel:'Cross'}}:{status:'complete'});});
assert.equal(calls,4);assert.equal(executions,3);assert.equal(JSON.parse(review).lilthe_ui,'trade_review');
console.log('PASS eligibility/research/draft/review fits three tools without further permission prompts.');
