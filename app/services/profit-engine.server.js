import pkg from "@prisma/client";
import prisma from "../db.server";
import {
  getActiveSkuCostMap,
  getVariableCostTemplates,
} from "./costs.server";
import { getLogisticsCost } from "./logistics.server";
import { ensureOrderCapacity } from "./plan-limits.server";
import { notifyPlanOverage, processPlanOverageCharge } from "./overages.server";
import { isPlanLimitError } from "../errors/plan-limit-error";
import { getAttributionRules } from "./attribution.server";
import { startOfDay } from "../utils/dates.server.js";

const { CostType, CredentialProvider } = pkg;
const ATTRIBUTION_CHANNELS = [
  CredentialProvider.META_ADS,
  CredentialProvider.GOOGLE_ADS,
  CredentialProvider.BING_ADS,
  CredentialProvider.TIKTOK_ADS,
];

export async function processShopifyOrder({ store, payload }) {
  if (!store?.id) {
    throw new Error("Store is required");
  }

  const storeRecord =
    store.merchantId && store.merchant
      ? store
      : await prisma.store.findUnique({
          where: { id: store.id },
          include: { merchant: true },
        });

  if (!storeRecord) {
    throw new Error("Store record not found");
  }

  const orderDate = new Date(
    payload.processed_at ||
      payload.closed_at ||
      payload.created_at ||
      payload.updated_at ||
      Date.now(),
  );
  const currency = payload.currency || store.currency || "USD";
  const subtotal = toNumber(
    payload.current_subtotal_price ?? payload.subtotal_price ?? 0,
  );
  const shippingLines = payload.shipping_lines ?? [];
  const shippingRevenue = sumArray(shippingLines, (line) => toNumber(line.price));
  const tax = toNumber(payload.current_total_tax ?? payload.total_tax ?? 0);
  const discount = toNumber(
    payload.current_total_discounts ?? payload.total_discounts ?? 0,
  );
  const total = toNumber(payload.current_total_price ?? payload.total_price ?? 0);
  const sourceName = payload.source_name ?? "online";
  const channelKey = resolveOrderChannel(sourceName);
  const customerCountry =
    payload.customer?.default_address?.country_code ?? undefined;
  const paymentGateway = payload.gateway ?? payload.payment_gateway_names?.[0];

  const lineItems = payload.line_items ?? [];
  const skuCostMap = await getActiveSkuCostMap(store.id, orderDate);

  const lineRecords = lineItems.map((line) => {
    const quantity = line.quantity ?? 0;
    const price = toNumber(line.price ?? line.price_set?.shop_money?.amount ?? 0);
    const lineDiscount = toNumber(line.total_discount ?? 0);
    const revenue = price * quantity - lineDiscount;
    const sku = line.sku ?? undefined;
    const unitCost = sku ? skuCostMap.get(sku) ?? 0 : 0;
    const cogs = unitCost * quantity;

    return {
      productId: line.product_id ? String(line.product_id) : null,
      variantId: line.variant_id ? String(line.variant_id) : null,
      sku,
      title: line.title ?? "",
      quantity,
      price,
      discount: lineDiscount,
      revenue,
      cogs,
    };
  });

  const totalUnits = lineRecords.reduce((sum, line) => sum + line.quantity, 0);
  const cogsTotal = lineRecords.reduce((sum, line) => sum + line.cogs, 0);
  const revenue = subtotal - discount + shippingRevenue + tax;

  const templates = await getVariableCostTemplates(store.id);
  const variableCosts = evaluateTemplates(templates, {
    orderTotal: total,
    subtotal,
    shippingRevenue,
    paymentGateway,
    channel: channelKey,
  });

  const shippingAddress =
    payload.shipping_address ?? payload.customer?.default_address ?? null;
  const destinationCountry =
    shippingAddress?.country_code ??
    customerCountry ??
    undefined;
  const destinationRegion =
    shippingAddress?.province_code ??
    shippingAddress?.province ??
    undefined;
  const totalWeightGrams =
    toNumber(payload.total_weight ?? 0) ||
    lineItems.reduce(
      (sum, item) =>
        sum + toNumber(item.grams ?? 0) * (item.quantity ?? 0),
      0,
    );
  const weightKg = totalWeightGrams / 1000;
  const shippingCarrier =
    shippingLines[0]?.carrier_identifier ??
    shippingLines[0]?.carrier ??
    shippingLines[0]?.title ??
    undefined;
  const logisticsCost = await getLogisticsCost({
    storeId: store.id,
    country: destinationCountry,
    region: destinationRegion,
    weightKg,
    provider: shippingCarrier,
    date: orderDate,
    currency,
  });

  const refunds = extractRefunds(payload, currency);

  const costTotals = aggregateCostTotals(variableCosts);
  const shippingTemplateCost = costTotals[CostType.SHIPPING] ?? 0;
  const shippingCost = shippingTemplateCost + logisticsCost;
  const paymentFees = costTotals[CostType.PAYMENT_FEE] ?? 0;
  const platformFees = costTotals[CostType.PLATFORM_FEE] ?? 0;
  const customCosts = costTotals[CostType.CUSTOM] ?? 0;

  const grossProfit = revenue - cogsTotal - shippingCost - paymentFees;
  const netProfit = grossProfit - platformFees - customCosts;

  const orderPayload = {
    storeId: store.id,
    shopifyOrderId: String(payload.id),
    orderNumber: payload.name ?? payload.order_number?.toString(),
    currency,
    presentmentCurrency: payload.presentment_currency ?? currency,
    subtotal,
    shipping: shippingRevenue,
    tax,
    discount,
    total: total || revenue,
    financialStatus: payload.financial_status ?? "paid",
    processedAt: orderDate,
    sourceName,
    customerCountry,
    customerId: payload.customer?.id ? String(payload.customer.id) : null,
    customerEmail: payload.customer?.email?.toLowerCase?.() ?? null,
    customerName: buildCustomerName(payload.customer),
    grossProfit,
    netProfit,
  };

  const pendingOverageRecordIds = [];

  try {
    const transactionResult = await prisma.$transaction(async (tx) => {
      const existingOrder = await tx.order.findUnique({
        where: { shopifyOrderId: orderPayload.shopifyOrderId },
        include: {
          lineItems: true,
          costs: true,
          refunds: true,
        },
      });

      const previousSnapshot = buildSnapshotFromOrder(existingOrder);
      if (previousSnapshot) {
        await updateDailyMetrics(tx, previousSnapshot, {
          direction: -1,
          allowCreate: false,
        });
      }

      const isNewOrder = !existingOrder;
      if (isNewOrder && storeRecord?.merchantId) {
        const capacityResult = await ensureOrderCapacity({
          merchantId: storeRecord.merchantId,
          incomingOrders: 1,
          tx,
          shopDomain: storeRecord.shopDomain,
        });
        if (capacityResult?.overageRecord?.id) {
          pendingOverageRecordIds.push(capacityResult.overageRecord.id);
        }
      }

      const order = await tx.order.upsert({
        where: { shopifyOrderId: orderPayload.shopifyOrderId },
        create: {
          ...orderPayload,
          lineItems: {
            create: lineRecords,
          },
        },
        update: {
          ...orderPayload,
          lineItems: {
            deleteMany: {},
            create: lineRecords,
          },
        },
      });

      await tx.orderCost.deleteMany({ where: { orderId: order.id } });
      await tx.orderCost.createMany({
        data: buildOrderCostRows({
          orderId: order.id,
          currency,
          cogsTotal,
          shippingTemplateCost,
          logisticsCost,
          paymentFees,
          platformFees,
          customCosts,
        }),
      });

      const refundSummary = await syncRefundRecords(tx, {
        storeId: store.id,
        orderId: order.id,
        shopifyOrderId: orderPayload.shopifyOrderId,
        refunds,
        currency,
      });

      await updateDailyMetrics(tx, {
        storeId: store.id,
        date: orderDate,
        currency,
        orderCount: 1,
        units: totalUnits,
        revenue,
        cogs: cogsTotal,
        shippingCost,
        paymentFees,
        platformFees,
        customCosts,
        netProfit,
        grossProfit,
        lineRecords,
        refundAmount: refundSummary.amount,
        refundCount: refundSummary.count,
        refundBySku: refundSummary.bySku,
        channel: channelKey,
      });

      await allocateAdSpendAttributions(tx, {
        storeId: store.id,
        merchantId: storeRecord.merchantId,
        orderId: order.id,
        date: orderDate,
        revenue,
        currency,
      });

      return {
        revenue,
        grossProfit,
        netProfit,
        cogsTotal,
        variableCosts,
        refunds,
      };
    });
    for (const overageId of pendingOverageRecordIds) {
      try {
        await processPlanOverageCharge(overageId);
      } catch (billingError) {
        console.error(
          `Failed to process overage usage record ${overageId}:`,
          billingError,
        );
      }
    }
    return transactionResult;
  } catch (error) {
    if (
      isPlanLimitError(error) &&
      storeRecord?.merchantId &&
      error.detail?.limit !== undefined
    ) {
      await notifyPlanOverage({
        merchantId: storeRecord.merchantId,
        limit: error.detail.limit,
        usage: error.detail.usage ?? 0,
      });
    }
    throw error;
  }
}

