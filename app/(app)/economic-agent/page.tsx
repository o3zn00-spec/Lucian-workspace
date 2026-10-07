"use client";

import { ComposerPopover } from "@/components/chat/composer-popover";
import { useSharedAIConfig } from "@/store/shared-ai-config";
import { ModelSelector } from "@/components/chat/model-selector";
import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Plus,
  Search,
  ChevronDown,
  MoreHorizontal,
  Pin,
  Archive,
  Trash2,
  Edit3,
  X,
  Bot,
  Paperclip,
  FileText,
  Folder,
  MessageSquare,
  StickyNote,
  TrendingUp,
  LineChart,
  Wallet,
  Building2,
  Check,
  Menu,
  Cpu,
} from "lucide-react";
import {
  useEconomicAgentStore,
  groupConversationsByDate,
  filterConversations,
  conversationWindow,
  type Conversation,
  type AgentMessage,
  type ContextItem,
  type AgentError,
} from "@/store/economic-agent";
import { useEconomicAgentConnection } from "@/store/economic-agent-connection";
import { getAvailableContextSources, attachContext, type ContextSource } from "@/lib/agent/context-providers";
import { readAIBehaviorWire } from "@/lib/ai-behavior";
import { useRestoredAssistantReady } from "@/components/assistant/restored-agent-bridge";
import { useLilithStore, getSizePx } from "@/store/lilith";
import { cn } from "@/lib/utils";
import {
  LilithComposer,
  LilithErrorBanner,
  LilithMessage,
  type LilithChatAttachment,
} from "@/components/chat/lilith-chat-ui";
import { isAbortError, streamChatResponse } from "@/lib/chat/stream-response";
import { attachmentLabel, attachmentsToContext, attachmentPreviews } from "@/lib/chat/attachments";

/* ────────────────────────────────────────────────────────────────── */
/* Main page                                                          */
/* ────────────────────────────────────────────────────────────────── */

