// LUCIAN Vault API — Auto Fund configuration.
// GET  /api/vault/auto-fund    — get current config
// PUT  /api/vault/auto-fund    — update config
//
// Auto Fund cannot be enabled unless a provider is genuinely connected
// (not just configured — must be state="connected"). Idempotency
// protection prevents duplicate charges from webhook loops.
//
// DB-backed: config is persisted in the AutoFundConfig table (row id
// "default"). When the database is unavailable, GET returns the
// defaults and PUT returns 503.

import { NextResponse } from "next/server";
import { isAnyProviderConnected } from "@/lib/vault/providers";
import { apiError } from "@/lib/vault/validation";
import { db } from "@/lib/db";
import { isDatabaseAvailable } from "@/lib/vault/ledger-db";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_CONFIG = {
  enabled: false,
  fundingSourceId: null as string | null,
  fundingSourceType: null as "card" | "bank" | null,
  lowBalanceThreshold: 100000n,
  topUpAmount: 300000n,
  dailyLimit: 1000000n,
  monthlyLimit: 3000000n,
  maxSingleTopUp: 500000n,
  minTriggerIntervalMs: 3600000n,
  maxRetries: 3,
  providerReady: false,
};

/** Phase 16: find the user's auto-fund config, or fall back to defaults. */
async function findUserConfig(userId: string) {
  return db.autoFundConfig.findFirst({
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
      ...DEFAULT_CONFIG,
      lowBalanceThreshold: Number(DEFAULT_CONFIG.lowBalanceThreshold),
      topUpAmount: Number(DEFAULT_CONFIG.topUpAmount),
      dailyLimit: Number(DEFAULT_CONFIG.dailyLimit),
      monthlyLimit: Number(DEFAULT_CONFIG.monthlyLimit),
      maxSingleTopUp: Number(DEFAULT_CONFIG.maxSingleTopUp),
      minTriggerIntervalMs: Number(DEFAULT_CONFIG.minTriggerIntervalMs),
      providerReady: false,
      databaseAvailable: false,
      message: "Database unavailable. Auto Fund is not active.",
    });
  }

  const config = await findUserConfig(userId);
  if (!config) {
    return NextResponse.json({
      ...DEFAULT_CONFIG,
      lowBalanceThreshold: Number(DEFAULT_CONFIG.lowBalanceThreshold),
      topUpAmount: Number(DEFAULT_CONFIG.topUpAmount),
      dailyLimit: Number(DEFAULT_CONFIG.dailyLimit),
      monthlyLimit: Number(DEFAULT_CONFIG.monthlyLimit),
      maxSingleTopUp: Number(DEFAULT_CONFIG.maxSingleTopUp),
      minTriggerIntervalMs: Number(DEFAULT_CONFIG.minTriggerIntervalMs),
      providerReady: isAnyProviderConnected(),
      databaseAvailable: true,
    });
  }

  return NextResponse.json({
    enabled: config.enabled,
    fundingSourceId: config.fundingSourceId,
    fundingSourceType: config.fundingSourceType as "card" | "bank" | null,
    lowBalanceThreshold: Number(config.lowBalanceThreshold),
    topUpAmount: Number(config.topUpAmount),
    dailyLimit: Number(config.dailyLimit),
    monthlyLimit: Number(config.monthlyLimit),
    maxSingleTopUp: Number(config.maxSingleTopUp),
    minTriggerIntervalMs: Number(config.minTriggerIntervalMs),
    maxRetries: config.maxRetries,
    providerReady: isAnyProviderConnected(),
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
      "Database unavailable. Auto Fund configuration cannot be persisted.",
      503, "database_required",
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiError("Invalid JSON body.", 400);
  }

  const providerReady = isAnyProviderConnected();

  if (body.enabled === true && !providerReady) {
    return apiError(
      "Cannot enable Auto Fund — a genuinely CONNECTED provider is required. API keys alone are not enough.",
      403, "provider_required",
    );
  }

  const numericFields: Array<{ key: keyof typeof DEFAULT_CONFIG; min: number }> = [
    { key: "lowBalanceThreshold", min: 0 },
    { key: "topUpAmount", min: 0 },
    { key: "dailyLimit", min: 0 },
    { key: "monthlyLimit", min: 0 },
    { key: "maxSingleTopUp", min: 0 },
    { key: "minTriggerIntervalMs", min: 0 },
  ];
  const updates: Record<string, unknown> = {};
  for (const f of numericFields) {
    if (body[f.key] !== undefined) {
      const v = typeof body[f.key] === "string" ? parseFloat(body[f.key] as string) : body[f.key];
      if (typeof v !== "number" || !Number.isFinite(v) || v < f.min) {
        return apiError(`Invalid value for ${f.key}.`, 400);
      }
      updates[f.key] = BigInt(Math.round(v));
    }
  }
  if (typeof body.maxRetries === "number" && Number.isFinite(body.maxRetries) && body.maxRetries >= 0) {
    updates.maxRetries = Math.floor(body.maxRetries);
  }
  if (typeof body.enabled === "boolean") updates.enabled = body.enabled;
  if (typeof body.fundingSourceId === "string" || body.fundingSourceId === null) {
    updates.fundingSourceId = body.fundingSourceId;
  }
  if (body.fundingSourceType === "card" || body.fundingSourceType === "bank" || body.fundingSourceType === null) {
    updates.fundingSourceType = body.fundingSourceType;
  }
  updates.providerReady = providerReady;

  // Phase 16: upsert by the user's id, stamp ownerUserId.
  const refreshed = await db.autoFundConfig.upsert({
    where: { id: userId },
    create: { id: userId, ownerUserId: userId, ...updates },
    update: updates,
  });

  return NextResponse.json({
    enabled: refreshed.enabled,
    fundingSourceId: refreshed.fundingSourceId,
    fundingSourceType: refreshed.fundingSourceType as "card" | "bank" | null,
    lowBalanceThreshold: Number(refreshed.lowBalanceThreshold),
    topUpAmount: Number(refreshed.topUpAmount),
    dailyLimit: Number(refreshed.dailyLimit),
    monthlyLimit: Number(refreshed.monthlyLimit),
    maxSingleTopUp: Number(refreshed.maxSingleTopUp),
    minTriggerIntervalMs: Number(refreshed.minTriggerIntervalMs),
    maxRetries: refreshed.maxRetries,
    providerReady: refreshed.providerReady,
    databaseAvailable: true,
    message: "Auto Fund configuration updated.",
  });
}
