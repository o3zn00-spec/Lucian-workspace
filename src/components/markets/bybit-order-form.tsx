"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { useMarketsStore } from "@/store/markets";
import { getLucianBase } from "@/lib/markets/symbol-mapping";

interface Preview {
  intentId: string;
  executionEnabled: boolean;
  expiresAt: string;
  confirmationPhrase: string;
  preview: { mode: string; symbol: string; category: string; side: string; orderType: string; quantity: number; limitPrice: number | null; stopLoss: number | null; takeProfit: number | null; marketPrice: number; notional: number; leverage: number; checks: Array<{ id: string; ok: boolean; message: string }> };
}

export function BybitOrderForm({ symbol, marketPrice, initialSide = "Buy" }: { symbol: string; marketPrice: number; initialSide?: "Buy" | "Sell" }) {
  const mode = useMarketsStore((state) => state.accountMode);
  const bybitMode = mode === "bybit_live" ? "bybit_live" : "bybit_testnet";
  const bybitSymbol = `${getLucianBase(symbol)}USDT`;
  const [category, setCategory] = useState<"spot" | "linear">("spot");
  const [side, setSide] = useState<"Buy" | "Sell">(initialSide);
  const [orderType, setOrderType] = useState<"Market" | "Limit">("Market");
  const [quantity, setQuantity] = useState("0.001");
  const [price, setPrice] = useState("");
  const [leverage, setLeverage] = useState("1");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [reduceOnly, setReduceOnly] = useState(false);
  const [positionIdx, setPositionIdx] = useState("0");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const estimated = useMemo(() => Number(quantity || 0) * Number(orderType === "Limit" ? price || 0 : marketPrice || 0), [quantity, price, marketPrice, orderType]);

  async function request(body: Record<string, unknown>) {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/bybit/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as Preview & { error?: string; orderId?: string };
      if (!response.ok) throw new Error(payload.error || "Bybit order action failed.");
      return payload;
    } catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : "Bybit order action failed." }); return null; }
    finally { setBusy(false); }
  }

  async function review() {
    const result = await request({ mode: bybitMode, symbol: bybitSymbol, category, side, orderType, quantity, price, leverage, stopLoss, takeProfit, reduceOnly, positionIdx });
    if (result?.intentId) { setPreview(result); setConfirmation(""); setMessage({ ok: true, text: result.executionEnabled ? "Risk checks passed. Review and approve the exact order below." : "Risk checks passed for this preview. Exchange submission remains server-locked." }); }
  }

  async function submit() {
    if (!preview) return;
    const result = await request({ confirmed: true, intentId: preview.intentId, confirmation, password });
    if (result?.orderId) { setMessage({ ok: true, text: `Order submitted to Bybit. ID: ${result.orderId}` }); setPreview(null); setPassword(""); setConfirmation(""); }
  }

  const inputClass = "w-full rounded border border-line-muted bg-surface-2 px-2 py-1.5 text-[11px] text-fg outline-none focus:border-[var(--accent)]";
  return <div className="space-y-3 p-3 text-[11px]">
    <div className={`rounded border px-2 py-2 ${bybitMode === "bybit_live" ? "border-red-500/50 bg-red-500/10 text-red-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"}`}>
      <div className="flex items-center gap-1.5 font-semibold"><ShieldCheck className="h-3.5 w-3.5" />{bybitMode === "bybit_live" ? "BYBIT LIVE · REAL FUNDS" : "BYBIT TESTNET · SIMULATED FUNDS"}</div>
      <div className="mt-1 opacity-80">{bybitSymbol} · every order requires a server preview and explicit approval.</div>
    </div>
    <div className="grid grid-cols-2 gap-2">
      <label>Market<select className={inputClass} value={category} onChange={(event) => { setCategory(event.target.value as "spot" | "linear"); if (event.target.value === "spot" && orderType === "Market") { setStopLoss(""); setTakeProfit(""); } setPreview(null); }}><option value="spot">Spot</option><option value="linear">USDT Perpetual</option></select></label>
      <label>Order type<select className={inputClass} value={orderType} onChange={(event) => { setOrderType(event.target.value as "Market" | "Limit"); if (event.target.value === "Market" && category === "spot") { setStopLoss(""); setTakeProfit(""); } setPreview(null); }}><option>Market</option><option>Limit</option></select></label>
    </div>
    <div className="grid grid-cols-2 gap-2"><button className={`rounded py-2 font-semibold ${side === "Buy" ? "bg-emerald-500 text-black" : "bg-surface-2"}`} onClick={() => { setSide("Buy"); setPreview(null); }}>Buy</button><button className={`rounded py-2 font-semibold ${side === "Sell" ? "bg-red-500 text-white" : "bg-surface-2"}`} onClick={() => { setSide("Sell"); setPreview(null); }}>Sell</button></div>
    <label>Quantity ({getLucianBase(symbol)})<input className={inputClass} inputMode="decimal" value={quantity} onChange={(event) => { setQuantity(event.target.value); setPreview(null); }} /></label>
    {orderType === "Limit" && <label>Limit price (USDT)<input className={inputClass} inputMode="decimal" value={price} onChange={(event) => { setPrice(event.target.value); setPreview(null); }} /></label>}
    {category === "linear" && <><label>Position mode<select className={inputClass} value={positionIdx} onChange={(event) => { setPositionIdx(event.target.value); setPreview(null); }}><option value="0">One-way</option><option value="1">Hedge · long</option><option value="2">Hedge · short</option></select></label><label>Leverage<input className={inputClass} inputMode="decimal" value={leverage} onChange={(event) => { setLeverage(event.target.value); setPreview(null); }} /></label><label className="flex items-center gap-2"><input type="checkbox" checked={reduceOnly} onChange={(event) => { setReduceOnly(event.target.checked); setPreview(null); }} /> Reduce only</label></>}
    {(category === "linear" || orderType === "Limit") && <div className="grid grid-cols-2 gap-2"><label>Stop loss (USDT)<input className={inputClass} inputMode="decimal" value={stopLoss} onChange={(event) => { setStopLoss(event.target.value); setPreview(null); }} /></label><label>Take profit (USDT)<input className={inputClass} inputMode="decimal" value={takeProfit} onChange={(event) => { setTakeProfit(event.target.value); setPreview(null); }} /></label></div>}
    {category === "spot" && orderType === "Market" && <p className="text-fg-muted">Use Spot Limit to attach market-triggered stop loss and take profit. A Spot Market order has no attached protection.</p>}
    <div className="flex justify-between rounded bg-surface-2 px-2 py-2"><span className="text-fg-muted">Estimated exposure</span><span className="font-mono text-fg">{estimated.toFixed(2)} USDT</span></div>
    {message && <div className={`rounded border px-2 py-2 ${message.ok ? "border-emerald-500/40 text-emerald-400" : "border-red-500/40 text-red-400"}`}>{message.ok ? <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" /> : <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}{message.text}</div>}
    {!preview ? <button disabled={busy} onClick={() => void review()} className="flex w-full items-center justify-center gap-2 rounded bg-[var(--accent)] py-2 font-semibold text-[var(--accent-fg)] disabled:opacity-50">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Review order</button> : <div className="space-y-2 rounded border border-line-muted p-2">
      <div className="font-semibold text-fg">{preview.executionEnabled ? "Approval required" : "Preview only · execution locked"}</div>
      <div>{preview.preview.side} {preview.preview.quantity} {getLucianBase(symbol)} · {preview.preview.category} {preview.preview.orderType} · {preview.preview.notional.toFixed(2)} USDT</div>
      <div>Limit: {preview.preview.limitPrice ?? "Market"} · Stop: {preview.preview.stopLoss ?? "None"} · Target: {preview.preview.takeProfit ?? "None"}</div>
      <div className="text-fg-muted">Preview expires at {new Date(preview.expiresAt).toLocaleTimeString()}. Protective fields request exchange triggers; they do not certify that an exit has filled.</div>
      {preview.preview.checks.map((check) => <div key={check.id} className="flex gap-1 text-emerald-400"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />{check.message}</div>)}
      <div className="text-fg-muted">Type <strong className="select-all text-fg">{preview.confirmationPhrase}</strong></div>
      <input className={inputClass} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Exact confirmation phrase" />
      {bybitMode === "bybit_live" && <input type="password" className={inputClass} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Current LUCIAN password" />}
      <div className="grid grid-cols-2 gap-2"><button onClick={() => setPreview(null)} className="rounded bg-surface-2 py-2">Cancel</button><button disabled={!preview.executionEnabled || busy || confirmation !== preview.confirmationPhrase || (bybitMode === "bybit_live" && !password)} onClick={() => void submit()} className="rounded bg-red-500 py-2 font-semibold text-white disabled:opacity-40">Submit to Bybit</button></div>
    </div>}
  </div>;
}
