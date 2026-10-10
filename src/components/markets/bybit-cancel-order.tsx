"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";

export function BybitCancelOrder({ mode, order, refresh }: { mode: "bybit_live" | "bybit_testnet"; order: Record<string, string>; refresh: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [message, setMessage] = useState("");
  const phrase = `${mode === "bybit_live" ? "CANCEL BYBIT LIVE ORDER" : "CANCEL BYBIT TESTNET ORDER"} ${order.orderId}`;
  const close = () => { if (!busy) { setOpen(false); setPassword(""); setConfirmation(""); } };

  async function cancel() {
    if (busy || attempted || confirmation !== phrase) return;
    setBusy(true); setAttempted(true); setMessage("");
    try {
      const response = await fetch("/api/bybit/orders", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, category: order.category, symbol: order.symbol, orderId: order.orderId, confirmation, password }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw Error(result.error || "Cancellation was not confirmed.");
      setMessage("Bybit acknowledged the cancellation request. Refresh exchange reconciliation to check cancellation and any fills that raced with it.");
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : "Cancellation outcome is unknown."} Check exchange records before another request. No automatic retry was sent.`);
    } finally {
      setPassword(""); setConfirmation(""); setBusy(false);
      await refresh().catch(() => undefined);
    }
  }

  return <><button type="button" className="text-red-400 hover:text-red-300" onClick={() => setOpen(true)}>Review cancellation</button><Dialog open={open} onClose={close} title="Review order cancellation"><div className="space-y-3 text-sm"><p>{mode === "bybit_live" ? "Bybit Live · real funds" : "Bybit Testnet"} · {order.category} · {order.symbol}</p><p className="break-all font-mono">Order {order.orderId}</p><p>Cancelling removes the unfilled remainder. Existing fills remain. Cancelling a protective order can leave an existing holding unprotected.</p>{!attempted && <><label className="block">Type <span className="break-all font-mono">{phrase}</span><input autoComplete="off" className="mt-1 w-full rounded border border-line bg-surface-2 p-2" value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} /></label>{mode === "bybit_live" && <label className="block">Current LUCIAN password<input type="password" autoComplete="current-password" className="mt-1 w-full rounded border border-line bg-surface-2 p-2" value={password} onChange={e => setPassword(e.target.value)} disabled={busy} /></label>}<button type="button" disabled={busy || confirmation !== phrase || mode === "bybit_live" && !password} onClick={() => void cancel()} className="rounded bg-red-500 px-3 py-2 font-semibold text-white disabled:opacity-50">Request cancellation</button></>}{message && <p role="status">{message}</p>}<button type="button" disabled={busy} onClick={close} className="rounded border border-line px-3 py-2">Close</button></div></Dialog></>;
}
