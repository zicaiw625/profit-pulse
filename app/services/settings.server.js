import prisma from "../db.server";
import { getCostConfiguration } from "./costs.server";
import {
  getPlanOptions,
  getPlanDefinitionByTier,
} from "./billing.server";
import { getIntegrationStatus } from "./integrations.server";
import { getPlanUsage } from "./plan-limits.server";

export async function getAccountSettings({ store }) {
  if (!store?.merchantId) {
    throw new Error("Store is required to load account settings");
  }

  const merchant = await prisma.merchantAccount.findUnique({
    where: { id: store.merchantId },
    include: {
      subscription: true,
      stores: {
        orderBy: { installedAt: "asc" },
      },
    },
  });
  const primaryCurrency = merchant?.primaryCurrency ?? store.currency ?? "USD";

  const [
    costConfig,
    planOptions,
    integrations,
    planUsage,
    shopifyData,
    missingCostSkuCount,
  ] =
    await Promise.all([
      getCostConfiguration(store.id),
      Promise.resolve(getPlanOptions()),
      getIntegrationStatus(store.id),
      getPlanUsage({ merchantId: store.merchantId }),
      getShopifySyncStatus(store.id),
      countMissingCostSkus(store.id),
    ]);

  const subscription = merchant?.subscription;
  const planDefinition = getPlanDefinitionByTier(subscription?.plan);

  const plan = {
    tier: subscription?.plan ?? planDefinition.tier,
    name: planDefinition.name,
    description: planDefinition.description,
    price: planDefinition.price,
    currency: planDefinition.currency,
    intervalLabel: planDefinition.intervalLabel,
    status: subscription?.status ?? "INACTIVE",
    trialEndsAt: subscription?.trialEndsAt ?? null,
    nextBillingAt: subscription?.nextBillingAt ?? null,
    orderLimit: subscription?.orderLimit ?? planDefinition.allowances.orders,
    storeLimit: subscription?.storeLimit ?? planDefinition.allowances.stores,
    ownerEmail: merchant?.ownerEmail ?? null,
    trialDays: planDefinition.trialDays ?? 14,
  };

  return {
    plan,
    planOptions,
    stores: (merchant?.stores ?? []).map((item) => ({
      id: item.id,
      shopDomain: item.shopDomain,
      status: item.status,
      currency: item.currency,
      timezone: item.timezone,
      installedAt: item.installedAt,
      merchantCurrency: primaryCurrency,
    })),
    costConfig,
    integrations,
    primaryCurrency,
    planUsage: planUsage.usage,
    shopifyData,
    missingCostSkuCount,
  };
}

async function getShopifySyncStatus(storeId) {
  const [latestOrder, orderCount, refundCount] = await Promise.all([
    prisma.order.findFirst({
      where: { storeId },
      orderBy: { processedAt: "desc" },
      select: { processedAt: true },
    }),
    prisma.order.count({ where: { storeId } }),
    prisma.refundRecord.count({ where: { storeId } }),
  ]);

  return {
    lastOrderAt: latestOrder?.processedAt ?? null,
    totalOrders: orderCount,
    totalRefunds: refundCount,
  };
}

async function countMissingCostSkus(storeId) {
  return prisma.orderLineItem.count({
    where: {
      order: { storeId },
      sku: { not: null },
      revenue: { gt: 0 },
      cogs: { lte: 0 },
    },
  });
}
