"use client";

// LUCIAN Economic Agent — Context Provider Layer.
//
// Phase 6: builds REAL context data from LUCIAN's live stores so the
// model receives actual market data, investment holdings, economy hub
// entries, etc. — not just labels and descriptions.
//
// Each context provider:
//   1. Reads from the relevant store (Markets, Investing, Economy Hub, etc.)
//   2. Selects useful relevant fields (NOT giant datasets)
//   3. Returns a serialized string suitable for the system prompt
//   4. Returns null if no usable data is available (honest unavailable state)

import { useMarketsStore } from "@/store/markets";
import { useInvestingStore } from "@/store/investing";
import { useEconomyHubStore } from "@/store/economy-hub";
import { getInstrumentBySymbol } from "@/lib/markets/catalog";
import { isSupportedCrypto } from "@/lib/markets/symbol-mapping";

export interface ContextSource {
  id: string;
  type: "market" | "investment" | "economy" | "note";
  label: string;
  description: string;
  /** The actual serialized context data sent to the model. Null if unavailable. */
  data: string | null;
}

/** Build real Markets context from the shared markets store. */
export function buildMarketsContext(): ContextSource | null {
  const state = useMarketsStore.getState();
  const activePane = state.paneStates[state.activePaneIndex] ?? state.paneStates[0];
  if (!activePane) return null;

  const symbol = activePane.symbol;
  const timeframe = activePane.timeframe;
  const livePrice = state.prices.get(symbol);
  const ticker = state.tickers.get(symbol);
  const status = state.statusBySymbol.get(symbol);
  const inst = getInstrumentBySymbol(symbol) ?? getInstrumentBySymbol(symbol + ".Daily");
  const positions = state.positions.filter((p) => p.symbol === symbol);
  const pendingOrders = state.pendingOrders.filter((o) => o.symbol === symbol);

  const lines: string[] = [
    `Symbol: ${symbol}`,
    `Name: ${inst?.name ?? "Unknown"}`,
    `Timeframe: ${timeframe}`,
    `Asset class: ${inst?.assetClass ?? "unknown"}`,
  ];

  if (livePrice !== undefined) {
    lines.push(`Live price: $${livePrice.toFixed(2)}`);
    if (status === "disconnected") {
      lines.push(`Status: UNAVAILABLE (provider disconnected, price is stale)`);
    } else {
      lines.push(`Status: LIVE`);
    }
  } else {
    lines.push(`Status: ${status ?? "unknown"}`);
  }

  if (ticker) {
    lines.push(`24h change: ${ticker.priceChangePercent?.toFixed(2)}%`);
    lines.push(`24h high: $${ticker.highPrice?.toFixed(2)}`);
    lines.push(`24h low: $${ticker.lowPrice?.toFixed(2)}`);
    lines.push(`24h volume: ${ticker.volume?.toFixed(2)}`);
    lines.push(`Bid: $${ticker.bidPrice?.toFixed(2)}`);
    lines.push(`Ask: $${ticker.askPrice?.toFixed(2)}`);
  }

  if (positions.length > 0) {
    lines.push("", `Open Virtual positions for ${symbol}: ${positions.length}`);
    for (const p of positions) {
      lines.push(`  — ${p.side.toUpperCase()} ${p.volume} lots @ ${p.entryPrice}, P/L: $${p.unrealizedPnl.toFixed(2)}`);
    }
  }

  if (pendingOrders.length > 0) {
    lines.push("", `Pending orders for ${symbol}: ${pendingOrders.length}`);
    for (const o of pendingOrders) {
      lines.push(`  — ${o.orderType} ${o.side} ${o.volume} @ ${o.price}`);
    }
  }

  return {
    id: "market-context",
    type: "market",
    label: symbol,
    description: `${timeframe} · ${inst?.name ?? symbol}`,
    data: lines.join("\n"),
  };
}

