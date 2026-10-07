// LUCIAN Vault API — Security settings.
// GET  /api/vault/security    — get current settings
// PUT  /api/vault/security    — update settings
//
// Returns server-validated security configuration.
// DB-backed: settings are persisted in the VaultSecuritySettings table
// (row id "default"). When the database is unavailable, GET returns
// defaults and PUT returns 503.
//
// IMPORTANT: twoFactorRequired=true is supported as a SETTING, but
// twoFactorConfigured becomes true only when Phase 16 (Auth) ships a
// real 2FA enrollment flow. Until then, if the user enables
// twoFactorRequired, withdrawals are blocked at the validation layer
// with "Authentication / account security setup required." We never
// fake 2FA verification.

import { NextResponse } from "next/server";
import { apiError } from "@/lib/vault/validation";
import { db } from "@/lib/db";
import { isDatabaseAvailable } from "@/lib/vault/ledger-db";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_SETTINGS = {
  requireWithdrawalVerification: true,
  twoFactorRequired: false,
  twoFactorConfigured: false,
  newDestinationDelayHours: 24,
  dailyFiatWithdrawalLimit: 1000000n,
  dailyCryptoWithdrawalLimitFiat: 500000n,
  largeTransactionThreshold: 100000n,
  cryptoAddressAllowlist: [] as Array<{ address: string; label: string }>,
  newDeviceWithdrawalRestriction: true,
  maskSensitiveValues: false,
  sessionTimeoutMin: 30,
};

/** Phase 16: find the user's security settings row, or fall back to
 *  the shared "default" row (pre-Phase 16 behavior). Each user can
 *  have their own row (id=userId, ownerUserId=userId); legacy shared
 *  default row has ownerUserId=NULL. */
async function findUserSettings(userId: string) {
  return db.vaultSecuritySettings.findFirst({
    where: { OR: [{ ownerUserId: userId }, { id: "default", ownerUserId: null }] },
  });
}

export async function GET() {
  // Phase 16: ownership scoping.
  let userId: string;
  try {
    userId = await requireVaultOwner();
  } catch {
    return unauthorizedVaultResponse();
  }

  if (!isDatabaseAvailable()) {
    return NextResponse.json({
      ...DEFAULT_SETTINGS,
      dailyFiatWithdrawalLimit: Number(DEFAULT_SETTINGS.dailyFiatWithdrawalLimit),
      dailyCryptoWithdrawalLimitFiat: Number(DEFAULT_SETTINGS.dailyCryptoWithdrawalLimitFiat),
      largeTransactionThreshold: Number(DEFAULT_SETTINGS.largeTransactionThreshold),
      databaseAvailable: false,
      message: "Database unavailable. Showing default security settings; updates are not persisted.",
    });
  }

  const settings = await findUserSettings(userId);
  if (!settings) {
    // No row for this user yet — return defaults. The PUT route will
    // create a per-user row on first update.
    return NextResponse.json({
      ...DEFAULT_SETTINGS,
      dailyFiatWithdrawalLimit: Number(DEFAULT_SETTINGS.dailyFiatWithdrawalLimit),
      dailyCryptoWithdrawalLimitFiat: Number(DEFAULT_SETTINGS.dailyCryptoWithdrawalLimitFiat),
      largeTransactionThreshold: Number(DEFAULT_SETTINGS.largeTransactionThreshold),
      databaseAvailable: true,
    });
  }

  return NextResponse.json({
    requireWithdrawalVerification: settings.requireWithdrawalVerification,
    twoFactorRequired: settings.twoFactorRequired,
    twoFactorConfigured: settings.twoFactorConfigured,
    newDestinationDelayHours: settings.newDestinationDelayHours,
    dailyFiatWithdrawalLimit: Number(settings.dailyFiatWithdrawalLimit),
    dailyCryptoWithdrawalLimitFiat: Number(settings.dailyCryptoWithdrawalLimitFiat),
    largeTransactionThreshold: Number(settings.largeTransactionThreshold),
    cryptoAddressAllowlist: settings.cryptoAddressAllowlist as Array<{ address: string; label: string }>,
    newDeviceWithdrawalRestriction: settings.newDeviceWithdrawalRestriction,
    maskSensitiveValues: settings.maskSensitiveValues,
    sessionTimeoutMin: settings.sessionTimeoutMin,
    databaseAvailable: true,
  });
}

