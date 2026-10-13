"use client";

import { useEffect, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { amendmentFields, type AmendmentField, type AutonomousAmendmentReview } from "@/lib/bybit/autonomous-amendment-policy";
import type { AutonomousPlan } from "@/lib/bybit/autonomous-policy";
import type { AutonomousSession } from "@/lib/bybit/autonomous-session";

type Session = Pick<AutonomousSession, "id" | "revision" | "plan" | "status" | "deadlineMs" | "trades" | "modelCalls" | "realizedCents" | "active"> & { amendmentVersion?: string };
const button = "focus-ring rounded-xl border border-line px-3 py-2 text-sm disabled:opacity-50";
const input = "focus-ring mt-1 w-full rounded-lg border border-line bg-surface-2 p-2";

export function AutonomousSessionAmendment({ session, onUpdated, disabled = false }: { session: Session; onUpdated: () => void | Promise<void>; disabled?: boolean }) {
  const [open, setOpen] = useState(false), [plan, setPlan] = useState<AutonomousPlan>(session.plan);
  const [review, setReview] = useState<AutonomousAmendmentReview | null>(null), [expired, setExpired] = useState(false);
  const [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const acting = useRef(false);
  useEffect(() => {
    if (!review) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, review.expiresAtMs - Date.now()));
    return () => clearTimeout(timer);
  }, [review]);
  const clearApproval = () => { setReview(null); setPassword(""); setConfirmation(""); setExpired(false); };
  const changeOpen = (next: boolean) => {
    if (acting.current) return;
    setOpen(next); clearApproval(); setError(null); setMessage(null);
    if (next) setPlan({ ...session.plan });
  };
  const edit = (field: AmendmentField, value: string) => {
    setPlan(p => ({ ...p, [field]: typeof p[field] === "number" ? Number(value) : value }));
    clearApproval(); setMessage(null);
  };
  async function request(authorize: boolean) {
    if (acting.current || disabled) return;
    acting.current = true; setBusy(true); setError(null); setMessage(null);
    try {
      const body = authorize
        ? { action: "amend", id: review?.sessionId, revision: review?.revision, draftId: review?.id, confirmation, password }
        : { action: "amend_preview", id: session.id, revision: session.revision, ...(session.amendmentVersion ? { materialVersion: session.amendmentVersion } : {}), plan };
      const response = await fetch("/api/bybit/autonomous-session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw Error(data.error ?? "Amendment request unavailable.");
      if (authorize) { clearApproval(); setMessage("Revised rules saved. Entries remain paused; use Resume entries when you are ready."); await onUpdated(); }
      else { setReview(data.amendment); setExpired(false); setPassword(""); setConfirmation(""); }
    } catch (e) {
      clearApproval(); setError(`${e instanceof Error ? e.message : "Request outcome unavailable."} No automatic retry was sent. Refresh the saved session and review again.`);
      await onUpdated();
    } finally { acting.current = false; setBusy(false); }
  }
  const available = session.status === "paused" && !session.active?.closing;
  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger asChild><button type="button" className={button} disabled={disabled || busy || !available} title={available ? "Review revised rules" : "Pause new entries before changing session rules"}>Change session rules</button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[190] bg-black/60" /><Dialog.Content className="themed fixed left-1/2 top-1/2 z-[191] max-h-[90dvh] w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line bg-surface p-5 text-fg shadow-pop">
      <Dialog.Title className="text-xl font-semibold">Review changes to this session</Dialog.Title>
      <Dialog.Description className="mt-2 text-sm text-fg-muted">Change future trading rules with a fresh owner approval. Your original deadline, money already used, completed trades and model calls carry forward. Existing holdings, stop prices, targets and slippage remain unchanged. The session stays paused until you resume entries.</Dialog.Description>
      <Dialog.Close asChild><button type="button" disabled={busy} aria-label="Close session amendments" className="absolute right-3 top-3 p-2"><X size={18} /></button></Dialog.Close>
      <p className="mt-3 text-sm">Entry permission ends {new Date(session.deadlineMs).toLocaleString()}. Exchange, assets, capital, duration and selected model stay fixed.</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
      {message && <p role="status" className="mt-3 rounded-lg bg-surface-2 p-3 text-sm">{message}</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">{amendmentFields.map(([field, label]) => <label key={field} className={`text-sm ${field === "strategy" ? "sm:col-span-2" : ""}`}>{label}{field === "strategy" ? <textarea rows={4} className={input} value={plan[field]} disabled={busy} onChange={e => edit(field, e.target.value)} /> : <input type={typeof plan[field] === "number" ? "number" : "text"} inputMode="decimal" className={input} value={plan[field]} disabled={busy} onChange={e => edit(field, e.target.value)} />}</label>)}</div>
      <button type="button" className={`${button} mt-4`} disabled={disabled || busy || !available} onClick={() => void request(false)}>{busy ? "Checking…" : "Review rule changes"}</button>
      {review && <div className="mt-4 space-y-3 rounded-xl border border-line p-4 text-sm">
        <h3 className="font-semibold">Exact changes for approval</h3>
        <dl className="space-y-3">{review.changes.map(change => <div key={change.field}><dt className="font-medium">{change.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-fg-muted">Current: {change.before}<br />Proposed: {change.after}</dd></div>)}</dl>
        <p>Already used: {review.usage.trades} completed trades and {review.usage.modelCalls} model calls. Realized result {(review.usage.realizedCents / 100).toFixed(2)} USDT. Limits above are totals for this session, not fresh budgets.</p>
        <p>Saved account limits also apply: {review.accountLimits.maxOrder} USDT/order, {review.accountLimits.maxExposure} USDT exposure, {review.accountLimits.maxDailyLoss} USDT daily loss and {review.accountLimits.maxPositions} positions. Increasing a session limit cannot override these.</p>
        <p>Review expires {new Date(review.expiresAtMs).toLocaleTimeString()}. If the session changes during review, request a fresh preview.</p>
        <label className="block">Type <span className="break-all font-mono">{review.confirmation}</span><input autoComplete="off" className={input} value={confirmation} disabled={busy || expired} onChange={e => setConfirmation(e.target.value)} /></label>
        <label className="block">Current LUCIAN password<input type="password" autoComplete="current-password" className={input} value={password} disabled={busy || expired} onChange={e => setPassword(e.target.value)} /></label>
        {expired && <p role="status">This review expired. Review the rule changes again.</p>}
        {Boolean(session.amendmentVersion && session.amendmentVersion !== review.materialVersion) && <p role="status">The session changed during review. Request a fresh review before approval.</p>}
        <button type="button" className={`${button} bg-accent text-white`} disabled={disabled || busy || expired || Boolean(session.amendmentVersion && session.amendmentVersion !== review.materialVersion) || !password || confirmation !== review.confirmation} onClick={() => void request(true)}>Authorize revised rules</button>
      </div>}
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
