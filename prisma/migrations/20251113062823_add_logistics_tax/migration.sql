-- CreateTable
CREATE TABLE "LogisticsRule" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "provider" TEXT,
    "region" TEXT,
    "country" TEXT,
    "weightMin" DECIMAL(65,30),
    "weightMax" DECIMAL(65,30),
    "flatFee" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "perKg" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LogisticsRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxRate" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "state" TEXT,
    "rate" DECIMAL(65,30) NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LogisticsRule_storeId_provider_idx" ON "LogisticsRule"("storeId", "provider");

-- CreateIndex
CREATE INDEX "LogisticsRule_storeId_country_region_idx" ON "LogisticsRule"("storeId", "country", "region");

-- CreateIndex
CREATE INDEX "TaxRate_storeId_country_state_idx" ON "TaxRate"("storeId", "country", "state");

-- AddForeignKey
ALTER TABLE "LogisticsRule" ADD CONSTRAINT "LogisticsRule_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxRate" ADD CONSTRAINT "TaxRate_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
