import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['src/lib/chat/interaction.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {parseChatInteraction:parse}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const question={lilthe_ui:'question',question:'Which duration?',options:['Today','One week']};
assert.deepEqual(parse(JSON.stringify(question)),question);
for(const invalid of [{...question,options:['Today','Today']},{...question,options:['Today']},{...question,options:['a'.repeat(121),'Today']},{...question,action:'start'},{...question,ownerId:'other'},{lilthe_ui:'trade_review',summary:'Review',password:'secret'},{lilthe_ui:'trade_review',summary:'Review',url:'https://evil.test'},null,[]])assert.equal(parse(JSON.stringify(invalid)),null);
assert.equal(parse('Ordinary conversation'),null);
assert.deepEqual(parse('{"lilthe_ui":"trade_review","summary":"Review the plan"}'),{lilthe_ui:'trade_review',summary:'Review the plan'});
console.log('PASS interactive schema: bounded choices, duplicates, unknown authority/URL/password fields rejected; review is presentation-only.');

const chart={lilthe_ui:'chart',symbol:'BTCUSDT',interval:'15',summary:'Interpretation',lines:[{label:'Support',from:{time:1700000000,price:10},to:{time:1700000900,price:10}}]};
assert.deepEqual(parse(JSON.stringify(chart)),chart);
for(const bad of [{...chart,symbol:'../private'},{...chart,interval:'2'},{...chart,url:'https://evil.test'},{...chart,lines:[{...chart.lines[0],from:{time:1700000000,price:-1}}]},{...chart,lines:Array(5).fill(chart.lines[0])}])assert.equal(parse(JSON.stringify(bad)),null);
