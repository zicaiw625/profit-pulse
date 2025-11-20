import pkg from "@prisma/client";
import defaultPrisma from "../db.server.js";
import {
  getActiveSkuCostMap,
  getVariableCostTemplates,
} from "./costs.server.js";
import { ensureOrderCapacity } from "./plan-limits.server.js";
import { isPlanLimitError } from "../errors/plan-limit-error.js";
import { getAttributionRules as defaultGetAttributionRules } from "./attribution.server.js";
import { startOfDay } from "../utils/dates.server.js";
import { createScopedLogger } from "../utils/logger.server.js";
import { recordOrderProcessing } from "./metrics.server.js";
import { parseShopifyOrder } from "./profit-engine/parse-shopify-order.js";
import { calcVariableCosts } from "./profit-engine/calc-variable-costs.js";
import {
  updateDailyMetrics,
  buildSnapshotFromOrder,
} from "./profit-engine/update-daily-metrics.js";
import { extractRefunds, syncRefundRecords } from "./profit-engine/refunds.js";

const { CostType, CredentialProvider } = pkg;
const ATTRIBUTION_CHANNELS = [CredentialProvider.META_ADS];

const profitEngineLogger = createScopedLogger({ service: "profit-engine" });

const defaultDependencies = {
  prismaClient: defaultPrisma,
  getActiveSkuCostMap,
  getVariableCostTemplates,
  ensureOrderCapacity,
  getAttributionRules: defaultGetAttributionRules,
  recordOrderProcessing,
};

let profitEngineDependencies = { ...defaultDependencies };

export function setProfitEngineDependenciesForTests(overrides = {}) {
  profitEngineDependencies = { ...profitEngineDependencies, ...overrides };
}

export function resetProfitEngineDependenciesForTests() {
  profitEngineDependencies = { ...defaultDependencies };
}

export async function processShopifyOrder({ store, payload }) {
  const {
    prismaClient,
    getActiveSkuCostMap: getActiveSkuCostMapImpl,
    getVariableCostTemplates: getVariableCostTemplatesImpl,
    ensureOrderCapacity: ensureOrderCapacityImpl,
    getAttributionRules: getAttributionRulesImpl,
    recordOrderProcessing: recordOrderProcessingImpl,
  } = profitEngineDependencies;

  const startedAt = Date.now();
  const storeId = store?.id;
  const initialMerchantId = store?.merchantId;
  const shopifyOrderId = payload?.id ? String(payload.id) : undefined;

  const effectiveShopifyOrderId = shopifyOrderId ?? String(payload.id);
  let channelKey = "ONLINE_STORE";
  let storeRecord;

  try {
    if (!storeId) {
      throw new Error("Store is required");
    }

    storeRecord =
      store.merchantId && store.merchant
        ? store
        : await prismaClient.store.findUnique({
            where: { id: storeId },
            include: { merchant: true },
          });

    if (!storeRecord) {
      throw new Error("Store record not found");
    }

    const parsedOrder = await parseShopifyOrder({
      store,
      payload,
      getActiveSkuCostMap: getActiveSkuCostMapImpl,
    });
    const {
      orderDate,
      currency,
      subtotal,
      shippingRevenue,
      tax,
      discount,
      total,
      customerCountry,
      paymentGateway,
      lineRecords,
      totalUnits,
      cogsTotal,
      revenue,
      sourceName,
      missingSkuCostCount,
    } = parsedOrder;
    channelKey = parsedOrder.channelKey;

    const templates = await getVariableCostTemplatesImpl(store.id);
    const {
      variableCosts,
      shippingCost,
      paymentFees,
      platformFees,
      customCosts,
    } = calcVariableCosts(templates, {
      orderTotal: total,
      subtotal,
      shippingRevenue,
      paymentGateway,
      channel: channelKey,
    });

    const refunds = extractRefunds(payload, currency);

    const grossProfit = revenue - cogsTotal - shippingCost - paymentFees;
    const netProfit = grossProfit - platformFees - customCosts;

    const orderPayload = {
      storeId: store.id,
      shopifyOrderId: effectiveShopifyOrderId,
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

    const transactionResult = await prismaClient.$transaction(async (tx) => {
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
        await ensureOrderCapacityImpl({
          merchantId: storeRecord.merchantId,
          incomingOrders: 1,
          tx,
          shopDomain: storeRecord.shopDomain,
        });
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
        channel: channelKey,
      });

      await allocateAdSpendAttributions(
        tx,
        {
          storeId: store.id,
          merchantId: storeRecord.merchantId,
          orderId: order.id,
          date: orderDate,
          revenue,
          currency,
        },
        getAttributionRulesImpl,
      );

      return {
        revenue,
        grossProfit,
        netProfit,
        cogsTotal,
        variableCosts,
        refunds,
      };
    });
    recordOrderProcessingImpl({
      storeId: store.id,
      merchantId: storeRecord.merchantId,
      shopifyOrderId: effectiveShopifyOrderId,
      status: "success",
      durationMs: Date.now() - startedAt,
      channel: channelKey,
      totals: {
        revenue: transactionResult.revenue,
        grossProfit: transactionResult.grossProfit,
        netProfit: transactionResult.netProfit,
        missingSkuCostCount,
        refundCount: Array.isArray(transactionResult.refunds)
          ? transactionResult.refunds.length
          : undefined,
      },
    });

    return transactionResult;
  } catch (error) {
    const merchantId = storeRecord?.merchantId ?? initialMerchantId;
    if (
      isPlanLimitError(error) &&
      merchantId &&
      error.detail?.limit !== undefined
    ) {
      profitEngineLogger.warn("order_plan_limit_reached", {
        merchantId,
        storeId,
        limit: error.detail.limit,
        usage: error.detail.usage ?? 0,
      });
    }

    recordOrderProcessingImpl({
      storeId,
      merchantId,
      shopifyOrderId: effectiveShopifyOrderId,
      status: "failure",
      durationMs: Date.now() - startedAt,
      channel: channelKey,
      error,
    });

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

async function allocateAdSpendAttributions(
  tx,
  payload,
  getAttributionRulesImpl = defaultGetAttributionRules,
) {
  const { storeId, merchantId, orderId, date, revenue, currency } = payload;
  if (!merchantId || !orderId || !date || !revenue) {
    return;
  }
  const metricDate = startOfDay(date);
  const totalRow = await tx.dailyMetric.findFirst({
    where: {
      storeId,
      channel: "TOTAL",
      productSku: null,
      date: metricDate,
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

  const rules = await getAttributionRulesImpl(merchantId);
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
