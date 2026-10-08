import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { bybitPublicRequest, bybitRequest, getBybitConfig, type BybitEnvironment } from "@/lib/bybit/client";
import { getTradingProfile } from "@/lib/bybit/trading";

export type TradingMode = "bybit_testnet" | "bybit_live";
export type TradingCategory = "spot" | "linear";

type BybitList = { list?: Array<Record<string, string>> };

function text(input: unknown, fallback = "") {
  return typeof input === "string" ? input.trim() : fallback;
}

function number(input: unknown, label: string, minimum = 0) {
  const value = Number(input);
  if (!Number.isFinite(value) || value <= minimum) throw new Error(`${label} must be greater than ${minimum}.`);
  return value;
}

function normalizeSymbol(input: unknown) {
  const value = text(input).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z0-9]{5,24}$/.test(value)) throw new Error("Choose a valid Bybit symbol, such as BTCUSDT.");
  return value;
}

function normalizeMode(input: unknown): TradingMode {
  if (input === "bybit_testnet" || input === "bybit_live") return input;
  throw new Error("Choose Bybit Testnet or Bybit Live explicitly.");
}

function normalizeCategory(input: unknown): TradingCategory {
  return input === "linear" ? "linear" : "spot";
}

async function assertMode(userId: string, mode: TradingMode, requireExecution = false) {
  const config = await getBybitConfig(userId);
  const expected: BybitEnvironment = mode === "bybit_live" ? "mainnet" : "testnet";
  if (!config.configured) throw new Error("Bybit credentials are not configured. Open Settings → Connections.");
  if (config.environment !== expected) {
    throw new Error(`This mode needs ${expected} credentials, but the saved Bybit connection is ${config.environment}. Change it in Settings → Connections.`);
  }
  if (requireExecution && mode === "bybit_live" && (process.env.BYBIT_LIVE_MODE_ENABLED !== "true" || process.env.LIVE_TRADING_ENABLED !== "true")) {
    throw new Error("Bybit Live is server-locked. Set BYBIT_LIVE_MODE_ENABLED=true and LIVE_TRADING_ENABLED=true only after reviewing the risk limits.");
  }
  return config;
}

async function audit(userId: string, action: string, tradingMode: TradingMode, status: string, details: Record<string, unknown> = {}) {
  return db.tradingAuditEvent.create({
    data: {
      userId,
      action,
      tradingMode,
      status,
      symbol: typeof details.symbol === "string" ? details.symbol : undefined,
      intentId: typeof details.intentId === "string" ? details.intentId : undefined,
      details: details as Prisma.InputJsonValue,
    },
  });
}

async function safeList(promise: Promise<BybitList>) {
  try { return (await promise).list ?? []; } catch { return []; }
}

