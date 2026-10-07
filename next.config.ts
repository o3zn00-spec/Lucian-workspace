import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Allow the dev server to serve resources when accessed via 127.0.0.1
  // (the workspace's dev preview uses 127.0.0.1, not localhost).
  // This is dev-only and has no effect on production deployments.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // ── Cross-origin isolation — SCOPED to DevWorkspace only (Phase 15) ──
  //
  // Phase 12 (DevWorkspace / WebContainer) requires cross-origin
  // isolation (SharedArrayBuffer) — it needs:
  //   - Cross-Origin-Opener-Policy: same-origin
  //   - Cross-Origin-Embedder-Policy: require-corp
  //
  // Phase 15 (Web Browser) needs the OPPOSITE: cross-origin iframes
  // must be allowed to load without requiring the embedded site to
  // send Cross-Origin-Resource-Policy: cross-origin. Most websites
  // don't send CORP, so under COEP `require-corp` they fail to load
  // inside an iframe.
  //
  // Solution: scope COOP/COEP to /dev-workspace only. The Browser
  // route (and all other routes) run WITHOUT cross-origin isolation,
  // so iframes can embed compatible third-party sites normally.
  //
  // WebContainer is only ever instantiated on the /dev-workspace
  // route, so scoping the headers there preserves Phase 12.
  async headers() {
    const securityHeaders = [
      { key: "Content-Security-Policy", value: "base-uri 'self'; form-action 'self'; frame-ancestors 'self'; object-src 'none'" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "X-DNS-Prefetch-Control", value: "off" },
      { key: "Permissions-Policy", value: "geolocation=(), payment=(), usb=(), browsing-topics=()" },
      ...(process.env.NODE_ENV === "production"
        ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
        : []),
    ];

    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }],
      },
      {
        // DevWorkspace + its sub-paths need cross-origin isolation
        // for SharedArrayBuffer (WebContainer).
        source: "/dev-workspace/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
      {
        // The bare /dev-workspace route also needs the headers
        // (Next.js matches `:path*` only when there's a sub-path).
        source: "/dev-workspace",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
