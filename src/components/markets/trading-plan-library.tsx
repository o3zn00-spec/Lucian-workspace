"use client";
import { useRef, useState } from "react";
import { TRADING_PLAN_FIELDS, type TradingPlanSelection, type TradingPlanSnapshot } from "@/lib/assistant/trading-plan-policy";
import { validateAutonomousPlan, type AutonomousPlan } from "@/lib/bybit/autonomous-policy";
const button = "focus-ring rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-50";
export function TradingPlanLibrary({ plan, selection, onLoad, disabled = false }: {
  plan: AutonomousPlan; selection: TradingPlanSelection; disabled?: boolean;
  onLoad: (plan: AutonomousPlan, selection: TradingPlanSelection | null) => boolean;
}) {
  const [state, setState] = useState<TradingPlanSnapshot | null>(null), [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const acting = useRef(false);
  async function request(action?: string, templateId?: string) {
    if (acting.current || disabled) return;
    acting.current = true; setBusy(true); setError(null); setMessage(null);
    try {
      const body = action === "save_template" ? { action, revision: state?.revision ?? null, name, rules: plan, selection } : action === "update" ? { action, revision: state?.revision ?? null, changes: plan, selection } : action ? { action, revision: state?.revision ?? null, templateId } : null;
      const response = await fetch("/api/assistant/trading-plan", { cache: "no-store", signal: AbortSignal.timeout(20000), ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw Error(data.error ?? "Planning unavailable.");
      setState(data);
      if (action === "load_template") { const loaded = onLoad(validateAutonomousPlan(data.draft.rules), data.draft.selection); setMessage(loaded ? "Template loaded as draft rules. Review and authorize separately to start." : "Template saved as your draft. Finish the current review request, then load the draft again."); }
      else if (action) setMessage(action === "save_template" ? "Template saved. No session started." : action === "update" ? "Form saved as your conversational draft. No session started." : "Template removed. Existing sessions are unchanged.");
    } catch (e) { setError(e instanceof Error ? e.message : "Planning unavailable. Reload the saved state before trying again."); }
    finally { acting.current = false; setBusy(false); }
  }
  function loadDraft() {
    if (!state || !state.complete || disabled || acting.current) return;
    try { const loaded = onLoad(validateAutonomousPlan(state.draft.rules), state.draft.selection); setMessage(loaded ? "Lilthe’s draft loaded into this form. Review the model and rules before authorization." : "Finish the current review request, then load the draft again."); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Draft incomplete."); }
  }
  return <details className="rounded-xl border border-line p-3 text-sm" onToggle={e => { if (e.currentTarget.open && !state) void request(); }}>
    <summary className="cursor-pointer font-medium">Drafts from Lilthe and reusable templates</summary>
    <p className="mt-2 text-fg-muted">Ask Lilthe to prepare your rules in conversation, then load the completed draft here. Saving or loading never starts trading.</p>
    {error && <p role="alert" className="mt-2 text-red-400">{error}</p>}{message && <p role="status" className="mt-2">{message}</p>}
    <button type="button" className={`${button} mt-3`} disabled={disabled || busy} onClick={() => void request()}>{busy ? "Loading…" : "Refresh saved plans"}</button>
    {state && <div className="mt-3 space-y-3">
      <p>{state.complete ? "Your saved draft has all required rules." : `Still needed in Lilthe’s draft: ${state.missing.map(key => TRADING_PLAN_FIELDS.find(f => f.key === key)!.label).join(", ")}.`}</p>
      {Object.keys(state.draft.rules).length > 0 && <dl className="grid gap-2 sm:grid-cols-2">{TRADING_PLAN_FIELDS.filter(f => state.draft.rules[f.key] !== undefined).map(f => <div key={f.key} className="min-w-0 rounded-lg bg-surface-2 p-2"><dt className="text-xs text-fg-muted">{f.label}</dt><dd className="whitespace-pre-wrap break-words">{Array.isArray(state.draft.rules[f.key]) ? (state.draft.rules[f.key] as string[]).join(", ") : String(state.draft.rules[f.key])}</dd></div>)}</dl>}
      <p className="break-words text-fg-muted">Saved model: {state.draft.selection ? `${state.draft.selection.model} · ${state.draft.selection.provider} · ${state.draft.selection.effort}` : "No preference; current shared selection will be used."}</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={disabled || busy || !state.complete} onClick={loadDraft}>Load Lilthe’s completed draft</button><button type="button" className={button} disabled={disabled || busy} onClick={() => void request("update")}>Save this form as draft</button></div>
      <label className="block">New template name<input className="focus-ring mt-1 w-full rounded-lg border border-line bg-surface-2 p-2" value={name} maxLength={80} disabled={disabled || busy} onChange={e => setName(e.target.value)} /></label>
      <button type="button" className={button} disabled={disabled || busy || !name.trim()} onClick={() => void request("save_template")}>Save form as template</button>
      <ul className="space-y-2">{state.templates.map(t => <li key={t.id} className="rounded-lg bg-surface-2 p-3"><strong className="break-words">{t.name}</strong><p className="mt-1 text-xs text-fg-muted">{t.rules.mode === "bybit_live" ? "Live" : "Testnet"} · {t.rules.symbols.join(", ")} · {t.rules.capital} USDT · {t.selection?.model ?? "Current model"}</p><div className="mt-2 flex flex-wrap gap-2"><button type="button" className={button} disabled={disabled || busy} onClick={() => void request("load_template", t.id)}>Load template</button><button type="button" className={button} disabled={disabled || busy} onClick={() => void request("delete_template", t.id)}>Remove template</button></div></li>)}</ul>
    </div>}
  </details>;
}