export function buildDemoOrder() {
  const now = new Date();
  return {
    id: `demo-${now.getTime()}`,
    name: `#PD${now.getUTCDate()}${now.getUTCMonth() + 1}`,
    currency: "USD",
    current_subtotal_price: "420.00",
    current_total_price: "468.50",
    current_total_tax: "28.50",
    current_total_discounts: "15.00",
    financial_status: "paid",
    processed_at: now.toISOString(),
    source_name: "online",
    gateway: "shopify_payments",
    line_items: [
      {
        product_id: 1,
        variant_id: 11,
        sku: "HD-0001",
        title: "Aurora Hoodie",
        quantity: 2,
        price: "120.00",
        total_discount: "10.00",
      },
      {
        product_id: 2,
        variant_id: 21,
        sku: "TR-441",
        title: "Trail Shoes",
        quantity: 1,
        price: "195.00",
        total_discount: "5.00",
      },
    ],
    shipping_lines: [
      {
        title: "UPS Ground",
        price: "35.00",
      },
    ],
    customer: {
      default_address: {
        country_code: "US",
      },
    },
  };
}

function evaluateTemplates(templates, context) {
  return templates
    .map((template) => {
      if (!template.lines?.length) {
        return null;
      }
      if (template.config?.gateway) {
        if (
          !context.paymentGateway ||
          template.config.gateway !== context.paymentGateway
        ) {
          return null;
        }
      }
      if (template.config?.channel) {
        if (template.config.channel !== context.channel) {
          return null;
        }
      }
      const amount = template.lines.reduce((sum, line) => {
        const baseAmount = resolveBaseAmount(line.appliesTo, template, context);
        const pct = line.percentageRate ? Number(line.percentageRate) : 0;
        const flat = line.flatAmount ? Number(line.flatAmount) : 0;
        return sum + baseAmount * pct + flat;
      }, 0);

      if (amount <= 0) {
        return null;
      }

    return {
      type: template.type,
      templateName: template.name,
      amount,
    };
    })
    .filter(Boolean);
}

