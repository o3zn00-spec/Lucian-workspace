"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useSharedAIConfig } from "@/store/shared-ai-config";
import type { LiveReviewSession } from "@/lib/assistant/live-review-policy";
import { startVisiblePolling } from "@/lib/visible-polling";
type Snapshot = Omit<LiveReviewSession, "lease" | "generation">;
export function LiveReviewControls() {
  const [open, setOpen] = useState(false), [s, setSession] = useState<Snapshot | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [symbols, setSymbols] = useState("BTCUSDT, ETHUSDT"), [strategy, setStrategy] = useState("Review closed-candle trends, fees and independent context. Hold when evidence conflicts or an order needs reconciliation. Explain uncertainties and whether owner review is warranted.");
  const [minutes, setMinutes] = useState(15), [hours, setHours] = useState(4), [budget, setBudget] = useState(16);
  const version = useRef(0), reading = useRef(false), acting = useRef(false);
  const provider = useSharedAIConfig(state => state.overrides["economic-agent"]?.provider ?? state.globalProvider);
  const model = useSharedAIConfig(state => state.overrides["economic-agent"]?.model ?? state.globalModel);
  const effort = useSharedAIConfig(state => state.reasoningEffort);
  const refresh = useCallback(async (signal?: AbortSignal, afterAction = false) => {
    if (reading.current || acting.current && !afterAction) return;
    reading.current = true; const current = ++version.current;
    try {
      const r = await fetch("/api/assistant/live-review", { cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
      const data = await r.json(); if (!r.ok || !data.ok) throw Error(data.error ?? "Live research unavailable.");
      if (current === version.current && !signal?.aborted) { setSession(data.session); setLoaded(true); setError(null); }
      return true;
    } catch { if (current === version.current && !signal?.aborted) setError("Status could not refresh. Retry below; the last loaded session is retained."); return false; }
    finally { reading.current = false; }
  }, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const stop = startVisiblePolling(async () => { if (await refresh(controller.signal) === false) throw Error("Research status unavailable"); }, 60_000);
    return () => { controller.abort(); stop(); };
  }, [open, refresh]);
  const action = async (action: string) => {
    if (acting.current || !loaded) return;
    acting.current = true; ++version.current; setBusy(true); setError(null);
    try {
      const body = action === "start" ? { action, provider, model, effort, plan: { symbols: symbols.split(",").map(v => v.trim().toUpperCase()), strategy, reviewMinutes: minutes, durationHours: hours, maxReviews: budget } } : { action, id: s?.id, revision: s?.revision };
      const r = await fetch("/api/assistant/live-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
      const data = await r.json(); if (!r.ok || !data.ok) throw Error(data.error ?? "Control failed. Refresh its status before retrying.");
      setSession(data.session);
    } catch (e) { await refresh(undefined, true); setError((e as Error).message); }
    finally { acting.current = false; setBusy(false); }
  };
  const button = "focus-ring rounded-lg border border-line px-3 py-2 disabled:opacity-50";
  const input = "mt-1 block w-full rounded-lg border border-line bg-surface-2 p-2";
  return <Dialog.Root open={open} onOpenChange={value => { setOpen(value); setLoaded(false); setError(null); }}>
    <Dialog.Trigger asChild><button type="button" className={button}>Live research</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[180] bg-black/50" />
      <Dialog.Content className="themed fixed left-1/2 top-1/2 z-[181] max-h-[90dvh] w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-line bg-surface p-5 text-sm text-fg shadow-pop">
        <Dialog.Title className="text-lg font-semibold">Lilthe live research</Dialog.Title>
        <Dialog.Description className="mt-2 text-fg-muted">Research and read-only exchange checks continue with this page closed. This does not enable automatic trading, place orders or manage exits. Real submissions stay in the owner-confirmed order panel.</Dialog.Description>
        <Dialog.Close asChild><button type="button" aria-label="Close live research" className="focus-ring absolute right-3 top-3 rounded p-1"><X size={18} /></button></Dialog.Close>
        {error && <p role="alert" className="mt-3">{error}</p>}
        {!loaded && <p role="status" className="mt-3">Load the latest session before using its controls.</p>}
        {s && <div className="mt-4 space-y-3">
          <p role="status">Status: <strong>{s.status}</strong> · Model calls: {s.reviewsUsed}/{s.plan.maxReviews} · Automatic execution: off</p>
          <p>Last exchange/research check: {s.heartbeatMs ? new Date(s.heartbeatMs).toLocaleString() : "not yet"}. Ends {new Date(s.deadlineMs).toLocaleString()}.</p>
          <p className="text-fg-muted">{s.plan.symbols.join(", ")} · every {s.plan.reviewMinutes} minutes · {s.model} ({s.effort}). Frozen rules: {s.plan.strategy}</p>
          {s.error && <p role="alert">{s.error}</p>}
          {s.status !== "stopped" && <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !loaded} onClick={() => void action(s.status === "paused" ? "resume" : "pause")} className={button}>{s.status === "paused" ? "Resume research" : "Pause research"}</button>
            <button type="button" disabled={busy || !loaded} onClick={() => void action("recover")} className={button}>Recover research worker</button>
            <button type="button" disabled={busy || !loaded} onClick={() => void action("stop")} className={button}>Stop research</button>
          </div>}
          <p className="text-fg-muted">Pause/stop affect research only; they never cancel or close an exchange order. Recovery preserves the deadline, call budget and history.</p>
          <ol className="space-y-3">{[...s.reviews].reverse().map((review, i) => <li key={i} className="rounded-lg bg-surface-2 p-3">
            <p>{new Date(review.atMs).toLocaleString()} · {review.stance === "hold" ? "Hold" : "Owner review suggested"} · model {review.modelStatus ?? "outcome not recorded"} · {review.reservations} unresolved · {review.completed} recent completed records</p>
            <p className="mt-1 whitespace-pre-wrap">{review.rationale}</p>
            <details className="mt-1"><summary className="cursor-pointer">Sources</summary>{review.sources.map(source => <a key={source} className="block break-all underline" href={source} target="_blank" rel="noreferrer">{source}</a>)}</details>
          </li>)}</ol>
        </div>}
        {(!s || s.status === "stopped") && <form className="mt-4 space-y-3" onSubmit={e => { e.preventDefault(); void action("start"); }}>
          <fieldset disabled={busy || !loaded} className="space-y-3">
            <label className="block">USDT Spot symbols (maximum two)<input required value={symbols} onChange={e => setSymbols(e.target.value)} className={input} /></label>
            <label className="block">Research strategy<textarea required maxLength={500} value={strategy} onChange={e => setStrategy(e.target.value)} className={input} /></label>
            <div className="grid gap-3 sm:grid-cols-3">
              <label>Review minutes<input required type="number" min={5} max={1440} value={minutes} onChange={e => setMinutes(Number(e.target.value))} className={input} /></label>
              <label>Duration hours<input required type="number" min={1} max={24} value={hours} onChange={e => setHours(Number(e.target.value))} className={input} /></label>
              <label>Maximum model calls<input required type="number" min={1} max={30} value={budget} onChange={e => setBudget(Number(e.target.value))} className={input} /></label>
            </div>
            <p className="text-fg-muted">Uses {provider} / {model} ({effort}) and your provider credits. Calls that fail after starting still consume the review budget. Builds do not start this worker.</p>
            <button type="submit" className={button}>Start background research</button>
          </fieldset>
        </form>}
        <button type="button" disabled={busy} className={button + " mt-4"} onClick={() => void refresh()}>Refresh live research</button>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
