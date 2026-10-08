"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import * as Dialog from "@radix-ui/react-dialog";
import { Activity, X } from "lucide-react";

type ToolState = { savedRead: boolean; tradingRead: boolean; activity: { id: string; tool: string; module: string; status: string; reason: string; createdAt: string }[] };
export function ToolActivity() {
  const { data: session } = useSession();
  return <ToolActivityState key={session?.user?.id ?? "anonymous"} />;
}
function ToolActivityState() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ToolState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useCallback(async (permission?: { savedRead: boolean } | { tradingRead: boolean }, signal?: AbortSignal) => {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/assistant/tools", { method: permission === undefined ? "GET" : "PUT", cache: "no-store", signal,
        headers: permission === undefined ? undefined : { "Content-Type": "application/json" },
        body: permission === undefined ? undefined : JSON.stringify(permission) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(result.error ?? "Tool access could not be confirmed.");
      if (!signal?.aborted) setData(result);
    } catch (error) { if (!signal?.aborted) setError((error as Error).message); }
    finally { if (!signal?.aborted) setBusy(false); }
  }, []);
  useEffect(() => () => controllerRef.current?.abort(), []);
  const changeOpen = (value: boolean) => {
    controllerRef.current?.abort();
    setOpen(value);
    if (value) {
      const controller = new AbortController();
      controllerRef.current = controller;
      void request(undefined, controller.signal);
    }
  };
  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger asChild><button type="button" aria-label="Tool activity and permissions" title="Tool activity and permissions" className="focus-ring inline-flex h-7 w-7 items-center justify-center rounded-lg text-fg-muted hover:bg-hover"><Activity size={14} /></button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[180] bg-black/50" />
      <Dialog.Content className="themed fixed left-1/2 top-1/2 z-[181] max-h-[85dvh] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-line bg-surface p-5 text-fg shadow-pop">
        <Dialog.Title className="text-lg font-semibold">Lilthe’s tools</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm text-fg-muted">Control record access and review what Lilthe’s tools actually did.</Dialog.Description>
        <Dialog.Close asChild><button type="button" aria-label="Close tool activity" className="focus-ring absolute right-3 top-3 rounded p-1"><X size={18} /></button></Dialog.Close>
        {error && <p role="alert" className="mt-3 text-sm">{error}</p>}
        {!data && busy && <p role="status" className="mt-3 text-sm">Loading tool permissions…</p>}
        {data && <>
          <div className="my-4 rounded-lg border border-line p-3">
            <label className="flex items-center justify-between gap-3 text-sm font-medium">Cloud-saved bookmark titles
              <input type="checkbox" checked={data.savedRead} disabled={busy || Boolean(error)} onChange={event => void request({ savedRead: event.target.checked })} />
            </label>
            <p className="mt-2 text-xs text-fg-muted">Allow reads of up to 12 saved bookmark/favorite titles and categories. This excludes local notes, holdings, files, credentials and live balances. Results enter your chat and may be sent to your selected model in later conversation turns. Turn off to stop future reads.</p>
          </div>
          <div className="my-4 rounded-lg border border-line p-3">
            <label className="flex items-center justify-between gap-3 text-sm font-medium">Bybit Unified account balances
              <input type="checkbox" checked={data.tradingRead} disabled={busy || Boolean(error)} onChange={event => void request({ tradingRead: event.target.checked })} />
            </label>
            <p className="mt-2 text-xs text-fg-muted">Allow a fresh read of Unified account totals and up to 12 asset balances from your configured Bybit environment. Funding wallets, orders and positions are excluded. This grants no permission to trade or move money. Balances enter chat and may be sent to your selected model in later turns. Turn off to stop future reads.</p>
          </div>
          <h3 className="mb-2 font-medium">Recent tool activity</h3>
          {!data.activity.length && <p className="text-sm text-fg-muted">No tool activity recorded.</p>}
          <ul className="space-y-2">{data.activity.map(event => <li key={event.id} className="rounded-lg bg-surface-2 p-3 text-xs">
            <div className="flex justify-between gap-2"><strong>{event.tool}</strong><span>{event.status}</span></div>
            <p className="mt-1 text-fg-muted">{event.reason}</p>
            <p className="mt-1 text-fg-faint">{event.module} · {new Date(event.createdAt).toLocaleString()}</p>
          </li>)}</ul>
        </>}
        <button type="button" disabled={busy} onClick={() => void request()} className="focus-ring mt-4 rounded border border-line px-3 py-2 text-sm">{busy ? "Loading…" : "Refresh activity"}</button>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
