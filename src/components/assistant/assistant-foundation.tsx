"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Bot, Plus, Search } from "lucide-react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import type { assistantSnapshot } from "@/lib/assistant/service";
import { moduleForPath, ASSISTANT_MODULES } from "@/lib/assistant/contracts";

type Snapshot = Awaited<ReturnType<typeof assistantSnapshot>>;
interface Foundation {
  data: Snapshot | null;
  error: string | null;
  busy: boolean;
  draft: string;
  setDraft: (value: string) => void;
  refresh: () => Promise<void>;
  command: (body: Record<string, unknown>) => Promise<boolean>;
}
const Context = createContext<Foundation | null>(null);
async function request(body?: Record<string, unknown>) {
  const response = await fetch("/api/assistant", { method: body ? "POST" : "GET", cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error ?? "Assistant request failed.");
  return result;
}

export function AssistantFoundationProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  return <AssistantFoundationState key={session?.user?.id ?? "anonymous"}>{children}</AssistantFoundationState>;
}

function AssistantFoundationState({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const ownerId = session?.user?.id;
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const generation = useRef(0);
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    const current = generation.current;
    try {
      const result = await request();
      if (current === generation.current) { setData(result); setError(null); }
    } catch (error) {
      if (current === generation.current) setError((error as Error).message);
    }
  }, []);
  useEffect(() => {
    const current = ++generation.current;
    if (status !== "authenticated") return;
    let cancelled = false;
    request().then(result => {
      if (!cancelled && current === generation.current) { setData(result); setError(null); }
    }).catch(error => { if (!cancelled) setError((error as Error).message); });
    return () => { cancelled = true; };
  }, [status, ownerId]);
  const command = useCallback(async (body: Record<string, unknown>) => {
    if (inFlight.current || status !== "authenticated") return false;
    inFlight.current = true;
    setBusy(true);
    try { await request(body); await refresh(); return true; }
    catch (error) { setError((error as Error).message); return false; }
    finally { setBusy(false); inFlight.current = false; }
  }, [refresh, status]);

  // Never expose another sign-in's in-memory transcript while auth resolves.
  const visible = status === "authenticated" ? data : null;
  return <Context.Provider value={{ data: visible, error, busy, draft, setDraft, refresh, command }}>{children}</Context.Provider>;
}

