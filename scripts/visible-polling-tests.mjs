import assert from 'node:assert/strict';
import { build } from 'esbuild';
const built = await build({ entryPoints: ['src/lib/visible-polling.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { startVisiblePolling } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
const original = { setTimeout, clearTimeout, date: Date.now, document: globalThis.document, window: globalThis.window, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
let now = 0, serial = 0, timers = new Map(), calls = 0, fail = false, release;
const events = () => { const handlers = new Map(); return { addEventListener: (e, fn) => { const set=handlers.get(e)??new Set();set.add(fn);handlers.set(e,set); }, removeEventListener: (e, fn) => handlers.get(e)?.delete(fn), emit: e => { for(const fn of handlers.get(e)??[])fn(); }, size:()=>[...handlers.values()].reduce((n,s)=>n+s.size,0) }; };
globalThis.document = { ...events(), visibilityState: 'visible' };
globalThis.window = events();
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
globalThis.setTimeout = (fn, ms) => { const id=++serial;timers.set(id,{fn,at:now+ms});return id; };
globalThis.clearTimeout = id => timers.delete(id);
Date.now = () => now;
const flush = async () => { for(let n=0;n<8;n++)await Promise.resolve(); };
const advance = async ms => { const end=now+ms;while(true){const next=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}now=end;await flush(); };
try {
 const stop=startVisiblePolling(async()=>{calls++;if(fail)throw Error('fixture outage');},60000);
 await advance(0);assert.equal(calls,1);await advance(59999);assert.equal(calls,1);await advance(1);assert.equal(calls,2);
 document.visibilityState='hidden';document.emit('visibilitychange');await advance(600000);assert.equal(calls,2);assert.equal(timers.size,0);
 document.visibilityState='visible';document.emit('visibilitychange');await advance(0);assert.equal(calls,3);
 navigator.onLine=false;window.emit('offline');await advance(600000);assert.equal(calls,3);navigator.onLine=true;window.emit('online');await advance(0);assert.equal(calls,4);
 fail=true;await advance(60000);assert.equal(calls,5);await advance(119999);assert.equal(calls,5);await advance(1);assert.equal(calls,6);await advance(240000);assert.equal(calls,7);assert.equal([...timers.values()][0].at-now,300000);
 // Visibility churn cannot bypass the next allowed retry.
 document.visibilityState='hidden';document.emit('visibilitychange');document.visibilityState='visible';document.emit('visibilitychange');await advance(0);assert.equal(calls,7);
 fail=false;await advance(300000);assert.equal(calls,8);assert.equal([...timers.values()][0].at-now,60000);
 stop();await advance(600000);assert.equal(calls,8);assert.equal(document.size()+window.size(),0);
 let count=0;const slow=startVisiblePolling(async()=>{count++;await new Promise(r=>release=r);},60000);await advance(0);await advance(600000);assert.equal(count,1);assert.equal(timers.size,0);slow();release();await flush();assert.equal(timers.size,0);
 document.visibilityState='hidden';const hidden=startVisiblePolling(async()=>{count++;},60000);await advance(600000);assert.equal(count,1);hidden();
 console.log('PASS visible polling: successful cadence, hidden/offline suppression, failure backoff/cap, wakeup without retry storms, one in-flight read, cleanup and late completion. No network/financial writes.');
} finally {
 globalThis.setTimeout=original.setTimeout;globalThis.clearTimeout=original.clearTimeout;Date.now=original.date;
 for(const key of ['document','window']){if(original[key]===undefined)delete globalThis[key];else globalThis[key]=original[key];}
 if(original.navigator)Object.defineProperty(globalThis,'navigator',original.navigator);else delete globalThis.navigator;
}
