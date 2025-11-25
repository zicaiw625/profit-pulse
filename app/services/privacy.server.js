import pkg from "@prisma/client";
import prisma from "../db.server";
import { formatDateKey } from "../utils/dates.server.js";

const { GdprRequestType, GdprRequestStatus, StoreStatus } = pkg;

function normalizeEmail(value) {
  return value?.toString().trim().toLowerCase() ?? "";
}

export async function queueGdprRequest({
  merchantId,
  storeId,
  type,
  subjectEmail,
  requestedBy,
  notes,
}) {
  const normalizedEmail = normalizeEmail(subjectEmail);
  if (!merchantId || !normalizedEmail) {
    throw new Error("merchantId and subject email are required for GDPR requests");
  }
  if (!Object.values(GdprRequestType).includes(type)) {
    throw new Error(`Unsupported GDPR request type: ${type}`);
  }

  return prisma.gdprRequest.create({
    data: {
      merchantId,
      storeId: storeId ?? null,
      type,
      status: GdprRequestStatus.PENDING,
      subjectEmail: normalizedEmail,
      requestedBy: requestedBy ?? null,
      notes: notes ?? null,
    },
  });
}

export async function listGdprRequests({ merchantId, storeId, limit = 10 }) {
  if (!merchantId) return [];
  return prisma.gdprRequest.findMany({
    where: {
      merchantId,
      ...(storeId ? { storeId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getGdprRequest({ merchantId, requestId }) {
  if (!merchantId || !requestId) return null;
  return prisma.gdprRequest.findFirst({
    where: { id: requestId, merchantId },
  });
}

async function buildExportPayload({ merchantId, subjectEmail }) {
  const orders = await prisma.order.findMany({
    where: {
      store: { merchantId },
      customerEmail: subjectEmail,
    },
    include: {
      refunds: true,
      costs: true,
    },
  });

  const refunds = await prisma.refundRecord.findMany({
    where: {
      store: { merchantId },
      customerEmail: subjectEmail,
    },
  });

  const adTouches = await prisma.orderAttribution.findMany({
    where: {
      order: { store: { merchantId }, customerEmail: subjectEmail },
    },
  });

  const schedules = await prisma.reportSchedule.findMany({
    where: {
      merchantId,
      recipients: { contains: subjectEmail },
    },
  });

  return {
    subject: subjectEmail,
    generatedAt: new Date().toISOString(),
    orders: orders.map((order) => ({
      id: order.id,
      shopifyOrderId: order.shopifyOrderId,
      processedAt: order.processedAt,
      financialStatus: order.financialStatus,
      total: order.total,
      currency: order.currency,
      shipping: order.shipping,
      tax: order.tax,
      discount: order.discount,
      grossProfit: order.grossProfit,
      netProfit: order.netProfit,
      costs: order.costs,
      refunds: order.refunds,
    })),
    refunds,
    adAttributions: adTouches,
    subscriptions: schedules.map((schedule) => ({
      id: schedule.id,
      frequency: schedule.frequency,
      channel: schedule.channel,
      createdAt: schedule.createdAt,
    })),
  };
}

async function anonymizeCustomerData({ merchantId, subjectEmail }) {
  const stores = await prisma.store.findMany({
    where: { merchantId },
    select: { id: true },
  });
  if (!stores.length) return { orders: 0 };
  const storeIds = stores.map((store) => store.id);
  const { count } = await prisma.order.updateMany({
    where: {
      storeId: { in: storeIds },
      customerEmail: subjectEmail,
    },
    data: {
      customerEmail: null,
      customerId: null,
      customerName: null,
    },
  });
  await prisma.orderAttribution.deleteMany({
    where: {
      order: { storeId: { in: storeIds }, customerEmail: subjectEmail },
    },
  });
  return { orders: count };
}

export async function processGdprRequest({ requestId, merchantId }) {
  if (!requestId || !merchantId) {
    throw new Error("requestId and merchantId are required to process GDPR requests");
  }

  const request = await prisma.gdprRequest.findFirst({
    where: { id: requestId, merchantId },
  });
  if (!request) {
    throw new Error("Unable to locate GDPR request");
  }
  if (request.status === GdprRequestStatus.COMPLETED) {
    return request;
  }

  await prisma.gdprRequest.update({
    where: { id: request.id },
    data: { status: GdprRequestStatus.PROCESSING },
  });

  try {
    const subjectEmail = request.subjectEmail;
    let exportPayload = null;
    let notes = null;

    if (request.type === GdprRequestType.EXPORT) {
      exportPayload = await buildExportPayload({
        merchantId,
        subjectEmail,
      });
    } else if (request.type === GdprRequestType.DELETE) {
      const stats = await anonymizeCustomerData({ merchantId, subjectEmail });
      notes = `Anonymized ${stats.orders} orders for ${subjectEmail}`;
    }

    const completed = await prisma.gdprRequest.update({
      where: { id: request.id },
      data: {
        status: GdprRequestStatus.COMPLETED,
        exportPayload,
        processedAt: new Date(),
        notes,
        updatedAt: new Date(),
      },
    });

    return completed;
  } catch (error) {
    await prisma.gdprRequest.update({
      where: { id: request.id },
      data: {
        status: GdprRequestStatus.FAILED,
        notes: error.message ?? "Unknown error", 
        updatedAt: new Date(),
      },
    });
    throw error;
  }
}

export async function queueCustomerPrivacyRequest({
  shopDomain,
  type,
  subjectEmail,
  requestedBy = "shopify-webhook",
  notes,
}) {
  if (!shopDomain || !subjectEmail) {
    return null;
  }

  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { id: true, merchantId: true },
  });

  if (!store) {
    return null;
  }

  return queueGdprRequest({
    merchantId: store.merchantId,
    storeId: store.id,
    type,
    subjectEmail,
    requestedBy,
    notes,
  });
}

export async function queueShopRedactionRequest({
  shopDomain,
  requestedBy = "shopify-webhook",
}) {
  if (!shopDomain) {
    return null;
  }

  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { id: true, merchantId: true, status: true },
  });

  if (!store) {
    return null;
  }

  const pseudoEmail = `shop@${shopDomain}`;

  const request = await queueGdprRequest({
    merchantId: store.merchantId,
    storeId: store.id,
    type: GdprRequestType.DELETE,
    subjectEmail: pseudoEmail,
    requestedBy,
    notes: "Shopify shop redact webhook received",
  });

  await prisma.store.update({
    where: { id: store.id },
    data: {
      status: StoreStatus.DISCONNECTED,
      disconnectedAt: new Date(),
    },
  });

  await prisma.adAccountCredential.deleteMany({ where: { storeId: store.id } });
  await prisma.logisticsCredential.deleteMany({ where: { storeId: store.id } });
  await prisma.syncJob.deleteMany({ where: { storeId: store.id } });

  return request;
}

export async function summarizeGdprActivity({ merchantId }) {
  if (!merchantId) {
    return { total: 0, pending: 0, lastProcessed: null };
  }
  const [total, pending, latest] = await Promise.all([
    prisma.gdprRequest.count({ where: { merchantId } }),
    prisma.gdprRequest.count({
      where: { merchantId, status: GdprRequestStatus.PENDING },
    }),
    prisma.gdprRequest.findFirst({
      where: { merchantId, status: GdprRequestStatus.COMPLETED },
      orderBy: { processedAt: "desc" },
    }),
  ]);
  return {
    total,
    pending,
    lastProcessed: latest?.processedAt ?? null,
  };
}

export function formatGdprRequestLabel(request) {
  const dateKey = request?.createdAt ? formatDateKey(request.createdAt) : "—";
  return `${request.type} · ${request.subjectEmail} · ${dateKey}`;
}
