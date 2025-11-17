-- DropForeignKey
ALTER TABLE "GdprRequest" DROP CONSTRAINT "GdprRequest_merchantId_fkey";

-- DropForeignKey
ALTER TABLE "LogisticsCredential" DROP CONSTRAINT "LogisticsCredential_merchantId_fkey";

-- DropForeignKey
ALTER TABLE "PlanOverageRecord" DROP CONSTRAINT "PlanOverageRecord_merchantId_fkey";

-- AlterTable
ALTER TABLE "GdprRequest" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "LogisticsCredential" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customerEmail" TEXT,
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "customerName" TEXT,
ADD COLUMN     "grossProfit" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "netProfit" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "InventoryLevel" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "sku" TEXT,
    "locationId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(65,30),
    "costCurrency" TEXT DEFAULT 'USD',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryLevel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryLevel_storeId_sku_idx" ON "InventoryLevel"("storeId", "sku");

-- CreateIndex
CREATE INDEX "InventoryLevel_storeId_inventoryItemId_idx" ON "InventoryLevel"("storeId", "inventoryItemId");

-- AddForeignKey
ALTER TABLE "PlanOverageRecord" ADD CONSTRAINT "PlanOverageRecord_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryLevel" ADD CONSTRAINT "InventoryLevel_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsCredential" ADD CONSTRAINT "LogisticsCredential_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GdprRequest" ADD CONSTRAINT "GdprRequest_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
