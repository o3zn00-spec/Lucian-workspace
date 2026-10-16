"use client";
import { useEffect, useRef, useState } from "react";
import type { ChatInteraction } from "@/lib/chat/interaction";
import { analyzeCandles } from "@/lib/markets/chart-analysis";
import type { Candle } from "@/lib/markets/types";
type Chart = Extract<ChatInteraction, { lilthe_ui: "chart" }>;
export function ResearchChart({ chart }: { chart: Chart }) {
  const [candles, setCandles] = useState<Candle[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function load() {
    if (controller.current) return;
    const request = new AbortController(); controller.current = request; setBusy(true); setError(""); setCandles([]);
    try {
      const response = await fetch(`/api/markets/bybit?kind=kline&symbol=${chart.symbol}&interval=${chart.interval}&limit=61`, { cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)]) });
      if (!response.ok) throw Error("Exchange chart unavailable. No prices were fabricated.");
      const data = await response.json(), rows = data?.result?.list;
      if (data.retCode !== 0 || data.result.symbol !== chart.symbol || !Array.isArray(rows) || rows.length > 61) throw Error("Invalid candle response.");
      const now = Date.now()/1000, interval = chart.interval === "D" ? 86400 : Number(chart.interval)*60;
      const parsed = rows.map((r: unknown) => { if (!Array.isArray(r) || r.length < 6) throw Error("Invalid candle row."); return { time: Number(r[0])/1000,open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]) }; }).filter(c => c.time+interval <= now).sort((a,b) => a.time-b.time);
      const analysis = analyzeCandles(parsed,interval,now);
      if (!analysis || analysis.stale) throw Error("Fresh consecutive closed candles are unavailable. Refresh later.");
      if (!request.signal.aborted) setCandles(parsed.slice(-60));
    } catch (e) { if (!request.signal.aborted) setError(e instanceof Error ? e.message : "Chart unavailable."); }
    finally { if (controller.current === request) { controller.current = null; setBusy(false); } }
  }
  const prices = candles.flatMap(c => [c.high,c.low]), min = Math.min(...prices), max = Math.max(...prices), range = max-min || 1;
  const y = (price: number) => 230-(price-min)/range*200;
  const x = (time: number) => 20+ Math.max(0,candles.findIndex(c=>c.time===time))*550/Math.max(candles.length-1,1);
  const validLines = chart.lines.filter(line => [line.from,line.to].every(point => candles.some(c=>c.time===point.time) && point.price>=min && point.price<=max));
  return <section className="my-3 overflow-hidden rounded-xl border border-line bg-surface">
    <div className="space-y-2 p-4"><p className="font-medium">{chart.symbol} · {chart.interval === "D" ? "Daily" : `${chart.interval}m`}</p><p className="text-sm leading-relaxed">{chart.summary}</p><button type="button" disabled={busy} onClick={() => void load()} className="focus-ring rounded-lg border border-line px-3 py-2 text-xs disabled:opacity-50">{busy ? "Loading exchange candles…" : "Load current chart"}</button>{error && <p role="alert" className="text-sm text-red-400">{error}</p>}</div>
    {candles.length > 0 && <><svg viewBox="0 0 600 260" className="w-full" role="img" aria-label={`${chart.symbol} closed candles with Lilthe's proposed annotations`}>
      {candles.map(c=><g key={c.time} stroke={c.close>=c.open?"#34d399":"#fb7185"}><line x1={x(c.time)} x2={x(c.time)} y1={y(c.high)} y2={y(c.low)}/><line x1={x(c.time)} x2={x(c.time)} y1={y(c.open)} y2={y(c.close) || y(c.open)+1} strokeWidth={4}/></g>)}
      {validLines.map((line,i)=><g key={i} stroke="#e8c66a"><line x1={x(line.from.time)} x2={x(line.to.time)} y1={y(line.from.price)} y2={y(line.to.price)} strokeDasharray="4 3"/><text x={24} y={18+i*15} stroke="none" fill="#e8c66a" fontSize={11}>{line.label}</text></g>)}
    </svg><div className="space-y-1 px-4 pb-4 text-xs text-fg-muted"><p>Exchange candles through {new Date(candles.at(-1)!.time*1000).toLocaleString()}. Snapshot; reload for updates.</p><p>Lines are Lilthe’s interpretation. {validLines.length !== chart.lines.length ? "Out-of-window or out-of-range annotations were hidden." : "Pattern accuracy is not independently verified."}</p></div></>}
  </section>;
}
