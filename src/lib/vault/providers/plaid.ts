// LUCIAN Vault — Plaid Bank Provider adapter (STUB — honest state).
//
// SERVER-ONLY. Never import from a client component.
// Plaid secrets are read from env and NEVER exposed to the browser.
//
// This adapter is a STUB: the real `plaid` SDK is not installed in this
// project. Every live operation throws ProviderStubError.
//
// Honest state model:
//   - BANK_PROVIDER_CLIENT_ID / BANK_PROVIDER_SECRET missing → not_configured
//   - Both present, but SDK not loaded                        → setup_required
//   - Even if SDK is loaded, "connected" requires the user to
//     complete the Plaid Link flow AND the access token to be persisted
//     in the ProviderConnection table — handled by the API layer.
//
// API keys alone do NOT enable this provider.

import {
  BankProvider, ProviderConnection, ProviderConnectionState,
  DepositResult, WithdrawalResult, VerifiedWebhookEvent,
  ProviderNotConfiguredError, ProviderStubError, ProviderError,
  deriveAdapterState,
} from "./types";
import { Money } from "../money";
import { isModuleInstalled } from "../sdk-probe";

const PLAID_CLIENT_ID = process.env.BANK_PROVIDER_CLIENT_ID;
const PLAID_SECRET = process.env.BANK_PROVIDER_SECRET;
const PLAID_ENV = process.env.BANK_PROVIDER_ENV ?? "sandbox";

export class PlaidBankProvider implements BankProvider {
  readonly type = "bank" as const;
  readonly name = "plaid";

  isConfigured(): boolean {
    return !!PLAID_CLIENT_ID && !!PLAID_SECRET;
  }

  getState(): ProviderConnectionState {
    return deriveAdapterState(this.isConfigured(), isModuleInstalled("plaid"));
  }

  isAuthenticated(): boolean {
    return false;
  }

  getConnection(): ProviderConnection {
    const state = this.getState();
    return {
      id: "plaid",
      type: "bank",
      name: "plaid",
      configured: this.isConfigured(),
      state,
      authenticated: state === "connected",
      displayName: "Plaid",
      stateDetail:
        state === "not_configured" ? `Missing BANK_PROVIDER_CLIENT_ID / BANK_PROVIDER_SECRET (env=${PLAID_ENV}).` :
        state === "setup_required" ? "Keys present, but the plaid npm package is not installed. Install `plaid` and wire up the SDK to begin bank linking." :
        state === "configured" ? "SDK ready. Begin the Plaid Link flow to connect a bank." :
        state === "connected" ? "Connected." :
        "See state detail.",
    };
  }

  private requireConfig(): void {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError("Plaid");
    }
  }

  private async requireLive(operation: string): Promise<void> {
    this.requireConfig();
    if (!isModuleInstalled("plaid")) {
      throw new ProviderStubError("Plaid", operation);
    }
  }

  async createLinkToken(_options: { userId: string; webhookUrl?: string }): Promise<{ linkToken: string; expiration: number }> {
    await this.requireLive("createLinkToken");
    if (!_options.userId) {
      throw new ProviderError("User ID required.", "plaid", "missing_user_id");
    }
    throw new ProviderStubError("Plaid", "createLinkToken");
  }

  async exchangePublicToken(_publicToken: string): Promise<{ accessToken: string; itemId: string }> {
    await this.requireLive("exchangePublicToken");
    if (!_publicToken) {
      throw new ProviderError("Public token required.", "plaid", "missing_public_token");
    }
    throw new ProviderStubError("Plaid", "exchangePublicToken");
  }

  async listBankAccounts(_accessToken: string): Promise<Array<{
    bankAccountId: string; bankName: string;
    accountType: "checking" | "savings"; last4: string;
    verified: boolean; depositEligible: boolean; withdrawalEligible: boolean;
  }>> {
    await this.requireLive("listBankAccounts");
    if (!_accessToken) {
      throw new ProviderError("Access token required.", "plaid", "missing_access_token");
    }
    return [];
  }

  async initiateDeposit(options: { amount: Money; bankAccountId: string; idempotencyKey: string }): Promise<DepositResult> {
    await this.requireLive("initiateDeposit");
    if (options.amount.amount <= 0n) {
      throw new ProviderError("Amount must be positive.", "plaid", "invalid_amount");
    }
    if (!options.bankAccountId) {
      throw new ProviderError("Bank account ID required.", "plaid", "missing_bank_account");
    }
    throw new ProviderStubError("Plaid", "initiateDeposit");
  }

  async initiateWithdrawal(options: { amount: Money; bankAccountId: string; idempotencyKey: string }): Promise<WithdrawalResult> {
    await this.requireLive("initiateWithdrawal");
    if (options.amount.amount <= 0n) {
      throw new ProviderError("Amount must be positive.", "plaid", "invalid_amount");
    }
    throw new ProviderStubError("Plaid", "initiateWithdrawal");
  }

  async verifyWebhookSignature(_payload: string | Buffer, _signature: string): Promise<boolean> {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError("Plaid Webhook");
    }
    // STUB: real verification uses Plaid's JWT-based webhook verification
    // with the PLAID_SECRET. Never return true here.
    return false;
  }

  async parseWebhookEvent(payload: string | Buffer, signature: string): Promise<VerifiedWebhookEvent> {
    const valid = await this.verifyWebhookSignature(payload, signature);
    if (!valid) {
      throw new ProviderError("Webhook signature verification failed.", "plaid", "signature_invalid");
    }
    throw new ProviderStubError("Plaid", "parseWebhookEvent");
  }
}
