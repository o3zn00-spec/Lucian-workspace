// LUCIAN Vault — Internal ledger account identifiers.
//
// Canonical names for every internal account the ledger can move money
// to/from. Money NEVER appears or disappears — it always moves from one
// of these to another. The debit and credit MUST be distinct.

export type LedgerAccountType =
  | "provider-clearing"     // external money in transit to/from a provider
  | "cash-pending"          // inbound funds awaiting provider settlement
  | "cash-available"        // settled, withdrawable cash
  | "sandbox-cash-available" // persistent demo funds; NEVER withdrawable
  | "cash-reserved"         // holds (e.g. open withdrawal requests)
  | "withdrawal-pending"    // outbound funds awaiting provider completion
  | "trading-cash"          // cash inside the brokerage
  | "trading-reserved"      // cash reserved for open orders
  | "trading-buying-power"  // brokerage buying power (provider-supplied)
  | "trading-positions"     // market value of open positions
  | "crypto-custody"        // crypto held by the custodian
  | "fee-account";          // fees collected

export const ALL_LEDGER_ACCOUNTS: readonly LedgerAccountType[] = [
  "provider-clearing",
  "cash-pending",
  "cash-available",
  "sandbox-cash-available",
  "cash-reserved",
  "withdrawal-pending",
  "trading-cash",
  "trading-reserved",
  "trading-buying-power",
  "trading-positions",
  "crypto-custody",
  "fee-account",
];

/**
 * Invariant: a ledger entry MUST NOT debit and credit the same account.
 * A same-account entry would produce a fake net-zero movement and is
 * forbidden by the accounting model.
 */
export function assertDistinctAccounts(
  debit: LedgerAccountType,
  credit: LedgerAccountType,
): void {
  if (debit === credit) {
    throw new SameAccountEntryError(debit);
  }
}

export class SameAccountEntryError extends Error {
  constructor(public readonly account: LedgerAccountType) {
    super(
      `Illegal ledger entry: debit and credit are the same account ` +
      `(${account}). A same-account entry produces a fake net-zero ` +
      `movement and is forbidden by the LUCIAN accounting model.`,
    );
    this.name = "SameAccountEntryError";
  }
}

/**
 * Validate that a string is a known ledger account.
 * Throws on unknown strings so typos can't silently produce invalid entries.
 */
export function asLedgerAccount(s: string): LedgerAccountType {
  if (!ALL_LEDGER_ACCOUNTS.includes(s as LedgerAccountType)) {
    throw new Error(`Unknown ledger account: ${s}`);
  }
  return s as LedgerAccountType;
}
