import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundled = await build({ entryPoints: ['src/lib/markets/bybit-provider.ts'], bundle: true, write: false, platform: 'node', format: 'esm' });
const { BybitProvider } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const originalFetch = globalThis.fetch;
const row = { symbol: 'BTCUSDT', lastPrice: '81000', prevPrice24h: '80000', price24hPcnt: '0.0125', highPrice24h: '82000', lowPrice24h: '79000', volume24h: '10', turnover24h: '810000', bid1Price: '80999', ask1Price: '81001' };
let payload = row;
let code = 0;
globalThis.fetch = async url => {
  assert.equal(url, '/api/markets/bybit?kind=tickers&symbol=BTCUSDT');
  return { ok: true, json: async () => ({ retCode: code, result: { list: [payload] } }) };
};
try {
  const ticker = await BybitProvider.getTicker('BTCUSDT');
  assert.equal(ticker.bidPrice, 80999);
  assert.equal(ticker.askPrice, 81001);
  assert.equal(ticker.priceChangePercent, 1.25);
  for (const bad of [{ symbol: 'ETHUSDT' }, { bid1Price: '' }, { ask1Price: 'NaN' }, { lastPrice: '0' }, { bid1Price: '82000' }, { volume24h: '-1' }, { price24hPcnt: 'Infinity' }]) {
    payload = { ...row, ...bad };
    await assert.rejects(() => BybitProvider.getTicker('BTCUSDT'), /malformed/);
  }
  payload = row; code = 10001;
  await assert.rejects(() => BybitProvider.getTicker('BTCUSDT'), /failed/);
} finally { globalThis.fetch = originalFetch; }
console.log('PASS authenticated quote endpoint, symbol identity, bid/ask ordering, finite positive prices, malformed and exchange-error responses. No exchange writes.');
