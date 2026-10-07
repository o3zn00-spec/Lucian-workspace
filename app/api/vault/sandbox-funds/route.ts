import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireVaultOwner, unauthorizedVaultResponse } from "@/lib/auth/vault-ownership";
import { requireLedgerOr503 } from "@/lib/vault/api-helpers";
import { getIdempotencyKey, validateAmount, apiError } from "@/lib/vault/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  if ((process.env.TRADING_MODE ?? "sandbox") === "live" && process.env.ENABLE_SANDBOX_FUNDING !== "true") {
    return apiError("Sandbox funding is disabled in live mode.", 403);
  }
  let userId: string;
  try { userId = await requireVaultOwner(); } catch { return unauthorizedVaultResponse(); }
  const idem = getIdempotencyKey(req);
  if (!idem.ok) return apiError(idem.error, 400);
  const body = await req.json().catch(() => null) as { amount?: unknown } | null;
  const amountResult = validateAmount(body?.amount, "USD");
  if (!amountResult.ok) return apiError(amountResult.error, 400);
  const ledgerResult = requireLedgerOr503();
  if (!ledgerResult.ok) return ledgerResult.response;
  const ledger = ledgerResult.ledger;
  const existing = await ledger.checkIdempotency(idem.value, body, userId);
  if (existing) return NextResponse.json(existing.response, { status: existing.status });
  const amount = amountResult.value;
  const lucianTxId = `sandbox_${idem.value}`;
  const transaction = await ledger.createTransaction({
    lucianTxId, type: "deposit", status: "completed", currency: "USD", amount,
    source: "lucian-sandbox", destination: "cash-available", provider: "lucian-sandbox",
    idempotencyKey: idem.value, ownerUserId: userId, metadata: { sandbox: true, withdrawable: false },
  });
  const entry = await ledger.appendEntry({
    idempotencyKey: idem.value, type: "deposit", status: "completed",
    debitAccount: "provider-clearing", creditAccount: "sandbox-cash-available", amount,
    source: "lucian-sandbox", destination: "vault", provider: "lucian-sandbox",
    transactionId: transaction.id, ownerUserId: userId, metadata: { sandbox: true, withdrawable: false },
  });

  const current = await db.tradingSandboxAccount.findUnique({ where: { userId } });
  const state = (current?.state && typeof current.state === "object" ? current.state : {}) as Record<string, unknown>;
  const balance = typeof state.balance === "number" ? state.balance : 0;
  const nextState = {
    schemaVersion: 2, startingBalance: typeof state.startingBalance === "number" ? state.startingBalance : 0,
    positions: Array.isArray(state.positions) ? state.positions : [],
    closedPositions: Array.isArray(state.closedPositions) ? state.closedPositions : [],
    pendingOrders: Array.isArray(state.pendingOrders) ? state.pendingOrders : [],
    dailyLossAmount: Number(state.dailyLossAmount ?? 0), dailyLossResetAt: Number(state.dailyLossResetAt ?? Date.now() + 86400000),
    weeklyLossAmount: Number(state.weeklyLossAmount ?? 0), weeklyLossResetAt: Number(state.weeklyLossResetAt ?? Date.now() + 604800000),
    consecutiveLosses: Number(state.consecutiveLosses ?? 0), lastLossAt: Number(state.lastLossAt ?? 0),
    balance: balance + Number(amount.amount) / 100,
  };
  await db.tradingSandboxAccount.upsert({
    where: { userId },
    create: { userId, state: nextState, history: [] },
    update: { state: nextState, revision: { increment: 1 } },
  });
  const response = { transactionId: lucianTxId, ledgerEntryId: entry.id, status: "completed", sandbox: true, message: "Persistent sandbox funds added. These funds cannot be withdrawn." };
  await ledger.recordIdempotency(idem.value, body, response, 200, undefined, userId);
  return NextResponse.json(response);
}
