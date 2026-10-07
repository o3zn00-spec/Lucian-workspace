"use client";

// LUCIAN Vault — Real-Money Foundation.
//
// This is the CONTROL LAYER state for LUCIAN's financial center.
// It is NOT the bank, card processor, broker, or crypto custodian.
//
// Architecture:
//   Provider (bank/card/crypto/broker)
//     → verified provider event (webhook)
//       → LUCIAN server ledger
//         → realtime Vault state
//           → UI
//
// This Zustand store handles:
//   - UI state, preferences, manual accounts (self-reported)
//   - Client-side cache of server-derived balances (for responsiveness)
//   - Auto Fund configuration
//   - Security settings
//
// It is NEVER the source of truth for provider-verified money.
// Provider money is server-derived from the ledger.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/* ── Money type ── */
//
// We NEVER use floating-point for authoritative money in the server ledger.
// On the client, displayed amounts are derived from server minor-unit values
// (integer cents) and formatted via formatMoney(). The `number` type here is
// only for UI convenience and is always re-fetched from the server.
//
// For manual/self-reported accounts (clearly labeled MANUAL), the user enters
// a decimal amount which is stored locally — these are NOT provider balances.

/* ── Account model ── */

export type VaultAccountType =
  | "bank"
  | "card"
  | "crypto-wallet"
  | "brokerage"
  | "trading";

export type VaultAccountSource = "manual" | "provider";

export interface ConnectedAccount {
  id: string;
  label: string;
  type: VaultAccountType;
  source: VaultAccountSource;
  /** Descriptive only for manual; provider name for provider-linked. */
  provider: string;
  /** Last 4 chars — never full numbers. */
  maskedIdentifier: string;
  /** Available balance (UI display, server-derived for provider accounts). */
  balance: number;
  currency: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
  /** Provider connection ID — only set when source === "provider". */
  providerConnectionId?: string;
  /** Provider capability flags (only meaningful when source === "provider"). */
  capabilities?: {
    depositEligible: boolean;
    withdrawalEligible: boolean;
  };
}

/* ── Payment Methods (Cards) ── */
//
// Cards are PAYMENT METHODS, not accounts.
// We never store PAN or CVV — only safe provider references + display metadata.

export interface PaymentMethod {
  id: string;
  /** Stripe-style provider payment method ID (e.g. pm_...). */
  providerPaymentMethodId: string;
  brand: "visa" | "mastercard" | "amex" | "discover" | "unknown";
  last4: string;
  expiryMonth: number; // 1-12
  expiryYear: number; // 4-digit
  /** Whether this is the default payment method. */
  isDefault: boolean;
  /** Provider capability — deposit eligible. */
  depositEligible: boolean;
  /** Provider capability — withdrawal/payout eligible. */
  withdrawalEligible: boolean;
  /** Display name (e.g. "Visa •••• 4281"). */
  displayName: string;
  addedAt: number;
}

/* ── Bank Accounts ── */

export interface BankAccount {
  id: string;
  /** Provider bank account ID. */
  providerBankAccountId: string;
  bankName: string;
  accountType: "checking" | "savings";
  last4: string;
  /** Verified status — provider-confirmed micro-deposit or instant. */
  verified: boolean;
  depositEligible: boolean;
  withdrawalEligible: boolean;
  displayName: string;
  addedAt: number;
}

/* ── Crypto Wallets ── */

export type CryptoAssetSymbol = "BTC" | "ETH" | "USDC" | "USDT" | "SOL";
export type CryptoNetwork =
  | "bitcoin"
  | "ethereum"
  | "solana"
  | "polygon"
  | "base"
  | "arbitrum";

export interface CryptoWallet {
  id: string;
  asset: CryptoAssetSymbol;
  network: CryptoNetwork;
  /** Wallet address (public, never private key). */
  address: string;
  /** Display label, e.g. "BTC Cold Wallet". */
  label: string;
  /** Whether this is a withdrawal destination. */
  isWithdrawalDestination: boolean;
  addedAt: number;
}

/* ── Withdrawal Destinations ── */
//
// A withdrawal destination is any place money can be sent to LEAVE the
// LUCIAN financial environment. This is distinct from an internal
// transfer destination.

