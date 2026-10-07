"use client";

/* LUCIAN universal Lilith conversation state.
 *
 * This is the canonical conversation engine used by Lilith everywhere.
 * The historical filename and localStorage key are retained so existing
 * owner conversations migrate without data loss.
 *
 * State model:
 *   - conversations: Conversation[] (with messages, pinned, archived)
 *   - activeId: currently open conversation
 *   - searchQuery: filters the sidebar list
 *   - contextItems: attached context for the next message
 *   - modelSelection: "auto" | manual model id
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { syncChatMessage } from "@/lib/assistant/restored-sync";

export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  fromModel: boolean;
  attachments?: { id: string; name: string; url?: string }[];
  toolName?: string;
  status?: "complete" | "streaming" | "error";
  capability?: LilithCapability;
  toolCall?: { name: string; args: Record<string, unknown> };
}

export type LilithCapability =
  | "general"
  | "economic"
  | "trading"
  | "coding"
  | "notes"
  | "chess"
  | "vault"
  | "markets"
  | "news"
  | "research"
  | "investing"
  | "learning";

/** Phase 6: real context data — not just labels. Each context item carries
 *  the actual serialized data the model needs, not just a description. */
export interface ContextItem {
  id: string;
  /** Source type — drives the icon + label. */
  type: "project" | "file" | "research" | "note" | "market" | "investment" | "vault" | "business" | "economy" | "news" | "learning";
  /** Display label, e.g. "BTCUSD", "README.md". */
  label: string;
  /** Optional secondary descriptor for UI display. */
  description?: string;
  /** Phase 6: the actual serialized context data sent to the model.
   *  This is built by the context-provider layer and contains real
   *  market data, investment holdings, economy hub data, etc. */
  data?: string;
}

export interface Conversation {
  serverVersion?: string;
  id: string;
  title: string;
  messages: AgentMessage[];
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  archived: boolean;
  /** Bounded rolling summary of older turns used when a chat becomes long. */
  summary?: string;
  summarizedMessageCount?: number;
  capabilities?: LilithCapability[];
}

/** Phase 6: error state for failed provider requests. Transient — NOT persisted. */
export interface AgentError {
  type: "provider-not-configured" | "authentication-failed" | "rate-limit" | "provider-unavailable" | "timeout" | "invalid-model" | "invalid-response" | "network-error" | "unknown";
  message: string;
  /** ID of the user message that triggered the failed request. Used for retry. */
  triggerMessageId?: string;
}

interface EconomicAgentState {
  conversations: Conversation[];
  activeId: string | null;
  searchQuery: string;
  draftText: string;
  contextItems: ContextItem[];
  /** Phase 6: removed — model selection is now solely via the connection
   *  store (useEconomicAgentConnection). The old modelSelection field
   *  was decorative and never affected the API request. */
  busy: boolean;
  /** Phase 6: transient error state for failed provider requests.
   *  NOT persisted — cleared on conversation switch, new message, or retry. */
  error: AgentError | null;

