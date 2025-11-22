import defaultPrisma from "../db.server.js";
import {
  resolveTimezone,
  startOfDay,
  shiftDays,
} from "../utils/dates.server.js";

const DEFAULT_RANGE_DAYS = 14;

const defaultDependencies = {
  prismaClient: defaultPrisma,
};

let reportServiceDependencies = { ...defaultDependencies };

export function setReportServiceDependenciesForTests(overrides = {}) {
  reportServiceDependencies = { ...reportServiceDependencies, ...overrides };
}

export function resetReportServiceDependenciesForTests() {
  reportServiceDependencies = { ...defaultDependencies };
}

export async function getCustomReportData({
  storeId,
  metrics = [],
  formula,
  formulaLabel,
  rangeDays = DEFAULT_RANGE_DAYS,
}) {
  if (!storeId) {
    throw new Error("storeId is required for custom reports");
  }

  const { prismaClient, getExchangeRate } = reportServiceDependencies;
  const store =
    (await prismaClient.store?.findUnique?.({ where: { id: storeId } })) ?? null;
  const currency = store?.currency ?? store?.merchant?.primaryCurrency ?? "USD";

  const since = shiftDays(startOfDay(new Date()), -(Math.max(rangeDays, 1) - 1));

  const grouped = await prismaClient.dailyMetric.groupBy({
    by: ["channel"],
    where: { storeId, date: { gte: since } },
    _sum: {
      revenue: true,
      netProfit: true,
      adSpend: true,
      cogs: true,
      shippingCost: true,
      paymentFees: true,
      refundAmount: true,
      orders: true,
    },
  });

  const metricDefs = metrics.map((key) => ({ label: key }));
  if (formula && formulaLabel) {
    metricDefs.push({ label: formulaLabel });
  }

  const rows = grouped.map((group) => {
    const context = {
      currency,
      ...(group._sum ?? {}),
    };
    const metricValues = metrics.map((key) => ({
      label: key,
      value: Number(group._sum?.[key] ?? 0),
    }));
    if (formula && formulaLabel) {
      const value = evaluateFormula(formula, context);
      metricValues.push({ label: formulaLabel, value });
    }
    return {
      channel: group.channel ?? "TOTAL",
      metrics: metricValues,
    };
  });

  return {
    metrics: metricDefs,
    rows,
    currency,
    exchangeRateProvider: getExchangeRate ? "custom" : "none",
  };
}

export async function getReportingOverview({ storeId, rangeDays = DEFAULT_RANGE_DAYS }) {
  if (!storeId) {
    throw new Error("storeId is required for reporting overview");
  }

  const { prismaClient, getFixedCostBreakdown, buildCacheKey, memoizeAsync } =
    reportServiceDependencies;

  const cacheKeyBuilder =
    buildCacheKey ?? ((...parts) => parts.filter(Boolean).join("|"));
  const cacheKey = cacheKeyBuilder("reporting-overview", storeId, rangeDays);

  const compute = async () => {
    const store =
      (await prismaClient.store?.findUnique?.({ where: { id: storeId } })) ?? null;
    const timezone = resolveTimezone({ store });
    const since = shiftDays(
      startOfDay(new Date(), { timezone }),
      -(Math.max(rangeDays, 1) - 1),
      { timezone },
    );

    const aggregates = await prismaClient.dailyMetric.aggregate({
      _sum: {
        revenue: true,
        netProfit: true,
        adSpend: true,
        orders: true,
        refundAmount: true,
        refunds: true,
        cogs: true,
        shippingCost: true,
        paymentFees: true,
      },
      where: { storeId, date: { gte: since } },
    });

    const channelGroups = await prismaClient.dailyMetric.groupBy({
      by: ["channel"],
      where: { storeId, date: { gte: since } },
      _sum: {
        revenue: true,
        netProfit: true,
        adSpend: true,
        orders: true,
        refundAmount: true,
        refunds: true,
      },
    });

    const fixedCosts =
      (await getFixedCostBreakdown?.({ storeId, rangeDays })) ?? {
        total: 0,
        allocations: { perChannel: {}, unassigned: 0 },
        items: [],
      };

    const summaryNetProfit = Number(aggregates._sum?.netProfit ?? 0);
    const summary = {
      revenue: Number(aggregates._sum?.revenue ?? 0),
      netProfit: summaryNetProfit,
      adSpend: Number(aggregates._sum?.adSpend ?? 0),
      orders: Number(aggregates._sum?.orders ?? 0),
      refunds: Number(aggregates._sum?.refunds ?? 0),
      refundAmount: Number(aggregates._sum?.refundAmount ?? 0),
      fixedCosts: Number(fixedCosts.total ?? 0),
      netProfitAfterFixed: summaryNetProfit - Number(fixedCosts.total ?? 0),
    };

    const channels = channelGroups.map((group) => {
      const channel = group.channel ?? "TOTAL";
      const fixed = Number(fixedCosts.allocations?.perChannel?.[channel] ?? 0);
      const netProfit = Number(group._sum?.netProfit ?? 0);
      return {
        channel,
        revenue: Number(group._sum?.revenue ?? 0),
        netProfit,
        adSpend: Number(group._sum?.adSpend ?? 0),
        orders: Number(group._sum?.orders ?? 0),
        refunds: Number(group._sum?.refunds ?? 0),
        refundAmount: Number(group._sum?.refundAmount ?? 0),
        netProfitAfterFixed: netProfit - fixed,
      };
    });

    return {
      summary,
      channels,
      fixedCosts,
      products: [],
    };
  };

  if (typeof memoizeAsync === "function") {
    return memoizeAsync(cacheKey, 5 * 60 * 1000, compute);
  }

  return compute();
}

