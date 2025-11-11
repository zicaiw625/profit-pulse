-- CreateTable
CREATE TABLE "RefundRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "orderId" TEXT,
    "orderShopifyId" TEXT NOT NULL,
    "shopifyRefundId" TEXT NOT NULL,
    "processedAt" DATETIME NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "amount" DECIMAL NOT NULL DEFAULT 0,
    "reason" TEXT,
    "restock" BOOLEAN NOT NULL DEFAULT false,
    "lineItems" JSONB,
    "transactions" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RefundRecord_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RefundRecord_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DailyMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'ORGANIC',
    "productSku" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "orders" INTEGER NOT NULL DEFAULT 0,
    "units" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL NOT NULL DEFAULT 0,
    "adSpend" DECIMAL NOT NULL DEFAULT 0,
    "cogs" DECIMAL NOT NULL DEFAULT 0,
    "shippingCost" DECIMAL NOT NULL DEFAULT 0,
    "paymentFees" DECIMAL NOT NULL DEFAULT 0,
    "refundAmount" DECIMAL NOT NULL DEFAULT 0,
    "refunds" INTEGER NOT NULL DEFAULT 0,
    "grossProfit" DECIMAL NOT NULL DEFAULT 0,
    "netProfit" DECIMAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyMetric_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DailyMetric" ("adSpend", "channel", "cogs", "createdAt", "currency", "date", "grossProfit", "id", "netProfit", "orders", "paymentFees", "productSku", "revenue", "shippingCost", "storeId", "units", "updatedAt") SELECT "adSpend", "channel", "cogs", "createdAt", "currency", "date", "grossProfit", "id", "netProfit", "orders", "paymentFees", "productSku", "revenue", "shippingCost", "storeId", "units", "updatedAt" FROM "DailyMetric";
DROP TABLE "DailyMetric";
ALTER TABLE "new_DailyMetric" RENAME TO "DailyMetric";
CREATE INDEX "DailyMetric_storeId_date_idx" ON "DailyMetric"("storeId", "date");
CREATE INDEX "DailyMetric_storeId_channel_date_idx" ON "DailyMetric"("storeId", "channel", "date");
CREATE UNIQUE INDEX "DailyMetric_storeId_channel_productSku_date_key" ON "DailyMetric"("storeId", "channel", "productSku", "date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "RefundRecord_shopifyRefundId_key" ON "RefundRecord"("shopifyRefundId");

-- CreateIndex
CREATE INDEX "RefundRecord_storeId_processedAt_idx" ON "RefundRecord"("storeId", "processedAt");

-- CreateIndex
CREATE INDEX "RefundRecord_storeId_orderShopifyId_idx" ON "RefundRecord"("storeId", "orderShopifyId");
