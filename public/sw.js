/* LUCIAN Workspace — Service Worker
 *
 * Caches static application assets for offline use. Does NOT cache:
 *   - API responses (dynamic, may contain sensitive data)
 *   - Market data
 *   - Authentication/API keys
 *
 * Strategy:
 *   - Public static assets only: cache-first with network fallback
 *   - Private/auth navigations: network-only (never persist account HTML)
 *   - API routes: network-only (never cache)
 *   - Everything else: network-first with cache fallback
 */

const CACHE_NAME = "lucian-workspace-private-static-v2";
const APP_SHELL = [
  "/manifest.json",
  "/icon.png",
  "/branding/lucian-workspace-logo.png",
  "/branding/lucian-workspace-favicon.png",
  "/branding/icon-32.png",
  "/apple-icon.png",
];

// Install — pre-cache the app shell.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

// Activate — clean up old caches.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key.startsWith("lucian-workspace-") && key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Fetch — route requests appropriately.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept external resources, writes, APIs, or account navigations.
  if (url.origin !== self.location.origin || request.method !== "GET" ||
      url.pathname.startsWith("/api/") || request.mode === "navigate") {
    return; // Let the browser handle it (network-only).
  }

  // For static assets: cache-first, fall back to network.
  if (
    request.destination === "style" ||
    request.destination === "script" ||
    request.destination === "image" ||
    request.destination === "font"
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        // Only immutable, versioned assets are safe to serve cache-first.
        // Mutable bundles (including next dev) must not outlive their HTML.
        if (cached && /immutable/i.test(cached.headers.get("cache-control") || "")) return cached;
        return fetch(request).then((res) => {
          if (res.ok && !res.redirected && res.type === "basic" &&
              !/no-store|private/i.test(res.headers.get("cache-control") || "")) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return res;
        }).catch(() => {
          if (cached) return cached;
          return Response.error();
        });
      })
    );
    return;
  }

  // Everything else: network-first.
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