function aggregateCostTotals(variableCosts) {
  return variableCosts.reduce((acc, cost) => {
    acc[cost.type] = (acc[cost.type] ?? 0) + cost.amount;
    return acc;
  }, {});
}

function buildOrderCostRows({
  orderId,
  currency,
  cogsTotal,
  shippingTemplateCost,
  logisticsCost,
  paymentFees,
  platformFees,
  customCosts,
}) {
  const rows = [];
  if (cogsTotal > 0) {
    rows.push({
      orderId,
      type: CostType.COGS,
      amount: cogsTotal,
      currency,
      source: "SKU cost",
    });
  }
  if (shippingTemplateCost > 0) {
    rows.push({
      orderId,
      type: CostType.SHIPPING,
      amount: shippingTemplateCost,
      currency,
      source: "Template",
    });
  }
  if (logisticsCost > 0) {
    rows.push({
      orderId,
      type: CostType.SHIPPING,
      amount: logisticsCost,
      currency,
      source: "Logistics rule",
    });
  }
  if (paymentFees > 0) {
    rows.push({
      orderId,
      type: CostType.PAYMENT_FEE,
      amount: paymentFees,
      currency,
      source: "Payment gateway",
    });
  }
  if (platformFees > 0) {
    rows.push({
      orderId,
      type: CostType.PLATFORM_FEE,
      amount: platformFees,
      currency,
    });
  }
  if (customCosts > 0) {
    rows.push({
      orderId,
      type: CostType.CUSTOM,
      amount: customCosts,
      currency,
    });
  }
  return rows;
}

