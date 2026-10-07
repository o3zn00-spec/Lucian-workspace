-- Phase 9: remove legacy exchange-specific records and install provider-neutral
-- Bybit-backed deposit/withdrawal audit tables. Legacy provider credentials and
-- rows are deliberately removed because they cannot be safely reused with Bybit.

DROP TABLE IF EXISTS "CoinbaseTransferIntent" CASCADE;
DROP TABLE IF EXISTS "CoinbaseReceiveAddress" CASCADE;

DELETE FROM "ExchangeConnection" WHERE lower("provider") IN ('coinbase', 'quidax');
DELETE FROM "ProviderConnection" WHERE lower("name") IN ('coinbase', 'quidax');
DELETE FROM "OwnerCredential" WHERE lower("service") IN ('coinbase', 'quidax');

CREATE TABLE "CryptoReceiveAddress" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'bybit',
  "exchangeAccountId" TEXT NOT NULL,
  "providerAddressId" TEXT NOT NULL,
  "asset" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "tag" TEXT,
  "label" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CryptoReceiveAddress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CryptoTransferIntent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'bybit',
  "idempotencyKey" TEXT NOT NULL,
  "exchangeAccountId" TEXT NOT NULL,
  "asset" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "destinationTag" TEXT,
  "amount" DECIMAL(36,18) NOT NULL,
  "estimatedUsd" DECIMAL(24,8) NOT NULL,
  "confirmationText" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'previewed',
  "providerTransactionId" TEXT,
  "providerResponse" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CryptoTransferIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CryptoReceiveAddress_userId_providerAddressId_key" ON "CryptoReceiveAddress"("userId", "providerAddressId");
CREATE INDEX "CryptoReceiveAddress_userId_asset_network_createdAt_idx" ON "CryptoReceiveAddress"("userId", "asset", "network", "createdAt");
CREATE UNIQUE INDEX "CryptoTransferIntent_idempotencyKey_key" ON "CryptoTransferIntent"("idempotencyKey");
CREATE INDEX "CryptoTransferIntent_userId_state_createdAt_idx" ON "CryptoTransferIntent"("userId", "state", "createdAt");
CREATE INDEX "CryptoTransferIntent_userId_providerTransactionId_idx" ON "CryptoTransferIntent"("userId", "providerTransactionId");

ALTER TABLE "CryptoReceiveAddress" ADD CONSTRAINT "CryptoReceiveAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CryptoTransferIntent" ADD CONSTRAINT "CryptoTransferIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
