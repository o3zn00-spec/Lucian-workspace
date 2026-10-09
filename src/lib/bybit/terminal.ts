import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { bybitPublicRequest, bybitRequest, getBybitConfig, type BybitEnvironment } from "@/lib/bybit/client";
import { getTradingProfile } from "@/lib/bybit/trading";
import { accountExposure } from "@/lib/bybit/exposure";
import { readCompleteBybitList } from "@/lib/bybit/pagination";
import { readSpotRisk } from "@/lib/bybit/spot-risk";

export type TradingMode = "bybit_testnet" | "bybit_live";
export type TradingCategory = "spot" | "linear";

type BybitList = { list?: Array<Record<string, string>>; nextPageCursor?: string };

function completeRiskRows(result: BybitList, label: string) {
  if (!Array.isArray(result.list) || result.nextPageCursor) throw new Error(`${label} is unavailable or incomplete. No new order can use partial risk data.`);
  return result.list;
}

function riskNumber(value: unknown, label: string) {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new Error(`${label} is malformed. No new order can use unknown risk data.`);
  return Number(value);
}

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

export async function terminalSnapshot(userId: string, input: { mode: unknown; symbol?: unknown; category?: unknown }) {
  const mode = normalizeMode(input.mode);
  const category = normalizeCategory(input.category);
  const symbol = normalizeSymbol(input.symbol ?? "BTCUSDT");
  const config = await assertMode(userId, mode);
  const profile = await getTradingProfile(userId);
  const readErrors:Record<string,string>={};
  const readList=async(key:string,promise:Promise<BybitList & {nextPageCursor?:string}>)=>{
    try{const result=await promise;if(!Array.isArray(result.list))throw Error("Malformed exchange list.");
      if(result.nextPageCursor)readErrors[key]="Exchange returned only a page of records; complete account history/exposure is unavailable.";
      return result.list;
    }catch(error){readErrors[key]=error instanceof Error?error.message:"Exchange read unavailable.";return [];}
  };

  // Reuse this request's authenticated credentials across its read-only snapshot.
  // Never keep decrypted credentials in a process-global cache.
  const request = <T>(path: string, options: Parameters<typeof bybitRequest>[2]) => bybitRequest<T>(userId, path, options, config);
  const pages = (path: string, query: NonNullable<Parameters<typeof bybitRequest>[2]>["query"], label: string) =>
    readCompleteBybitList(cursor => request<BybitList>(path, { query: { ...query, cursor } }), label);

  const [walletResult, funding, positions, spotOrders, linearOrders, spotHistory, linearHistory, executions, closedPnl, transactions, ticker, audits, approvals] = await Promise.all([
    request<{ list?: Array<Record<string, unknown>> }>( "/v5/account/wallet-balance", { query: { accountType: "UNIFIED" } }),
    request<{ balance?: Array<Record<string,string>> }>("/v5/asset/transfer/query-account-coins-balance", { query: { accountType: "FUND" } })
      .then(result => { if (!Array.isArray(result.balance)) throw Error("Funding wallet response is unavailable."); return result.balance; })
      .catch(error => { readErrors.funding = error instanceof Error ? error.message : "Funding wallet unavailable."; return []; }),
    readList("positions",pages("/v5/position/list", { category: "linear", settleCoin: "USDT", limit: 50 }, "positions")),
    readList("spotOrders",pages("/v5/order/realtime", { category: "spot", openOnly: 0, limit: 50 }, "spotOrders")),
    readList("linearOrders",pages("/v5/order/realtime", { category: "linear", settleCoin: "USDT", openOnly: 0, limit: 50 }, "linearOrders")),
    readList("spotHistory",pages("/v5/order/history", { category: "spot", limit: 50 }, "spotHistory")),
    readList("linearHistory",pages("/v5/order/history", { category: "linear", settleCoin: "USDT", limit: 50 }, "linearHistory")),
    readList("executions",pages("/v5/execution/list", { category, symbol, limit: 100 }, "executions")),
    readList("closedPnl",pages("/v5/position/closed-pnl", { category: "linear", symbol, limit: 50 }, "closedPnl")),
    readList("transactions",pages("/v5/account/transaction-log", { accountType: "UNIFIED", limit: 50 }, "transactions")),
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
    funding,
    readErrors,
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

async function validateTerminalOrder(userId: string, input: Record<string, unknown>, requireExecution = true) {
  const mode = normalizeMode(input.mode);
  const config = await assertMode(userId, mode, requireExecution);
  if (requireExecution && mode === "bybit_testnet" && process.env.BYBIT_TESTNET_TRADING_ENABLED === "false") throw new Error("Bybit Testnet order submission is server-locked.");
  const profile = await getTradingProfile(userId);
  if (profile.emergencyStop) throw new Error("Emergency stop is active. No new orders are allowed.");

  const symbol = normalizeSymbol(input.symbol);
  const category = normalizeCategory(input.category);
  if (!["Buy", "BUY", "Sell", "SELL"].includes(String(input.side))) throw new Error("Choose Buy or Sell explicitly.");
  if (!["Market", "Limit"].includes(String(input.orderType))) throw new Error("Choose Market or Limit explicitly.");
  if (!["spot", "linear"].includes(String(input.category))) throw new Error("Choose Spot or USDT Linear explicitly.");
  // Live derivatives require a separate explicit server configuration. A 1x
  // leverage limit alone does not restrict an order to Spot.
  if (mode === "bybit_live" && category !== "spot" && process.env.BYBIT_LIVE_SPOT_ONLY !== "false") throw new Error("Live trading is Spot-only. Derivatives are not enabled for this trial.");
  const side = input.side === "Sell" || input.side === "SELL" ? "Sell" : "Buy";
  const orderType = input.orderType === "Limit" ? "Limit" : "Market";
  const quantity = number(input.quantity, "Quantity", 0);
  const limitPrice = orderType === "Limit" ? number(input.price, "Limit price", 0) : null;
  const leverage = category === "linear" ? number(input.leverage ?? 1, "Leverage", 0) : 1;

  const stopLoss = input.stopLoss == null || input.stopLoss === "" ? null : number(input.stopLoss, "Stop loss");
  const takeProfit = input.takeProfit == null || input.takeProfit === "" ? null : number(input.takeProfit, "Take profit");
  const reduceOnly = input.reduceOnly === true;
  const positionIdx = input.positionIdx == null ? 0 : Number(input.positionIdx);
  if (![0, 1, 2].includes(positionIdx)) throw new Error("Choose a valid derivatives position mode.");
  if (category === "spot" && reduceOnly) throw new Error("Reduce-only is a derivatives setting. Spot sells must use available inventory.");
  if (category === "spot" && orderType === "Market" && (stopLoss || takeProfit)) throw new Error("Bybit Spot Market cannot attach these protective exits. Choose a Spot Limit order with protection or remove the fields for an explicitly unprotected manual order.");
  if (reduceOnly && (stopLoss || takeProfit)) throw new Error("Reduce-only orders cannot also attach take profit or stop loss.");

  const pages = (path: string, query: NonNullable<Parameters<typeof bybitRequest>[2]>["query"], label: string) =>
    readCompleteBybitList(cursor => bybitRequest<BybitList>(userId, path, { query: { ...query, cursor } }, config), label)
      .then(result => completeRiskRows(result, label));
  const [ticker, instruments, currentPositions, closedPnl, walletResult, feeResult, spotOrders, linearOrders] = await Promise.all([
    bybitPublicRequest<{ list?: Array<Record<string, string>> }>(config.environment, "/v5/market/tickers", { category, symbol }),
    bybitPublicRequest<{ list?: Array<Record<string, unknown>> }>(config.environment, "/v5/market/instruments-info", { category, symbol }),
    pages("/v5/position/list", { category: "linear", settleCoin: "USDT", limit: 200 }, "Position risk data"),
    pages("/v5/position/closed-pnl", { category: "linear", startTime: Date.now() - 86_400_000, limit: 100 }, "Daily risk data"),
    bybitRequest<{ list?: Array<{accountType: string; coin?: Array<Record<string,string>>}> }>(userId, "/v5/account/wallet-balance", {query:{accountType:"UNIFIED"}}, config),
    bybitRequest<BybitList>(userId, "/v5/account/fee-rate", {query:{category,symbol}}, config),
    pages("/v5/order/realtime", {category:"spot",openOnly:0,limit:50}, "Spot pending orders"),
    pages("/v5/order/realtime", {category:"linear",settleCoin:"USDT",openOnly:0,limit:50}, "Linear pending orders"),
  ]);
  if (ticker.list?.length !== 1 || ticker.list[0].symbol !== symbol || instruments.list?.length !== 1 || instruments.list[0].symbol !== symbol) throw new Error("Exchange instrument/quote identity is unavailable or mismatched.");
  if (instruments.list[0].quoteCoin !== "USDT" || (category === "linear" && instruments.list[0].settleCoin !== "USDT")) throw new Error("This terminal risk policy supports USDT-quoted Spot and USDT-settled Linear only.");
  const marketPrice = riskNumber(ticker.list[0].lastPrice, "Market price");
  if (marketPrice <= 0) throw new Error("Bybit did not return a current market price.");
  const notional = quantity * (limitPrice ?? marketPrice);
  const fees = completeRiskRows(feeResult, "Fee rate");
  if (fees.length !== 1 || fees[0].symbol !== symbol) throw new Error("Exchange fee identity is unavailable or mismatched.");
  const feeRate = Math.max(riskNumber(fees[0].takerFeeRate,"Taker fee"),riskNumber(fees[0].makerFeeRate,"Maker fee"),0);
  const accountWallet = walletResult.list?.find(row=>row.accountType === "UNIFIED");
  if (!accountWallet || !Array.isArray(accountWallet.coin)) throw new Error("Account inventory is unavailable.");
  const exposure = accountExposure(accountWallet.coin, currentPositions, spotOrders, linearOrders);
  if (category === "linear") {
    const matching = currentPositions.filter(row=>row.symbol === symbol && Number(row.positionIdx) === positionIdx);
    if (reduceOnly) {
      const opposite = side === "Buy" ? "Sell" : "Buy";
      if (matching.length !== 1 || matching[0].side !== opposite || riskNumber(matching[0].size,"Reducible position") < quantity) throw new Error("Reduce-only quantity must be covered by the selected opposite position.");
    } else if ((positionIdx === 1 && side !== "Buy") || (positionIdx === 2 && side !== "Sell")) {
      throw new Error("Opening direction does not match the selected hedge position.");
    }
  }
  let spotAvailable: number | null = null;
  if (category === "spot") {
    const wallet = walletResult?.list?.find(row=>row.accountType === "UNIFIED");
    if (!wallet || !Array.isArray(wallet.coin)) throw new Error("Spot inventory is unavailable.");
    const instrument = instruments.list[0];
    const spendingCoin = side === "Buy" ? instrument.quoteCoin : instrument.baseCoin;
    if (typeof spendingCoin !== "string" || !spendingCoin) throw new Error("Instrument spending currency is unavailable.");
    const coins = wallet.coin.filter(row=>row.coin === spendingCoin);
    if (coins.length > 1) throw new Error("Spot inventory has conflicting currency records.");
    // An omitted zero-asset coin is zero, but missing numeric fields are unknown.
    spotAvailable = coins.length ? Math.max(0,riskNumber(coins[0].walletBalance,"Spot balance") - riskNumber(coins[0].locked,"Locked spot balance") - riskNumber(coins[0].spotBorrow,"Borrowed spot balance")) : 0;
  }
  const addsExposure = category === "spot" ? side === "Buy" : !reduceOnly;
  // A live entry must never interpret missing Spot cost basis as zero loss.
  const spotRisk = mode === "bybit_live" && addsExposure ? await readSpotRisk(userId, config) : null;
  const dailyClosedPnl = closedPnl.reduce((sum, row) => sum + riskNumber(row.closedPnl, "Daily closed P/L"), 0) + (spotRisk?.dailyRealized ?? 0);
  const filters = instruments.list?.[0] ?? null;
  const lot = (filters?.lotSizeFilter ?? {}) as Record<string, string>;
  const priceFilter = (filters?.priceFilter ?? {}) as Record<string, string>;
  const minimumQuantity = category === "spot" ? 0 : Number(lot.minOrderQty ?? 0);
  const maximumQuantity = Number(orderType === "Market" ? lot.maxMarketOrderQty ?? lot.maxMktOrderQty : lot.maxLimitOrderQty ?? lot.maxOrderQty);
  const quantityStep = Number(lot.qtyStep ?? lot.basePrecision ?? 0);
  const tickSize = Number(priceFilter.tickSize ?? 0);
  const quantityAligned = !quantityStep || Math.abs(quantity / quantityStep - Math.round(quantity / quantityStep)) < 1e-8;
  const priceAligned = !limitPrice || !tickSize || Math.abs(limitPrice / tickSize - Math.round(limitPrice / tickSize)) < 1e-8;
  const existingExposure = exposure.exposure;
  const assetKey = category === "spot" ? `spot:${String(instruments.list[0].baseCoin)}` : `linear:${symbol}:${positionIdx}`;
  const resultingExposure = existingExposure + (addsExposure ? notional : 0);
  const resultingPositions = exposure.assets.size + (addsExposure && !exposure.assets.has(assetKey) ? 1 : 0);
  const checks = [
    { id: "spot_inventory", ok: category !== "spot" || (spotAvailable !== null && spotAvailable >= (side === "Buy" ? notional : quantity) * (1 + feeRate)), message: "Unborrowed, unlocked Spot balance must cover the order and exchange fee reserve" },
    { id: "protection_tick", ok: tickSize > 0 && [stopLoss,takeProfit].every(value=>value === null || Math.abs(value/tickSize - Math.round(value/tickSize)) < 1e-8), message: "Protective prices must follow the exchange tick size" },
    { id: "protection_direction", ok: (!stopLoss || (side === "Buy" ? stopLoss < (limitPrice ?? marketPrice) : stopLoss > (limitPrice ?? marketPrice))) && (!takeProfit || (side === "Buy" ? takeProfit > (limitPrice ?? marketPrice) : takeProfit < (limitPrice ?? marketPrice))), message: "Protective stop and target must be on the correct sides of the entry price" },
    { id: "minimum_notional", ok: Number.isFinite(Number(lot.minNotionalValue ?? lot.minOrderAmt)) && notional >= Number(lot.minNotionalValue ?? lot.minOrderAmt), message: "Order must meet a known exchange minimum notional" },
    { id: "order_limit", ok: notional <= Number(profile.maxOrderUsd), message: `Order exposure ${notional.toFixed(2)} USDT / ${Number(profile.maxOrderUsd).toFixed(2)} limit` },
    { id: "position_limit", ok: !addsExposure || resultingExposure <= Number(profile.maxPositionUsd), message: `Gross account exposure including inventory and pending entries ${resultingExposure.toFixed(2)} USDT / ${Number(profile.maxPositionUsd).toFixed(2)} limit` },
    { id: "open_positions", ok: !addsExposure || resultingPositions <= profile.maxOpenPositions, message: `Held/pending positions ${resultingPositions} / ${profile.maxOpenPositions}` },
    { id: "leverage", ok: leverage <= Number(profile.maxLeverage), message: `Leverage ${leverage}× / ${Number(profile.maxLeverage)}× limit` },
    { id: "daily_loss", ok: !addsExposure || dailyClosedPnl > -Number(profile.maxDailyLossUsd), message: `Daily realized P/L ${dailyClosedPnl.toFixed(2)} USDT / -${Number(profile.maxDailyLossUsd).toFixed(2)} stop${spotRisk ? " · Spot fills reconciled" : ""}` },
    { id: "minimum_quantity", ok: !minimumQuantity || quantity >= minimumQuantity, message: `Quantity ${quantity} / minimum ${minimumQuantity || "exchange default"}` },
    { id: "maximum_quantity", ok: Number.isFinite(maximumQuantity) && maximumQuantity > 0 && quantity <= maximumQuantity, message: `Quantity ${quantity} / maximum ${maximumQuantity}` },
    { id: "quantity_step", ok: quantityStep > 0 && quantityAligned, message: quantityAligned ? `Quantity follows ${quantityStep || "exchange"} step` : `Quantity must follow the ${quantityStep} step` },
    { id: "price_tick", ok: tickSize > 0 && priceAligned, message: priceAligned ? `Price follows ${tickSize || "exchange"} tick` : `Limit price must follow the ${tickSize} tick` },
  ];
  if (checks.some((check) => !check.ok)) {
    await audit(userId, "order.preview", mode, "rejected", { symbol, category, checks });
    throw new Error(checks.filter((check) => !check.ok).map((check) => check.message).join("; "));
  }

  return { mode, environment: config.environment, symbol, category, side, orderType, quantity, limitPrice, leverage, marketPrice, notional, stopLoss, takeProfit, reduceOnly, positionIdx, checks, filters };
}

export async function previewTerminalOrder(userId: string, input: Record<string, unknown>) {
  const preview = await validateTerminalOrder(userId, input, false);
  const { mode, symbol, category, side, orderType, quantity, notional, limitPrice, stopLoss, takeProfit, checks } = preview;
  const profile = await getTradingProfile(userId);
  const clientOrderId = `lucian${randomUUID().replace(/-/g, "").slice(0, 28)}`;
  const intent = await db.liveTradeIntent.create({ data: {
    userId, clientOrderId, productId: symbol, side: side.toUpperCase(), tradingMode: mode, category, orderType,
    baseSize: quantity, quoteSize: notional, limitPrice: limitPrice ?? undefined,
    stopLoss: stopLoss ?? undefined, takeProfit: takeProfit ?? undefined,
    previewId: randomUUID(), preview: preview as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 120_000),
  } });
  await audit(userId, "order.preview", mode, "approved", { symbol, intentId: intent.id, category, notional, checks });
  const executionEnabled = mode === "bybit_live" ? process.env.BYBIT_LIVE_MODE_ENABLED === "true" && process.env.LIVE_TRADING_ENABLED === "true" : process.env.BYBIT_TESTNET_TRADING_ENABLED !== "false";
  return { executionEnabled, requiresConfirmation: profile.requireApproval, intentId: intent.id, expiresAt: intent.expiresAt, confirmationPhrase: mode === "bybit_live" ? "CONFIRM BYBIT LIVE ORDER" : "CONFIRM BYBIT TESTNET ORDER", preview };
}

export async function executeTerminalOrder(userId: string, input: Record<string, unknown>) {
  const intentId = text(input.intentId);
  const intent = await db.liveTradeIntent.findFirst({ where: { id: intentId, userId } });
  if (!intent || intent.state !== "previewed" || !intent.expiresAt || intent.expiresAt.getTime() < Date.now()) throw new Error("This order preview is missing, expired, or already used.");
  if (intent.initiatedBy !== "user") throw new Error("Legacy automated intents cannot be confirmed. Review any existing reservations manually.");
  const mode = normalizeMode(intent.tradingMode);
  const executionConfig = await assertMode(userId, mode, true);
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
  const reserved = await db.$transaction(async tx => {
    const unresolved = await tx.liveTradeIntent.findFirst({ where: {
      userId, id: { not: intent.id },
      state: { in: ["executing", "submitted", "reconciliation_required", "partially_filled", "exchange_open", "cancelled_with_fills"] },
    }, select: { id: true } });
    if (unresolved) throw new Error("An existing exchange reservation needs reconciliation and protection review before another order can execute.");
    return tx.liveTradeIntent.updateMany({where:{id:intent.id,userId,state:"previewed",initiatedBy:"user",expiresAt:{gt:new Date()}},data:{state:"executing"}});
  }, { isolationLevel: "Serializable", maxWait: 20_000, timeout: 20_000 });
  if(reserved.count!==1)throw new Error("Order already reserved, changed or expired. Refresh before acting.");
  let exchangeAttempted = false;
  try {
    // Revalidate the reserved intent against fresh exchange data and current policy.
    // Validation failure before any exchange write is not an ambiguous submission.
    await validateTerminalOrder(userId, {
      mode, category: intent.category, symbol: intent.productId, side: intent.side,
      orderType: intent.orderType, quantity: intent.baseSize?.toString(),
      price: intent.limitPrice?.toString(), leverage: preview.leverage ?? 1,
      stopLoss: intent.stopLoss?.toString(), takeProfit: intent.takeProfit?.toString(),
      reduceOnly: preview.reduceOnly === true,
      positionIdx: preview.positionIdx ?? 0,
    });
    const currentConfig = await assertMode(userId, mode, true);
    if (currentConfig.environment !== executionConfig.environment || currentConfig.apiKey !== executionConfig.apiKey || currentConfig.apiSecret !== executionConfig.apiSecret) throw new Error("Bybit connection changed during confirmation. Review a new preview.");
    // Emergency stop can change while exchange reads are in flight.
    if ((await getTradingProfile(userId)).emergencyStop) throw new Error("Emergency stop is active.");
    if (intent.category === "linear" && preview.reduceOnly !== true && Number(preview.leverage ?? 1) > 0) {
      exchangeAttempted = true;
      await bybitRequest(userId, "/v5/position/set-leverage", { method: "POST", body: { category: "linear", symbol: intent.productId, buyLeverage: String(preview.leverage), sellLeverage: String(preview.leverage) } }, executionConfig);
    }
    exchangeAttempted = true;
    const execution = await bybitRequest<{ orderId?: string; orderLinkId?: string }>(userId, "/v5/order/create", { method: "POST", body: {
      category: intent.category,
      symbol: intent.productId,
      side: intent.side === "SELL" ? "Sell" : "Buy",
      orderType: intent.orderType,
      qty: intent.baseSize?.toString(),
      ...(intent.orderType === "Limit" ? { price: intent.limitPrice?.toString(), timeInForce: "GTC" } : {}),
      ...(intent.category === "spot" && intent.orderType === "Market" ? { marketUnit: "baseCoin" } : {}),
      ...(intent.category === "linear" ? { reduceOnly: preview.reduceOnly === true, positionIdx: Number(preview.positionIdx ?? 0) } : { isLeverage: 0 }),
      ...((intent.category === "linear" || intent.orderType === "Limit") ? { stopLoss: intent.stopLoss?.toString(), takeProfit: intent.takeProfit?.toString() } : {}),
      ...(intent.category === "spot" && intent.orderType === "Limit" ? {
        ...(intent.stopLoss ? { slOrderType: "Market" } : {}),
        ...(intent.takeProfit ? { tpOrderType: "Market" } : {}),
      } : {}),
      orderLinkId: intent.clientOrderId,
    } }, executionConfig);
    if (!execution.orderId) throw new Error("Bybit accepted no order identifier.");
    await db.liveTradeIntent.update({ where: { id: intent.id }, data: { state: "submitted", providerOrderId: execution.orderId, execution: execution as Prisma.InputJsonValue } });
    await audit(userId, "order.submit", mode, "submitted", { symbol: intent.productId, intentId: intent.id, orderId: execution.orderId });
    return { status: "submitted", orderId: execution.orderId, intentId: intent.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Order submission failed.";
    const failureState = exchangeAttempted ? "reconciliation_required" : "rejected";
    await db.liveTradeIntent.update({ where: { id: intent.id }, data: { state: failureState, execution: { error: message, orderLinkId:intent.clientOrderId } } });
    await audit(userId, "order.submit", mode, failureState, { symbol: intent.productId, intentId: intent.id, error: message });
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
