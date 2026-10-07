"use client";

/* LUCIAN Economic Agent — Connection configuration.
 *
 * Phase 7: this store is now a thin compatibility wrapper that delegates
 * to the shared AI config store (`@/store/shared-ai-config`). The old
 * `provider` + `model` fields now read/write the shared global default.
 *
 * API keys are NEVER stored here — they live in Vercel environment
 * variables and are only read server-side.
 */

import { create } from "zustand";
import {
  useSharedAIConfig,
  PROVIDERS,
  getProviderInfo,
  type ProviderId,
  type ProviderInfo,
} from "@/store/shared-ai-config";

// Re-export types for backward compat.
export type { ProviderId, ProviderInfo };
export { PROVIDERS, getProviderInfo };

/** Result of a connection test — returned by the server. */
export interface ConnectionTestResult {
  success: boolean;
  message: string;
  reason?: string;
  provider?: ProviderId;
  model?: string;
  keyPresent?: boolean;
  testedAt?: string;
}

interface EconomicAgentConnectionState {
  /** Phase 7: reads from shared global default. */
  provider: ProviderId;
  model: string;
  lastTest: ConnectionTestResult | null;
  testing: boolean;

  setProvider: (p: ProviderId) => void;
  setModel: (m: string) => void;
  setLastTest: (r: ConnectionTestResult | null) => void;
  setTesting: (v: boolean) => void;
}

export const useEconomicAgentConnection = create<EconomicAgentConnectionState>()((set) => {
  // Initialize from the shared config.
  const initial = useSharedAIConfig.getState();
  const resolved = initial.resolve("economic-agent");

  return {
    provider: resolved.provider,
    model: resolved.model,
    lastTest: null,
    testing: false,

    setProvider: (p) => {
      // Write to shared global config (Economic Agent uses global default
      // unless an override is set — which Phase 7 doesn't expose in the
      // EA UI, keeping it simple).
      useSharedAIConfig.getState().setGlobalProvider(p);
      // Update local state for immediate UI reactivity.
      set({ provider: p, model: getProviderInfo(p).defaultModel });
    },
    setModel: (m) => {
      useSharedAIConfig.getState().setGlobalModel(m);
      set({ model: m });
    },
    setLastTest: (r) => set({ lastTest: r }),
    setTesting: (v) => set({ testing: v }),
  };
});

// Keep the original compatibility store current when global settings change.
useSharedAIConfig.subscribe((state) => {
  const resolved=state.resolve("economic-agent");
  useEconomicAgentConnection.setState({provider:resolved.provider,model:resolved.model});
});
