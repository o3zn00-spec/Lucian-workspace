import type { PaperResearch } from "@/lib/assistant/paper-research";
import { decimal, fillTotals, formatDecimal, type ShortAccountSettings, type AutonomousDecision, type ExecutionFill } from "./autonomous-policy";
export type ResearchSource = { title: string; url: string; atMs: number; summary: string; kind?: "web" };
export type DecisionEvidence = { atMs: number; researchAtMs: number; decision: AutonomousDecision | null; outcome: string; sources: ResearchSource[]; warnings: string[] };
export function researchSourceUrl(value: unknown, web = false): string | null {
  try { const u = new URL(String(value)); return u.protocol === "https:" && !u.username && !u.password && !u.port && (web || ["api.bybit.com", "announcements.bybit.com", "www.bybit.com", "bybit.com", "api.exchange.coinbase.com", "api.alternative.me"].includes(u.hostname)) && u.href.length <= 1500 ? u.href : null; } catch { return null; }
}
export function decisionEvidence(research: PaperResearch, decision: AutonomousDecision | null, outcome: string, now = Date.now(), web?: { observedAt: string; sources: { title: string; url: string; excerpt: string }[]; coverage: string } | null): DecisionEvidence {
  const sources: ResearchSource[] = [];
  const add = (title: string, url: string, atMs: number, summary: string) => { const safe = researchSourceUrl(url); if (safe && Number.isSafeInteger(atMs) && atMs > 0) sources.push({ title: title.slice(0, 180), url: safe, atMs, summary: summary.slice(0, 500) }); };
  for (const market of research.markets.slice(0, 40)) add(`${market.symbol} · ${market.intervalMinutes} minute candles`, market.source, market.candles.at(-1)?.atMs ?? research.observedAtMs, `${market.candles.length} closed candles; last close ${market.candles.at(-1)?.close}; change ${market.changePercent}%; SMA20 ${market.sma20}; SMA50 ${market.sma50}; range ${market.rangePercent}%. Timestamp is the final candle's opening time.`);
  for (const announcement of research.announcements.slice(0, 20)) add(announcement.title, announcement.url, announcement.publishedAtMs, "Exchange announcement publication time.");
  for (const context of research.context?.slice(0, 10) ?? []) add(`${context.kind} · ${context.symbol}`, context.source, context.atMs, `Observed value ${context.value}.`);
  if (web) for (const source of web.sources.slice(0, 10)) {
    const url = researchSourceUrl(source.url, true), atMs = Date.parse(web.observedAt);
    if (url && Number.isSafeInteger(atMs)) sources.push({ kind: "web", title: source.title.slice(0, 180), url, atMs, summary: `Web search observation time, not publication time. ${source.excerpt}`.slice(0, 500) });
  }
  return { atMs: now, researchAtMs: research.observedAtMs, decision, outcome: outcome.slice(0, 500), sources, warnings: [...(web ? [web.coverage] : []), ...research.warnings].slice(0, 10).map(w => w.slice(0, 600)) };
}
export type ReportOrder = { id: string; providerOrderId: string | null; side: string; state: string; symbol: string; observedAt: string | null; fills: Array<{ quantity: string; price: string; fee: string; currency: string; atMs: number | null }> };
export function projectOrder(order: { id: string; providerOrderId: string | null; side: string; state: string; productId: string; execution: unknown }): ReportOrder {
  const e = order.execution as { reconciliation?: { observedAt?: string; fills?: Array<ExecutionFill & { execTime?: string }> } } | null;
  const fills = Array.isArray(e?.reconciliation?.fills) ? e.reconciliation.fills.slice(0, 200).map(f => ({ quantity: String(f.execQty).slice(0, 40), price: String(f.execPrice).slice(0, 40), fee: String(f.execFee).slice(0, 40), currency: String(f.feeCurrency).slice(0, 20), atMs: Number.isSafeInteger(Number(f.execTime)) && Number(f.execTime) > 0 ? Number(f.execTime) : null })) : [];
  return { id: order.id, providerOrderId: order.providerOrderId, side: order.side, state: order.state, symbol: order.productId, observedAt: typeof e?.reconciliation?.observedAt === "string" ? e.reconciliation.observedAt : null, fills };
}
export function estimateUnrealized(symbol: string, entries: ExecutionFill[], exits: ExecutionFill[], mark: { bid: string; fee: string; atMs: number }, now = Date.now()) {
  if (!entries.length || !Number.isSafeInteger(mark.atMs) || now - mark.atMs > 30000 || mark.atMs > now + 1000) throw Error("Fresh mark and matched entry fills required.");
  const acquired = fillTotals(entries, symbol, "buy"), sold = fillTotals(exits, symbol, "sell"), remaining = acquired.quantity - sold.quantity;
  if (remaining <= 0n || acquired.quantity <= 0n) throw Error("No confirmed remaining holding.");
  const scale = 1000000000000n, fee = decimal(mark.fee, true);
  if (fee > scale / 10n) throw Error("Fee unavailable.");
  const remainingBasisCents = Number((BigInt(acquired.cents) * remaining + acquired.quantity - 1n) / acquired.quantity);
  const estimatedProceedsCents = Number(remaining * decimal(mark.bid) * (scale - fee) * 100n / scale ** 3n);
  if (!Number.isSafeInteger(remainingBasisCents) || !Number.isSafeInteger(estimatedProceedsCents)) throw Error("Valuation bounds exceeded.");
  return { quantity: formatDecimal(remaining), remainingBasisCents, estimatedProceedsCents, unrealizedCents: estimatedProceedsCents - remainingBasisCents, bid: mark.bid, atMs: mark.atMs, fee: mark.fee };
}
export type SessionSummary = { shortSettings?: ShortAccountSettings; product?: "spot" | "linear_short"; id: string; status: string; mode: string; model: string; startedAtMs: number; deadlineMs: number; cashCents: number; realizedCents: number; trades: number; modelCalls: number; error: string | null; protection: string | null };
export type SettledReport = { product?: "linear_short"; netCents?:number; fundingCents?:number; feesCents?:number; id: string; atMs: number; symbol: string; entryId: string; costCents: number; proceedsCents: number; remainingQuantity: string; orders: ReportOrder[]; fillsComplete: boolean };
export type AutonomousReport = {
  sessions: SessionSummary[]; moreSessions: boolean; session: SessionSummary | null;
  decisions: Array<DecisionEvidence & { id: string }>; moreDecisions: boolean;
  trades: SettledReport[]; moreTrades: boolean;
  active: { shortValuation?: { quantity:string; netCents:number; fundingCents:number; ask:string; atMs:number }; orders: ReportOrder[]; unrealized: ReturnType<typeof estimateUnrealized> | null; unavailable: string | null } | null;
  recordedAtMs: number;
};