  // Actions
  newConversation: (capability?: LilithCapability) => string;
  ensureActiveConversation: (capability?: LilithCapability) => string;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  togglePin: (id: string) => void;
  toggleArchive: (id: string) => void;
  addMessage: (convId: string, message: Omit<AgentMessage, "id" | "timestamp">) => string;
  updateMessage: (convId: string, messageId: string, patch: Partial<AgentMessage>) => void;
  removeMessage: (convId: string, messageId: string) => void;
  replaceMessages: (convId: string, messages: AgentMessage[], capability?: LilithCapability) => void;
  importLegacyConversation: (messages: AgentMessage[]) => string | null;
  setDraftText: (t: string) => void;
  setSearchQuery: (q: string) => void;
  setBusy: (v: boolean) => void;
  setError: (e: AgentError | null) => void;
  addContextItem: (item: Omit<ContextItem, "id">) => void;
  removeContextItem: (id: string) => void;
  clearContext: () => void;
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function now(): number {
  return Date.now();
}

function syncConversationRename(_id: string, _title: string): void {}
function syncConversationDelete(_id: string): void {}

const SUMMARY_TRIGGER_MESSAGES = 36;
const SUMMARY_RECENT_MESSAGES = 20;
const SUMMARY_MAX_CHARS = 4_000;

function withRollingSummary(conversation: Conversation, messages: AgentMessage[]): Conversation {
  if (messages.length <= SUMMARY_TRIGGER_MESSAGES) return { ...conversation, messages };
  const summarizedCount = messages.length - SUMMARY_RECENT_MESSAGES;
  if (summarizedCount <= (conversation.summarizedMessageCount ?? 0)) return { ...conversation, messages };
  const previousCount = conversation.summarizedMessageCount ?? 0;
  const additions = messages.slice(previousCount, summarizedCount).map((message) => {
    const capability = message.capability ? `/${message.capability}` : "";
    const content = message.content.replace(/\s+/g, " ").trim().slice(0, 240);
    return `${message.role}${capability}: ${content}`;
  });
  const summary = [conversation.summary, ...additions]
    .filter(Boolean)
    .join("\n")
    .slice(-SUMMARY_MAX_CHARS);
  return { ...conversation, messages, summary, summarizedMessageCount: summarizedCount };
}

function addCapability(conversation: Conversation, capability?: LilithCapability): LilithCapability[] | undefined {
  if (!capability) return conversation.capabilities;
  return Array.from(new Set([...(conversation.capabilities ?? []), capability]));
}

/** Build a bounded model window while preserving a summary of older turns. */
export function conversationWindow(conversation: Conversation | undefined, maxRecent = 24): {
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  summaryContext?: string;
} {
  if (!conversation) return { messages: [] };
  return {
    messages: conversation.messages
      .filter((message) => message.role !== "tool" && message.status !== "streaming")
      .slice(-maxRecent)
      .map((message) => ({ role: message.role as "user" | "assistant", content: message.content })),
    summaryContext: conversation.summary,
  };
}

export const useEconomicAgentStore = create<EconomicAgentState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId: null,
      searchQuery: "",
      draftText: "",
      contextItems: [],
      busy: false,
      error: null,

      newConversation: (capability = "general") => {
        const id = genId("conv");
        const conv: Conversation = {
          id,
          title: "New conversation",
          messages: [],
          createdAt: now(),
          updatedAt: now(),
          pinned: false,
          archived: false,
          capabilities: [capability],
        };
        set((s) => ({
          conversations: [conv, ...s.conversations],
          activeId: id,
          contextItems: [],
          error: null,
          busy: false,
        }));
        return id;
      },

      ensureActiveConversation: (capability = "general") => {
        const state = get();
        const active = state.conversations.find((conversation) => conversation.id === state.activeId && !conversation.archived);
        if (active) {
          if (!(active.capabilities ?? []).includes(capability)) {
            set((current) => ({ conversations: current.conversations.map((conversation) => conversation.id === active.id ? { ...conversation, capabilities: addCapability(conversation, capability) } : conversation) }));
          }
          return active.id;
        }
        return get().newConversation(capability);
      },

      selectConversation: (id) => set({ activeId: id, contextItems: [], error: null, busy: false }),

      deleteConversation: (id) => {
        set((s) => {
          const next = s.conversations.filter((c) => c.id !== id);
          return {
            conversations: next,
            activeId: s.activeId === id ? next[0]?.id ?? null : s.activeId,
            error: null,
            busy: false,
          };
        });
        syncConversationDelete(id);
      },

