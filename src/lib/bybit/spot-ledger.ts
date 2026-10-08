/** FIFO accounting from a proven flat USDT starting account; never invent opening cost basis. */
export type SpotFill = {
  execId: string; symbol: string; side: string; execQty: string; execPrice: string;
  execFee: string; feeCurrency?: string; execTime: string; execType?: string; extraFees?: string;
};
function decimal(value: unknown, name: string) {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new Error(`Spot ${name} is unknown.`);
  return Number(value);
}
export function spotLedger(fills: SpotFill[], startMs: number, endMs: number, dailyStartMs: number) {
  const unique = new Map<string, SpotFill>();
  for (const fill of fills) {
    if (!fill.execId) throw new Error("Spot execution identity is missing.");
    const previous = unique.get(fill.execId);
    const fingerprint = (f: SpotFill) => JSON.stringify([f.symbol,f.side,f.execQty,f.execPrice,f.execFee,f.feeCurrency ?? "",f.execTime,f.execType ?? "",f.extraFees ?? ""]);
    if (previous && fingerprint(previous) !== fingerprint(fill)) throw new Error("Spot execution identity conflicts.");
    unique.set(fill.execId, fill);
  }
  const ordered = [...unique.values()].sort((a,b) => Number(a.execTime)-Number(b.execTime) || a.execId.localeCompare(b.execId));
  const directions = new Map<string,string>();
  for (const fill of ordered) {
    const key = `${fill.symbol}:${fill.execTime}`, previous = directions.get(key);
    if (previous && previous !== fill.side) throw new Error("Simultaneous Spot buys and sells require ordering review.");
    directions.set(key,fill.side);
  }
  const lots = new Map<string, Array<{ quantity: number; cost: number }>>();
  let realized = 0, dailyRealized = 0, cashDelta = 0;
  for (const fill of ordered) {
    if (!/^[A-Z0-9]{2,20}USDT$/.test(fill.symbol) || !["Buy","Sell"].includes(fill.side) || (fill.execType && fill.execType !== "Trade") || fill.extraFees) throw new Error("Unsupported Spot execution requires accounting review.");
    const at = decimal(fill.execTime,"execution time"), quantity = decimal(fill.execQty,"quantity"), price = decimal(fill.execPrice,"price"), fee = decimal(fill.execFee,"fee");
    if (!Number.isSafeInteger(at) || at < startMs || at > endMs || quantity <= 0 || price <= 0) throw new Error("Spot execution is outside the accounting window or malformed.");
    const base = fill.symbol.slice(0,-4);
    if (fee !== 0 && fill.feeCurrency !== base && fill.feeCurrency !== "USDT") throw new Error("Spot fee currency is unknown or unsupported.");
    const baseFee = fill.feeCurrency === base ? fee : 0, quoteFee = fill.feeCurrency === "USDT" ? fee : 0;
    const inventory = lots.get(base) ?? [];
    lots.set(base, inventory);
    if (fill.side === "Buy") {
      const received = quantity-baseFee, cost = quantity*price+quoteFee;
      if (received <= 0 || cost <= 0) throw new Error("Spot acquisition fee exceeds the acquired asset.");
      inventory.push({quantity:received,cost});
      cashDelta -= cost;
    } else {
      let remaining = quantity+baseFee, basis = 0;
      if (remaining <= 0) throw new Error("Spot disposal quantity is invalid.");
      while (remaining > 1e-12 && inventory.length) {
        const lot = inventory[0], used = Math.min(remaining,lot.quantity), cost = lot.cost*(used/lot.quantity);
        basis += cost; remaining -= used; lot.quantity -= used; lot.cost -= cost;
        if (lot.quantity <= 1e-12) inventory.shift();
      }
      if (remaining > 1e-12) throw new Error("Spot sale has no proven opening cost basis. Accounting review is required.");
      const proceeds = quantity*price-quoteFee, pnl = proceeds-basis;
      cashDelta += proceeds; realized += pnl;
      if (at >= dailyStartMs) dailyRealized += pnl;
    }
  }
  if (![realized,dailyRealized,cashDelta].every(Number.isFinite)) throw new Error("Spot accounting overflow.");
  return { realized, dailyRealized, cashDelta, executions: ordered.length,
    inventory: Object.fromEntries([...lots].map(([coin,rows]) => [coin,rows.reduce((sum,row)=>sum+row.quantity,0)])) };
}
