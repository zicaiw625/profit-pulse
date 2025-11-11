import pkg from "@prisma/client";
import prisma from "../db.server";
import { PLAN_DEFINITIONS } from "../config/billing";

const { PlanTier } = pkg;
const defaultPlan = PLAN_DEFINITIONS.BASIC;

export async function ensureMerchantAndStore(shopDomain) {
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

  const merchant = await prisma.merchantAccount.create({
    data: {
      name: humanizeShopDomain(shopDomain),
      ownerEmail: null,
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

  return prisma.store.create({
    data: {
      merchantId: merchant.id,
      shopDomain,
      currency: merchant.primaryCurrency,
      timezone: merchant.primaryTimezone,
    },
    include: { merchant: true },
  });
}

function humanizeShopDomain(shopDomain) {
  return shopDomain.replace(".myshopify.com", "").replace(/[-_]/g, " ");
}
