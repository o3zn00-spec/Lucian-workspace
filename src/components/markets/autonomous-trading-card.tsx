"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Bot, CirclePause, Play, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useSharedAIConfig } from "@/store/shared-ai-config";
import { startVisiblePolling } from "@/lib/visible-polling";
import { validateAutonomousPlan, type AutonomousPlan } from "@/lib/bybit/autonomous-policy";
import type { AutonomousSession } from "@/lib/bybit/autonomous-session";
import { TradingPlanLibrary } from "./trading-plan-library";
import { AutonomousSessionAmendment } from "./autonomous-session-amendment";
import { AutonomousReportButton } from "./autonomous-report";

type Snapshot = Omit<AutonomousSession, "connection" | "credential" | "grant" | "generation" | "lease"> & { amendmentVersion?: string };
type Draft = { id: string; plan: AutonomousPlan; provider: string; model: string; effort: string; expiresAtMs: number; confirmation: string };
const defaults: AutonomousPlan = {
  mode: "bybit_live", symbols: ["BTCUSDT", "ETHUSDT"], capital: "10", maxOrder: "6", maxLoss: "1", maxRiskPerTrade: "1",
  maxTrades: 20, reviewMinutes: 5, durationHours: 24, maxModelCalls: 200, slippageBps: 50,
  strategy: "Research price action across closed candles, exchange news and independent market context. Choose entries and exits using your judgment, considering fees and slippage. Use a defined stop and target for each trade, manage the holding and look for another trade after it closes.",
};
const button = "focus-ring inline-flex items-center justify-center gap-2 rounded-xl border border-line px-3 py-2 text-sm disabled:opacity-50";
const input = "focus-ring mt-1 w-full rounded-lg border border-line bg-surface-2 p-2";
const moneyFields = [["capital", "Session capital (USDT)"], ["maxOrder", "Maximum order including costs (USDT)"], ["maxLoss", "Session loss limit (USDT)"], ["maxRiskPerTrade", "Maximum trade risk (USDT)"]] as const;
const countFields = [["maxTrades", "Maximum completed trades", 10000], ["durationHours", "Session duration (hours)", 168], ["reviewMinutes", "Research interval (minutes)", 1440], ["maxModelCalls", "Model-call budget", 10000], ["slippageBps", "Slippage allowance (basis points)", 500]] as const;

function PlanSummary({ plan }: { plan: AutonomousPlan }) {
  const fields = [
    ["Exchange", plan.mode === "bybit_live" ? "Bybit Live · real funds" : "Bybit Testnet"],
    ["Assets", plan.symbols.join(", ")],
    ...moneyFields.map(([key, label]) => [label.replace(" (USDT)", ""), `${plan[key]} USDT`]),
    ["Public web research", plan.webResearch ? "Enabled · 2 model calls per review plus search credits" : "Off · market data and feeds"],
    ["Trade limit", String(plan.maxTrades)], ["Model-call limit", String(plan.maxModelCalls)],
    ["Duration from original start", `${plan.durationHours} hours`], ["Research interval", `${plan.reviewMinutes} minutes`],
    ["Slippage allowance", `${plan.slippageBps} basis points`],
  ];
  return <div className="space-y-3"><dl className="grid gap-3 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="min-w-0 rounded-lg bg-surface-2 p-3"><dt className="text-xs text-fg-muted">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}</dl><p className="whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3"><strong className="mb-1 block">Trading instructions</strong>{plan.strategy}</p></div>;
}

