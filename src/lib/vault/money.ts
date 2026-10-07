// LUCIAN Vault — Money primitives.
//
// CRITICAL: We NEVER use floating-point arithmetic for authoritative
// financial amounts in the server ledger. All money is stored as integer
// minor units (cents for USD/EUR/GBP, etc.) and converted to display
// decimals only at the presentation layer.
//
// This module provides:
//   - Money type (minor-unit integer)
//   - Safe arithmetic (add, subtract, multiply, divide)
//   - Conversion to/from display decimals
//   - Currency validation
//   - Decimal-safe comparison

/** A monetary amount stored as integer minor units (e.g. cents).
 *  NEVER use `number` for authoritative money — only for display. */
export type Money = {
  /** Amount in minor units (e.g. cents). Must be an integer. */
  amount: bigint;
  /** ISO 4217 currency code (e.g. "USD", "EUR"). */
  currency: string;
};

/** Decimal places per currency (most common currencies). */
const CURRENCY_DECIMALS: Record<string, number> = {
  USD: 2, EUR: 2, GBP: 2, CAD: 2, AUD: 2, NZD: 2, CHF: 2,
  JPY: 0, KRW: 0, VND: 0,
  BTC: 8, ETH: 8, USDC: 6, USDT: 6, SOL: 9,
};

/** Get the number of decimal places for a currency. */
export function getDecimals(currency: string): number {
  return CURRENCY_DECIMALS[currency] ?? 2;
}

/** Create a Money value from minor units. */
export function fromMinor(amount: bigint | number, currency: string): Money {
  return {
    amount: typeof amount === "number" ? BigInt(amount) : amount,
    currency,
  };
}

/** Create a Money value from a decimal amount (e.g. 12.34 USD → 1234 cents).
 *  Uses string-based parsing to avoid floating-point errors. */
export function fromDecimal(decimal: string | number, currency: string): Money {
  const decimals = getDecimals(currency);
  const str = typeof decimal === "number" ? decimal.toFixed(decimals) : String(decimal).trim();

  // Validate format
  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    throw new Error(`Invalid decimal amount: ${str}`);
  }

  const negative = str.startsWith("-");
  const abs = negative ? str.slice(1) : str;
  const [whole, frac = ""] = abs.split(".");

  // Pad or truncate fraction to the required decimals
  const paddedFrac = (frac + "0".repeat(decimals)).slice(0, decimals);
  const combined = whole + paddedFrac;
  const amount = BigInt(combined) * (negative ? -1n : 1n);

  return { amount, currency };
}

/** Convert Money to a display decimal string (e.g. 1234 cents → "12.34"). */
export function toDecimal(money: Money): string {
  const decimals = getDecimals(money.currency);
  const negative = money.amount < 0n;
  const abs = negative ? -money.amount : money.amount;
  const str = abs.toString().padStart(decimals + 1, "0");

  if (decimals === 0) {
    return (negative ? "-" : "") + str;
  }

  const whole = str.slice(0, -decimals) || "0";
  const frac = str.slice(-decimals);
  return (negative ? "-" : "") + `${whole}.${frac}`;
}

/** Convert Money to a number for display purposes only.
 *  WARNING: This can lose precision for very large amounts. Use toDecimal()
 *  for authoritative display. */
export function toNumber(money: Money): number {
  return Number(toDecimal(money));
}

/** Add two money values (must be same currency). */
export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

/** Subtract money b from money a (must be same currency). */
export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount - b.amount, currency: a.currency };
}

/** Multiply money by an integer factor. */
export function multiplyInteger(money: Money, factor: bigint | number): Money {
  const f = typeof factor === "number" ? BigInt(factor) : factor;
  return { amount: money.amount * f, currency: money.currency };
}

/** Multiply money by a decimal factor (e.g. 0.015 for 1.5%).
 *  Uses integer-safe rounding (banker's rounding). */
export function multiplyDecimal(money: Money, factor: string | number): Money {
  // Parse factor as a fraction
  const str = typeof factor === "number" ? factor.toString() : factor;
  if (!/^\d+(\.\d+)?$/.test(str)) {
    throw new Error(`Invalid factor: ${str}`);
  }
  const [whole, frac = ""] = str.split(".");
  const factorDecimals = frac.length;
  const factorNum = BigInt(whole + frac);
  const scale = BigInt(10 ** factorDecimals);

  // Round half-to-even (banker's rounding)
  const product = money.amount * factorNum;
  const quotient = product / scale;
  const remainder = product % scale;
  const halfScale = scale / 2n;

  let result = quotient;
  if (remainder > halfScale) {
    result += 1n;
  } else if (remainder === halfScale && quotient % 2n !== 0n) {
    // Banker's rounding: round half to even
    result += 1n;
  }

  return { amount: result, currency: money.currency };
}

/** Check if money is positive (amount > 0). */
export function isPositive(money: Money): boolean {
  return money.amount > 0n;
}

/** Check if money is zero. */
export function isZero(money: Money): boolean {
  return money.amount === 0n;
}

/** Check if money is negative. */
export function isNegative(money: Money): boolean {
  return money.amount < 0n;
}

/** Compare two money values. Returns -1, 0, or 1. */
export function compare(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  if (a.amount < b.amount) return -1;
  if (a.amount > b.amount) return 1;
  return 0;
}

/** Check if a >= b. */
export function gte(a: Money, b: Money): boolean {
  return compare(a, b) >= 0;
}

/** Check if a <= b. */
export function lte(a: Money, b: Money): boolean {
  return compare(a, b) <= 0;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

/** Format money for display (delegates to Intl.NumberFormat). */
export function formatMoney(money: Money): string {
  const num = toNumber(money);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: money.currency,
      minimumFractionDigits: getDecimals(money.currency),
      maximumFractionDigits: getDecimals(money.currency),
    }).format(num);
  } catch {
    return `${toDecimal(money)} ${money.currency}`;
  }
}
