ALTER TABLE "TradingAgentProfile"
  ADD COLUMN "maxPositionUsd" DECIMAL(18,8) NOT NULL DEFAULT 2500,
  ADD COLUMN "maxDailyLossUsd" DECIMAL(18,8) NOT NULL DEFAULT 250,
  ADD COLUMN "maxOpenPositions" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "maxLeverage" DECIMAL(8,2) NOT NULL DEFAULT 3,
  ADD COLUMN "requireApproval" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "LiveTradeIntent"
  ADD COLUMN "tradingMode" TEXT NOT NULL DEFAULT 'bybit_testnet',
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'spot',
  ADD COLUMN "orderType" TEXT NOT NULL DEFAULT 'Market',
  ADD COLUMN "limitPrice" DECIMAL(30,12),
  ADD COLUMN "stopLoss" DECIMAL(30,12),
  ADD COLUMN "takeProfit" DECIMAL(30,12);

CREATE TABLE "TradingAuditEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "tradingMode" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "symbol" TEXT,
  "intentId" TEXT,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradingAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TradingAuditEvent_userId_createdAt_idx" ON "TradingAuditEvent"("userId", "createdAt");
CREATE INDEX "TradingAuditEvent_userId_action_status_idx" ON "TradingAuditEvent"("userId", "action", "status");
ALTER TABLE "TradingAuditEvent" ADD CONSTRAINT "TradingAuditEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
