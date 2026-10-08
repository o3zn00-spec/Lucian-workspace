"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { PaperSessionControls } from "./paper-session-controls";
import { X } from "lucide-react";
import type { PaperPlan } from "@/lib/assistant/paper-policy";
const amountFields = [
  ["capital", "Simulated capital (USDT)"], ["maxOrder", "Maximum order (USDT)"],
  ["maxExposure", "Maximum total exposure (USDT)"], ["maxLoss", "Session loss limit (USDT)"],
  ["maxRiskPerTrade", "Maximum risk per trade (USDT)"],
] as const;
const numberFields = [
  ["maxOrders", "Maximum orders per session", 1, 100], ["maxPositions", "Maximum open positions", 1, 10],
  ["reviewMinutes", "Strategy review interval (minutes)", 1, 1440], ["durationHours", "Session duration (hours)", 1, 168],
  ["maxDataAgeSeconds", "Maximum quote age (seconds)", 10, 300], ["feeBps", "Fee per fill (basis points)", 0, 1000],
  ["slippageBps", "Simulated slippage (basis points)", 0, 1000],
] as const;
type Fields = Record<string, string>;
const emptyFields: Fields = Object.fromEntries([...amountFields, ...numberFields].map(([key]) => [key, ""]));
export function PaperSessionSetup() {
  const { data: session } = useSession();
  const params = useSearchParams();
  return <PaperSessionState key={session?.user?.id ?? "anonymous"} initiallyOpen={params.get("paperSetup") === "1"} />;
}
function PaperSessionState({ initiallyOpen }: { initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [fields, setFields] = useState<Fields>({ ...emptyFields, symbols: "", strategy: "", additionalRules: "" });
  const [revision, setRevision] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch("/api/assistant/paper-plan", { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok || !data.ok) throw Error(data.error ?? "Plan unavailable.");
      if (controller.signal.aborted) return;
      setRevision(data.revision);
      const plan = data.plan as PaperPlan | null;
      setFields(plan ? { ...Object.fromEntries([...amountFields, ...numberFields].map(([key]) => [key, String(plan[key])])), symbols: plan.symbols.join(", "), strategy: plan.strategy, additionalRules: plan.additionalRules } : { ...emptyFields, symbols: "", strategy: "", additionalRules: "" });
      setSaved(Boolean(plan)); setError(null);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [open]);
  const changeOpen = (value: boolean) => { setBusy(true); setError(null); setOpen(value); };
  const update = (key: string, value: string) => { setFields(previous => ({ ...previous, [key]: value })); setSaved(false); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const plan = { mode: "paper", exchange: "bybit", category: "spot", currency: "USDT", leverage: 1,
        ...Object.fromEntries(amountFields.map(([key]) => [key, fields[key]])),
        ...Object.fromEntries(numberFields.map(([key]) => [key, Number(fields[key])])),
        symbols: fields.symbols.split(",").map(s => s.trim().toUpperCase()), strategy: fields.strategy, additionalRules: fields.additionalRules };
      const response = await fetch("/api/assistant/paper-plan", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan, revision }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(result.error ?? "Plan not saved.");
      setRevision(result.revision); setSaved(true);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  const inputClass = "mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg focus-ring";
  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <div className="themed flex shrink-0 items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2 text-sm text-fg">
      <span>Lilthe paper session</span>
      <Dialog.Trigger asChild><button className="focus-ring rounded-lg border border-line px-3 py-1.5" type="button">Set up paper session</button></Dialog.Trigger>
    </div>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[180] bg-black/50" />
      <Dialog.Content className="themed fixed left-1/2 top-1/2 z-[181] max-h-[90dvh] w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-line bg-surface p-5 text-fg shadow-pop">
        <Dialog.Title className="text-lg font-semibold">Lilthe paper session plan</Dialog.Title>
        <Dialog.Description className="mt-2 text-sm text-fg-muted">Choose the rules before a session can run. Save the plan, review it, then explicitly authorize background paper execution below.</Dialog.Description>
        <Dialog.Close asChild><button aria-label="Close paper setup" className="focus-ring absolute right-3 top-3 rounded p-1"><X size={18} /></button></Dialog.Close>
        {busy && <p role="status" className="mt-3 text-sm">Loading or saving plan…</p>}
        {error && <p role="alert" className="my-3 text-sm">{error} Close and reopen to reload the latest saved plan.</p>}
        <form onSubmit={save} className="mt-4 space-y-4">
          <fieldset disabled={busy} className="space-y-4">
            <div className="rounded-lg bg-surface-2 p-3 text-sm">Mode: Paper · Bybit market data · USDT spot · no leverage. Simulated capital is separate from your exchange balance. Live session setup is unavailable.</div>
            <h3 className="font-medium">Capital and risk limits</h3>
            <div className="grid gap-3 sm:grid-cols-2">{amountFields.map(([key,label]) => <label key={key} className="text-sm">{label}<input required inputMode="decimal" type="text" pattern="[0-9]+(\.[0-9]{1,2})?" value={fields[key]} onChange={e => update(key,e.target.value)} className={inputClass} /></label>)}</div>
            <p className="text-xs text-fg-muted">Maximum order ≤ exposure ≤ capital. Risk per trade ≤ session loss limit ≤ capital. Execution costs count toward order/exposure limits. Current equity losses and open-position stop risk count toward the loss budget.</p>
            <h3 className="font-medium">Markets and strategy</h3>
            <label className="block text-sm">Allowed symbols (comma separated)<input required value={fields.symbols} onChange={e => update("symbols",e.target.value)} placeholder="BTCUSDT, ETHUSDT" className={inputClass} /></label>
            <label className="block text-sm">Strategy and exit conditions<textarea required maxLength={500} rows={3} value={fields.strategy} onChange={e => update("strategy",e.target.value)} className={inputClass} /></label>
            <h3 className="font-medium">Timing and simulation costs</h3>
            <div className="grid gap-3 sm:grid-cols-2">{numberFields.map(([key,label,min,max]) => <label key={key} className="text-sm">{label}<input required type="number" min={min} max={max} step="1" value={fields[key]} onChange={e => update(key,e.target.value)} className={inputClass} /></label>)}</div>
            <p className="text-xs text-fg-muted">100 basis points = 1%. Review frequency is not continuous protection. Fee/slippage values are simulation assumptions, not verified account fees.</p>
            <label className="block text-sm">Additional rules<textarea maxLength={1000} rows={2} value={fields.additionalRules} onChange={e => update("additionalRules",e.target.value)} className={inputClass} /></label>
            <p className="text-xs text-fg-muted">The model interprets strategy notes; server checks enforce numerical limits. Saving alone does not start a session or create exchange permission.</p>
            <button type="submit" className="focus-ring rounded-lg bg-accent px-4 py-2 text-sm text-black">Save draft plan</button>
          </fieldset>
          {saved && <p role="status" className="rounded-lg border border-line p-3 text-sm">Draft saved. Saving does not start or change an active session.</p>}
        </form>
        <PaperSessionControls planRevision={revision} ready={saved && !busy} />
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
