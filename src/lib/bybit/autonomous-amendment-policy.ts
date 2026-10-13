import { AutonomousError, moneyCents, validateAutonomousPlan, type AutonomousPlan } from "./autonomous-policy";

export const amendmentFields = [
  ["maxOrder", "Maximum order including costs (USDT)"],
  ["maxLoss", "Total session loss limit (USDT)"],
  ["maxRiskPerTrade", "Maximum risk for new trades (USDT)"],
  ["maxTrades", "Total completed-trade limit"],
  ["maxModelCalls", "Total model-call limit"],
  ["reviewMinutes", "Research interval (minutes)"],
  ["strategy", "Trading instructions"],
] as const;
export type AmendmentField = typeof amendmentFields[number][0];
export type AmendmentChange = { field: AmendmentField; label: string; before: string | number; after: string | number };
type AmendmentState = { plan: AutonomousPlan; status: string; deadlineMs: number; trades: number; modelCalls: number; realizedCents: number; active: { closing: boolean } | null };

export function validateAmendedPlan(session: AmendmentState, raw: unknown, now = Date.now()) {
  if (session.status !== "paused" || session.active?.closing || now >= session.deadlineMs) throw new AutonomousError("Pause new entries before changing rules. A closing or expired session cannot be amended.", 409);
  const plan = validateAutonomousPlan(raw);
  for (const field of ["mode", "symbols", "capital", "durationHours", "slippageBps"] as const) {
    if (JSON.stringify(plan[field]) !== JSON.stringify(session.plan[field])) throw new AutonomousError("Exchange, assets, capital, original duration and slippage stay fixed for this session.");
  }
  if (plan.maxTrades < session.trades + (session.active ? 1 : 0)) throw new AutonomousError("The total trade limit must include completed trades and the current owned trade.");
  if (plan.maxModelCalls < session.modelCalls) throw new AutonomousError("The total model-call limit cannot be below calls already consumed.");
  if (moneyCents(plan.maxLoss) < Math.max(0, -session.realizedCents)) throw new AutonomousError("The total loss limit cannot be below losses already realized.");
  const changes: AmendmentChange[] = amendmentFields.filter(([field]) => plan[field] !== session.plan[field]).map(([field, label]) => ({ field, label, before: session.plan[field], after: plan[field] }));
  if (!changes.length) throw new AutonomousError("Change at least one rule before requesting amendment review.");
  return { plan, changes };
}

export type AutonomousAmendmentReview = {
  id: string; sessionId: string; revision: string; materialVersion: string; expiresAtMs: number; confirmation: string;
  plan: AutonomousPlan; changes: AmendmentChange[]; deadlineMs: number;
  usage: { trades: number; modelCalls: number; realizedCents: number; cashCents: number };
  accountLimits: { maxOrder: string; maxExposure: string; maxDailyLoss: string; maxPositions: number };
};
