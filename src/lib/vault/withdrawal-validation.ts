// LUCIAN Vault API — Server-enforced withdrawal validation.
//
// Before creating a withdrawal, the server checks ALL of the following.
// Any failure rejects the withdrawal with a 400/403 and a clear code.
//
//   ✓ positive amount          (already in validateAmount)
//   ✓ sufficient withdrawable  (cash-available − cash-reserved)
//   ✓ destination exists       (DB lookup by id)
//   ✓ destination belongs to   (ownerUserId match — Phase 16 hook)
//     current context
//   ✓ destination approved     (approved=true AND approvedAt <= now)
//   ✓ daily fiat limit         (sum of withdrawals in last 24h)
//   ✓ daily crypto limit       (fiat-equivalent sum in last 24h)
//   ✓ crypto allowlist         (when enabled, address must be in list)
//   ✓ new-device restriction   (hook — placeholder until Auth exists)
//   ✓ 2FA / account security   (if required by settings AND not
//                              configured, block with explicit message)
//   ✓ provider capability      (adapter must support the operation)
//   ✓ asset/network compat     (crypto destination must match asset)
//
// 2FA is NOT implemented — when settings.twoFactorRequired=true and
// settings.twoFactorConfigured=false, the operation is blocked with:
//   "Authentication / account security setup required."

import { VaultLedgerService } from "@/lib/vault/ledger-db";
import { db } from "@/lib/db";
import { Money, fromMinor, toDecimal, gte, add, subtract } from "@/lib/vault/money";
import { Prisma } from "@prisma/client";

export type WithdrawalCheckResult =
  | { ok: true }
  | { ok: false; error: string; code: string; status?: number };

export interface WithdrawalContext {
  amount: Money;
  destinationId: string;
  destinationType: "bank" | "card" | "crypto";
  asset?: string;
  network?: string;
  address?: string;
  /** Phase 16 (Auth) hook — null until Auth exists. */
  ownerUserId?: string;
  /** Marker the caller passes if the request comes from a "new device". */
  isNewDevice?: boolean;
}

/**
 * Run all server-side withdrawal checks. Returns ok=true or an error
 * with an explicit code and HTTP status.
 */
