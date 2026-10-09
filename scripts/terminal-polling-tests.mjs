import assert from 'node:assert/strict';
import {build} from 'esbuild';
const harness={refs:[],states:[],effects:[],refIndex:0,stateIndex:0};globalThis.terminalHarness=harness;
const built=await build({entryPoints:['src/hooks/use-bybit-terminal.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'react-fixture',setup(b){b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`const h=globalThis.terminalHarness;export const createContext=()=>({});export const useContext=()=>null;export const useCallback=fn=>fn;export const useRef=value=>{const i=h.refIndex++;return h.refs[i]??=( {current:value} );};export const useState=value=>{const i=h.stateIndex++;if(!(i in h.states))h.states[i]=value;return [h.states[i],v=>{h.states[i]=v;}];};export const useEffect=fn=>h.effects.push(fn);` }));}}]});
const {useBybitTerminal}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
let now=0,serial=0,timers=new Map(),requests=[],cleanups=[];
const events=()=>{const h=new Map();return {addEventListener:(e,f)=>{const s=h.get(e)??new Set();s.add(f);h.set(e,s);},removeEventListener:(e,f)=>h.get(e)?.delete(f),emit:e=>{for(const f of h.get(e)??[])f();}};};
const saved={fetch:globalThis.fetch,setTimeout,clearTimeout,now:Date.now,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator')};
globalThis.document={...events(),visibilityState:'visible'};globalThis.window={...events(),setTimeout:(fn,ms)=>globalThis.setTimeout(fn,ms),clearTimeout:id=>globalThis.clearTimeout(id)};
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}});Date.now=()=>now;
globalThis.setTimeout=(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:now+ms});return id;};globalThis.clearTimeout=id=>timers.delete(id);
globalThis.fetch=(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}));
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const advance=async ms=>{now+=ms;for(const [id,t]of [...timers])if(t.at<=now){timers.delete(id);t.fn();}await flush();};
const reply=(i,value,status=200)=>requests[i].resolve({ok:status===200,json:async()=>value});
const Render=mode=>{for(const cleanup of cleanups)cleanup?.();harness.refIndex=harness.stateIndex=0;harness.effects=[];const value=useBybitTerminal(mode,'BTCUSDT');cleanups=harness.effects.map(fn=>fn());return value;};
try{
 let hook=Render('bybit_live');await advance(0);assert.equal(requests.length,1);
 const manual=hook.refresh(),duplicate=hook.refresh();assert.equal(manual,duplicate);assert.equal(requests.length,1);
 reply(0,{mode:'bybit_live',refreshedAt:'before-save'});await flush();assert.equal(requests.length,2);reply(1,{mode:'bybit_live',refreshedAt:'after-save'});await manual;assert.equal(harness.states[0].refreshedAt,'after-save');
 await advance(59999);assert.equal(requests.length,2);await advance(1);assert.equal(requests.length,3);
 const old=requests[2];hook=Render('bybit_testnet');assert.equal(old.options.signal.aborted,true);await advance(0);assert.equal(requests.length,4);
 reply(3,{mode:'bybit_testnet',refreshedAt:'new-mode'});await flush();reply(2,{mode:'bybit_live',refreshedAt:'late-old-mode'});await flush();assert.equal(harness.states[0].mode,'bybit_testnet');
 const error=hook.refresh();reply(4,{error:'fixture service unavailable'},400);assert.equal(await error,false);assert.equal(harness.states[0],null);assert.match(harness.states[1],/unavailable/);
 document.visibilityState='hidden';document.emit('visibilitychange');await advance(600000);assert.equal(requests.length,5);
 hook=Render(null);await advance(0);assert.equal(harness.states[0],null);assert.equal(harness.states[2],false);assert.equal(requests.length,5);
 for(const cleanup of cleanups)cleanup?.();assert.equal(timers.size,0);
 console.log('PASS terminal polling: manual post-action refresh queues one fresh read, no overlap/duplicate queue, one-minute cadence, old-mode cancellation/late-response rejection, failure clears balance, hidden tab and disabled mode make no reads. No network/financial writes.');
}finally{globalThis.fetch=saved.fetch;globalThis.setTimeout=saved.setTimeout;globalThis.clearTimeout=saved.clearTimeout;Date.now=saved.now;if(saved.navigator)Object.defineProperty(globalThis,'navigator',saved.navigator);else delete globalThis.navigator;delete globalThis.window;delete globalThis.document;delete globalThis.terminalHarness;}
