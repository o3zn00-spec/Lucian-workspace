-- Cross-device DevWorkspace, persistent sandbox trading, and per-user exchange OAuth.
CREATE TABLE "CloudWorkspaceProject" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "project" JSONB NOT NULL,
  "contents" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CloudWorkspaceProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TradingSandboxAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "state" JSONB NOT NULL,
  "history" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TradingSandboxAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExchangeConnection" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'connected',
  "accessTokenEnc" TEXT NOT NULL,
  "refreshTokenEnc" TEXT,
  "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
  "scope" TEXT,
  "portfolioId" TEXT,
  "providerUserId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExchangeConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CloudWorkspaceProject_userId_id_key" ON "CloudWorkspaceProject"("userId", "id");
CREATE INDEX "CloudWorkspaceProject_userId_updatedAt_idx" ON "CloudWorkspaceProject"("userId", "updatedAt");
CREATE UNIQUE INDEX "TradingSandboxAccount_userId_key" ON "TradingSandboxAccount"("userId");
CREATE UNIQUE INDEX "ExchangeConnection_userId_provider_key" ON "ExchangeConnection"("userId", "provider");
CREATE INDEX "ExchangeConnection_provider_state_idx" ON "ExchangeConnection"("provider", "state");

ALTER TABLE "CloudWorkspaceProject" ADD CONSTRAINT "CloudWorkspaceProject_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TradingSandboxAccount" ADD CONSTRAINT "TradingSandboxAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExchangeConnection" ADD CONSTRAINT "ExchangeConnection_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
