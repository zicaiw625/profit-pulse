import prisma from "../db.server.js";
import { getPlanDefinitionByTier } from "./billing.server.js";
import { PlanLimitError } from "../errors/plan-limit-error.js";
import { schedulePlanOverageRecord } from "./overages.server.js";

const DEFAULT_ALLOWANCES = {
  stores: 1,
  orders: 500,
  adAccounts: 2,
};

let planLimitsPrisma = prisma;
let schedulePlanOverageRecordImpl = schedulePlanOverageRecord;

export function setPlanLimitsPrismaForTests(testClient) {
  planLimitsPrisma = testClient ?? prisma;
}

export function setPlanOverageSchedulerForTests(fn) {
  schedulePlanOverageRecordImpl = fn ?? schedulePlanOverageRecord;
}

export async function getPlanUsage({ merchantId }) {
  if (!merchantId) {
    throw new Error("merchantId is required to calculate plan usage");
  }

  const { subscription, planDefinition, limit } = await getPlanLimitInfo(
    merchantId,
  );
  const allowances = planDefinition?.allowances ?? DEFAULT_ALLOWANCES;
  const { year, month } = getCurrentMonthKey();
  const monthlyOrderCount =
    (await getMonthlyOrderUsage(merchantId, year, month, planLimitsPrisma)) ??
    (await countOrdersForCurrentMonth(merchantId, planLimitsPrisma));

  const [storeCount, adAccountCount] = await Promise.all([
    planLimitsPrisma.store.count({ where: { merchantId } }),
    planLimitsPrisma.adAccountCredential.count({ where: { merchantId } }),
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

export async function ensureOrderCapacity({
  merchantId,
  incomingOrders = 1,
  tx,
  shopDomain,
} = {}) {
  if (!merchantId) {
    throw new Error("merchantId is required to ensure order capacity");
  }
  const db = tx ?? planLimitsPrisma;
  const { limit, planDefinition } = await getPlanLimitInfo(merchantId, db);
  if (!limit) return { overageRecord: null };

  if (!tx) {
    const { year, month } = getCurrentMonthKey();
    const currentOrders =
      (await getMonthlyOrderUsage(merchantId, year, month, db)) ??
      (await countOrdersForCurrentMonth(merchantId, db));
    const nextOrders = currentOrders + incomingOrders;
    if (nextOrders > limit) {
      const overageConfig = planDefinition?.overages?.orders ?? null;
      if (!overageConfig) {
        throw new PlanLimitError({
          code: "ORDER_LIMIT_REACHED",
          message:
            "Monthly order allowance reached. Upgrade plan to continue syncing orders.",
          detail: {
            limit,
            usage: currentOrders,
            incomingOrders,
          },
        });
      }
      const unitsRequired = calculateUnitsRequired({
        overLimit: nextOrders - limit,
        blockSize: overageConfig.blockSize,
      });
      await schedulePlanOverageRecordImpl({
        merchantId,
        metric: "orders",
        unitsRequired,
        unitAmount: overageConfig.price,
        currency: overageConfig.currency ?? planDefinition?.currency ?? "USD",
        description:
          overageConfig.description ?? "Additional order volume overage charge",
        year,
        month,
        shopDomain,
      });
    }
    return { overageRecord: null };
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
  const nextOrders = currentOrders + incomingOrders;
  let overageRecord = null;
  if (nextOrders > limit) {
    const overageConfig = planDefinition?.overages?.orders ?? null;
    if (!overageConfig) {
      throw new PlanLimitError({
        code: "ORDER_LIMIT_REACHED",
        message:
          "Monthly order allowance reached. Upgrade plan to continue syncing orders.",
        detail: {
          limit,
          usage: currentOrders,
          incomingOrders,
        },
      });
    }
    const unitsRequired = calculateUnitsRequired({
      overLimit: nextOrders - limit,
      blockSize: overageConfig.blockSize,
    });
    overageRecord = await schedulePlanOverageRecordImpl({
      merchantId,
      metric: "orders",
      unitsRequired,
      unitAmount: overageConfig.price,
      currency: overageConfig.currency ?? planDefinition?.currency ?? "USD",
      description:
        overageConfig.description ?? "Additional order volume overage charge",
      year,
      month,
      shopDomain,
      tx,
    });
  }
  await tx.monthlyOrderUsage.update({
    where: { merchantId_year_month: { merchantId, year, month } },
    data: { orders: { increment: incomingOrders } },
  });
  return { overageRecord };
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

async function countOrdersForCurrentMonth(merchantId, db = planLimitsPrisma) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return db.order.count({
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

async function getMonthlyOrderUsage(
  merchantId,
  year,
  month,
  db = planLimitsPrisma,
) {
  const row = await db.monthlyOrderUsage.findUnique({
    where: { merchantId_year_month: { merchantId, year, month } },
    select: { orders: true },
  });
  return row?.orders ?? null;
}

async function getPlanLimitInfo(merchantId, db = planLimitsPrisma) {
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

function calculateUnitsRequired({ overLimit, blockSize }) {
  const normalizedBlock = blockSize && blockSize > 0 ? blockSize : 1;
  return Math.ceil(overLimit / normalizedBlock);
}
