import type { AutonomousPlan } from "@/lib/bybit/autonomous-policy";

export type SessionAccountLimits = { maxOrder: string; maxExposure: string; maxDailyLoss: string; maxPositions: number; maxLeverage: string };
export function ShortAccountSummary({ plan, limits }: { plan: AutonomousPlan; limits?: SessionAccountLimits }) {
  if (plan.product !== "linear_short") return null;
  const settings = plan.shortSettings;
  return <div className="space-y-2 rounded-lg border border-line p-3 text-sm" aria-label="Reviewed short account settings">
    <p className="font-medium">{settings ? settings.marginMode === "REGULAR_MARGIN" ? "Cross margin" : "Isolated margin" : "Legacy Isolated · 1× · one-way"}</p>
    {settings && plan.symbols.map(symbol => {
      const p = settings.positions[symbol];
      return <p key={symbol}>{symbol} · {p.leverage}× · {p.positionIdx === 2 ? "Hedge short slot" : "One-way"} · Automatic margin {settings.marginMode === "REGULAR_MARGIN" ? "not applicable in Cross" : p.autoAddMargin ? "on" : "off"}</p>;
    })}
    <p className="text-fg-muted">Maximum order is gross exposure including costs, not margin multiplied by leverage. Session capital budgets margin and stop risk. Account settings stay unchanged; a change after review blocks new entries.</p>
    {(settings?.marginMode === "REGULAR_MARGIN" || Object.values(settings?.positions ?? {}).some(p => p.autoAddMargin === 1)) && <p className="text-amber-500">Shared collateral: Cross margin or automatic margin additions can use account funds beyond the session allocation. Session limits and stops are not an exchange-enforced loss cap.</p>}
    {limits && <p className="text-fg-muted">Account limits: {limits.maxOrder} USDT per order · {limits.maxExposure} USDT gross exposure · {limits.maxDailyLoss} USDT daily loss stop · {limits.maxPositions} position(s) · {limits.maxLeverage}× maximum leverage. Stricter account limits still apply.</p>}
  </div>;
}
