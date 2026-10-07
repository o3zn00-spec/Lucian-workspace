// LUCIAN Vault — Alpaca Broker Provider adapter (STUB — honest state).
//
// SERVER-ONLY. Never import from a client component.
// Alpaca API keys are read from env and NEVER exposed to the browser.
//
// This adapter is a STUB: the real Alpaca SDK is not installed. Every
// live operation throws ProviderStubError.
//
// Honest state model:
//   - BROKER_API_KEY / BROKER_API_SECRET missing → not_configured
//   - Both present, but SDK not loaded             → setup_required
//   - "connected" requires a real brokerage account to be open and
//     funded — handled by the API layer.

import {
  BrokerProvider, ProviderConnection, ProviderConnectionState,
  TransferResult, VerifiedWebhookEvent,
  ProviderNotConfiguredError, ProviderStubError, ProviderError,
  deriveAdapterState,
} from "./types";
import { Money, fromMinor } from "../money";
import { isModuleInstalled } from "../sdk-probe";

const ALPACA_API_KEY = process.env.BROKER_API_KEY;
const ALPACA_API_SECRET = process.env.BROKER_API_SECRET;
const ALPACA_BASE_URL = process.env.BROKER_API_BASE_URL ?? "https://paper-api.alpaca.markets";

export class AlpacaBrokerProvider implements BrokerProvider {
  readonly type = "broker" as const;
  readonly name = "alpaca";

  isConfigured(): boolean {
    return !!ALPACA_API_KEY && !!ALPACA_API_SECRET;
  }

  getState(): ProviderConnectionState {
    return deriveAdapterState(this.isConfigured(), isModuleInstalled("@alpacahq/alpaca-trade-api"));
  }

  isAuthenticated(): boolean {
    return false;
  }

  getConnection(): ProviderConnection {
    const state = this.getState();
    return {
      id: "alpaca",
      type: "broker",
      name: "alpaca",
      configured: this.isConfigured(),
      state,
      authenticated: state === "connected",
      displayName: "Alpaca",
      stateDetail:
        state === "not_configured" ? "Missing BROKER_API_KEY / BROKER_API_SECRET." :
        state === "setup_required" ? `Keys present (base=${ALPACA_BASE_URL}), but @alpacahq/alpaca-trade-api is not installed. Install the SDK and wire up the calls to connect.` :
        state === "configured" ? "SDK ready. Open and fund a brokerage account to connect." :
        state === "connected" ? "Connected." :
        "See state detail.",
    };
  }

  private requireConfig(): void {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError("Alpaca");
    }
  }

  private async requireLive(operation: string): Promise<void> {
    this.requireConfig();
    if (!isModuleInstalled("@alpacahq/alpaca-trade-api")) {
      throw new ProviderStubError("Alpaca", operation);
    }
  }

  async getBalances(): Promise<{
    cash: Money; buyingPower: Money; openPositions: Money; reservedForOrders: Money;
  }> {
    await this.requireLive("getBalances");
    return {
      cash: fromMinor(0n, "USD"),
      buyingPower: fromMinor(0n, "USD"),
      openPositions: fromMinor(0n, "USD"),
      reservedForOrders: fromMinor(0n, "USD"),
    };
  }

  async getPositions(): Promise<Array<{ symbol: string; quantity: string; avgPrice: Money; marketValue: Money }>> {
    await this.requireLive("getPositions");
    return [];
  }

  async initiateFunding(options: { amount: Money; idempotencyKey: string }): Promise<TransferResult> {
    await this.requireLive("initiateFunding");
    if (options.amount.amount <= 0n) {
      throw new ProviderError("Amount must be positive.", "alpaca", "invalid_amount");
    }
    if (!options.idempotencyKey) {
      throw new ProviderError("Idempotency key required.", "alpaca", "missing_idempotency_key");
    }
    throw new ProviderStubError("Alpaca", "initiateFunding");
  }

  async initiateWithdrawal(options: { amount: Money; idempotencyKey: string }): Promise<TransferResult> {
    await this.requireLive("initiateWithdrawal");
    if (options.amount.amount <= 0n) {
      throw new ProviderError("Amount must be positive.", "alpaca", "invalid_amount");
    }
    throw new ProviderStubError("Alpaca", "initiateWithdrawal");
  }

  async verifyWebhookSignature(_payload: string | Buffer, _signature: string): Promise<boolean> {
    if (!process.env.BROKER_WEBHOOK_SECRET) {
      throw new ProviderNotConfiguredError("Alpaca Webhook");
    }
    // STUB: real verification is HMAC-SHA256. Never return true here.
    return false;
  }

  async parseWebhookEvent(payload: string | Buffer, signature: string): Promise<VerifiedWebhookEvent> {
    const valid = await this.verifyWebhookSignature(payload, signature);
    if (!valid) {
      throw new ProviderError("Webhook signature verification failed.", "alpaca", "signature_invalid");
    }
    throw new ProviderStubError("Alpaca", "parseWebhookEvent");
  }
}
