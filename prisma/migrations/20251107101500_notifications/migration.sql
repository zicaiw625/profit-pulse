-- AlterTable
ALTER TABLE "Store" ADD COLUMN "lastNetLossAlertAt" DATETIME;

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT,
    "config" JSON,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationChannel_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "NotificationChannel_merchantId_type_idx" ON "NotificationChannel"("merchantId", "type");
