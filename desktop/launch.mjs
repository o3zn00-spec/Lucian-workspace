import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const cli = require.resolve('@tauri-apps/cli/tauri.js');
const env = { ...process.env, LUCIAN_DESKTOP_NODE: process.execPath };
// Use the toolchain installed for this project without changing global PATH.
const cargoHome = env.CARGO_HOME ?? 'C:\\BuildTools\\LUCIAN-Rust\\cargo';
if (existsSync(join(cargoHome, 'bin', 'cargo.exe'))) {
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = join(cargoHome, 'bin') + ';' + (env[pathKey] ?? '');
  env.CARGO_HOME = cargoHome;
  env.RUSTUP_HOME ??= 'C:\\BuildTools\\LUCIAN-Rust\\rustup';
}
const child = spawn(process.execPath, [cli, 'dev'], {
  stdio: 'inherit', windowsHide: true,
  env,
});
child.on('exit', code => process.exit(code ?? 1));
child.on('error', () => process.exit(1));