export default function EconomicAgentPage() {
  const assistantReady=useRestoredAssistantReady();
  const conversations = useEconomicAgentStore((s) => s.conversations);
  const activeId = useEconomicAgentStore((s) => s.activeId);
  const searchQuery = useEconomicAgentStore((s) => s.searchQuery);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const activeConv = conversations.find((c) => c.id === activeId);
  const hasActiveConv = !!activeConv && activeConv.messages.length > 0;
  if(!assistantReady)return <div role="status" className="p-6 text-fg-muted">Loading Lilthe’s saved conversations…</div>;

  return (
    <div className="themed flex h-full min-h-0 overflow-hidden bg-canvas text-fg">
      {/* Phase 8: Handoff receiver */}
      <Suspense fallback={null}>
        <EconomicAgentHandoffReceiver />
      </Suspense>
      {/* Phase 9: deep-link receiver for ?conversation=<id> */}
      <Suspense fallback={null}>
        <EconomicAgentDeepLinkReceiver />
      </Suspense>
      {/* ── Mobile sidebar toggle ── */}
      {!sidebarOpen && (
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="absolute left-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-fg-muted lg:hidden"
          aria-label="Open conversation list"
        >
          <Menu className="h-4 w-4" />
        </button>
      )}

      {/* ── Mobile backdrop ── */}
      {sidebarOpen && (
        <div
          className="absolute inset-0 z-20 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Conversation sidebar ── */}
      <ConversationSidebar
        className={cn(
          "z-30 transition-transform lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
        onSelect={() => setSidebarOpen(false)}
      />

      {/* ── Main workspace ── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {hasActiveConv ? (
          <ConversationView conversation={activeConv!} />
        ) : (
          <WelcomeView />
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Conversation sidebar                                               */
/* ────────────────────────────────────────────────────────────────── */

function ConversationSidebar({
  className,
  onSelect,
}: {
  className?: string;
  onSelect?: () => void;
}) {
  const conversations = useEconomicAgentStore((s) => s.conversations);
  const activeId = useEconomicAgentStore((s) => s.activeId);
  const searchQuery = useEconomicAgentStore((s) => s.searchQuery);
  const setSearchQuery = useEconomicAgentStore((s) => s.setSearchQuery);
  const newConversation = useEconomicAgentStore((s) => s.newConversation);
  const selectConversation = useEconomicAgentStore((s) => s.selectConversation);

  const filtered = useMemo(
    () => filterConversations(conversations, searchQuery),
    [conversations, searchQuery],
  );
  const groups = useMemo(() => groupConversationsByDate(filtered), [filtered]);

  return (
    <aside
      className={cn(
        "themed absolute flex h-full w-[240px] shrink-0 flex-col border-r border-line-muted bg-surface-2/60 lg:static lg:z-0",
        className,
      )}
    >
      {/* New conversation button */}
      <div className="shrink-0 p-2">
        <button
          type="button"
          onClick={() => {
            newConversation("economic");
            onSelect?.();
          }}
          className="flex w-full items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[12px] font-medium text-fg transition-colors hover:bg-hover"
        >
          <Plus className="h-3.5 w-3.5" />
          New conversation
        </button>
      </div>

      {/* Search */}
      <div className="shrink-0 px-2 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-fg-faint" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations"
            className="w-full rounded-md border border-line bg-surface py-1.5 pl-7 pr-2 text-[11px] text-fg placeholder:text-fg-faint focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>
      </div>

      {/* Conversation list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {groups.length === 0 ? (
          <div className="px-3 py-8 text-center text-[11px] text-fg-faint">
            {searchQuery ? "No matches found." : "No conversations yet."}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-2">
              <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-fg-faint">
                {group.label}
              </div>
              {group.items.map((conv) => (
                <ConversationItem
                  key={conv.id}
                  conv={conv}
                  active={conv.id === activeId}
                  onClick={() => {
                    selectConversation(conv.id);
                    onSelect?.();
                  }}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

function ConversationItem({
  conv,
  active,
  onClick,
}: {
  conv: Conversation;
  active: boolean;
  onClick: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const togglePin = useEconomicAgentStore((s) => s.togglePin);
  const toggleArchive = useEconomicAgentStore((s) => s.toggleArchive);
  const deleteConversation = useEconomicAgentStore((s) => s.deleteConversation);
  const renameConversation = useEconomicAgentStore((s) => s.renameConversation);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(conv.title);

  return (
    <div className="group relative">
      {renaming ? (
        <input
          autoFocus
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            renameConversation(conv.id, nameDraft);
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              renameConversation(conv.id, nameDraft);
              setRenaming(false);
            }
            if (e.key === "Escape") {
              setNameDraft(conv.title);
              setRenaming(false);
            }
          }}
          className="w-full rounded-md border border-[var(--accent)] bg-surface px-2 py-1.5 text-[11px] text-fg focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors",
            active ? "bg-active text-fg" : "text-fg-muted hover:bg-hover hover:text-fg",
          )}
        >
          {conv.pinned && <Pin className="h-2.5 w-2.5 shrink-0 text-[var(--accent)]" />}
          <span className="flex-1 truncate text-[11px]">{conv.title}</span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="shrink-0 rounded p-0.5 text-fg-faint opacity-0 hover:bg-hover hover:text-fg group-hover:opacity-100"
          >
            <MoreHorizontal className="h-3 w-3" />
          </span>
        </button>
      )}

      {/* Context menu */}
      {menuOpen && (
        <ConversationMenu
          conv={conv}
          onClose={() => setMenuOpen(false)}
          onRename={() => {
            setNameDraft(conv.title);
            setRenaming(true);
            setMenuOpen(false);
          }}
          onPin={() => {
            togglePin(conv.id);
            setMenuOpen(false);
          }}
          onArchive={() => {
            toggleArchive(conv.id);
            setMenuOpen(false);
          }}
          onDelete={() => {
            deleteConversation(conv.id);
            setMenuOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ConversationMenu({
  conv,
  onClose,
  onRename,
  onPin,
  onArchive,
  onDelete,
}: {
  conv: Conversation;
  onClose: () => void;
  onRename: () => void;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const id = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-7 z-30 w-40 overflow-hidden rounded-md border border-line bg-overlay shadow-pop"
    >
      <MenuItem icon={Edit3} label="Rename" onClick={onRename} />
      <MenuItem icon={Pin} label={conv.pinned ? "Unpin" : "Pin"} onClick={onPin} />
      <MenuItem icon={Archive} label={conv.archived ? "Unarchive" : "Archive"} onClick={onArchive} />
      <div className="my-0.5 border-t border-line-muted" />
      <MenuItem icon={Trash2} label="Delete" onClick={onDelete} danger />
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: typeof Edit3;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors",
        danger
          ? "text-[#f23645] hover:bg-[#f23645]/10"
          : "text-fg-muted hover:bg-hover hover:text-fg",
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Welcome view (no active conversation)                              */
/* ────────────────────────────────────────────────────────────────── */

function WelcomeView() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Title */}
        <div className="mb-6 text-center">
          <div className="mb-3 flex items-center justify-center gap-2">
            <Bot className="h-6 w-6 text-[var(--accent)]" />
            <h1 className="text-[20px] font-semibold tracking-tight text-fg">
              Lilthe
            </h1>
          </div>
          <p className="text-[13px] text-fg-muted">
            Ask anything, research something, or add context.
          </p>
        </div>

        {/* Composer */}
        <AgentComposer mode="welcome" />
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Conversation view (active conversation)                           */
/* ────────────────────────────────────────────────────────────────── */

function ConversationView({ conversation }: { conversation: Conversation }) {
  const orbVisible=useLilithStore(s=>s.settings.visible);
  const orbSize=useLilithStore(s=>s.settings.size);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messages = conversation.messages;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  return (
    <>
      {/* Conversation header */}
      <ConversationHeader conv={conversation} />

      {/* Messages */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl px-4 py-4">
          {messages.map((m, index) => (
            <MessageRow
              key={m.id}
              message={m}
              onRegenerate={m.role === "assistant" && index === messages.length - 1
                ? () => window.dispatchEvent(new Event("lilith:regenerate-economic"))
                : undefined}
            />
          ))}
        </div>
      </div>

      {/* Bottom composer */}
      <div className="shrink-0 border-t border-line-muted p-3" style={{paddingRight:orbVisible?getSizePx(orbSize)+48:12}}>
        <div className="mx-auto max-w-3xl">
          <AgentComposer mode="conversation" />
        </div>
      </div>
    </>
  );
}

function ConversationHeader({ conv }: { conv: Conversation }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const togglePin = useEconomicAgentStore((s) => s.togglePin);
  const toggleArchive = useEconomicAgentStore((s) => s.toggleArchive);
  const deleteConversation = useEconomicAgentStore((s) => s.deleteConversation);
  const renameConversation = useEconomicAgentStore((s) => s.renameConversation);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(conv.title);

  return (
    <div className="themed relative flex h-10 shrink-0 items-center justify-between border-b border-line-muted px-4">
      <div className="flex items-center gap-2">
        {renaming ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              renameConversation(conv.id, nameDraft);
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                renameConversation(conv.id, nameDraft);
                setRenaming(false);
              }
              if (e.key === "Escape") {
                setNameDraft(conv.title);
                setRenaming(false);
              }
            }}
            className="rounded border border-[var(--accent)] bg-surface px-2 py-0.5 text-[13px] font-medium text-fg focus:outline-none"
          />
        ) : (
          <span className="truncate text-[13px] font-medium text-fg">
            {conv.title}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {/* Phase 6: old ModelSelector removed — replaced by ProviderModelSelector
            in the composer which actually affects the API request. */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex h-6 w-6 items-center justify-center rounded text-fg-faint hover:bg-hover hover:text-fg"
            aria-label="Conversation menu"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <ConversationMenu
              conv={conv}
              onClose={() => setMenuOpen(false)}
              onRename={() => {
                setNameDraft(conv.title);
                setRenaming(true);
                setMenuOpen(false);
              }}
              onPin={() => {
                togglePin(conv.id);
                setMenuOpen(false);
              }}
              onArchive={() => {
                toggleArchive(conv.id);
                setMenuOpen(false);
              }}
              onDelete={() => {
                deleteConversation(conv.id);
                setMenuOpen(false);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Message rendering                                                 */
/* ────────────────────────────────────────────────────────────────── */

function MessageRow({ message, onRegenerate }: { message: AgentMessage; onRegenerate?: () => void }) {
  const isUser = message.role === "user";
  return isUser ? <UserMessage message={message} /> : <AgentMessageView message={message} onRegenerate={onRegenerate} />;
}

function UserMessage({ message }: { message: AgentMessage }) {
  return <LilithMessage message={message} assistantName="Lilthe" />;
}

function AgentMessageView({ message, onRegenerate }: { message: AgentMessage; onRegenerate?: () => void }) {
  return <LilithMessage message={message} assistantName="Lilthe" onRegenerate={onRegenerate} />;
}

/** Lightweight markdown renderer — handles headings, lists, code blocks,
    bold, and basic formatting without adding a markdown dependency. */
function MarkdownContent({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre
            key={`code-${i}`}
            className="my-2 overflow-auto rounded-md border border-line-muted bg-surface-2 p-2 font-mono text-[11px] text-fg"
          >
            <code>{codeLines.join("\n")}</code>
          </pre>,
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Headings
    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={`h3-${i}`} className="mt-3 mb-1 text-[14px] font-semibold text-fg">
          {line.slice(4)}
        </h3>,
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h2 key={`h2-${i}`} className="mt-3 mb-1 text-[15px] font-semibold text-fg">
          {line.slice(3)}
        </h2>,
      );
    } else if (line.startsWith("# ")) {
      elements.push(
        <h1 key={`h1-${i}`} className="mt-3 mb-1 text-[16px] font-bold text-fg">
          {line.slice(2)}
        </h1>,
      );
    } else if (/^\d+\.\s/.test(line)) {
      // Numbered list
      elements.push(
        <div key={`ol-${i}`} className="ml-4 text-[13px] text-fg">
          {renderInline(line)}
        </div>,
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={`ul-${i}`} className="ml-4 flex gap-1.5 text-[13px] text-fg">
          <span className="text-fg-faint">•</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>,
      );
    } else if (line.trim() === "") {
      elements.push(<div key={`br-${i}`} className="h-2" />);
    } else {
      elements.push(
        <p key={`p-${i}`} className="text-[13px] text-fg">
          {renderInline(line)}
        </p>,
      );
    }
  }

  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      <pre
        key="code-final"
        className="my-2 overflow-auto rounded-md border border-line-muted bg-surface-2 p-2 font-mono text-[11px] text-fg"
      >
        <code>{codeLines.join("\n")}</code>
      </pre>,
    );
  }

  return <>{elements}</>;
}

/** Render inline markdown: **bold**, `code`, [link](url). */
function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold **text**
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    // Code `text`
    const codeMatch = remaining.match(/`(.+?)`/);
    // Link [text](url)
    const linkMatch = remaining.match(/\[(.+?)\]\((.+?)\)/);

    const matches = [
      boldMatch ? { type: "bold" as const, match: boldMatch, index: boldMatch.index! } : null,
      codeMatch ? { type: "code" as const, match: codeMatch, index: codeMatch.index! } : null,
      linkMatch ? { type: "link" as const, match: linkMatch, index: linkMatch.index! } : null,
    ].filter(Boolean) as { type: "bold" | "code" | "link"; match: RegExpMatchArray; index: number }[];

    if (matches.length === 0) {
      parts.push(remaining);
      break;
    }

    matches.sort((a, b) => a.index - b.index);
    const first = matches[0];

    if (first.index > 0) {
      parts.push(remaining.slice(0, first.index));
    }

    if (first.type === "bold") {
      parts.push(
        <strong key={key++} className="font-semibold text-fg">
          {first.match[1]}
        </strong>,
      );
    } else if (first.type === "code") {
      parts.push(
        <code
          key={key++}
          className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px] text-fg"
        >
          {first.match[1]}
        </code>,
      );
    } else if (first.type === "link") {
      parts.push(
        <a
          key={key++}
          href={first.match[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent)] underline hover:opacity-80"
        >
          {first.match[1]}
        </a>,
      );
    }

    remaining = remaining.slice(first.index + first.match[0].length);
  }

  return parts;
}

// Kept as a compatibility renderer for older persisted content while all
// active chat surfaces now use the canonical LilithMessage component.
void MarkdownContent;

/* ────────────────────────────────────────────────────────────────── */
/* Composer                                                          */
/* ────────────────────────────────────────────────────────────────── */

function AgentComposer({ mode }: { mode: "welcome" | "conversation" }) {
  const draftText = useEconomicAgentStore((s) => s.draftText);
  const setDraftText = useEconomicAgentStore((s) => s.setDraftText);
  const busy = useEconomicAgentStore((s) => s.busy);
  const setBusy = useEconomicAgentStore((s) => s.setBusy);
  const error = useEconomicAgentStore((s) => s.error);
  const setError = useEconomicAgentStore((s) => s.setError);
  const activeId = useEconomicAgentStore((s) => s.activeId);
  const conversations = useEconomicAgentStore((s) => s.conversations);
  const newConversation = useEconomicAgentStore((s) => s.newConversation);
  const addMessage = useEconomicAgentStore((s) => s.addMessage);
  const updateMessage = useEconomicAgentStore((s) => s.updateMessage);
  const removeMessage = useEconomicAgentStore((s) => s.removeMessage);
  const contextItems = useEconomicAgentStore((s) => s.contextItems);
  const clearContext = useEconomicAgentStore((s) => s.clearContext);
  const connectionProvider = useEconomicAgentConnection((s) => s.provider);
  const connectionModel = useEconomicAgentConnection((s) => s.model);
  const abortRef = useRef<AbortController | null>(null);

  // Phase 6: the core send function. Now sends full conversation history
  // (bounded to the last 20 messages) so the model can understand references
  // like "continue" or "what about the second option?".
  const handleSend = useCallback(async (attachments: LilithChatAttachment[] = []) => {
    const text = draftText.trim();
    if ((!text && attachments.length === 0) || busy) return;

    setBusy(true);
    let previews: Awaited<ReturnType<typeof attachmentPreviews>>;
    let attachmentContext: Awaited<ReturnType<typeof attachmentsToContext>>;
    try { previews = await attachmentPreviews(attachments); attachmentContext = await attachmentsToContext(attachments); }
    catch (error) { setBusy(false); setError({type:"attachment-failed",message:error instanceof Error ? error.message : "Unable to prepare attachments. Please reattach them."}); return false; }

    // Ensure we have a conversation.
    let convId = activeId;
    if (!convId) {
      convId = newConversation("economic");
    }

    // Phase 6: clear any previous error state.
    setError(null);
    setDraftText("");
    setBusy(true);

    // Add user message.
    const visibleUserText = `${text || "Please review the attached files."}${attachmentLabel(attachments)}`;
    addMessage(convId, { role: "user", content: visibleUserText, fromModel: false, status: "complete", capability: "economic", attachments: previews });
    const streamingId = addMessage(convId, {
      role: "assistant",
      content: "",
      fromModel: true,
      status: "streaming",
      capability: "economic",
    });

    // Phase 6: build the conversation history to send.
    // Take the current conversation's messages + the new user message,
    // bounded to the last 20 messages to stay within provider context limits.
    const conv = useEconomicAgentStore.getState().conversations.find((c) => c.id === convId);
    const windowed = conversationWindow(conv);
    const historyWindow = windowed.messages;

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const result = await streamChatResponse({
        signal: controller.signal,
        onDelta: (_delta, accumulated) => updateMessage(convId!, streamingId, { content: accumulated, status: "streaming" }),
        body: {
          messages: historyWindow,
          provider: connectionProvider,
          model: connectionModel,
          reasoningEffort: useSharedAIConfig.getState().reasoningEffort,
          // Phase 7: system prompt is now built client-side and passed to
          // the shared API route. Context items are also passed with
          // real data (rebuilt at send time by the context-provider layer).
          systemPrompt: [
            "You are Lilthe, the single continuous AI companion inside LUCIAN. You are currently using your economic and research capabilities.",
            "You can also help with trading, coding, markets, notes, chess, and personal conversation without becoming a different identity.",
            "When you don't know something, say so honestly. Never fabricate data, prices, or results.",
            "Format responses with markdown where helpful (headings, lists, tables, code blocks).",
          ].join("\n"),
          contextItems: [...(windowed.summaryContext ? [{ type: "conversation-summary", label: "Earlier conversation", description: "Rolling summary of older turns", data: windowed.summaryContext }] : []), ...contextItems.map((c) => ({
            type: c.type,
            label: c.label,
            description: c.description,
            data: c.data,
          })), ...attachmentContext],
          // Settings → AI Behavior: response style + context level +
          // remember conversations. The server enforces these. The
          // allowProjectContext flag is irrelevant for the Economic Agent
          // (it has no project context) but is sent for consistency.
          behavior: readAIBehaviorWire(),
        },
      });
      updateMessage(convId, streamingId, { content: result.content, status: "complete" });
      clearContext();
    } catch (requestError) {
      if (isAbortError(requestError)) {
        const partial = useEconomicAgentStore.getState().conversations
          .find((conversation) => conversation.id === convId)
          ?.messages.find((message) => message.id === streamingId)?.content;
        if (partial) updateMessage(convId, streamingId, { status: "complete" });
        else removeMessage(convId, streamingId);
        return;
      }
      removeMessage(convId, streamingId);
      // Network error — the fetch itself failed (provider unreachable,
      // DNS failure, CORS, etc.).
      setError({
        type: ((requestError as { errorType?: AgentError["type"] }).errorType ?? "network-error"),
        message: requestError instanceof Error ? requestError.message : "Could not reach the model provider. Check your network connection and try again.",
      });
      // Phase 10: notify on network errors too (deduped by provider + errorType).
      try {
        const { notifyAiProviderFailure } = await import("@/lib/notification-producers");
        notifyAiProviderFailure({
          provider: connectionProvider,
          errorType: "network-error",
          interface: "economic-agent",
        });
      } catch { /* non-fatal */ }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [
    draftText,
    busy,
    activeId,
    newConversation,
    addMessage,
    setDraftText,
    setBusy,
    setError,
    connectionProvider,
    connectionModel,
    contextItems,
    clearContext,
    updateMessage,
    removeMessage,
  ]);

  // Phase 6: retry the last failed request. Reuses the same user message
  // and context — does NOT duplicate the user message in history.
  const handleRetry = useCallback(async () => {
    if (busy || !activeId) return;

    const conv = useEconomicAgentStore.getState().conversations.find((c) => c.id === activeId);
    if (!conv || conv.messages.length === 0) return;

    // The last user message is the one to retry.
    const lastUserMsg = [...conv.messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;

    const lastMessage = conv.messages[conv.messages.length - 1];
    if (!error && lastMessage?.role === "assistant") {
      removeMessage(conv.id, lastMessage.id);
    }

    setError(null);
    setBusy(true);

    // Rebuild the history window from the conversation (excluding any
    // error placeholder — there shouldn't be one since errors are
    // transient state, not messages).
    const windowed = conversationWindow({ ...conv, messages: conv.messages
      .filter((message) => !(!error && message.id === lastMessage?.id))
    });
    const historyWindow = windowed.messages;

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: historyWindow,
          provider: connectionProvider,
          model: connectionModel,
          reasoningEffort: useSharedAIConfig.getState().reasoningEffort,
          systemPrompt: [
            "You are Lilthe, the single continuous AI companion inside LUCIAN. You are currently using your economic and research capabilities.",
            "You can also help with trading, coding, markets, notes, chess, and personal conversation without becoming a different identity.",
            "When you don't know something, say so honestly. Never fabricate data, prices, or results.",
            "Format responses with markdown where helpful (headings, lists, tables, code blocks).",
          ].join("\n"),
          contextItems: [...(windowed.summaryContext ? [{ type: "conversation-summary", label: "Earlier conversation", description: "Rolling summary of older turns", data: windowed.summaryContext }] : []), ...contextItems.map((c) => ({
            type: c.type,
            label: c.label,
            description: c.description,
            data: c.data,
          }))],
          behavior: readAIBehaviorWire(),
        }),
      });

      const data = (await res.json()) as {
        success: boolean;
        content: string;
        errorType?: string;
        message?: string;
      };

      if (data.success) {
        addMessage(conv.id, {
          role: "assistant",
          content: data.content,
          fromModel: true,
          capability: "economic",
        });
        clearContext();
      } else {
        setError({
          type: (data.errorType as AgentError["type"]) ?? "unknown",
          message: data.message ?? "An unknown error occurred.",
        });
      }
    } catch {
      setError({
        type: "network-error",
        message: "Could not reach the model provider. Check your network connection and try again.",
      });
    } finally {
      setBusy(false);
    }
  }, [busy, error, activeId, connectionProvider, connectionModel, contextItems, addMessage, clearContext, removeMessage, setBusy, setError]);

  useEffect(() => {
    const regenerate = () => { void handleRetry(); };
    window.addEventListener("lilith:regenerate-economic", regenerate);
    return () => window.removeEventListener("lilith:regenerate-economic", regenerate);
  }, [handleRetry]);

  return (
    <div className="overflow-hidden rounded-xl bg-surface shadow-sm">
      {error && <LilithErrorBanner message={error.message} onRetry={error.type === "attachment-failed" ? undefined : () => void handleRetry()} onDismiss={() => setError(null)} />}
      <LilithComposer
        value={draftText}
        onChange={setDraftText}
        onSend={handleSend}
        busy={busy}
        onStop={() => abortRef.current?.abort()}
        placeholder={mode === "welcome" ? "Ask Lilthe anything, research something, or add context…" : "Message Lilthe…"}
        contextCount={contextItems.length}
        footer={<><ContextSelector /><AddContextButton /><ProviderModelSelector /></>}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Dropdowns                                                         */
/* ────────────────────────────────────────────────────────────────── */

function ComposerDropdown({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: typeof Bot;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.("[data-composer-popover]")) setOpen(false);
    };
    const id = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`${label} options`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg"
      >
        <Icon className="h-3 w-3" />
        {label}
        <ChevronDown className="h-2.5 w-2.5" />
      </button>
      {open && (
        <ComposerPopover className="w-72" onClose={() => setOpen(false)}>
          {children}
        </ComposerPopover>
      )}
    </div>
  );
}

function ContextSelector() {
  const contextItems = useEconomicAgentStore((s) => s.contextItems);
  const removeContextItem = useEconomicAgentStore((s) => s.removeContextItem);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.("[data-composer-popover]")) setOpen(false);
    };
    const id = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [open]);

  const label = contextItems.length > 0
    ? `${contextItems.length} context${contextItems.length > 1 ? "s" : ""}`
    : "Context";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`${label} options`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg"
      >
        <Paperclip className="h-3 w-3" />
        {label}
        <ChevronDown className="h-2.5 w-2.5" />
      </button>
      {open && (
        <ComposerPopover className="w-72" onClose={() => setOpen(false)}>
          <div className="border-b border-line-muted px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
            Context
          </div>
          <div className="max-h-[200px] overflow-y-auto p-1">
            {contextItems.length === 0 ? (
              <div className="px-2 py-3 text-center text-[11px] text-fg-faint">
                No context attached
              </div>
            ) : (
              contextItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-[11px] text-fg hover:bg-hover"
                >
                  <ContextIcon type={item.type} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{item.label}</div>
                    {item.description && (
                      <div className="truncate text-[9px] text-fg-faint">
                        {item.description}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove context: ${item.label}`}
                    onClick={() => removeContextItem(item.id)}
                    className="text-fg-faint hover:text-[#f23645]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        </ComposerPopover>
      )}
    </div>
  );
}

function AddContextButton() {
  const addContextItem = useEconomicAgentStore((s) => s.addContextItem);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.("[data-composer-popover]")) setOpen(false);
    };
    const id = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [open]);

  // Phase 6: use real context sources from the context-provider layer.
  // Only sources that have actual data are shown — no fake "attached" labels.
  // The `open` dependency is intentional: it forces re-evaluation of
  // available context sources every time the menu opens so the user
  // sees fresh data.
  const sources = useMemo(() => {
    return getAvailableContextSources();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const iconForType = (type: ContextSource["type"]) => {
    switch (type) {
      case "market": return TrendingUp;
      case "investment": return LineChart;
      case "economy": return Building2;
      case "note": return StickyNote;
      default: return Paperclip;
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg"
        aria-label="Add context"
        title="Add context"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      {open && (
        <ComposerPopover className="w-72" onClose={() => setOpen(false)}>
          <div className="border-b border-line-muted px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
            Add Real Context
          </div>
          <div className="p-1">
            {sources.length === 0 ? (
              <div className="px-3 py-3 text-center text-[10px] text-fg-faint">
                No usable context available.
                <br />
                Open Markets, Investing, or Economy Hub to attach real data.
              </div>
            ) : (
              sources.map((src) => {
                const Icon = iconForType(src.type);
                return (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() => {
                      addContextItem({
                        type: src.type,
                        label: src.label,
                        description: src.description,
                        data: src.data ?? undefined,
                      });
                      setOpen(false);
                    }}
                    className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-[11px] text-fg-muted hover:bg-hover hover:text-fg"
                  >
                    <Icon className="mt-0.5 h-3 w-3 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{src.label}</div>
                      <div className="truncate text-[9px] text-fg-faint">{src.description}</div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </ComposerPopover>
      )}
    </div>
  );
}

/* Phase 6: Provider + Model selector — genuinely functional.
   The provider + model selected here are what the API request uses.
   Changing the provider auto-fills the default model for that provider.
   The model input is a text field so the user can enter any model id
   supported by their provider. */
function ProviderModelSelector() { return <ModelSelector />; }

/* ────────────────────────────────────────────────────────────────── */
/* Helpers                                                           */
/* ────────────────────────────────────────────────────────────────── */

function ContextIcon({ type }: { type: ContextItem["type"] }) {
  const className = "h-3 w-3 text-fg-faint";
  switch (type) {
    case "file":
      return <FileText className={className} />;
    case "project":
      return <Folder className={className} />;
    case "research":
      return <MessageSquare className={className} />;
    case "note":
      return <StickyNote className={className} />;
    case "market":
      return <TrendingUp className={className} />;
    case "investment":
      return <LineChart className={className} />;
    case "vault":
      return <Wallet className={className} />;
    case "business":
      return <Building2 className={className} />;
    default:
      return <Paperclip className={className} />;
  }
}

/* ── Phase 8: Economic Agent handoff receiver ──
 * Reads ?handoff=<id> from the URL, consumes the handoff,
 * attaches context to the current conversation, and optionally sets the draft prompt.
 * Runs once on mount — does NOT duplicate on re-render. */
function EconomicAgentHandoffReceiver() {
  const searchParams = useSearchParams();
  const addContextItem = useEconomicAgentStore((s) => s.addContextItem);
  const setDraftText = useEconomicAgentStore((s) => s.setDraftText);
  const draftText = useEconomicAgentStore((s) => s.draftText);
  const consumedRef = useRef(false);

  useEffect(() => {
    if (consumedRef.current) return;
    const handoffId = searchParams.get("handoff");
    if (!handoffId) return;

    const { consumeHandoff } = require("@/lib/cross-module-bridge");
    const handoff = consumeHandoff(handoffId);
    if (!handoff) return;

    consumedRef.current = true;

    // Attach dynamic context refs as context items.
    for (const ref of handoff.contextRefs) {
      addContextItem({
        type: ref.entityType === "opportunity" ? "economy" : ref.entityType === "investment" ? "investment" : ref.entityType === "market-symbol" ? "market" : "business",
        label: ref.entityId,
        description: `Dynamic reference from ${ref.module}`,
        // Note: the data field is intentionally left empty here — it will
        // be resolved at send time by the context resolver.
      });
    }

    // Attach static context.
    for (const ctx of handoff.staticContext) {
      addContextItem({
        type: ctx.module === "economy-hub" ? "economy" : ctx.module === "investing" ? "investment" : ctx.module === "chess-academy" ? "market" : "business",
        label: ctx.label,
        description: `Static content from ${ctx.module}`,
        data: ctx.content,
      });
    }

    // Set the draft prompt if provided.
    if (handoff.prompt && !draftText) {
      setDraftText(handoff.prompt);
    }
  }, [searchParams, addContextItem, setDraftText, draftText]);

  return null;
}

/* ── Phase 9: Economic Agent deep-link receiver ──
 * Reads ?conversation=<id> from the URL, validates the conversation
 * exists in the store, selects it as active, and strips the param.
 *
 * Uses `selectConversation` from the store, which atomically sets
 * activeId + clears contextItems + error + busy. This is the same action
 * the sidebar uses when the user clicks a conversation.
 *
 * Runs once per unique conversation id (guarded by consumedRef). */
function EconomicAgentDeepLinkReceiver() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const consumedRef = useRef<string | null>(null);

  useEffect(() => {
    const conversationId = searchParams.get("conversation");
    if (!conversationId) return;
    if (consumedRef.current === conversationId) return;
    consumedRef.current = conversationId;

    const exists = useEconomicAgentStore.getState().conversations.some((c) => c.id === conversationId);
    if (exists) {
      useEconomicAgentStore.getState().selectConversation(conversationId);
    }
    // Strip the param regardless of whether the conversation exists.
    const next = new URLSearchParams(searchParams.toString());
    next.delete("conversation");
    const qs = next.toString();
    router.replace(qs ? `/economic-agent?${qs}` : "/economic-agent");
  }, [searchParams, router]);

  return null;
}
