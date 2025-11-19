import prisma from "../db.server";
import { getPlanUsage } from "./plan-limits.server";
import { getExchangeRate } from "./exchange-rates.server";
import { buildCacheKey, memoizeAsync } from "./cache.server";
import {
  formatDateKey,
  resolveTimezone,
  shiftDays,
  startOfDay,
} from "../utils/dates.server.js";

const DEFAULT_RANGE_DAYS = 14;
const CACHE_TTL_MS = 15 * 1000;

export async function getDashboardOverview({
  store,
  rangeDays = DEFAULT_RANGE_DAYS,
  rangeStart,
  rangeEnd,
}) {
  if (!store?.id) {
    throw new Error("Store record is required to load dashboard overview");
  }

  const timezone = resolveTimezone({ store });
  const today = startOfDay(new Date(), { timezone });
  const computedEnd = rangeEnd ? startOfDay(rangeEnd, { timezone }) : today;
  let computedStart = rangeStart
    ? startOfDay(rangeStart, { timezone })
    : shiftDays(computedEnd, -(rangeDays - 1), { timezone });
  if (computedStart > computedEnd) {
    const tmp = computedStart;
    computedStart = computedEnd;
    rangeEnd = tmp;
  }
  const normalizedDays = Math.max(
    1,
    Math.round((computedEnd - computedStart) / (1000 * 60 * 60 * 24)) + 1,
  );

  const cacheKey = buildCacheKey(
    "dashboard.v1",
    store.id,
    `${timezone}|${computedStart.toISOString()}|${computedEnd.toISOString()}`,
  );

  return memoizeAsync(cacheKey, CACHE_TTL_MS, () =>
    buildDashboardOverview({
      store,
      timezone,
      range: { start: computedStart, end: computedEnd },
      rangeDays: normalizedDays,
    }),
  );
}

async function buildDashboardOverview({ store, timezone, range, rangeDays }) {
  const previousStart = shiftDays(range.start, -rangeDays, { timezone });
  const previousEnd = shiftDays(range.start, -1, { timezone });

  const [currentMetrics, previousMetrics, storeRecord] = await Promise.all([
    prisma.dailyMetric.findMany({
      where: { storeId: store.id, date: { gte: range.start, lte: range.end } },
      orderBy: { date: "asc" },
    }),
    prisma.dailyMetric.findMany({
      where: { storeId: store.id, date: { gte: previousStart, lte: previousEnd } },
    }),
    prisma.store.findUnique({
      where: { id: store.id },
      include: { merchant: true },
    }),
  ]);

  const storeCurrency = storeRecord?.currency ?? "USD";
  const masterCurrency = storeRecord?.merchant?.primaryCurrency ?? storeCurrency;
  const conversionRate = await getExchangeRate({
    base: storeCurrency,
    quote: masterCurrency,
  });
  const planUsage =
    storeRecord?.merchantId != null
      ? await getPlanUsage({ merchantId: storeRecord.merchantId })
      : null;

  const [missingCostOrders, totalOrdersInRange, totalOrdersAllTime] =
    await Promise.all([
      prisma.order.count({
        where: {
          storeId: store.id,
          processedAt: { gte: range.start, lte: range.end },
          lineItems: {
            some: {
              OR: [{ cogs: null }, { cogs: 0 }],
            },
          },
        },
      }),
      prisma.order.count({
        where: {
          storeId: store.id,
          processedAt: { gte: range.start, lte: range.end },
        },
      }),
      prisma.order.count({
        where: { storeId: store.id },
      }),
    ]);

  const summaryCards = buildSummaryCards({
    current: currentMetrics,
    previous: previousMetrics,
    conversionRate,
  });

  const topProducts = await loadTopProducts({
    storeId: store.id,
    range,
    conversionRate,
    currency: masterCurrency,
  });

  return {
    shopDomain: storeRecord?.shopDomain ?? store.shopDomain,
    rangeLabel: `${range.start.toISOString().slice(0, 10)} – ${range.end
      .toISOString()
      .slice(0, 10)}`,
    summaryCards,
    timeseries: buildTimeSeries({
      metrics: currentMetrics,
      rangeStart: range.start,
      rangeDays,
      conversionRate,
      timezone,
    }),
    costBreakdown: buildCostBreakdown({
      metrics: currentMetrics,
      conversionRate,
    }),
    topProducts,
    currency: masterCurrency,
    planStatus: buildPlanStatus(planUsage),
    timezone,
    missingCost: {
      orders: missingCostOrders,
      total: totalOrdersInRange,
      percent:
        totalOrdersInRange > 0
          ? missingCostOrders / totalOrdersInRange
          : 0,
    },
    syncState: {
      totalOrders: totalOrdersAllTime,
    },
  };
}

