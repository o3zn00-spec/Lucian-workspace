import assert from 'node:assert/strict';
import {build} from 'esbuild';
const b=await build({entryPoints:['src/lib/assistant/strategy-replay.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {parseReplayBars,replayStrategy}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const hour=3600000,end=Math.floor(Date.now()/hour)*hour;
const rows=Array.from({length:1000},(_,i)=>{const p=100+i*.03;return [String(end-(1000-i)*hour),String(p),String(p*1.025),String(p*.985),String(p+.02),'10','1000'];});
const bars=parseReplayBars(rows,end+1000);
assert.equal(bars.length,1000);assert.throws(()=>parseReplayBars(rows.slice(300),end));
for(const mutate of [r=>r[5]=r[4],r=>r[5][2]='1',r=>r[5][5]='NaN']){const r=structuredClone(rows);mutate(r);assert.throws(()=>parseReplayBars(r,end));}
assert.throws(()=>parseReplayBars(rows,end+3*hour));
const normal=replayStrategy(bars,10,5),stress=replayStrategy(bars,20,20);
assert.ok(normal.trades>0);assert.ok(normal.fills.every((f,i)=>i%2===0?f.side==='buy':f.side==='sell'));assert.ok(normal.fills.filter(f=>f.side==='sell').every(f=>/stop/.test(f.reason)));assert.ok(stress.netUsdt<=normal.netUsdt);assert.ok(stress.costsUsdt>0);assert.equal(normal.equity.at(-1).value,1000+normal.netUsdt);
// Changing future bars cannot change already-recorded fills before that boundary.
const changed=structuredClone(bars);for(let i=500;i<changed.length;i++){changed[i].open*=2;changed[i].high*=2;changed[i].low*=2;changed[i].close*=2;}
assert.deepEqual(replayStrategy(changed,10,5).fills.filter(f=>f.atMs<bars[500].atMs),normal.fills.filter(f=>f.atMs<bars[500].atMs));
assert.equal(replayStrategy(bars,10,5,bars.length-168).bars,168);
console.log('PASS historical replay: continuity, malformed/old inputs, prior-only signals, adverse simultaneous exits, costs, equity and fixed last-week segment.');
