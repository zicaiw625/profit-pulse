-- CreateTable
CREATE TABLE "FixedCost" (
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
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FixedCost_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FixedCost_merchantId_idx" ON "FixedCost"("merchantId");
