"use client";

/* LUCIAN — Lilith floating AI assistant state.
 *
 * Lilith is a persistent global assistant layer that floats above all
 * routed pages. Her configuration (name, color, position, size, voice
 * prefs) is persisted to localStorage so she survives refreshes and
 * route changes.
 *
 * State model:
 *   status: "idle" | "listening" | "thinking" | "speaking" | "attention"
 *   position: { x, y } — pixel coords within the viewport
 *   size: "small" | "medium" | "large"
 *   color: one of 10 preset IDs
 *   visible: boolean — show/hide the orb entirely
 *   panelOpen: boolean — chat panel expanded
 *   dragging: boolean — active drag in progress
 *
 * The store is deliberately provider-independent for AI responses.
 * When no model is configured, the chat panel honestly says so.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { syncChatMessage } from "@/lib/assistant/restored-sync";

export type LilithStatus =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "attention";

export type LilithSize = "small" | "medium" | "large";
export type LilithColorId =
  | "cyber-cyan"
  | "deep-teal"
  | "emerald"
  | "electric-blue"
  | "royal-violet"
  | "magenta"
  | "crimson"
  | "solar-orange"
  | "lucian-gold"
  | "ice-white";

export interface LilithColorPreset {
  id: LilithColorId;
  name: string;
  /** Primary color — drives rings, particles, sphere glow. */
  primary: string;
  /** Glow color — usually a softer/lighter variant of primary. */
  glow: string;
  /** Pulse color — used by the speaking state. */
  pulse: string;
}

export const LILITH_COLORS: LilithColorPreset[] = [
  { id: "cyber-cyan", name: "Cyber Cyan", primary: "#22D3EE", glow: "#22D3EE", pulse: "#67E8F9" },
  { id: "deep-teal", name: "Deep Teal", primary: "#14B8A6", glow: "#14B8A6", pulse: "#5EEAD4" },
  { id: "emerald", name: "Emerald", primary: "#22C55E", glow: "#22C55E", pulse: "#86EFAC" },
  { id: "electric-blue", name: "Electric Blue", primary: "#3B82F6", glow: "#3B82F6", pulse: "#93C5FD" },
  { id: "royal-violet", name: "Royal Violet", primary: "#8B5CF6", glow: "#8B5CF6", pulse: "#C4B5FD" },
  { id: "magenta", name: "Magenta", primary: "#D946EF", glow: "#D946EF", pulse: "#F0ABFC" },
  { id: "crimson", name: "Crimson", primary: "#EF4444", glow: "#EF4444", pulse: "#FCA5A5" },
  { id: "solar-orange", name: "Solar Orange", primary: "#F97316", glow: "#F97316", pulse: "#FDBA74" },
  { id: "lucian-gold", name: "Lucian Gold", primary: "#EAB308", glow: "#EAB308", pulse: "#FDE047" },
  { id: "ice-white", name: "Ice White", primary: "#E8F4FF", glow: "#E8F4FF", pulse: "#FFFFFF" },
];

export function getColorPreset(id: LilithColorId): LilithColorPreset {
  return LILITH_COLORS.find((c) => c.id === id) ?? LILITH_COLORS[0];
}

export interface LilithMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  fromModel: boolean;
  status?: "complete" | "streaming" | "error";
}

export interface LilithSettings {
  name: string;
  color: LilithColorId;
  size: LilithSize;
  visible: boolean;
  showOnStartup: boolean;
  allowDragging: boolean;
  rememberPosition: boolean;
  lockPosition: boolean;
  animationIntensity: "low" | "normal" | "high";
  reducedMotion: boolean;
  glowIntensity: "low" | "normal" | "high";
  voiceEnabled: boolean;
  autoSpeak: boolean;
  pushToTalk: boolean;
  speechSpeed: number;
  volume: number;
  responseStyle: "balanced" | "concise" | "detailed";
}

const DEFAULT_SETTINGS: LilithSettings = {
  name: "Lilthe",
  color: "cyber-cyan",
  size: "medium",
  visible: true,
  showOnStartup: true,
  allowDragging: true,
  rememberPosition: true,
  lockPosition: false,
  animationIntensity: "normal",
  reducedMotion: false,
  glowIntensity: "normal",
  voiceEnabled: false,
  autoSpeak: false,
  pushToTalk: false,
  speechSpeed: 1,
  volume: 0.8,
  responseStyle: "balanced",
};

/** Default position: bottom-right, ~24px from edges. */
const DEFAULT_POSITION = { x: -1, y: -1 }; // -1 = "use default bottom-right"