export async function getOrderProfitTable({
  store,
  rangeStart,
  rangeEnd,
  includeRefunds = true,
  limit = 200,
}) {
  const { prismaClient } = reportServiceDependencies;
  const prisma = prismaClient;
  if (!store?.id) {
    throw new Error("Store is required to load order profit table");
  }
  const { start, end } = resolveRange({ store, rangeStart, rangeEnd });

  const whereClause = {
    storeId: store.id,
    processedAt: { gte: start, lte: end },
  };
  if (!includeRefunds) {
    whereClause.refunds = { none: {} };
  }

  const orders = await prisma.order.findMany({
    where: whereClause,
    orderBy: { processedAt: "desc" },
    take: limit,
    include: {
      store: { select: { shopDomain: true } },
      lineItems: { select: { cogs: true } },
      costs: true,
      attributions: true,
    },
  });

  return orders.map((order) => {
    const revenue =
      Number(order.subtotal || 0) -
      Number(order.discount || 0) +
      Number(order.shipping || 0) +
      Number(order.tax || 0);
    const cogs = order.lineItems.reduce(
      (sum, line) => sum + Number(line.cogs || 0),
      0,
    );
    const paymentFees = sumCosts(order.costs, "PAYMENT_FEE");
    const shippingCost = sumCosts(order.costs, "SHIPPING");
    const platformFees = sumCosts(order.costs, "PLATFORM_FEE");
    const adSpend = order.attributions.reduce(
      (sum, attr) => sum + Number(attr.amount || 0),
      0,
    );
    const netProfit =
      revenue - (cogs + paymentFees + platformFees + shippingCost + adSpend);
    const margin = revenue > 0 ? netProfit / revenue : 0;

    return {
      id: order.id,
      shopifyOrderId: order.shopifyOrderId,
      orderNumber: order.orderNumber,
      processedAt: order.processedAt,
      storeDomain: order.store?.shopDomain ?? store.shopDomain,
      currency: order.currency ?? store.currency ?? "USD",
      revenue,
      cogs,
      paymentFees,
      platformFees,
      shippingCost,
      adSpend,
      netProfit,
      margin,
      financialStatus: order.financialStatus,
    };
  });
}

export async function getProductProfitTable({
  store,
  rangeStart,
  rangeEnd,
  sortBy = "netProfit",
}) {
  const { prismaClient } = reportServiceDependencies;
  const prisma = prismaClient;
  if (!store?.id) {
    throw new Error("Store is required to load product profit table");
  }
  const { start, end } = resolveRange({ store, rangeStart, rangeEnd });

  const rows = await prisma.orderLineItem.groupBy({
    by: ["sku", "title"],
    where: {
      order: {
        storeId: store.id,
        processedAt: { gte: start, lte: end },
      },
    },
    _sum: {
      revenue: true,
      cogs: true,
      quantity: true,
    },
  });

  const entries = rows.map((row) => {
    const revenue = Number(row._sum.revenue || 0);
    const cogs = Number(row._sum.cogs || 0);
    const netProfit = revenue - cogs;
    const margin = revenue > 0 ? netProfit / revenue : 0;
    const units = Number(row._sum.quantity || 0);
    const hasMissingCost = revenue > 0 && cogs <= 0 && units > 0;
    return {
      sku: row.sku ?? "Unknown SKU",
      title: row.title ?? row.sku ?? "Unknown SKU",
      units,
      revenue,
      cogs,
      netProfit,
      margin,
      hasMissingCost,
    };
  });

  const sorter = buildProductSorter(sortBy);
  const hasMissingCost = entries.some((entry) => entry.hasMissingCost);
  const sorted = entries.sort(sorter).slice(0, 100);
  return {
    rows: sorted,
    hasMissingCost,
  };
}

function resolveRange({ store, rangeStart, rangeEnd }) {
  const timezone = resolveTimezone({ store });
  const today = startOfDay(new Date(), { timezone });
  const end = rangeEnd ? startOfDay(rangeEnd, { timezone }) : today;
  const start = rangeStart
    ? startOfDay(rangeStart, { timezone })
    : shiftDays(end, -(DEFAULT_RANGE_DAYS - 1), { timezone });
  return { start, end };
}

function sumCosts(costs, type) {
  return costs
    .filter((cost) => cost.type === type)
    .reduce((sum, cost) => sum + Number(cost.amount || 0), 0);
}

function buildProductSorter(sortBy) {
  switch (sortBy) {
    case "revenue":
      return (a, b) => b.revenue - a.revenue;
    case "margin":
      return (a, b) => b.margin - a.margin;
    case "netProfit":
    default:
      return (a, b) => b.netProfit - a.netProfit;
  }
}

function evaluateFormula(formula, context = {}) {
  try {
    const evaluator = new Function(
      "ctx",
      `with (ctx) { return ${formula}; }`,
    );
    const value = evaluator(context);
    return Number.isFinite(value) ? Number(value) : null;
  } catch (error) {
    // keep test-friendly fallback
    return null;
  }
}
