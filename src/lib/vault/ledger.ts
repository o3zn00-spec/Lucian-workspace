// LUCIAN Vault — Ledger facade.
//
// This file re-exports the durable, database-backed ledger service
// (`ledger-db.ts`) as the canonical implementation. The legacy
// in-memory `VaultLedger` class has been REMOVED — it was process-local
// and therefore unsafe for Vercel/serverless, and it allowed the
// same-account net-zero bug that this correction explicitly forbids.
//
// All API routes that need authoritative financial state MUST import from
// `@/lib/vault/ledger-db` (or from this re-export). They MUST handle
// `DatabaseUnavailableError` by returning 503.
//
// The Zustand store (`src/store/vault.ts`) is UNAFFECTED — it continues
// to manage:
//   - UI cache of server-derived balances (re-fetched from this service)
//   - Manual (self-reported) accounts and their local transfers
//   - Capital pool allocations (internal bookkeeping, NOT real transfers)
//   - UI preferences and the local privacy lock
//
// Manual money and provider money stay clearly separated:
//   - Manual balances live in the client Zustand store (localStorage).
//   - Provider-backed balances are DERIVED from this ledger service.
//   - The two are NEVER mixed in the same `available` figure without
//     explicit labeling.

export type {
  LedgerEntry,
  LedgerEntryType,
  IdempotencyRecord,
  ProcessedProviderEvent,
} from "./ledger-db";

export {
  VaultLedgerService,
  DatabaseUnavailableError,
  IdempotencyConflictError,
  DuplicateProviderEventError,
  TransactionNotFoundError,
  getLedgerService,
  tryGetLedgerService,
  isDatabaseAvailable,
} from "./ledger-db";

export {
  InvalidTransitionError,
  isAllowedTransition,
  normalizeProviderStatus,
} from "./ledger-db";

export type { TransactionStatus } from "./transitions";
