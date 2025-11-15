import pkg from "@prisma/client";
import prisma from "../db.server.js";
import { PLAN_DEFINITIONS } from "../config/billing.js";
import { PlanLimitError } from "../errors/plan-limit-error.js";
import {
  processPlanOverageCharge,
  schedulePlanOverageRecord,
} from "../services/overages.server.js";
import { createScopedLogger, serializeError } from "../utils/logger.server.js";

const { PlanTier, Prisma } = pkg;
const defaultPlan = PLAN_DEFINITIONS.FREE;
const storeLogger = createScopedLogger({ service: "store" });

export async function ensureMerchantAndStore(shopDomain, ownerEmail) {
  if (!shopDomain) {
    throw new Error("Shop domain missing from session");
  }

  const existingStore = await prisma.store.findUnique({
    where: { shopDomain },
    include: { merchant: true },
  });

  if (existingStore) {
    return existingStore;
  }

  let merchant = null;
  if (ownerEmail) {
    merchant = await prisma.merchantAccount.findFirst({
      where: { ownerEmail },
      include: { subscription: true },
    });
  }

  if (!merchant) {
    merchant = await prisma.merchantAccount.create({
      data: {
        name: humanizeShopDomain(shopDomain),
        ownerEmail: ownerEmail ?? null,
        primaryCurrency: "USD",
        primaryTimezone: "UTC",
        subscription: {
          create: {
            plan: defaultPlan?.tier ?? PlanTier.BASIC,
            status: "ACTIVE",
            orderLimit: defaultPlan?.allowances?.orders ?? 500,
            storeLimit: defaultPlan?.allowances?.stores ?? 1,
          },
        },
      },
    });
  } else if (!merchant.ownerEmail && ownerEmail) {
    merchant = await prisma.merchantAccount.update({
      where: { id: merchant.id },
      data: { ownerEmail },
    });
  }

  const subscription = await prisma.subscription.findUnique({
    where: { merchantId: merchant.id },
  });
  const planDefinition = resolvePlanDefinition(subscription?.plan);
  const storeLimit = subscription?.storeLimit ?? planDefinition?.allowances?.stores ?? 1;
  const currentStoreCount = await prisma.store.count({
    where: { merchantId: merchant.id },
  });
  const nextStoreCount = currentStoreCount + 1;
  const storeOverageConfig = planDefinition?.overages?.stores ?? null;

  if (nextStoreCount > storeLimit && !storeOverageConfig) {
    throw new PlanLimitError({
      code: "STORE_LIMIT_REACHED",
      message: "Store limit reached for current plan. Upgrade to add more stores.",
      detail: {
        limit: storeLimit,
        usage: currentStoreCount,
      },
    });
  }

  let store = null;
  try {
    store = await prisma.store.create({
      data: {
        merchantId: merchant.id,
        shopDomain,
        currency: merchant.primaryCurrency,
        timezone: merchant.primaryTimezone,
      },
      include: { merchant: true },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const existing = await findExistingStoreWithRetry(shopDomain);
      if (existing) {
        return existing;
      }
    }

    throw error;
  }

  if (nextStoreCount > storeLimit && storeOverageConfig) {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;
    const blockSize = storeOverageConfig.blockSize && storeOverageConfig.blockSize > 0
      ? storeOverageConfig.blockSize
      : 1;
    const unitsRequired = Math.ceil((nextStoreCount - storeLimit) / blockSize);
    const overageRecord = await schedulePlanOverageRecord({
      merchantId: merchant.id,
      metric: "stores",
      unitsRequired,
      unitAmount: storeOverageConfig.price,
      currency: storeOverageConfig.currency ?? planDefinition?.currency ?? "USD",
      description:
        storeOverageConfig.description ?? "Additional store overage charge",
      year,
      month,
      shopDomain,
    });
    if (overageRecord?.id) {
      try {
        await processPlanOverageCharge(overageRecord.id);
      } catch (error) {
        storeLogger.error("store_overage_charge_failed", {
          overageRecordId: overageRecord.id,
          error: serializeError(error),
        });
      }
    }
  }

  return store;
}

function humanizeShopDomain(shopDomain) {
  return shopDomain.replace(".myshopify.com", "").replace(/[-_]/g, " ");
}

function resolvePlanDefinition(planTier) {
  if (!planTier) return defaultPlan;
  return (
    Object.values(PLAN_DEFINITIONS).find((plan) => plan.tier === planTier) ||
    defaultPlan
  );
}

export function isUniqueConstraintError(error) {
  if (!error) return false;
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  return error.code === "P2002";
}

async function findExistingStoreWithRetry(shopDomain, attempts = 5) {
  const delayMs = 50;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const existing = await prisma.store.findUnique({
      where: { shopDomain },
      include: { merchant: true },
    });
    if (existing) {
      return existing;
    }

    if (attempt < attempts - 1) {
      const waitTime = delayMs * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  return null;
}
