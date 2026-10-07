// LUCIAN Vault — Explicit status transition matrix.
//
// Provider-backed financial operations have a strict lifecycle.
// This module is the SINGLE SOURCE OF TRUTH for which transitions are
// allowed. Both the API layer (initiating operations) and the webhook
// layer (processing provider events) MUST consult this matrix before
// mutating a transaction's status.
//
// Invariants enforced here:
//   1. `failed → completed` is FORBIDDEN. A failed transaction is
//      terminal. If a provider genuinely reverses a failure, a NEW
//      VaultTransaction with type=adjustment and reversalOfId is created.
//   2. `cancelled → completed` is FORBIDDEN. Same reason.
//   3. `completed` is terminal — no transitions out.
//   4. Skipping ahead (e.g. pending → completed) is allowed only when
//      the provider explicitly says so (e.g. instant settlement).

export type TransactionStatus =
  | "requested"
  | "pending"
  | "processing"
  | "requires-action"
  | "completed"
  | "failed"
  | "cancelled";

/** All allowed transitions. Anything not listed is FORBIDDEN. */
const ALLOWED: Record<TransactionStatus, TransactionStatus[]> = {
  "requested":       ["pending", "processing", "failed", "cancelled"],
  "pending":         ["processing", "requires-action", "completed", "failed", "cancelled"],
  "processing":      ["completed", "failed"],
  "requires-action": ["processing", "failed", "cancelled"],
  "completed":       [], // terminal
  "failed":          [], // terminal
  "cancelled":       [], // terminal
};

export function isAllowedTransition(
  from: TransactionStatus,
  to: TransactionStatus,
): boolean {
  if (from === to) return true; // no-op is always allowed (idempotent)
  return ALLOWED[from]?.includes(to) ?? false;
}

export function assertTransition(
  from: TransactionStatus,
  to: TransactionStatus,
): void {
  if (!isAllowedTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: TransactionStatus,
    public readonly to: TransactionStatus,
  ) {
    super(`Invalid status transition: ${from} → ${to}. ` +
      (from === "completed" || from === "failed" || from === "cancelled"
        ? `${from} is terminal — create a new transaction instead.`
        : `Allowed from ${from}: ${ALLOWED[from]?.join(", ") || "(none)"}`));
    this.name = "InvalidTransitionError";
  }
}

/** Check whether a status is terminal (no further transitions). */
export function isTerminal(status: TransactionStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

/**
 * Map a provider-reported status string to our internal status.
 * Provider strings vary; this normalizes them. Unknown strings
 * default to "processing" (the safe middle state — never auto-credit).
 */
export function normalizeProviderStatus(
  raw: string | undefined,
): TransactionStatus {
  if (!raw) return "processing";
  const s = raw.toLowerCase();
  if (s.includes("pending"))      return "pending";
  if (s.includes("processing") || s.includes("in_review") || s.includes("submitted")) return "processing";
  if (s.includes("requires") || s.includes("action_required") || s.includes("3ds")) return "requires-action";
  if (s.includes("succeeded") || s.includes("completed") || s.includes("settled") || s.includes("confirmed")) return "completed";
  if (s.includes("failed") || s.includes("canceled") || s.includes("cancelled") || s.includes("rejected") || s.includes("declined")) return "failed";
  if (s.includes("cancel")) return "cancelled";
  return "processing";
}