export type WithdrawalDestinationType = "bank" | "card" | "crypto";

export interface WithdrawalDestination {
  id: string;
  type: WithdrawalDestinationType;
  /** Reference ID — bankAccountId, paymentMethodId, or cryptoWalletId. */
  referenceId: string;
  /** Display label, e.g. "Chase •••• 0921" or "BTC Cold Wallet". */
  label: string;
  /** Eligible asset/currency for this destination. */
  asset: string;
  /** Eligible network (for crypto). */
  network?: CryptoNetwork;
  /** Whether this destination is currently approved for withdrawals. */
  approved: boolean;
  /** New-destination security delay (timestamp until approved). */
  approvedAt?: number;
  addedAt: number;
}

/* ── Capital Pool / Budget Allocation ── */
//
// Budget allocations are INTERNAL LUCIAN bookkeeping.
// They are NOT automatic real provider transfers.
// They represent how the user has earmarked capital for budgeting.

export interface BudgetAllocation {
  id: string;
  label: string;
  /** Current allocated amount (internal ledger, not a balance change). */
  allocated: number;
  /** Whether this pool feeds into Virtual Markets trading. */
  feedsMarkets: boolean;
  /** Budget cap (0 = no cap). */
  cap: number;
}

/* ── Activity / Ledger Timeline ── */

export type VaultTransactionType =
  | "account-created"
  | "account-edited"
  | "balance-updated"
  | "account-removed"
  | "local-transfer"
  | "pool-allocation"
  | "pool-deallocation"
  | "security-event"
  | "card-deposit"
  | "bank-deposit"
  | "crypto-deposit"
  | "bank-withdrawal"
  | "card-withdrawal"
  | "crypto-withdrawal"
  | "internal-transfer"
  | "brokerage-funding"
  | "brokerage-trade"
  | "auto-fund"
  | "webhook-event";

export type VaultTransactionStatus =
  | "pending"
  | "processing"
  | "requires-action"
  | "completed"
  | "failed"
  | "cancelled"
  | "requested";

export interface VaultTransaction {
  id: string;
  /** Internal transaction ID. */
  type: VaultTransactionType;
  /** Source account / pool name. */
  from: string;
  /** Destination account / pool name. */
  to: string;
  amount: number;
  currency: string;
  timestamp: number;
  description: string;
  status: VaultTransactionStatus;
  /** Snapshot of account label. */
  accountLabel?: string;
  /** Provider transaction ID (only for provider-backed activity). */
  providerTransactionId?: string;
  /** Provider name. */
  provider?: string;
  /** Asset/currency metadata. */
  asset?: string;
  /** Network (for crypto). */
  network?: CryptoNetwork;
  /** Source reference. */
  source?: string;
  /** Destination reference. */
  destination?: string;
  /** Freeform metadata. */
  metadata?: Record<string, unknown>;
}

/* ── Balance History ── */

export interface BalanceHistoryEntry {
  id: string;
  accountId: string;
  timestamp: number;
  oldBalance: number;
  newBalance: number;
  currency: string;
  reason: string;
}

/* ── Balances ── */
//
// Derived from server ledger. UI shows these as the authoritative view.
// Until a provider is connected, these are zero with a clear
// "Provider not connected" state.

export interface VaultBalances {
  cash: {
    available: number;
    pending: number;
    reserved: number;
    withdrawable: number;
    currency: string;
  };
  trading: {
    cash: number;
    buyingPower: number;
    openPositions: number;
    reservedForOrders: number;
    currency: string;
  };
  crypto: {
    holdings: Array<{
      asset: CryptoAssetSymbol;
      quantity: number;
      fiatEquivalent: number;
      currency: string;
    }>;
    totalFiatEquivalent: number;
    currency: string;
  };
  /** Total of all categories. */
  totalValue: number;
  totalCurrency: string;
  /** Whether balances come from a real provider (otherwise manual cache). */
  providerConnected: boolean;
}

/* ── Auto Fund ── */

