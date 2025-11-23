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
  shopDomain,
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
      const overageRecord = await recordPlanOverage({
        merchantId,
        usage: currentOrders,
        limit,
        incomingOrders,
        shopDomain,
        monthContext,
      });
      throw new PlanLimitError({
        code: "ORDER_LIMIT_REACHED",
        message:
          "Monthly order allowance reached. Upgrade plan to continue syncing orders.",
        detail: {
          limit,
          usage: currentOrders,
          incomingOrders,
          overageRecordId: overageRecord?.id ?? null,
        },
      });
    }
    return { overageRecord: null };
  }
  if (typeof db.monthlyOrderUsage?.upsert === "function") {
    await db.monthlyOrderUsage.upsert({
      where: {
        merchantId_year_month: {
          merchantId,
          year,
          month,
        },
      },
      create: {
        merchantId,
        year,
        month,
        orders: incomingOrders, // 第一次规模记这里
      },
      update: {
        orders: {
          increment: incomingOrders, // 之后每次累加
        },
      },
    });
  } else if (typeof db.$executeRaw === "function") {
    await db.$executeRaw`
      INSERT INTO "monthly_order_usage" ("merchantId","year","month","orders")
      VALUES (${merchantId}, ${year}, ${month}, 0)
      ON CONFLICT ("merchantId","year","month") DO NOTHING
    `;
  }

  const [row] = await (typeof tx?.$queryRaw === "function"
    ? tx.$queryRaw`
    SELECT "orders"
    FROM "monthly_order_usage"
    WHERE "merchantId" = ${merchantId} AND "year" = ${year} AND "month" = ${month}
    FOR UPDATE
  `
    : [{ orders: 0 }]);
  const currentOrders = Number(row?.orders ?? 0);
  const nextOrders = currentOrders + incomingOrders;
  if (nextOrders > limit) {
    const overageRecord = await recordPlanOverage({
      merchantId,
      usage: currentOrders,
      limit,
      incomingOrders,
      shopDomain,
      monthContext,
    });
    throw new PlanLimitError({
      code: "ORDER_LIMIT_REACHED",
      message:
        "Monthly order allowance reached. Upgrade plan to continue syncing orders.",
      detail: {
        limit,
        usage: currentOrders,
        incomingOrders,
        overageRecordId: overageRecord?.id ?? null,
      },
    });
  }
  if (typeof tx?.monthlyOrderUsage?.update === "function") {
    await tx.monthlyOrderUsage.update({
      where: { merchantId_year_month: { merchantId, year, month } },
      data: { orders: { increment: incomingOrders } },
    });
  } else if (typeof db?.$executeRaw === "function") {
    await db.$executeRaw`
      UPDATE "monthly_order_usage"
      SET "orders" = "orders" + ${incomingOrders}
      WHERE "merchantId" = ${merchantId} AND "year" = ${year} AND "month" = ${month}
    `;
  }
  return { overageRecord: null };
}

function buildUsage(count, limit) {
  const percent = limit ? Number(((count / limit) * 100).toFixed(1)) : null;
  let status = "ok";
  if (limit && count > limit) {
    status = "danger";
  } else if (limit && count < limit && percent >= 80) {
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

async function resolveMerchantCurrency(merchantId, db = planLimitsPrisma) {
  const merchant = await db.merchantAccount.findUnique({
    where: { id: merchantId },
    select: { primaryCurrency: true },
  });
  return merchant?.primaryCurrency ?? "USD";
}

async function recordPlanOverage({
  merchantId,
  usage,
  limit,
  incomingOrders,
  shopDomain,
  monthContext,
  db = planLimitsPrisma,
}) {
  if (typeof db?.planOverageRecord?.upsert !== "function") return null;
  const { year, month } = monthContext ?? (await getCurrentMonthContext({ merchantId, db }));
  const currency = await resolveMerchantCurrency(merchantId, db);
  const idempotencyKey = buildOverageIdempotencyKey({ merchantId, year, month });
  const units = Math.max(Number(incomingOrders ?? 0), 0);

  return db.planOverageRecord.upsert({
    where: { idempotencyKey },
    create: {
      merchantId,
      metric: "orders",
      year,
      month,
      units,
      unitAmount: 0,
      currency,
      description: `Orders exceeded monthly limit: ${usage} used + ${incomingOrders} incoming > ${limit}`,
      status: "PENDING",
      shopDomain,
    },
    update: {
      units: { increment: units },
      description: `Orders exceeded monthly limit: ${usage} used + ${incomingOrders} incoming > ${limit}`,
      status: "PENDING",
      shopDomain,
    },
  });
}

function buildOverageIdempotencyKey({ merchantId, year, month }) {
  return `orders:${merchantId}:${year}:${month}`;
}

function assertSubscriptionActive(subscription) {
  if (!subscription || inactiveSubscriptionsAllowed()) return;
  const now = Date.now();
  const trialActive =
    subscription.trialEndsAt &&
    new Date(subscription.trialEndsAt).getTime() > now;
  const status = subscription.status ?? "ACTIVE";
  if (status !== "ACTIVE" && !trialActive) {
    throw new PlanLimitError({
      code: "SUBSCRIPTION_INACTIVE",
      message:
        "Subscription is inactive. Activate or upgrade your plan to continue syncing orders.",
      detail: {
        status,
        trialEndsAt: subscription.trialEndsAt ?? null,
      },
    });
  }
}

// Allow trials/PoC environments to opt out of status enforcement by setting
// ALLOW_INACTIVE_SUBSCRIPTIONS=true. Defaults to strict enforcement.
function inactiveSubscriptionsAllowed() {
  const override = process.env.ALLOW_INACTIVE_SUBSCRIPTIONS;
  if (typeof override !== "string") return false;
  const normalized = override.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}
