import prisma from "../db.server.js";
import { getPlanDefinitionByTier } from "./billing.server.js";
import { PlanLimitError } from "../errors/plan-limit-error.js";
import {
  getMonthKey,
  startOfMonth,
  startOfNextMonth,
} from "../utils/dates.server.js";

const DEFAULT_ALLOWANCES = {
  stores: 1,
  orders: 1000,
};

let planLimitsPrisma = prisma;

export function setPlanLimitsPrismaForTests(testClient) {
  planLimitsPrisma = testClient ?? prisma;
}

export async function getPlanUsage({ merchantId, referenceDate } = {}) {
  if (!merchantId) {
    throw new Error("merchantId is required to calculate plan usage");
  }

  const { subscription, planDefinition, limit } = await getPlanLimitInfo(
    merchantId,
  );
  const allowances = planDefinition?.allowances ?? DEFAULT_ALLOWANCES;
  const monthContext = await getCurrentMonthContext({
    merchantId,
    db: planLimitsPrisma,
    referenceDate,
  });
  const { year, month } = monthContext;
  const monthlyOrderCount =
    (await getMonthlyOrderUsage(merchantId, year, month, planLimitsPrisma)) ??
    (await countOrdersForMonthRange(
      merchantId,
      monthContext.monthStart,
      monthContext.monthEnd,
      planLimitsPrisma,
    ));

  const storeCount = await planLimitsPrisma.store.count({
    where: { merchantId },
  });

  const usage = {
    stores: buildUsage(storeCount, subscription?.storeLimit ?? allowances.stores),
    orders: buildUsage(monthlyOrderCount, limit ?? allowances.orders),
  };

  return { usage, subscription, planDefinition };
}

export async function ensureOrderCapacity({
  merchantId,
  incomingOrders = 1,
  tx,
} = {}) {
  if (!merchantId) {
    throw new Error("merchantId is required to ensure order capacity");
  }
  const db = tx ?? planLimitsPrisma;
  const { limit, subscription } = await getPlanLimitInfo(merchantId, db);
  assertSubscriptionActive(subscription);
  if (!limit) return { overageRecord: null };

  const monthContext = await getCurrentMonthContext({ merchantId, db });
  const { year, month } = monthContext;

  if (!tx) {
    const currentOrders =
      (await getMonthlyOrderUsage(merchantId, year, month, db)) ??
      (await countOrdersForMonthRange(
        merchantId,
        monthContext.monthStart,
        monthContext.monthEnd,
        db,
      ));
    const nextOrders = currentOrders + incomingOrders;
    if (nextOrders > limit) {
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
    return { overageRecord: null };
  }

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
  if (nextOrders > limit) {
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
  await tx.monthlyOrderUsage.update({
    where: { merchantId_year_month: { merchantId, year, month } },
    data: { orders: { increment: incomingOrders } },
  });
  return { overageRecord: null };
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

async function countOrdersForMonthRange(
  merchantId,
  monthStart,
  monthEnd,
  db = planLimitsPrisma,
) {
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

async function getCurrentMonthContext({
  merchantId,
  db = planLimitsPrisma,
  referenceDate = new Date(),
}) {
  const timezone = await resolveMerchantTimezone(merchantId, db);
  const monthStart = startOfMonth(referenceDate, { timezone });
  const monthEnd = startOfNextMonth(referenceDate, { timezone });
  const { year, month } = getMonthKey(referenceDate, { timezone });
  return { year, month, timezone, monthStart, monthEnd };
}

async function resolveMerchantTimezone(merchantId, db = planLimitsPrisma) {
  const merchant = await db.merchantAccount.findUnique({
    where: { id: merchantId },
    select: { primaryTimezone: true },
  });
  return merchant?.primaryTimezone ?? "UTC";
}

function assertSubscriptionActive(subscription) {
  if (!subscription) return;
  const now = Date.now();
  const trialActive =
    subscription.trialEndsAt &&
    new Date(subscription.trialEndsAt).getTime() > now;
  //if (subscription.status !== "ACTIVE" && !trialActive) {
  //  throw new PlanLimitError({
  //    code: "SUBSCRIPTION_INACTIVE",
  //    message:
  //      "Subscription is inactive. Activate or upgrade your plan to continue syncing orders.",
  //    detail: {
  //      status: subscription.status ?? "INACTIVE",
  //    },
  //  });
  //}
}
