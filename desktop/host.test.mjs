import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { randomBytes } from 'node:crypto';
import { startDesktop, allowedHost, validatePort } from './host.mjs';

function rawStatus(url, headers) {
  return new Promise((done, fail) => {
    const req = request(url, { headers }, res => { res.resume(); done(res.statusCode); });
    req.on('error', fail); req.end();
  });
}
test('strict loopback host and port validation', () => {
  assert(allowedHost('127.0.0.1:43180', 43180));
  for (const host of ['evil.example:43180', 'localhost:43180', '127.0.0.1:1']) assert(!allowedHost(host, 43180));
  for (const port of [-1, 65536, '43180', 0.1]) assert.throws(() => validatePort(port));
});
test('occupied port is preserved, never adopted or killed', async () => {
  const sentinel = createServer((req, res) => res.end('unrelated'));
  await new Promise(done => sentinel.listen(0, '127.0.0.1', done));
  const port = sentinel.address().port;
  try {
    await assert.rejects(startDesktop({ port }), /EADDRINUSE/);
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'unrelated');
  } finally { sentinel.closeAllConnections(); await new Promise(done => sentinel.close(done)); }
});
test('standalone Next startup, privacy boundaries, graceful stop and restart', { timeout: 120000 }, async () => {
  assert(!process.env.DATABASE_URL, 'Smoke test must not have a database configured');
  process.env.AUTH_SECRET = randomBytes(32).toString('hex');
  process.env.NEXT_TELEMETRY_DISABLED = '1';
  for (let attempt = 0; attempt < 2; attempt++) {
    const host = await startDesktop({ port: 0 });
    try {
      assert.equal(await rawStatus(host.url + '/', { host: 'evil.example' }), 421);
      assert.equal((await fetch(host.url + '/', { headers: { origin: 'https://evil.example' } })).status, 403);
      const page = await fetch(host.url + '/dev-workspace', { redirect: 'manual' });
      assert([302, 303, 307].includes(page.status));
      assert(page.headers.get('location')?.includes('/login'));
      const login = await fetch(host.url + '/login');
      assert.equal(login.status, 200);
      assert((await login.text()).includes('LUCIAN'));
      assert.equal((await fetch(host.url + '/auth/guardian-entrance.mp4')).status, 200);
      assert.equal((await fetch(host.url + '/branding/lucian-guardian.svg')).status, 200);
      const denied = await fetch(host.url + '/api/trading/orders');
      assert([401, 403, 503].includes(denied.status), 'Trading must fail closed');
    } finally { await host.close(); }
    await assert.rejects(fetch(host.url));
  }
});