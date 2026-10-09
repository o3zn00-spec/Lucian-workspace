"use client";

import { createContext, useContext, useCallback, useEffect, useRef, useState } from "react";
import type { TradingMode } from "@/lib/bybit/terminal";

export interface BybitTerminalSnapshot {
  mode: TradingMode;
  environment: "testnet" | "mainnet";
  connected: boolean;
  symbol: string;
  category: "spot" | "linear";
  portfolio: { totalEquity: string; totalWalletBalance: string; totalAvailableBalance: string; totalPerpUPL: string; totalInitialMargin: string; totalMaintenanceMargin: string; coins: Array<Record<string, string>> };
  ticker: Record<string, string> | null;
  funding: Array<Record<string,string>>;
  positions: Array<Record<string, string>>;
  openOrders: Array<Record<string, string>>;
  orderHistory: Array<Record<string, string>>;
  executions: Array<Record<string, string>>;
  closedPnl: Array<Record<string, string>>;
  transactions: Array<Record<string, string>>;
  risk: { maxOrderUsd: number; maxPositionUsd: number; maxDailyLossUsd: number; maxOpenPositions: number; maxLeverage: number; requireApproval: boolean; emergencyStop: boolean };
  audits: Array<{ id: string; action: string; tradingMode: string; status: string; symbol: string | null; createdAt: string }>;
  approvals: Array<{ id: string; productId: string; side: string; tradingMode: string; category: string; orderType: string; state: string; quoteSize: string | null; providerOrderId: string | null; expiresAt: string | null; createdAt: string }>;
  readErrors?: Record<string,string>;
  refreshedAt: string;
}

export function useBybitTerminal(mode: TradingMode | null, symbol: string, category: "spot" | "linear" = "spot") {
  const [data, setData] = useState<BybitTerminalSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(mode));
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const cancelRequests = useCallback(() => { ++generation.current; request.current?.abort(); request.current = null; }, []);
  const refresh = useCallback(async () => {
    const currentGeneration = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    if (!mode) { setData(null); setError(null); setLoading(false); return; }
    setLoading(true);
    let timedOut = false;
    const deadline = window.setTimeout(() => { timedOut = true; controller.abort(); }, 120000);
    try {
      const response = await fetch(`/api/bybit/terminal?mode=${mode}&symbol=${encodeURIComponent(symbol)}&category=${category}`, { cache: "no-store", signal: controller.signal });
      const payload = await response.json() as BybitTerminalSnapshot & { error?: string };
      if (currentGeneration !== generation.current) return;
      if (!response.ok) throw new Error(payload.error || "Bybit terminal synchronization failed.");
      setData(payload); setError(null);
    } catch (reason) { if (currentGeneration === generation.current && (!controller.signal.aborted || timedOut)) { setError(timedOut ? "Exchange synchronization timed out. Balances are unavailable until the next successful refresh." : reason instanceof Error ? reason.message : "Bybit terminal synchronization failed."); setData(null); } }
    finally { window.clearTimeout(deadline); if (currentGeneration === generation.current) { setLoading(false); request.current = null; } }
  }, [mode, symbol, category]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    if (!mode) return () => window.clearTimeout(initial);
    const timer = window.setInterval(() => { if (!request.current) void refresh(); }, 5000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); cancelRequests(); };
  }, [mode, refresh, cancelRequests]);
  return { data, error, loading, refresh };
}

export const BybitTerminalContext = createContext<ReturnType<typeof useBybitTerminal> | null>(null);

export function useSharedBybitTerminal() {
  const terminal = useContext(BybitTerminalContext);
  if (!terminal) throw new Error("Bybit terminal requires the Markets account provider.");
  return terminal;
}
