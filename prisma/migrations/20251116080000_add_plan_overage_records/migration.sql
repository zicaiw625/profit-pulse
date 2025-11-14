-- CreateEnum
CREATE TYPE "PlanOverageStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "PlanOverageRecord" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "units" INTEGER NOT NULL,
    "unitAmount" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "description" TEXT,
    "status" "PlanOverageStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "shopDomain" TEXT,
    "usageRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chargedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "PlanOverageRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlanOverageRecord_idempotencyKey_key" UNIQUE ("idempotencyKey")
);

-- AddForeignKey
ALTER TABLE "PlanOverageRecord" ADD CONSTRAINT "PlanOverageRecord_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "PlanOverageRecord_merchantId_year_month_metric_idx" ON "PlanOverageRecord"("merchantId", "year", "month", "metric");
