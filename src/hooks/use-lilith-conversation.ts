"use client";

import { useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from "react";
import {
  useLilithConversationStore,
  type AgentMessage,
  type LilithCapability,
} from "@/store/economic-agent";

/**
 * Connect any module to Lilith's single active conversation. The adapter has
 * a React setState-shaped setter so feature panels can share the canonical
 * history without reimplementing persistence or rolling summaries.
 */
export function useLilithConversation(capability: LilithCapability): {
  conversationId: string | null;
  messages: AgentMessage[];
  setMessages: Dispatch<SetStateAction<AgentMessage[]>>;
  ensureConversation: () => string;
} {
  const conversations = useLilithConversationStore((state) => state.conversations);
  const activeId = useLilithConversationStore((state) => state.activeId);
  const ensureActiveConversation = useLilithConversationStore((state) => state.ensureActiveConversation);
  const replaceMessages = useLilithConversationStore((state) => state.replaceMessages);

  useEffect(() => {
    ensureActiveConversation(capability);
  }, [capability, ensureActiveConversation]);

  const conversation = useMemo(
    () => conversations.find((item) => item.id === activeId),
    [conversations, activeId],
  );

  const ensureConversation = useCallback(
    () => ensureActiveConversation(capability),
    [capability, ensureActiveConversation],
  );

  const setMessages: Dispatch<SetStateAction<AgentMessage[]>> = useCallback((value) => {
    const id = useLilithConversationStore.getState().ensureActiveConversation(capability);
    const current = useLilithConversationStore.getState().conversations.find((item) => item.id === id)?.messages ?? [];
    const next = typeof value === "function" ? value(current) : value;
    replaceMessages(id, next, capability);
  }, [capability, replaceMessages]);

  return {
    conversationId: conversation?.id ?? null,
    messages: conversation?.messages ?? [],
    setMessages,
    ensureConversation,
  };
}