      renameConversation: (id, title) => {
        const cleanTitle = title.trim() || "Untitled";
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, title: cleanTitle } : c,
          ),
        }));
        syncConversationRename(id, cleanTitle);
      },

      togglePin: (id) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, pinned: !c.pinned } : c,
          ),
        })),

      toggleArchive: (id) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, archived: !c.archived } : c,
          ),
        })),

      addMessage: (convId, message) => {
        const localId = genId("msg");
        const newMessage = { ...message, id: localId, timestamp: now() };
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId
              ? {
                  ...c,
                  ...withRollingSummary(c, [...c.messages, newMessage]),
                  updatedAt: now(),
                  capabilities: addCapability(c, message.capability),
                  // Auto-title from first user message.
                  title:
                    c.messages.length === 0 && message.role === "user"
                      ? message.content.slice(0, 40)
                      : c.title,
                }
              : c,
          ),
        }));
        // PHASE 16: live server-sync. Best-effort, non-blocking — the
        // local mutation already succeeded; the server write happens
        // in the background. Conversation id IS the local convId so
        // reloads continue the same server-side conversation.
        const conv = get().conversations.find(c => c.id === convId);
        if (conv && message.status !== "streaming") {
          void syncChatMessage({
            conversationId: convId,
            // Pass the local newMessage.id as the stable messageId —
            // retries of the SAME local message dedupe on the server.
            messageId: localId,
            source: "economic-agent",
            title: conv.title || "Economic Agent Conversation",
            role: message.role,
            content: message.content,
            // `fromModel` on the economic-agent store is a boolean flag
            // (was the message generated by the configured model?).
            // The server's ChatMessage.model field is a string. We
            // omit it — the conversation-level model field can be set
            // by the migration prompt.
            model: undefined,
            provider: undefined,
          }).catch(() => { /* non-fatal — local already succeeded */ });
        }
        return localId;
      },

      updateMessage: (convId, messageId, patch) => {
        set((s) => ({
          conversations: s.conversations.map((conversation) =>
            conversation.id === convId
              ? {
                  ...conversation,
                  updatedAt: now(),
                  messages: conversation.messages.map((message) =>
                    message.id === messageId ? { ...message, ...patch } : message,
                  ),
                }
              : conversation,
          ),
        }));
        const message = get().conversations
          .find((conversation) => conversation.id === convId)
          ?.messages.find((item) => item.id === messageId);
        if (message && patch.status === "complete") {
          const conversation = get().conversations.find((item) => item.id === convId);
          void syncChatMessage({
            conversationId: convId,
            messageId,
            source: "economic-agent",
            title: conversation?.title || "Lilith Conversation",
            role: message.role,
            content: message.content,
            model: undefined,
            provider: undefined,
          }).catch(() => { /* local message remains authoritative */ });
        }
      },

      removeMessage: (convId, messageId) => set((s) => ({
        conversations: s.conversations.map((conversation) =>
          conversation.id === convId
            ? { ...conversation, messages: conversation.messages.filter((message) => message.id !== messageId) }
            : conversation,
        ),
      })),

      replaceMessages: (convId, messages, capability) => {
        const before = get().conversations.find((conversation) => conversation.id === convId);
        const beforeById = new Map((before?.messages ?? []).map((message) => [message.id, message]));
        set((state) => ({
          conversations: state.conversations.map((conversation) => {
            if (conversation.id !== convId) return conversation;
            const prepared = messages.map((message) => ({ ...message, capability: message.capability ?? capability }));
            const next = withRollingSummary(conversation, prepared);
            const firstUser = prepared.find((message) => message.role === "user");
            return {
              ...next,
              updatedAt: now(),
              capabilities: addCapability(conversation, capability),
              title: conversation.title === "New conversation" && firstUser ? firstUser.content.slice(0, 40) : conversation.title,
            };
          }),
        }));
        const conversation = get().conversations.find((item) => item.id === convId);
        if (!conversation) return;
        for (const message of conversation.messages) {
          const previous = beforeById.get(message.id);
          const newlyComplete = message.status !== "streaming" && (!previous || previous.status === "streaming");
          if (!newlyComplete || !message.content) continue;
          void syncChatMessage({
            conversationId: convId,
            messageId: message.id,
            source: "lilith",
            title: conversation.title || "Lilith Conversation",
            role: message.role,
            content: message.content,
          }).catch(() => { /* local history remains authoritative */ });
        }
      },

      importLegacyConversation: (messages) => {
        if (messages.length === 0 || get().conversations.length > 0) return null;
        const id = genId("conv");
        const conversation = withRollingSummary({
          id,
          title: messages.find((message) => message.role === "user")?.content.slice(0, 40) || "Imported Lilith conversation",
          messages: [], createdAt: now(), updatedAt: now(), pinned: false, archived: false,
          capabilities: ["general"],
        }, messages.map((message) => ({ ...message, capability: message.capability ?? "general" })));
        set({ conversations: [conversation], activeId: id });
        return id;
      },

      setDraftText: (t) => set({ draftText: t }),
      setSearchQuery: (q) => set({ searchQuery: q }),
      setBusy: (v) => set({ busy: v }),
      setError: (e) => set({ error: e }),

      addContextItem: (item) =>
        set((s) => ({
          contextItems: [
            ...s.contextItems,
            { ...item, id: genId("ctx") },
          ],
        })),

      removeContextItem: (id) =>
        set((s) => ({
          contextItems: s.contextItems.filter((c) => c.id !== id),
        })),

      clearContext: () => set({ contextItems: [] }),
    }),
    {
      name: "lucian-economic-agent-restored",
      skipHydration: true,
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
        return localStorage;
      }),
      // Phase 6: do NOT persist transient runtime state.
      // `busy` and `error` are session-only — they must never survive
      // a page reload. If they did, the send button would be permanently
      // disabled after a refresh during a request.
      partialize: (s) => ({
        conversations: s.conversations,
        activeId: s.activeId,
        searchQuery: s.searchQuery,
        draftText: s.draftText,
        contextItems: s.contextItems,
        // Explicitly exclude: busy, error
      }),
    },
  ),
);

