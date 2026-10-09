import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled = await build({ entryPoints: ['src/lib/assistant/private-state.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { PRIVATE_MEMORY_FILTER, isPrivateAssistantKey } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const allowed = key => !PRIVATE_MEMORY_FILTER.NOT.OR.some(clause => key.startsWith(clause.key.startsWith));
for (const key of ['_spot_risk:flat_anchor', '_spot_risk:future_rollover', '_paper_session:active', '_tool_permission:activity', '_workspace_edit:review', '_order_watch:reservation']) {
  assert.equal(isPrivateAssistantKey(key), true);
  assert.equal(allowed(key), false, `${key} must stay out of ordinary memory reads/deletion`);
}
assert.equal(isPrivateAssistantKey('personal:preference'), false);
assert.equal(allowed('personal:preference'), true);
console.log('PASS Spot loss anchors remain private and protected from ordinary memory editing/deletion; owner preferences remain available.');
