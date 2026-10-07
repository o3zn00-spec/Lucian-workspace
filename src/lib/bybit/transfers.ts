import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { bybitPublicRequest, bybitRequest, getBybitConfig } from "@/lib/bybit/client";

type WalletAccount = {
  id: string;
  name: string;
  asset: string;
  balance: string;
  available: string;
  primary: boolean;
  type: "crypto";
  accountType: "UNIFIED" | "FUND";
  referenceCurrency: "USDT";
  convertedBalance: string;
  networks: Array<{ id: string; name: string; depositsEnabled: boolean; withdrawsEnabled: boolean }>;
};

type CoinChain = {
  chain?: string;
  chainType?: string;
  chainDeposit?: string;
  chainWithdraw?: string;
  depositMin?: string;
  withdrawMin?: string;
  minAccuracy?: string;
};

const ASSET_RE = /^[A-Z0-9]{2,12}$/;
const NETWORK_RE = /^[A-Za-z0-9_-]{2,40}$/;
const ADDRESS_RE = /^[a-zA-Z0-9:_-]{8,200}$/;
const TAG_RE = /^[a-zA-Z0-9._:-]{1,120}$/;

function csvSet(name: string, fallback: string): Set<string> {
  return new Set((process.env[name] ?? fallback).split(",").map((item) => item.trim().toUpperCase()).filter(Boolean));
}

function allowedAssets() {
  return csvSet("BYBIT_WITHDRAW_ALLOWED_ASSETS", "BTC,ETH,USDT,USDC,SOL");
}

function allowedNetworks() {
  return csvSet("BYBIT_WITHDRAW_ALLOWED_NETWORKS", "BTC,ETH,TRX,SOL,ARBI,OP,BSC");
}

function positiveDecimal(value: unknown): string {
  const text = typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
  if (!/^\d+(\.\d{1,18})?$/.test(text) || Number(text) <= 0) throw new Error("Enter a valid positive crypto amount.");
  return text;
}

function validAddress(value: unknown): string {
  const address = typeof value === "string" ? value.trim() : "";
  if (!ADDRESS_RE.test(address)) throw new Error("Enter a valid blockchain address. Email withdrawals are disabled.");
  return address;
}

function validTag(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const tag = String(value).trim();
  if (!TAG_RE.test(tag)) throw new Error("Destination tag or memo contains unsupported characters.");
  return tag;
}

export async function bybitTransferSettings(ownerUserId: string) {
  const config = await getBybitConfig(ownerUserId);
  return {
    configured: config.configured,
    environment: config.environment,
    transfersEnabled: process.env.BYBIT_WITHDRAWALS_ENABLED === "true",
    maxSendUsd: Math.max(1, Number(process.env.BYBIT_MAX_WITHDRAW_USD ?? "50")),
    allowedAssets: [...allowedAssets()],
    allowedNetworks: [...allowedNetworks()],
    publicWebSocketBase: config.publicWebSocketBase,
  };
}

async function coinNetworks(ownerUserId: string): Promise<Map<string, WalletAccount["networks"]>> {
  const result = await bybitRequest<{ rows?: Array<{ coin?: string; chains?: CoinChain[] }> }>(ownerUserId, "/v5/asset/coin/query-info");
  const map = new Map<string, WalletAccount["networks"]>();
  for (const row of result.rows ?? []) {
    const coin = String(row.coin ?? "").toUpperCase();
    if (!coin) continue;
    const networks = (row.chains ?? []).flatMap((chain) => {
      const id = String(chain.chain ?? "").trim().toUpperCase();
      if (!NETWORK_RE.test(id)) return [];
      return [{
        id,
        name: String(chain.chainType ?? id),
        depositsEnabled: chain.chainDeposit !== "0",
        withdrawsEnabled: chain.chainWithdraw !== "0",
      }];
    });
    map.set(coin, networks);
  }
  return map;
}

