type Row = Record<string, string>;

function nonnegative(value: unknown, label: string) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) {
    throw new Error(`${label} is unavailable. Account exposure cannot be estimated safely.`);
  }
  return Number(value);
}

/** Conservative gross exposure: holdings plus all potentially increasing orders.
 * Do not net pending sells/hedges against inventory before confirmed fills.
 */
export function accountExposure(coins: Row[], positions: Row[], spotOrders: Row[], linearOrders: Row[]) {
  let exposure = 0;
  const assets = new Set<string>();
  const seenCoins = new Set<string>();
  for (const coin of coins) {
    if (!coin.coin || seenCoins.has(coin.coin)) throw new Error("Conflicting wallet currencies.");
    seenCoins.add(coin.coin);
    const balance = nonnegative(coin.walletBalance, "Wallet inventory");
    if (!balance || coin.coin === "USDT") continue;
    const usd = nonnegative(coin.usdValue, "Inventory USD value");
    exposure += usd;
    assets.add(`spot:${coin.coin}`);
  }
  for (const position of positions) {
    const size = nonnegative(position.size, "Position size");
    if (!size) continue;
    if (!position.symbol || !["Buy", "Sell"].includes(position.side)) throw new Error("Position identity is unavailable.");
    exposure += nonnegative(position.positionValue, "Position exposure");
    assets.add(`linear:${position.symbol}:${position.positionIdx}`);
  }
  for (const [category, orders] of [["spot", spotOrders], ["linear", linearOrders]] as const) {
    const seen = new Set<string>();
    for (const order of orders) {
      if (!order.orderId || seen.has(order.orderId) || !order.symbol || !["Buy", "Sell"].includes(order.side)) throw new Error("Open-order identity is unavailable or duplicated.");
      seen.add(order.orderId);
      if (category === "spot" && order.side === "Sell") continue;
      if (category === "linear") {
        if (!["true", "false"].includes(String(order.reduceOnly))) throw new Error("Open-order reduction flag is unavailable.");
        if (String(order.reduceOnly) === "true") continue;
      }
      // leavesValue is provider-computed remaining notional, including quote-unit orders.
      const value = nonnegative(order.leavesValue, "Pending-order value");
      exposure += value;
      if (value) assets.add(`${category}:${category === "spot" ? order.symbol.replace(/USDT$/, "") : `${order.symbol}:${order.positionIdx}`}`);
    }
  }
  if (!Number.isFinite(exposure)) throw new Error("Account exposure overflow.");
  return { exposure, assets };
}
