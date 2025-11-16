-- Add new providers for logistics integrations
ALTER TYPE "CredentialProvider" ADD VALUE IF NOT EXISTS 'EASYPOST_LOGISTICS';
ALTER TYPE "CredentialProvider" ADD VALUE IF NOT EXISTS 'SHIPSTATION_LOGISTICS';

-- Extend sync job types for logistics pulls
ALTER TYPE "SyncJobType" ADD VALUE IF NOT EXISTS 'LOGISTICS_RATE';

-- Create enums for GDPR tooling
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GdprRequestType') THEN
    CREATE TYPE "GdprRequestType" AS ENUM ('EXPORT', 'DELETE');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GdprRequestStatus') THEN
    CREATE TYPE "GdprRequestStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
  END IF;
END$$;

-- Logistics credentials table
CREATE TABLE IF NOT EXISTS "LogisticsCredential" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "storeId" TEXT,
  "provider" "CredentialProvider" NOT NULL,
  "accountName" TEXT,
  "accountId" TEXT,
  "encryptedSecret" TEXT NOT NULL,
  "lastSyncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LogisticsCredential_pkey" PRIMARY KEY ("id")
);

-- GDPR request queue table
CREATE TABLE IF NOT EXISTS "GdprRequest" (
  "id" TEXT NOT NULL,
  "merchantId" TEXT NOT NULL,
  "storeId" TEXT,
  "type" "GdprRequestType" NOT NULL,
  "status" "GdprRequestStatus" NOT NULL DEFAULT 'PENDING',
  "subjectEmail" TEXT NOT NULL,
  "requestedBy" TEXT,
  "exportPayload" JSONB,
  "notes" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GdprRequest_pkey" PRIMARY KEY ("id")
);

-- Relationships
ALTER TABLE "LogisticsCredential"
  ADD CONSTRAINT "LogisticsCredential_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LogisticsCredential_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GdprRequest"
  ADD CONSTRAINT "GdprRequest_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "GdprRequest_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes
CREATE INDEX IF NOT EXISTS "LogisticsCredential_merchantId_idx" ON "LogisticsCredential"("merchantId");
CREATE INDEX IF NOT EXISTS "LogisticsCredential_storeId_provider_idx" ON "LogisticsCredential"("storeId", "provider");
CREATE INDEX IF NOT EXISTS "GdprRequest_merchantId_status_idx" ON "GdprRequest"("merchantId", "status");
CREATE INDEX IF NOT EXISTS "GdprRequest_storeId_status_idx" ON "GdprRequest"("storeId", "status");
