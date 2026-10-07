// Assemble an unapproved distribution from checksummed stages. No deployment.
import {readFile, writeFile, mkdir, mkdtemp, realpath, lstat} from 'node:fs/promises';
import {join, dirname, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function validateEntry(entry) {
  if (!entry || typeof entry.path !== 'string' || entry.path.includes('\\') || entry.path.includes(':') ||
    entry.path.split('/').some(p => !p || p === '.' || p === '..') ||
    !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    throw new Error('Invalid staged entry');
  }
}

export async function copyStage(source, destination, manifestName) {
  source = await realpath(source);
  const manifestBytes = await readFile(join(source, manifestName));
  const manifest = JSON.parse(manifestBytes);
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Invalid stage manifest');
  const seen = new Set([manifestName]);
  for (const entry of manifest.files) {
    validateEntry(entry);
    if (seen.has(entry.path)) throw new Error('Duplicate staged entry');
    seen.add(entry.path);
  }
  let cursor = 0;
  await Promise.all(Array.from({length:4}, async () => {
    while (cursor < manifest.files.length) {
      const entry = manifest.files[cursor++];
      const input = join(source, entry.path);
      if (!(await lstat(input)).isFile() || !(await realpath(input)).startsWith(source + sep)) {
        throw new Error('Staged dependency escaped its root');
      }
      const bytes = await readFile(input);
      if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error('Staged dependency checksum mismatch');
      const target = join(destination, entry.path);
      await mkdir(dirname(target), {recursive:true});
      await writeFile(target, bytes, {flag:'wx'});
    }
  }));
  await writeFile(join(destination, manifestName), manifestBytes, {flag:'wx'});
  return {files:manifest.files.length, manifestSha256:hash(manifestBytes)};
}

async function main() {
  const [web] = process.argv.slice(2);
  if (!web) throw new Error('Pass the LUCIAN web runtime stage directory');
  if (!/^v\d+\.\d+\.\d+$/.test(process.version)) throw new Error('Unsupported Node version');
  const licenseUrl = `https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`;
  const response = await fetch(licenseUrl, {redirect:'error', signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error('Node license unavailable');
  const license = Buffer.from(await response.arrayBuffer());
  if (license.length > 1024*1024 || !license.toString().startsWith('Node.js is licensed')) throw new Error('Invalid Node license response');
  const cache = fileURLToPath(new URL('../.desktop-cache/', import.meta.url));
  await mkdir(cache, {recursive:true});
  const destination = await mkdtemp(join(cache, 'distribution-'));
  const root = join(destination, 'runtime');
  await mkdir(join(root, 'node'), {recursive:true});
  const node = await readFile(process.execPath);
  await writeFile(join(root, 'node', 'node.exe'), node, {flag:'wx'});
  await writeFile(join(root, 'node', 'LICENSE.txt'), license, {flag:'wx'});
  const components = {};
  for (const [name, input, manifest] of [['web',web,'runtime-manifest.json']]) {
    console.log('Verifying and assembling ' + name);
    components[name] = await copyStage(input, join(root,name), manifest);
  }
  await writeFile(join(root, 'distribution.json'), JSON.stringify({version:1, releaseReady:false,
    nodeVersion:process.version, nodeSha256:hash(node), nodeLicenseSha256:hash(license),
    nodeLicenseSource:licenseUrl, components}, null, 2), {flag:'wx'});
  console.log(JSON.stringify({destination, releaseReady:false, components}, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
