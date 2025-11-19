import pkg from "@prisma/client";
import { startOfDay } from "../../utils/dates.server.js";
import { summarizeRefundLineItems } from "./refunds.js";

const { CostType } = pkg;

export async function updateDailyMetrics(tx, payload, options = {}) {
  const metricDate = startOfDay(payload.date);
  const direction = options.direction ?? 1;
  const allowCreate = options.allowCreate ?? direction > 0;
  const totals = {
    currency: payload.currency,
    orders: payload.orderCount,
    units: payload.units,
    revenue: payload.revenue,
    adSpend: payload.adSpend ?? 0,
    cogs: payload.cogs,
    shippingCost: payload.shippingCost,
    paymentFees: payload.paymentFees,
    refundAmount: payload.refundAmount ?? 0,
    refunds: payload.refundCount ?? 0,
    grossProfit: payload.grossProfit,
    netProfit: payload.netProfit,
  };

  await adjustMetricRow(
    tx,
    {
      storeId: payload.storeId,
      channel: "TOTAL",
      productSku: null,
      date: metricDate,
    },
    totals,
    { direction, allowCreate },
  );

  if (payload.channel && payload.channel !== "TOTAL" && payload.channel !== "PRODUCT") {
    await adjustMetricRow(
      tx,
      {
        storeId: payload.storeId,
        channel: payload.channel,
        productSku: null,
        date: metricDate,
      },
      totals,
      { direction, allowCreate },
    );
  }

  for (const line of payload.lineRecords ?? []) {
    if (!line.sku) continue;

    const revenueShare =
      payload.revenue > 0 ? line.revenue / payload.revenue : 0;

    const refundAllocation = resolveRefundForLine(
      line.sku,
      payload.refundBySku,
      payload.refundAmount,
      revenueShare,
    );

    const productValues = {
      currency: payload.currency,
      orders: 1,
      units: line.quantity,
      revenue: line.revenue,
      adSpend: 0,
      cogs: line.cogs,
      shippingCost: payload.shippingCost * revenueShare,
      paymentFees: payload.paymentFees * revenueShare,
      refundAmount: refundAllocation,
      refunds: refundAllocation > 0 ? 1 : 0,
      grossProfit: line.revenue - line.cogs,
      netProfit:
        line.revenue -
        line.cogs -
        payload.shippingCost * revenueShare -
        payload.paymentFees * revenueShare,
    };

    await adjustMetricRow(
      tx,
      {
        storeId: payload.storeId,
        channel: "PRODUCT",
        productSku: line.sku,
        date: metricDate,
      },
      productValues,
      { direction, allowCreate },
    );
  }
}

export function buildSnapshotFromOrder(order) {
  if (!order) {
    return null;
  }

  const revenue = Number(order.total ?? 0);
  const cogs = sumOrderCost(order.costs, CostType.COGS);
  const shippingCost = sumOrderCost(order.costs, CostType.SHIPPING);
  const paymentFees = sumOrderCost(order.costs, CostType.PAYMENT_FEE);
  const platformFees = sumOrderCost(order.costs, CostType.PLATFORM_FEE);
  const customCosts = sumOrderCost(order.costs, CostType.CUSTOM);
  const grossProfit = revenue - cogs - shippingCost - paymentFees;
  const netProfit = grossProfit - platformFees - customCosts;

  const lineRecords = (order.lineItems ?? []).map((line) => ({
    productId: line.productId,
    variantId: line.variantId,
    sku: line.sku ?? undefined,
    title: line.title ?? "",
    quantity: Number(line.quantity ?? 0),
    price: Number(line.price ?? 0),
    discount: Number(line.discount ?? 0),
    revenue: Number(line.revenue ?? 0),
    cogs: Number(line.cogs ?? 0),
  }));

  const refundSummary = summarizeRefundRecords(order.refunds ?? []);
  const units = lineRecords.reduce((sum, record) => sum + (record.quantity ?? 0), 0);

  return {
    storeId: order.storeId,
    date: order.processedAt ?? new Date(),
    currency: order.currency ?? "USD",
    channel: resolveOrderChannel(order.sourceName),
    orderCount: 1,
    units,
    revenue,
    cogs,
    shippingCost,
    paymentFees,
    grossProfit,
    netProfit,
    lineRecords,
    refundAmount: refundSummary.amount,
    refundCount: refundSummary.count,
    refundBySku: refundSummary.bySku,
  };
}

export function resolveOrderChannel(sourceName) {
  const normalized = (sourceName ?? "online store").toString().trim();
  if (!normalized) return "ONLINE_STORE";
  const normalizedLower = normalized.toLowerCase();
  for (const entry of ORDER_CHANNEL_OVERRIDES) {
    if (entry.pattern.test(normalizedLower)) {
      return entry.channel;
    }
  }
  return normalized
    .replace(/[^\w]+/g, "_")
    .replace(/^_|_$/g, "")
    .toUpperCase() || "ONLINE_STORE";
}

async function adjustMetricRow(tx, where, values, options = {}) {
  const direction = options.direction ?? 1;
  const allowCreate = options.allowCreate ?? direction > 0;
  const existing = await tx.dailyMetric.findUnique({ where });
  if (!existing) {
    if (!allowCreate) return;
    await tx.dailyMetric.create({
      data: {
        ...where,
        ...values,
      },
    });
    return;
  }

  const applyValue = (value) => (value ?? 0) * direction;
  const data = {};
  const numericFields = [
    "orders",
    "units",
    "revenue",
    "adSpend",
    "cogs",
    "shippingCost",
    "paymentFees",
    "refundAmount",
    "refunds",
    "grossProfit",
    "netProfit",
  ];
  for (const field of numericFields) {
    if (values[field] !== undefined) {
      data[field] = { increment: applyValue(values[field]) };
    }
  }

  if (Object.keys(data).length === 0) {
    return;
  }

  await tx.dailyMetric.update({
    where: { id: existing.id },
    data,
  });
}

function resolveRefundForLine(sku, refundBySku, totalRefundAmount, revenueShare) {
  if (!totalRefundAmount && !refundBySku?.size) {
    return 0;
  }
  if (refundBySku?.size && sku && refundBySku.has(sku)) {
    return refundBySku.get(sku);
  }
  if (!totalRefundAmount) {
    return 0;
  }
  return totalRefundAmount * revenueShare;
}

function sumOrderCost(costs = [], type) {
  if (!Array.isArray(costs)) {
    return 0;
  }
  return costs.reduce((sum, cost) => {
    if (cost.type !== type) {
      return sum;
    }
    return sum + Number(cost.amount ?? 0);
  }, 0);
}

function summarizeRefundRecords(refunds = []) {
  const amount = refunds.reduce(
    (sum, refund) => sum + Number(refund.amount ?? 0),
    0,
  );
  const lineItems = refunds.flatMap((refund) => refund.lineItems ?? []);
  return {
    amount,
    count: refunds.length,
    bySku: summarizeRefundLineItems(lineItems),
  };
}

const ORDER_CHANNEL_OVERRIDES = [
  { pattern: /(facebook|meta|instagram)/i, channel: "META_ADS" },
  { pattern: /pos/i, channel: "POS" },
];
