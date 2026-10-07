/* LUCIAN — Shared AI Behavior wire types.
 *
 * These types are shared between the client (useSettingsStore) and the
 * server (/api/ai/chat route). They contain NO client-only logic so
 * they can be imported from server modules without dragging in Zustand.
 *
 * IMPORTANT: keep these in sync with the corresponding types in
 * src/store/settings.ts. The string literals must match exactly so the
 * client and server agree on the vocabulary.
 */

export type ResponseStyle = "concise" | "balanced" | "detailed";
export type ContextLevel = "light" | "standard" | "extended";

export interface AIBehaviorWire {
  responseStyle: ResponseStyle;
  contextLevel: ContextLevel;
  rememberConversations: boolean;
  allowProjectContext: boolean;
}

/** Default behavior when the client doesn't send one (e.g. legacy callers). */
export const DEFAULT_AI_BEHAVIOR: AIBehaviorWire = {
  responseStyle: "balanced",
  contextLevel: "standard",
  rememberConversations: true,
  allowProjectContext: true,
};

/* ── Small instruction snippets (NOT giant hardcoded prompts) ── */

export const RESPONSE_STYLE_SNIPPETS: Record<ResponseStyle, string> = {
  concise:  "Be concise. Prefer short, direct answers. Omit pleasantries. Use 1-3 sentences unless asked for detail.",
  balanced: "Be balanced. Provide enough detail to be useful without being verbose. Use 2-5 sentences for typical answers.",
  detailed: "Be detailed. Provide thorough, well-structured answers with context, rationale, and examples where helpful.",
};

export const CONTEXT_BUDGETS: Record<ContextLevel, { maxItems: number; maxChars: number }> = {
  light:    { maxItems: 1, maxChars: 1500 },
  standard: { maxItems: 3, maxChars: 6000 },
  extended: { maxItems: 6, maxChars: 18000 },
};