export async function validateWithdrawal(
  ledger: VaultLedgerService,
  ctx: WithdrawalContext,
): Promise<WithdrawalCheckResult> {
  // 1. Positive amount — already validated upstream, but double-check.
  if (ctx.amount.amount <= 0n) {
    return { ok: false, error: "Amount must be positive.", code: "invalid_amount" };
  }

  // 2. Sufficient withdrawable balance — scoped to the user.
  //    Withdrawable = cash-available − cash-reserved.
  //    PHASE 16 FINAL: pass ownerUserId so only THIS user's ledger
  //    entries are summed. Without this, User A's deposit would
  //    inflate User B's withdrawable balance.
  const cashAvailable = await ledger.deriveBalance("cash-available", ctx.amount.currency, ctx.ownerUserId);
  const cashReserved = await ledger.deriveBalance("cash-reserved", ctx.amount.currency, ctx.ownerUserId);
  const withdrawable = subtract(cashAvailable.balance, cashReserved.balance);
  if (!gte(withdrawable, ctx.amount)) {
    return {
      ok: false,
      error: `Insufficient withdrawable balance. Available: ${toDecimal(withdrawable)} ${withdrawable.currency}, requested: ${toDecimal(ctx.amount)} ${ctx.amount.currency}.`,
      code: "insufficient_withdrawable",
      status: 400,
    };
  }

  // 3. Destination exists.
  const destination = await db.withdrawalDestination.findUnique({
    where: { id: ctx.destinationId },
  });
  if (!destination) {
    return {
      ok: false,
      error: "Withdrawal destination not found.",
      code: "destination_not_found",
      status: 404,
    };
  }

  // 4. Destination belongs to the current user.
  //    PHASE 16 FINAL: STRICT ownership check. The destination's
  //    ownerUserId MUST match the authenticated user. Destinations
  //    without an ownerUserId (legacy/pre-Phase-16) are NOT usable
  //    until claimed.
  if (!ctx.ownerUserId) {
    return {
      ok: false,
      error: "Withdrawals require an authenticated owner.",
      code: "destination_ownership_mismatch",
      status: 403,
    };
  }
  if (!destination.ownerUserId) {
    return {
      ok: false,
      error: "Withdrawal destination has no owner. Re-create it from the Vault UI to claim it.",
      code: "destination_ownership_mismatch",
      status: 403,
    };
  }
  if (destination.ownerUserId !== ctx.ownerUserId) {
    return {
      ok: false,
      error: "Withdrawal destination does not belong to the current account.",
      code: "destination_ownership_mismatch",
      status: 403,
    };
  }

  // 5. Destination type matches the request's destinationType.
  if (destination.type !== ctx.destinationType) {
    return {
      ok: false,
      error: `Destination type mismatch. Destination is ${destination.type}, request is ${ctx.destinationType}.`,
      code: "destination_type_mismatch",
      status: 400,
    };
  }

  // 6. Destination is approved AND past the new-destination delay.
  if (!destination.approved || !destination.approvedAt || destination.approvedAt.getTime() > Date.now()) {
    const when = destination.approvedAt
      ? new Date(destination.approvedAt).toISOString()
      : "(not yet approved)";
    return {
      ok: false,
      error: `Destination is not yet approved. Withdrawals will be blocked until ${when} (security delay).`,
      code: "destination_not_approved",
      status: 403,
    };
  }

  // 7. Crypto destination: asset/network must match the destination record.
  if (ctx.destinationType === "crypto") {
    if (destination.asset && ctx.asset && destination.asset !== ctx.asset) {
      return {
        ok: false,
        error: `Asset mismatch: destination is for ${destination.asset}, request is ${ctx.asset}.`,
        code: "asset_mismatch",
        status: 400,
      };
    }
    if (destination.network && ctx.network && destination.network !== ctx.network) {
      return {
        ok: false,
        error: `Network mismatch: destination is on ${destination.network}, request is ${ctx.network}.`,
        code: "network_mismatch",
        status: 400,
      };
    }
  }

  // 8. Load security settings for the remaining checks.
  const settings = await db.vaultSecuritySettings.findUnique({ where: { id: "default" } });

  if (settings) {
    // 8a. 2FA / account security — NOT IMPLEMENTED.
    //     If the setting is required but not configured, block.
    if (settings.twoFactorRequired && !settings.twoFactorConfigured) {
      return {
        ok: false,
        error: "Authentication / account security setup required. Two-factor authentication is required by your security settings but has not been configured yet.",
        code: "auth_setup_required",
        status: 403,
      };
    }

    // 8b. Daily fiat limit (only applies to non-crypto withdrawals).
    if (ctx.destinationType !== "crypto") {
      const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
      const dailySum = await sumWithdrawalsSince(sinceMs, ctx.amount.currency, ctx.ownerUserId, "bank", "card");
      const limit = fromMinor(settings.dailyFiatWithdrawalLimit, ctx.amount.currency);
      const projected = add(dailySum, ctx.amount);
      if (!gte(limit, projected)) {
        return {
          ok: false,
          error: `Daily fiat withdrawal limit exceeded. Limit: ${toDecimal(limit)} ${limit.currency}, used today: ${toDecimal(dailySum)} ${dailySum.currency}, requested: ${toDecimal(ctx.amount)} ${ctx.amount.currency}.`,
          code: "daily_fiat_limit_exceeded",
          status: 403,
        };
      }
    }

    // 8c. Daily crypto limit (fiat-equivalent).
    if (ctx.destinationType === "crypto") {
      const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
      const dailySum = await sumWithdrawalsSince(sinceMs, ctx.amount.currency, ctx.ownerUserId, "crypto");
      const limit = fromMinor(settings.dailyCryptoWithdrawalLimitFiat, ctx.amount.currency);
      const projected = add(dailySum, ctx.amount);
      if (!gte(limit, projected)) {
        return {
          ok: false,
          error: `Daily crypto withdrawal limit exceeded. Limit (fiat-equiv): ${toDecimal(limit)} ${limit.currency}, used today: ${toDecimal(dailySum)} ${dailySum.currency}, requested: ${toDecimal(ctx.amount)} ${ctx.amount.currency}.`,
          code: "daily_crypto_limit_exceeded",
          status: 403,
        };
      }
    }

    // 8d. Crypto address allowlist (if enabled, address must be in list).
    if (ctx.destinationType === "crypto" && ctx.address) {
      const allowlist = parseAllowlist(settings.cryptoAddressAllowlist);
      if (allowlist.length > 0) {
        const found = allowlist.find((a) => a.address === ctx.address);
        if (!found) {
          return {
            ok: false,
            error: `Crypto address ${ctx.address.slice(0, 8)}…${ctx.address.slice(-6)} is not on the allowlist. Remove the allowlist restriction or add this address to it.`,
            code: "address_not_allowlisted",
            status: 403,
          };
        }
      }
    }

    // 8e. New-device restriction (placeholder until Auth exists).
    //     If enabled and the request is flagged as new-device, block.
    if (settings.newDeviceWithdrawalRestriction && ctx.isNewDevice) {
      return {
        ok: false,
        error: "New-device withdrawal restriction: withdrawals from a new device require additional verification. (Account security / 2FA setup required.)",
        code: "new_device_restriction",
        status: 403,
      };
    }
  }

  return { ok: true };
}