/* ── Derived helpers ── */

/** Group conversations by date: Today / Yesterday / Older. */
export function groupConversationsByDate(
  conversations: Conversation[],
): { label: string; items: Conversation[] }[] {
  const now = Date.now();
  const todayStart = new Date(now).setHours(0, 0, 0, 0);
  const yesterdayStart = todayStart - 86400000;

  const pinned = conversations.filter((c) => c.pinned && !c.archived);
  const today = conversations.filter(
    (c) => !c.pinned && !c.archived && c.updatedAt >= todayStart,
  );
  const yesterday = conversations.filter(
    (c) =>
      !c.pinned &&
      !c.archived &&
      c.updatedAt >= yesterdayStart &&
      c.updatedAt < todayStart,
  );
  const older = conversations.filter(
    (c) => !c.pinned && !c.archived && c.updatedAt < yesterdayStart,
  );
  const archived = conversations.filter((c) => c.archived);

  const groups: { label: string; items: Conversation[] }[] = [];
  if (pinned.length) groups.push({ label: "Pinned", items: pinned });
  if (today.length) groups.push({ label: "Today", items: today });
  if (yesterday.length) groups.push({ label: "Yesterday", items: yesterday });
  if (older.length) groups.push({ label: "Previous", items: older });
  if (archived.length) groups.push({ label: "Archived", items: archived });
  return groups;
}

/** Filter conversations by search query. */
export function filterConversations(
  conversations: Conversation[],
  query: string,
): Conversation[] {
  if (!query.trim()) return conversations;
  const q = query.toLowerCase();
  return conversations.filter(
    (c) =>
      c.title.toLowerCase().includes(q) ||
      c.messages.some((m) => m.content.toLowerCase().includes(q)),
  );
}

/** Phase 2 canonical name. Existing imports keep working through the alias. */
export const useLilithConversationStore = useEconomicAgentStore;
