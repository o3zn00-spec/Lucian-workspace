import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({entryPoints:['src/lib/assistant/paper-risk.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {evaluatePaperEntry:check}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const now=1800000000000;
const plan={mode:'paper',exchange:'bybit',category:'spot',currency:'USDT',leverage:1,capital:'1000',maxOrder:'100',maxExposure:'500',maxLoss:'50',maxRiskPerTrade:'10',symbols:['BTCUSDT','ETHUSDT'],maxOrders:10,maxPositions:1,reviewMinutes:5,durationHours:24,maxDataAgeSeconds:60,feeBps:10,slippageBps:5,strategy:'Fixture only',additionalRules:''};
const state={status:'running',authorized:true,emergencyStop:false,startedAtMs:now-100000,snapshotAtMs:now,cashCents:100000,exposureCents:0,equityCents:100000,openRiskCents:0,ordersPlaced:0,positionSymbols:[]};
const entry={symbol:'BTCUSDT',quantity:'0.001',stopPrice:'49000'};
const quote={symbol:'BTCUSDT',bid:'49999',ask:'50000',observedAtMs:now,instrumentVerified:true,quantityStep:'0.000001',minQuantity:'0.000001',minNotional:'5'};
const run=(p={},s={},e={},q={},t=now)=>check({...plan,...p},{...state,...s},{...entry,...e},{...quote,...q},t);
assert.deepEqual(run(),{allowed:true,notionalCents:5000,entryFeeCents:6,debitCents:5009,stopProceedsCents:4892,riskCents:117});
let count=0;
const denied=(result,reason)=>{assert.equal(result.allowed,false);assert.match(result.reason,reason);count++;};
for (const change of [{status:'draft'},{status:'paused'},{status:'stopped'},{authorized:false},{emergencyStop:true}]) denied(run({},change),/not authorized/);
denied(run({mode:'live'}),/Invalid/);
denied(run({}, {startedAtMs:now-86400000}),/expired/);
denied(run({}, {startedAtMs:now+1}),/start/);
for (const field of ['snapshotAtMs','observedAtMs']) {
 for (const time of [now-60001,now+1]) denied(run({},field==='snapshotAtMs'?{snapshotAtMs:time}:{},{},field==='observedAtMs'?{observedAtMs:time}:{}),/stale/);
}
assert.equal(run({}, {snapshotAtMs:now-60000},{},{observedAtMs:now-60000}).allowed,true);
denied(run({}, {cashCents:NaN}),/Invalid/);
denied(run({}, {ordersPlaced:0.5}),/Invalid/);
denied(run({}, {positionSymbols:['BTCUSDT','BTCUSDT']}),/Invalid position/);
denied(run({}, {},{symbol:'DOGEUSDT'}),/Symbol/);
denied(run({}, {},{},{instrumentVerified:false}),/Symbol/);
denied(run({}, {},{},{symbol:'ETHUSDT'}),/Symbol/);
denied(run({}, {},{},{bid:'50001'}),/crossed/);
denied(run({}, {},{stopPrice:'49999'}),/stop/);
for (const quantity of ['-1','NaN','0','0.000000001','1e-3',0.001]) denied(run({}, {},{quantity}),/Invalid/);
denied(run({}, {},{quantity:'0.0000015'}),/step/);
denied(run({}, {},{quantity:'0.000001'}),/minimum notional/);
denied(run({}, {},{},{minQuantity:'0.002'}),/below minimum/);
denied(run({}, {ordersPlaced:10}),/Order count/);
denied(run({}, {positionSymbols:['ETHUSDT']}),/Position count/);
assert.equal(run({}, {positionSymbols:['BTCUSDT']}).allowed,true);
denied(run({}, {equityCents:95000}),/loss limit reached/);
// Costs, not headline notional, determine affordability and exposure.
denied(run({maxOrder:'50'}),/Order limit/);
denied(run({}, {cashCents:5008}),/cash/);
assert.equal(run({}, {cashCents:5009}).allowed,true);
denied(run({}, {exposureCents:44992}),/Exposure/);
assert.equal(run({}, {exposureCents:44991}).allowed,true);
denied(run({maxRiskPerTrade:'1.16'}),/Per-trade/);
assert.equal(run({maxRiskPerTrade:'1.17'}).allowed,true);
denied(run({}, {equityCents:96000,openRiskCents:884}),/Remaining/);
assert.equal(run({}, {equityCents:96000,openRiskCents:883}).allowed,true);
// Profits do not expand the owner's fixed remaining loss/risk budget.
denied(run({}, {equityCents:110000,openRiskCents:4884}),/Remaining/);
assert.deepEqual(run({feeBps:0,slippageBps:0}),{allowed:true,notionalCents:5000,entryFeeCents:0,debitCents:5000,stopProceedsCents:4900,riskCents:100});
// Sub-cent costs round against the simulated account, never create free cash.
const tiny=run({feeBps:1,slippageBps:1,maxRiskPerTrade:'10'}, {}, {quantity:'0.000101',stopPrice:'49998'});
assert.equal(tiny.allowed,true);assert.equal(tiny.notionalCents,505);assert.equal(tiny.debitCents,507);assert.ok(tiny.riskCents>0);
denied(run({}, {},{quantity:'999999999999'},{ask:'999999999999',bid:'999999999998'}),/Invalid/);
console.log(`PASS: paper entry cost/stop calculations and exact boundaries; ${count} rejected unsafe or malformed scenarios. No network, persistence, authorization grant or orders.`);
