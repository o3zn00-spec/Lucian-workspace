"use client";

import Link from "next/link";
import { ToolActivity } from "@/components/assistant/tool-activity";
import { isAssistantDestination } from "@/lib/assistant/contracts";

import {
  Bot,
  Check,
  Clipboard,
  Copy,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { AttachmentGallery, type AttachmentPreview } from "./attachment-gallery";
import { ModelSelector } from "./model-selector";
import { cn } from "@/lib/utils";

export type LilithChatRole = "user" | "assistant" | "tool";

export interface LilithChatMessage {
  id: string;
  role: LilithChatRole;
  content: string;
  timestamp?: number;
  fromModel?: boolean;
  attachments?: AttachmentPreview[];
  toolName?: string;
  status?: "complete" | "streaming" | "error";
}

export interface LilithChatAttachment {
  id: string;
  file: File;
  name: string;
  type: string;
  size: number;
  previewUrl?: string;
}

interface MessageProps {
  message: LilithChatMessage;
  assistantName?: string;
  compact?: boolean;
  onRetry?: () => void;
  onRegenerate?: () => void;
}

/**
 * Canonical message presentation for every Lilith surface. User messages are
 * always visible as right-aligned accent bubbles; Lilith and tool results use
 * the same left-aligned treatment everywhere in LUCIAN.
 */
export function LilithMessage({
  message,
  assistantName = "Lilthe",
  compact = false,
  onRetry,
  onRegenerate,
}: MessageProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  if (message.role === "tool") {
    return (
      <div className="group flex justify-start py-1.5" data-chat-role="tool">
        <details className="max-w-[92%] rounded-lg border border-line-muted bg-surface-2/55 px-3 py-2 text-[11px]">
          <summary className="cursor-pointer select-none font-medium text-fg-muted">
            Tool result{message.toolName ? ` · ${message.toolName}` : ""}
          </summary>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] text-fg-muted">
            {message.content}
          </pre>
        </details>
      </div>
    );
  }

  const isUser = message.role === "user";
  const time = message.timestamp
    ? new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div
      className={cn("group flex py-2", isUser ? "justify-end" : "justify-start")}
      data-chat-role={message.role}
    >
      <div className={cn("min-w-0", compact ? "max-w-[92%]" : "max-w-[84%]")}> 
        <div
          className={cn(
            "mb-1 flex items-center gap-1.5 text-[9px] uppercase tracking-[0.08em] text-fg-faint",
            isUser && "justify-end",
          )}
        >
          {!isUser && <Bot className="h-3.5 w-3.5 text-[var(--accent)]" />}
          <span>{isUser ? "You" : assistantName}</span>
          {time && <span aria-hidden="true">·</span>}
          {time && <time>{time}</time>}
          {!isUser && message.fromModel === false && (
            <span className="rounded bg-amber-500/15 px-1 py-0.5 text-[8px] font-bold text-amber-500">
              LOCAL
            </span>
          )}
        </div>

        <div
          className={cn(
            "relative rounded-xl border px-3 py-2.5 text-[13px] leading-relaxed shadow-sm",
            isUser
              ? "border-[color-mix(in_srgb,var(--accent)_42%,transparent)] bg-[color-mix(in_srgb,var(--accent)_18%,var(--surface))] text-fg"
              : message.status === "error"
                ? "border-red-500/35 bg-red-500/8 text-fg"
                : "border-line-muted bg-surface text-fg",
          )}
        >
          {isUser ? (
            <>
            {message.attachments?.length ? <AttachmentGallery items={message.attachments} /> : null}
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
            </>
          ) : (
            <LilithMarkdown content={message.content} />
          )}
          {message.status === "streaming" && (
            <span className="ml-1 inline-block h-3.5 w-0.5 animate-pulse bg-[var(--accent)] align-middle" />
          )}
        </div>

        <div
          className={cn(
            "mt-1 flex min-h-6 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
            isUser && "justify-end",
          )}
        >
          <MessageAction label={copied ? "Copied" : "Copy"} onClick={() => void copy()}>
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </MessageAction>
          {!isUser && onRegenerate && (
            <MessageAction label="Regenerate" onClick={onRegenerate}>
              <RefreshCw className="h-3 w-3" />
            </MessageAction>
          )}
          {message.status === "error" && onRetry && (
            <MessageAction label="Retry" onClick={onRetry}>
              <RotateCcw className="h-3 w-3" />
            </MessageAction>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="focus-ring inline-flex h-6 items-center gap-1 rounded px-1.5 text-[9px] text-fg-faint hover:bg-hover hover:text-fg"
    >
      {children}
      <span>{label}</span>
    </button>
  );
}

export function LilithActivity({ label = "Lilith is thinking" }: { label?: string }) {
  return (
    <div className="flex justify-start py-2" role="status" aria-live="polite">
      <div className="rounded-xl border border-line-muted bg-surface px-3 py-2.5">
        <div className="flex items-center gap-2 text-[11px] text-fg-muted">
          <Bot className="h-3.5 w-3.5 text-[var(--accent)]" />
          <span>{label}</span>
          <span className="flex gap-1" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1 w-1 animate-bounce rounded-full bg-[var(--accent)]"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

export function LilithErrorBanner({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="flex items-start gap-2 border-y border-red-500/25 bg-red-500/8 px-3 py-2 text-[11px] text-red-600 dark:text-red-300" role="alert">
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="focus-ring rounded px-1.5 py-0.5 font-medium hover:bg-red-500/10">
          Retry
        </button>
      )}
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss error" className="focus-ring rounded p-0.5 hover:bg-red-500/10">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export function LilithProviderStatus({
  configured,
  label,
  message,
}: {
  configured: boolean;
  label?: string;
  message?: string;
}) {
  if (configured) return null;
  return (
    <div className="border-y border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[10px] text-amber-700 dark:text-amber-300" role="status">
      <span className="font-semibold">Provider not connected.</span>{" "}
      {message ?? "Choose a provider and model in Settings → AI & Models."}
      {label ? ` Current selection: ${label}.` : ""}
    </div>
  );
}

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (attachments: LilithChatAttachment[]) => void | boolean | Promise<void | boolean>;
  busy?: boolean;
  disabled?: boolean;
  onStop?: () => void;
  placeholder?: string;
  modelLabel?: string;
  onModelClick?: () => void;
  contextCount?: number;
  onContextClick?: () => void;
  compact?: boolean;
  footer?: ReactNode;
  accept?: string;
}

