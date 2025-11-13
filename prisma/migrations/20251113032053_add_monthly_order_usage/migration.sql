-- CreateTable
CREATE TABLE "monthly_order_usage" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_order_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "monthly_order_usage_merchantId_idx" ON "monthly_order_usage"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_order_usage_merchantId_year_month_key" ON "monthly_order_usage"("merchantId", "year", "month");

-- AddForeignKey
ALTER TABLE "monthly_order_usage" ADD CONSTRAINT "monthly_order_usage_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