export async function PUT(req: Request) {
  // Phase 16: ownership scoping + per-user row.
  let userId: string;
  try {
    userId = await requireVaultOwner();
  } catch {
    return unauthorizedVaultResponse();
  }

  if (!isDatabaseAvailable()) {
    return apiError(
      "Database unavailable. Security settings cannot be persisted.",
      503, "database_required",
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const updates: Record<string, unknown> = {};

  if (typeof body.requireWithdrawalVerification === "boolean") {
    updates.requireWithdrawalVerification = body.requireWithdrawalVerification;
  }
  if (typeof body.newDeviceWithdrawalRestriction === "boolean") {
    updates.newDeviceWithdrawalRestriction = body.newDeviceWithdrawalRestriction;
  }
  if (typeof body.maskSensitiveValues === "boolean") {
    updates.maskSensitiveValues = body.maskSensitiveValues;
  }
  if (typeof body.twoFactorRequired === "boolean") {
    updates.twoFactorRequired = body.twoFactorRequired;
  }

  const intFields = ["newDestinationDelayHours", "sessionTimeoutMin"];
  for (const f of intFields) {
    if (body[f] !== undefined) {
      const v = typeof body[f] === "string" ? parseInt(body[f] as string, 10) : body[f];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
        return apiError(`Invalid value for ${f}.`, 400);
      }
      updates[f] = Math.floor(v);
    }
  }
  const minorUnitFields = ["dailyFiatWithdrawalLimit", "dailyCryptoWithdrawalLimitFiat", "largeTransactionThreshold"];
  for (const f of minorUnitFields) {
    if (body[f] !== undefined) {
      const v = typeof body[f] === "string" ? parseFloat(body[f] as string) : body[f];
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
        return apiError(`Invalid value for ${f}.`, 400);
      }
      updates[f] = BigInt(Math.round(v));
    }
  }

  if (Array.isArray(body.cryptoAddressAllowlist)) {
    const valid = body.cryptoAddressAllowlist.every(
      (item) => typeof item === "object" && item !== null &&
        typeof (item as Record<string, unknown>).address === "string" &&
        typeof (item as Record<string, unknown>).label === "string",
    );
    if (!valid) {
      return apiError("cryptoAddressAllowlist must be an array of {address, label} objects.", 400);
    }
    updates.cryptoAddressAllowlist = body.cryptoAddressAllowlist;
  }

  // Phase 16: upsert by the user's id, stamp ownerUserId.
  const refreshed = await db.vaultSecuritySettings.upsert({
    where: { id: userId },
    create: { id: userId, ownerUserId: userId, ...updates },
    update: updates,
  });

  return NextResponse.json({
    requireWithdrawalVerification: refreshed.requireWithdrawalVerification,
    twoFactorRequired: refreshed.twoFactorRequired,
    twoFactorConfigured: refreshed.twoFactorConfigured,
    newDestinationDelayHours: refreshed.newDestinationDelayHours,
    dailyFiatWithdrawalLimit: Number(refreshed.dailyFiatWithdrawalLimit),
    dailyCryptoWithdrawalLimitFiat: Number(refreshed.dailyCryptoWithdrawalLimitFiat),
    largeTransactionThreshold: Number(refreshed.largeTransactionThreshold),
    cryptoAddressAllowlist: refreshed.cryptoAddressAllowlist,
    newDeviceWithdrawalRestriction: refreshed.newDeviceWithdrawalRestriction,
    maskSensitiveValues: refreshed.maskSensitiveValues,
    sessionTimeoutMin: refreshed.sessionTimeoutMin,
    databaseAvailable: true,
    message: "Security settings updated.",
  });
}
