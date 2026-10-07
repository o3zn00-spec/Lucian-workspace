"use client";

/* LUCIAN — Shared AI Behavior Helpers.
 *
 * Reads the AI behavior slice of useSettingsStore and exposes:
 *   - responseStyleInstruction()  → small instruction snippet for the
 *     system prompt (concise / balanced / detailed).
 *   - contextLevelBudget()        → numeric budget (max items / chars)
 *     for how much eligible context the pipeline may attach.
 *   - shouldRememberConversations() → whether to include historical
 *     conversation-memory context beyond the current turn.
 *   - isProjectAgentContextAllowed() → whether the Project Agent may
 *     automatically pull project files as context.
 *
 * These helpers are consulted by the actual AI request/context pipeline
 * (the /api/ai/chat route, the shared agent provider, and the Lilith
 * route). The route reads them from the request body (sent by the
 * client); the client reads them from the settings store.
 *
 * IMPORTANT:
 *   - These are SMALL, deterministic mappings — not giant hardcoded
 *     prompts.
 *   - They never exceed model/context limits.
 *   - They are pure functions of the settings state.
 */

import { useSettingsStore, type ContextLevel, type ResponseStyle } from "@/store/settings";

/* ─── Response style → instruction snippet ─── */

const RESPONSE_STYLE_INSTRUCTIONS: Record<ResponseStyle, string> = {
  concise:
    "Be concise. Prefer short, direct answers. Omit pleasantries. Use 1-3 sentences unless the user asks for more detail.",
  balanced:
    "Be balanced. Provide enough detail to be useful without being verbose. Use 2-5 sentences for typical answers; expand when the user asks for detail.",
  detailed:
    "Be detailed. Provide thorough, well-structured answers. Include context, rationale, and examples where helpful. The user has explicitly chosen a detailed style.",
};

/** Returns the small instruction snippet for the current response style. */
export function responseStyleInstruction(): string {
  if (typeof window === "undefined") return RESPONSE_STYLE_INSTRUCTIONS.balanced;
  const style = useSettingsStore.getState().aiBehavior.responseStyle;
  return RESPONSE_STYLE_INSTRUCTIONS[style] ?? RESPONSE_STYLE_INSTRUCTIONS.balanced;
}

/* ─── Context level → budget ─── */

export interface ContextBudget {
  /** Maximum number of context items (attachments) that may be sent. */
  maxItems: number;
  /** Maximum total characters across all context items combined. */
  maxChars: number;
  /** Human-readable label for diagnostics. */
  label: string;
}

const CONTEXT_LEVEL_BUDGETS: Record<ContextLevel, ContextBudget> = {
  light:    { maxItems: 1,  maxChars: 1500,  label: "light" },
  standard: { maxItems: 3,  maxChars: 6000,  label: "standard" },
  extended: { maxItems: 6,  maxChars: 18000, label: "extended" },
};

/** Returns the context budget for the current context level. */
export function contextLevelBudget(): ContextBudget {
  if (typeof window === "undefined") return CONTEXT_LEVEL_BUDGETS.standard;
  const level = useSettingsStore.getState().aiBehavior.contextLevel;
  return CONTEXT_LEVEL_BUDGETS[level] ?? CONTEXT_LEVEL_BUDGETS.standard;
}

/**
 * Apply the context budget to a list of candidate context items.
 * Returns the items to actually attach, capped at maxItems and trimmed
 * so the total character count stays under maxChars. Items are kept in
 * their original order (callers should already have ranked them).
 */
export function applyContextBudget<T extends { data?: string; label?: string }>(
  items: T[],
  budget: ContextBudget = contextLevelBudget(),
): T[] {
  const kept: T[] = [];
  let totalChars = 0;
  for (const item of items) {
    if (kept.length >= budget.maxItems) break;
    const len = (item.data?.length ?? 0) + (item.label?.length ?? 0);
    if (totalChars + len > budget.maxChars) continue;
    kept.push(item);
    totalChars += len;
  }
  return kept;
}

/* ─── Remember conversations ─── */

/** Whether to include historical conversation-memory beyond the current turn. */
export function shouldRememberConversations(): boolean {
  if (typeof window === "undefined") return true;
  return useSettingsStore.getState().aiBehavior.rememberConversations;
}

/* ─── Project Agent project context ─── */

/** Whether the Project Agent may automatically receive project files as context. */
export function isProjectAgentContextAllowed(): boolean {
  if (typeof window === "undefined") return true;
  return useSettingsStore.getState().aiBehavior.allowProjectContext;
}

/* ─── Wire format (for sending to /api/ai/chat) ─── */

export interface AIBehaviorWire {
  responseStyle: ResponseStyle;
  contextLevel: ContextLevel;
  rememberConversations: boolean;
  allowProjectContext: boolean;
}

/** Read the current AI behavior slice for sending to the server. */
export function readAIBehaviorWire(): AIBehaviorWire {
  if (typeof window === "undefined") {
    return {
      responseStyle: "balanced",
      contextLevel: "standard",
      rememberConversations: true,
      allowProjectContext: true,
    };
  }
  const s = useSettingsStore.getState().aiBehavior;
  return {
    responseStyle: s.responseStyle,
    contextLevel: s.contextLevel,
    rememberConversations: s.rememberConversations,
    allowProjectContext: s.allowProjectContext,
  };
}