function buildSummaryCards({ current, previous, conversionRate }) {
  const totals = summarizeMetrics(current, conversionRate);
  const prevTotals = summarizeMetrics(previous, conversionRate);
  const cards = [
    {
      key: "revenue",
      label: "Revenue",
      value: totals.revenue,
      deltaPercentage: percentChange(totals.revenue, prevTotals.revenue),
      trend: trendDirection(totals.revenue, prevTotals.revenue),
    },
    {
      key: "orders",
      label: "Orders",
      value: totals.orders,
      deltaPercentage: percentChange(totals.orders, prevTotals.orders),
      trend: trendDirection(totals.orders, prevTotals.orders),
      formatter: "count",
    },
    {
      key: "adSpend",
      label: "Ad spend",
      value: totals.adSpend,
      deltaPercentage: percentChange(totals.adSpend, prevTotals.adSpend),
      trend: trendDirection(totals.adSpend, prevTotals.adSpend, false),
    },
    {
      key: "netProfit",
      label: "Net profit",
      value: totals.netProfit,
      deltaPercentage: percentChange(totals.netProfit, prevTotals.netProfit),
      trend: trendDirection(totals.netProfit, prevTotals.netProfit),
    },
    {
      key: "netMargin",
      label: "Net margin",
      value: totals.margin,
      formatter: "percentage",
      deltaPercentage: percentChange(totals.margin, prevTotals.margin, true),
      trend: trendDirection(totals.margin, prevTotals.margin),
    },
    {
      key: "roas",
      label: "ROAS",
      value: totals.adSpend > 0 ? totals.revenue / totals.adSpend : 0,
      formatter: "multiple",
      deltaPercentage: percentChange(
        totals.adSpend > 0 ? totals.revenue / totals.adSpend : 0,
        prevTotals.adSpend > 0 ? prevTotals.revenue / prevTotals.adSpend : 0,
        true,
      ),
      trend: trendDirection(
        totals.adSpend > 0 ? totals.revenue / totals.adSpend : 0,
        prevTotals.adSpend > 0 ? prevTotals.revenue / prevTotals.adSpend : 0,
      ),
    },
  ];
  return cards;
}

function summarizeMetrics(metrics, conversionRate) {
  const summary = {
    revenue: 0,
    orders: 0,
    adSpend: 0,
    netProfit: 0,
  };
  for (const row of metrics) {
    summary.revenue += Number(row.revenue || 0) * conversionRate;
    summary.orders += Number(row.orders || 0);
    summary.adSpend += Number(row.adSpend || 0) * conversionRate;
    summary.netProfit += Number(row.netProfit || 0) * conversionRate;
  }
  summary.margin =
    summary.revenue > 0 ? summary.netProfit / summary.revenue : 0;
  return summary;
}