export async function terminalSnapshot(userId: string, input: { mode: unknown; symbol?: unknown; category?: unknown }) {
  const mode = normalizeMode(input.mode);
  const category = normalizeCategory(input.category);
  const symbol = normalizeSymbol(input.symbol ?? "BTCUSDT");
  const config = await assertMode(userId, mode);
  const profile = await getTradingProfile(userId);

  // Reuse this request's authenticated credentials across its read-only snapshot.
  // Never keep decrypted credentials in a process-global cache.
  const request = <T>(path: string, options: Parameters<typeof bybitRequest>[2]) => bybitRequest<T>(userId, path, options, config);

  const [walletResult, positions, spotOrders, linearOrders, spotHistory, linearHistory, executions, closedPnl, transactions, ticker, audits, approvals] = await Promise.all([
    request<{ list?: Array<Record<string, unknown>> }>( "/v5/account/wallet-balance", { query: { accountType: "UNIFIED" } }),
    safeList(request<BybitList>( "/v5/position/list", { query: { category: "linear", settleCoin: "USDT", limit: 50 } })),
    safeList(request<BybitList>( "/v5/order/realtime", { query: { category: "spot", openOnly: 0, limit: 50 } })),
    safeList(request<BybitList>( "/v5/order/realtime", { query: { category: "linear", settleCoin: "USDT", openOnly: 0, limit: 50 } })),
    safeList(request<BybitList>( "/v5/order/history", { query: { category: "spot", limit: 50 } })),
    safeList(request<BybitList>( "/v5/order/history", { query: { category: "linear", settleCoin: "USDT", limit: 50 } })),
    safeList(request<BybitList>( "/v5/execution/list", { query: { category, symbol, limit: 100 } })),
    safeList(request<BybitList>( "/v5/position/closed-pnl", { query: { category: "linear", symbol, limit: 50 } })),
    safeList(request<BybitList>( "/v5/account/transaction-log", { query: { accountType: "UNIFIED", limit: 50 } })),
    bybitPublicRequest<{ list?: Array<Record<string, string>> }>(config.environment, "/v5/market/tickers", { category, symbol }),
    db.tradingAuditEvent.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.liveTradeIntent.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);

  const wallet = walletResult.list?.find(item => item.accountType === "UNIFIED");
  if (!wallet) throw new Error("Bybit authenticated the request but returned no Unified account. Balance is unavailable.");
  return {
    mode,
    environment: config.environment,
    connected: true,
    symbol,
    category,
    serverLocks: {
      liveEnabled: process.env.BYBIT_LIVE_MODE_ENABLED === "true" && process.env.LIVE_TRADING_ENABLED === "true",
      testnetEnabled: process.env.BYBIT_TESTNET_TRADING_ENABLED !== "false",
    },
    portfolio: {
      totalEquity: String(wallet.totalEquity ?? ""),
      totalWalletBalance: String(wallet.totalWalletBalance ?? ""),
      totalAvailableBalance: String(wallet.totalAvailableBalance ?? ""),
      totalPerpUPL: String(wallet.totalPerpUPL ?? ""),
      totalInitialMargin: String(wallet.totalInitialMargin ?? ""),
      totalMaintenanceMargin: String(wallet.totalMaintenanceMargin ?? ""),
      coins: Array.isArray(wallet.coin) ? wallet.coin : [],
    },
    ticker: ticker.list?.[0] ?? null,
    positions,
    openOrders: [...spotOrders.map((item) => ({ ...item, category: "spot" })), ...linearOrders.map((item) => ({ ...item, category: "linear" }))],
    orderHistory: [...spotHistory.map((item) => ({ ...item, category: "spot" })), ...linearHistory.map((item) => ({ ...item, category: "linear" }))],
    executions,
    closedPnl,
    transactions,
    risk: {
      maxOrderUsd: Number(profile.maxOrderUsd),
      maxPositionUsd: Number(profile.maxPositionUsd),
      maxDailyLossUsd: Number(profile.maxDailyLossUsd),
      maxOpenPositions: profile.maxOpenPositions,
      maxLeverage: Number(profile.maxLeverage),
      requireApproval: profile.requireApproval,
      emergencyStop: profile.emergencyStop,
    },
    audits,
    approvals: approvals.map((item) => ({ id: item.id, productId: item.productId, side: item.side, tradingMode: item.tradingMode, category: item.category, orderType: item.orderType, state: item.state, quoteSize: item.quoteSize?.toString() ?? null, providerOrderId: item.providerOrderId, expiresAt: item.expiresAt, createdAt: item.createdAt })),
    refreshedAt: new Date().toISOString(),
  };
}

export async function updateRiskPolicy(userId: string, input: Record<string, unknown>) {
  const current = await getTradingProfile(userId);
  const maxOrderUsd = number(input.maxOrderUsd, "Maximum order", 0);
  const maxPositionUsd = number(input.maxPositionUsd, "Maximum position", 0);
  const maxDailyLossUsd = number(input.maxDailyLossUsd, "Maximum daily loss", 0);
  const maxOpenPositions = Math.floor(number(input.maxOpenPositions, "Maximum open positions", 0));
  const maxLeverage = number(input.maxLeverage, "Maximum leverage", 0);
  if (maxOrderUsd > maxPositionUsd) throw new Error("Maximum order cannot exceed maximum position exposure.");
  if (maxLeverage > 100) throw new Error("Maximum leverage cannot exceed 100×.");
  const profile = await db.tradingAgentProfile.update({
    where: { id: current.id },
    data: { maxOrderUsd, maxPositionUsd, maxDailyLossUsd, maxOpenPositions, maxLeverage, requireApproval: input.requireApproval !== false },
  });
  const mode = input.mode === "bybit_live" ? "bybit_live" : "bybit_testnet";
  await audit(userId, "risk_policy.updated", mode, "accepted", { maxOrderUsd, maxPositionUsd, maxDailyLossUsd, maxOpenPositions, maxLeverage });
  return profile;
}

export async function previewTerminalOrder(userId: string, input: Record<string, unknown>) {
  const mode = normalizeMode(input.mode);
  const config = await assertMode(userId, mode, true);
  if (mode === "bybit_testnet" && process.env.BYBIT_TESTNET_TRADING_ENABLED === "false") throw new Error("Bybit Testnet order submission is server-locked.");
  const profile = await getTradingProfile(userId);
  if (profile.emergencyStop) throw new Error("Emergency stop is active. No new orders are allowed.");

  const symbol = normalizeSymbol(input.symbol);
  const category = normalizeCategory(input.category);
  const side = input.side === "Sell" || input.side === "SELL" ? "Sell" : "Buy";
  const orderType = input.orderType === "Limit" ? "Limit" : "Market";
  const quantity = number(input.quantity, "Quantity", 0);
  const limitPrice = orderType === "Limit" ? number(input.price, "Limit price", 0) : null;
  const leverage = category === "linear" ? number(input.leverage ?? 1, "Leverage", 0) : 1;

  const [ticker, instruments, currentPositions, closedPnl] = await Promise.all([
    bybitPublicRequest<{ list?: Array<Record<string, string>> }>(config.environment, "/v5/market/tickers", { category, symbol }),
    bybitPublicRequest<{ list?: Array<Record<string, unknown>> }>(config.environment, "/v5/market/instruments-info", { category, symbol }),
    category === "linear" ? bybitRequest<BybitList>(userId, "/v5/position/list", { query: { category: "linear", settleCoin: "USDT", limit: 50 } }).then(r=>{if(!Array.isArray(r.list))throw Error("Position risk data unavailable.");return r.list;}) : Promise.resolve([]),
    bybitRequest<BybitList>(userId, "/v5/position/closed-pnl", { query: { category: "linear", startTime: Date.now() - 86_400_000, limit: 100 } }).then(r=>{if(!Array.isArray(r.list))throw Error("Daily risk data unavailable.");return r.list;}),
  ]);
  const marketPrice = Number(ticker.list?.[0]?.lastPrice ?? 0);
  if (!marketPrice) throw new Error("Bybit did not return a current market price.");
  const notional = quantity * (limitPrice ?? marketPrice);
  const dailyClosedPnl = closedPnl.reduce((sum, row) => sum + Number(row.closedPnl ?? 0), 0);
  const filters = instruments.list?.[0] ?? null;
  const lot = (filters?.lotSizeFilter ?? {}) as Record<string, string>;
  const priceFilter = (filters?.priceFilter ?? {}) as Record<string, string>;
  const minimumQuantity = Number(lot.minOrderQty ?? 0);
  const maximumQuantity = Number(lot.maxOrderQty ?? lot.maxMktOrderQty ?? Number.MAX_SAFE_INTEGER);
  const quantityStep = Number(lot.qtyStep ?? 0);
  const tickSize = Number(priceFilter.tickSize ?? 0);
  const quantityAligned = !quantityStep || Math.abs(quantity / quantityStep - Math.round(quantity / quantityStep)) < 1e-8;
  const priceAligned = !limitPrice || !tickSize || Math.abs(limitPrice / tickSize - Math.round(limitPrice / tickSize)) < 1e-8;
  const existingExposure = currentPositions.reduce((sum, row) => sum + Math.abs(Number(row.positionValue ?? 0)), 0);
  const checks = [
    { id: "order_limit", ok: notional <= Number(profile.maxOrderUsd), message: `Order exposure ${notional.toFixed(2)} USDT / ${Number(profile.maxOrderUsd).toFixed(2)} limit` },
    { id: "position_limit", ok: existingExposure + notional <= Number(profile.maxPositionUsd), message: `Resulting exposure ${(existingExposure + notional).toFixed(2)} USDT / ${Number(profile.maxPositionUsd).toFixed(2)} limit` },
    { id: "open_positions", ok: currentPositions.filter((row) => Number(row.size ?? 0) > 0).length < profile.maxOpenPositions, message: `Open positions ${currentPositions.length} / ${profile.maxOpenPositions}` },
    { id: "leverage", ok: leverage <= Number(profile.maxLeverage), message: `Leverage ${leverage}× / ${Number(profile.maxLeverage)}× limit` },
    { id: "daily_loss", ok: dailyClosedPnl > -Number(profile.maxDailyLossUsd), message: `Daily closed P/L ${dailyClosedPnl.toFixed(2)} USDT / -${Number(profile.maxDailyLossUsd).toFixed(2)} stop` },
    { id: "minimum_quantity", ok: !minimumQuantity || quantity >= minimumQuantity, message: `Quantity ${quantity} / minimum ${minimumQuantity || "exchange default"}` },
    { id: "maximum_quantity", ok: !maximumQuantity || quantity <= maximumQuantity, message: `Quantity ${quantity} / maximum ${maximumQuantity}` },
    { id: "quantity_step", ok: quantityAligned, message: quantityAligned ? `Quantity follows ${quantityStep || "exchange"} step` : `Quantity must follow the ${quantityStep} step` },
    { id: "price_tick", ok: priceAligned, message: priceAligned ? `Price follows ${tickSize || "exchange"} tick` : `Limit price must follow the ${tickSize} tick` },
  ];
  if (checks.some((check) => !check.ok)) {
    await audit(userId, "order.preview", mode, "rejected", { symbol, category, checks });
    throw new Error(checks.filter((check) => !check.ok).map((check) => check.message).join("; "));
  }

  const clientOrderId = `lucian${randomUUID().replace(/-/g, "").slice(0, 28)}`;
  const preview = { mode, environment: config.environment, symbol, category, side, orderType, quantity, limitPrice, leverage, marketPrice, notional, stopLoss: input.stopLoss || null, takeProfit: input.takeProfit || null, reduceOnly: input.reduceOnly === true, checks, filters };
  const intent = await db.liveTradeIntent.create({ data: {
    userId, clientOrderId, productId: symbol, side: side.toUpperCase(), tradingMode: mode, category, orderType,
    baseSize: quantity, quoteSize: notional, limitPrice: limitPrice ?? undefined,
    stopLoss: input.stopLoss ? Number(input.stopLoss) : undefined, takeProfit: input.takeProfit ? Number(input.takeProfit) : undefined,
    previewId: randomUUID(), preview: preview as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 120_000),
  } });
  await audit(userId, "order.preview", mode, "approved", { symbol, intentId: intent.id, category, notional, checks });
  return { requiresConfirmation: profile.requireApproval, intentId: intent.id, expiresAt: intent.expiresAt, confirmationPhrase: mode === "bybit_live" ? "CONFIRM BYBIT LIVE ORDER" : "CONFIRM BYBIT TESTNET ORDER", preview };
}

