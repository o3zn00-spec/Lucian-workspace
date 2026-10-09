export type LiveReviewPlan = { symbols: string[]; strategy: string; reviewMinutes: number; durationHours: number; maxReviews: number };
export type LiveReview = { atMs: number; stance: "hold" | "owner_review"; rationale: string; sources: string[]; reservations: number; completed: number };
export type LiveReviewSession = {
  id: string; revision: string; generation: string; plan: LiveReviewPlan;
  provider: "gemini" | "openai" | "anthropic" | "openrouter" | "deepseek";
  model: string; effort: "low" | "medium" | "high";
  status: "running" | "paused" | "stopped"; startedAtMs: number; deadlineMs: number;
  nextReviewAtMs: number; heartbeatMs: number; reviewsUsed: number;
  reviews: LiveReview[]; error: string | null; runId: string | null;
  lease: { token: string; untilMs: number } | null;
};
export class LiveReviewError extends Error { constructor(message: string, public status = 400) { super(message); } }
const fail = (): never => { throw new LiveReviewError("Invalid live research rules or state. No order was placed."); };
export function validateLiveReviewPlan(raw: unknown): LiveReviewPlan {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail();
  const p = raw as LiveReviewPlan;
  if (Object.keys(p).sort().join(",") !== "durationHours,maxReviews,reviewMinutes,strategy,symbols" || !Array.isArray(p.symbols) || !p.symbols.length || p.symbols.length > 2 || new Set(p.symbols).size !== p.symbols.length || p.symbols.some(s => typeof s !== "string" || !/^[A-Z0-9]{2,16}USDT$/.test(s))) return fail();
  if (typeof p.strategy !== "string" || !p.strategy.trim() || p.strategy.length > 500) return fail();
  for (const [value, min, max] of [[p.reviewMinutes, 5, 1440], [p.durationHours, 1, 24], [p.maxReviews, 1, 30]]) if (!Number.isInteger(value) || value < min || value > max) return fail();
  return { ...p, strategy: p.strategy.trim() };
}
export function parseLiveReview(raw: string): Pick<LiveReview, "stance" | "rationale"> {
  if (raw.length > 2000) return fail();
  const p = JSON.parse(raw);
  if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).sort().join(",") !== "rationale,stance" || !["hold", "owner_review"].includes(p.stance) || typeof p.rationale !== "string" || !p.rationale.trim() || p.rationale.length > 1000) return fail();
  return { stance: p.stance, rationale: p.rationale.trim() };
}
export function validateLiveReviewSession(s: LiveReviewSession): LiveReviewSession {
  validateLiveReviewPlan(s.plan);
  if (![s.id, s.revision, s.generation, s.model].every(v => typeof v === "string" && v.length > 0 && v.length <= 150) || !["running", "paused", "stopped"].includes(s.status) || !["gemini", "openai", "anthropic", "openrouter", "deepseek"].includes(s.provider) || !["low", "medium", "high"].includes(s.effort)) return fail();
  for (const value of [s.startedAtMs, s.deadlineMs, s.nextReviewAtMs, s.heartbeatMs, s.reviewsUsed]) if (!Number.isSafeInteger(value) || value < 0) return fail();
  if (s.deadlineMs !== s.startedAtMs + s.plan.durationHours * 3600000 || s.reviewsUsed > s.plan.maxReviews || !Array.isArray(s.reviews) || s.reviews.length > 30 || !(s.error === null || typeof s.error === "string" && s.error.length <= 1000) || !(s.runId === null || typeof s.runId === "string" && s.runId.length <= 200)) return fail();
  if (s.lease && (typeof s.lease.token !== "string" || !s.lease.token || !Number.isSafeInteger(s.lease.untilMs) || s.lease.untilMs < 0)) return fail();
  for (const r of s.reviews) {
    parseLiveReview(JSON.stringify({ stance: r.stance, rationale: r.rationale }));
    if (!Number.isSafeInteger(r.atMs) || r.atMs < s.startedAtMs || r.atMs > s.deadlineMs || !Array.isArray(r.sources) || r.sources.length > 15 || r.sources.some(url => typeof url !== "string" || !url.startsWith("https://") || url.length > 500) || !Number.isInteger(r.reservations) || r.reservations < 0 || !Number.isInteger(r.completed) || r.completed < 0) return fail();
  }
  return s;
}
