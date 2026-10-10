import assert from 'node:assert/strict';
import { build } from 'esbuild';

const state = globalThis.cancelUi = { values: [], cursor: 0 };
const mocks = {
  react: 'export function useState(initial){const s=globalThis.cancelUi;const index=s.cursor++;if(!(index in s.values))s.values[index]=initial;return [s.values[index],value=>{s.values[index]=value;}];}',
  'react/jsx-runtime': 'export const Fragment="fragment";export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
  '@/components/ui/Dialog': 'export const Dialog="dialog";',
};
const built = await build({ entryPoints: ['src/components/markets/bybit-cancel-order.tsx'], bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', plugins: [{ name: 'fixtures', setup(b) {
  b.onResolve({ filter: /.*/ }, a => a.path in mocks ? { path: a.path, namespace: 'mock' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'mock' }, a => ({ contents: mocks[a.path] }));
} }] });
const { BybitCancelOrder } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'));
let requests = 0;
let refreshes = 0;
const props = { mode: 'bybit_live', order: { orderId: 'one', category: 'spot', symbol: 'BTCUSDT' }, refresh: async () => { refreshes++; } };
const render = () => { state.cursor = 0; return BybitCancelOrder(props); };
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const find = (tree, type, text) => nodes(tree).find(n => n.type === type && (text === undefined || n.props.children === text));
const flush = () => new Promise(resolve => setImmediate(resolve));

async function submit(response) {
  globalThis.fetch = async (_url, options) => {
    requests++;
    assert.equal(options.method, 'DELETE');
    assert.equal(JSON.parse(options.body).password, '  exact password  ');
    if (response instanceof Error) throw response;
    return { ok: response.ok, json: async () => response.body };
  };
  let tree = render();
  find(tree, 'button', 'Review cancellation').props.onClick();
  tree = render();
  const inputs = nodes(tree).filter(n => n.type === 'input');
  assert.equal(inputs.length, 2);
  inputs[0].props.onChange({ target: { value: 'CANCEL BYBIT LIVE ORDER one' } });
  inputs[1].props.onChange({ target: { value: '  exact password  ' } });
  tree = render();
  assert.equal(find(tree, 'button', 'Request cancellation').props.disabled, false);
  find(tree, 'button', 'Request cancellation').props.onClick();
  await flush();
  return render();
}

let tree = await submit({ ok: false, body: { error: 'Current LUCIAN password verification failed.', dispatchState: 'not_sent' } });
assert.equal(requests, 1); assert.equal(refreshes, 1);
assert.ok(find(tree, 'button', 'Request cancellation'));
assert.ok(nodes(tree).some(n => n.props?.role === 'status' && n.props.children.includes('No cancellation request was sent')));
assert.ok(nodes(tree).filter(n => n.type === 'input').every(n => n.props.value === ''));
find(tree, 'button', 'Close').props.onClick();
tree = render();
assert.ok(nodes(tree).some(n => n.props?.role === 'status' && n.props.children.includes('password verification failed')));
await flush(); assert.equal(requests, 1); // A retry always needs another explicit click.

for (const response of [
  { ok: false, body: { error: 'Exchange timeout', dispatchState: 'unknown' } },
  { ok: false, body: { error: 'Legacy server error' } },
  new Error('Network failure'),
  { ok: true, body: {} },
]) {
  state.values = [];
  const before = requests;
  tree = await submit(response);
  assert.equal(requests, before + 1);
  assert.equal(find(tree, 'button', 'Request cancellation'), undefined);
  find(tree, 'button', 'Close').props.onClick();
  tree = render(); find(tree, 'button', 'Review cancellation').props.onClick();
  tree = render(); assert.equal(find(tree, 'button', 'Request cancellation'), undefined);
  await flush(); assert.equal(requests, before + 1);
}
console.log('PASS cancellation UI: known pre-dispatch rejection permits a corrected explicit submission; password fields clear; feedback survives close; unknown, legacy, network and acknowledged outcomes never repeat. No browser or exchange calls.');
