import assert from 'node:assert/strict';
import { build } from 'esbuild';
const fixture = globalThis.cancelFixture = { writes: [], reads: 0, live: true, password: true, changed: false, fail: false };
const mocks = {
  'server-only': '',
  '@/lib/db': `export const db={user:{findUnique:async()=>({passwordHash:'fixture'})},tradingAuditEvent:{create:async()=>({})}};`,
  '@/lib/auth/password': 'export const verifyPassword=async()=>globalThis.cancelFixture.password;',
  '@/lib/bybit/client': `export async function getBybitConfig(){const f=globalThis.cancelFixture;f.reads++;return {configured:true,environment:f.live?'mainnet':'testnet',apiKey:f.changed&&f.reads>1?'changed':'key',apiSecret:'fixture'};}export const bybitPublicRequest=async()=>({});export async function bybitRequest(_u,path,options,config){const f=globalThis.cancelFixture;f.writes.push({path,options,config});if(f.fail)throw Error('unknown exchange outcome');return {orderId:options.body.orderId};}`,
  '@/lib/bybit/trading': 'export const getTradingProfile=async()=>({});',
  '@/lib/bybit/spot-risk': 'export const readSpotRisk=async()=>({});',
};
const built = await build({ entryPoints: ['src/lib/bybit/terminal.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path]}));}}] });
const {cancelTerminalOrder} = await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const input = {mode:'bybit_live',category:'spot',symbol:'BTCUSDT',orderId:'order-one',confirmation:'CANCEL BYBIT LIVE ORDER order-one',password:'fixture'};
for(const change of [{confirmation:'yes'},{confirmation:'CANCEL BYBIT LIVE ORDER order-other'},{category:'unknown'},{symbol:'BTC/USDT'},{orderId:'../bad'}]) await assert.rejects(cancelTerminalOrder('owner',{...input,...change}));
assert.equal(fixture.writes.length,0);
fixture.password=false;await assert.rejects(cancelTerminalOrder('owner',input),/password/);assert.equal(fixture.writes.length,0);
fixture.password=true;fixture.reads=0;fixture.changed=true;await assert.rejects(cancelTerminalOrder('owner',input),/connection changed/);assert.equal(fixture.writes.length,0);
fixture.changed=false;fixture.reads=0;await cancelTerminalOrder('owner',input);assert.equal(fixture.writes.length,1);assert.equal(fixture.writes[0].path,'/v5/order/cancel');assert.deepEqual(fixture.writes[0].options.body,{category:'spot',symbol:'BTCUSDT',orderId:'order-one'});assert.equal(fixture.writes[0].config.apiKey,'key');
fixture.fail=true;await assert.rejects(cancelTerminalOrder('owner',input),/unknown/);assert.equal(fixture.writes.length,2);
fixture.fail=false;fixture.live=false;fixture.password=false;await cancelTerminalOrder('owner',{...input,mode:'bybit_testnet',confirmation:'CANCEL BYBIT TESTNET ORDER order-one'});assert.equal(fixture.writes.length,3);
console.log('PASS exact target cancellation confirmation, live password, malformed target rejection, connection fencing, one attempt on unknown outcome and explicit testnet mode. Exchange fixtures only.');