export function AutonomousTradingCard() {
  const [s, setSession] = useState<Snapshot | null>(null), [open, setOpen] = useState(false), [plan, setPlan] = useState(defaults);
  const [draft, setDraft] = useState<Draft | null>(null), [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const acting = useRef(false), version = useRef(0), formVersion = useRef(0), readAbort = useRef<AbortController | null>(null);
  const provider = useSharedAIConfig(v => v.overrides["economic-agent"]?.provider ?? v.globalProvider);
  const model = useSharedAIConfig(v => v.overrides["economic-agent"]?.model ?? v.globalModel);
  const effort = useSharedAIConfig(v => v.reasoningEffort);
  const setOverride = useSharedAIConfig(v => v.setOverride), setEffort = useSharedAIConfig(v => v.setReasoningEffort);
  const refresh = useCallback(async (signal?: AbortSignal, force = false) => {
    if (acting.current && !force || readAbort.current && !force) return;
    readAbort.current?.abort();
    const controller = new AbortController(), requestVersion = ++version.current;
    readAbort.current = controller;
    try {
      const r = await fetch("/api/bybit/autonomous-session", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000), ...(signal ? [signal] : [])]) });
      const b = await r.json();
      if (!r.ok || !b.ok) throw Error(b.error ?? "Trading status unavailable.");
      if (requestVersion === version.current && !controller.signal.aborted && !signal?.aborted) {
        setSession(b.session); setLoaded(true); setError(null);
      }
    } catch (e) {
      if (!controller.signal.aborted && !signal?.aborted && requestVersion === version.current) setError(e instanceof Error ? e.message : "Status unavailable; last loaded session retained.");
    } finally { if (readAbort.current === controller) readAbort.current = null; }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const stop = startVisiblePolling(() => refresh(controller.signal), 60000);
    return () => { controller.abort(); readAbort.current?.abort(); stop(); };
  }, [refresh]);
  const clearAuthorization = () => { setDraft(null); setPassword(""); setConfirmation(""); };
  const edit = <K extends keyof AutonomousPlan>(key: K, value: AutonomousPlan[K]) => { ++formVersion.current; setPlan(p => ({ ...p, [key]: value })); clearAuthorization(); setNotice(null); };
  async function action(action: string) {
    if (acting.current || !loaded) return;
    acting.current = true; ++version.current; readAbort.current?.abort(); readAbort.current = null;
    setBusy(true); setError(null); setNotice(null);
    const reviewedFormVersion = formVersion.current;
    try {
      const body = action === "preview" ? { action, plan, provider, model, effort } : action === "start" ? { action, draftId: draft?.id, confirmation, password } : action === "renew_exit" ? { action, id: s?.id, revision: s?.revision, confirmation, password } : { action, id: s?.id, revision: s?.revision };
      const r = await fetch("/api/bybit/autonomous-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      const b = await r.json();
      if (!r.ok || !b.ok) throw Error(b.error ?? "Session action failed. Refresh its saved state before retrying.");
      if (action === "preview") {
        if (reviewedFormVersion !== formVersion.current) { clearAuthorization(); setNotice("The form changed while review was loading. Review the current rules again."); }
        else { setDraft(b.draft); setPassword(""); setConfirmation(""); }
      }
      else {
        setSession(b.session); clearAuthorization();
        setNotice(action === "start" ? "Session authorization saved. The worker status below shows whether trading is running." : "Session state updated. Review the saved status and exchange activity below.");
      }
    } catch (e) {
      clearAuthorization();
      await refresh(undefined, true);
      setError(e instanceof Error ? `${e.message} No automatic retry was sent. Review the saved status before another action.` : "Request outcome unavailable. No automatic retry was sent; refresh the saved status before another action.");
    } finally { acting.current = false; setBusy(false); }
  }
  async function reviewSavedPlan() {
    if (acting.current || !loaded || (s && (s.status !== "stopped" || s.active))) return;
    acting.current = true; setBusy(true); setError(null);
    const currentFormVersion = formVersion.current;
    try {
      const response = await fetch("/api/assistant/trading-plan", { cache: "no-store", signal: AbortSignal.timeout(20000) });
      const saved = await response.json();
      if (!response.ok || !saved.ok) throw Error(saved.error ?? "Saved plan unavailable.");
      if (!saved.complete) throw Error("Ask Lilthe to finish your plan in chat first. Your saved details are still there.");
      if (currentFormVersion !== formVersion.current) throw Error("The form changed while loading. Review the saved plan again.");
      const nextPlan = validateAutonomousPlan(saved.draft.rules);
      ++formVersion.current; setPlan(nextPlan); clearAuthorization();
      if (saved.draft.selection) {
        setOverride("economic-agent", { provider: saved.draft.selection.provider, model: saved.draft.selection.model });
        setEffort(saved.draft.selection.effort);
      }
      setNotice("Lilthe’s plan is loaded. Review the rules, then authorize the session."); setOpen(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Saved plan unavailable."); }
    finally { acting.current = false; setBusy(false); }
  }
  const changeOpen = (value: boolean) => { if (!busy) { setOpen(value); clearAuthorization(); } };
  const active = s && (s.status !== "stopped" || s.active);
  const selectionChanged = draft && (draft.provider !== provider || draft.model !== model || draft.effort !== effort);

  return <section aria-label="Autonomous trading" aria-busy={busy} className="themed m-3 max-h-[60dvh] shrink-0 overflow-y-auto rounded-2xl border border-line bg-surface p-4 text-fg shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3"><span className="rounded-full bg-accent/10 p-3"><Bot size={22} /></span><div><h2 className="font-semibold">Lilthe trading</h2><p className="text-sm text-fg-muted">Research · execute · protect · exit · repeat</p></div></div>
      <span className="rounded-full border border-line px-3 py-1 text-sm">{s ? s.status : loaded ? "Ready to set up" : "Loading session"}</span>
    </div>
    {error && <p role="alert" className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm">{error}</p>}
    {!active && <button id="lilthe-plan" type="button" className={`${button} mt-3`} disabled={busy || !loaded} onClick={() => void reviewSavedPlan()}>Review Lilthe’s saved plan</button>}
    {s?.status === "stopped" && !s.active && <p className="mt-3 text-sm">This session has ended. Would you like Lilthe to prepare another? Tell her in chat; a new session needs your review.</p>}
    {notice && <p role="status" className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">{notice}</p>}
    {s && <>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Session funds after settled trades", `${(s.cashCents / 100).toFixed(2)} USDT`], ["Realized result", `${(s.realizedCents / 100).toFixed(2)} USDT`], ["Completed trades", `${s.trades} / ${s.plan.maxTrades}`], ["Model calls", `${s.modelCalls} / ${s.plan.maxModelCalls}`]].map(([label, value]) => <div key={label} className="min-w-0 rounded-xl bg-surface-2 p-3"><p className="text-xs text-fg-muted">{label}</p><p className="mt-1 break-words font-semibold">{value}</p></div>)}</div>
      <p className="mt-3 break-words text-sm text-fg-muted">{s.plan.mode === "bybit_live" ? "Live · real funds" : "Testnet"} · {s.model} · {s.plan.symbols.join(", ")} · Entry permission ends {new Date(s.deadlineMs).toLocaleString()}</p>
      <p className="mt-1 text-xs text-fg-muted">Last worker check: {new Date(s.heartbeatMs).toLocaleString()} · Recovery supervisor: {s.supervisorRunId ? "configured" : "unavailable"} · Recoveries: {s.recoveryAttempts}</p>
      {s.status === "paused" && <p className="mt-2 text-sm">New entries are paused. Management of the current owned trade continues.</p>}
      {s.status === "closing" && <p className="mt-2 text-sm">Closing the owned trade and reconciling exchange results before ending.</p>}
      {s.error && <p role="alert" className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">{s.error}</p>}
      {s.active && <div className="mt-3 rounded-xl border border-line p-3 text-sm"><strong>{s.active.symbol} · {s.active.closing ? "Closing trade" : "Owned trade"}</strong><p>Quantity {s.active.quantity} · Stop {s.active.stopPrice} · Target {s.active.takeProfit}</p><p className="mt-1 text-fg-muted">{s.active.protection}</p></div>}
      <details className="mt-3 text-sm"><summary className="cursor-pointer">Recent decisions and exchange activity</summary><ul className="mt-2 space-y-2">{s.events.slice().reverse().map((event, i) => <li key={`${event.atMs}:${i}`} className="rounded-lg bg-surface-2 p-2"><span className="text-xs text-fg-muted">{new Date(event.atMs).toLocaleString()} · {event.action}</span><p className="break-words">{event.message}</p></li>)}</ul></details>
    </>}
    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy} onClick={() => void refresh()}><RefreshCw size={15} />Refresh</button>
      <AutonomousReportButton sessionId={s?.id} />
      {active ? <>
        <button type="button" className={button} disabled={busy || s.status === "closing" || s.status === "stopped"} onClick={() => void action(s.status === "paused" ? "resume" : "pause")}>{s.status === "paused" ? <Play size={15} /> : <CirclePause size={15} />}{s.status === "paused" ? "Resume entries" : "Pause new entries"}</button>
        <button type="button" className={button} disabled={busy} onClick={() => changeOpen(true)}>Session details</button>
        <button type="button" className={button} disabled={busy || s.status === "stopped"} onClick={() => void action("recover")}>Recover worker</button>
        <AutonomousSessionAmendment session={s} onUpdated={() => refresh(undefined, true)} disabled={busy} />
      </> : <button type="button" className={`${button} bg-accent text-white`} disabled={busy || !loaded} onClick={() => changeOpen(true)}><ShieldCheck size={15} />Set up autonomous session</button>}
    </div>
    <Dialog.Root open={open} onOpenChange={changeOpen}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[180] bg-black/60" /><Dialog.Content className="themed fixed left-1/2 top-1/2 z-[181] max-h-[90dvh] w-[min(52rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-surface p-5 text-fg shadow-pop">
      <Dialog.Title className="pr-8 text-xl font-semibold">Autonomous trading session</Dialog.Title>
      <Dialog.Description className="mt-2 text-sm text-fg-muted">Approve once for this session. Lilthe can research, place repeated Spot trades, cancel its own stops and close its own holdings while you are away. Native stops stay on Bybit; targets are monitored by the background worker. No leverage, transfers or withdrawals.</Dialog.Description>
      <Dialog.Close asChild><button type="button" aria-label="Close autonomous session" disabled={busy} className="absolute right-3 top-3 rounded-lg p-2"><X size={18} /></button></Dialog.Close>
      {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
      {active ? <div className="mt-4 space-y-4 text-sm">
        <PlanSummary plan={s.plan} />
        <p>Pause blocks new entries while managing the current trade. Close and end cancels the session stop, confirms its outcome, sells the remaining owned quantity and ends the session. At expiry the same closure process has a fixed 30-minute management window; unresolved holdings are reported and existing stops are retained.</p>
        {s.status === "stopped" && s.active ? <div className="space-y-3 rounded-xl border border-line p-3">
          <p>The original management window expired. Authorize 30 minutes to reconcile and close this existing owned trade. This does not permit new entries.</p>
          <label className="block">Type REAUTHORIZE EXIT MANAGEMENT {s.id.slice(0, 8)}<input autoComplete="off" className={input} value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} /></label>
          <label className="block">Current LUCIAN password<input type="password" autoComplete="current-password" className={input} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
          <button type="button" className={button} disabled={busy || !password || confirmation !== `REAUTHORIZE EXIT MANAGEMENT ${s.id.slice(0, 8)}`} onClick={() => void action("renew_exit")}>Authorize closure of remaining trade</button>
        </div> : <button type="button" className={`${button} border-red-500/40 text-red-400`} disabled={busy || s.status === "closing"} onClick={() => void action("close")}>Close owned trade and end session</button>}
      </div> : <div className="mt-4 space-y-4">
        <p className="text-sm text-fg-muted">These are draft rules. Nothing starts until you review and authorize the exact session below.</p>
        <TradingPlanLibrary plan={plan} selection={{ provider, model, effort }} disabled={busy} onLoad={(savedPlan, savedModel) => {
          if (acting.current) { setNotice("A saved plan finished loading during session review. Load it again after the current request finishes."); return false; }
          ++formVersion.current; setPlan(savedPlan); clearAuthorization();
          if (savedModel) { setOverride("economic-agent", { provider: savedModel.provider, model: savedModel.model }); setEffort(savedModel.effort); }
          setNotice("Saved draft loaded. Review the form and selected model before authorizing a session."); return true;
        }} />
        <fieldset disabled={busy} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Exchange mode<select className={input} value={plan.mode} onChange={e => edit("mode", e.target.value as AutonomousPlan["mode"])}><option value="bybit_live">Bybit Live · real funds</option><option value="bybit_testnet">Bybit Testnet</option></select></label>
            <label className="text-sm">Allowed symbols<input className={input} value={plan.symbols.join(", ")} onChange={e => edit("symbols", e.target.value.split(",").map(value => value.trim().toUpperCase()))} /></label>
            {moneyFields.map(([key, label]) => <label key={key} className="text-sm">{label}<input inputMode="decimal" className={input} value={plan[key]} onChange={e => edit(key, e.target.value)} /></label>)}
            {countFields.map(([key, label, max]) => <label key={key} className="text-sm">{label}<input type="number" min="1" max={max} step="1" className={input} value={plan[key]} onChange={e => edit(key, Number(e.target.value))} /></label>)}
          </div>
          <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={Boolean(plan.webResearch)} onChange={e => edit("webResearch", e.target.checked)} /><span>Include public web research<span className="mt-1 block text-xs text-fg-muted">Requires an OpenRouter model. Each review uses two calls from your model budget plus search credits. Failed searches skip the model decision; existing protective exits continue.</span></span></label>
          <label className="block text-sm">Your trading instructions<textarea rows={4} maxLength={3000} className={input} value={plan.strategy} onChange={e => edit("strategy", e.target.value)} /></label>
        </fieldset>
        <div className="rounded-xl bg-surface-2 p-3 text-sm">Selected model: {model} · {provider} · {effort}. Existing account risk limits also apply. One owned trade is managed at a time; it can trade again after that trade closes. Stops can slip; a loss limit is not a guaranteed execution price.</div>
        <button type="button" className={button} disabled={busy || !loaded} onClick={() => void action("preview")}>{busy ? "Checking…" : "Review session authorization"}</button>
        {draft && <div className="space-y-3 rounded-xl border border-line p-4 text-sm">
          <h3 className="font-semibold">Owner authorization · {draft.model}</h3>
          <PlanSummary plan={draft.plan} />
          <p>Authorization includes entries, native stop creation/cancellation, managed targets and exits for session-owned inventory. Entry permission ends at the session deadline; closing may continue for up to 30 minutes. Rules change only through a separate reviewed amendment. Repeated model decisions do not require another password.</p>
          <p className="text-fg-muted">This review expires {new Date(draft.expiresAtMs).toLocaleTimeString()}.</p>
          {selectionChanged && <p role="alert">The selected model changed. Review the session again before authorizing it.</p>}
          <label className="block">Type <span className="break-all font-mono">{draft.confirmation}</span><input autoComplete="off" className={input} value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} /></label>
          <label className="block">Current LUCIAN password<input type="password" autoComplete="current-password" className={input} value={password} disabled={busy} onChange={e => setPassword(e.target.value)} /></label>
          <button type="button" className={`${button} bg-accent text-white`} disabled={busy || Boolean(selectionChanged) || !password || confirmation !== draft.confirmation || Date.now() >= draft.expiresAtMs} onClick={() => void action("start")}>Authorize and start session</button>
        </div>}
      </div>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </section>;
}
