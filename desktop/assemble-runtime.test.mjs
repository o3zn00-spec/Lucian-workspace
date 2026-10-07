import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {validateEntry, copyStage} from './assemble-runtime.mjs';
const digest = createHash('sha256').update('ok').digest('hex');

test('distribution manifests reject unsafe paths and invalid integrity fields', () => {
  const valid = {path:'lib/a.pem',bytes:2,sha256:digest};
  assert.doesNotThrow(() => validateEntry(valid));
  for (const path of ['/x','../x','a/../b','a\\b','C:/x','a//b']) {
    assert.throws(() => validateEntry({...valid,path}));
  }
  assert.throws(() => validateEntry({...valid,bytes:-1}));
  assert.throws(() => validateEntry({...valid,sha256:'unverified'}));
});

test('stage assembly verifies bytes and refuses overwrite or corruption', async () => {
  const source = await mkdtemp(join(tmpdir(),'lucian-assembly-src-'));
  const destination = await mkdtemp(join(tmpdir(),'lucian-assembly-dst-'));
  await writeFile(join(source,'a.txt'),'ok');
  await writeFile(join(source,'manifest.json'),JSON.stringify({version:1,files:[{path:'a.txt',bytes:2,sha256:digest}]}));
  await copyStage(source,destination,'manifest.json');
  assert.equal(await readFile(join(destination,'a.txt'),'utf8'),'ok');
  await assert.rejects(copyStage(source,destination,'manifest.json'),/EEXIST/);
  await writeFile(join(source,'a.txt'),'no');
  await assert.rejects(copyStage(source,destination,'manifest.json'),/checksum/);
});
