import { randomUUID } from "node:crypto";
import prisma from "../db.server.js";
import { sendSlackNotification } from "./notifications.server.js";

const BILLING_TEST_MODE =
  process.env.SHOPIFY_BILLING_TEST_MODE === "true" ||
  process.env.NODE_ENV !== "production";

let shopifyModulePromise;

async function loadShopifyModule() {
  if (!shopifyModulePromise) {
    shopifyModulePromise = import("../shopify.server.js");
  }
  return shopifyModulePromise;
}

const OverageStatus = {
  PENDING: "PENDING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
};

export async function notifyPlanOverage({ merchantId, limit, usage, metric = "orders" }) {
  if (!merchantId) return;
  const limitLabel = metric === "orders" ? "订单" : metric;
  const message = `🚨 Plan limit reached for Profit Pulse workspace (${limitLabel}): ${usage} / ${limit}.`;
  await sendSlackNotification({
    merchantId,
    text: message,
  });
}

export async function schedulePlanOverageRecord({
  merchantId,
  metric,
  unitsRequired,
  unitAmount,
  currency,
  description,
  year,
  month,
  shopDomain,
  tx,
}) {
  if (!merchantId || !metric || !unitsRequired || unitsRequired <= 0) {
    return null;
  }

  const db = tx ?? prisma;
  const billedResult = await db.planOverageRecord.aggregate({
    _sum: { units: true },
    where: {
      merchantId,
      metric,
      year,
      month,
      status: { in: [OverageStatus.PENDING, OverageStatus.SUCCEEDED] },
    },
  });
  const billedUnits = Number(billedResult?._sum?.units ?? 0);
  const additionalUnits = unitsRequired - billedUnits;
  if (additionalUnits <= 0) {
    return null;
  }

  return db.planOverageRecord.create({
    data: {
      merchantId,
      metric,
      year,
      month,
      units: additionalUnits,
      unitAmount,
      currency,
      description,
      idempotencyKey: randomUUID(),
      shopDomain,
      status: OverageStatus.PENDING,
    },
  });
}

export async function processPlanOverageCharge(overageRecordId) {
  if (!overageRecordId) return null;

  const record = await prisma.planOverageRecord.findUnique({
    where: { id: overageRecordId },
    include: {
      merchant: {
        include: { stores: true },
      },
    },
  });

  if (!record || record.status !== OverageStatus.PENDING) {
    return null;
  }

  const storeDomain =
    record.shopDomain ??
    record.merchant?.stores?.find((store) => store.status === "ACTIVE")?.shopDomain ??
    record.merchant?.stores?.[0]?.shopDomain ??
    null;

  if (!storeDomain) {
    await prisma.planOverageRecord.update({
      where: { id: record.id },
      data: {
        status: OverageStatus.FAILED,
        failureReason: "No active store domain available for billing.",
        failedAt: new Date(),
      },
    });
    return null;
  }

  const { default: shopify, sessionStorage } = await loadShopifyModule();

  const sessionId = `offline_${storeDomain}`;
  const session = await sessionStorage.loadSession(sessionId);
  if (!session) {
    await prisma.planOverageRecord.update({
      where: { id: record.id },
      data: {
        status: OverageStatus.FAILED,
        failureReason: "Missing offline session for billing.",
        failedAt: new Date(),
      },
    });
    return null;
  }

  const description =
    record.description || `Usage overage (${record.metric}, ${record.units} units)`;
  const amount = Number(record.unitAmount) * record.units;

  try {
    const usageRecord = await shopify.api.billing.createUsageRecord({
      session,
      description,
      price: {
        amount,
        currencyCode: record.currency,
      },
      idempotencyKey: record.idempotencyKey ?? undefined,
      isTest: BILLING_TEST_MODE,
    });

    await prisma.planOverageRecord.update({
      where: { id: record.id },
      data: {
        status: OverageStatus.SUCCEEDED,
        chargedAt: new Date(),
        usageRecordId: usageRecord?.id ?? null,
        shopDomain: storeDomain,
        failureReason: null,
        failedAt: null,
      },
    });

    return usageRecord;
  } catch (error) {
    const failureReason =
      error instanceof Error ? error.message.slice(0, 512) : "Unknown billing error";
    await prisma.planOverageRecord.update({
      where: { id: record.id },
      data: {
        status: OverageStatus.FAILED,
        failureReason,
        failedAt: new Date(),
      },
    });
    throw error;
  }
}