/** Build real Investing context from the investing store. */
export function buildInvestingContext(): ContextSource | null {
  const state = useInvestingStore.getState();
  if (state.investments.length === 0) return null;

  // Use the first investment as the selected holding (or the most recent).
  const inv = state.investments[state.investments.length - 1];
  const txns = state.transactions.filter((t) => t.investmentId === inv.id);
  const divs = state.dividends.filter((d) => d.investmentId === inv.id);
  const thesis = state.theses.find((t) => t.investmentId === inv.id);

  const { getCurrentPriceWithStatus } = require("@/store/investing");
  const { price, status } = getCurrentPriceWithStatus(inv.symbol);

  const lines: string[] = [
    `Holding: ${inv.symbol}`,
    `Name: ${inv.name}`,
    `Type: ${inv.assetType}`,
  ];

  if (price > 0) {
    lines.push(`Current price: $${price.toFixed(2)} (${status})`);
  } else {
    lines.push(`Current price: unavailable (${status})`);
  }

  // Cost basis from transactions.
  const buys = txns.filter((t) => t.type === "buy");
  const sells = txns.filter((t) => t.type === "sell");
  const totalBoughtQty = buys.reduce((s, t) => s + t.quantity, 0);
  const totalBoughtCost = buys.reduce((s, t) => s + t.quantity * t.price + t.fees, 0);
  const totalSoldQty = sells.reduce((s, t) => s + t.quantity, 0);
  const remainingQty = totalBoughtQty - totalSoldQty;
  const avgCost = totalBoughtQty > 0 ? totalBoughtCost / totalBoughtQty : 0;

  lines.push(`Quantity: ${remainingQty}`);
  lines.push(`Average cost: $${avgCost.toFixed(2)}`);
  lines.push(`Cost basis: $${(remainingQty * avgCost).toFixed(2)}`);

  if (price > 0) {
    const marketValue = remainingQty * price;
    const unrealizedPnl = marketValue - remainingQty * avgCost;
    lines.push(`Market value: $${marketValue.toFixed(2)}`);
    lines.push(`Unrealized P/L: $${unrealizedPnl.toFixed(2)}`);
  }

  if (totalBoughtQty > 0) {
    lines.push("", `Transactions: ${txns.length} (${buys.length} buys, ${sells.length} sells)`);
  }

  if (divs.length > 0) {
    const totalDivs = divs.reduce((s, d) => s + d.amount, 0);
    lines.push(`Dividends received: $${totalDivs.toFixed(2)} (${divs.length} payments)`);
  }

  if (thesis) {
    lines.push("", "Investment Thesis:");
    if (thesis.reason) lines.push(`  Reason: ${thesis.reason}`);
    if (thesis.horizon) lines.push(`  Horizon: ${thesis.horizon}`);
    lines.push(`  Confidence: ${thesis.confidence}`);
    if (thesis.targetPrice > 0) lines.push(`  Target price: $${thesis.targetPrice.toFixed(2)}`);
    if (thesis.risks) lines.push(`  Risks: ${thesis.risks}`);
  }

  return {
    id: "investment-context",
    type: "investment",
    label: inv.symbol,
    description: `${inv.name} · ${inv.assetType}`,
    data: lines.join("\n"),
  };
}

/** Build real Economy Hub context from the economy hub store. */
export function buildEconomyContext(): ContextSource | null {
  const state = useEconomyHubStore.getState();
  const opportunities = state.opportunities;
  if (opportunities.length === 0) return null;

  // Use the most recent opportunity.
  const opp = opportunities[0];
  const lines: string[] = [
    `Opportunity: ${opp.name}`,
    `Status: ${opp.status}`,
    `Score: ${opp.score}`,
    `Category: ${opp.category ?? "unknown"}`,
  ];

  if (opp.description) lines.push(`Description: ${opp.description}`);
  if (opp.notes) lines.push(`Notes: ${opp.notes}`);

  const relatedBusinesses = state.businesses.filter((b) => b.sourceOpportunityId === opp.id);
  if (relatedBusinesses.length > 0) {
    lines.push("", `Related businesses: ${relatedBusinesses.length}`);
    for (const b of relatedBusinesses.slice(0, 3)) {
      lines.push(`  — ${b.name}: revenue $${b.revenue?.toFixed(2) ?? 0}, expenses $${b.expenses?.toFixed(2) ?? 0}`);
    }
  }

  const relatedResearch = state.researchRecords.filter((r) =>
    r.relatedOpportunityIds?.includes(opp.id),
  );
  if (relatedResearch.length > 0) {
    lines.push("", `Related research: ${relatedResearch.length}`);
    for (const r of relatedResearch.slice(0, 3)) {
      lines.push(`  — ${r.title} (${r.type})`);
    }
  }

  return {
    id: "economy-context",
    type: "economy",
    label: opp.name,
    description: `Score: ${opp.score} · ${opp.status}`,
    data: lines.join("\n"),
  };
}

/** Get all available context sources. Returns only sources that have real data. */
export function getAvailableContextSources(): ContextSource[] {
  const sources: ContextSource[] = [];
  const market = buildMarketsContext();
  if (market && market.data) sources.push(market);
  const investment = buildInvestingContext();
  if (investment && investment.data) sources.push(investment);
  const economy = buildEconomyContext();
  if (economy && economy.data) sources.push(economy);
  return sources;
}

/** Attach a context source to the Economic Agent store. */
export function attachContext(source: ContextSource): void {
  const { useEconomicAgentStore } = require("@/store/economic-agent");
  useEconomicAgentStore.getState().addContextItem({
    type: source.type as "market" | "investment" | "vault" | "business" | "economy",
    label: source.label,
    description: source.description,
    data: source.data ?? undefined,
  });
}
