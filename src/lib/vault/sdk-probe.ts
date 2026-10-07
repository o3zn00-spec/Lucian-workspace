// LUCIAN Vault — Provider SDK availability probe.
//
// Used by the provider adapters to honestly report whether the real
// provider SDK is installed (vs. the adapter being a stub).
//
// Uses Node's `createRequire` so it works in ESM contexts (Vercel
// serverless, Next.js route handlers) and does NOT require TypeScript
// type declarations for the probed module — we only ask "does this
// module resolve?" without actually importing it.

import { createRequire } from "module";

const require = createRequire(import.meta.url);

/**
 * Return true if the given npm module is installed and resolvable.
 * Never throws — returns false on any resolution error.
 */
export function isModuleInstalled(name: string): boolean {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}
