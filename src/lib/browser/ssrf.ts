// LUCIAN Browser — SSRF protection utilities (Phase 15 hardening).
//
// Provides DNS-resolution-aware SSRF protection for server-side fetches.
// Reuses the proven `isSafeHttpUrl` from News Phase 13 (article-media.ts)
// as a first-level URL filter, then adds DNS-level protection on top.
//
// Key protections:
//   1. Resolve ALL IPv4 + IPv6 addresses for the hostname.
//   2. Reject if ANY resolved address is loopback/private/link-local/
//      CGNAT/reserved/multicast.
//   3. Re-check DNS for every redirect hostname (the caller creates a
//      new request per redirect, each with a fresh `safeLookup` call).
//   4. DNS rebinding protection: `safeLookup` is designed to be passed
//      as the `lookup` option to Node's `http.request()`/`https.request()`.
//      It resolves + validates AT CONNECTION TIME, so the validated IP
//      IS the IP used for the TCP connection — closing the TOCTOU gap
//      between a detached DNS lookup and an unrelated fetch.

import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupOptions, LookupAddress } from "node:dns";

// ── IPv4 range validation ────────────────────────────────────────────────

/** Check if an IPv4 address is in a blocked range.
 *  Blocks: private (RFC1918), loopback, link-local, CGNAT, "this host",
 *  multicast, reserved, and the 0.0.0.0/8 range. */
export function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true; // malformed → block
  }
  const [a, b] = parts;
  if (a === 0) return true;                        // 0.0.0.0/8 "this host"
  if (a === 10) return true;                       // 10.0.0.0/8 private (RFC1918)
  if (a === 127) return true;                      // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true;         // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true;// 172.16.0.0/12 private (RFC1918)
  if (a === 192 && b === 168) return true;         // 192.168.0.0/16 private (RFC1918)
  if (a === 100 && b >= 64 && b <= 127) return true;// 100.64.0.0/10 CGNAT (RFC6598)
  if (a >= 224) return true;                       // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

// ── IPv6 range validation ─────────────────────────────────────────────────

/** Check if an IPv6 address is in a blocked range.
 *  Blocks: loopback (::1), unspecified (::), ULA (fc00::/7), link-local
 *  (fe80::/10), multicast (ff00::/8), documentation (2001:db8::/32),
 *  and IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) whose IPv4 part is
 *  blocked. */
export function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().trim();

  // IPv4-mapped IPv6: ::ffff:x.x.x.x — validate the embedded IPv4.
  const v4MappedMatch = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4MappedMatch) {
    return isBlockedIPv4(v4MappedMatch[1]);
  }

  // IPv4-compatible IPv6: ::x.x.x.x (deprecated but still seen).
  const v4CompatMatch = lower.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (v4CompatMatch) {
    return isBlockedIPv4(v4CompatMatch[1]);
  }

  if (lower === "::1") return true;               // loopback
  if (lower === "::") return true;                 // unspecified
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
  if (lower.startsWith("fe80")) return true;       // link-local fe80::/10
  if (lower.startsWith("ff")) return true;         // multicast ff00::/8
  if (lower.startsWith("2001:db8")) return true;   // documentation 2001:db8::/32
  if (lower.startsWith("100::")) return true;      // discard-only 100::/64
  return false;
}

/** Check if an IP address (IPv4 or IPv6) is in a blocked range.
 *  `family` is 4 for IPv4, 6 for IPv6 (matching Node's `dns.LookupAddress`). */
export function isBlockedAddress(ip: string, family: number): boolean {
  if (family === 4) return isBlockedIPv4(ip);
  if (family === 6) return isBlockedIPv6(ip);
  return true; // unknown family → block
}

// ── Blocked address error ────────────────────────────────────────────────

/** Error thrown when a DNS lookup resolves to a blocked address.
 *  This error type is preserved through Node's request `error` event so
 *  callers can distinguish SSRF-rejected fetches from network failures. */
export class BlockedAddressError extends Error {
  readonly hostname: string;
  readonly address: string;
  constructor(hostname: string, address: string) {
    super(`Blocked address ${address} for ${hostname}`);
    this.name = "BlockedAddressError";
    this.hostname = hostname;
    this.address = address;
  }
}

// ── DNS rebinding-safe lookup function ────────────────────────────────────

/**
 * Custom DNS lookup function for Node's HTTP(S) client.
 *
 * Designed to be passed as the `lookup` option to `http.request()` /
 * `https.request()`. It:
 *
 * 1. Resolves ALL IPv4 + IPv6 addresses for the hostname via
 *    `dns.promises.lookup({ all: true, family: 0 })`.
 * 2. Validates EVERY resolved address against `isBlockedAddress()`.
 * 3. If ANY address is blocked, rejects with a `BlockedAddressError`.
 * 4. Returns the validated address(es) in the format Node expects:
 *      - If `options.all === true`: callback(null, addresses[]) — array
 *      - If `options.all !== true`: callback(null, address, family) — single
 *
 * By validating at connection time (inside the lookup callback), we
 * close the TOCTOU gap between DNS resolution and the actual outbound
 * connection. The IP returned here is the one Node's `net.Socket`
 * uses for the TCP connection.
 *
 * For redirect handling: each redirect creates a new request with a
 * new `lookup` call, so DNS is re-resolved and re-validated for every
 * redirect hostname.
 *
 * Limitations:
 *   - There is a microsecond-level window between the lookup callback
 *     returning and the actual TCP SYN. Full protection against this
 *     would require a custom socket connection — out of scope for
 *     Phase 15 ("as far as practical").
 *   - `dns.lookup` uses the OS resolver (getaddrinfo) which respects
 *     /etc/hosts. If /etc/hosts maps a hostname to 127.0.0.1, the
 *     validation catches it (the IP is checked). This is correct.
 */
export function safeLookup(
  hostname: string,
  options: LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family: number) => void,
): void {
  dnsLookup(hostname, { all: true, family: 0 })
    .then((addresses) => {
      if (addresses.length === 0) {
        const err = new Error(`DNS: no addresses resolved for ${hostname}`) as NodeJS.ErrnoException;
        callback(err, "", 4);
        return;
      }
      // Validate EVERY resolved address. If ANY is blocked, reject.
      for (const addr of addresses) {
        if (isBlockedAddress(addr.address, addr.family)) {
          const err = new BlockedAddressError(hostname, addr.address) as NodeJS.ErrnoException;
          callback(err, "", 4);
          return;
        }
      }
      // Return in the format Node expects based on options.all.
      // When Node's HTTP client passes { all: true } (which it does
      // internally for some code paths), it expects an array. Otherwise
      // it expects a single (address, family) pair.
      if (options?.all) {
        callback(null, addresses, 0);
      } else {
        callback(null, addresses[0].address, addresses[0].family);
      }
    })
    .catch((err) => {
      const errnoErr = (err instanceof Error ? err : new Error(String(err))) as NodeJS.ErrnoException;
      callback(errnoErr, "", 4);
    });
}
