-- AlterTable
ALTER TABLE "AdAccountCredential" ADD COLUMN "lastSyncedAt" DATETIME;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN "paymentsLastSyncedAt" DATETIME;

-- CreateTable
CREATE TABLE "AdSpendRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accountId" TEXT,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "adSetId" TEXT,
    "adSetName" TEXT,
    "adId" TEXT,
    "adName" TEXT,
    "date" DATETIME NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "spend" DECIMAL NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "compositeKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AdSpendRecord_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentPayout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "payoutDate" DATETIME NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "grossAmount" DECIMAL NOT NULL DEFAULT 0,
    "feeTotal" DECIMAL NOT NULL DEFAULT 0,
    "netAmount" DECIMAL NOT NULL DEFAULT 0,
    "transactions" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentPayout_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "provider" TEXT,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SyncJob_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "AdSpendRecord_compositeKey_key" ON "AdSpendRecord"("compositeKey");

-- CreateIndex
CREATE INDEX "AdSpendRecord_storeId_provider_date_idx" ON "AdSpendRecord"("storeId", "provider", "date");

-- CreateIndex
CREATE INDEX "PaymentPayout_storeId_provider_payoutDate_idx" ON "PaymentPayout"("storeId", "provider", "payoutDate");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentPayout_storeId_payoutId_key" ON "PaymentPayout"("storeId", "payoutId");

-- CreateIndex
CREATE INDEX "SyncJob_storeId_jobType_idx" ON "SyncJob"("storeId", "jobType");