export interface AutoFundConfig {
  enabled: boolean;
  /** Funding source reference ID (payment method or bank). */
  fundingSourceId: string | null;
  fundingSourceType: "card" | "bank" | null;
  /** Trigger when available falls below this. */
  lowBalanceThreshold: number;
  /** Top-up amount per trigger. */
  topUpAmount: number;
  /** Daily limit. */
  dailyLimit: number;
  /** Monthly limit. */
  monthlyLimit: number;
  /** Maximum single top-up. */
  maxSingleTopUp: number;
  /** Minimum interval between triggers (ms). */
  minTriggerIntervalMs: number;
  /** Max retries on failure. */
  maxRetries: number;
  /** Whether real Auto Fund is provider-ready. */
  providerReady: boolean;
}

/* ── Security ── */

export interface VaultSecuritySettings {
  requireWithdrawalVerification: boolean;
  /** 2FA integration hook — placeholder until auth exists. */
  twoFactorRequired: boolean;
  twoFactorConfigured: boolean;
  /** New destination delay (hours). */
  newDestinationDelayHours: number;
  /** Daily fiat withdrawal limit. */
  dailyFiatWithdrawalLimit: number;
  /** Daily crypto withdrawal limit (in fiat equivalent). */
  dailyCryptoWithdrawalLimitFiat: number;
  /** Large transaction alert threshold. */
  largeTransactionThreshold: number;
  /** Crypto address allowlist. */
  cryptoAddressAllowlist: Array<{ address: string; label: string }>;
  /** New-device withdrawal restriction. */
  newDeviceWithdrawalRestriction: boolean;
  /** Mask sensitive balances. */
  maskSensitiveValues: boolean;
  /** Require session re-authentication after timeout. */
  sessionTimeoutMin: number;
}

/* ── Settings ── */

export interface VaultSettings {
  hideBalances: boolean;
  baseCurrency: string;
  defaultView: VaultTab;
  notifications: {
    transfers: boolean;
    balanceChanges: boolean;
    largeTransfers: boolean;
  };
  security: VaultSecuritySettings;
}

export type VaultTab =
  | "overview"
  | "money"
  | "accounts"
  | "balances"
  | "transfers"
  | "activity"
  | "assets"
  | "security";

const DEFAULT_SECURITY: VaultSecuritySettings = {
  requireWithdrawalVerification: true,
  twoFactorRequired: false,
  twoFactorConfigured: false,
  newDestinationDelayHours: 24,
  dailyFiatWithdrawalLimit: 10000,
  dailyCryptoWithdrawalLimitFiat: 5000,
  largeTransactionThreshold: 1000,
  cryptoAddressAllowlist: [],
  newDeviceWithdrawalRestriction: true,
  maskSensitiveValues: false,
  sessionTimeoutMin: 30,
};

const DEFAULT_SETTINGS: VaultSettings = {
  hideBalances: false,
  baseCurrency: "USD",
  defaultView: "overview",
  notifications: {
    transfers: true,
    balanceChanges: false,
    largeTransfers: true,
  },
  security: DEFAULT_SECURITY,
};

const DEFAULT_ALLOCATIONS: BudgetAllocation[] = [
  { id: "trading", label: "Trading", allocated: 0, feedsMarkets: true, cap: 0 },
  { id: "investing", label: "Investing", allocated: 0, feedsMarkets: false, cap: 0 },
  { id: "business", label: "Business", allocated: 0, feedsMarkets: false, cap: 0 },
  { id: "research", label: "Research", allocated: 0, feedsMarkets: false, cap: 0 },
  { id: "infrastructure", label: "Infrastructure", allocated: 0, feedsMarkets: false, cap: 0 },
  { id: "advertising", label: "Advertising", allocated: 0, feedsMarkets: false, cap: 0 },
  { id: "experiments", label: "Experiments", allocated: 0, feedsMarkets: false, cap: 0 },
  { id: "reserve", label: "Reserve", allocated: 0, feedsMarkets: false, cap: 0 },
  { id: "agent", label: "Agent Capital", allocated: 0, feedsMarkets: false, cap: 0 },
];