export async function listWalletAccounts(ownerUserId: string): Promise<WalletAccount[]> {
  const [unified, funding, networks] = await Promise.all([
    bybitRequest<{ list?: Array<{ coin?: Array<{ coin?: string; walletBalance?: string; locked?: string; usdValue?: string }> }> }>(
      ownerUserId,
      "/v5/account/wallet-balance",
      { query: { accountType: "UNIFIED" } },
    ),
    bybitRequest<{ balance?: Array<{ coin?: string; walletBalance?: string; transferBalance?: string }> }>(
      ownerUserId,
      "/v5/asset/transfer/query-account-coins-balance",
      { query: { accountType: "FUND" } },
    ),
    coinNetworks(ownerUserId),
  ]);

  const accounts: WalletAccount[] = [];
  for (const coin of unified.list?.[0]?.coin ?? []) {
    const asset = String(coin.coin ?? "").toUpperCase();
    if (!ASSET_RE.test(asset) || Number(coin.walletBalance ?? 0) === 0) continue;
    const balance = String(coin.walletBalance ?? "0");
    const available = String(Math.max(0, Number(balance) - Number(coin.locked ?? 0)));
    accounts.push({ id: `UNIFIED:${asset}`, name: `${asset} Unified`, asset, balance, available, primary: true, type: "crypto", accountType: "UNIFIED", referenceCurrency: "USDT", convertedBalance: String(coin.usdValue ?? "0"), networks: networks.get(asset) ?? [] });
  }
  for (const coin of funding.balance ?? []) {
    const asset = String(coin.coin ?? "").toUpperCase();
    if (!ASSET_RE.test(asset) || Number(coin.walletBalance ?? 0) === 0) continue;
    accounts.push({ id: `FUND:${asset}`, name: `${asset} Funding`, asset, balance: String(coin.walletBalance ?? "0"), available: String(coin.transferBalance ?? coin.walletBalance ?? "0"), primary: false, type: "crypto", accountType: "FUND", referenceCurrency: "USDT", convertedBalance: "0", networks: networks.get(asset) ?? [] });
  }
  for (const asset of allowedAssets()) {
    if (accounts.some((account) => account.asset === asset)) continue;
    accounts.push({ id: `FUND:${asset}`, name: `${asset} Funding`, asset, balance: "0", available: "0", primary: false, type: "crypto", accountType: "FUND", referenceCurrency: "USDT", convertedBalance: "0", networks: networks.get(asset) ?? [] });
  }
  return accounts.sort((a, b) => Number(b.convertedBalance) - Number(a.convertedBalance) || a.asset.localeCompare(b.asset));
}

async function selectedWallet(ownerUserId: string, accountId: unknown): Promise<WalletAccount> {
  const id = typeof accountId === "string" ? accountId.trim() : "";
  if (!id) throw new Error("Select a Bybit wallet.");
  const wallet = (await listWalletAccounts(ownerUserId)).find((item) => item.id === id);
  if (!wallet) throw new Error("The selected Bybit wallet was not found.");
  return wallet;
}

function selectedNetwork(wallet: WalletAccount, value: unknown, operation: "deposit" | "withdrawal") {
  const network = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!NETWORK_RE.test(network)) throw new Error("Select a valid blockchain network.");
  if (!allowedNetworks().has(network)) throw new Error(`${network} is not enabled in LUCIAN's Bybit allowlist.`);
  const matched = wallet.networks.find((item) => item.id === network);
  if (!matched || (operation === "deposit" ? !matched.depositsEnabled : !matched.withdrawsEnabled)) {
    throw new Error(`Bybit does not currently allow ${operation}s for ${wallet.asset} on ${network}.`);
  }
  return network;
}

async function spotUsd(ownerUserId: string, asset: string): Promise<number> {
  if (["USD", "USDT", "USDC"].includes(asset)) return 1;
  const { environment } = await getBybitConfig(ownerUserId);
  const result = await bybitPublicRequest<{ list?: Array<{ lastPrice?: string }> }>(environment, "/v5/market/tickers", { category: "spot", symbol: `${asset}USDT` });
  const price = Number(result.list?.[0]?.lastPrice ?? 0);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`Bybit returned an invalid ${asset}/USDT price.`);
  return price;
}

