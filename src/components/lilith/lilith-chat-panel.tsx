"use client";

/* LilithChatPanel — Phase 7: unified AI foundation.
 *
 * Lilith now uses the shared AI provider layer (same as Economic Agent).
 * Multi-turn conversation history is sent. Messages are persisted.
 * Errors are displayed as proper error states (not fake assistant messages).
 * The Model button opens a functional provider/model selector.
 * Response style settings affect the system prompt.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Mic, ChevronDown, X, Sparkles, Cpu, MessageSquarePlus, Search, Archive, Trash2, Pencil, MessagesSquare,
} from "lucide-react";
import { useLilithStore, type LilithError } from "@/store/lilith";
import {
  conversationWindow,
  filterConversations,
  useLilithConversationStore,
  type AgentMessage,
  type LilithCapability,
} from "@/store/economic-agent";
import { useSharedAIConfig, PROVIDERS, getProviderInfo, type ProviderId } from "@/store/shared-ai-config";
import { readAIBehaviorWire } from "@/lib/ai-behavior";
import { cn } from "@/lib/utils";
import {
  LilithActivity,
  LilithComposer,
  LilithErrorBanner,
  LilithMessage,
  type LilithChatAttachment,
} from "@/components/chat/lilith-chat-ui";
import { attachmentLabel, attachmentsToContext, attachmentPreviews } from "@/lib/chat/attachments";
import { isAbortError, streamChatResponse } from "@/lib/chat/stream-response";
import { resolvePageContext } from "@/lib/context-resolver";
import { useLilithVoice } from "@/hooks/use-lilith-voice";

interface Props {
  orbX: number;
  orbY: number;
  orbSize: number;
}

function capabilityForPath(pathname: string): LilithCapability {
  if (pathname.startsWith("/markets")) return "markets";
  if (pathname.startsWith("/vault")) return "vault";
  if (pathname.startsWith("/dev-workspace")) return "coding";
  if (pathname.startsWith("/notes")) return "notes";
  if (pathname.startsWith("/chess-academy")) return "chess";
  if (pathname.startsWith("/news-feed")) return "news";
  if (pathname.startsWith("/investing")) return "investing";
  if (pathname.startsWith("/research")) return "research";
  if (pathname.startsWith("/mindset-library") || pathname.startsWith("/knowledge-library")) return "learning";
  if (pathname.startsWith("/economic-agent") || pathname.startsWith("/economy-hub")) return "economic";
  return "general";
}

export function LilithChatPanel({ orbX, orbY, orbSize }: Props) {
  const pathname = usePathname();
  const legacyMessages = useLilithStore((s) => s.messages);
  const clearLegacyMessages = useLilithStore((s) => s.clearMessages);
  const inputText = useLilithStore((s) => s.inputText);
  const setInputText = useLilithStore((s) => s.setInputText);
  const setStatus = useLilithStore((s) => s.setStatus);
  const settings = useLilithStore((s) => s.settings);
  const updateSettings = useLilithStore((s) => s.updateSettings);
  const setPanelOpen = useLilithStore((s) => s.setPanelOpen);
  const busy = useLilithStore((s) => s.busy);
  const setBusy = useLilithStore((s) => s.setBusy);
  const error = useLilithStore((s) => s.error);
  const setError = useLilithStore((s) => s.setError);

  // Phase 2: one canonical conversation engine shared with every capability.
  const conversations = useLilithConversationStore((s) => s.conversations);
  const activeId = useLilithConversationStore((s) => s.activeId);
  const ensureActiveConversation = useLilithConversationStore((s) => s.ensureActiveConversation);
  const newConversation = useLilithConversationStore((s) => s.newConversation);
  const selectConversation = useLilithConversationStore((s) => s.selectConversation);
  const deleteConversation = useLilithConversationStore((s) => s.deleteConversation);
  const renameConversation = useLilithConversationStore((s) => s.renameConversation);
  const toggleArchive = useLilithConversationStore((s) => s.toggleArchive);
  const addConversationMessage = useLilithConversationStore((s) => s.addMessage);
  const updateConversationMessage = useLilithConversationStore((s) => s.updateMessage);
  const removeConversationMessage = useLilithConversationStore((s) => s.removeMessage);
  const importLegacyConversation = useLilithConversationStore((s) => s.importLegacyConversation);
  const activeConversation = conversations.find((conversation) => conversation.id === activeId);
  const messages = useMemo(() => activeConversation?.messages ?? [], [activeConversation]);

  const addMessage = useCallback((message: Omit<AgentMessage, "id" | "timestamp">) => {
    const conversationId = ensureActiveConversation(message.capability ?? "general");
    return addConversationMessage(conversationId, { ...message, capability: message.capability ?? "general" });
  }, [addConversationMessage, ensureActiveConversation]);
  const updateMessage = useCallback((messageId: string, patch: Partial<AgentMessage>) => {
    const conversationId = useLilithConversationStore.getState().activeId;
    if (conversationId) updateConversationMessage(conversationId, messageId, patch);
  }, [updateConversationMessage]);
  const removeMessage = useCallback((messageId: string) => {
    const conversationId = useLilithConversationStore.getState().activeId;
    if (conversationId) removeConversationMessage(conversationId, messageId);
  }, [removeConversationMessage]);

  // Shared AI config
  const resolve = useSharedAIConfig((s) => s.resolve);
  const setOverride = useSharedAIConfig((s) => s.setOverride);
  const setGlobalProvider = useSharedAIConfig((s) => s.setGlobalProvider);
  const setGlobalModel = useSharedAIConfig((s) => s.setGlobalModel);
  const globalProvider = useSharedAIConfig((s) => s.globalProvider);
  const globalModel = useSharedAIConfig((s) => s.globalModel);
  const overrides = useSharedAIConfig((s) => s.overrides);

  const resolved = resolve("lilith");
  const lilithOverride = overrides["lilith"];

  const scrollRef = useRef<HTMLDivElement>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [conversationsOpen, setConversationsOpen] = useState(false);
  const [conversationSearch, setConversationSearch] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const modelRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const voiceBaseTextRef = useRef("");
  const voice = useLilithVoice();

  useEffect(() => {
    const imported = importLegacyConversation(legacyMessages.map((message) => ({ ...message, capability: "general" as const })));
    if (imported) clearLegacyMessages();
    else ensureActiveConversation("general");
  }, [clearLegacyMessages, ensureActiveConversation, importLegacyConversation, legacyMessages]);

  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1024;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 768;
  const PANEL_WIDTH = Math.min(420, viewportWidth - 16);
  const PANEL_HEIGHT = Math.min(600, viewportHeight - 16);
  const GAP = 12;

  // Compute panel side from orb position (no effect needed).
  const orbCenter = orbX + orbSize / 2;
  const screenCenter = typeof window !== "undefined" ? window.innerWidth / 2 : 500;
  const panelSide: "left" | "right" = orbCenter > screenCenter ? "left" : "right";

  const panelLeft = panelSide === "left"
    ? Math.max(8, orbX - PANEL_WIDTH - GAP)
    : Math.min(window.innerWidth - PANEL_WIDTH - 8, orbX + orbSize + GAP);
  const panelTop = Math.max(8, Math.min(window.innerHeight - PANEL_HEIGHT - 8, orbY));

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Close model popover on outside click.
  useEffect(() => {
    if (!modelOpen) return;
    const handler = (e: MouseEvent) => {
      if (!modelRef.current?.contains(e.target as Node)) setModelOpen(false);
    };
    const id = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => { clearTimeout(id); document.removeEventListener("mousedown", handler); };
  }, [modelOpen]);

  // Phase 8: consume handoff context from other modules (Notes, Investing, Chess, etc.)
  const [handoffContext, setHandoffContext] = useState<{
    staticContext: { module: string; label: string; content: string }[];
    contextRefs: { module: string; entityType: string; entityId: string }[];
    prompt: string;
  } | null>(null);
  const [handoffConsumed, setHandoffConsumed] = useState(false);

  useEffect(() => {
    if (handoffConsumed) return;
    // Defer setState to a microtask so we don't call it synchronously
    // inside the effect body (React 19 set-state-in-effect rule).
    const id = window.setTimeout(() => {
      const { consumeLilithHandoff } = require("@/lib/cross-module-bridge");
      const handoff = consumeLilithHandoff();
      if (handoff && (handoff.staticContext.length > 0 || handoff.contextRefs.length > 0)) {
        setHandoffContext(handoff);
      }
      setHandoffConsumed(true);
    }, 0);
    return () => window.clearTimeout(id);
  }, [handoffConsumed]);

  // Resolve handoff context at send time (dynamic refs → fresh data).
  const resolveHandoffContext = useCallback((): { type: string; label: string; description: string; data: string }[] => {
    if (!handoffContext) return [];
    const { resolveAllContext } = require("@/lib/context-resolver");
    return resolveAllContext(handoffContext.contextRefs, handoffContext.staticContext);
  }, [handoffContext]);

  // Phase 7: build Lilith's system prompt with response style.
  const buildSystemPrompt = useCallback(() => {
    const styleInstructions: Record<string, string> = {
      concise: "Keep responses very short (1-3 sentences). Be direct and to the point.",
      balanced: "Keep responses concise but complete (2-5 sentences). Balance brevity with useful detail.",
      detailed: "Provide thorough, detailed responses. Include context and explanation where helpful.",
    };
    return [
      `You are ${settings.name}, LUCIAN's floating AI assistant.`,
      "You are a helpful, friendly presence integrated into the LUCIAN workspace.",
      "If you don't have specific information, say so honestly.",
      "Never fabricate data, prices, or market information.",
      styleInstructions[settings.responseStyle] ?? styleInstructions.balanced,
    ].join("\n");
  }, [settings.name, settings.responseStyle]);

  // Phase 7: send multi-turn conversation history (last 20 messages).
  const handleSend = useCallback(async (attachments: LilithChatAttachment[] = []) => {
    const text = inputText.trim();
    if ((!text && attachments.length === 0) || busy) return;

    setBusy(true);
    let previews: Awaited<ReturnType<typeof attachmentPreviews>>;
    let attachmentContext: Awaited<ReturnType<typeof attachmentsToContext>>;
    try { previews = await attachmentPreviews(attachments); attachmentContext = await attachmentsToContext(attachments); }
    catch (error) { setBusy(false); setError({type:"attachment-failed",message:error instanceof Error ? error.message : "Unable to prepare attachments. Please reattach them."}); return false; }
    setBusy(true);
    setError(null);
    const visibleUserText = `${text || "Please review the attached files."}${attachmentLabel(attachments)}`;
    const capability = capabilityForPath(pathname);
    addMessage({ role: "user", content: visibleUserText,
      attachments: previews, fromModel: false, status: "complete", capability });
    const streamingId = addMessage({ role: "assistant", content: "", fromModel: true, status: "streaming", capability });
    setInputText("");
    setStatus("thinking");

    const conversationId = useLilithConversationStore.getState().activeId;
    const currentConversation = useLilithConversationStore.getState().conversations.find((conversation) => conversation.id === conversationId);
    const history = conversationWindow(currentConversation);
    const historyWindow = history.messages.filter((_message, index) => index !== history.messages.length - 1 || _message.content !== "");

    try {
      // Phase 8: resolve handoff context at send time (dynamic refs → fresh data).
      const resolvedCtx = resolveHandoffContext();
      const pageContext = resolvePageContext(pathname);
      const controller = new AbortController();
      abortRef.current = controller;
      const result = await streamChatResponse({
        signal: controller.signal,
        onDelta: (_delta, accumulated) => updateMessage(streamingId, { content: accumulated, status: "streaming" }),
        body: {
          messages: historyWindow,
          provider: resolved.provider,
          model: resolved.model,
          reasoningEffort: useSharedAIConfig.getState().reasoningEffort,
          systemPrompt: buildSystemPrompt(),
          contextItems: [...(history.summaryContext ? [{ type: "conversation-summary", label: "Earlier conversation", description: "Rolling summary of older turns", data: history.summaryContext }] : []), ...pageContext, ...resolvedCtx.map((c: { type: string; label: string; description: string; data: string }) => ({
            type: c.type, label: c.label, description: c.description, data: c.data,
          })), ...attachmentContext],
          behavior: readAIBehaviorWire(),
        },
      });
      updateMessage(streamingId, { content: result.content, status: "complete" });
      if (settings.voiceEnabled && settings.autoSpeak) {
        setStatus("speaking");
        voice.speak(result.content, { rate: settings.speechSpeed, volume: settings.volume, onEnd: () => setStatus("idle") });
      } else {
        setStatus("idle");
      }
    } catch (requestError) {
      if (isAbortError(requestError)) {
        const partial = useLilithConversationStore.getState().conversations
          .find((conversation) => conversation.id === useLilithConversationStore.getState().activeId)
          ?.messages.find((message) => message.id === streamingId)?.content;
        if (partial) updateMessage(streamingId, { status: "complete" });
        else removeMessage(streamingId);
        setStatus("idle");
        return;
      }
      removeMessage(streamingId);
      setError({
        type: ((requestError as { errorType?: LilithError["type"] }).errorType ?? "network-error"),
        message: requestError instanceof Error ? requestError.message : "Could not reach the model provider. Check your network connection.",
      });
      setStatus("idle");
      // Phase 10: notify on network errors too (deduped).
      void import("@/lib/notification-producers").then(({ notifyAiProviderFailure }) => {
        notifyAiProviderFailure({
          provider: resolved.provider,
          errorType: "network-error",
          interface: "lilith",
        });
      }).catch(() => { /* non-fatal */ });
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [inputText, busy, addMessage, updateMessage, removeMessage, setInputText, setStatus, setBusy, setError, resolved, buildSystemPrompt, resolveHandoffContext, pathname, settings.voiceEnabled, settings.autoSpeak, settings.speechSpeed, settings.volume, voice]);

  // Phase 7: retry the last failed request.
  const handleRetry = useCallback(async () => {
    if (busy) return;
    const state = useLilithConversationStore.getState();
    const conversation = state.conversations.find((item) => item.id === state.activeId);
    if (!conversation || conversation.messages.length === 0) return;

    const lastUserMsg = [...conversation.messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;

    const lastMessage = conversation.messages[conversation.messages.length - 1];
    if (!error && lastMessage?.role === "assistant") removeMessage(lastMessage.id);

    setError(null);
    setStatus("thinking");

    const streamingId = addMessage({ role: "assistant", content: "", fromModel: true, status: "streaming", capability: lastUserMsg.capability ?? "general" });
    const refreshed = useLilithConversationStore.getState().conversations.find((item) => item.id === state.activeId);
    const windowed = conversationWindow(refreshed);

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const result = await streamChatResponse({
        signal: controller.signal,
        onDelta: (_delta, accumulated) => updateMessage(streamingId, { content: accumulated, status: "streaming" }),
        body: {
          messages: windowed.messages,
          provider: resolved.provider,
          model: resolved.model,
          reasoningEffort: useSharedAIConfig.getState().reasoningEffort,
          systemPrompt: buildSystemPrompt(),
          contextItems: [...(windowed.summaryContext ? [{ type: "conversation-summary", label: "Earlier conversation", description: "Rolling summary of older turns", data: windowed.summaryContext }] : []), ...resolvePageContext(pathname), ...resolveHandoffContext()],
          behavior: readAIBehaviorWire(),
        },
      });
      updateMessage(streamingId, { content: result.content, status: "complete" });
      if (settings.voiceEnabled && settings.autoSpeak) {
        setStatus("speaking");
        voice.speak(result.content, { rate: settings.speechSpeed, volume: settings.volume, onEnd: () => setStatus("idle") });
      } else {
        setStatus("idle");
      }
    } catch (requestError) {
      if (isAbortError(requestError)) {
        removeMessage(streamingId);
        setStatus("idle");
        return;
      }
      removeMessage(streamingId);
      setError({ type: ((requestError as { errorType?: LilithError["type"] }).errorType ?? "network-error"), message: requestError instanceof Error ? requestError.message : "Could not reach the model provider." });
      setStatus("idle");
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [busy, error, addMessage, updateMessage, removeMessage, setStatus, setBusy, setError, resolved, buildSystemPrompt, settings.voiceEnabled, settings.autoSpeak, settings.speechSpeed, settings.volume, voice, pathname, resolveHandoffContext]);

  const handleVoiceToggle = useCallback(() => {
    if (voice.listening) {
      voice.stopListening();
      setStatus("idle");
      return;
    }
    if (!voice.supported) {
      setError({ type: "unknown", message: "Voice recognition is not supported in this browser. You can still type to Lilthe." });
      return;
    }
    if (!settings.voiceEnabled) updateSettings({ voiceEnabled: true });
    voiceBaseTextRef.current = inputText.trim();
    const started = voice.startListening({
      onTranscript: (transcript) => setInputText(`${voiceBaseTextRef.current}${voiceBaseTextRef.current ? " " : ""}${transcript}`),
      onError: (message) => { setError({ type: "unknown", message }); setStatus("idle"); },
    });
    if (started) setStatus("listening");
  }, [inputText, setError, setInputText, setStatus, settings.voiceEnabled, updateSettings, voice]);

  const providerInfo = getProviderInfo(resolved.provider);
  const displayModel = resolved.model || providerInfo.defaultModel || "model";
  const visibleConversations = filterConversations(conversations, conversationSearch)
    .sort((a, b) => Number(a.archived) - Number(b.archived) || b.updatedAt - a.updatedAt);
  const currentPageContext = resolvePageContext(pathname);

  return (
    <div
      className="themed fixed z-[101] flex flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-pop"
      style={{ left: panelLeft, top: panelTop, width: PANEL_WIDTH, height: PANEL_HEIGHT }}
    >
      {/* Header */}
      <div className="themed flex h-9 shrink-0 items-center justify-between border-b border-line-muted px-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-fg">{settings.name}</span>
          {activeConversation?.capabilities?.length ? <span className="max-w-24 truncate rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-[8px] uppercase text-[var(--accent)]">{activeConversation.capabilities.at(-1)}</span> : null}
          {(busy || voice.listening || voice.speaking) && <span className="text-[9px] text-fg-faint">{voice.listening ? "listening…" : voice.speaking ? "speaking…" : "thinking…"}</span>}
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={() => setConversationsOpen((value) => !value)} className="focus-ring rounded p-1 text-fg-faint hover:bg-hover hover:text-fg" aria-label="Conversations" title="Conversations">
            <MessagesSquare className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => { newConversation("general"); setConversationsOpen(false); }} className="focus-ring rounded p-1 text-fg-faint hover:bg-hover hover:text-fg" aria-label="New conversation" title="New conversation">
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setPanelOpen(false)} className="focus-ring rounded p-1 text-fg-faint hover:bg-hover hover:text-fg" aria-label="Close panel">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {conversationsOpen && (
        <div className="absolute inset-x-0 top-9 z-40 max-h-[72%] overflow-hidden border-b border-line bg-overlay shadow-pop">
          <div className="flex items-center gap-2 border-b border-line-muted p-2">
            <Search className="h-3.5 w-3.5 text-fg-faint" />
            <input value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} autoFocus placeholder="Search conversations…" className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-fg-faint" />
            <button onClick={() => newConversation("general")} className="focus-ring rounded bg-[var(--accent)] px-2 py-1 text-[10px] font-medium text-[var(--accent-fg)]">New</button>
          </div>
          <div className="max-h-[330px] overflow-y-auto p-1.5">
            {visibleConversations.length === 0 ? (
              <p className="px-2 py-6 text-center text-[10px] text-fg-faint">No conversations found.</p>
            ) : visibleConversations.map((conversation) => (
              <div key={conversation.id} className={cn("group flex items-center gap-1 rounded-md px-1.5 py-1", conversation.id === activeId ? "bg-active" : "hover:bg-hover", conversation.archived && "opacity-65")}>
                {renamingId === conversation.id ? (
                  <input
                    value={renameDraft}
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") { renameConversation(conversation.id, renameDraft); setRenamingId(null); }
                      if (event.key === "Escape") setRenamingId(null);
                    }}
                    onBlur={() => { renameConversation(conversation.id, renameDraft); setRenamingId(null); }}
                    autoFocus
                    className="min-w-0 flex-1 rounded border border-line bg-surface px-1.5 py-1 text-[10px] text-fg outline-none"
                  />
                ) : (
                  <button onClick={() => { selectConversation(conversation.id); setConversationsOpen(false); }} className="min-w-0 flex-1 px-1 py-1 text-left">
                    <p className="truncate text-[11px] font-medium text-fg">{conversation.title}</p>
                    <p className="truncate text-[9px] text-fg-faint">{conversation.messages.length} messages{conversation.archived ? " · archived" : ""}</p>
                  </button>
                )}
                <button onClick={() => { setRenamingId(conversation.id); setRenameDraft(conversation.title); }} title="Rename" className="focus-ring rounded p-1 text-fg-faint opacity-0 hover:bg-surface group-hover:opacity-100"><Pencil className="h-3 w-3" /></button>
                <button onClick={() => toggleArchive(conversation.id)} title={conversation.archived ? "Restore" : "Archive"} className="focus-ring rounded p-1 text-fg-faint opacity-0 hover:bg-surface group-hover:opacity-100"><Archive className="h-3 w-3" /></button>
                <button onClick={() => deleteConversation(conversation.id)} title="Delete" className="focus-ring rounded p-1 text-fg-faint opacity-0 hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"><Trash2 className="h-3 w-3" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <LilithErrorBanner message={error.message} onRetry={error.type === "attachment-failed" ? undefined : () => void handleRetry()} onDismiss={() => setError(null)} />}

      {currentPageContext.length > 0 && (
        <div className="border-b border-line-muted bg-[var(--accent)]/5 px-3 py-1 text-[9px] text-fg-muted">
          Page context: <span className="font-medium text-fg">{currentPageContext.map((item) => item.label).join(", ")}</span>
        </div>
      )}

      {/* Phase 8: Handoff context chips from other modules */}
      {handoffContext && (handoffContext.staticContext.length > 0 || handoffContext.contextRefs.length > 0) && (
        <div className="border-b border-line-muted bg-surface-2/50 px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[8px] uppercase tracking-wide text-fg-faint">Attached:</span>
            {handoffContext.staticContext.map((c, i) => (
              <span key={`s-${i}`} className="rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-[8px] text-[var(--accent)]">
                {c.module} · {c.label}
              </span>
            ))}
            {handoffContext.contextRefs.map((r, i) => (
              <span key={`r-${i}`} className="rounded bg-[var(--accent)]/10 px-1.5 py-0.5 text-[8px] text-[var(--accent)]">
                {r.module} · {r.entityType}
              </span>
            ))}
            <button
              onClick={() => setHandoffContext(null)}
              className="text-[8px] text-fg-faint hover:text-fg"
              title="Remove attached context"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Conversation area */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 ? <EmptyState name={settings.name} /> : (
          messages.map((message, index) => (
            <LilithMessage
              key={message.id}
              message={message}
              assistantName={settings.name}
              compact
              onRegenerate={message.role === "assistant" && index === messages.length - 1 ? () => void handleRetry() : undefined}
            />
          ))
        )}
        {busy && messages[messages.length - 1]?.status !== "streaming" && <LilithActivity label={`${settings.name} is thinking`} />}
      </div>

      {/* Composer */}
      <LilithComposer
        value={inputText}
        onChange={setInputText}
        onSend={handleSend}
        busy={busy}
        onStop={() => abortRef.current?.abort()}
        compact
        placeholder={`Message ${settings.name}…`}
        footer={
          <>
            <button
              type="button"
              title={voice.supported ? (voice.listening ? "Stop listening" : "Talk to Lilthe") : "Voice recognition is not supported in this browser"}
              onClick={() => { if (!settings.pushToTalk) handleVoiceToggle(); }}
              onPointerDown={() => { if (settings.pushToTalk && !voice.listening) handleVoiceToggle(); }}
              onPointerUp={() => { if (settings.pushToTalk) { voice.stopListening(); setStatus("idle"); } }}
              className={cn("focus-ring flex h-7 w-7 items-center justify-center rounded-md transition-colors opacity-60 hover:bg-hover hover:opacity-100",
                voice.listening ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "text-fg-muted")}
            >
              <Mic className="h-3.5 w-3.5" />
            </button>
            <div ref={modelRef} className="relative">
              <button
                type="button"
                onClick={() => setModelOpen((v) => !v)}
                className="focus-ring flex h-7 max-w-24 items-center gap-1 rounded-md px-1.5 text-[9px] text-fg-muted hover:bg-hover hover:text-fg"
                title="Provider & Model"
              >
                <Cpu className="h-2.5 w-2.5" />
                <span className="max-w-[60px] truncate">{displayModel}</span>
                <ChevronDown className="h-2 w-2" />
              </button>
              {modelOpen && (
                <div className="absolute bottom-full left-0 mb-1 w-64 overflow-hidden rounded-md border border-line bg-overlay shadow-pop">
                  <div className="border-b border-line-muted px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
                    Lilthe Provider & Model
                  </div>
                  <div className="space-y-2 p-2">
                    {/* Override toggle */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-fg-muted">
                        {lilithOverride ? "Using custom override" : "Using global default"}
                      </span>
                      <button
                        onClick={() => {
                          if (lilithOverride) {
                            setOverride("lilith", null);
                          } else {
                            setOverride("lilith", { provider: globalProvider, model: globalModel });
                          }
                        }}
                        className="rounded border border-line-muted px-1.5 py-0.5 text-[9px] text-fg-muted hover:text-fg"
                      >
                        {lilithOverride ? "Use global" : "Override"}
                      </button>
                    </div>
                    {/* Provider dropdown */}
                    <div>
                      <label className="text-[9px] uppercase tracking-wide text-fg-faint">Provider</label>
                      <select
                        value={lilithOverride?.provider ?? globalProvider}
                        onChange={(e) => {
                          const p = e.target.value as ProviderId;
                          if (lilithOverride) {
                            setOverride("lilith", { provider: p, model: getProviderInfo(p).defaultModel });
                          } else {
                            setGlobalProvider(p);
                            setGlobalModel(getProviderInfo(p).defaultModel);
                          }
                        }}
                        className="mt-1 w-full rounded border border-line-muted bg-surface px-2 py-1 text-[11px] text-fg"
                      >
                        {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    {/* Model input */}
                    <div>
                      <label className="text-[9px] uppercase tracking-wide text-fg-faint">Model</label>
                      <input
                        type="text"
                        value={lilithOverride?.model ?? globalModel}
                        onChange={(e) => {
                          if (lilithOverride) {
                            setOverride("lilith", { ...lilithOverride, model: e.target.value });
                          } else {
                            setGlobalModel(e.target.value);
                          }
                        }}
                        placeholder={providerInfo.modelPlaceholder}
                        className="mt-1 w-full rounded border border-line-muted bg-surface px-2 py-1 text-[11px] text-fg"
                      />
                    </div>
                    <div className="text-[9px] text-fg-faint">
                      The selected provider + model are used for Lilthe&apos;s next request.
                      Configure API keys in Settings → Lilthe → Lilthe Model Connection.
                    </div>
                  </div>
                </div>
              )}
            </div>
            <button onClick={() => newConversation("general")} className="focus-ring h-7 rounded-md px-1.5 text-[9px] text-fg-faint hover:bg-hover hover:text-fg" title="Start a new conversation">New</button>
          </>
        }
      />
    </div>
  );
}

function EmptyState({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <Sparkles className="h-5 w-5 text-[var(--accent)]" />
      <p className="mt-2 text-[12px] font-medium text-fg">How can I help?</p>
      <p className="mt-1 text-[10px] text-fg-muted">
        {name} is ready to assist. Ask anything about your workspace.
      </p>
    </div>
  );
}
