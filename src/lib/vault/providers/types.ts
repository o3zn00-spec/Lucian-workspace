// LUCIAN Vault — Provider adapter interfaces.
//
// Vault code NEVER talks directly to a specific provider SDK.
// All provider interactions go through these interfaces, so providers
// can be swapped without touching Vault logic.
//
// Each adapter:
//   - Wraps a provider SDK (Stripe, Plaid, Bybit, Alpaca, etc.)
//   - Validates inputs server-side
//   - Never exposes secret keys to the browser
//   - Returns normalized results (no provider-specific shapes leak)
//   - Reports its HONEST connection state — never "connected" just
//     because env keys are set
//
// Connection-state model (the source of truth for "is the provider live"):
//
//   not_configured  — env vars missing
//   configured       — env vars present (adapter can be constructed)
//   setup_required   — env vars present, but adapter is a stub OR user
//                      has not yet completed the provider-side link flow
//   connecting       — user is mid-flow (e.g. Plaid Link modal open)
//   connected        — a genuine provider-side account link exists
//   restricted       — provider returned a restricted / limited state
//   error            — provider-side error; needs human attention
//
// STUB ADAPTERS (no real SDK loaded) are ALWAYS at most `setup_required`
// when env vars are present, NEVER `connected`. API keys alone do NOT
// enable a stub provider.

import { Money } from "../money";

export type ProviderType = "payment" | "bank" | "crypto" | "broker";

/** Honest connection state. Distinct from "configured" (env vars present). */
export type ProviderConnectionState =
  | "not_configured"
  | "configured"
  | "setup_required"
  | "connecting"
  | "connected"
  | "restricted"
  | "error";

/** A connected provider. */
export interface ProviderConnection {
  id: string;
  type: ProviderType;
  name: string;
  /** Env vars present (legacy boolean). */
  configured: boolean;
  /** Honest state — see ProviderConnectionState above. */
  state: ProviderConnectionState;
  /** Legacy alias for `state === "connected"`. Always derived from state. */
  authenticated: boolean;
  /** Display name for UI. */
  displayName: string;
  /** Human-readable explanation of the current state, for the UI. */
  stateDetail?: string;
  /** When the connection was established (ms since epoch), if connected. */
  connectedAt?: number;
}

/** Result of a deposit initiation. */
export interface DepositResult {
  transactionId: string;
  providerTransactionId?: string;
  status: "pending" | "processing" | "requires-action" | "completed" | "failed";
  clientSecret?: string;
  message?: string;
  nextActionUrl?: string;
}

export interface WithdrawalResult {
  transactionId: string;
  providerTransactionId?: string;
  status: "requested" | "pending" | "processing" | "completed" | "failed";
  message?: string;
  estimatedArrival?: number;
  fee?: Money;
}

export interface TransferResult {
  transactionId: string;
  providerTransactionId?: string;
  status: "pending" | "processing" | "completed" | "failed";
  message?: string;
}

/** A verified webhook event from a provider. */
export interface VerifiedWebhookEvent {
  provider: string;
  eventId: string;
  eventType: string;
  /** Internal transaction ID this event relates to (if known). */
  transactionId?: string;
  /** Provider's own transaction ID — used to locate the original. */
  providerTransactionId?: string;
  /** New status to apply (provider-reported). */
  newStatus?: "pending" | "processing" | "requires-action" | "completed" | "failed" | "cancelled";
  /** Amount (if relevant). */
  amount?: Money;
  /** Raw event payload (for audit). */
  rawPayload: unknown;
  /** When the event was created by the provider. */
  eventCreatedAt: number;
}

/* ── Payment Provider Interface (Cards) ── */

export interface PaymentProvider {
  readonly type: "payment";
  readonly name: string;

  /** Env vars present (boolean). Use getState() for the honest state. */
  isConfigured(): boolean;

  /** Honest connection state. */
  getState(): ProviderConnectionState;

  /** Convenience: state === "connected". */
  isAuthenticated(): boolean;

  /** Get provider connection status. */
  getConnection(): ProviderConnection;

  createSetupIntent?(options: {
    currency: string;
    customerId?: string;
  }): Promise<{ clientSecret: string; setupIntentId: string }>;

  attachPaymentMethod?(options: {
    setupIntentId: string;
  }): Promise<{
    paymentMethodId: string;
    brand: string;
    last4: string;
    expiryMonth: number;
    expiryYear: number;
    depositEligible: boolean;
    withdrawalEligible: boolean;
  }>;

  listPaymentMethods?(customerId?: string): Promise<Array<{
    paymentMethodId: string;
    brand: string;
    last4: string;
    expiryMonth: number;
    expiryYear: number;
    isDefault: boolean;
    depositEligible: boolean;
    withdrawalEligible: boolean;
  }>>;

  initiateDeposit(options: {
    amount: Money;
    paymentMethodId: string;
    idempotencyKey: string;
    description?: string;
  }): Promise<DepositResult>;

  initiateCardPayout?(options: {
    amount: Money;
    paymentMethodId: string;
    idempotencyKey: string;
  }): Promise<WithdrawalResult>;

  verifyWebhookSignature(payload: string | Buffer, signature: string): Promise<boolean>;
  parseWebhookEvent(payload: string | Buffer, signature: string): Promise<VerifiedWebhookEvent>;
}

/* ── Bank Provider Interface ── */

