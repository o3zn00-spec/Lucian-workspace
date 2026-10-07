import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

function worker({ cached, network, offline = false } = {}) {
  const handlers = new Map();
  const calls = { network: 0, cached: 0, writes: 0 };
  vm.runInNewContext(source, {
    URL, Response,
    self: {
      location: { origin: "https://lucian.example" },
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting() {}, clients: { claim() {} },
    },
    caches: {
      match: async () => { calls.cached++; return cached?.clone(); },
      open: async () => ({ put() { calls.writes++; } }),
    },
    fetch: async () => {
      calls.network++;
      if (offline) throw new Error("Offline");
      return network?.clone();
    },
  });
  return {
    calls,
    request(options = {}) {
      let response;
      handlers.get("fetch")({
        request: { url: "https://lucian.example/_next/static/chunks/app.js", method: "GET", destination: "script", mode: "cors", ...options },
        respondWith(value) { response = value; },
      });
      return response;
    },
  };
}

function asset(body, control) {
  const response = new Response(body, { headers: { "cache-control": control } });
  Object.defineProperty(response, "type", { value: "basic" });
  // Preserve the simulated same-origin response type when the harness clones.
  response.clone = () => asset(body, control);
  return response;
}

test("private navigations, API calls, writes and external resources bypass caches", () => {
  const runtime = worker();
  for (const options of [
    { mode: "navigate" },
    { url: "https://lucian.example/api/vault/balances" },
    { method: "POST" },
    { url: "https://external.example/script.js" },
  ]) assert.equal(runtime.request(options), undefined);
  assert.deepEqual(runtime.calls, { network: 0, cached: 0, writes: 0 });
});

test("mutable scripts refresh instead of serving code from an older build", async () => {
  const runtime = worker({ cached: asset("old", "public, max-age=0"), network: asset("new", "public, max-age=0") });
  assert.equal(await (await runtime.request()).text(), "new");
  assert.equal(runtime.calls.network, 1);
});

test("immutable versioned bundles reuse their cached response", async () => {
  const runtime = worker({ cached: asset("versioned", "public, max-age=31536000, immutable") });
  assert.equal(await (await runtime.request()).text(), "versioned");
  assert.equal(runtime.calls.network, 0);
});

test("private or no-store assets never enter the cache", async () => {
  for (const control of ["private, max-age=0", "no-store"]) {
    const runtime = worker({ network: asset("private", control) });
    await runtime.request();
    assert.equal(runtime.calls.writes, 0);
  }
});

test("offline static requests use the existing fallback or return a network error", async () => {
  const cached = worker({ cached: asset("offline", "public, max-age=0"), offline: true });
  assert.equal(await (await cached.request()).text(), "offline");
  const missing = worker({ offline: true });
  assert.equal((await missing.request()).type, "error");
});
