-- Exchange trading, cross-device Agent Capital, and live-order audit.
CREATE TABLE "TradingAgentProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "allocationUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "maxOrderUsd" DECIMAL(18,8) NOT NULL DEFAULT 50,
  "permissionMode" TEXT NOT NULL DEFAULT 'assisted',
  "emergencyStop" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradingAgentProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LiveTradeIntent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "clientOrderId" TEXT NOT NULL,
  "providerOrderId" TEXT,
  "previewId" TEXT,
  "productId" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "quoteSize" DECIMAL(30,12),
  "baseSize" DECIMAL(30,12),
  "initiatedBy" TEXT NOT NULL DEFAULT 'user',
  "state" TEXT NOT NULL DEFAULT 'previewed',
  "preview" JSONB,
  "execution" JSONB,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LiveTradeIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TradingAgentProfile_userId_key" ON "TradingAgentProfile"("userId");
CREATE UNIQUE INDEX "LiveTradeIntent_clientOrderId_key" ON "LiveTradeIntent"("clientOrderId");
CREATE INDEX "LiveTradeIntent_userId_state_createdAt_idx" ON "LiveTradeIntent"("userId", "state", "createdAt");
CREATE INDEX "LiveTradeIntent_userId_productId_createdAt_idx" ON "LiveTradeIntent"("userId", "productId", "createdAt");

ALTER TABLE "TradingAgentProfile" ADD CONSTRAINT "TradingAgentProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveTradeIntent" ADD CONSTRAINT "LiveTradeIntent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