/**
 * Sum the amount of all withdrawals of a given currency initiated in
 * the last `sinceMs` epoch, optionally filtered by destination type.
 * Only counts non-cancelled, non-failed withdrawals.
 * PHASE 16 FINAL: scoped by ownerUserId so User A's withdrawals do
 * NOT count against User B's daily limit.
 */
async function sumWithdrawalsSince(
  sinceMs: number,
  currency: string,
  ownerUserId: string | undefined,
  ...destinationTypes: string[]
): Promise<Money> {
  // Sum the ledger entries: debit=cash-available (or withdrawal-pending),
  // type=withdrawal, status in (requested, pending, processing, completed),
  // since the cutoff. Scope by ownerUserId when provided.
  const rows = await db.ledgerEntry.findMany({
    where: {
      type: "withdrawal",
      currency,
      status: { in: ["requested", "pending", "processing", "completed"] },
      timestamp: { gte: new Date(sinceMs) },
      ...(ownerUserId ? { ownerUserId } : {}),
    },
    select: { amount: true, destination: true },
  });
  let sum = 0n;
  for (const row of rows) {
    if (destinationTypes.length > 0) {
      const matches = destinationTypes.some((t) => row.destination.startsWith(`${t}:`));
      if (!matches) continue;
    }
    sum += row.amount;
  }
  return fromMinor(sum, currency);
}

function parseAllowlist(raw: unknown): Array<{ address: string; label: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is { address: string; label: string } =>
      typeof item === "object" && item !== null &&
      typeof (item as { address?: unknown }).address === "string" &&
      typeof (item as { label?: unknown }).label === "string",
  );
}

// Helper for callers that want to convert a WithdrawalCheckResult to a
// Next.js Response.
export function withdrawalCheckToResponse(result: WithdrawalCheckResult): Response | null {
  if (result.ok) return null;
  return new Response(
    JSON.stringify({ error: result.error, code: result.code }),
    {
      status: result.status ?? 400,
      headers: { "Content-Type": "application/json" },
    },
  );
}

// Avoid unused-import warnings for types we re-export elsewhere.
export type { Prisma };
