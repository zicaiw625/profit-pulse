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

  const { subscription, planDefinition, limit } = await getPlanLimitInfo(merchantId);
  const allowances = planDefinition?.allowances ?? DEFAULT_ALLOWANCES;
  const { year, month } = getCurrentMonthKey();
  const monthlyOrderCount =
    (await getMonthlyOrderUsage(merchantId, year, month)) ??
    (await countOrdersForCurrentMonth(merchantId));

  const [storeCount, adAccountCount] = await Promise.all([
    prisma.store.count({ where: { merchantId } }),
    prisma.adAccountCredential.count({ where: { merchantId } }),
  ]);

  const usage = {
    stores: buildUsage(storeCount, subscription?.storeLimit ?? allowances.stores),
    adAccounts: buildUsage(
      adAccountCount,
      allowances.adAccounts ?? DEFAULT_ALLOWANCES.adAccounts,
    ),
    orders: buildUsage(monthlyOrderCount, limit ?? allowances.orders),
  };

  return { usage, subscription, planDefinition };
}

export async function ensureOrderCapacity({ merchantId, incomingOrders = 1, tx } = {}) {
  if (!merchantId) {
    throw new Error("merchantId is required to ensure order capacity");
  }
  const db = tx ?? prisma;
  const { limit } = await getPlanLimitInfo(merchantId, db);
  if (!limit) return;

  if (!tx) {
    const { year, month } = getCurrentMonthKey();
    const currentOrders =
      (await getMonthlyOrderUsage(merchantId, year, month)) ??
      (await countOrdersForCurrentMonth(merchantId));
    if (currentOrders + incomingOrders > limit) {
      throw new PlanLimitError({
        code: "ORDER_LIMIT_REACHED",
        message: "Monthly order allowance reached. Upgrade plan to continue syncing orders.",
        detail: {
          limit,
          usage: currentOrders,
          incomingOrders,
        },
      });
    }
    return;
  }

  const { year, month } = getCurrentMonthKey();
  await tx.$executeRaw`
    INSERT INTO "monthly_order_usage"("merchantId", "year", "month", "orders")
    VALUES (${merchantId}, ${year}, ${month}, 0)
    ON CONFLICT ("merchantId", "year", "month") DO NOTHING
  `;
  const [row] = await tx.$queryRaw`
    SELECT "orders"
    FROM "monthly_order_usage"
    WHERE "merchantId" = ${merchantId} AND "year" = ${year} AND "month" = ${month}
    FOR UPDATE
  `;
  const currentOrders = Number(row?.orders ?? 0);
  if (currentOrders + incomingOrders > limit) {
    throw new PlanLimitError({
      code: "ORDER_LIMIT_REACHED",
      message: "Monthly order allowance reached. Upgrade plan to continue syncing orders.",
      detail: {
        limit,
        usage: currentOrders,
        incomingOrders,
      },
    });
  }
  await tx.monthlyOrderUsage.update({
    where: { merchantId_year_month: { merchantId, year, month } },
    data: { orders: { increment: incomingOrders } },
  });
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

async function getMonthlyOrderUsage(merchantId, year, month, db = prisma) {
  const row = await db.monthlyOrderUsage.findUnique({
    where: { merchantId_year_month: { merchantId, year, month } },
    select: { orders: true },
  });
  return row?.orders ?? null;
}

async function getPlanLimitInfo(merchantId, db = prisma) {
  const subscription = await db.subscription.findUnique({
    where: { merchantId },
  });
  const planDefinition = getPlanDefinitionByTier(subscription?.plan);
  const allowances = planDefinition?.allowances ?? DEFAULT_ALLOWANCES;
  const limit = subscription?.orderLimit ?? allowances.orders;
  return { subscription, planDefinition, limit };
}

function getCurrentMonthKey() {
  const now = new Date();
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
  };
}
