// Risk Engine.
//
// Configurable risk rules that apply to BOTH Paper Mode and (future)
// Real Mode. No trading path — not even the Agent — can bypass these.
//
// Rules are stored in localStorage so the user's configuration survives
// page refreshes.

import type {
  AssetClass,
  OrderSide,
  Position,
  RiskCheckResult,
  RiskRules,
} from "./types";
import { getSpecForSymbol, unitsForVolume } from "./instrument-spec";

const STORAGE_KEY = "lucian-markets-risk-rules";

export const DEFAULT_RISK_RULES: RiskRules = {
  maxRiskPerTrade: 2,       // 2% of equity
  maxPositionSize: 50000,  // $50,000 per position
  maxDailyLoss: 10,        // 10% of equity
  maxWeeklyLoss: 20,       // 20% of equity
  maxOpenPositions: 10,
  maxLeverage: 10,         // 10x
  allowedAssetClasses: [],  // empty = all
  tradingCooldownMin: 0,   // disabled by default
  lossStreakProtection: 0,  // disabled by default
};

export function loadRiskRules(): RiskRules {
  if (typeof window === "undefined") return DEFAULT_RISK_RULES;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULT_RISK_RULES, ...JSON.parse(stored) };
  } catch {
    // storage unavailable
  }
  return DEFAULT_RISK_RULES;
}

export function saveRiskRules(rules: RiskRules): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rules));
  } catch {
    // storage unavailable
  }
}

interface RiskCheckInput {
  side: OrderSide;
  entryPrice: number;
  /** Volume in lots (Phase 2). Risk rules apply against the notional = entryPrice × volume × contractSize. */
  volume: number;
  stopLoss: number;
  equity: number;
  positions: Position[];
  riskRules: RiskRules;
  dailyLossAmount: number;
  weeklyLossAmount: number;
  consecutiveLosses: number;
  lastLossAt: number;
  symbol: string;
  assetClass?: AssetClass;
}

export function checkRisk(input: RiskCheckInput): RiskCheckResult {
  const r = input.riskRules;
  // Phase 2: notional uses the spec's contract size. For unknown symbols
  // the spec returns a forex-like default (contractSize=100_000), which
  // keeps the risk rules conservative.
  const spec = getSpecForSymbol(input.symbol);
  const units = unitsForVolume(spec, input.volume);
  const entryValue = units * input.entryPrice;

  // 1. Max open positions
  if (r.maxOpenPositions > 0 && input.positions.length >= r.maxOpenPositions) {
    return {
      passed: false,
      reason: `Maximum open positions reached (${r.maxOpenPositions}). Close an existing position before opening a new one.`,
      rule: "maxOpenPositions",
    };
  }

  // 2. Max position size
  if (r.maxPositionSize > 0 && entryValue > r.maxPositionSize) {
    return {
      passed: false,
      reason: `Position value $${entryValue.toFixed(2)} exceeds maximum $${r.maxPositionSize.toFixed(2)}.`,
      rule: "maxPositionSize",
    };
  }

  // 3. Max risk per trade (if stop loss is set, calculate the risk)
  if (r.maxRiskPerTrade > 0 && input.stopLoss > 0) {
    // Phase 2: risk = units × |entry − SL| (uses contract size).
    const riskPerUnit = Math.abs(input.entryPrice - input.stopLoss);
    const totalRisk = units * riskPerUnit;
    const maxRisk = (input.equity * r.maxRiskPerTrade) / 100;
    if (totalRisk > maxRisk) {
      return {
        passed: false,
        reason: `Trade risk $${totalRisk.toFixed(2)} exceeds ${r.maxRiskPerTrade}% of equity ($${maxRisk.toFixed(2)}).`,
        rule: "maxRiskPerTrade",
      };
    }
  }

  // 4. Max daily loss
  if (r.maxDailyLoss > 0) {
    const maxDailyLossAmount = (input.equity * r.maxDailyLoss) / 100;
    if (input.dailyLossAmount >= maxDailyLossAmount) {
      return {
        passed: false,
        reason: `Daily loss limit reached: $${input.dailyLossAmount.toFixed(2)} (max ${r.maxDailyLoss}% = $${maxDailyLossAmount.toFixed(2)}). Trading paused until tomorrow.`,
        rule: "maxDailyLoss",
      };
    }
  }

  // 5. Max weekly loss
  if (r.maxWeeklyLoss > 0) {
    const maxWeeklyLossAmount = (input.equity * r.maxWeeklyLoss) / 100;
    if (input.weeklyLossAmount >= maxWeeklyLossAmount) {
      return {
        passed: false,
        reason: `Weekly loss limit reached: $${input.weeklyLossAmount.toFixed(2)} (max ${r.maxWeeklyLoss}% = $${maxWeeklyLossAmount.toFixed(2)}). Trading paused until next week.`,
        rule: "maxWeeklyLoss",
      };
    }
  }

  // 6. Loss-streak protection
  if (r.lossStreakProtection > 0 && input.consecutiveLosses >= r.lossStreakProtection) {
    return {
      passed: false,
      reason: `Loss-streak protection active: ${input.consecutiveLosses} consecutive losses (limit: ${r.lossStreakProtection}). Take a break before trading again.`,
      rule: "lossStreakProtection",
    };
  }

  // 7. Trading cooldown
  if (r.tradingCooldownMin > 0 && input.lastLossAt > 0) {
    const cooldownMs = r.tradingCooldownMin * 60 * 1000;
    const elapsed = Date.now() - input.lastLossAt;
    if (elapsed < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - elapsed) / 60000);
      return {
        passed: false,
        reason: `Trading cooldown: ${remaining} min remaining after last loss.`,
        rule: "tradingCooldownMin",
      };
    }
  }

  // 8. Allowed asset classes
  if (r.allowedAssetClasses.length > 0 && input.assetClass) {
    if (!r.allowedAssetClasses.includes(input.assetClass)) {
      return {
        passed: false,
        reason: `Asset class "${input.assetClass}" is not in the allowed list.`,
        rule: "allowedAssetClasses",
      };
    }
  }

  // 9. Insufficient free margin
  if (entryValue > input.equity) {
    return {
      passed: false,
      reason: `Insufficient margin: position value $${entryValue.toFixed(2)} exceeds equity $${input.equity.toFixed(2)}.`,
      rule: "insufficientMargin",
    };
  }

  return { passed: true };
}
