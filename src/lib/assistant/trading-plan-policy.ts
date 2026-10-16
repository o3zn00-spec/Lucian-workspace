import { AutonomousError, moneyCents, validateAutonomousPlan, type AutonomousPlan } from "@/lib/bybit/autonomous-policy";
import type { ProviderId } from "@/store/shared-ai-config";

export class TradingPlanError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export type TradingPlanSelection = { provider: ProviderId; model: string; effort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" };
export type TradingPlanDraft = { rules: Partial<AutonomousPlan>; selection: TradingPlanSelection | null };
export type TradingPlanTemplate = TradingPlanDraft & { id: string; name: string; rules: AutonomousPlan; savedAt: string };
export type TradingPlanSnapshot = {
  revision: string | null; savedAt: string | null; draft: TradingPlanDraft;
  templates: TradingPlanTemplate[]; missing: (keyof AutonomousPlan)[]; complete: boolean;
  status: "unapproved_draft"; sessionStarted: false;
};
export const TRADING_PLAN_FIELDS: { key: keyof AutonomousPlan; label: string }[] = [
  { key: "mode", label: "Live or Testnet" }, { key: "symbols", label: "USDT Spot symbols" },
  { key: "capital", label: "Session capital (USDT)" }, { key: "maxOrder", label: "Maximum order including costs (USDT)" },
  { key: "maxLoss", label: "Session loss limit (USDT)" }, { key: "maxRiskPerTrade", label: "Maximum risk per trade (USDT)" },
  { key: "maxTrades", label: "Maximum trades" }, { key: "reviewMinutes", label: "Review interval (minutes)" },
  { key: "durationHours", label: "Duration (hours)" }, { key: "maxModelCalls", label: "Model-call budget" },
  { key: "slippageBps", label: "Slippage allowance (basis points)" }, { key: "strategy", label: "Strategy and exit instructions" },
];
export const MAX_TRADING_TEMPLATES = 8;
export const tradingPlanTools = ["trading.plan.read", "trading.plan.update", "trading.template.save", "trading.template.load"] as const;
export type TradingPlanTool = typeof tradingPlanTools[number];
export const isTradingPlanTool = (tool: string): tool is TradingPlanTool => tradingPlanTools.some(t => t === tool);
const moneyFields = ["capital", "maxOrder", "maxLoss", "maxRiskPerTrade"] as const;
const counts = { maxTrades: [1, 10000], reviewMinutes: [1, 1440], durationHours: [1, 168], maxModelCalls: [1, 10000], slippageBps: [1, 500] } as const;
const fields = new Set<keyof AutonomousPlan>([...TRADING_PLAN_FIELDS.map(f => f.key), "webResearch"]);
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TradingPlanError("Use a valid planning object.");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) throw new TradingPlanError("Unexpected planning fields.");
}
export function validateSelection(raw: unknown): TradingPlanSelection | null {
  if (raw === null) return null;
  const s = object(raw); exact(s, ["provider", "model", "effort"]);
  if (!["gemini", "openai", "anthropic", "openrouter", "deepseek", "custom"].includes(s.provider as string) ||
      typeof s.model !== "string" || !s.model.trim() || s.model.length > 150 || /[\r\n\x00-\x1f]/.test(s.model) ||
      !["none", "minimal", "low", "medium", "high", "xhigh", "max"].includes(s.effort as string)) throw new TradingPlanError("Choose a valid provider, model and reasoning effort.");
  return { provider: s.provider as ProviderId, model: s.model.trim(), effort: s.effort as TradingPlanSelection["effort"] };
}
export function validateDraftRules(raw: unknown): Partial<AutonomousPlan> {
  const input = object(raw);
  if (Object.keys(input).some(k => !fields.has(k as keyof AutonomousPlan))) throw new TradingPlanError("Unknown session rule. Credentials and authorization do not belong in a draft.");
  const p = { ...input } as Partial<AutonomousPlan>;
  try {
    if (p.webResearch !== undefined && typeof p.webResearch !== "boolean") throw new TradingPlanError("Web research must be a boolean.");
    if (p.mode !== undefined && !["bybit_live", "bybit_testnet"].includes(p.mode)) throw new TradingPlanError("Choose Bybit Live or Testnet; paper practice has its own setup.");
    if (p.symbols !== undefined && (!Array.isArray(p.symbols) || !p.symbols.length || p.symbols.length > 10 || new Set(p.symbols).size !== p.symbols.length || p.symbols.some(s => typeof s !== "string" || !/^[A-Z0-9]{2,16}USDT$/.test(s)))) throw new TradingPlanError("Choose 1–10 unique USDT Spot symbols.");
    for (const key of moneyFields) if (p[key] !== undefined) moneyCents(p[key]);
    for (const key of Object.keys(counts) as (keyof typeof counts)[]) {
      const value = p[key], [min, max] = counts[key];
      if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) throw new TradingPlanError(`Invalid ${TRADING_PLAN_FIELDS.find(f => f.key === key)!.label.toLowerCase()}.`);
    }
    if (p.strategy !== undefined && (typeof p.strategy !== "string" || !p.strategy.trim() || p.strategy.length > 3000)) throw new TradingPlanError("Describe the strategy in 1–3,000 characters.");
    if (p.capital !== undefined && p.maxOrder !== undefined && moneyCents(p.maxOrder) > moneyCents(p.capital)) throw new TradingPlanError("Maximum order must fit session capital.");
    if (p.capital !== undefined && p.maxLoss !== undefined && moneyCents(p.maxLoss) > moneyCents(p.capital)) throw new TradingPlanError("Session loss limit must fit capital.");
    if (p.maxLoss !== undefined && p.maxRiskPerTrade !== undefined && moneyCents(p.maxRiskPerTrade) > moneyCents(p.maxLoss)) throw new TradingPlanError("Per-trade risk must fit the session loss limit.");
    if (TRADING_PLAN_FIELDS.every(f => p[f.key] !== undefined)) return validateAutonomousPlan(p);
  } catch (error) { if (error instanceof AutonomousError) throw new TradingPlanError(error.message); throw error; }
  return { ...p, ...(p.symbols ? { symbols: [...p.symbols] } : {}), ...(p.strategy ? { strategy: p.strategy.trim() } : {}) };
}
export function applyDraftChanges(previous: Partial<AutonomousPlan>, raw: unknown) {
  const changes = object(raw), merged: Record<string, unknown> = { ...previous };
  if (Object.keys(changes).some(k => !fields.has(k as keyof AutonomousPlan))) throw new TradingPlanError("Unknown session rule. Credentials and authorization do not belong in a draft.");
  for (const [key, value] of Object.entries(changes)) { if (value === null) delete merged[key]; else merged[key] = value; }
  return validateDraftRules(merged);
}
export type TradingPlanCommand =
  | { action: "update"; revision: string | null; changes: Record<string, unknown>; selection?: TradingPlanSelection | null }
  | { action: "save_template"; revision: string | null; name: string; templateId?: string; rules?: AutonomousPlan; selection?: TradingPlanSelection | null }
  | { action: "load_template" | "delete_template"; revision: string | null; templateId: string }
  | { action: "clear"; revision: string | null };
