import assert from 'node:assert/strict';
import { build } from 'esbuild';
const fixture = { state: 'submitted', reads: 0, audits: [], fail: false, missing: false };
globalThis.observerFixture = fixture;
async function bundle(entry, mocks) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'fixtures', setup(b) {
    b.onResolve({ filter: /.*/ }, a => a.path in mocks ? { path: a.path, namespace: 'fixture' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: mocks[a.path] }));
  } }] });
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const { observeOrder } = await bundle('src/lib/bybit/order-observer.ts', {
  'server-only': '',
  '@/lib/db': `export const db={liveTradeIntent:{findFirst:async({where})=>{if(where.userId!=='owner'||globalThis.observerFixture.missing)return null;return {state:globalThis.observerFixture.state,productId:'BTCUSDT',tradingMode:'bybit_live'};}},tradingAuditEvent:{create:async({data})=>globalThis.observerFixture.audits.push(data)}};`,
  './reconciliation': `export async function reconcileTerminalOrder(){let f=globalThis.observerFixture;f.reads++;if(f.fail)throw Error('sensitive provider error');return {state:f.state,resolved:f.resolved??false};}`,
});
assert.deepEqual(await observeOrder('other', 'intent'), { done: true });assert.equal(fixture.reads, 0);
assert.deepEqual(await observeOrder('owner', 'intent'), { done: false });assert.equal(fixture.audits.at(-1).status, 'watching');
fixture.fail = true;assert.deepEqual(await observeOrder('owner', 'intent'), { done: false });assert.equal(fixture.audits.at(-1).status, 'read_unavailable');assert.ok(!JSON.stringify(fixture.audits).includes('sensitive'));
assert.deepEqual(await observeOrder('owner', 'intent', true), { done: true });assert.equal(fixture.audits.at(-1).status, 'review_required');
fixture.fail = false;fixture.state = 'cancelled_with_fills';assert.deepEqual(await observeOrder('owner', 'intent'), { done: true });assert.equal(fixture.audits.at(-1).status, 'review_required');
fixture.state = 'submitted';fixture.resolved = true;assert.deepEqual(await observeOrder('owner', 'intent'), { done: true });assert.equal(fixture.audits.at(-1).status, 'resolved');
fixture.state = 'filled';const before = fixture.reads;await observeOrder('owner', 'intent');assert.equal(fixture.reads, before);
assert.ok(fixture.audits.every(a => a.details.financialWrites === 0 && a.details.protectionVerified === false));
const execution = { startFailure: true, dbFailure: false, executeFailure: false, calls: 0, starts: 0 };
globalThis.executionFixture = execution;
const { executeObservedOrder } = await bundle('src/lib/bybit/observed-execution.ts', {
  'server-only': '',
  'workflow/api': `export async function start(){let f=globalThis.executionFixture;f.starts++;if(f.startFailure)throw Error('queue unavailable');return {runId:'run'};}`,
  '@/workflows/order-observer': 'export const orderObserverWorkflow=async()=>{};',
  '@/lib/db': `export const db={liveTradeIntent:{findFirst:async()=>{if(globalThis.executionFixture.dbFailure)throw Error('db unavailable');return {productId:'BTCUSDT',tradingMode:'bybit_live'};}},tradingAuditEvent:{create:async()=>{}}};`,
  './terminal': `export async function executeTerminalOrder(){let f=globalThis.executionFixture;f.calls++;if(f.executeFailure)throw Error('ambiguous submission');return {status:'submitted',intentId:'intent',orderId:'order'};}`,
});
assert.equal((await executeObservedOrder('owner', { intentId: 'intent' })).status, 'submitted');assert.equal(execution.calls, 1);
execution.dbFailure = true;assert.equal((await executeObservedOrder('owner', { intentId: 'intent' })).status, 'submitted');assert.equal(execution.calls, 2);
execution.dbFailure = false;execution.startFailure = false;execution.executeFailure = true;
await assert.rejects(executeObservedOrder('owner', { intentId: 'intent' }), /ambiguous submission/);assert.equal(execution.calls, 3);assert.equal(execution.starts, 2);
console.log('PASS observer ownership, unresolved retention, bounded review, partial-cancel review, resolved stopping, error redaction, no protection claims, and queue/database failures never retry or obscure acknowledged financial submissions. Fixtures only.');
