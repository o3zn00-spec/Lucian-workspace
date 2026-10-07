import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import next from 'next';
import { ownStartup } from './lifecycle.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export function validatePort(port) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid desktop port');
  return port;
}
export function allowedHost(host, port) {
  return host === `127.0.0.1:${port}`;
}

// LUCIAN owns only its loopback web server. No assistant/service is started.
export async function startDesktop({ port = 43180 } = {}) {
  validatePort(port);
  let handler;
  let web;
  let closing = false;
  let closePromise;
  const previousAuthUrl = process.env.AUTH_URL;
  const server = createServer((req, res) => {
    const actualPort = server.address()?.port;
    if (!allowedHost(req.headers.host, actualPort)) {
      res.writeHead(421).end('Unexpected host'); return;
    }
    const origin = req.headers.origin;
    if (origin && origin !== `http://127.0.0.1:${actualPort}`) {
      res.writeHead(403).end('Unexpected origin'); return;
    }
    for (const key of Object.keys(req.headers)) {
      if (key.startsWith('x-forwarded-') || key === 'x-real-ip') delete req.headers[key];
    }
    if (!handler || closing) { res.writeHead(503).end('Starting LUCIAN'); return; }
    Promise.resolve(handler(req, res)).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end('Local application request failed');
    });
  });
  const close = () => closePromise ??= (async () => {
    closing = true;
    handler = undefined;
    server.closeAllConnections();
    if (server.listening) await new Promise(done => server.close(done));
    await web?.close();
    if (previousAuthUrl === undefined) delete process.env.AUTH_URL;
    else process.env.AUTH_URL = previousAuthUrl;
  })();
  try {
    await new Promise((done, fail) => {
      server.once('error', fail);
      server.listen(port, '127.0.0.1', () => { server.off('error', fail); done(); });
    });
    if (!existsSync(join(projectRoot, '.next', 'BUILD_ID'))) throw new Error('Build LUCIAN before desktop startup');
    const actualPort = server.address().port;
    const url = `http://127.0.0.1:${actualPort}`;
    process.env.AUTH_URL = url;
    web = next({ dir: projectRoot, dev: false, hostname: '127.0.0.1', port: actualPort, httpServer: server });
    await web.prepare();
    handler = web.getRequestHandler();
    return { url, close };
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const lifecycle = ownStartup(() => startDesktop());
  const stop = async () => { await lifecycle.stop(); process.exit(0); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  process.stdin.resume();
  process.stdin.on('end', stop);
  process.stdin.on('data', data => { if (data.toString().trim() === 'stop') void stop(); });
  try {
    const instance = await lifecycle.ready;
    if (lifecycle.stopping) await lifecycle.stop();
    else process.stdout.write(JSON.stringify({ type: 'desktop-ready', url: instance.url }) + '\n');
  } catch {
    process.stderr.write('Desktop startup failed. Check the LUCIAN web build and loopback port.\n');
    process.exit(1);
  }
}