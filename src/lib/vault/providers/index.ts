// LUCIAN Vault — Provider registry.
//
// This module provides a single source of truth for which providers are
// available. Each provider adapter wraps a specific SDK but exposes only
// the normalized interface from types.ts.
//
// HONEST STATE MODEL:
//   `getConnection().state` is the source of truth — never assume
//   `configured === connected`. The boolean `configured` only tells you
//   the env vars are present; the state field tells you whether money
//   can actually move through this provider.

import {
  PaymentProvider, BankProvider, CryptoProvider, BrokerProvider,
  ProviderConnection, ProviderConnectionState,
  ProviderNotConfiguredError, ProviderNotAuthenticatedError,
  ProviderError, ProviderStubError, WebhookSignatureError,
} from "./types";
import { StripePaymentProvider } from "./stripe";
import { PlaidBankProvider } from "./plaid";
import { BybitCryptoProvider } from "./bybit";
import { AlpacaBrokerProvider } from "./alpaca";

// Re-export error classes for API routes
export {
  ProviderNotConfiguredError,
  ProviderNotAuthenticatedError,
  ProviderError,
  ProviderStubError,
  WebhookSignatureError,
};
export type { ProviderConnection, ProviderConnectionState };

/* ── Singleton instances ── */

let _payment: PaymentProvider | null = null;
let _bank: BankProvider | null = null;
let _crypto: CryptoProvider | null = null;
let _broker: BrokerProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (!_payment) _payment = new StripePaymentProvider();
  return _payment;
}
export function getBankProvider(): BankProvider {
  if (!_bank) _bank = new PlaidBankProvider();
  return _bank;
}
export function getCryptoProvider(): CryptoProvider {
  if (!_crypto) _crypto = new BybitCryptoProvider();
  return _crypto;
}
export function getBrokerProvider(): BrokerProvider {
  if (!_broker) _broker = new AlpacaBrokerProvider();
  return _broker;
}

/** Get all provider connection statuses. */
export function getAllProviderConnections(): ProviderConnection[] {
  return [
    safeGetConnection(() => getPaymentProvider().getConnection()),
    safeGetConnection(() => getBankProvider().getConnection()),
    safeGetConnection(() => getCryptoProvider().getConnection()),
    safeGetConnection(() => getBrokerProvider().getConnection()),
  ];
}

/**
 * "Connected" means a genuine provider-side account link exists.
 * Stubs (state=setup_required) are NEVER connected.
 */
export function isAnyProviderConnected(): boolean {
  return getAllProviderConnections().some((c) => c.state === "connected");
}

/** Count of providers whose env vars are at least present. */
export function isAnyProviderConfigured(): boolean {
  return getAllProviderConnections().some((c) => c.configured);
}

function safeGetConnection(fn: () => ProviderConnection): ProviderConnection {
  try {
    return fn();
  } catch {
    return {
      id: "unknown",
      type: "payment",
      name: "unknown",
      configured: false,
      state: "not_configured",
      authenticated: false,
      displayName: "Not Connected",
      stateDetail: "Provider registry error.",
    };
  }
}

/** Require a provider to be configured (env vars present); throw if not. */
export function requirePaymentProvider(): PaymentProvider {
  const p = getPaymentProvider();
  if (!p.isConfigured()) throw new ProviderNotConfiguredError(p.name);
  return p;
}
export function requireBankProvider(): BankProvider {
  const p = getBankProvider();
  if (!p.isConfigured()) throw new ProviderNotConfiguredError(p.name);
  return p;
}
export function requireCryptoProvider(): CryptoProvider {
  const p = getCryptoProvider();
  if (!p.isConfigured()) throw new ProviderNotConfiguredError(p.name);
  return p;
}
export function requireBrokerProvider(): BrokerProvider {
  const p = getBrokerProvider();
  if (!p.isConfigured()) throw new ProviderNotConfiguredError(p.name);
  return p;
}
