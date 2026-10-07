// Universal API-mocking layer for the preview engine.
//
// This module generates a JavaScript bootstrap string that gets injected
// into the preview iframe BEFORE any user code runs. The bootstrap:
//
//   1. Overrides window.fetch and XMLHttpRequest
//   2. Tries the real call first (with a timeout)
//   3. Falls back to a realistic fake response if the real call fails
//   4. Logs every call and posts updates to the parent window
//
// The fake response generator uses endpoint-name heuristics to produce
// sensible shapes (auth tokens, user objects, arrays of items, etc.) so
// the app looks and behaves like it's working even without a backend.

import type { EnvVar, PreviewMode } from "@/types/workspace";

export interface MockBootstrapOptions {
  mode: PreviewMode;
  envVars: EnvVar[];
  /** Timeout for real-call attempts in ms. Default 3000. */
  timeoutMs?: number;
}

/**
 * Build the bootstrap script string. This runs inside the iframe before
 * any user code, so it can monkey-patch fetch/XHR.
 */
export function buildMockBootstrap(opts: MockBootstrapOptions): string {
  const timeoutMs = opts.timeoutMs ?? 3000;
  const envVarsJson = JSON.stringify(
    opts.envVars.reduce((acc, e) => ({ ...acc, [e.key]: e.value }), {}),
  );
  // In "fake" mode we skip the real call entirely and go straight to mock.
  const skipReal = opts.mode === "fake";

  return `<script>(function(){
  // ---- State ----
  window.__MOCK_LOG__ = [];
  window.__MOCK_MODE__ = ${JSON.stringify(opts.mode)};
  window.__ENV_VARS__ = ${envVarsJson};
  window.process = window.process || { env: window.__ENV_VARS__ };

  var callCounter = 0;
  var SKIP_REAL = ${skipReal};

  // ---- Helpers ----
  function log(entry) {
    window.__MOCK_LOG__.push(entry);
    if (window.__MOCK_LOG__.length > 200) window.__MOCK_LOG__.shift();
    notifyParent();
  }

  function notifyParent() {
    try {
      window.parent.postMessage({
        type: 'mock-log-update',
        log: window.__MOCK_LOG__,
      }, '*');
    } catch(e) {}
  }

  function isApiLike(url) {
    // Don't mock CDN / font / static asset loads — those are infrastructure.
    if (/^https?:\\/\\/(unpkg\\.com|cdn\\.jsdelivr\\.net|fonts\\.googleapis\\.com|fonts\\.gstatic\\.com|cdn\\.tailwindcss\\.com)/i.test(url)) return false;
    // Mock same-origin, relative, and /api/ calls.
    if (url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) return true;
    if (/\\/api\\//i.test(url)) return true;
    // Mock calls to localhost / 127.0.0.1.
    if (/^https?:\\/\\/(localhost|127\\.0\\.0\\.1)/i.test(url)) return true;
    // Mock calls that look like API endpoints (contain /api/ or /v1/ etc.).
    if (/\\/(api|v[0-9]+|graphql|rpc|rest)\\//i.test(url)) return true;
    // For other external URLs, don't mock — let them succeed or fail naturally.
    return false;
  }

  // ---- Fake response generator ----
  // This is the brain of the mocker. It looks at the URL path, HTTP method,
  // and request body to generate a response that the calling code will
  // hopefully accept without crashing.

  function generateFakeResponse(url, method, body) {
    var path = url.split('?')[0].split('#')[0];
    var query = {};
    try {
      var qs = url.split('?')[1];
      if (qs) qs.split('&').forEach(function(p) {
        var kv = p.split('=');
        query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
      });
    } catch(e) {}

    var segments = path.split('/').filter(Boolean);
    // Strip /api/ prefix if present.
    var apiIdx = segments.indexOf('api');
    if (apiIdx >= 0) segments = segments.slice(apiIdx + 1);
    var last = segments[segments.length - 1] || '';
    var secondLast = segments[segments.length - 2] || '';
    method = (method || 'GET').toUpperCase();

    // Try to parse body.
    var parsedBody = null;
    if (body) {
      try { parsedBody = typeof body === 'string' ? JSON.parse(body) : body; } catch(e) {}
    }

    // --- Auth endpoints ---
    if (/login|signin|authenticate/i.test(last)) {
      return ok({
        success: true,
        token: 'mock_jwt_' + Math.random().toString(36).slice(2, 20),
        refreshToken: 'mock_refresh_' + Math.random().toString(36).slice(2, 20),
        user: fakeUser(parsedBody),
        expiresIn: 3600,
      });
    }
    if (/register|signup|create-account/i.test(last)) {
      return created({
        success: true,
        user: fakeUser(parsedBody),
        token: 'mock_jwt_' + Math.random().toString(36).slice(2, 20),
      });
    }
    if (/logout|signout/i.test(last)) {
      return ok({ success: true, message: 'Logged out' });
    }
    if (last === 'me' || last === 'profile' || last === 'current-user' || last === 'session') {
      return ok(fakeUser(null));
    }
    if (/forgot|reset|password/i.test(last)) {
      return ok({ success: true, message: 'Password reset email sent (mocked)' });
    }
    if (/verify|confirm/i.test(last)) {
      return ok({ success: true, verified: true });
    }

    // --- Settings / config ---
    if (/settings|config|preferences|options/i.test(last)) {
      return ok(fakeSettings());
    }

    // --- Upload endpoints ---
    if (/upload|avatar|image|file|asset/i.test(last) && method === 'POST') {
      return ok({
        success: true,
        url: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="%23667eea" width="100" height="100"/></svg>'),
        filename: 'mock-upload-' + Date.now() + '.png',
        size: 1024,
      });
    }

    // --- Search ---
    if (query.q !== undefined || query.search !== undefined || query.query !== undefined) {
      return ok([fakeItem('Result'), fakeItem('Result'), fakeItem('Result')]);
    }

    // --- Plural-noun list endpoints (GET) ---
    // Heuristic: if the last segment looks like a plural noun (ends in 's'
    // but not 'us'/'is'/'ss') and method is GET, return an array.
    // Detect plural: ends in 's' (but not us/is/ss/os/news) OR known plurals
    // like staff, people, media, data, users, etc.
    var looksPlural = segments.length > 0 && (
      (/s$/.test(last) && !/(us|is|ss|os|news)$/.test(last)) ||
      /^(staff|people|media|data|users|items|products|orders|cards|rates|countries|images|settings|messages|notifications|transactions)$/i.test(last)
    );
    if (method === 'GET' && looksPlural) {
      var items = [];
      var count = Math.min(5, Math.max(3, Math.floor(Math.random() * 4) + 3));
      for (var i = 0; i < count; i++) items.push(fakeItem(singularize(last)));
      return ok(items);
    }

    // --- Singular item by ID (GET /users/:id) ---
    if (method === 'GET' && segments.length >= 2 && /^\\d+$/.test(last)) {
      return ok(fakeItem(singularize(secondLast), parseInt(last)));
    }

    // --- Create (POST to plural endpoint) ---
    if (method === 'POST' && looksPlural) {
      return created(Object.assign({}, fakeItem(singularize(last)), parsedBody || {}));
    }

    // --- Update (PUT/PATCH to /:id) ---
    if ((method === 'PUT' || method === 'PATCH') && /^\\d+$/.test(last)) {
      return ok(Object.assign({}, fakeItem(singularize(secondLast), parseInt(last)), parsedBody || {}));
    }

    // --- Delete ---
    if (method === 'DELETE') {
      return ok({ success: true, deleted: true, id: last });
    }

    // --- Stats / counts / dashboard ---
    if (/stats|count|total|summary|dashboard|metrics|analytics/i.test(last)) {
      return ok({
        total: Math.floor(Math.random() * 1000) + 100,
        active: Math.floor(Math.random() * 500) + 50,
        pending: Math.floor(Math.random() * 50) + 5,
        revenue: (Math.random() * 50000 + 10000).toFixed(2),
        growth: (Math.random() * 20 + 5).toFixed(1) + '%',
      });
    }

    // --- GraphQL ---
    if (/graphql|gql/i.test(path) && parsedBody && parsedBody.query) {
      var opName = (parsedBody.query.match(/(query|mutation)\\s+(\\w+)/) || [])[2] || 'Unknown';
      return ok({ data: fakeGraphQLResponse(opName) });
    }

    // --- Default: try to match the body shape ---
    if (parsedBody && typeof parsedBody === 'object') {
      var responseShape = {};
      for (var key in parsedBody) {
        if (parsedBody.hasOwnProperty(key)) responseShape[key] = parsedBody[key];
      }
      responseShape.id = Math.floor(Math.random() * 10000) + 1;
      responseShape.createdAt = new Date().toISOString();
      responseShape.updatedAt = new Date().toISOString();
      if (method === 'POST') return created(responseShape);
      return ok(responseShape);
    }

    // --- Ultimate fallback ---
    if (method === 'GET') return ok({ success: true, data: [] });
    return ok({ success: true, message: 'Mock response for ' + method + ' ' + path });
  }

  function ok(body) { return { status: 200, body: body }; }
  function created(body) { return { status: 201, body: body }; }

  function singularize(word) {
    if (!word) return 'item';
    if (/ies$/.test(word)) return word.slice(0, -3) + 'y';
    if (/ses$/.test(word)) return word.slice(0, -2);
    if (/s$/.test(word) && !/(us|is|ss)$/.test(word)) return word.slice(0, -1);
    return word;
  }

  function fakeUser(body) {
    var email = (body && body.email) || 'demo@example.com';
    var name = (body && body.name) || (body && body.username) || 'Demo User';
    return {
      id: Math.floor(Math.random() * 10000) + 1,
      email: email,
      name: name,
      role: 'user',
      avatar: null,
      createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
      emailVerified: true,
    };
  }

  function fakeSettings() {
    return {
      theme: 'system',
      notifications: { email: true, push: false, sms: false },
      privacy: { profilePublic: true, showActivity: false },
      language: 'en',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    };
  }

  function fakeItem(type, id) {
    type = type || 'item';
    id = id || Math.floor(Math.random() * 10000) + 1;
    var lower = type.toLowerCase();
    var item = {
      id: id,
      createdAt: new Date(Date.now() - Math.random() * 86400000 * 90).toISOString(),
      updatedAt: new Date().toISOString(),
    };
    // Customize based on type.
    if (/user|account|member|customer|profile/i.test(lower)) {
      item.name = fakeName();
      item.email = fakeEmail();
      item.role = ['admin', 'user', 'editor'][Math.floor(Math.random() * 3)];
      item.avatar = null;
      item.active = Math.random() > 0.2;
    } else if (/product|item|listing|good/i.test(lower)) {
      item.name = capitalize(type) + ' ' + id;
      item.price = (Math.random() * 200 + 9.99).toFixed(2);
      item.currency = 'USD';
      item.stock = Math.floor(Math.random() * 100);
      item.image = null;
      item.description = 'A sample ' + type + ' for preview purposes.';
      item.category = 'General';
    } else if (/order|transaction|purchase|payment|invoice/i.test(lower)) {
      item.orderNumber = 'ORD-' + String(id).padStart(5, '0');
      item.status = ['pending', 'completed', 'shipped', 'delivered'][Math.floor(Math.random() * 4)];
      item.total = (Math.random() * 500 + 20).toFixed(2);
      item.currency = 'USD';
      item.items = Math.floor(Math.random() * 5) + 1;
      item.customer = fakeName();
    } else if (/post|article|blog|content|page|story/i.test(lower)) {
      item.title = capitalize(type) + ' #' + id + ': A Sample Title';
      item.excerpt = 'This is a sample excerpt for the preview environment.';
      item.content = '<p>This is sample content for preview purposes. The actual content would be loaded from a real backend.</p>';
      item.author = fakeName();
      item.publishedAt = new Date().toISOString();
      item.tags = ['sample', 'preview', 'demo'];
      item.readTime = Math.floor(Math.random() * 10) + 2;
    } else if (/card|gift|voucher|coupon|discount/i.test(lower)) {
      // Gift card shaped data with brand/slug fields that apps expect.
      var brands = ['Amazon', 'iTunes', 'Google Play', 'Steam', 'Netflix', 'Spotify', 'PlayStation', 'Xbox'];
      var brand = brands[id % brands.length];
      item.slug = brand.toLowerCase().replace(/\s+/g, '-');
      item.brand = brand;
      item.code = 'MOCK-' + String(id).padStart(6, '0');
      item.value = (Math.random() * 100 + 10).toFixed(2);
      item.currency = 'USD';
      item.status = 'active';
      item.rate = (Math.random() * 0.3 + 0.7).toFixed(4);
      item.image = null;
      item.expiry = new Date(Date.now() + 86400000 * 30).toISOString();
    } else if (/rate|price|quote|exchange/i.test(lower)) {
      item.rate = (Math.random() * 5 + 0.5).toFixed(4);
      item.currency = 'USD';
      item.change = (Math.random() * 4 - 2).toFixed(2) + '%';
      item.updatedAt = new Date().toISOString();
    } else if (/country|region|location|address/i.test(lower)) {
      item.name = ['United States', 'United Kingdom', 'Canada', 'Australia', 'Germany'][id % 5];
      item.code = ['US', 'GB', 'CA', 'AU', 'DE'][id % 5];
      item.flag = null;
    } else if (/staff|employee|agent|worker/i.test(lower)) {
      item.name = fakeName();
      item.email = fakeEmail();
      item.role = ['manager', 'agent', 'support', 'admin'][id % 4];
      item.roleLabel = ['Senior Manager', 'Support Agent', 'Lead Engineer', 'Operations Lead'][id % 4];
      item.title = item.roleLabel;
      item.department = ['Sales', 'Support', 'Engineering', 'Operations'][id % 4];
      item.position = item.title;
      item.avatar = null;
      item.image = null;
      item.imageUrl = null;
      item.photo = null;
      item.bio = 'Experienced team member with a passion for excellence.';
      item.phone = '+1 (555) 123-4567';
      item.whatsappNumber = '+1234567890';
      item.isActive = true;
      item.active = true;
      item.sortOrder = id;
      item.createdAt = new Date(Date.now() - 86400000 * 30).toISOString();
    } else if (/message|chat|comment|notification/i.test(lower)) {
      item.text = 'This is a sample message for preview purposes.';
      item.sender = fakeName();
      item.read = Math.random() > 0.5;
    } else if (/task|todo|ticket|issue/i.test(lower)) {
      item.title = capitalize(type) + ' #' + id;
      item.description = 'Sample task description for preview.';
      item.status = ['open', 'in-progress', 'done'][id % 3];
      item.priority = ['low', 'medium', 'high'][id % 3];
      item.assignee = fakeName();
    } else {
      // Generic item.
      item.name = capitalize(type) + ' ' + id;
      item.status = 'active';
      item.description = 'Sample ' + type + ' for preview.';
    }
    return item;
  }

  function fakeName() {
    var first = ['John', 'Jane', 'Alex', 'Sam', 'Chris', 'Pat', 'Jordan', 'Taylor', 'Morgan', 'Casey'];
    var last = ['Smith', 'Johnson', 'Brown', 'Davis', 'Wilson', 'Miller', 'Lee', 'Garcia', 'Martinez', 'Anderson'];
    return first[Math.floor(Math.random() * first.length)] + ' ' + last[Math.floor(Math.random() * last.length)];
  }

  function fakeEmail() {
    return 'user' + Math.floor(Math.random() * 9999) + '@example.com';
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  function fakeGraphQLResponse(opName) {
    var lower = (opName || '').toLowerCase();
    if (/login|signin|auth/i.test(lower)) return { token: 'mock_jwt_' + Math.random().toString(36).slice(2), user: fakeUser(null) };
    if (/user|me|viewer/i.test(lower)) return { user: fakeUser(null) };
    if (/users|list|all/i.test(lower)) return { users: [fakeItem('user'), fakeItem('user'), fakeItem('user')] };
    var key = lower.replace(/^(get|fetch|list|all|query)/, '') || 'data';
    var obj = {};
    obj[key] = [fakeItem(key), fakeItem(key), fakeItem(key)];
    return obj;
  }

  // ---- Fetch override ----
  var realFetch = window.fetch;
  window.fetch = function(input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    var method = (init && init.method) || (input && input.method) || 'GET';

    // If it's not API-like, pass through without mocking.
    if (!isApiLike(url)) {
      return realFetch.call(window, input, init);
    }

    var callId = 'call_' + (++callCounter);
    var startTime = Date.now();
    var body = init && init.body;

    // In fake mode, skip the real call entirely.
    if (SKIP_REAL) {
      var fake = generateFakeResponse(url, method, body);
      var fakeResp = new Response(JSON.stringify(fake.body), {
        status: fake.status,
        headers: { 'Content-Type': 'application/json' },
      });
      log({
        id: callId, url: url, method: method, status: 'mocked',
        statusCode: fake.status, timestamp: Date.now(),
        fakeReason: 'Fake mode — real calls skipped',
      });
      return Promise.resolve(fakeResp);
    }

    // Try real call with timeout.
    var controller = null;
    var timeoutId = null;
    try { controller = new AbortController(); } catch(e) {}
    if (controller) {
      timeoutId = setTimeout(function() { controller.abort(); }, ${timeoutMs});
    }

    var fetchPromise = realFetch.call(window, input, Object.assign({}, init, controller ? { signal: controller.signal } : {}));

    return fetchPromise.then(function(resp) {
      if (timeoutId) clearTimeout(timeoutId);

      // Check if the response looks like a real API response or if the
      // "real" call actually hit a dev server / fallback HTML page (which
      // happens when the iframe shares the parent's origin). We clone the
      // response so we can inspect it without consuming the body.
      var contentType = resp.headers.get('content-type') || '';
      var isJson = contentType.indexOf('application/json') >= 0;
      var isApiPath = /\\/api\\//i.test(url) || url.startsWith('/api/');

      // If it's an /api/ call but the response isn't JSON, the "real" call
      // almost certainly hit the parent dev server's HTML fallback rather
      // than a real backend. Treat it as a failure and fall back to mock.
      if (isApiPath && !isJson) {
        var fake = generateFakeResponse(url, method, body);
        var fakeResp = new Response(JSON.stringify(fake.body), {
          status: fake.status,
          headers: { 'Content-Type': 'application/json' },
        });
        log({
          id: callId, url: url, method: method, status: 'mocked',
          statusCode: fake.status, timestamp: Date.now(),
          fakeReason: 'No real backend (response was HTML, not JSON)',
          duration: Date.now() - startTime,
        });
        return fakeResp;
      }

      log({
        id: callId, url: url, method: method, status: 'live',
        statusCode: resp.status, timestamp: Date.now(),
        duration: Date.now() - startTime,
      });
      return resp;
    }).catch(function(err) {
      if (timeoutId) clearTimeout(timeoutId);
      // Real call failed — fall back to mock.
      var fake = generateFakeResponse(url, method, body);
      var fakeResp = new Response(JSON.stringify(fake.body), {
        status: fake.status,
        headers: { 'Content-Type': 'application/json' },
      });
      log({
        id: callId, url: url, method: method, status: 'mocked',
        statusCode: fake.status, timestamp: Date.now(),
        fakeReason: err && err.name === 'AbortError' ? 'Timeout (' + ${timeoutMs} + 'ms)' : (err && err.message ? err.message : 'Network error'),
        duration: Date.now() - startTime,
      });
      return fakeResp;
    });
  };

  // ---- XMLHttpRequest override ----
  var RealXHR = window.XMLHttpRequest;
  function MockXHR() {
    var xhr = new RealXHR();
    var _method = 'GET';
    var _url = '';
    var _body = null;
    var _callId = 'call_' + (++callCounter);
    var _startTime = 0;

    var realOpen = xhr.open;
    xhr.open = function(method, url) {
      _method = method;
      _url = url;
      _startTime = Date.now();
      return realOpen.apply(xhr, arguments);
    };

    var realSend = xhr.send;
    xhr.send = function(body) {
      _body = body;

      if (!isApiLike(_url)) {
        return realSend.call(xhr, body);
      }

      if (SKIP_REAL) {
        var fake = generateFakeResponse(_url, _method, body);
        setTimeout(function() {
          Object.defineProperty(xhr, 'status', { value: fake.status, writable: true });
          Object.defineProperty(xhr, 'responseText', { value: JSON.stringify(fake.body), writable: true });
          Object.defineProperty(xhr, 'response', { value: JSON.stringify(fake.body), writable: true });
          Object.defineProperty(xhr, 'readyState', { value: 4, writable: true });
          xhr.getAllResponseHeaders = function() { return 'Content-Type: application/json'; };
          xhr.getResponseHeader = function(h) { return h.toLowerCase() === 'content-type' ? 'application/json' : null; };
          if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange();
          if (typeof xhr.onload === 'function') xhr.onload();
          if (typeof xhr.dispatchEvent === 'function') xhr.dispatchEvent(new Event('load'));
          log({
            id: _callId, url: _url, method: _method, status: 'mocked',
            statusCode: fake.status, timestamp: Date.now(),
            fakeReason: 'Fake mode — real calls skipped',
          });
        }, 10);
        return;
      }

      // Try real XHR with manual timeout.
      var timedOut = false;
      var timer = setTimeout(function() {
        timedOut = true;
        xhr.abort();
      }, ${timeoutMs});

      xhr.addEventListener('loadend', function() {
        clearTimeout(timer);
        if (timedOut || xhr.status === 0) {
          // Real failed — fake it.
          var fake = generateFakeResponse(_url, _method, body);
          Object.defineProperty(xhr, 'status', { value: fake.status, writable: true });
          Object.defineProperty(xhr, 'responseText', { value: JSON.stringify(fake.body), writable: true });
          Object.defineProperty(xhr, 'response', { value: JSON.stringify(fake.body), writable: true });
          log({
            id: _callId, url: _url, method: _method, status: 'mocked',
            statusCode: fake.status, timestamp: Date.now(),
            fakeReason: timedOut ? 'Timeout (' + ${timeoutMs} + 'ms)' : 'Network error',
            duration: Date.now() - _startTime,
          });
        } else {
          log({
            id: _callId, url: _url, method: _method, status: 'live',
            statusCode: xhr.status, timestamp: Date.now(),
            duration: Date.now() - _startTime,
          });
        }
      });

      realSend.call(xhr, body);
    };

    return xhr;
  }
  MockXHR.prototype = RealXHR.prototype;
  window.XMLHttpRequest = MockXHR;

  // Notify parent that the mock layer is ready.
  notifyParent();
})();</script>`;
}
