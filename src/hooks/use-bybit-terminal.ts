"use client";

import { useCallback, useEffect, useState } from "react";
import type { TradingMode } from "@/lib/bybit/terminal";

export interface BybitTerminalSnapshot {
  mode: TradingMode;
  environment: "testnet" | "mainnet";
  connected: boolean;
  symbol: string;
  category: "spot" | "linear";
  portfolio: { totalEquity: string; totalWalletBalance: string; totalAvailableBalance: string; totalPerpUPL: string; totalInitialMargin: string; totalMaintenanceMargin: string; coins: Array<Record<string, string>> };
  ticker: Record<string, string> | null;
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
  const refresh = useCallback(async () => {
    if (!mode) { setData(null); setError(null); setLoading(false); return; }
    setLoading(true);
    try {
      const response = await fetch(`/api/bybit/terminal?mode=${mode}&symbol=${encodeURIComponent(symbol)}&category=${category}`, { cache: "no-store" });
      const payload = await response.json() as BybitTerminalSnapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Bybit terminal synchronization failed.");
      setData(payload); setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Bybit terminal synchronization failed."); setData(null); }
    finally { setLoading(false); }
  }, [mode, symbol, category]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    if (!mode) return () => window.clearTimeout(initial);
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [mode, refresh]);
  return { data, error, loading, refresh };
}
