// LUCIAN Vault — Server-side validation helpers.
//
// CRITICAL: All financial APIs MUST validate inputs server-side.
// Never trust client-submitted data.

import { fromDecimal, Money, getDecimals } from "./money";

/** Result of input validation. */
export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** Validate a positive amount in minor units (integer string or number). */
export function validateAmount(amount: unknown, currency: string): ValidationResult<Money> {
  if (amount === undefined || amount === null) {
    return { ok: false, error: "Amount is required." };
  }

  // Amount must be a non-negative integer (in minor units)
  const num = typeof amount === "string" ? parseInt(amount, 10) : amount;
  if (typeof num !== "number" || !Number.isInteger(num)) {
    return { ok: false, error: "Amount must be an integer (in minor units)." };
  }
  if (num < 0) {
    return { ok: false, error: "Amount cannot be negative." };
  }
  if (num === 0) {
    return { ok: false, error: "Amount must be greater than zero." };
  }

  // Validate currency
  if (!currency || typeof currency !== "string" || currency.length !== 3) {
    return { ok: false, error: "Currency must be a 3-letter ISO code." };
  }

  return { ok: true, value: { amount: BigInt(num), currency: currency.toUpperCase() } };
}

/** Validate a currency code. */
export function validateCurrency(currency: unknown): ValidationResult<string> {
  if (typeof currency !== "string" || currency.length !== 3) {
    return { ok: false, error: "Currency must be a 3-letter ISO code." };
  }
  return { ok: true, value: currency.toUpperCase() };
}

/** Validate an idempotency key. */
export function validateIdempotencyKey(key: unknown): ValidationResult<string> {
  if (typeof key !== "string" || key.length === 0) {
    return { ok: false, error: "Idempotency key is required." };
  }
  if (key.length > 256) {
    return { ok: false, error: "Idempotency key is too long (max 256 chars)." };
  }
  if (!/^[a-zA-Z0-9_\-]+$/.test(key)) {
    return { ok: false, error: "Idempotency key contains invalid characters." };
  }
  return { ok: true, value: key };
}

/** Validate a crypto address format (basic). */
export function validateCryptoAddress(address: unknown): ValidationResult<string> {
  if (typeof address !== "string" || address.length === 0) {
    return { ok: false, error: "Address is required." };
  }
  if (address.length > 200) {
    return { ok: false, error: "Address is too long." };
  }
  // Allow common crypto address characters
  if (!/^[a-zA-Z0-9]+$/.test(address)) {
    return { ok: false, error: "Address contains invalid characters." };
  }
  return { ok: true, value: address };
}

/** Validate a withdrawal destination type. */
export function validateDestinationType(type: unknown): ValidationResult<"bank" | "card" | "crypto"> {
  if (type !== "bank" && type !== "card" && type !== "crypto") {
    return { ok: false, error: "Destination type must be 'bank', 'card', or 'crypto'." };
  }
  return { ok: true, value: type };
}

/** Standard JSON API response helper. */
export function apiResponse<T>(data: T, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Standard JSON error response helper. */
export function apiError(error: string, status: number = 400, code?: string): Response {
  return apiResponse({ error, code }, status);
}

/** Get and validate the Idempotency-Key header from a request. */
export function getIdempotencyKey(req: Request): ValidationResult<string> {
  const key = req.headers.get("Idempotency-Key");
  return validateIdempotencyKey(key);
}
