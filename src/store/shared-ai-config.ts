"use client";

/* LUCIAN — Shared AI Provider Configuration.
 *
 * Phase 7: ONE canonical provider/model configuration source shared
 * by both the Economic Agent and Lilith.
 *
 * Architecture:
 *   - Global default: provider + model used by all interfaces unless
 *     they have an explicit override.
 *   - Interface overrides: optional per-interface (economic-agent, lilith)
 *     provider + model that take precedence over the global default.
 *
 * API keys are NEVER stored here — they live in Vercel environment
 * variables and are only read server-side. This store only persists
 * non-secret configuration.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ProviderId =
  | "gemini"
  | "openai"
  | "anthropic"
  | "openrouter"
  | "deepseek"
  | "custom";

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** Environment variable name that holds the API key (server-side only). */
  envKey: string;
  /** Default model identifier if the user hasn't set one. */
  defaultModel: string;
  /** Placeholder text for the model input. */
  modelPlaceholder: string;
}

/** ONE canonical place that defines provider defaults. */
export const PROVIDERS: ProviderInfo[] = [
  { id: "gemini", name: "Google Gemini", envKey: "GEMINI_API_KEY", defaultModel: "gemini-2.0-flash", modelPlaceholder: "gemini-2.0-flash" },
  { id: "openai", name: "OpenAI", envKey: "OPENAI_API_KEY", defaultModel: "gpt-4o-mini", modelPlaceholder: "gpt-4o-mini" },
  { id: "anthropic", name: "Anthropic", envKey: "ANTHROPIC_API_KEY", defaultModel: "claude-3-5-sonnet-20241022", modelPlaceholder: "claude-3-5-sonnet-20241022" },
  { id: "openrouter", name: "OpenRouter", envKey: "OPENROUTER_API_KEY", defaultModel: "openai/gpt-4o-mini", modelPlaceholder: "openai/gpt-4o-mini" },
  { id: "deepseek", name: "DeepSeek", envKey: "DEEPSEEK_API_KEY", defaultModel: "deepseek-chat", modelPlaceholder: "deepseek-chat" },
  { id: "custom", name: "Custom (OpenAI-compatible)", envKey: "CUSTOM_AI_API_KEY", defaultModel: "", modelPlaceholder: "model-id" },
];

export function getProviderInfo(id: ProviderId): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

/** Which provider + model an interface should use. */
export interface ResolvedConfig {
  provider: ProviderId;
  model: string;
  /** True if using the global default, false if using an override. */
  usingGlobal: boolean;
}

/** Interface identifiers for per-interface overrides.
 *
 *  Phase 11: `"dev-workspace-agent"` is the Project Agent — the in-DevWorkspace
 *  coding assistant that uses controlled project tools. It defaults to the
 *  global provider/model unless the user explicitly overrides it. */
export type InterfaceId = "economic-agent" | "lilith" | "dev-workspace-agent";

interface OverrideConfig {
  provider: ProviderId;
  model: string;
}

interface SharedAIConfigState {
  /** Global default provider. */
  globalProvider: ProviderId;
  /** Global default model. */
  globalModel: string;
  /** Per-interface overrides. If an interface has an entry here, it uses
   *  the override instead of the global default. */
  overrides: Partial<Record<InterfaceId, OverrideConfig>>;

  // Actions
  setGlobalProvider: (p: ProviderId) => void;
  setGlobalModel: (m: string) => void;
  /** Set or clear an interface-specific override. Pass null to clear
   *  (fall back to global default). */
  setOverride: (iface: InterfaceId, config: OverrideConfig | null) => void;
  /** Resolve which provider + model an interface should use. */
  resolve: (iface: InterfaceId) => ResolvedConfig;
}

export const useSharedAIConfig = create<SharedAIConfigState>()(
  persist(
    (set, get) => ({
      globalProvider: "gemini",
      globalModel: "gemini-2.0-flash",
      overrides: {},

      setGlobalProvider: (p) => {
        const info = getProviderInfo(p);
        set((s) => ({
          globalProvider: p,
          // Auto-fill global model if empty or if it was the previous
          // provider's default.
          globalModel: s.globalModel || info.defaultModel,
        }));
      },
      setGlobalModel: (m) => set({ globalModel: m }),
      setOverride: (iface, config) =>
        set((s) => {
          if (config === null) {
            const next = { ...s.overrides };
            delete next[iface];
            return { overrides: next };
          }
          return { overrides: { ...s.overrides, [iface]: config } };
        }),
      resolve: (iface) => {
        const state = get();
        const override = state.overrides[iface];
        if (override) {
          return {
            provider: override.provider,
            model: override.model,
            usingGlobal: false,
          };
        }
        return {
          provider: state.globalProvider,
          model: state.globalModel,
          usingGlobal: true,
        };
      },
    }),
    {
      name: "lucian-shared-ai-config",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
        return localStorage;
      }),
    },
  ),
);

/* ── Migration: move old economic-agent-connection data to shared config ──
 *
 * If the user has an old `lucian-economic-agent-connection` localStorage
 * key (from Phase 6), migrate it to the shared config as the global
 * default. This runs once on module load.
 */
if (typeof window !== "undefined") {
  try {
    const oldRaw = localStorage.getItem("lucian-economic-agent-connection");
    if (oldRaw) {
      const old = JSON.parse(oldRaw);
      if (old?.state?.provider && old?.state?.model) {
        const sharedRaw = localStorage.getItem("lucian-shared-ai-config");
        if (!sharedRaw) {
          // Only migrate if the shared config doesn't exist yet.
          const shared = {
            state: {
              globalProvider: old.state.provider,
              globalModel: old.state.model,
              overrides: {},
            },
            version: 0,
          };
          localStorage.setItem("lucian-shared-ai-config", JSON.stringify(shared));
        }
      }
      // Don't remove the old key yet — the EconomicAgentConnection
      // component still reads from it for the settings UI. The old store
      // is kept as a thin compatibility layer.
    }
  } catch {
    // ignore migration errors
  }
}