function buildTimeSeries({
  metrics,
  rangeStart,
  rangeDays,
  conversionRate,
  timezone,
}) {
  const timeline = new Map();
  for (const metric of metrics) {
    const key = formatDateKey(metric.date, { timezone });
    timeline.set(key, metric);
  }
  const series = {
    revenue: [],
    netProfit: [],
    adSpend: [],
  };
  for (let i = 0; i < rangeDays; i += 1) {
    const date = shiftDays(rangeStart, i, { timezone });
    const key = formatDateKey(date, { timezone });
    const metric = timeline.get(key);
    series.revenue.push({
      date: key,
      value: metric ? Number(metric.revenue) * conversionRate : 0,
    });
    series.netProfit.push({
      date: key,
      value: metric ? Number(metric.netProfit) * conversionRate : 0,
    });
    series.adSpend.push({
      date: key,
      value: metric ? Number(metric.adSpend) * conversionRate : 0,
    });
  }
  return series;
}

function buildCostBreakdown({ metrics, conversionRate }) {
  const revenue = sumField(metrics, "revenue") * conversionRate || 1;
  const cogs = sumField(metrics, "cogs") * conversionRate;
  const adSpend = sumField(metrics, "adSpend") * conversionRate;
  const shipping = sumField(metrics, "shippingCost") * conversionRate;
  const paymentFees = sumField(metrics, "paymentFees") * conversionRate;

  const coreTotal = cogs + adSpend + shipping + paymentFees;
  const other = Math.max(0, revenue - coreTotal);

  return [
    createSlice("COGS", cogs, revenue),
    createSlice("Ad spend", adSpend, revenue),
    createSlice("Fees", paymentFees, revenue),
    createSlice("Shipping", shipping, revenue),
    createSlice("Other", other, revenue),
  ];
}

function createSlice(label, amount, revenue) {
  return {
    label,
    amount,
    share: revenue > 0 ? amount / revenue : 0,
  };
}

async function loadTopProducts({
  storeId,
  range,
  conversionRate,
  currency,
}) {
  const lineItems = await prisma.orderLineItem.groupBy({
    by: ["sku"],
    where: {
      order: {
        storeId,
        processedAt: { gte: range.start, lte: range.end },
      },
    },
    _sum: {
      revenue: true,
      cogs: true,
      quantity: true,
    },
  });

  const enriched = [];
  for (const row of lineItems) {
    const revenue = Number(row._sum.revenue || 0) * conversionRate;
    const cogs = Number(row._sum.cogs || 0) * conversionRate;
    const netProfit = revenue - cogs;
    enriched.push({
      sku: row.sku ?? "Unknown SKU",
      title: row.sku ?? "Unknown SKU",
      revenue,
      cogs,
      netProfit,
      margin: revenue > 0 ? netProfit / revenue : 0,
      units: Number(row._sum.quantity || 0),
      currency,
    });
  }

  return enriched
    .sort((a, b) => b.netProfit - a.netProfit)
    .slice(0, 5);
}

function buildPlanStatus(planUsageResult) {
  if (!planUsageResult) return null;
  const usage = planUsageResult.usage?.orders;
  return {
    planName: planUsageResult.planDefinition?.name ?? null,
    planStatus: planUsageResult.subscription?.status ?? "INACTIVE",
    orderUsage: usage?.count ?? 0,
    orderLimit: usage?.limit ?? 0,
    orderStatus: usage?.status ?? "ok",
  };
}

function sumField(rows, field) {
  return rows.reduce((sum, row) => sum + Number(row[field] || 0), 0);
}

function percentChange(current, previous, allowNegativeZero = false) {
  if (!Number.isFinite(previous) || previous === 0) {
    return null;
  }
  const delta = ((current - previous) / Math.abs(previous)) * 100;
  if (!allowNegativeZero && Math.abs(delta) < 0.01) {
    return 0;
  }
  return Number(delta.toFixed(1));
}

function trendDirection(current, previous, positiveWhenLower = false) {
  if (previous == null) return "flat";
  if (current === previous) return "flat";
  const improving = positiveWhenLower ? current < previous : current > previous;
  return improving ? "up" : "down";
}