function getLilithConversationId(): string {
  return (typeof localStorage !== "undefined" &&
    (localStorage.getItem("lucian-lilith-conv-id") || (() => {
      const id = `lilith_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
      try { localStorage.setItem("lucian-lilith-conv-id", id); } catch { /* non-fatal */ }
      return id;
    })())) || `lilith_local_${Date.now()}`;
}

interface LilithState {
  // Runtime state (NOT persisted — resets on reload)
  status: LilithStatus;
  panelOpen: boolean;
  dragging: boolean;
  busy: boolean;
  error: LilithError | null;

  // Persisted state
  position: { x: number; y: number };
  settings: LilithSettings;
  messages: LilithMessage[];
  inputText: string;

  // Actions
  setStatus: (s: LilithStatus) => void;
  setPanelOpen: (v: boolean) => void;
  setDragging: (v: boolean) => void;
  setPosition: (x: number, y: number) => void;
  resetPosition: () => void;
  updateSettings: (patch: Partial<LilithSettings>) => void;
  resetSettings: () => void;
  setInputText: (t: string) => void;
  addMessage: (m: Omit<LilithMessage, "id" | "timestamp">) => string;
  updateMessage: (messageId: string, patch: Partial<LilithMessage>) => void;
  removeMessage: (messageId: string) => void;
  clearMessages: () => void;
  setBusy: (v: boolean) => void;
  setError: (e: LilithError | null) => void;
}

/** Phase 7: Lilith error state — transient, NOT persisted. */
export interface LilithError {
  type: "attachment-failed" | "provider-not-configured" | "authentication-failed" | "rate-limit" | "timeout" | "invalid-model" | "network-error" | "provider-error" | "unknown";
  message: string;
}

export const useLilithStore = create<LilithState>()(
  persist(
    (set, get) => ({
      status: "idle",
      panelOpen: false,
      dragging: false,
      busy: false,
      error: null,
      position: DEFAULT_POSITION,
      settings: DEFAULT_SETTINGS,
      messages: [],
      inputText: "",

      setStatus: (s) => set({ status: s }),
      setPanelOpen: (v) => set({ panelOpen: v }),
      setDragging: (v) => set({ dragging: v }),
      setPosition: (x, y) => set({ position: { x, y } }),
      resetPosition: () => set({ position: DEFAULT_POSITION }),
      updateSettings: (patch) =>
        set((s) => ({ settings: { ...s.settings, ...patch } })),
      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),
      setInputText: (t) => set({ inputText: t }),
      addMessage: (m) => {
        const newMessage = {
          ...m,
          id: `lilith_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          timestamp: Date.now(),
        };
        set((s) => ({
          messages: [...s.messages, newMessage],
        }));
        // PHASE 16: live server-sync. Best-effort, non-blocking — the
        // local mutation already succeeded; the server write happens
        // in the background. Conversation id is stable per Lilith
        // session (derived from a per-browser id so reloads continue
        // the same conversation). If the server is unreachable, the
        // local message is preserved; the retry loop will pick it up.
        const convId = getLilithConversationId();
        if (m.status !== "streaming") void syncChatMessage({
          conversationId: convId,
          // Pass the local newMessage.id as the stable messageId —
          // retries of the SAME local message dedupe on the server.
          messageId: newMessage.id,
          source: "lilith",
          title: "Lilith Assistant",
          role: m.role,
          content: m.content,
          // `fromModel` on the Lilith store is a boolean flag (was the
          // message generated by the configured model?). The server's
          // ChatMessage.model field is a string. We omit it for Lilith
          // messages — the conversation-level model field can be set by
          // the migration prompt if/when a model is configured.
          model: undefined,
          provider: undefined,
        }).catch(() => { /* non-fatal — local already succeeded */ });
        return newMessage.id;
      },
      updateMessage: (messageId, patch) => {
        set((s) => ({
          messages: s.messages.map((message) => message.id === messageId ? { ...message, ...patch } : message),
        }));
        const message = get().messages.find((item) => item.id === messageId);
        if (message && patch.status === "complete") {
          void syncChatMessage({
            conversationId: getLilithConversationId(),
            messageId,
            source: "lilith",
            title: "Lilith Assistant",
            role: message.role,
            content: message.content,
            model: undefined,
            provider: undefined,
          }).catch(() => { /* local message remains authoritative */ });
        }
      },
      removeMessage: (messageId) => set((s) => ({
        messages: s.messages.filter((message) => message.id !== messageId),
      })),
      clearMessages: () => set({ messages: [], error: null, busy: false }),
      setBusy: (v) => set({ busy: v }),
      setError: (e) => set({ error: e }),
    }),
    {
      name: "lucian-lilith-restored",
      // Phase 7: persist messages + inputText + position + settings.
      // Explicitly EXCLUDE busy, error, status, panelOpen, dragging
      // (transient runtime state that must NOT survive reload).
      partialize: (s) => ({
        position: s.position,
        settings: s.settings,
        messages: s.messages,
        inputText: s.inputText,
      }),
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

/** Returns the pixel size for a given size preset. */
export function getSizePx(size: LilithSize): number {
  switch (size) {
    case "small":
      return 56;
    case "medium":
      return 78;
    case "large":
      return 104;
    default:
      return 78;
  }
}

/** Returns whether animations should be calmed (reduced motion or low intensity). */
export function shouldReduceMotion(settings: LilithSettings): boolean {
  return settings.reducedMotion || settings.animationIntensity === "low";
}