export async function executeTerminalOrder(userId: string, input: Record<string, unknown>) {
  const intentId = text(input.intentId);
  const intent = await db.liveTradeIntent.findFirst({ where: { id: intentId, userId } });
  if (!intent || intent.state !== "previewed" || !intent.expiresAt || intent.expiresAt.getTime() < Date.now()) throw new Error("This order preview is missing, expired, or already used.");
  if (intent.initiatedBy !== "user") throw new Error("Legacy automated intents cannot be confirmed. Review any existing reservations manually.");
  const mode = normalizeMode(intent.tradingMode);
  await assertMode(userId, mode, true);
  const phrase = mode === "bybit_live" ? "CONFIRM BYBIT LIVE ORDER" : "CONFIRM BYBIT TESTNET ORDER";
  if (text(input.confirmation) !== phrase) throw new Error(`Type ${phrase} exactly to approve this order.`);
  if (mode === "bybit_live") {
    const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user?.passwordHash || !(await verifyPassword(text(input.password), user.passwordHash))) throw new Error("Current LUCIAN password verification failed.");
  }
  const profile = await getTradingProfile(userId);
  if (profile.emergencyStop) throw new Error("Emergency stop is active.");
  const preview = intent.preview as Record<string, unknown>;
  // Only one confirmation may reserve this preview, even across server instances.
  const reserved=await db.liveTradeIntent.updateMany({where:{id:intent.id,userId,state:"previewed",initiatedBy:"user",expiresAt:{gt:new Date()}},data:{state:"executing"}});
  if(reserved.count!==1)throw new Error("Order already reserved, changed or expired. Refresh before acting.");
  try {
    if (intent.category === "linear" && Number(preview.leverage ?? 1) > 0) {
      await bybitRequest(userId, "/v5/position/set-leverage", { method: "POST", body: { category: "linear", symbol: intent.productId, buyLeverage: String(preview.leverage), sellLeverage: String(preview.leverage) } });
    }
    const execution = await bybitRequest<{ orderId?: string; orderLinkId?: string }>(userId, "/v5/order/create", { method: "POST", body: {
      category: intent.category,
      symbol: intent.productId,
      side: intent.side === "SELL" ? "Sell" : "Buy",
      orderType: intent.orderType,
      qty: intent.baseSize?.toString(),
      ...(intent.orderType === "Limit" ? { price: intent.limitPrice?.toString(), timeInForce: "GTC" } : {}),
      ...(intent.category === "spot" && intent.orderType === "Market" ? { marketUnit: "baseCoin" } : {}),
      ...(intent.category === "linear" ? { reduceOnly: preview.reduceOnly === true, stopLoss: intent.stopLoss?.toString(), takeProfit: intent.takeProfit?.toString() } : {}),
      orderLinkId: intent.clientOrderId,
    } });
    if (!execution.orderId) throw new Error("Bybit accepted no order identifier.");
    await db.liveTradeIntent.update({ where: { id: intent.id }, data: { state: "submitted", providerOrderId: execution.orderId, execution: execution as Prisma.InputJsonValue } });
    await audit(userId, "order.submit", mode, "submitted", { symbol: intent.productId, intentId: intent.id, orderId: execution.orderId });
    return { status: "submitted", orderId: execution.orderId, intentId: intent.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Order submission failed.";
    await db.liveTradeIntent.update({ where: { id: intent.id }, data: { state: "reconciliation_required", execution: { error: message, orderLinkId:intent.clientOrderId } } });
    await audit(userId, "order.submit", mode, "reconciliation_required", { symbol: intent.productId, intentId: intent.id, error: message });
    throw error;
  }
}

