-- CreateTable
CREATE TABLE "MerchantAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT,
    "ownerEmail" TEXT,
    "primaryCurrency" TEXT NOT NULL DEFAULT 'USD',
    "primaryTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopGid" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" DATETIME,
    CONSTRAINT "Store_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'BASIC',
    "shopifyBillingId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "trialEndsAt" DATETIME,
    "nextBillingAt" DATETIME,
    "orderLimit" INTEGER NOT NULL DEFAULT 500,
    "storeLimit" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subscription_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'FINANCE',
    "invitedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joinedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    CONSTRAINT "TeamMember_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AdAccountCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "storeId" TEXT,
    "provider" TEXT NOT NULL,
    "accountName" TEXT,
    "accountId" TEXT,
    "encryptedSecret" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "scopes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AdAccountCredential_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AdAccountCredential_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkuCost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "variantId" TEXT,
    "costCurrency" TEXT NOT NULL DEFAULT 'USD',
    "costAmount" DECIMAL NOT NULL,
    "effectiveFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" DATETIME,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    CONSTRAINT "SkuCost_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CostTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "config" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CostTemplate_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CostTemplateLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "percentageRate" DECIMAL,
    "flatAmount" DECIMAL,
    "appliesTo" TEXT NOT NULL DEFAULT 'ORDER',
    CONSTRAINT "CostTemplateLine_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CostTemplate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderNumber" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "presentmentCurrency" TEXT,
    "subtotal" DECIMAL NOT NULL DEFAULT 0,
    "shipping" DECIMAL NOT NULL DEFAULT 0,
    "tax" DECIMAL NOT NULL DEFAULT 0,
    "discount" DECIMAL NOT NULL DEFAULT 0,
    "total" DECIMAL NOT NULL DEFAULT 0,
    "financialStatus" TEXT,
    "processedAt" DATETIME NOT NULL,
    "sourceName" TEXT,
    "customerCountry" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "sku" TEXT,
    "title" TEXT,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL NOT NULL,
    "discount" DECIMAL NOT NULL DEFAULT 0,
    "revenue" DECIMAL NOT NULL DEFAULT 0,
    "cogs" DECIMAL NOT NULL DEFAULT 0,
    CONSTRAINT "OrderLineItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderCost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "source" TEXT,
    CONSTRAINT "OrderCost_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderAttribution" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "provider" TEXT,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "adSetId" TEXT,
    "adSetName" TEXT,
    "adId" TEXT,
    "adName" TEXT,
    "attributionModel" TEXT DEFAULT 'LAST_TOUCH',
    "clickTimestamp" DATETIME,
    "viewTimestamp" DATETIME,
    "spendAllocated" DECIMAL NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    CONSTRAINT "OrderAttribution_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyMetric" (
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
    "grossProfit" DECIMAL NOT NULL DEFAULT 0,
    "netProfit" DECIMAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyMetric_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReconciliationIssue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "issueDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" TEXT,
    "externalRef" TEXT,
    "amountDelta" DECIMAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "details" JSONB,
    "resolvedAt" DATETIME,
    CONSTRAINT "ReconciliationIssue_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL NOT NULL,
    "asOf" DATETIME NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'ECB',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchantId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'DAILY',
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "recipients" TEXT NOT NULL,
    "lastRunAt" DATETIME,
    "nextRunAt" DATETIME,
    "settings" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReportSchedule_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "MerchantAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Store_shopDomain_key" ON "Store"("shopDomain");

-- CreateIndex
CREATE INDEX "Store_merchantId_idx" ON "Store"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_merchantId_key" ON "Subscription"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_merchantId_email_key" ON "TeamMember"("merchantId", "email");

-- CreateIndex
CREATE INDEX "AdAccountCredential_merchantId_idx" ON "AdAccountCredential"("merchantId");

-- CreateIndex
CREATE INDEX "AdAccountCredential_storeId_idx" ON "AdAccountCredential"("storeId");

-- CreateIndex
CREATE INDEX "SkuCost_storeId_sku_idx" ON "SkuCost"("storeId", "sku");

-- CreateIndex
CREATE INDEX "CostTemplate_storeId_idx" ON "CostTemplate"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_shopifyOrderId_key" ON "Order"("shopifyOrderId");

-- CreateIndex
CREATE INDEX "Order_storeId_idx" ON "Order"("storeId");

-- CreateIndex
CREATE INDEX "Order_processedAt_idx" ON "Order"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderAttribution_orderId_key" ON "OrderAttribution"("orderId");

-- CreateIndex
CREATE INDEX "DailyMetric_storeId_date_idx" ON "DailyMetric"("storeId", "date");

-- CreateIndex
CREATE INDEX "DailyMetric_storeId_channel_date_idx" ON "DailyMetric"("storeId", "channel", "date");

-- CreateIndex
CREATE INDEX "ReconciliationIssue_storeId_issueType_status_idx" ON "ReconciliationIssue"("storeId", "issueType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_base_quote_asOf_key" ON "ExchangeRate"("base", "quote", "asOf");
