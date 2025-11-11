/*
  Warnings:

  - You are about to alter the column `config` on the `NotificationChannel` table. The data in that column could be lost. The data in that column will be cast from `Unsupported("json")` to `Json`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_NotificationChannel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT,
    "config" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationChannel_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_NotificationChannel" ("config", "createdAt", "id", "isActive", "label", "merchantId", "type", "updatedAt") SELECT "config", "createdAt", "id", "isActive", "label", "merchantId", "type", "updatedAt" FROM "NotificationChannel";
DROP TABLE "NotificationChannel";
ALTER TABLE "new_NotificationChannel" RENAME TO "NotificationChannel";
CREATE INDEX "NotificationChannel_merchantId_type_idx" ON "NotificationChannel"("merchantId", "type");
CREATE TABLE "new_Store" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopGid" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" DATETIME,
    "paymentsLastSyncedAt" DATETIME,
    "parentStoreId" TEXT,
    "lastNetLossAlertAt" DATETIME,
    CONSTRAINT "Store_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Store_parentStoreId_fkey" FOREIGN KEY ("parentStoreId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Store" ("currency", "disconnectedAt", "id", "installedAt", "lastNetLossAlertAt", "merchantId", "paymentsLastSyncedAt", "shopDomain", "shopGid", "status", "timezone") SELECT "currency", "disconnectedAt", "id", "installedAt", "lastNetLossAlertAt", "merchantId", "paymentsLastSyncedAt", "shopDomain", "shopGid", "status", "timezone" FROM "Store";
DROP TABLE "Store";
ALTER TABLE "new_Store" RENAME TO "Store";
CREATE UNIQUE INDEX "Store_shopDomain_key" ON "Store"("shopDomain");
CREATE INDEX "Store_merchantId_idx" ON "Store"("merchantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
