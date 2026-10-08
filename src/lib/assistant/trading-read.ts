import "server-only";
import { BybitApiError, bybitRequest, getBybitConfig } from "@/lib/bybit/client";

// Fixed authenticated GET only. Never return provider payloads or credentials.
function amount(value: unknown): string {
  return typeof value === "string" && value.length <= 80 && /^-?\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? value : "Unavailable";
}

type Page = { list?: unknown; nextPageCursor?: unknown };
const label = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9-]{1,40}$/.test(value) ? value : "Unavailable";
export async function readTradingActivity(userId: string): Promise<{ ok: boolean; text: string }> {
  const config = await getBybitConfig(userId);
  if (!config.configured) return { ok: false, text: "Bybit credentials are not configured. Orders and positions are unavailable, not confirmed empty." };
  const queries = [
    { title: "Spot open orders", path: "/v5/order/realtime", query: { category: "spot", openOnly: 0, limit: 50 }, positions: false },
    { title: "USDT linear open orders", path: "/v5/order/realtime", query: { category: "linear", settleCoin: "USDT", openOnly: 0, limit: 50 }, positions: false },
    { title: "USDT linear positions", path: "/v5/position/list", query: { category: "linear", settleCoin: "USDT", limit: 50 }, positions: true },
  ];
  const results = await Promise.allSettled(queries.map(q => bybitRequest<Page>(userId, q.path, { method: "GET", query: q.query }, config)));
  let complete = true;
  const sections = results.map((result, index) => {
    const q = queries[index];
    if (result.status !== "fulfilled" || !Array.isArray(result.value?.list) || result.value.list.some(item => !item || typeof item !== "object" || Array.isArray(item))) {
      complete = false;
      return `### ${q.title}\nUnavailable: this read failed or returned invalid data. No empty list is confirmed.`;
    }
    const rows = result.value.list as Record<string, unknown>[];
    const partial = Boolean(result.value.nextPageCursor) || rows.length > 12;
    if (partial) complete = false;
    const format = (row: Record<string, unknown>) => q.positions
      ? `- ${label(row.symbol)} · ${label(row.side)} · size ${amount(row.size)} · average price ${amount(row.avgPrice)} · unrealized P/L ${amount(row.unrealisedPnl)} · leverage ${amount(row.leverage)} · stop loss ${amount(row.stopLoss)} · take profit ${amount(row.takeProfit)}`
      : `- ${label(row.symbol)} · ${label(row.side)} · ${label(row.orderType)} · ${label(row.orderStatus)} · quantity ${amount(row.qty)} · price ${amount(row.price)} · filled quantity ${amount(row.cumExecQty)} · remaining quantity ${amount(row.leavesQty)}`;
    return `### ${q.title}\n${partial ? "Partial snapshot: additional rows/pages are omitted.\n" : ""}${rows.length ? rows.slice(0, 12).map(format).join("\n") : "No rows returned for this specific query."}`;
  });
  return { ok: complete, text: `Bybit ${config.environment === "mainnet" ? "Mainnet — real funds" : "Testnet — test funds"} · read at ${new Date().toISOString()}\nBounded snapshots: up to 12 displayed rows per query. ${complete ? "All three requested reads succeeded within the display limit." : "Incomplete snapshot: at least one read failed or additional rows were omitted."}\n\n${sections.join("\n\n")}\n\nOther settlement currencies, inverse contracts, options, Funding wallets and closed-order history are excluded. Position size zero means a flat position row, not a missing request. Values are in the product's units, not all USD. These are observations, not continuous risk monitoring or proof that protective orders will execute. No orders were placed, changed or cancelled.` };
}
export async function readTradingBalance(userId: string): Promise<{ ok: boolean; text: string }> {
  const config = await getBybitConfig(userId);
  const environment = config.environment === "mainnet" ? "Mainnet — real funds" : "Testnet — test funds";
  if (!config.configured) return { ok: false, text: "Bybit credentials are not configured. Balance is unavailable; no zero balance is confirmed." };
  try {
    const result = await bybitRequest<{ list?: Record<string, unknown>[] }>(userId, "/v5/account/wallet-balance", { method: "GET", query: { accountType: "UNIFIED" } }, config);
    const wallet = result?.list?.find(item => item.accountType === "UNIFIED");
    if (!wallet) throw Error("Missing account");
    const fields = [wallet.totalEquity, wallet.totalWalletBalance, wallet.totalAvailableBalance].map(amount);
    const coins = Array.isArray(wallet.coin) ? wallet.coin.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
    if (fields.every(value => value === "Unavailable") && !coins.length) throw Error("Missing balances");
    const text = `Bybit Unified account · ${environment}\nRead at ${new Date().toISOString()} (a snapshot, not continuous monitoring).\n\n- Total equity (USD): ${fields[0]}\n- Wallet balance (USD): ${fields[1]}\n- Available balance (USD, where applicable to margin mode): ${fields[2]}\n\n${coins.length ? "Asset balances (up to 12 returned assets):\n" + coins.slice(0, 12).map(item => `- ${typeof item.coin === "string" && /^[A-Z0-9]{1,20}$/.test(item.coin) ? item.coin : "Unknown asset"}: wallet ${amount(item.walletBalance)}, equity ${amount(item.equity)}, USD value ${amount(item.usdValue)}`).join("\n") : "No asset rows returned; Bybit normally omits zero asset/liability rows."}\n\nFunding wallets, orders and positions are excluded. Unavailable fields do not mean zero. These figures are not withdrawal limits or permission to trade. No money was moved.`;
    return { ok: true, text };
  } catch (error) {
    const detail = error instanceof BybitApiError ? ` Provider status ${error.httpStatus}, code ${error.code}.` : "";
    return { ok: false, text: `Bybit Unified balance could not be verified (${environment}).${detail} Balance is unavailable; no zero balance is confirmed. Check Connections and retry. No money was moved.` };
  }
}
