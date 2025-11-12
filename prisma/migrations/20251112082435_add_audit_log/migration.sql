/*
  Warnings:

  - You are about to drop the column `adId` on the `OrderAttribution` table. All the data in the column will be lost.
  - You are about to drop the column `adName` on the `OrderAttribution` table. All the data in the column will be lost.
  - You are about to drop the column `adSetId` on the `OrderAttribution` table. All the data in the column will be lost.
  - You are about to drop the column `adSetName` on the `OrderAttribution` table. All the data in the column will be lost.
  - You are about to drop the column `campaignId` on the `OrderAttribution` table. All the data in the column will be lost.
  - You are about to drop the column `campaignName` on the `OrderAttribution` table. All the data in the column will be lost.
  - You are about to drop the column `clickTimestamp` on the `OrderAttribution` table. All the data in the column will be lost.
  - You are about to drop the column `spendAllocated` on the `OrderAttribution` table. All the data in the column will be lost.
  - You are about to drop the column `viewTimestamp` on the `OrderAttribution` table. All the data in the column will be lost.
  - Made the column `provider` on table `OrderAttribution` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateTable
CREATE TABLE "AttributionRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "ruleType" TEXT NOT NULL DEFAULT 'LAST_TOUCH',
    "weight" DECIMAL NOT NULL DEFAULT 1,
    "windowHours" INTEGER NOT NULL DEFAULT 24,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AttributionRule_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "userEmail" TEXT,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_OrderAttribution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "attributionModel" TEXT NOT NULL DEFAULT 'LAST_TOUCH',
    "amount" DECIMAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderAttribution_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_OrderAttribution" ("attributionModel", "currency", "id", "orderId", "provider") SELECT coalesce("attributionModel", 'LAST_TOUCH') AS "attributionModel", "currency", "id", "orderId", "provider" FROM "OrderAttribution";
DROP TABLE "OrderAttribution";
ALTER TABLE "new_OrderAttribution" RENAME TO "OrderAttribution";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "AttributionRule_merchantId_provider_key" ON "AttributionRule"("merchantId", "provider");

-- CreateIndex
CREATE INDEX "AuditLog_merchantId_createdAt_idx" ON "AuditLog"("merchantId", "createdAt");
