-- CreateIndex
CREATE UNIQUE INDEX "DailyMetric_storeId_channel_productSku_date_key" ON "DailyMetric"("storeId", "channel", "productSku", "date");
