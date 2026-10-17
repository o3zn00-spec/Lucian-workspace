"use client";
import { useRef, useState } from "react";
import { ShieldCheck, Check, X, Loader2 } from "lucide-react";
import { useSharedAIConfig, type InterfaceId } from "@/store/shared-ai-config";
import { SessionReadinessNotice } from "@/components/markets/session-readiness";
import type { SessionReadiness } from "@/lib/bybit/session-readiness-policy";
import type { AutonomousPlan } from "@/lib/bybit/autonomous-policy";

import { ShortAccountSummary, type SessionAccountLimits } from "@/components/markets/short-account-summary";

type Review = { accountLimits?: SessionAccountLimits; id: string; plan: AutonomousPlan; provider: string; model: string; effort: string; expiresAtMs: number; confirmation: string };
const control = "focus-ring rounded-lg border border-line px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40";
async function request(url: string, body?: unknown) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(body && (body as {action?:string}).action === "preview" ? 120000 : 30000), ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok || !data.ok) throw Error(data.error || "The request could not be confirmed.");
  return data;
}
export function TradingApproval({ interfaceId = "economic-agent", disabled = false }: { interfaceId?: InterfaceId; disabled?: boolean }) {
  const shared = useSharedAIConfig();
  const selected = shared.resolve(interfaceId);
  const [readiness, setReadiness] = useState<SessionReadiness | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const lock = useRef(false);
  const changed = review && (review.provider !== selected.provider || review.model !== selected.model || review.effort !== shared.reasoningEffort);
  async function load() {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setError(""); setStatus(""); setReadiness(null); setReview(null); setPassword(""); setConfirmation("");
    try {
      const current = await request("/api/bybit/autonomous-session");
      if(current.session && (current.session.status !== "stopped" || current.session.active)) {
        const s=current.session;
        setReadiness({status:"existing_session",title:"Your existing session comes first",message:`Session ${s.id.slice(0,8)} is ${s.status}. ${s.active ? `${s.active.symbol}: ${s.active.quantity}. ${s.active.protection}` : "No owned trade is currently recorded."} Completed trades: ${s.trades}. No duplicate session was created.`,nextAction:"Open session controls to inspect the current trade, protection, worker status or review amended rules."});return;
      }
      const saved = await request("/api/assistant/trading-plan");
      if (!saved.complete) throw Error("The saved plan is incomplete. Ask Lilthe to finish the missing details here first.");
      const result = await request("/api/bybit/autonomous-session", { action: "preview", plan: saved.draft.rules, provider: selected.provider, model: selected.model, effort: shared.reasoningEffort });
      setReadiness(result.readiness ?? null); setReview(result.draft ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : "Review unavailable."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function approve() {
    if (lock.current || disabled || !review || changed || !password || confirmation !== review.confirmation) return;
    if (Date.now() >= review.expiresAtMs) { setReview(null); setPassword(""); setError("This review expired. Load a fresh review before approving."); return; }
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await request("/api/bybit/autonomous-session", { action: "start", draftId: review.id, password, confirmation });
      setStatus(`Authorization saved. Session status: ${result.session?.status ?? "awaiting status"}. This does not confirm an exchange fill.`);
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "Outcome unavailable."} No automatic retry was sent. Check session status before approving again.`);
    } finally { setReview(null); setPassword(""); setConfirmation(""); lock.current = false; setBusy(false); }
  }
  async function checkStatus() {
    if (lock.current) return; lock.current = true; setBusy(true);
    try { const result = await request("/api/bybit/autonomous-session"); setStatus(result.session ? `Session ${result.session.id.slice(0, 8)}: ${result.session.status}. Completed trades: ${result.session.trades}.` : "No session is recorded."); }
    catch { setStatus("Session status is unavailable. Do not assume an earlier request failed."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section aria-label="Trading authorization" className="my-4 overflow-hidden rounded-xl border border-line bg-surface">
    <div className="flex items-center gap-2 border-b border-line-muted px-4 py-3 text-sm font-medium"><ShieldCheck size={16} className="text-fg-muted" />Review trading session</div>
    <div className="space-y-4 p-4">
      {!review && !status && !readiness && <p className="text-sm text-fg-muted">Load your saved plan and current server checks. Nothing starts until you approve the exact session.</p>}
      {readiness && <SessionReadinessNotice value={readiness} />}
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {status && <p role="status" className="text-sm">{status}</p>}
      {review && <>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          {Object.entries({ Account: review.plan.mode === "bybit_live" ? "Bybit Live · real funds" : "Bybit Testnet", Product: review.plan.product === "linear_short" ? "USDT perpetual · Short" : "Spot · Buy and sell", Assets: review.plan.symbols.join(", "), Capital: `${review.plan.capital} USDT`, "Maximum order": `${review.plan.maxOrder} USDT`, "Session loss limit": `${review.plan.maxLoss} USDT`, "Risk per trade": `${review.plan.maxRiskPerTrade} USDT`, "Trade limit": review.plan.maxTrades, Duration: `${review.plan.durationHours} hours`, "Review interval": `${review.plan.reviewMinutes} minutes`, "Model calls": review.plan.maxModelCalls, "Public web research": review.plan.webResearch ? "Enabled · 2 model calls per review plus search credits" : "Off · market data and feeds", Slippage: `${review.plan.slippageBps} basis points`, Model: `${review.provider} / ${review.model} · ${review.effort}` }).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-fg-muted">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}
        </dl>
        <ShortAccountSummary plan={review.plan} limits={review.accountLimits} />
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{review.plan.strategy}</p>
        <p className="text-xs text-fg-muted">{review.plan.product === "linear_short" ? "Perpetual shorts at the account settings shown above." : "Spot only."} Existing account limits still apply. Review expires at {new Date(review.expiresAtMs).toLocaleTimeString()}.</p>
        {changed && <p role="alert" className="text-sm text-amber-500">Model settings changed. Load a fresh review.</p>}
        <label className="block text-sm">Confirm: <span className="break-all font-mono text-xs">{review.confirmation}</span><input aria-label="Session confirmation phrase" value={confirmation} disabled={busy || disabled} onChange={e => setConfirmation(e.target.value)} autoComplete="off" className="focus-ring mt-2 w-full rounded-lg border border-line bg-canvas p-2" /></label>
        <label className="block text-sm">Current LUCIAN password<input type="password" autoComplete="current-password" value={password} disabled={busy || disabled} onChange={e => setPassword(e.target.value)} className="focus-ring mt-2 w-full rounded-lg border border-line bg-canvas p-2" /></label>
        <div className="flex flex-wrap gap-2"><button className={`${control} bg-fg text-canvas`} disabled={busy || disabled || Boolean(changed) || !password || confirmation !== review.confirmation} onClick={() => void approve()}><Check size={14} className="mr-1 inline" />Approve session</button><button className={control} disabled={busy} onClick={() => { setReview(null); setPassword(""); setConfirmation(""); setStatus("Rejected. No start request was sent."); }}><X size={14} className="mr-1 inline" />Reject</button></div>
      </>}
      <div className="flex flex-wrap gap-2"><button className={control} disabled={busy || disabled} onClick={() => void load()}>{busy ? <Loader2 size={14} className="inline animate-spin" /> : "Load current review"}</button><button className={control} disabled={busy} onClick={() => void checkStatus()}>Check session status</button></div>
    </div>
  </section>;
}