const DEFAULT_AUTO_FUND: AutoFundConfig = {
  enabled: false,
  fundingSourceId: null,
  fundingSourceType: null,
  lowBalanceThreshold: 1000,
  topUpAmount: 3000,
  dailyLimit: 10000,
  monthlyLimit: 30000,
  maxSingleTopUp: 5000,
  minTriggerIntervalMs: 60 * 60 * 1000, // 1 hour
  maxRetries: 3,
  providerReady: false,
};

export interface VaultState {
  // Manual data (localStorage)
  accounts: ConnectedAccount[];
  allocations: BudgetAllocation[];
  transactions: VaultTransaction[];
  balanceHistory: BalanceHistoryEntry[];

  // Client cache of server-derived data (re-fetched from API)
  paymentMethods: PaymentMethod[];
  bankAccounts: BankAccount[];
  cryptoWallets: CryptoWallet[];
  withdrawalDestinations: WithdrawalDestination[];
  balances: VaultBalances;
  autoFund: AutoFundConfig;

  settings: VaultSettings;
  locked: boolean;
  lastActivityAt: number;

  // Account actions (manual only)
  addAccount: (account: Omit<ConnectedAccount, "id" | "createdAt" | "updatedAt" | "source"> & { source?: VaultAccountSource }) => void;
  editAccount: (id: string, patch: Partial<Omit<ConnectedAccount, "id" | "createdAt">>) => void;
  removeAccount: (id: string) => void;

  // Local transfer (manual only — same currency)
  localTransfer: (fromId: string, toId: string, amount: number) => { success: boolean; error?: string };

  // Budget allocation actions (internal bookkeeping)
  allocateToPool: (poolId: string, amount: number) => { success: boolean; error?: string };
  deallocateFromPool: (poolId: string, amount: number) => { success: boolean; error?: string };
  setAllocationCap: (poolId: string, cap: number) => void;

  // Server-cache setters (called by hooks after API fetch)
  setPaymentMethods: (methods: PaymentMethod[]) => void;
  setBankAccounts: (banks: BankAccount[]) => void;
  setCryptoWallets: (wallets: CryptoWallet[]) => void;
  setWithdrawalDestinations: (dests: WithdrawalDestination[]) => void;
  setBalances: (balances: VaultBalances) => void;
  setAutoFund: (config: AutoFundConfig) => void;

  // Settings
  updateSettings: (patch: Partial<VaultSettings>) => void;
  updateSecurity: (patch: Partial<VaultSecuritySettings>) => void;
  resetSettings: () => void;

  /**
   * Reset ONLY local/manual Vault data: manual accounts, local
   * transactions, balance history, and capital allocations (reset to 0).
   *
   * CRITICAL SAFETY: this does NOT touch:
   *   - Prisma/Postgres ledger (server-side)
   *   - Provider transactions (server-side)
   *   - Provider connections (server-side)
   *   - Real payment methods (server-side)
   *   - Provider financial records (server-side)
   *
   * The reset uses the proper Zustand `set()` flow — it does NOT mutate
   * state directly. The UI updates immediately and the change persists
   * (the store's persist middleware writes the new state to localStorage).
   *
   * Called from Settings → Data & Storage → "Reset manual / local Vault
   * data" with an AlertDialog confirmation.
   */
  resetManualVaultData: () => void;

  // Vault lock
  lockVault: () => void;
  unlockVault: () => void;
  touchActivity: () => void;

