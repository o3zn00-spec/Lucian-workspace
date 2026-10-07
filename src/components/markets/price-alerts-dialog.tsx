"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Bell, BellRing, Plus, Trash2, RotateCcw, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui-devspace/dialog";
import { Button } from "@/components/ui-devspace/button";
import { Input } from "@/components/ui-devspace/input";
import { Label } from "@/components/ui-devspace/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui-devspace/select";
import {
  usePriceAlertsStore,
  type AlertCondition,
} from "@/store/markets-price-alerts";
import { useMarketsStore } from "@/store/markets";
import { INSTRUMENT_CATALOG } from "@/lib/markets/catalog";
import { cn } from "@/lib/utils";

/**
 * Markets Price Alerts dialog — Phase 10.
 *
 * Lets the user create, enable, disable, reset, and delete price alerts
 * for any LUCIAN instrument. Uses the EXISTING Markets live-price system
 * (no separate Bybit connection) — alerts are evaluated inline from
 * the markets store's `updatePrice` hot path.
 *
 * UI is consistent with the rest of Markets (same themed surfaces,
 * same accent color, same dialog primitives as the account dialogs).
 */
export function PriceAlertsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const alerts = usePriceAlertsStore((s) => s.alerts);
  const createAlert = usePriceAlertsStore((s) => s.createAlert);
  const disableAlert = usePriceAlertsStore((s) => s.disableAlert);
  const enableAlert = usePriceAlertsStore((s) => s.enableAlert);
  const deleteAlert = usePriceAlertsStore((s) => s.deleteAlert);
  const resetAlert = usePriceAlertsStore((s) => s.resetAlert);

  const prices = useMarketsStore((s) => s.prices);

  const [newSymbol, setNewSymbol] = useState("BTCUSD");
  const [newCondition, setNewCondition] = useState<AlertCondition>("above");
  const [newTarget, setNewTarget] = useState("");

  const handleCreate = useCallback(() => {
    const target = parseFloat(newTarget);
    if (!Number.isFinite(target) || target <= 0) return;
    createAlert({
      symbol: newSymbol,
      condition: newCondition,
      targetPrice: target,
    });
    setNewTarget("");
  }, [newSymbol, newCondition, newTarget, createAlert]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-[var(--accent)]" />
            Price Alerts
          </DialogTitle>
        </DialogHeader>

        {/* Create new alert */}
        <div className="space-y-3 border-b border-line-muted pb-4">
          <div>
            <Label className="text-[10px] uppercase tracking-wide text-fg-faint">Symbol</Label>
            <Select value={newSymbol} onValueChange={setNewSymbol}>
              <SelectTrigger className="mt-1 h-8">
                    <SelectValue />
                  </SelectTrigger>
              <SelectContent>
                {INSTRUMENT_CATALOG.slice(0, 40).map((i) => (
                  <SelectItem key={i.symbol} value={i.symbol}>
                    {i.symbol} — {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-fg-faint">Condition</Label>
              <Select
                value={newCondition}
                onValueChange={(v) => setNewCondition(v as AlertCondition)}
              >
                <SelectTrigger className="mt-1 h-8">
                    <SelectValue />
                  </SelectTrigger>
                <SelectContent>
                  <SelectItem value="above">Above</SelectItem>
                  <SelectItem value="below">Below</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wide text-fg-faint">Target Price (USD)</Label>
              <Input
                type="number"
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
                placeholder="0.00"
                className="mt-1 h-8"
              />
            </div>
          </div>
          <Button size="sm" onClick={handleCreate} disabled={!newTarget || parseFloat(newTarget) <= 0}>
            <Plus className="mr-1 h-3 w-3" /> Create Alert
          </Button>
        </div>

        {/* Existing alerts */}
        <div className="space-y-2">
          {alerts.length === 0 ? (
            <p className="py-4 text-center text-[12px] text-fg-faint">
              No price alerts yet. Create one above to be notified when a
              symbol crosses your target.
            </p>
          ) : (
            alerts.map((a) => {
              const livePrice = prices.get(a.symbol);
              const isLive = typeof livePrice === "number";
              const liveLabel = isLive ? `$${livePrice!.toFixed(2)}` : "—";
              return (
                <div
                  key={a.id}
                  className={cn(
                    "rounded-md border border-line bg-surface-2 p-3 transition-opacity",
                    !a.enabled && "opacity-50",
                    a.triggered && "border-[var(--accent)]/40 bg-[var(--accent)]/5",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-[12px] font-semibold text-fg">{a.symbol}</p>
                        <span className="text-[10px] text-fg-faint">{a.condition}</span>
                        <span className="text-[12px] font-mono text-fg">${a.targetPrice}</span>
                        {a.triggered && (
                          <span className="rounded bg-[var(--accent)]/10 px-1 py-px text-[8px] font-bold uppercase tracking-wide text-[var(--accent)]">
                            Triggered
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[9px] text-fg-faint">
                        Live: {liveLabel}
                        {a.lastTriggerAt ? ` · fired ${formatTimeAgoShort(a.lastTriggerAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      {a.triggered && (
                        <button
                          onClick={() => resetAlert(a.id)}
                          className="rounded p-1 text-fg-muted hover:bg-hover hover:text-emerald-500"
                          title="Re-arm alert"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        onClick={() => (a.enabled ? disableAlert(a.id) : enableAlert(a.id))}
                        className={cn(
                          "rounded p-1",
                          a.enabled
                            ? "text-[var(--accent)] hover:bg-hover"
                            : "text-fg-muted hover:bg-hover hover:text-fg",
                        )}
                        title={a.enabled ? "Disable" : "Enable"}
                      >
                        {a.enabled ? <BellRing className="h-3 w-3" /> : <Bell className="h-3 w-3" />}
                      </button>
                      <button
                        onClick={() => deleteAlert(a.id)}
                        className="rounded p-1 text-fg-muted hover:bg-hover hover:text-red-400"
                        title="Delete alert"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatTimeAgoShort(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
