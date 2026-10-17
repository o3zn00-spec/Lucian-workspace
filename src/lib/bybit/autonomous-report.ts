import "server-only";
import { db } from "@/lib/db";
import { validateSession, type AutonomousSession } from "./autonomous-session";
import { autonomousQuote, autonomousWallet, connectionIdentity } from "./autonomous-market";
import { getBybitConfig } from "./client";
import { shortPosition, shortLedger, shortMark } from "./autonomous-short";
import { shortSettingsFor, AutonomousError, decimal, formatDecimal, parseAutonomousDecision, type ExecutionFill } from "./autonomous-policy";
import { estimateUnrealized, projectOrder, researchSourceUrl, type AutonomousReport, type DecisionEvidence, type SessionSummary } from "./autonomous-report-data";
const pageSize = 10;
const activeKey = "_live_session:active", archivePrefix = "_live_session:archive:";
const safeId = (s: string) => /^[a-f0-9-]{36}$/.test(s);
function summary(s: AutonomousSession): SessionSummary {
  return { ...(s.plan.shortSettings ? {shortSettings:s.plan.shortSettings} : {}), product: s.plan.product ?? "spot", id: s.id, status: s.status, mode: s.plan.mode, model: s.model, startedAtMs: s.startedAtMs, deadlineMs: s.deadlineMs, cashCents: s.cashCents, realizedCents: s.realizedCents, trades: s.trades, modelCalls: s.modelCalls, error: s.error, protection: s.active?.protection ?? null };
}
const materialSession = (s: AutonomousSession | null) => JSON.stringify(s ? [summary(s), s.plan, s.active, s.dust, s.connection] : null);
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function readEvidence(value: unknown): DecisionEvidence {
  const e = object(value);
  if (!Number.isSafeInteger(e.atMs) || !Number.isSafeInteger(e.researchAtMs) || !Array.isArray(e.sources) || !Array.isArray(e.warnings) || typeof e.outcome !== "string") throw Error("Incomplete decision record.");
  return { atMs: e.atMs as number, researchAtMs: e.researchAtMs as number, decision: e.decision ? parseAutonomousDecision(JSON.stringify(e.decision)) : null, outcome: e.outcome.slice(0, 500), sources: e.sources.slice(0, 70).flatMap(raw => {
    const s = object(raw), url = researchSourceUrl(s.url, s.kind === "web");
    return url && typeof s.title === "string" && typeof s.summary === "string" && Number.isSafeInteger(s.atMs) ? [{ ...(s.kind === "web" ? { kind: "web" as const } : {}), title: s.title.slice(0, 180), url, summary: s.summary.slice(0, 500), atMs: s.atMs as number }] : [];
  }), warnings: e.warnings.filter(w => typeof w === "string").slice(0, 10).map(w => w.slice(0, 600)) };
}
export async function readAutonomousReport(userId: string, options: { sessionId?: string; sessionPage?: number; tradePage?: number; decisionPage?: number } = {}): Promise<AutonomousReport> {
  const { sessionId, sessionPage = 0, tradePage = 0, decisionPage = 0 } = options;
  if (sessionId && !safeId(sessionId) || [sessionPage, tradePage, decisionPage].some(n => !Number.isInteger(n) || n < 0 || n > 1000)) throw new AutonomousError("Invalid report page.");
  const [current, archives] = await Promise.all([
    db.assistantMemory.findUnique({ where: { userId_key: { userId, key: activeKey } }, select: { value: true } }),
    db.assistantMemory.findMany({ where: { userId, key: { startsWith: archivePrefix } }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: sessionPage * pageSize, take: pageSize + 1, select: { value: true } }),
  ]);
  const active = current ? validateSession(JSON.parse(current.value)) : null;
  const sessions = [...(active ? [summary(active)] : []), ...archives.slice(0, pageSize).map(row => summary(validateSession(JSON.parse(row.value))))];
  let selected = active;
  if (sessionId && selected?.id !== sessionId) {
    const row = await db.assistantMemory.findUnique({ where: { userId_key: { userId, key: archivePrefix + sessionId } }, select: { value: true } });
    if (!row) throw new AutonomousError("Session report unavailable.", 404);
    selected = validateSession(JSON.parse(row.value));
    if (selected.id !== sessionId) throw new AutonomousError("Session history integrity check failed.", 503);
  }
  const empty: AutonomousReport = { sessions, moreSessions: archives.length > pageSize, session: selected ? summary(selected) : null, decisions: [], moreDecisions: false, trades: [], moreTrades: false, active: null, recordedAtMs: Date.now() };
  if (!selected) return empty;
  const session = selected;
  const [decisions, trades] = await Promise.all([
    db.tradingAuditEvent.findMany({ where: { userId, action: "session.research_decision", details: { path: ["sessionId"], equals: session.id } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: decisionPage * pageSize, take: pageSize + 1, select: { id: true, details: true } }),
    db.tradingAuditEvent.findMany({ where: { userId, action: "session.trade_settled", details: { path: ["sessionId"], equals: session.id } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: tradePage * pageSize, take: pageSize + 1, select: { id: true, symbol: true, createdAt: true, details: true } }),
  ]);
  async function ordersFor(ids: string[]) {
    if (ids.length > 33 || ids.some(id => typeof id !== "string" || id.length > 100) || new Set(ids).size !== ids.length) throw Error("Invalid trade journal.");
    return db.liveTradeIntent.findMany({ where: { userId, initiatedBy: "owner_session", id: { in: ids }, preview: { path: ["sessionId"], equals: session.id } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 33, select: { id: true, providerOrderId: true, side: true, state: true, productId: true, execution: true } });
  }
  const settled = await Promise.all(trades.slice(0, pageSize).map(async row => {
    const t = object(row.details);
    if (typeof t.entryId !== "string" || !Array.isArray(t.sellIds) || !Number.isSafeInteger(t.costCents) || !Number.isSafeInteger(t.proceedsCents) || typeof t.remainingQuantity !== "string") throw Error("Incomplete settlement record.");
    if(t.product === "linear_short" && ![t.netCents,t.fundingCents,t.feesCents].every(Number.isSafeInteger))throw Error("Incomplete short settlement accounting.");
    const ids = [t.entryId, ...t.sellIds] as string[], orders = await ordersFor(ids);
    return { ...(t.product === "linear_short" ? {product:"linear_short" as const,netCents:t.netCents as number,fundingCents:t.fundingCents as number,feesCents:t.feesCents as number} : {}), id: row.id, atMs: row.createdAt.getTime(), symbol: row.symbol ?? "Unknown", entryId: t.entryId, costCents: t.costCents as number, proceedsCents: t.proceedsCents as number, remainingQuantity: t.remainingQuantity, orders: orders.map(projectOrder), fillsComplete: orders.length === ids.length && orders.every(order => Array.isArray(object(object(order.execution).reconciliation).fills) && (object(object(order.execution).reconciliation).fills as unknown[]).length <= 200) };
  }));
  let held: AutonomousReport["active"] = null;
  if (session.active) {
    const ids = [session.active.entryId, ...session.active.sellIds], orders = await ordersFor(ids);
    held = { orders: orders.map(projectOrder), unrealized: null, unavailable: "Unrealized result unavailable until entry, exits, wallet and a fresh mark agree." };
    try {
      if (session.id !== active?.id || orders.length !== ids.length || connectionIdentity(await getBybitConfig(userId)) !== session.connection) throw Error("Current connection required.");
      const reports = orders.map(order => ({ order, report: object(object(order.execution).reconciliation) }));
      if (reports.some(({ report }) => !Array.isArray(report.fills))) throw Error("Missing fills.");
      const entry = reports.find(({ order }) => order.id === session.active!.entryId)!;
      if (!["filled", "cancelled_with_fills", "session_settled"].includes(entry.order.state)) throw Error("Entry remains unconfirmed.");
      const exits = reports.filter(({ order }) => order.id !== session.active!.entryId);
      if (exits.some(({ order }) => !["filled", "cancelled", "rejected", "cancelled_with_fills", "session_settled", "exchange_open"].includes(order.state))) throw Error("Pending exit outcome.");
      if (exits.some(({ order, report }) => order.state === "exchange_open" && (typeof report.observedAt !== "string" || !Number.isFinite(Date.parse(report.observedAt)) || Date.now() - Date.parse(report.observedAt) > 120000 || Date.parse(report.observedAt) > Date.now() + 1000))) throw Error("Open-order evidence is stale.");
      if(session.plan.product === "linear_short") {
        const [quote, position, ledger] = await Promise.all([autonomousQuote(userId,session.active.symbol,"linear"),shortPosition(userId,session.active.symbol,shortSettingsFor(session.plan,session.active.symbol).positionIdx),shortLedger(userId,session.active.symbol,session.active.startedAtMs,[...entry.report.fills as ExecutionFill[],...exits.flatMap(({report})=>report.fills as ExecutionFill[])])]);
        const marked=shortMark(entry.report.fills as ExecutionFill[],exits.flatMap(({report})=>report.fills as ExecutionFill[]),quote.ask,quote.fee,ledger.fundingCents);
        if(position.quantity!==marked.quantity)throw Error("Perpetual position differs from owned fills.");
        held={orders:held.orders,unrealized:null,unavailable:null,shortValuation:{quantity:formatDecimal(marked.quantity),netCents:marked.netCents,fundingCents:ledger.fundingCents,ask:quote.ask,atMs:quote.atMs}};
      } else {
      const [quote, wallet] = await Promise.all([autonomousQuote(userId, session.active.symbol), autonomousWallet(userId)]);
      const estimate = estimateUnrealized(session.active.symbol, entry.report.fills as ExecutionFill[], exits.flatMap(({ report }) => report.fills as ExecutionFill[]), quote);
      const total = wallet.find(c => c.coin === session.active!.symbol.slice(0, -4))?.total;
      if (total !== decimal(estimate.quantity) + decimal(session.dust[session.active.symbol] ?? "0", true)) throw Error("Wallet differs.");
        held = { orders: held.orders, unrealized: estimate, unavailable: null };
      }
      const latest = await db.assistantMemory.findUnique({ where: { userId_key: { userId, key: activeKey } }, select: { value: true } });
      if (!latest || materialSession(validateSession(JSON.parse(latest.value))) !== materialSession(session) || connectionIdentity(await getBybitConfig(userId)) !== session.connection) throw Error("Session changed during valuation.");
    } catch { held = { orders: held.orders, unrealized: null, unavailable: session.plan.product === "linear_short" ? "Short valuation unavailable until owned fills, position and funding records agree." : "Unrealized result unavailable until entry, exits, wallet and a fresh mark agree." }; }
  }
  // A concurrent settlement must not pair new trade details with old totals.
  // Heartbeat-only revisions do not change any reported material values.
  const finalCurrent = await db.assistantMemory.findUnique({ where: { userId_key: { userId, key: activeKey } }, select: { value: true } });
  if (materialSession(finalCurrent ? validateSession(JSON.parse(finalCurrent.value)) : null) !== materialSession(active)) throw new AutonomousError("Session changed while the report loaded. Refresh for consistent totals and trade details.", 409);
  return { ...empty, decisions: decisions.slice(0, pageSize).map(row => ({ id: row.id, ...readEvidence(row.details) })), moreDecisions: decisions.length > pageSize, trades: settled, moreTrades: trades.length > pageSize, active: held, recordedAtMs: Date.now() };
}
