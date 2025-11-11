-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FixedCost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "cadence" TEXT NOT NULL DEFAULT 'MONTHLY',
    "appliesTo" TEXT NOT NULL DEFAULT 'ALL',
    "allocation" TEXT NOT NULL DEFAULT 'REVENUE',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FixedCost_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_FixedCost" ("allocation", "amount", "appliesTo", "cadence", "createdAt", "currency", "endedAt", "id", "label", "merchantId", "notes", "startedAt", "updatedAt") SELECT "allocation", "amount", "appliesTo", "cadence", "createdAt", "currency", "endedAt", "id", "label", "merchantId", "notes", "startedAt", "updatedAt" FROM "FixedCost";
DROP TABLE "FixedCost";
ALTER TABLE "new_FixedCost" RENAME TO "FixedCost";
CREATE INDEX "FixedCost_merchantId_idx" ON "FixedCost"("merchantId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
