import "server-only";
import { BybitApiError, bybitRequest, getBybitConfig } from "@/lib/bybit/client";

// Fixed authenticated GET only. Never return provider payloads or credentials.
function amount(value: unknown): string {
  return typeof value === "string" && value.length <= 80 && /^-?\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value)) ? value : "Unavailable";
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