export async function getReceiveAddress(ownerUserId: string, input: Record<string, unknown>) {
  const wallet = await selectedWallet(ownerUserId, input.accountId);
  if (!allowedAssets().has(wallet.asset)) throw new Error(`${wallet.asset} deposits are not enabled in LUCIAN.`);
  const network = selectedNetwork(wallet, input.network, "deposit");
  const result = await bybitRequest<{ coin?: string; chains?: Array<{ chainType?: string; addressDeposit?: string; tagDeposit?: string }> }>(
    ownerUserId,
    "/v5/asset/deposit/query-address",
    { query: { coin: wallet.asset, chainType: network } },
  );
  const chain = (result.chains ?? []).find((item) => String(item.chainType ?? "").toUpperCase() === network) ?? result.chains?.[0];
  const address = String(chain?.addressDeposit ?? "").trim();
  if (!address) throw new Error("Bybit did not return a deposit address for this coin and network.");
  const tag = String(chain?.tagDeposit ?? "").trim() || null;
  const providerAddressId = `bybit:${wallet.asset}:${network}:${address}`;
  const saved = await db.cryptoReceiveAddress.upsert({
    where: { userId_providerAddressId: { userId: ownerUserId, providerAddressId } },
    create: { userId: ownerUserId, provider: "bybit", exchangeAccountId: wallet.id, providerAddressId, asset: wallet.asset, network, address, tag, label: "Bybit Vault deposit" },
    update: { network, address, tag, label: "Bybit Vault deposit" },
  });
  return { id: saved.id, asset: saved.asset, network: saved.network, address: saved.address, tag: saved.tag, label: saved.label, createdAt: saved.createdAt };
}

export async function listReceiveAddresses(ownerUserId: string) {
  return db.cryptoReceiveAddress.findMany({ where: { userId: ownerUserId, provider: "bybit" }, orderBy: { createdAt: "desc" }, take: 50 });
}

export async function listDepositHistory(ownerUserId: string) {
  const result = await bybitRequest<{ rows?: Array<Record<string, string>> }>(ownerUserId, "/v5/asset/deposit/query-record", { query: { limit: 50 } });
  return (result.rows ?? []).map((row) => ({
    id: row.id ?? row.txID,
    asset: row.coin,
    network: row.chain,
    amount: row.amount,
    status: row.status,
    transactionId: row.txID,
    createdAt: row.successAt || row.blockTime,
  }));
}

export async function previewBybitWithdrawal(ownerUserId: string, input: Record<string, unknown>) {
  const wallet = await selectedWallet(ownerUserId, input.accountId);
  if (!allowedAssets().has(wallet.asset)) throw new Error(`${wallet.asset} withdrawals are not enabled in LUCIAN.`);
  const network = selectedNetwork(wallet, input.network, "withdrawal");
  const destination = validAddress(input.destination);
  const destinationTag = validTag(input.destinationTag);
  const amount = positiveDecimal(input.amount);
  if (Number(amount) > Number(wallet.available)) throw new Error(`The selected Bybit wallet has only ${wallet.available} ${wallet.asset} available.`);
  const estimatedUsd = Number(amount) * await spotUsd(ownerUserId, wallet.asset);
  const settings = await bybitTransferSettings(ownerUserId);
  if (estimatedUsd > settings.maxSendUsd + 0.000001) throw new Error(`This withdrawal exceeds LUCIAN's $${settings.maxSendUsd.toFixed(2)} server limit.`);
  const confirmationText = `WITHDRAW ${amount} ${wallet.asset} TO ${destination.slice(-6).toUpperCase()}`;
  const intent = await db.cryptoTransferIntent.create({
    data: {
      userId: ownerUserId,
      provider: "bybit",
      idempotencyKey: `bybit:${randomUUID()}`,
      exchangeAccountId: wallet.id,
      asset: wallet.asset,
      network,
      destination,
      destinationTag,
      amount,
      estimatedUsd,
      confirmationText,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    },
  });
  return {
    intentId: intent.id,
    asset: wallet.asset,
    network,
    amount,
    estimatedUsd,
    destinationMasked: maskDestination(destination),
    destinationTag,
    confirmationText,
    expiresAt: intent.expiresAt,
    transfersEnabled: settings.transfersEnabled,
    warning: "A blockchain withdrawal is generally irreversible. Verify the full address, tag, asset, and Bybit network before confirming.",
  };
}

async function verifyCurrentPassword(ownerUserId: string, password: unknown) {
  if (typeof password !== "string" || password.length < 1 || password.length > 1024) throw new Error("Your current LUCIAN password is required.");
  const user = await db.user.findUnique({ where: { id: ownerUserId }, select: { passwordHash: true } });
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) throw new Error("Current LUCIAN password verification failed.");
}