export async function cancelTerminalOrder(userId: string, input: Record<string, unknown>) {
  const mode = normalizeMode(input.mode);
  await assertMode(userId, mode);
  const category = normalizeCategory(input.category);
  const symbol = normalizeSymbol(input.symbol);
  const orderId = text(input.orderId);
  if (!orderId) throw new Error("Order id is required.");
  const result = await bybitRequest(userId, "/v5/order/cancel", { method: "POST", body: { category, symbol, orderId } });
  await audit(userId, "order.cancel", mode, "submitted", { symbol, orderId, category });
  return result;
}

export async function setEmergencyStop(userId: string, input: Record<string, unknown>) {
  const mode = normalizeMode(input.mode);
  await assertMode(userId, mode);
  const active = input.active !== false;
  const current = await getTradingProfile(userId);
  await db.tradingAgentProfile.update({ where: { id: current.id }, data: { emergencyStop: active } });
  let cancelled: unknown = null;
  if (active) {
    const outcomes = await Promise.allSettled(["spot", "linear"].map((category) => bybitRequest(userId, "/v5/order/cancel-all", { method: "POST", body: { category, ...(category === "linear" ? { settleCoin: "USDT" } : {}) } })));
    cancelled = outcomes.map((outcome) => outcome.status === "fulfilled" ? outcome.value : { error: outcome.reason instanceof Error ? outcome.reason.message : "Cancel-all failed" });
  }
  await audit(userId, "emergency_stop", mode, active ? "activated" : "released", { cancelled });
  return { emergencyStop: active, cancelled };
}
