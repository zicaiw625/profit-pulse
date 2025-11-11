import prisma from "../db.server";
import { getCostConfiguration } from "./costs.server";
import { listFixedCosts } from "./fixed-costs.server";
import { listNotificationChannels } from "./notifications.server";
import { getExchangeRateSummary } from "./exchange-rates.server";
import {
  getPlanOptions,
  getPlanDefinitionByTier,
} from "./billing.server";
import { getIntegrationStatus } from "./integrations.server";
import { getPlanUsage } from "./plan-limits.server";
import { listTeamMembers } from "./team.server";
import { listReportSchedules } from "./report-schedules.server";
import { getMerchantPerformanceSummary } from "./merchant-performance.server";

export async function getAccountSettings({ store }) {
  const merchant = await prisma.merchantAccount.findUnique({
    where: { id: store.merchantId },
    include: {
      subscription: true,
      stores: {
        orderBy: { installedAt: "asc" },
      },
      members: true,
    },
  });
  const primaryCurrency = merchant?.primaryCurrency ?? store.currency ?? "USD";

  const [
    costConfig,
    planOptions,
    integrations,
    planUsageResult,
    teamMembers,
    shopifyData,
    fixedCosts,
    notificationChannels,
    exchangeRateSummary,
    reportSchedules,
  ] =
    await Promise.all([
      getCostConfiguration(store.id),
      Promise.resolve(getPlanOptions()),
      getIntegrationStatus(store.id),
      getPlanUsage({ merchantId: store.merchantId, storeId: store.id }),
      listTeamMembers(store.merchantId),
      getShopifySyncStatus(store.id),
      listFixedCosts(store.merchantId),
      listNotificationChannels(store.merchantId),
      getExchangeRateSummary(primaryCurrency),
      listReportSchedules(store.merchantId),
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
    limits: {
      stores: `${merchant?.stores?.length ?? 0} / ${
        subscription?.storeLimit ?? planDefinition.allowances.stores
      }`,
      orders: `${
        subscription?.orderLimit ?? planDefinition.allowances.orders
      } monthly orders`,
    },
  };

  const merchantSummary =
    store.merchantId != null
      ? await getMerchantPerformanceSummary({ merchantId: store.merchantId })
      : null;

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
    fixedCosts,
    notifications: notificationChannels,
    reportSchedules,
    exchangeRates: exchangeRateSummary,
    primaryCurrency,
    planUsage: planUsageResult.usage,
    teamMembers: (teamMembers.length ? teamMembers : merchant?.members ?? []).map(
      (member) => ({
        id: member.id,
        email: member.email,
        name: member.name,
        role: member.role,
        status: member.status,
        invitedAt: member.invitedAt,
      }),
    ),
    shopifyData,
    merchantSummary,
  };
}

async function getShopifySyncStatus(storeId) {
  const [latestOrder, orderCount] = await Promise.all([
    prisma.order.findFirst({
      where: { storeId },
      orderBy: { processedAt: "desc" },
      select: { processedAt: true },
    }),
    prisma.order.count({ where: { storeId } }),
  ]);

  return {
    lastOrderAt: latestOrder?.processedAt ?? null,
    totalOrders: orderCount,
  };
}