export async function executeBybitWithdrawal(ownerUserId: string, input: Record<string, unknown>) {
  if (process.env.BYBIT_WITHDRAWALS_ENABLED !== "true") throw new Error("Bybit withdrawals are locked by BYBIT_WITHDRAWALS_ENABLED.");
  await verifyCurrentPassword(ownerUserId, input.password);
  const intentId = typeof input.intentId === "string" ? input.intentId : "";
  const typed = typeof input.confirmationText === "string" ? input.confirmationText.trim() : "";
  const intent = await db.cryptoTransferIntent.findFirst({ where: { id: intentId, userId: ownerUserId, provider: "bybit" } });
  if (!intent || intent.state !== "previewed") throw new Error("This withdrawal preview is missing or has already been used.");
  if (intent.expiresAt.getTime() < Date.now()) {
    await db.cryptoTransferIntent.update({ where: { id: intent.id }, data: { state: "expired" } });
    throw new Error("This withdrawal preview expired. Create a new preview.");
  }
  if (typed !== intent.confirmationText) throw new Error("The confirmation phrase does not match exactly.");
  const wallet = await selectedWallet(ownerUserId, intent.exchangeAccountId);
  if (wallet.asset !== intent.asset || Number(intent.amount) > Number(wallet.available)) throw new Error("The Bybit wallet balance changed and no longer covers this withdrawal.");
  const currentEstimatedUsd = Number(intent.amount) * await spotUsd(ownerUserId, intent.asset);
  const settings = await bybitTransferSettings(ownerUserId);
  if (currentEstimatedUsd > settings.maxSendUsd + 0.000001) throw new Error(`The current value exceeds LUCIAN's $${settings.maxSendUsd.toFixed(2)} server limit.`);

  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ownerUserId}))`;
    const fresh = await tx.cryptoTransferIntent.findFirst({ where: { id: intent.id, userId: ownerUserId, provider: "bybit", state: "previewed" } });
    if (!fresh) throw new Error("This withdrawal was already submitted from another tab.");
    await tx.cryptoTransferIntent.update({ where: { id: fresh.id }, data: { state: "submitting", confirmedAt: new Date(), estimatedUsd: currentEstimatedUsd } });
  });

  const accountType = wallet.accountType === "FUND" ? "FUND" : "UTA";
  const requestId = intent.idempotencyKey.replace(/[^a-zA-Z0-9]/g, "").slice(-32);
  try {
    const result = await bybitRequest<{ id?: string }>(ownerUserId, "/v5/asset/withdraw/create", {
      method: "POST",
      body: {
        coin: intent.asset,
        chain: intent.network,
        address: intent.destination,
        tag: intent.destinationTag || undefined,
        amount: intent.amount.toString(),
        timestamp: Date.now(),
        forceChain: 0,
        accountType,
        feeType: 0,
        requestId,
      },
    });
    if (!result.id) throw new Error("Bybit accepted no withdrawal identifier.");
    await db.cryptoTransferIntent.update({ where: { id: intent.id }, data: { state: "pending", providerTransactionId: result.id, providerResponse: result as Prisma.InputJsonValue } });
    return { intentId: intent.id, providerTransactionId: result.id, state: "pending" };
  } catch (error) {
    await db.cryptoTransferIntent.updateMany({ where: { id: intent.id, state: "submitting" }, data: { state: "submission_unknown", providerResponse: { error: error instanceof Error ? error.message : "Network failure" } } });
    throw error;
  }
}

function maskDestination(destination: string) {
  return destination.length <= 14 ? destination : `${destination.slice(0, 8)}…${destination.slice(-6)}`;
}

export async function listWithdrawalHistory(ownerUserId: string) {
  const [remote, local] = await Promise.all([
    bybitRequest<{ rows?: Array<Record<string, string>> }>(ownerUserId, "/v5/asset/withdraw/query-record", { query: { limit: 50 } }),
    db.cryptoTransferIntent.findMany({ where: { userId: ownerUserId, provider: "bybit" }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return {
    remote: (remote.rows ?? []).map((row) => ({ id: row.withdrawalId, asset: row.coin, network: row.chain, amount: row.amount, status: row.status, transactionId: row.txID, createdAt: row.createTime })),
    local: local.map((row) => ({ id: row.id, asset: row.asset, network: row.network, destinationMasked: maskDestination(row.destination), destinationTag: row.destinationTag, amount: row.amount.toString(), estimatedUsd: row.estimatedUsd.toString(), state: row.state, providerTransactionId: row.providerTransactionId, createdAt: row.createdAt })),
  };
}