export function validatePlanCommand(raw: unknown): TradingPlanCommand {
  const b = object(raw);
  if (b.revision !== null && (typeof b.revision !== "string" || !/^[a-f0-9-]{36}$/.test(b.revision))) throw new TradingPlanError("Read the current draft revision before changing it.");
  if (b.action === "update") {
    exact(b, ["action", "revision", "changes"], ["selection"]);
    object(b.changes);
    if (!Object.keys(b.changes as object).length && !Object.hasOwn(b, "selection")) throw new TradingPlanError("Supply at least one rule or model change.");
    applyDraftChanges({}, b.changes);
    return { action: "update", revision: b.revision, changes: b.changes as Record<string, unknown>, ...(Object.hasOwn(b, "selection") ? { selection: validateSelection(b.selection) } : {}) };
  }
  if (b.action === "save_template") {
    exact(b, ["action", "revision", "name"], ["templateId", "rules", "selection"]);
    if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 80 || /[\x00-\x1f]/.test(b.name)) throw new TradingPlanError("Use a template name of 1–80 characters.");
    if (Object.hasOwn(b, "templateId") && (typeof b.templateId !== "string" || !/^[a-f0-9-]{36}$/.test(b.templateId))) throw new TradingPlanError("Choose an existing template ID.");
    if (Object.hasOwn(b, "selection") !== Object.hasOwn(b, "rules")) throw new TradingPlanError("A form template must include its rules and model selection together.");
    let rules: AutonomousPlan | undefined;
    if (Object.hasOwn(b, "rules")) { try { rules = validateAutonomousPlan(b.rules); } catch (e) { throw new TradingPlanError(e instanceof Error ? e.message : "Invalid template rules."); } }
    return { action: "save_template", revision: b.revision, name: b.name.trim(), ...(b.templateId ? { templateId: b.templateId as string } : {}), ...(rules ? { rules, selection: validateSelection(b.selection) } : {}) };
  }
  if (b.action === "load_template" || b.action === "delete_template") {
    exact(b, ["action", "revision", "templateId"]);
    if (typeof b.templateId !== "string" || !/^[a-f0-9-]{36}$/.test(b.templateId)) throw new TradingPlanError("Choose an existing template ID.");
    return { action: b.action, revision: b.revision, templateId: b.templateId };
  }
  if (b.action === "clear") { exact(b, ["action", "revision"]); return { action: "clear", revision: b.revision }; }
  throw new TradingPlanError("Unknown planning action. Drafts cannot authorize or start trading.");
}
export function chatPlanCommand(tool: TradingPlanTool, args: unknown): TradingPlanCommand | null {
  const b = object(args);
  if (tool === "trading.plan.read") { exact(b, []); return null; }
  if (tool === "trading.plan.update") exact(b, ["revision", "changes"], ["selection"]);
  if (tool === "trading.template.load") exact(b, ["revision", "templateId"]);
  // The chat may save the existing draft; it cannot bypass the draft review with
  // a separate form payload or provide authorization fields.
  if (tool === "trading.template.save") exact(b, ["revision", "name"], ["templateId"]);
  return validatePlanCommand({ ...b, action: tool === "trading.plan.update" ? "update" : tool === "trading.template.save" ? "save_template" : "load_template" });
}
