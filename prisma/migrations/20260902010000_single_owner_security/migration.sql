-- Phase 3: encrypted owner-only credential storage.
CREATE TABLE "OwnerCredential" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "keyName" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OwnerCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OwnerCredential_ownerUserId_service_keyName_key"
ON "OwnerCredential"("ownerUserId", "service", "keyName");

CREATE INDEX "OwnerCredential_service_keyName_idx"
ON "OwnerCredential"("service", "keyName");

ALTER TABLE "OwnerCredential"
ADD CONSTRAINT "OwnerCredential_ownerUserId_fkey"
FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
