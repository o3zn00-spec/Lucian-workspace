"use client";

/* LUCIAN Markets Price Alerts — Phase 10.
 *
 * User-defined price alerts for Markets instruments. Uses the EXISTING
 * live-price system (`useMarketsStore.prices`) — does NOT create another
 * Bybit connection or duplicate live-data provider.
 *
 * Architecture:
 *
 *   useMarketsStore.updatePrice (live tick)
 *         ↓
 *   evaluateAlerts() — pure function over (alerts, price)
 *         ↓
 *   condition newly true?
 *         ↓
 *   useNotificationStore.notify() — ONE notification, deduped by
 *     `markets:price-alert-triggered:<symbol>:<condition>:<target>`
 *   alert.lastTriggerAt + alert.triggered set
 *
 * Avoids triggering continuously while the condition remains true:
 *   - Once an alert fires, `triggered = true` blocks re-firing until the
 *     user explicitly re-arms it (via `resetAlert`).
 *   - If the user disables an alert, the evaluator skips it.
 *
 * Persisted to localStorage via zustand-persist (non-secret data only —
 * symbol + condition + target price + enabled flag + triggered flag).
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useNotificationStore } from "@/store/notifications";

export type AlertCondition = "above" | "below";

export interface PriceAlert {
  id: string;
  /** LUCIAN symbol from the catalog (e.g. "BTCUSD"). */
  symbol: string;
  condition: AlertCondition;
  /** Target price the user wants to be notified at. */
  targetPrice: number;
  enabled: boolean;
  /** True once the condition has been met — blocks re-firing until
   *  the user re-arms via `resetAlert`. */
  triggered: boolean;
  createdAt: number;
  /** Last time this alert fired (null if never). */
  lastTriggerAt: number | null;
}

interface PriceAlertState {
  alerts: PriceAlert[];

  createAlert: (input: {
    symbol: string;
    condition: AlertCondition;
    targetPrice: number;
  }) => string;
  /** Disable an alert (keep it in the list, but the evaluator skips it). */
  disableAlert: (id: string) => void;
  enableAlert: (id: string) => void;
  /** Delete an alert permanently. */
  deleteAlert: (id: string) => void;
  /** Re-arm a triggered alert so it can fire again next time the
   *  condition is met. */
  resetAlert: (id: string) => void;
  /** Internal: mark an alert as triggered at the given time. Called by
   *  the evaluator (lib/markets/alert-evaluator.ts) when it fires a
   *  notification. Exposed on the store so the evaluator can be a pure
   *  function of (state, price) → side-effect. */
  _markTriggered: (id: string, at: number) => void;
}

export const usePriceAlertsStore = create<PriceAlertState>()(
  persist(
    (set) => ({
      alerts: [],

      createAlert: ({ symbol, condition, targetPrice }) => {
        const id = `alert_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const alert: PriceAlert = {
          id,
          symbol: symbol.toUpperCase(),
          condition,
          targetPrice,
          enabled: true,
          triggered: false,
          createdAt: Date.now(),
          lastTriggerAt: null,
        };
        set((s) => ({ alerts: [alert, ...s.alerts] }));
        return id;
      },

      disableAlert: (id) =>
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === id ? { ...a, enabled: false } : a,
          ),
        })),

      enableAlert: (id) =>
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === id ? { ...a, enabled: true } : a,
          ),
        })),

      deleteAlert: (id) =>
        set((s) => ({
          alerts: s.alerts.filter((a) => a.id !== id),
        })),

      resetAlert: (id) =>
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === id
              ? { ...a, triggered: false, lastTriggerAt: null }
              : a,
          ),
        })),

      _markTriggered: (id, at) =>
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === id
              ? { ...a, triggered: true, lastTriggerAt: at }
              : a,
          ),
        })),
    }),
    {
      name: "lucian-markets-price-alerts",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
        return localStorage;
      }),
    },
  ),
);

/**
 * Evaluate price alerts against the current live price for a symbol.
 * Called by the markets store's `updatePrice` hot path. Pure of side
 * effects except for the notification + store mutation it performs when
 * an alert fires.
 *
 * Behavior:
 *   - Skip disabled alerts.
 *   - Skip already-triggered alerts (prevents continuous firing while the
 *     condition remains true).
 *   - When the condition is newly met, fire ONE notification via
 *     `useNotificationStore.notify()` (deduped by
 *     `markets:price-alert-triggered:<symbol>:<condition>:<target>`),
 *     then mark the alert as triggered via `_markTriggered`.
 */
export function evaluateAlertsForSymbol(symbol: string, price: number): void {
  if (typeof window === "undefined") return;
  const state = usePriceAlertsStore.getState();
  const matching = state.alerts.filter(
    (a) => a.symbol === symbol && a.enabled && !a.triggered,
  );
  if (matching.length === 0) return;

  const now = Date.now();
  for (const alert of matching) {
    const conditionMet =
      alert.condition === "above"
        ? price >= alert.targetPrice
        : price <= alert.targetPrice;
    if (!conditionMet) continue;

    // Fire the notification. The dedupe key prevents re-firing while
    // the cooldown is in effect — but since we also set `triggered = true`
    // on the alert, the same alert cannot fire again until the user
    // re-arms it. The dedupe key is the second line of defense in case
    // the alert's `triggered` flag is reset by a parallel re-arm.
    useNotificationStore.getState().notify({
      source: "markets",
      event: "price-alert-triggered",
      title: `${alert.symbol} ${alert.condition} ${alert.targetPrice}`,
      message: `${alert.symbol} is now ${alert.condition === "above" ? "above" : "below"} $${alert.targetPrice} (current: $${price.toFixed(2)}).`,
      level: "info",
      actionable: true,
      deepLink: `/markets?symbol=${encodeURIComponent(alert.symbol)}`,
      entity: {
        module: "markets",
        type: "price-alert",
        id: `${alert.symbol}:${alert.condition}:${alert.targetPrice}`,
      },
      // Long cooldown (24h) — the alert's own `triggered` flag is the
      // primary re-arm gate; this just prevents accidental re-fires if
      // the user resets the alert while the price is still crossing.
      cooldownMs: 24 * 60 * 60 * 1000,
    });

    state._markTriggered(alert.id, now);
  }
}
