import pkg from "@prisma/client";
import prisma from "../db.server.js";
import {
  UNINSTALL_RETENTION_DAYS,
  UNINSTALL_RETENTION_WINDOW_MS,
} from "../constants/retention.js";
import { createScopedLogger, serializeError } from "../utils/logger.server.js";

const { Prisma, StoreStatus } = pkg;
const retentionLogger = createScopedLogger({ service: "retention" });

export async function markStoreDisconnected({
  shopDomain,
  disconnectedAt = new Date(),
}) {
  if (!shopDomain) return null;

  try {
    const store = await prisma.store.update({
      where: { shopDomain },
      data: {
        status: StoreStatus.DISCONNECTED,
        disconnectedAt,
      },
      select: { id: true, merchantId: true, shopDomain: true, disconnectedAt: true },
    });

    return store;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      retentionLogger.warn("mark_store_disconnected_not_found", { shopDomain });
      return null;
    }

    retentionLogger.error("mark_store_disconnected_failed", {
      shopDomain,
      error: serializeError(error),
    });
    throw error;
  }
}

export async function purgeDisconnectedStores({
  retentionDays = UNINSTALL_RETENTION_DAYS,
  limit = 20,
} = {}) {
  const days =
    typeof retentionDays === "number" && retentionDays > 0
      ? retentionDays
      : UNINSTALL_RETENTION_DAYS;
  const retentionWindowMs = (days / UNINSTALL_RETENTION_DAYS) * UNINSTALL_RETENTION_WINDOW_MS;
  const cutoff = new Date(Date.now() - retentionWindowMs);

  const stores = await prisma.store.findMany({
    where: {
      status: StoreStatus.DISCONNECTED,
      disconnectedAt: { not: null, lte: cutoff },
    },
    select: {
      id: true,
      merchantId: true,
      shopDomain: true,
      disconnectedAt: true,
    },
    take: limit,
  });

  const result = {
    checked: stores.length,
    deleted: 0,
    retentionDays: days,
    retentionWindowMs,
    cutoff: cutoff.toISOString(),
    storeDomains: [],
  };

  for (const store of stores) {
    try {
      await purgeStoreData(store, { retentionDays: days, retentionWindowMs });
      result.deleted += 1;
      result.storeDomains.push(store.shopDomain);
    } catch (error) {
      retentionLogger.error("retention_purge_failed", {
        storeId: store.id,
        shopDomain: store.shopDomain,
        error: serializeError(error),
      });
    }
  }

  return result;
}

async function purgeStoreData(store, { retentionDays, retentionWindowMs }) {
  await prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { shop: store.shopDomain } });
    await tx.adAccountCredential.deleteMany({ where: { storeId: store.id } });
    await tx.logisticsCredential.deleteMany({ where: { storeId: store.id } });
    await tx.syncJob.deleteMany({ where: { storeId: store.id } });
    await tx.adSpendRecord.deleteMany({ where: { storeId: store.id } });
    await tx.paymentPayout.deleteMany({ where: { storeId: store.id } });
    await tx.inventoryLevel.deleteMany({ where: { storeId: store.id } });
    await tx.refundRecord.deleteMany({ where: { storeId: store.id } });
    await tx.order.deleteMany({ where: { storeId: store.id } });
    await tx.dailyMetric.deleteMany({ where: { storeId: store.id } });
    await tx.reconciliationIssue.deleteMany({ where: { storeId: store.id } });
    await tx.costTemplateLine.deleteMany({ where: { template: { storeId: store.id } } });
    await tx.costTemplate.deleteMany({ where: { storeId: store.id } });
    await tx.skuCost.deleteMany({ where: { storeId: store.id } });
    await tx.logisticsRule.deleteMany({ where: { storeId: store.id } });
    await tx.taxRate.deleteMany({ where: { storeId: store.id } });
    await tx.gdprRequest.deleteMany({ where: { storeId: store.id } });
    await tx.store.delete({ where: { id: store.id } });
  });

  const deleteAfter = new Date(
    (store?.disconnectedAt?.getTime?.() ?? Date.now()) + retentionWindowMs,
  );

  retentionLogger.info("store_data_purged", {
    storeId: store.id,
    shopDomain: store.shopDomain,
    merchantId: store.merchantId,
    deletedAfterDays: retentionDays,
    retentionCutoff: deleteAfter.toISOString(),
  });
}
