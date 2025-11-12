import pkg from "@prisma/client";
import prisma from "../db.server";
import { PLAN_DEFINITIONS } from "../config/billing";

const { PlanTier } = pkg;
const defaultPlan = PLAN_DEFINITIONS.FREE;

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
