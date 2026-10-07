import {
  CryptoProvider,
  ProviderConnection,
  ProviderConnectionState,
  ProviderError,
  ProviderNotAuthenticatedError,
  WithdrawalResult,
  VerifiedWebhookEvent,
} from "./types";
import { Money } from "../money";

/**
 * Registry bridge for the generic Vault provider API. Actual Bybit operations
 * are owner-scoped in src/lib/bybit and never use this context-free adapter.
 */
export class BybitCryptoProvider implements CryptoProvider {
  readonly type = "crypto" as const;
  readonly name = "bybit";

  isConfigured(): boolean {
    return Boolean(process.env.BYBIT_API_KEY?.trim() && process.env.BYBIT_API_SECRET?.trim());
  }

  getState(): ProviderConnectionState {
    return this.isConfigured() ? "configured" : "not_configured";
  }

  isAuthenticated(): boolean {
    return false;
  }

  getConnection(): ProviderConnection {
    return {
      id: "bybit",
      type: "crypto",
      name: "bybit",
      configured: this.isConfigured(),
      state: this.getState(),
      authenticated: false,
      displayName: "Bybit",
      stateDetail: this.isConfigured()
        ? "Server fallback keys are present. Owner-scoped status performs the authenticated test."
        : "Save encrypted owner credentials in Settings → Connections.",
    };
  }

  private ownerScoped(): never {
    throw new ProviderNotAuthenticatedError("Bybit owner-scoped route");
  }

  async generateDepositAddress(_options: { asset: string; network: string }): Promise<{ address: string; qrCode?: string }> {
    return this.ownerScoped();
  }

  async getBalances(): Promise<Array<{ asset: string; network: string; quantity: string; fiatEquivalent: Money }>> {
    return this.ownerScoped();
  }

  async initiateWithdrawal(_options: { asset: string; network: string; amount: Money; destinationAddress: string; idempotencyKey: string }): Promise<WithdrawalResult> {
    return this.ownerScoped();
  }

  async validateAddress(options: { asset: string; network: string; address: string }): Promise<{ valid: boolean; reason?: string }> {
    const network = options.network.toUpperCase();
    if (!options.asset || !network || !/^[a-zA-Z0-9:_-]{8,200}$/.test(options.address)) {
      return { valid: false, reason: "Asset, network, and a syntactically valid address are required." };
    }
    if (options.asset === "BTC" && ["BTC", "BITCOIN"].includes(network)) {
      return /^(bc1[a-zA-HJ-NP-Z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(options.address)
        ? { valid: true }
        : { valid: false, reason: "Not a valid Bitcoin address." };
    }
    if (["ETH", "ETHEREUM", "ARBI", "OP", "BSC"].includes(network)) {
      return /^0x[a-fA-F0-9]{40}$/.test(options.address)
        ? { valid: true }
        : { valid: false, reason: `Not a valid ${options.network} address.` };
    }
    if (["SOL", "SOLANA"].includes(network)) {
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(options.address)
        ? { valid: true }
        : { valid: false, reason: "Not a valid Solana address." };
    }
    return { valid: true };
  }

  async verifyWebhookSignature(): Promise<boolean> {
    return false;
  }

  async parseWebhookEvent(): Promise<VerifiedWebhookEvent> {
    throw new ProviderError("Bybit account updates use authenticated REST refreshes in this build.", "bybit", "webhook_not_used");
  }
}
