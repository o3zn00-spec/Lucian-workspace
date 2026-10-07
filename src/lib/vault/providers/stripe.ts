// LUCIAN Vault — Stripe Payment Provider adapter (STUB — honest state).
//
// SERVER-ONLY. Never import from a client component.
// Stripe secret keys are read from env and NEVER exposed to the browser.
//
// This adapter is a STUB: the real Stripe SDK is not installed in this
// project. Every live operation throws ProviderStubError.
//
// Honest state model:
//   - STRIPE_SECRET_KEY + NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY missing → not_configured
//   - Both present, but SDK not loaded                                → setup_required
//   - The state is NEVER "connected" until a real SDK is wired up
//     AND a Stripe customer / payment method exists for the user.
//
// API keys alone do NOT enable this provider.

import {
  PaymentProvider, ProviderConnection, ProviderConnectionState,
  DepositResult, WithdrawalResult, VerifiedWebhookEvent,
  ProviderNotConfiguredError, ProviderStubError, ProviderError,
  deriveAdapterState,
} from "./types";
import { Money } from "../money";
import { isModuleInstalled } from "../sdk-probe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

export class StripePaymentProvider implements PaymentProvider {
  readonly type = "payment" as const;
  readonly name = "stripe";

  isConfigured(): boolean {
    return !!STRIPE_SECRET_KEY && !!NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  }

  /**
   * Honest state:
   *   not_configured → env vars missing
   *   setup_required → env vars present, SDK not installed (this stub)
   *   configured      → env vars present AND SDK installed
   *
   * The state NEVER becomes "connected" from this method — that
   * requires a real customer / payment method link, handled by the API.
   */
  getState(): ProviderConnectionState {
    return deriveAdapterState(this.isConfigured(), isModuleInstalled("stripe"));
  }

  isAuthenticated(): boolean {
    // Stub never claims authenticated.
    return false;
  }

  getConnection(): ProviderConnection {
    const state = this.getState();
    return {
      id: "stripe",
      type: "payment",
      name: "stripe",
      configured: this.isConfigured(),
      state,
      authenticated: state === "connected",
      displayName: "Stripe",
      stateDetail:
        state === "not_configured" ? "Missing STRIPE_SECRET_KEY / NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY" :
        state === "setup_required" ? "Keys present, but the stripe npm package is not installed. Install `stripe` and wire up the SDK to begin card linking." :
        state === "configured" ? "SDK ready. Begin the card-link flow (Stripe Elements / SetupIntent) to connect." :
        state === "connected" ? "Connected." :
        "See state detail.",
    };
  }

  private requireConfig(): void {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError("Stripe");
    }
  }

  private async requireLive(operation: string): Promise<void> {
    this.requireConfig();
    if (!isModuleInstalled("stripe")) {
      throw new ProviderStubError("Stripe", operation);
    }
  }

  async createSetupIntent(_options: {
    currency: string;
    customerId?: string;
  }): Promise<{ clientSecret: string; setupIntentId: string }> {
    await this.requireLive("createSetupIntent");
    // PRODUCTION (when stripe is installed):
    //   const stripe = new Stripe(STRIPE_SECRET_KEY!);
    //   const intent = await stripe.setupIntents.create({
    //     currency: options.currency,
    //     customer: options.customerId,
    //     payment_method_types: ["card"],
    //   });
    //   return { clientSecret: intent.client_secret!, setupIntentId: intent.id };
    //
    // (Unreachable in stub mode — requireLive throws first.)
    throw new ProviderStubError("Stripe", "createSetupIntent");
  }

  async attachPaymentMethod(_options: { setupIntentId: string }): Promise<{
    paymentMethodId: string;
    brand: string;
    last4: string;
    expiryMonth: number;
    expiryYear: number;
    depositEligible: boolean;
    withdrawalEligible: boolean;
  }> {
    await this.requireLive("attachPaymentMethod");
    throw new ProviderStubError("Stripe", "attachPaymentMethod");
  }

  async listPaymentMethods(_customerId?: string): Promise<Array<{
    paymentMethodId: string;
    brand: string;
    last4: string;
    expiryMonth: number;
    expiryYear: number;
    isDefault: boolean;
    depositEligible: boolean;
    withdrawalEligible: boolean;
  }>> {
    await this.requireLive("listPaymentMethods");
    return [];
  }

  async initiateDeposit(options: {
    amount: Money;
    paymentMethodId: string;
    idempotencyKey: string;
    description?: string;
  }): Promise<DepositResult> {
    await this.requireLive("initiateDeposit");
    if (options.amount.amount <= 0n) {
      throw new ProviderError("Amount must be positive.", "stripe", "invalid_amount");
    }
    if (!options.paymentMethodId) {
      throw new ProviderError("Payment method ID required.", "stripe", "missing_payment_method");
    }
    if (!options.idempotencyKey) {
      throw new ProviderError("Idempotency key required.", "stripe", "missing_idempotency_key");
    }
    throw new ProviderStubError("Stripe", "initiateDeposit");
  }

  async initiateCardPayout(options: {
    amount: Money;
    paymentMethodId: string;
    idempotencyKey: string;
  }): Promise<WithdrawalResult> {
    await this.requireLive("initiateCardPayout");
    if (options.amount.amount <= 0n) {
      throw new ProviderError("Amount must be positive.", "stripe", "invalid_amount");
    }
    throw new ProviderStubError("Stripe", "initiateCardPayout");
  }

  async verifyWebhookSignature(_payload: string | Buffer, _signature: string): Promise<boolean> {
    if (!STRIPE_WEBHOOK_SECRET) {
      throw new ProviderNotConfiguredError("Stripe Webhook");
    }
    // STUB: real verification uses stripe.webhooks.constructEvent.
    // Never return true here — that would accept unverified webhooks.
    return false;
  }

  async parseWebhookEvent(payload: string | Buffer, signature: string): Promise<VerifiedWebhookEvent> {
    const valid = await this.verifyWebhookSignature(payload, signature);
    if (!valid) {
      throw new ProviderError("Webhook signature verification failed.", "stripe", "signature_invalid");
    }
    throw new ProviderStubError("Stripe", "parseWebhookEvent");
  }
}