function Conversation({ compact = false, dedicated = false }: { compact?: boolean; dedicated?: boolean }) {
  const foundation = useContext(Context);
  const pathname = usePathname();
  const [search, setSearch] = useState("");
  const retry = useRef<{ content: string; id: string; conversationId: string } | null>(null);
  if (!foundation) return null;
  const { data, error, busy, draft, setDraft, command, refresh } = foundation;
  const currentModule = moduleForPath(pathname);
  const newConversation = () => command({ action: "create", id: crypto.randomUUID(), title: `Conversation ${new Date().toLocaleString()}` });
  const saveMessage = async () => {
    if (!data?.conversation || !draft.trim()) return;
    const conversationId = data.conversation.id;
    if (!retry.current || retry.current.content !== draft || retry.current.conversationId !== conversationId) {
      retry.current = { content: draft, id: crypto.randomUUID(), conversationId };
    }
    const saved = await command({ action: "message", conversationId, requestId: retry.current.id, content: draft,
      context: { module: currentModule, recordId: null } });
    if (saved) { setDraft(""); retry.current = null; }
  };
  const history = data?.conversations.filter(c => c.title.toLowerCase().includes(search.toLowerCase())) ?? [];
  return <section aria-label="Lilthe conversation" className={dedicated ? "themed flex h-full min-h-0 flex-col bg-canvas text-fg md:flex-row" : "themed space-y-3 rounded-xl border border-line bg-surface p-4 text-fg"}>
    {dedicated && <aside aria-label="Conversation history" className="flex max-h-56 shrink-0 flex-col gap-3 border-b border-line-muted bg-surface-2/60 p-3 md:max-h-none md:w-64 md:border-b-0 md:border-r">
      <button type="button" disabled={busy || !data} onClick={() => void newConversation()} className="focus-ring flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-3 text-sm font-semibold"><Plus size={16} />New conversation</button>
      <label className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2"><Search size={16} className="shrink-0 text-fg-muted" /><input aria-label="Search conversations" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search conversations" className="min-w-0 w-full bg-transparent text-sm outline-none" /></label>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        <p className="px-2 py-2 text-xs uppercase text-fg-faint">Conversations</p>
        {history.map(c => <button key={c.id} type="button" disabled={busy} aria-current={c.id === data?.conversation?.id ? "true" : undefined} onClick={() => void command({ action: "activate", conversationId: c.id })} className={`focus-ring block w-full truncate rounded-md px-3 py-2 text-left text-sm ${c.id === data?.conversation?.id ? "bg-active text-fg" : "text-fg-muted hover:bg-hover"}`}>{c.title}</button>)}
        {data && !history.length && <p className="px-2 text-sm text-fg-muted">{search ? "No matching conversations." : "No conversations yet."}</p>}
      </div>
    </aside>}
    <div className={dedicated ? "flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4 md:p-8" : "space-y-3"}>
    {!dedicated && <>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold">Lilthe</h2>
      <button type="button" disabled={busy || !data} onClick={() => void newConversation()} className="focus-ring rounded-md border border-line px-3 py-1 text-sm">New conversation</button>
    </div>
    </>}
    <p className="text-xs text-fg-muted">Context: {ASSISTANT_MODULES.find(m => m.id === currentModule)?.label} · Model not connected</p>
    <p className="text-sm text-fg-muted">Foundation preview: model replies, attachments and voice are not connected yet.</p>
    {error && <div role="alert" className="text-sm">{error} <button type="button" onClick={() => void refresh()} className="underline">Retry connection</button></div>}
    {!data && !error && <p role="status" className="text-sm text-fg-muted">Loading saved conversations…</p>}
    {data && <>
      {!dedicated && <label className="block text-xs text-fg-muted">Conversation history
        <select aria-label="Conversation history" disabled={busy || !data.conversations.length} value={data.conversation?.id ?? ""}
          onChange={event => void command({ action: "activate", conversationId: event.target.value })}
          className="mt-1 w-full rounded-md border border-line bg-surface p-2 text-fg">
          {!data.conversations.length && <option value="">Create your first conversation</option>}
          {data.conversations.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </label>}
      <div className={dedicated ? "min-h-0 flex-1 space-y-3 overflow-y-auto" : `space-y-3 overflow-y-auto ${compact ? "max-h-48" : "max-h-80"}`} aria-label="Saved messages">
        {data.messages.map(message => <article key={message.id} className="rounded-lg bg-surface-2 p-3">
          <p className="mb-1 text-xs text-fg-muted">You · {message.module}</p>
          <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
        </article>)}
        {!data.messages.length && (dedicated ? <div className="flex min-h-48 h-full flex-col items-center justify-center gap-3 text-center"><h1 className="flex items-center gap-3 text-2xl font-semibold"><Bot className="text-accent" />Lilthe</h1><p className="text-fg-muted">Ask anything, research something, or add context.</p><p className="max-w-md text-sm text-fg-faint">Connect a model to receive replies. Your conversation and app context stay with Lilthe.</p></div> : <p className="text-sm text-fg-muted">No messages saved yet.</p>)}
      </div>
      <label className="block text-xs text-fg-muted">Message
        <textarea aria-label="Message Lilthe" maxLength={16000} rows={2} value={draft} onChange={event => setDraft(event.target.value)}
          disabled={busy || !data.conversation} placeholder="Write a message to save for Lilthe…"
          className="mt-1 w-full resize-y rounded-lg border border-line bg-inset p-3 text-sm text-fg" />
      </label>
      <button type="button" disabled={busy || !data.conversation || !draft.trim()} onClick={() => void saveMessage()}
        className="focus-ring rounded-md bg-accent px-4 py-2 text-sm text-accent-fg">{busy ? "Saving…" : "Save message"}</button>
    </>}
  </div></section>;
}

export function AssistantMainWorkspace() {
  return <div className="h-full min-h-[32rem]"><Conversation dedicated /></div>;
}
export function AssistantModuleFoundation() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  if (pathname === "/economic-agent") return null;
  return <div className="themed relative shrink-0 border-t border-line bg-surface-2 px-4 py-2">
    {open && <div className="absolute bottom-full right-2 z-40 mb-2 max-h-[70dvh] w-[min(32rem,calc(100vw-1rem))] overflow-y-auto shadow-pop"><Conversation compact /></div>}
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}
      className="focus-ring ml-auto block w-full rounded-full border border-line bg-inset px-4 py-2 text-left text-sm text-fg-muted sm:max-w-lg">
      {open ? "Collapse Lilthe conversation" : "Open Lilthe · model not connected"}
    </button>
  </div>;
}
