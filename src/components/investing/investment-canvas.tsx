"use client";

import { useRef, useState } from "react";
import { ArrowLeft, Minus, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useInvestingStore, type AssetType } from "@/store/investing";
import { clampCanvasZoom } from "@/lib/investing/canvas";
import { Button } from "@/components/ui-devspace/button";

const ASSETS: AssetType[] = ["stock", "etf", "crypto", "fund", "bond", "cash", "other"];
const field = "rounded-lg border border-line-muted bg-panel px-3 py-2 text-sm text-fg";

export function InvestmentCanvas({ onOpenInvestment }: { onOpenInvestment: (id: string) => void }) {
  const store = useInvestingStore();
  const [scope, setScope] = useState<"portfolio" | "watchlist">("portfolio");
  const [asset, setAsset] = useState<AssetType | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [label, setLabel] = useState("");
  const [watchId, setWatchId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const drag = useRef<{ id: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const investments = store.investments.filter((i) => i.portfolioId === store.activePortfolioId);
  const records = scope === "portfolio" ? investments : store.watchlist;
  const visible = asset ? records.filter((i) => i.assetType === asset) : [];
  const groups = ASSETS.filter((type) => records.some((i) => i.assetType === type));
  const nodes = asset ? visible.map((i) => ({ id: i.id, title: i.symbol, subtitle: i.name })) : groups.map((type) => ({ id: type, title: type.toUpperCase(), subtitle: `${records.filter((i) => i.assetType === type).length} records` }));
  const positions = new Map(nodes.map((n, index) => [n.id, { x: 60 + (index % 3) * 260, y: 60 + Math.floor(index / 3) * 150 }]));
  const width = 860;
  const height = Math.max(390, 100 + Math.ceil(nodes.length / 3) * 150);
  const links = store.connections.filter((c) => investments.some((i) => i.id === c.from) && investments.some((i) => i.id === c.to));
  const reset = () => { setPan({ x: 0, y: 0 }); setZoom(1); };
  const navigate = (next: AssetType | null) => { setAsset(next); setWatchId(null); reset(); };

  return <section className="space-y-4" aria-label="Investment relationship canvas">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-semibold">Your investment map</h2>
        <p className="text-sm text-fg-muted">Explore asset groups and their records. Watchlist ideas are separate from your portfolio.</p>
      </div>
      <div className="flex gap-2">
        <Button variant={scope === "portfolio" ? "default" : "outline"} onClick={() => { setScope("portfolio"); navigate(null); }}>Portfolio</Button>
        <Button variant={scope === "watchlist" ? "default" : "outline"} onClick={() => { setScope("watchlist"); navigate(null); }}>Watchlist</Button>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {asset && <Button variant="outline" size="sm" onClick={() => navigate(null)}><ArrowLeft className="mr-1 h-4 w-4" />All groups</Button>}
      <span className="mr-auto text-sm text-fg-muted">{scope === "portfolio" ? store.portfolios.find((p) => p.id === store.activePortfolioId)?.name ?? "Portfolio" : "Watchlist"}{asset ? ` / ${asset.toUpperCase()}` : " / Asset groups"}</span>
      <Button variant="outline" size="sm" aria-label="Zoom out" onClick={() => setZoom((z) => clampCanvasZoom(z - 0.2))}><Minus className="h-4 w-4" /></Button>
      <span className="w-12 text-center text-sm">{Math.round(zoom * 100)}%</span>
      <Button variant="outline" size="sm" aria-label="Zoom in" onClick={() => setZoom((z) => clampCanvasZoom(z + 0.2))}><Plus className="h-4 w-4" /></Button>
      <Button variant="outline" size="sm" onClick={reset}><RotateCcw className="mr-1 h-4 w-4" />Reset view</Button>
    </div>
    <div className="relative h-[440px] overflow-hidden rounded-xl border border-line-muted bg-canvas touch-none" aria-label="Drag background to pan; use zoom buttons to resize"
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button") || event.button !== 0) return;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => { const d = drag.current; if (d && d.id === event.pointerId) setPan({ x: d.panX + event.clientX - d.x, y: d.panY + event.clientY - d.y }); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {!nodes.length ? <div className="p-12 text-center text-fg-muted">{scope === "portfolio" ? "Add an investment to start your map." : "Add a watchlist idea to explore it here."}</div> :
      <div className="relative origin-top-left" style={{ width, height, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <svg width={width} height={height} className="pointer-events-none absolute inset-0" aria-hidden="true">
          {scope === "portfolio" && asset && links.map((c) => { const a = positions.get(c.from), b = positions.get(c.to); return a && b ? <g key={c.id}><line x1={a.x + 110} y1={a.y + 50} x2={b.x + 110} y2={b.y + 50} stroke="var(--accent)" strokeWidth="2" /><text x={(a.x + b.x) / 2 + 110} y={(a.y + b.y) / 2 + 40} fill="currentColor" fontSize="12" textAnchor="middle">{c.label}</text></g> : null; })}
        </svg>
        {nodes.map((node) => { const pos = positions.get(node.id)!; return <button key={node.id} style={{ left: pos.x, top: pos.y }}
          className="absolute w-[220px] rounded-xl border border-line-muted bg-panel p-4 text-left shadow-sm hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          onClick={() => { if (!asset) navigate(node.id as AssetType); else if (scope === "portfolio") onOpenInvestment(node.id); else setWatchId(node.id); }}>
          <span className="block font-semibold">{node.title}</span><span className="block truncate text-sm text-fg-muted">{node.subtitle}</span>
          <span className="mt-2 block text-xs text-fg-muted">{!asset ? "Explore group →" : scope === "watchlist" ? "Watchlist · no ownership recorded" : "Open investment →"}</span>
        </button>; })}
      </div>}
    </div>
    {watchId && scope === "watchlist" && <div className="rounded-xl border border-line-muted p-4">
      <Button variant="ghost" size="sm" onClick={() => setWatchId(null)}>Close watchlist detail</Button>
      <h3 className="font-semibold">{store.watchlist.find((i) => i.id === watchId)?.name}</h3>
      <p className="text-sm text-fg-muted">Target entry: {store.watchlist.find((i) => i.id === watchId)?.targetEntry || "Not set"}</p>
      <p className="whitespace-pre-wrap text-sm">{store.watchlist.find((i) => i.id === watchId)?.notes || "No notes saved."}</p>
    </div>}
    <p className="text-xs text-fg-muted">Drag the background to pan. Layout and relationships use this browser’s saved Investing records. A portfolio record alone does not prove a funded position.</p>
    {scope === "portfolio" && <div className="rounded-xl border border-line-muted p-4">
      <h3 className="mb-3 font-medium">Relationships</h3>
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); const result = store.addConnection(from, to, label); setError(result ?? ""); if (!result) setLabel(""); }}>
        <select aria-label="Relationship from investment" className={field} value={from} onChange={(e) => setFrom(e.target.value)}><option value="">From investment</option>{investments.map((i) => <option key={i.id} value={i.id}>{i.symbol} · {i.name}</option>)}</select>
        <select aria-label="Relationship to investment" className={field} value={to} onChange={(e) => setTo(e.target.value)}><option value="">To investment</option>{investments.map((i) => <option key={i.id} value={i.id}>{i.symbol} · {i.name}</option>)}</select>
        <input aria-label="Relationship description" className={field} placeholder="e.g. invests in, related sector" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
        <Button type="submit" disabled={investments.length < 2}>Add relationship</Button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-red-500">{error}</p>}
      <ul className="mt-3 space-y-2">{links.map((c) => <li key={c.id} className="flex items-center gap-2 text-sm"><span className="flex-1">{investments.find((i) => i.id === c.from)?.symbol} → {investments.find((i) => i.id === c.to)?.symbol}: {c.label}</span><Button variant="ghost" size="sm" aria-label={`Remove relationship ${c.label}`} onClick={() => store.removeConnection(c.id)}><Trash2 className="h-4 w-4" /></Button></li>)}</ul>
      {!links.length && <p className="mt-3 text-sm text-fg-muted">No relationships recorded yet.</p>}
    </div>}
  </section>;
}
