// Stage the existing custom Next server. This is not an installer or a release.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, mkdir, mkdtemp, copyFile, writeFile, lstat } from 'node:fs/promises';
import { dirname, resolve, relative, sep, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function safeBundlePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || value.startsWith('/') ||
      value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Unsafe bundle path');
  if (value.split('/').some(part => /^\.env(?:\.|$)/i.test(part) || ['.git', '.desktop-cache', 'backups', 'recordings'].includes(part)) ||
      /\.(?:pem|key|sqlite|sqlite3|db)$/i.test(value)) throw new Error('Private data cannot enter a runtime bundle');
  return value;
}

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function walk(root, prefix = '', skip = () => false) {
  const result = [];
  for (const item of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name;
    if (skip(name)) continue;
    if (item.isSymbolicLink()) throw new Error('Runtime trees must not contain symbolic links');
    if (item.isDirectory()) result.push(...await walk(root, name, skip));
    else if (item.isFile()) result.push(name);
  }
  return result;
}

export async function verifyBundle(root) {
  const manifest = JSON.parse(await readFile(join(root, 'runtime-manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Invalid runtime manifest');
  const expected = new Set(['runtime-manifest.json']);
  for (const entry of manifest.files) {
    const name = safeBundlePath(entry.path);
    if (expected.has(name)) throw new Error('Duplicate bundle path');
    expected.add(name);
    const path = join(root, name);
    const resolved = await realpath(path);
    const base = await realpath(root);
    if (!resolved.startsWith(base + sep)) throw new Error('Bundle path escaped its root');
    if (!(await lstat(path)).isFile()) throw new Error('Bundle entry is not a regular file');
    const bytes = await readFile(path);
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error(`Bundle integrity failed: ${name}`);
  }
  for (const name of await walk(root)) if (!expected.has(name)) throw new Error('Unexpected file in bundle');
  return { files: manifest.files.length, bytes: manifest.files.reduce((sum, file) => sum + file.bytes, 0) };
}

export async function stageRuntime(root) {
  root = await realpath(root);
  const files = new Set(['package.json', 'desktop/host.mjs',
    'desktop/lifecycle.mjs']);
  const built = await walk(join(root, '.next'), '', name =>
    ['cache', 'build', 'diagnostics', 'types', 'node_modules'].includes(name.split('/')[0]));
  // Do not include caches, diagnostics, traces or source-map development output.
  for (const name of built) {
    if (name.startsWith('server/') || name.startsWith('static/') || !name.includes('/') &&
        (name.endsWith('.json') || name === 'BUILD_ID')) files.add(`.next/${name}`);
    if (name.endsWith('.nft.json')) {
      const tracePath = join(root, '.next', name);
      const trace = JSON.parse(await readFile(tracePath, 'utf8'));
      for (const item of trace.files ?? []) {
        files.add(relative(root, resolve(dirname(tracePath), item)).split(sep).join('/'));
      }
    }
  }
  for (const name of await walk(join(root, 'public'))) files.add(`public/${name}`);
  // Next 16's config hook uses dynamic require.resolve aliases intentionally
  // omitted from static traces, even when a custom production host loads config.
  for (const directory of ['node_modules/next/dist/compiled/webpack',
    'node_modules/next/dist/compiled/@babel/runtime']) {
    for (const name of await walk(join(root, directory))) files.add(`${directory}/${name}`);
  }
  // Next's generated server trace does not cover our custom host entry point.
  const require = createRequire(join(root, 'package.json'));
  // Compile configuration during packaging, not on the owner's machine at launch.
  // Keep the original TypeScript configuration untouched in the source checkout.
  const ts = require('typescript');
  const config = ts.transpileModule(await readFile(join(root, 'next.config.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: 'next.config.ts', reportDiagnostics: true,
  });
  if (config.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) {
    throw new Error('Cannot compile packaged Next configuration');
  }
  const { nodeFileTrace } = require('next/dist/compiled/@vercel/nft');
  const traced = await nodeFileTrace(['desktop/host.mjs'], { base: root, processCwd: root,
    ignore: ['.next/**', '.desktop-cache/**', '.git/**'] });
  for (const name of traced.fileList) files.add(name.split(sep).join('/'));
  files.delete('next.config.ts');
  // Turbopack creates hashed external-package junctions under .next/node_modules.
  // Materialize their bytes at the same alias, never ship checkout-bound links.
  const aliases = [];
  async function collectAliases(directory, prefix = '.next/node_modules') {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const source = await realpath(join(directory, item.name));
      if (!source.startsWith(root + sep)) throw new Error('External alias escaped the project root');
      const name = `${prefix}/${item.name}`;
      if (item.isSymbolicLink()) {
        for (const child of await walk(source)) aliases.push({ name: `${name}/${child}`, source: join(source, child) });
      } else if (item.isDirectory()) await collectAliases(source, name);
      else aliases.push({ name, source });
    }
  }
  if (await lstat(join(root, '.next', 'node_modules')).catch(() => null)) {
    await collectAliases(join(root, '.next', 'node_modules'));
  }
  // All validation happens before a staging directory is created.
  const inventory = [];
  for (const value of [...files].sort()) {
    const name = safeBundlePath(value);
    const source = await realpath(join(root, name));
    if (!source.startsWith(root + sep)) throw new Error('Dependency escaped the project root');
    const info = await lstat(source);
    // NFT can list package-directory links alongside their traced child files.
    // The directory itself has no bytes to copy; every child remains validated.
    if (info.isDirectory()) continue;
    if (!info.isFile()) throw new Error(`Dependency is not a regular file: ${name}`);
    inventory.push({ name, source });
  }
  for (const alias of aliases) {
    safeBundlePath(alias.name);
    if (!files.has(alias.name)) inventory.push(alias);
  }
  const cache = join(root, '.desktop-cache');
  await mkdir(cache, { recursive: true });
  const destination = await mkdtemp(join(cache, 'runtime-stage-'));
  const manifest = { version: 1, kind: 'custom-next-runtime-stage', releaseReady: false,
    nodeVersion: process.version, tracingWarnings: traced.warnings.size, files: [] };
  let cursor = 0;
  // Bounded copy concurrency avoids thousands of serialized Windows I/O waits.
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (cursor < inventory.length) {
      const { name, source } = inventory[cursor++];
      const target = join(destination, name);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
      const bytes = await readFile(target);
      manifest.files.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
    }
  }));
  const configBytes = Buffer.from(config.outputText);
  await writeFile(join(destination, 'next.config.mjs'), configBytes);
  manifest.files.push({ path: 'next.config.mjs', bytes: configBytes.length, sha256: hash(configBytes) });
  manifest.files.sort((a, b) => a.path.localeCompare(b.path));
  await writeFile(join(destination, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2));
  return { destination, ...await verifyBundle(destination), tracingWarnings: traced.warnings.size,
    releaseReady: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  console.log(JSON.stringify(await stageRuntime(root), null, 2));
}
