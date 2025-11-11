import pkg from "@prisma/client";
import prisma from "../db.server";
import {
  getActiveSkuCostMap,
  getVariableCostTemplates,
} from "./costs.server";
import { ensureOrderCapacity } from "./plan-limits.server";
import { startOfDay } from "../utils/dates.server.js";

const { CostType } = pkg;

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

  await ensureOrderCapacity({
    merchantId: storeRecord.merchantId,
    incomingOrders: 1,
  });

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
  const shippingRevenue = sumArray(payload.shipping_lines, (line) =>
    toNumber(line.price),
  );
  const tax = toNumber(payload.current_total_tax ?? payload.total_tax ?? 0);
  const discount = toNumber(
    payload.current_total_discounts ?? payload.total_discounts ?? 0,
  );
  const total = toNumber(payload.current_total_price ?? payload.total_price ?? 0);
  const sourceName = payload.source_name ?? "online";
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
    channel: sourceName,
  });

  const refunds = extractRefunds(payload, currency);

  const costTotals = aggregateCostTotals(variableCosts);
  const shippingCost = costTotals[CostType.SHIPPING] ?? 0;
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
  };

  await prisma.$transaction(async (tx) => {
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
        shippingCost,
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
    });
  });

  return {
    revenue,
    grossProfit,
    netProfit,
    cogsTotal,
    variableCosts,
    refunds,
  };
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
  shippingCost,
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
  if (shippingCost > 0) {
    rows.push({
      orderId,
      type: CostType.SHIPPING,
      amount: shippingCost,
      currency,
      source: "Template",
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

async function updateDailyMetrics(tx, payload) {
  const metricDate = startOfDay(payload.date);
  const delta = {
    orders: payload.orderCount,
    units: payload.units,
    revenue: payload.revenue,
    cogs: payload.cogs,
    shippingCost: payload.shippingCost,
    paymentFees: payload.paymentFees,
    grossProfit: payload.grossProfit,
    netProfit: payload.netProfit,
    refundAmount: payload.refundAmount ?? 0,
    refunds: payload.refundCount ?? 0,
  };

  await tx.dailyMetric.upsert({
    where: {
      storeId_channel_productSku_date: {
        storeId: payload.storeId,
        channel: "TOTAL",
        productSku: null,
        date: metricDate,
      },
    },
    create: {
      storeId: payload.storeId,
      channel: "TOTAL",
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

  for (const line of payload.lineRecords) {
    if (!line.sku) continue;
    const revenueShare =
      payload.revenue > 0 ? line.revenue / payload.revenue : 0;
    const refundAllocation = resolveRefundForLine(
      line.sku,
      payload.refundBySku,
      payload.refundAmount,
      revenueShare,
    );
    await tx.dailyMetric.upsert({
      where: {
        storeId_channel_productSku_date: {
          storeId: payload.storeId,
          channel: "PRODUCT",
          productSku: line.sku,
          date: metricDate,
        },
      },
      create: {
        storeId: payload.storeId,
        channel: "PRODUCT",
        productSku: line.sku,
        date: metricDate,
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
          line.revenue - line.cogs - payload.shippingCost * revenueShare - payload.paymentFees * revenueShare,
      },
      update: {
        orders: { increment: 1 },
        units: { increment: line.quantity },
        revenue: { increment: line.revenue },
        cogs: { increment: line.cogs },
        shippingCost: {
          increment:
            payload.shippingCost * revenueShare,
        },
        paymentFees: {
          increment: payload.paymentFees * revenueShare,
        },
        refundAmount: {
          increment: refundAllocation,
        },
        refunds: {
          increment: refundAllocation > 0 ? 1 : 0,
        },
        grossProfit: {
          increment: line.revenue - line.cogs,
        },
        netProfit: {
          increment:
            line.revenue -
            line.cogs -
            payload.shippingCost * revenueShare -
            payload.paymentFees * revenueShare,
        },
      },
    });
  }
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