/** Shared composer with working attachment selection and the same controls. */
export function LilithComposer({
  value,
  onChange,
  onSend,
  busy = false,
  disabled = false,
  onStop,
  placeholder = "Message Lilith…",
  onModelClick,
  contextCount = 0,
  onContextClick,
  compact = false,
  footer,
  accept = "image/*,.pdf,.txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.html,.css,.py",
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const urls = useRef<string[]>([]);
  useEffect(() => () => { urls.current.forEach(url => URL.revokeObjectURL(url)); }, []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<LilithChatAttachment[]>([]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, compact ? 120 : 200)}px`;
  }, [value, compact]);

  const chooseFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    setAttachments((current) => [
      ...current,
      ...files.map((file) => ({
        id: `attachment_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        file,
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        previewUrl: file.type.startsWith("image/") ? (() => { const url=URL.createObjectURL(file); urls.current.push(url); return url; })() : undefined,
      })),
    ].slice(0, 8));
    event.target.value = "";
  };

  const send = async () => {
    if (disabled || busy || (!value.trim() && attachments.length === 0)) return;
    const outgoing = attachments;
    const accepted = await onSend(outgoing);
    if (accepted !== false) setAttachments([]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <div className="bg-surface p-2.5">
      {attachments.length > 0 && <AttachmentGallery items={attachments.map(item => ({id:item.id,name:item.name,url:item.previewUrl}))} onRemove={id => setAttachments(current => current.filter(item => item.id !== id))} />}

      <div className="rounded-xl bg-inset">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={placeholder}
          className={cn(
            "block max-h-52 min-h-10 w-full resize-none border-0 bg-transparent px-3 py-2.5 text-[13px] text-fg placeholder:text-fg-faint focus:outline-none disabled:cursor-not-allowed disabled:opacity-60",
            compact && "text-xs",
          )}
        />

        <div className="flex items-center gap-1 border-t border-line-muted px-2 py-1.5">
          <input ref={fileRef} type="file" multiple accept={accept} onChange={chooseFiles} className="hidden" />
          <ComposerButton label="Attach files" onClick={() => fileRef.current?.click()} disabled={disabled || busy}>
            <Paperclip className="h-3.5 w-3.5" />
          </ComposerButton>
          {onContextClick && (
            <ComposerButton label="Add context" onClick={onContextClick} disabled={disabled || busy}>
              <Clipboard className="h-3.5 w-3.5" />
              {contextCount > 0 && <span className="text-[9px]">{contextCount}</span>}
            </ComposerButton>
          )}
          {onModelClick && <ModelSelector interfaceId="lilith" />}
          <div className="flex-1" />
          <ToolActivity />
          {footer}
          {busy && onStop ? (
            <button
              type="button"
              onClick={onStop}
              title="Stop response"
              aria-label="Stop response"
              className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-lg bg-fg text-canvas hover:opacity-85"
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void send()}
              disabled={disabled || busy || (!value.trim() && attachments.length === 0)}
              title="Send message"
              aria-label="Send message"
              className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--accent)] text-[var(--accent-foreground,#fff)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ComposerButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="focus-ring inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-fg-faint hover:bg-hover hover:text-fg disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** Lightweight, dependency-free Markdown renderer shared by every chat. */
export function LilithMarkdown({ content }: { content: string }) {
  const blocks = tokenizeBlocks(content);
  return (
    <div className="space-y-2 break-words">
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <pre key={index} className="overflow-auto rounded-md border border-line-muted bg-inset p-2.5 font-mono text-[11px] leading-relaxed text-fg">
              <code>{block.lines.join("\n")}</code>
            </pre>
          );
        }
        if (block.type === "table") {
          return (
            <div key={index} className="overflow-x-auto rounded-md border border-line-muted">
              <table className="w-full border-collapse text-left text-[11px]">
                <thead className="bg-surface-2">
                  <tr>{block.rows[0].map((cell, cellIndex) => <th key={cellIndex} className="border-b border-line-muted px-2 py-1.5 font-semibold">{renderInline(cell)}</th>)}</tr>
                </thead>
                <tbody>
                  {block.rows.slice(1).map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-b border-line-muted last:border-b-0">
                      {row.map((cell, cellIndex) => <td key={cellIndex} className="px-2 py-1.5 align-top">{renderInline(cell)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (block.type === "list") {
          const List = block.ordered ? "ol" : "ul";
          return <List key={index} className={cn("space-y-1 pl-5", block.ordered ? "list-decimal" : "list-disc")}>{block.lines.map((line, lineIndex) => <li key={lineIndex}>{renderInline(line)}</li>)}</List>;
        }
        if (block.type === "heading") {
          const Heading = block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4";
          return <Heading key={index} className={cn("font-semibold text-fg", block.level === 1 ? "text-base" : block.level === 2 ? "text-sm" : "text-[13px]")}>{renderInline(block.text)}</Heading>;
        }
        return <p key={index} className="whitespace-pre-wrap text-[13px] leading-relaxed">{renderInline(block.text)}</p>;
      })}
    </div>
  );
}

type MarkdownBlock =
  | { type: "code"; lines: string[] }
  | { type: "table"; rows: string[][] }
  | { type: "list"; ordered: boolean; lines: string[] }
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string };

function tokenizeBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    if (line.startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) code.push(lines[index++]);
      index += 1;
      blocks.push({ type: "code", lines: code });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      index += 1;
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])) {
      const rows = [splitTableRow(line)];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(splitTableRow(lines[index++]));
      blocks.push({ type: "table", rows });
      continue;
    }
    const unordered = /^\s*[-*]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const isOrdered = !!ordered;
      const items: string[] = [];
      while (index < lines.length) {
        const match = isOrdered ? /^\s*\d+\.\s+(.+)$/.exec(lines[index]) : /^\s*[-*]\s+(.+)$/.exec(lines[index]);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ type: "list", ordered: isOrdered, lines: items });
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s+/.test(lines[index]) && !lines[index].startsWith("```") && !/^\s*(?:[-*]|\d+\.)\s+/.test(lines[index])) {
      paragraph.push(lines[index++]);
    }
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("**")) nodes.push(<strong key={match.index} className="font-semibold">{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) nodes.push(<code key={match.index} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px]">{token.slice(1, -1)}</code>);
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link && isAssistantDestination(link[2])) nodes.push(<Link key={match.index} href={link[2]} className="text-[var(--accent)] underline underline-offset-2">{link[1]}</Link>);
      else if (link && /^(https?:\/\/|mailto:)/i.test(link[2])) nodes.push(<a key={match.index} href={link[2]} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] underline underline-offset-2">{link[1]}</a>);
      else nodes.push(token);
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