async function updateDailyMetrics(tx, payload, options = {}) {
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

function buildSnapshotFromOrder(order) {
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

function resolveBaseAmount(appliesTo, template, context) {
  const target = appliesTo ?? template.config?.appliesTo ?? "ORDER_TOTAL";
  switch (target) {
    case "SUBTOTAL":
      return context.subtotal ?? 0;
    case "SHIPPING_REVENUE":
      return context.shippingRevenue ?? 0;
    case "ORDER_TOTAL":
    default:
      return context.orderTotal ?? context.subtotal ?? 0;
  }
}

function sumArray(arr = [], selector = (item) => item) {
  return arr.reduce((sum, item) => sum + toNumber(selector(item)), 0);
}

function toNumber(value) {
  if (!value && value !== 0) return 0;
  const num = typeof value === "string" ? parseFloat(value) : Number(value);
  return Number.isFinite(num) ? num : 0;
}


function extractRefunds(payload, fallbackCurrency = "USD") {
  const refunds = payload.refunds ?? [];
  return refunds
    .map((refund) => {
      if (!refund?.id) return null;
      const transactions = refund.transactions ?? [];
      const transactionTotal = transactions.reduce((sum, txn) => {
        const amount = toNumber(txn.amount);
        // Shopify sends negative amounts for refunds; convert to positive.
        return sum + Math.abs(amount);
      }, 0);

      const amount = transactionTotal || toNumber(refund.total_set?.shop_money?.amount);
      if (!amount) {
        return null;
      }

      return {
        id: String(refund.id),
        processedAt: refund.processed_at
          ? new Date(refund.processed_at)
          : new Date(payload.processed_at || Date.now()),
        amount,
        currency:
          refund.currency || transactions[0]?.currency || fallbackCurrency,
        reason: refund.note || refund.reason || null,
        restock: Boolean(refund.restock),
        lineItems: refund.refund_line_items ?? [],
        transactions,
      };
    })
    .filter(Boolean);
}

async function syncRefundRecords(tx, {
  storeId,
  orderId,
  shopifyOrderId,
  refunds,
  currency,
}) {
  if (!refunds.length) {
    await tx.refundRecord.deleteMany({ where: { orderShopifyId: shopifyOrderId } });
    return { amount: 0, count: 0, bySku: new Map() };
  }

  const refundIds = refunds.map((refund) => refund.id);
  await tx.refundRecord.deleteMany({
    where: {
      orderShopifyId: shopifyOrderId,
      shopifyRefundId: { notIn: refundIds },
    },
  });

  let totalAmount = 0;
  const refundBySku = new Map();

  for (const refund of refunds) {
    totalAmount += refund.amount;
    const skuMap = summarizeRefundLineItems(refund.lineItems);
    for (const [sku, value] of skuMap.entries()) {
      refundBySku.set(sku, (refundBySku.get(sku) ?? 0) + value);
    }

    await tx.refundRecord.upsert({
      where: { shopifyRefundId: refund.id },
      create: {
        storeId,
        orderId,
        orderShopifyId: shopifyOrderId,
        shopifyRefundId: refund.id,
        processedAt: refund.processedAt,
        currency: refund.currency || currency,
        amount: refund.amount,
        reason: refund.reason,
        restock: refund.restock,
        lineItems: refund.lineItems ?? null,
        transactions: refund.transactions ?? null,
      },
      update: {
        processedAt: refund.processedAt,
        currency: refund.currency || currency,
        amount: refund.amount,
        reason: refund.reason,
        restock: refund.restock,
        lineItems: refund.lineItems ?? null,
        transactions: refund.transactions ?? null,
        orderId,
      },
    });
  }

  return {
    amount: totalAmount,
    count: refunds.length,
    bySku: refundBySku,
  };
}

function summarizeRefundLineItems(lineItems = []) {
  const map = new Map();
  for (const entry of lineItems) {
    const sku = entry?.line_item?.sku ?? entry?.line_item?.variant_id ?? null;
    if (!sku) continue;
    const amount = toNumber(
      entry.subtotal_set?.shop_money?.amount ??
        entry.total_set?.shop_money?.amount ??
        entry.subtotal ??
        entry.amount ??
        0,
    );
    if (amount <= 0) continue;
    map.set(sku, (map.get(sku) ?? 0) + amount);
  }
  return map;
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

const ORDER_CHANNEL_OVERRIDES = [
  { pattern: /(facebook|meta|instagram)/i, channel: "META_ADS" },
  { pattern: /(google|adwords|youtube)/i, channel: "GOOGLE_ADS" },
  { pattern: /pos/i, channel: "POS" },
];

async function upsertChannelMetric(tx, payload, channel, delta) {
  if (!channel || channel === "TOTAL" || channel === "PRODUCT") return;
  const metricDate = startOfDay(payload.date);
  await tx.dailyMetric.upsert({
    where: {
      storeId_channel_productSku_date: {
        storeId: payload.storeId,
        channel,
        productSku: null,
        date: metricDate,
      },
    },
    create: {
      storeId: payload.storeId,
      channel,
      productSku: null,
      date: metricDate,
      currency: payload.currency,
      orders: delta.orders,
      units: delta.units,
      revenue: delta.revenue,
      adSpend: 0,
      cogs: delta.cogs,
      shippingCost: delta.shippingCost,
      paymentFees: delta.paymentFees,
      refundAmount: delta.refundAmount,
      refunds: delta.refunds,
      grossProfit: delta.grossProfit,
      netProfit: delta.netProfit,
    },
    update: {
      orders: { increment: delta.orders },
      units: { increment: delta.units },
      revenue: { increment: delta.revenue },
      cogs: { increment: delta.cogs },
      shippingCost: { increment: delta.shippingCost },
      paymentFees: { increment: delta.paymentFees },
      refundAmount: { increment: delta.refundAmount },
      refunds: { increment: delta.refunds },
      grossProfit: { increment: delta.grossProfit },
      netProfit: { increment: delta.netProfit },
    },
  });
}

function resolveOrderChannel(sourceName) {
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

function buildCustomerName(customer) {
  if (!customer) return null;
  const first = customer.first_name ?? customer.firstName;
  const last = customer.last_name ?? customer.lastName;
  const combined = [first, last].filter(Boolean).join(" ").trim();
  if (combined) {
    return combined;
  }
  return (
    customer.default_address?.name ??
    customer.display_name ??
    customer.email ??
    null
  );
}

async function allocateAdSpendAttributions(tx, payload) {
  const { storeId, merchantId, orderId, date, revenue, currency } = payload;
  if (!merchantId || !orderId || !date || !revenue) {
    return;
  }
  const metricDate = startOfDay(date);
  const totalRow = await tx.dailyMetric.findUnique({
    where: {
      storeId_channel_productSku_date: {
        storeId,
        channel: "TOTAL",
        productSku: null,
        date: metricDate,
      },
    },
  });
  const totalAdSpend = Number(totalRow?.adSpend || 0);
  if (!totalRow || totalAdSpend <= 0) {
    return;
  }

  const totalRevenue = Number(totalRow.revenue || 0);
  if (!totalRevenue) return;
  const orderShare = Number(revenue) / totalRevenue;
  if (orderShare <= 0) return;

  const providerRows = await tx.dailyMetric.findMany({
    where: {
      storeId,
      date: metricDate,
      productSku: null,
      channel: { in: ATTRIBUTION_CHANNELS },
    },
  });

  if (!providerRows.length) return;

  const rules = await getAttributionRules(merchantId);
  const ruleTouchMap = new Map((rules ?? []).map((rule) => [rule.provider, rule.touches ?? []]));

  const attributions = providerRows
    .map((row) => {
      const provider = row.channel;
      const providerSpend = Number(row.adSpend || 0);
      if (!providerSpend) return null;
      const baseProportion = totalAdSpend ? providerSpend / totalAdSpend : 0;
      const touches = ruleTouchMap.get(provider) ?? [];
      const totalTouchWeight =
        touches.reduce((sum, touch) => sum + (Number(touch.weight ?? 0)), 0) || 1;
      return touches
        .map((touch) => {
          const normalized = Number(touch.weight ?? 0) / totalTouchWeight;
          if (normalized <= 0) return null;
          const amount = totalAdSpend * baseProportion * orderShare * normalized;
          if (!amount) return null;
          return {
            provider,
            amount,
            ruleType: touch.ruleType ?? "LAST_TOUCH",
          };
        })
        .filter(Boolean);
    })
    .flat();

  if (!attributions.length) return;

  await tx.orderAttribution.deleteMany({ where: { orderId } });
  await tx.orderAttribution.createMany({
    data: attributions.map((entry) => ({
      orderId,
      provider: entry.provider,
      attributionModel: entry.ruleType,
      amount: entry.amount,
      currency,
    })),
  });
}