export interface BankProvider {
  readonly type: "bank";
  readonly name: string;
  isConfigured(): boolean;
  getState(): ProviderConnectionState;
  isAuthenticated(): boolean;
  getConnection(): ProviderConnection;

  createLinkToken(options: {
    userId: string;
    webhookUrl?: string;
  }): Promise<{ linkToken: string; expiration: number }>;

  exchangePublicToken(publicToken: string): Promise<{
    accessToken: string;
    itemId: string;
  }>;

  listBankAccounts(accessToken: string): Promise<Array<{
    bankAccountId: string;
    bankName: string;
    accountType: "checking" | "savings";
    last4: string;
    verified: boolean;
    depositEligible: boolean;
    withdrawalEligible: boolean;
  }>>;

  initiateDeposit(options: {
    amount: Money;
    bankAccountId: string;
    idempotencyKey: string;
  }): Promise<DepositResult>;

  initiateWithdrawal(options: {
    amount: Money;
    bankAccountId: string;
    idempotencyKey: string;
  }): Promise<WithdrawalResult>;

  verifyWebhookSignature(payload: string | Buffer, signature: string): Promise<boolean>;
  parseWebhookEvent(payload: string | Buffer, signature: string): Promise<VerifiedWebhookEvent>;
}

/* ── Crypto Provider Interface ── */

export interface CryptoProvider {
  readonly type: "crypto";
  readonly name: string;
  isConfigured(): boolean;
  getState(): ProviderConnectionState;
  isAuthenticated(): boolean;
  getConnection(): ProviderConnection;

  generateDepositAddress(options: {
    asset: string;
    network: string;
  }): Promise<{ address: string; qrCode?: string }>;

  getBalances(): Promise<Array<{
    asset: string;
    network: string;
    quantity: string;
    fiatEquivalent: Money;
  }>>;

  initiateWithdrawal(options: {
    asset: string;
    network: string;
    amount: Money;
    destinationAddress: string;
    idempotencyKey: string;
  }): Promise<WithdrawalResult>;

  validateAddress(options: {
    asset: string;
    network: string;
    address: string;
  }): Promise<{ valid: boolean; reason?: string }>;

  verifyWebhookSignature(payload: string | Buffer, signature: string): Promise<boolean>;
  parseWebhookEvent(payload: string | Buffer, signature: string): Promise<VerifiedWebhookEvent>;
}

/* ── Broker Provider Interface ── */

export interface BrokerProvider {
  readonly type: "broker";
  readonly name: string;
  isConfigured(): boolean;
  getState(): ProviderConnectionState;
  isAuthenticated(): boolean;
  getConnection(): ProviderConnection;

  getBalances(): Promise<{
    cash: Money;
    buyingPower: Money;
    openPositions: Money;
    reservedForOrders: Money;
  }>;

  getPositions(): Promise<Array<{
    symbol: string;
    quantity: string;
    avgPrice: Money;
    marketValue: Money;
  }>>;

  initiateFunding(options: {
    amount: Money;
    idempotencyKey: string;
  }): Promise<TransferResult>;

  initiateWithdrawal(options: {
    amount: Money;
    idempotencyKey: string;
  }): Promise<TransferResult>;

  verifyWebhookSignature(payload: string | Buffer, signature: string): Promise<boolean>;
  parseWebhookEvent(payload: string | Buffer, signature: string): Promise<VerifiedWebhookEvent>;
}

/* ── Errors ── */

export class ProviderNotConfiguredError extends Error {
  constructor(providerName: string) {
    super(`Provider "${providerName}" is not configured. Set the required environment variables.`);
    this.name = "ProviderNotConfiguredError";
  }
}

export class ProviderNotAuthenticatedError extends Error {
  constructor(providerName: string) {
    super(`Provider "${providerName}" is not authenticated. Complete the auth flow first.`);
    this.name = "ProviderNotAuthenticatedError";
  }
}

/**
 * Thrown when a stub adapter (no real SDK loaded) is asked to perform a
 * live operation. API routes surface this as a 503 with a clear message.
 */
export class ProviderStubError extends Error {
  constructor(providerName: string, operation: string) {
    super(
      `Provider "${providerName}" is a STUB. The ${operation} operation requires the real ` +
      `provider SDK to be installed and wired up. API keys alone do NOT enable this provider.`,
    );
    this.name = "ProviderStubError";
  }
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class WebhookSignatureError extends Error {
  constructor(provider: string) {
    super(`Webhook signature verification failed for provider "${provider}".`);
    this.name = "WebhookSignatureError";
  }
}

/**
 * Determine the honest state for an adapter.
 *
 * `envConfigured` = the env vars the adapter needs are present.
 * `sdkLoaded`     = the adapter has a real provider SDK to call (not a stub).
 *
 *   !envConfigured               → not_configured
 *   envConfigured && !sdkLoaded  → setup_required   (stub or SDK missing)
 *   envConfigured && sdkLoaded   → configured        (ready to begin user link flow)
 *
 * The `connected` state can ONLY be reached after the user completes
 * the provider-side link flow AND we persist that fact in the
 * ProviderConnection row. That transition is handled by the API layer,
 * not by this helper.
 */
export function deriveAdapterState(
  envConfigured: boolean,
  sdkLoaded: boolean,
): ProviderConnectionState {
  if (!envConfigured) return "not_configured";
  if (!sdkLoaded) return "setup_required";
  return "configured";
}
