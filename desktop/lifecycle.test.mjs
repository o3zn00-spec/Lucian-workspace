import test from 'node:test';
import assert from 'node:assert/strict';
import { ownStartup } from './lifecycle.mjs';

test('close during startup waits for the owned service and closes exactly once', async () => {
  let complete;
  let closed = 0;
  const lifecycle = ownStartup(() => new Promise(done => { complete = done; }));
  await Promise.resolve();
  const first = lifecycle.stop();
  assert.equal(lifecycle.stopping, true);
  assert.equal(lifecycle.stop(), first);
  let finished = false;
  first.then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  complete({ close: async () => { closed++; } });
  await first;
  assert.equal(closed, 1);
});

test('failed startup can still be shut down idempotently', async () => {
  const lifecycle = ownStartup(async () => { throw new Error('startup failed'); });
  await assert.rejects(lifecycle.ready, /startup failed/);
  await lifecycle.stop();
  await lifecycle.stop();
});
