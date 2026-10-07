import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { safeBundlePath, verifyBundle } from './package-runtime.mjs';

test('bundle paths reject traversal, credentials and personal databases', () => {
  for (const path of ['../x', '/x', 'C:/x', 'a\\b', 'a/../b', '.env', '.env.local',
    'a/.env.production', 'memory.sqlite', 'a/private.pem', 'a/.git/config', 'a//b']) {
    assert.throws(() => safeBundlePath(path), undefined, path);
  }
  assert.equal(safeBundlePath('node_modules/next/package.json'), 'node_modules/next/package.json');
});

test('manifest verifies bytes and rejects corruption and extra files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lucian-bundle-test-'));
  const data = 'test runtime';
  await writeFile(join(root, 'entry.js'), data);
  const manifest = { version: 1, files: [{ path: 'entry.js', bytes: Buffer.byteLength(data),
    sha256: createHash('sha256').update(data).digest('hex') }] };
  await writeFile(join(root, 'runtime-manifest.json'), JSON.stringify(manifest));
  assert.deepEqual(await verifyBundle(root), { files: 1, bytes: Buffer.byteLength(data) });
  await writeFile(join(root, 'entry.js'), 'changed');
  await assert.rejects(verifyBundle(root), /integrity/);
  await writeFile(join(root, 'entry.js'), data);
  await writeFile(join(root, 'extra.js'), 'unexpected');
  await assert.rejects(verifyBundle(root), /Unexpected file/);
});

test('manifest rejects duplicate entries and traversal before reading outside the bundle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lucian-bundle-path-test-'));
  const entry = { path: 'entry.js', bytes: 0, sha256: createHash('sha256').update('').digest('hex') };
  await writeFile(join(root, 'entry.js'), '');
  await writeFile(join(root, 'runtime-manifest.json'), JSON.stringify({ version: 1, files: [entry, entry] }));
  await assert.rejects(verifyBundle(root), /Duplicate/);
  await writeFile(join(root, 'runtime-manifest.json'), JSON.stringify({ version: 1, files: [{ ...entry, path: '../outside' }] }));
  await assert.rejects(verifyBundle(root), /Unsafe/);
});
