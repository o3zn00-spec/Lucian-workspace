"use client";
import { useEffect, useMemo, useState } from "react";
import { analyzeCandles } from "@/lib/markets/chart-analysis";
import type { Candle } from "@/lib/markets/types";
import type { ChartCoord } from "./chart-overlays";
const intervals: Record<string, number> = { M1:60,M5:300,M15:900,M30:1800,H1:3600,H4:14400,D1:86400,W:604800,W1:604800 };
export function AnalysisOverlay({ candles, timeframe, coord, status }: { candles: Candle[]; timeframe: string; coord: ChartCoord | null; status: string }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now()/1000);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()/1000), 30000); return () => clearInterval(timer); }, []);
  // Refresh freshness without manufacturing market observations.
  const analysis = useMemo(() => analyzeCandles(candles, intervals[timeframe], now), [candles,timeframe,now]);
  return <>
    {open && analysis && coord && <svg className="pointer-events-none absolute inset-0" width={coord.width} height={coord.height} aria-label="Historical chart levels">
      {[{ value: analysis.support, label:"Range low", color:"#60a5fa" },{ value:analysis.resistance,label:"Range high",color:"#fbbf24" },{value:analysis.mean,label:"20-bar mean",color:"#c4b5fd"}].map(line => {
        const point = coord.timePriceToXY(analysis.through,line.value); if (!point || point.y < 0 || point.y > coord.height) return null;
        return <g key={line.label}><line x1={0} x2={coord.width} y1={point.y} y2={point.y} stroke={line.color} strokeDasharray="5 5" opacity={0.65}/><text x={12} y={point.y-6} fill={line.color} fontSize={10}>{line.label} · {line.value.toLocaleString(undefined,{maximumSignificantDigits:7})}</text></g>;
      })}
    </svg>}
    <div className="absolute bottom-8 left-3 z-10 max-w-[calc(100%-5rem)] text-xs">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="focus-ring rounded-md border border-white/15 bg-[#171d25]/95 px-3 py-1.5 text-slate-200">{open ? "Hide analysis" : "Chart analysis"}</button>
      {open && <div className="mt-2 max-w-72 space-y-1 rounded-lg border border-white/10 bg-[#171d25]/95 p-3 text-slate-300">
        {analysis ? <><p className="font-medium text-slate-100">{analysis.position}</p><p>{analysis.count} closed exchange candles · {timeframe}</p><p>Last bar: {new Date(analysis.through*1000).toLocaleString()}</p>{(analysis.stale || status !== "live") && <p className="text-amber-300">Historical or delayed data. Refresh before using.</p>}<p className="text-slate-400">Range boundaries and average describe observed prices. They do not predict the next move or authorize an order.</p></> : <p>At least 20 consecutive closed exchange candles are required. Reference prices are not analyzed.</p>}
      </div>}
    </div>
  </>;
}