  // Derived values
  getTotalReportedCapital: () => { total: number; currency: string; mixed: boolean };
  getAllocatedCapital: () => number;
  getAvailableCapital: () => { available: number; currency: string; mixed: boolean };
  getTradingPool: () => number;
  getAccountById: (id: string) => ConnectedAccount | undefined;
  getBalanceHistory: (accountId: string) => BalanceHistoryEntry[];
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function getUniformCurrency(accounts: ConnectedAccount[]): { currency: string; mixed: boolean } {
  if (accounts.length === 0) return { currency: "USD", mixed: false };
  const first = accounts[0].currency;
  const mixed = accounts.some((a) => a.currency !== first);
  return { currency: first, mixed };
}

const DEFAULT_BALANCES: VaultBalances = {
  cash: { available: 0, pending: 0, reserved: 0, withdrawable: 0, currency: "USD" },
  trading: { cash: 0, buyingPower: 0, openPositions: 0, reservedForOrders: 0, currency: "USD" },
  crypto: { holdings: [], totalFiatEquivalent: 0, currency: "USD" },
  totalValue: 0,
  totalCurrency: "USD",
  providerConnected: false,
};

export const useVaultStore = create<VaultState>()(
  persist(
    (set, get) => ({
      accounts: [],
      allocations: DEFAULT_ALLOCATIONS,
      transactions: [],
      balanceHistory: [],
      paymentMethods: [],
      bankAccounts: [],
      cryptoWallets: [],
      withdrawalDestinations: [],
      balances: DEFAULT_BALANCES,
      autoFund: DEFAULT_AUTO_FUND,
      settings: DEFAULT_SETTINGS,
      locked: false,
      lastActivityAt: Date.now(),

      addAccount: (account) => {
        const now = Date.now();
        const newAccount: ConnectedAccount = {
          ...account,
          source: account.source ?? "manual",
          id: genId("acct"),
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({
          accounts: [...s.accounts, newAccount],
          transactions: [
            {
              id: genId("tx"),
              type: "account-created",
              from: "—",
              to: newAccount.label,
              amount: newAccount.balance,
              currency: newAccount.currency,
              timestamp: now,
              description: `Manual account "${newAccount.label}" created with reported balance ${newAccount.balance.toFixed(2)} ${newAccount.currency}`,
              status: "completed",
              accountLabel: newAccount.label,
            },
            ...s.transactions,
          ],
          balanceHistory: newAccount.balance > 0 ? [
            {
              id: genId("bh"),
              accountId: newAccount.id,
              timestamp: now,
              oldBalance: 0,
              newBalance: newAccount.balance,
              currency: newAccount.currency,
              reason: `Account created`,
            },
            ...s.balanceHistory,
          ] : s.balanceHistory,
          lastActivityAt: now,
        }));
      },

      editAccount: (id, patch) => {
        const now = Date.now();
        set((s) => {
          const account = s.accounts.find((a) => a.id === id);
          if (!account) return s;
          const updated = { ...account, ...patch, updatedAt: now };
          const balanceChanged = patch.balance !== undefined && patch.balance !== account.balance;
          return {
            accounts: s.accounts.map((a) => (a.id === id ? updated : a)),
            transactions: [
              {
                id: genId("tx"),
                type: balanceChanged ? "balance-updated" : "account-edited",
                from: "—",
                to: updated.label,
                amount: balanceChanged ? Math.abs(patch.balance! - account.balance) : 0,
                currency: updated.currency,
                timestamp: now,
                description: balanceChanged
                  ? `Manual balance update: ${account.balance.toFixed(2)} → ${patch.balance!.toFixed(2)} ${updated.currency}`
                  : `Account "${updated.label}" edited`,
                status: "completed",
                accountLabel: updated.label,
              },
              ...s.transactions,
            ],
            balanceHistory: balanceChanged ? [
              {
                id: genId("bh"),
                accountId: id,
                timestamp: now,
                oldBalance: account.balance,
                newBalance: patch.balance!,
                currency: updated.currency,
                reason: `Manual balance update`,
              },
              ...s.balanceHistory,
            ] : s.balanceHistory,
            lastActivityAt: now,
          };
        });
      },

      removeAccount: (id) => {
        set((s) => {
          const account = s.accounts.find((a) => a.id === id);
          if (!account) return s;
          const now = Date.now();
          return {
            accounts: s.accounts.filter((a) => a.id !== id),
            transactions: [
              {
                id: genId("tx"),
                type: "account-removed",
                from: account.label,
                to: "—",
                amount: account.balance,
                currency: account.currency,
                timestamp: now,
                description: `Account "${account.label}" removed`,
                status: "completed",
                accountLabel: account.label,
              },
              ...s.transactions,
            ],
            lastActivityAt: now,
          };
        });
      },

      localTransfer: (fromId, toId, amount) => {
        const state = get();
        const from = state.accounts.find((a) => a.id === fromId);
        const to = state.accounts.find((a) => a.id === toId);

        if (!from) return { success: false, error: "Source account not found." };
        if (!to) return { success: false, error: "Destination account not found." };
        if (fromId === toId) return { success: false, error: "Source and destination must be different accounts." };
        if (!Number.isFinite(amount) || amount <= 0) return { success: false, error: "Amount must be a positive number." };
        if (from.balance < amount) return { success: false, error: `Insufficient balance. Available: ${from.balance.toFixed(2)} ${from.currency}.` };
        if (from.currency !== to.currency) return { success: false, error: `Currency conversion provider required. Source is ${from.currency}, destination is ${to.currency}.` };

        const now = Date.now();
        const newFromBalance = from.balance - amount;
        const newToBalance = to.balance + amount;

        set((s) => ({
          accounts: s.accounts.map((a) => {
            if (a.id === fromId) return { ...a, balance: newFromBalance, updatedAt: now };
            if (a.id === toId) return { ...a, balance: newToBalance, updatedAt: now };
            return a;
          }),
          transactions: [
            {
              id: genId("tx"),
              type: "local-transfer",
              from: from.label,
              to: to.label,
              amount,
              currency: from.currency,
              timestamp: now,
              description: `Local transfer: ${from.label} → ${to.label}`,
              status: "completed",
              accountLabel: from.label,
            },
            ...s.transactions,
          ],
          balanceHistory: [
            {
              id: genId("bh"),
              accountId: fromId,
              timestamp: now,
              oldBalance: from.balance,
              newBalance: newFromBalance,
              currency: from.currency,
              reason: `Local transfer to ${to.label}`,
            },
            {
              id: genId("bh"),
              accountId: toId,
              timestamp: now,
              oldBalance: to.balance,
              newBalance: newToBalance,
              currency: to.currency,
              reason: `Local transfer from ${from.label}`,
            },
            ...s.balanceHistory,
          ],
          lastActivityAt: now,
        }));

        return { success: true };
      },

      allocateToPool: (poolId, amount) => {
        const state = get();
        if (!Number.isFinite(amount) || amount <= 0) return { success: false, error: "Amount must be a positive number." };
        const available = state.getAvailableCapital();
        if (available.mixed) return { success: false, error: "Currency conversion provider required for mixed-currency allocation." };
        if (amount > available.available) return { success: false, error: `Insufficient available capital. Available: ${available.available.toFixed(2)} ${available.currency}.` };

        const pool = state.allocations.find((p) => p.id === poolId);
        if (!pool) return { success: false, error: "Budget allocation not found." };

        const now = Date.now();
        set((s) => ({
          allocations: s.allocations.map((p) => p.id === poolId ? { ...p, allocated: p.allocated + amount } : p),
          transactions: [
            {
              id: genId("tx"),
              type: "pool-allocation",
              from: "Available",
              to: pool.label,
              amount,
              currency: available.currency,
              timestamp: now,
              description: `Budget allocated to ${pool.label} (internal bookkeeping — not a real transfer)`,
              status: "completed",
            },
            ...s.transactions,
          ],
          lastActivityAt: now,
        }));
        return { success: true };
      },

      deallocateFromPool: (poolId, amount) => {
        const state = get();
        if (!Number.isFinite(amount) || amount <= 0) return { success: false, error: "Amount must be a positive number." };
        const pool = state.allocations.find((p) => p.id === poolId);
        if (!pool) return { success: false, error: "Budget allocation not found." };
        if (amount > pool.allocated) return { success: false, error: `Cannot deallocate more than allocated. Current allocation: ${pool.allocated.toFixed(2)}.` };

        const now = Date.now();
        set((s) => ({
          allocations: s.allocations.map((p) => p.id === poolId ? { ...p, allocated: Math.max(0, p.allocated - amount) } : p),
          transactions: [
            {
              id: genId("tx"),
              type: "pool-deallocation",
              from: pool.label,
              to: "Available",
              amount,
              currency: "USD",
              timestamp: now,
              description: `Budget deallocated from ${pool.label} (internal bookkeeping)`,
              status: "completed",
            },
            ...s.transactions,
          ],
          lastActivityAt: now,
        }));
        return { success: true };
      },

      setAllocationCap: (poolId, cap) => {
        set((s) => ({
          allocations: s.allocations.map((p) => p.id === poolId ? { ...p, cap: Math.max(0, cap) } : p),
        }));
      },

      setPaymentMethods: (methods) => set({ paymentMethods: methods }),
      setBankAccounts: (banks) => set({ bankAccounts: banks }),
      setCryptoWallets: (wallets) => set({ cryptoWallets: wallets }),
      setWithdrawalDestinations: (dests) => set({ withdrawalDestinations: dests }),
      setBalances: (balances) => set({ balances }),
      setAutoFund: (config) => set({ autoFund: config }),

      updateSettings: (patch) =>
        set((s) => ({
          settings: { ...s.settings, ...patch },
          lastActivityAt: Date.now(),
        })),

      updateSecurity: (patch) =>
        set((s) => ({
          settings: { ...s.settings, security: { ...s.settings.security, ...patch } },
          lastActivityAt: Date.now(),
        })),

      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),

      /**
       * Reset ONLY local/manual Vault data via the proper Zustand `set()`
       * flow. Provider-backed financial records (Postgres ledger, provider
       * transactions, real payment methods, provider connections) are NOT
       * touched — they live on the server and are not reachable from here.
       *
       * What gets reset:
       *   - accounts → [] (manual accounts only; provider accounts are
       *     server-derived and not stored here)
       *   - transactions → [] (local activity log only)
       *   - balanceHistory → [] (local balance snapshots only)
       *   - allocations → all `allocated` reset to 0 (the pool structure
       *     is preserved; only the allocated amounts are zeroed)
       *
       * The reset is recorded as a transaction entry so the user can see
       * in the (now-empty) activity log that a reset occurred. UI updates
       * immediately; the change persists via the store's persist middleware.
       */
      resetManualVaultData: () => {
        const now = Date.now();
        set((s) => ({
          accounts: [],
          transactions: [
            {
              id: genId("tx"),
              type: "security-event",
              from: "—",
              to: "—",
              amount: 0,
              currency: s.settings.baseCurrency,
              timestamp: now,
              description: "Manual / local Vault data reset from Settings. Provider-backed financial records were NOT touched.",
              status: "completed",
            },
          ],
          balanceHistory: [],
          // Preserve allocation structure, zero out amounts.
          allocations: s.allocations.map((p) => ({ ...p, allocated: 0 })),
          lastActivityAt: now,
        }));
      },

      lockVault: () => set({ locked: true }),
      unlockVault: () => set({ locked: false, lastActivityAt: Date.now() }),
      touchActivity: () => set({ lastActivityAt: Date.now() }),

      getTotalReportedCapital: () => {
        const { currency, mixed } = getUniformCurrency(get().accounts);
        const total = get().accounts.reduce((s, a) => s + a.balance, 0);
        return { total, currency, mixed };
      },

      getAllocatedCapital: () =>
        get().allocations.reduce((s, p) => s + p.allocated, 0),

      getAvailableCapital: () => {
        const { currency, mixed } = getUniformCurrency(get().accounts);
        const total = get().accounts.reduce((s, a) => s + a.balance, 0);
        const allocated = get().allocations.reduce((s, p) => s + p.allocated, 0);
        return { available: total - allocated, currency, mixed };
      },

      getTradingPool: () =>
        get().allocations.find((p) => p.id === "trading")?.allocated ?? 0,

      getAccountById: (id) => get().accounts.find((a) => a.id === id),

      getBalanceHistory: (accountId) =>
        get().balanceHistory.filter((h) => h.accountId === accountId).sort((a, b) => b.timestamp - a.timestamp),
    }),
    {
      name: "lucian-vault",
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
        return localStorage;
      }),
      // Migrate Phase 15 → Real-Money Foundation.
      migrate: (persisted: unknown) => {
        const s = persisted as Record<string, unknown>;
        if (!s || typeof s !== "object") return s;

        // Accounts migration
        const accounts = s.accounts as Array<Record<string, unknown>> | undefined;
        if (accounts && Array.isArray(accounts)) {
          s.accounts = accounts.map((a) => ({
            ...a,
            source: a.source ?? "manual",
            createdAt: a.createdAt ?? a.connectedAt ?? Date.now(),
            updatedAt: a.updatedAt ?? a.createdAt ?? a.connectedAt ?? Date.now(),
          }));
        }

        // Pools → allocations (rename)
        if (s.pools && !s.allocations) {
          const pools = s.pools as Array<Record<string, unknown>>;
          s.allocations = pools.map((p) => ({
            id: p.id,
            label: p.label,
            allocated: p.allocated ?? 0,
            feedsMarkets: p.feedsMarkets ?? false,
            cap: 0,
          }));
          delete s.pools;
        }
        if (!s.allocations) s.allocations = DEFAULT_ALLOCATIONS;

        // Initialize new state slices
        if (!s.paymentMethods) s.paymentMethods = [];
        if (!s.bankAccounts) s.bankAccounts = [];
        if (!s.cryptoWallets) s.cryptoWallets = [];
        if (!s.withdrawalDestinations) s.withdrawalDestinations = [];
        if (!s.balances) s.balances = DEFAULT_BALANCES;
        if (!s.autoFund) s.autoFund = DEFAULT_AUTO_FUND;

        // Settings migration
        const settings = s.settings as Record<string, unknown> | undefined;
        if (settings) {
          // Update tab name: "funding" → "money", "holdings" → "assets"
          if (settings.defaultView === "funding") settings.defaultView = "money";
          if (settings.defaultView === "holdings") settings.defaultView = "assets";

          // Migrate security settings
          const security = (settings.security ?? {}) as Record<string, unknown>;
          settings.security = {
            ...DEFAULT_SECURITY,
            ...security,
            // Preserve legacy fields if they exist
            requireWithdrawalVerification: security.requireTransferConfirmation ?? security.requireWithdrawalVerification ?? true,
            maskSensitiveValues: security.maskSensitiveValues ?? false,
            sessionTimeoutMin: security.sessionTimeoutMin ?? 30,
            largeTransactionThreshold: security.largeTransferThreshold ?? security.largeTransactionThreshold ?? 1000,
            // New fields default
            twoFactorRequired: false,
            twoFactorConfigured: false,
            newDestinationDelayHours: 24,
            dailyFiatWithdrawalLimit: 10000,
            dailyCryptoWithdrawalLimitFiat: 5000,
            cryptoAddressAllowlist: [],
            newDeviceWithdrawalRestriction: true,
          };
          // Remove legacy key
          delete (settings.security as Record<string, unknown>).requireTransferConfirmation;
          delete (settings.security as Record<string, unknown>).largeTransferThreshold;

          const notifications = (settings.notifications ?? {}) as Record<string, unknown>;
          settings.notifications = {
            transfers: notifications.transfers ?? true,
            balanceChanges: notifications.balanceChanges ?? false,
            largeTransfers: notifications.largeTransfers ?? true,
          };
        }

        // Transaction type migration
        const txns = s.transactions as Array<Record<string, unknown>> | undefined;
        if (txns && Array.isArray(txns)) {
          s.transactions = txns.map((t) => {
            // Map legacy types
            const type = t.type as string;
            if (type === "pool-allocation" || type === "pool-deallocation") {
              // Already supported
            }
            return {
              ...t,
              status: t.status ?? "completed",
            };
          });
        }

        s.balanceHistory = s.balanceHistory ?? [];
        s.locked = false;
        return s;
      },
      version: 3,
    },
  ),
);

/* ── Money formatting helpers ── */

export function formatMoney(amount: number, currency: string = "USD", opts?: { compact?: boolean }): string {
  if (!Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: opts?.compact ? 0 : 2,
      maximumFractionDigits: opts?.compact ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatCrypto(quantity: number, asset: string): string {
  if (!Number.isFinite(quantity)) return "—";
  const decimals = asset === "BTC" ? 6 : asset === "ETH" ? 6 : 2;
  return `${quantity.toFixed(decimals)} ${asset}`;
}

export function maskString(s: string, visibleChars: number = 4): string {
  if (s.length <= visibleChars) return s;
  return "•".repeat(Math.max(4, s.length - visibleChars)) + s.slice(-visibleChars);
}
