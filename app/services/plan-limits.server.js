import prisma from "../db.server";
import { getPlanDefinitionByTier } from "./billing.server";
import { PlanLimitError } from "../errors/plan-limit-error";

const DEFAULT_ALLOWANCES = {
  stores: 1,
  orders: 500,
  adAccounts: 2,
};

export async function getPlanUsage({ merchantId }) {
  if (!merchantId) {
    throw new Error("merchantId is required to calculate plan usage");
  }

  const subscription = await prisma.subscription.findUnique({
    where: { merchantId },
  });
  const planDef = getPlanDefinitionByTier(subscription?.plan);
  const allowances = planDef?.allowances ?? DEFAULT_ALLOWANCES;

  const [storeCount, adAccountCount, monthlyOrderCount] = await Promise.all([
    prisma.store.count({ where: { merchantId } }),
    prisma.adAccountCredential.count({ where: { merchantId } }),
    countOrdersForCurrentMonth(merchantId),
  ]);

  const usage = {
    stores: buildUsage(storeCount, subscription?.storeLimit ?? allowances.stores),
    adAccounts: buildUsage(
      adAccountCount,
      allowances.adAccounts ?? DEFAULT_ALLOWANCES.adAccounts,
    ),
    orders: buildUsage(
      monthlyOrderCount,
      subscription?.orderLimit ?? allowances.orders,
    ),
  };

  return { usage, subscription, planDefinition: planDef };
}

export async function ensureOrderCapacity({ merchantId, incomingOrders = 1 }) {
  const { usage } = await getPlanUsage({ merchantId });
  const limit = usage.orders.limit;
  if (!limit) return;
  if (usage.orders.count + incomingOrders > limit) {
    throw new PlanLimitError({
      code: "ORDER_LIMIT_REACHED",
      message: "Monthly order allowance reached. Upgrade plan to continue syncing orders.",
      detail: {
        limit,
        usage: usage.orders.count,
        incomingOrders,
      },
    });
  }
}

function buildUsage(count, limit) {
  const percent = limit ? Number(((count / limit) * 100).toFixed(1)) : null;
  let status = "ok";
  if (limit && count >= limit) {
    status = "danger";
  } else if (limit && percent >= 80) {
    status = "warning";
  }
  return {
    count,
    limit,
    percent,
    status,
  };
}

async function countOrdersForCurrentMonth(merchantId) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return prisma.order.count({
    where: {
      store: {
        merchantId,
      },
      processedAt: {
        gte: monthStart,
        lt: monthEnd,
      },
    },
  });
}
