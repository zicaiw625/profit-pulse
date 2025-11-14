import prisma from "../db.server";
import { getFixedCostBreakdown } from "./fixed-costs.server";
import { getExchangeRate } from "./exchange-rates.server";
import {
  startOfDay,
  shiftDays,
  resolveTimezone,
  formatDateKey,
} from "../utils/dates.server.js";
import { buildCacheKey, memoizeAsync } from "./cache.server";

const DEFAULT_RANGE_DAYS = 30;
const DAY_MS = 1000 * 60 * 60 * 24;
const CACHE_TTL_MS = 30 * 1000;

const DIMENSION_DEFINITIONS = {
  channel: {
    field: "channel",
    label: "Channel",
    where: { channel: { not: "PRODUCT" } },
    format: (value) => value ?? "Unassigned",
    source: "dailyMetric",
  },
  product: {
    field: "productSku",
    label: "Product SKU",
    where: { channel: "PRODUCT", productSku: { not: null } },
    format: (value) => value ?? "Unknown SKU",
    source: "dailyMetric",
  },
  date: {
    field: "date",
    label: "Date",
    format: (value) => (value ? value.toISOString().slice(0, 10) : "No date"),
    source: "dailyMetric",
  },
  country: {
    label: "Country / Region",
    format: (value) => value ?? "Unknown",
    source: "orders",
  },
  customer: {
    label: "Customer",
    format: (value) => value ?? "Guest",
    source: "orders",
  },
};

const METRIC_COLUMNS = {
  revenue: { field: "revenue", label: "Revenue", isCurrency: true },
  netProfit: { field: "netProfit", label: "Net profit", isCurrency: true },
  adSpend: { field: "adSpend", label: "Ad spend", isCurrency: true },
  cogs: { field: "cogs", label: "COGS", isCurrency: true },
  shippingCost: { field: "shippingCost", label: "Shipping", isCurrency: true },
  paymentFees: { field: "paymentFees", label: "Payment fees", isCurrency: true },
  refundAmount: { field: "refundAmount", label: "Refund amount", isCurrency: true },
  orders: { field: "orders", label: "Orders", isCurrency: false },
};

const DEFAULT_CUSTOM_METRICS = ["revenue", "netProfit"];

export async function getReportingOverview({
  storeId,
  rangeDays = DEFAULT_RANGE_DAYS,
  rangeStart,
  rangeEnd,
}) {
  if (!storeId) {
    throw new Error("storeId is required for reporting overview");
  }

  const context = await loadStoreContext(storeId);
  const { start, end, resolvedDays } = resolveRange({
    rangeDays,
    rangeStart,
    rangeEnd,
    timezone: context.timezone,
  });
  const cacheKey = buildCacheKey(
    "reporting-overview",
    storeId,
    `${context.timezone}|${start.toISOString()}|${end.toISOString()}`,
  );
  return memoizeAsync(cacheKey, CACHE_TTL_MS, () =>
    buildReportingOverview({
      storeId,
      rangeDays: resolvedDays,
      range: { start, end },
      context,
    }),
  );
}

export async function getCustomReportData({
  storeId,
  dimension = "channel",
  metrics = DEFAULT_CUSTOM_METRICS,
  start,
  end,
  rangeDays = DEFAULT_RANGE_DAYS,
  limit = 25,
  formula,
  formulaLabel,
}) {
  if (!storeId) {
    throw new Error("storeId is required for custom reports");
  }

  const normalizedDimension = DIMENSION_DEFINITIONS[dimension]
    ? dimension
    : "channel";
  const dimensionDef = DIMENSION_DEFINITIONS[normalizedDimension];

  const context = await loadStoreContext(storeId);
  const timezone = context.timezone;
  const today = startOfDay(new Date(), { timezone });
  const rangeEnd = end ? startOfDay(new Date(end), { timezone }) : today;
  const rangeStart = start
    ? startOfDay(new Date(start), { timezone })
    : shiftDays(rangeEnd, -Math.max(rangeDays, 1) + 1, { timezone });

  const { storeCurrency, masterCurrency } = context;
  const conversionRate = await getExchangeRate({
    base: storeCurrency,
    quote: masterCurrency,
  });

  const selectedMetrics = Array.from(
    new Set(
      (Array.isArray(metrics) ? metrics : [metrics])
        .map((name) => name?.toString().trim().toLowerCase())
        .filter((name) => METRIC_COLUMNS[name]),
    ),
  );
  const metricsToUse =
    selectedMetrics.length > 0 ? selectedMetrics : DEFAULT_CUSTOM_METRICS;

  let rows = [];
  if (dimensionDef.source === "orders") {
    rows = await buildOrderDimensionRows({
      storeId,
      dimension: normalizedDimension,
      metrics: metricsToUse,
      rangeStart,
      rangeEnd,
      masterCurrency,
      limit: Math.max(1, Math.min(limit ?? 25, 200)),
    });
  } else {
    const sumSelect = metricsToUse.reduce((acc, metric) => {
      const column = METRIC_COLUMNS[metric];
      if (column) {
        acc[column.field] = true;
      }
      return acc;
    }, {});
    if (!sumSelect.revenue) {
      sumSelect.revenue = true;
      if (!metricsToUse.includes("revenue")) {
        metricsToUse.unshift("revenue");
      }
    }

    const whereClause = {
      storeId,
      date: { gte: rangeStart, lte: rangeEnd },
      ...dimensionDef.where,
    };

    const firstMetricField = METRIC_COLUMNS[metricsToUse[0]]?.field ?? "revenue";
    const groupedRows = await prisma.dailyMetric.groupBy({
      by: [dimensionDef.field],
      where: whereClause,
      _sum: sumSelect,
      orderBy: {
        _sum: {
          [firstMetricField]: "desc",
        },
      },
      take: Math.max(1, Math.min(limit ?? 25, 200)),
    });

    rows = groupedRows.map((row) => {
      const value = row[dimensionDef.field];
      return {
        dimensionValue: dimensionDef.format(value),
        metrics: metricsToUse.map((metric) => {
          const column = METRIC_COLUMNS[metric];
          const baseValue = Number(row._sum[column.field] ?? 0);
          const normalized = column.isCurrency
            ? baseValue * conversionRate
            : baseValue;
          return {
            key: metric,
            label: column.label,
            value: normalized,
            isCurrency: column.isCurrency,
          };
        }),
      };
    });
  }

  const normalizedFormula = typeof formula === "string" ? formula.trim() : "";
  const customFormula = normalizedFormula
    ? {
        label: (formulaLabel ?? "Custom").toString().trim() || "Custom",
        expression: normalizedFormula,
      }
    : null;

  if (customFormula) {
    rows = rows.map((row) => {
      const valueMap = row.metrics.reduce((acc, metric) => {
        acc[metric.key] = metric.value;
        return acc;
      }, {});
      const computed = evaluateFormulaExpression(customFormula.expression, valueMap);
      if (computed === null) {
        return row;
      }
      return {
        ...row,
        metrics: [
          ...row.metrics,
          {
            key: `custom_${customFormula.label.replace(/\s+/g, "_").toLowerCase()}`,
            label: customFormula.label,
            value: computed,
            isCurrency: false,
          },
        ],
      };
    });
  }

  const responseMetrics = metricsToUse.map((metric) => ({
    key: metric,
    label: METRIC_COLUMNS[metric].label,
    isCurrency: METRIC_COLUMNS[metric].isCurrency,
  }));
  if (customFormula) {
    responseMetrics.push({
      key: `custom_${customFormula.label.replace(/\s+/g, "_").toLowerCase()}`,
      label: customFormula.label,
      isCurrency: false,
    });
  }

  return {
    range: { start: rangeStart, end: rangeEnd },
    dimension: {
      key: normalizedDimension,
      label: dimensionDef.label,
    },
    metrics: responseMetrics,
    rows,
    currency: masterCurrency,
    timezone,
    rangeLabel: `${formatDateKey(rangeStart, { timezone })} – ${formatDateKey(rangeEnd, {
      timezone,
    })}`,
    rangeInput: {
      start: formatDateKey(rangeStart, { timezone }),
      end: formatDateKey(rangeEnd, { timezone }),
    },
    customFormula,
  };
}

async function buildOrderDimensionRows({
  storeId,
  dimension,
  metrics,
  rangeStart,
  rangeEnd,
  masterCurrency,
  limit = 25,
}) {
  const orders = await prisma.order.findMany({
    where: {
      storeId,
      processedAt: { gte: rangeStart, lte: rangeEnd },
    },
    select: {
      id: true,
      total: true,
      netProfit: true,
      grossProfit: true,
      currency: true,
      customerCountry: true,
      customerEmail: true,
      customerName: true,
      customerId: true,
    },
  });

  if (!orders.length) {
    return [];
  }

  const orderIds = orders.map((order) => order.id);
  const [costs, refunds, attributions] = await Promise.all([
    prisma.orderCost.findMany({
      where: { orderId: { in: orderIds } },
      select: {
        orderId: true,
        amount: true,
        currency: true,
        type: true,
      },
    }),
    prisma.refundRecord.findMany({
      where: { orderId: { in: orderIds } },
      select: {
        orderId: true,
        amount: true,
        currency: true,
      },
    }),
    prisma.orderAttribution.findMany({
      where: { orderId: { in: orderIds } },
      select: {
        orderId: true,
        amount: true,
        currency: true,
      },
    }),
  ]);

  const currencies = new Set(
    [
      ...orders.map((order) => order.currency ?? masterCurrency),
      ...costs.map((cost) => cost.currency ?? masterCurrency),
      ...refunds.map((refund) => refund.currency ?? masterCurrency),
      ...attributions.map((attr) => attr.currency ?? masterCurrency),
    ].filter(Boolean),
  );
  const rateCache = await buildRateCache(currencies, masterCurrency);

  const orderMap = new Map(orders.map((order) => [order.id, order]));
  const bucketMap = new Map();

  const ensureBucket = (order) => {
    const key = getOrderDimensionKey(order, dimension);
    if (!key) return null;
    if (!bucketMap.has(key)) {
      bucketMap.set(key, {
        key,
        label: getOrderDimensionLabel(order, dimension, key),
        revenue: 0,
        netProfit: 0,
        adSpend: 0,
        orders: 0,
        cogs: 0,
        shippingCost: 0,
        paymentFees: 0,
        refundAmount: 0,
      });
    }
    return bucketMap.get(key);
  };

  orders.forEach((order) => {
    const bucket = ensureBucket(order);
    if (!bucket) return;
    bucket.orders += 1;
    bucket.revenue += convertAmount(order.total, order.currency, rateCache);
    bucket.netProfit += convertAmount(order.netProfit, order.currency, rateCache);
  });

  const costMap = new Map();
  costs.forEach((cost) => {
    const entry = costMap.get(cost.orderId) ?? {
      COGS: 0,
      SHIPPING: 0,
      PAYMENT_FEE: 0,
      PLATFORM_FEE: 0,
      CUSTOM: 0,
      currency: cost.currency ?? masterCurrency,
    };
    entry[cost.type] = (entry[cost.type] ?? 0) + Number(cost.amount ?? 0);
    costMap.set(cost.orderId, entry);
  });

  costMap.forEach((value, orderId) => {
    const order = orderMap.get(orderId);
    if (!order) return;
    const bucket = ensureBucket(order);
    if (!bucket) return;
    bucket.cogs += convertAmount(value.COGS, value.currency, rateCache);
    bucket.shippingCost += convertAmount(value.SHIPPING, value.currency, rateCache);
    bucket.paymentFees += convertAmount(value.PAYMENT_FEE, value.currency, rateCache);
  });

  refunds.forEach((refund) => {
    const order = orderMap.get(refund.orderId);
    if (!order) return;
    const bucket = ensureBucket(order);
    if (!bucket) return;
    bucket.refundAmount += convertAmount(refund.amount, refund.currency, rateCache);
  });

  attributions.forEach((attribution) => {
    const order = orderMap.get(attribution.orderId);
    if (!order) return;
    const bucket = ensureBucket(order);
    if (!bucket) return;
    bucket.adSpend += convertAmount(attribution.amount, attribution.currency, rateCache);
  });

  const metricRows = Array.from(bucketMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit)
    .map((bucket) => ({
      dimensionValue: bucket.label,
      metrics: metrics.map((metricKey) => {
        const column = METRIC_COLUMNS[metricKey];
        const value = resolveBucketMetric(bucket, metricKey);
        return {
          key: metricKey,
          label: column.label,
          value,
          isCurrency: column.isCurrency,
        };
      }),
    }));

  return metricRows;
}

async function buildRateCache(currencies, masterCurrency) {
  const cache = new Map();
  for (const currency of currencies) {
    if (!currency || cache.has(currency)) {
      continue;
    }
    if (currency === masterCurrency) {
      cache.set(currency, 1);
      continue;
    }
    const rate = await getExchangeRate({
      base: currency,
      quote: masterCurrency,
    });
    cache.set(currency, rate || 1);
  }
  if (!cache.has(masterCurrency)) {
    cache.set(masterCurrency, 1);
  }
  return cache;
}

function convertAmount(amount, currency, cache) {
  const numeric = Number(amount ?? 0);
  if (!numeric) return 0;
  const rate = cache.get(currency) ?? 1;
  return numeric * rate;
}

function getOrderDimensionKey(order, dimension) {
  if (dimension === "country") {
    return order.customerCountry ?? "Unknown";
  }
  if (dimension === "customer") {
    return (
      order.customerEmail ??
      order.customerName ??
      order.customerId ??
      "Guest"
    );
  }
  return "Unknown";
}

function getOrderDimensionLabel(order, dimension, fallback) {
  if (dimension === "customer") {
    return (
      order.customerName ??
      order.customerEmail ??
      order.customerId ??
      fallback ??
      "Guest"
    );
  }
  if (dimension === "country") {
    return fallback ?? "Unknown";
  }
  return fallback ?? "Unknown";
}

function resolveBucketMetric(bucket, metricKey) {
  switch (metricKey) {
    case "revenue":
      return bucket.revenue;
    case "netProfit":
      return bucket.netProfit;
    case "adSpend":
      return bucket.adSpend;
    case "cogs":
      return bucket.cogs;
    case "shippingCost":
      return bucket.shippingCost;
    case "paymentFees":
      return bucket.paymentFees;
    case "refundAmount":
      return bucket.refundAmount;
    case "orders":
      return bucket.orders;
    default:
      return 0;
  }
}

function evaluateFormulaExpression(expression, values = {}) {
  const sanitized = expression.replace(/[^0-9a-zA-Z_+\-*/().\s]/g, "");
  if (!sanitized.trim()) {
    return null;
  }
  const substituted = sanitized.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (token) => {
    if (Object.prototype.hasOwnProperty.call(values, token)) {
      const numeric = Number(values[token] ?? 0);
      return Number.isFinite(numeric) ? String(numeric) : "0";
    }
    return "0";
  });
  try {
    const result = Function(`"use strict"; return (${substituted});`)();
    return Number.isFinite(result) ? Number(result) : null;
  } catch (error) {
    console.error("Failed to evaluate custom report formula", error);
    return null;
  }
}

async function buildReportingOverview({ storeId, rangeDays, range, context }) {
  const { store, storeCurrency, masterCurrency, timezone } = context;
  const [channelRows, productRows, aggregateMetrics] =
    await Promise.all([
      prisma.dailyMetric.groupBy({
        by: ["channel"],
        where: {
          storeId,
          date: { gte: range.start, lte: range.end },
          channel: { not: "PRODUCT" },
        },
        _sum: {
          revenue: true,
          adSpend: true,
          netProfit: true,
          orders: true,
        },
      }),
      prisma.dailyMetric.groupBy({
        by: ["productSku"],
        where: {
          storeId,
          channel: "PRODUCT",
          productSku: { not: null },
          date: { gte: range.start, lte: range.end },
        },
        _sum: {
          revenue: true,
          netProfit: true,
          orders: true,
          units: true,
          adSpend: true,
          refundAmount: true,
          refunds: true,
        },
        orderBy: {
          _sum: {
            revenue: "desc",
          },
        },
        take: 15,
      }),
      prisma.dailyMetric.aggregate({
        where: { storeId, date: { gte: range.start, lte: range.end } },
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
      }),
    ]);

  const conversionRate = await getExchangeRate({
    base: storeCurrency,
    quote: masterCurrency,
  });

  const channelStats = channelRows.reduce((acc, row) => {
    acc[row.channel] = {
      revenue: Number(row._sum.revenue || 0),
      orders: Number(row._sum.orders || 0),
    };
    return acc;
  }, {});
  const fixedCostStore = store?.merchantId
    ? await getFixedCostBreakdown({
        merchantId: store.merchantId,
        rangeDays,
        rangeStart: range.start,
        rangeEnd: range.end,
        channelStats,
      })
    : { total: 0, allocations: { perChannel: {}, unassigned: 0 }, items: [] };
  const fixedCostTotal = fixedCostStore.total * conversionRate;
  const fixedCostPerChannel = Object.entries(
    fixedCostStore.allocations?.perChannel ?? {},
  ).reduce((acc, [channel, value]) => {
    acc[channel] = Number(value || 0) * conversionRate;
    return acc;
  }, {});
  const fixedCostUnassigned =
    Number(fixedCostStore.allocations?.unassigned || 0) * conversionRate;

  const channels = channelRows
    .map((row) => {
      const revenue = Number(row._sum.revenue || 0) * conversionRate;
      const adSpend = Number(row._sum.adSpend || 0) * conversionRate;
      const netProfit = Number(row._sum.netProfit || 0) * conversionRate;
      const orders = Number(row._sum.orders || 0);
      const margin = revenue > 0 ? netProfit / revenue : 0;
      const mer = adSpend > 0 ? revenue / adSpend : null;
      const npas = adSpend > 0 ? netProfit / adSpend : null;
      const fixedShare = fixedCostPerChannel[row.channel] ?? 0;
      const netAfterFixed = netProfit - fixedShare;
      return {
        channel: row.channel,
        revenue,
        adSpend,
        netProfit,
        netProfitAfterFixed: netAfterFixed,
        orders,
        mer,
        npas,
        margin,
        breakEvenRoas: margin > 0 ? 1 / margin : null,
        fixedCosts: fixedShare,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const products = productRows.map((row) => {
    const revenue = Number(row._sum.revenue || 0) * conversionRate;
    const netProfit = Number(row._sum.netProfit || 0) * conversionRate;
    const orders = Number(row._sum.orders || 0);
    const units = Number(row._sum.units || 0);
    const adSpend = Number(row._sum.adSpend || 0) * conversionRate;
    const refundAmount = Number(row._sum.refundAmount || 0) * conversionRate;
    const refunds = Number(row._sum.refunds || 0);
    const margin = revenue > 0 ? netProfit / revenue : 0;
    return {
      sku: row.productSku,
      revenue,
      netProfit,
      orders,
      units,
      adSpend,
      margin,
      refundRate: orders > 0 ? refunds / orders : 0,
      refundAmount,
    };
  });

  const summary = {
    revenue: Number(aggregateMetrics._sum.revenue || 0) * conversionRate,
    netProfit: Number(aggregateMetrics._sum.netProfit || 0) * conversionRate,
    adSpend: Number(aggregateMetrics._sum.adSpend || 0) * conversionRate,
    orders: Number(aggregateMetrics._sum.orders || 0),
    refundAmount:
      Number(aggregateMetrics._sum.refundAmount || 0) * conversionRate,
    refunds: Number(aggregateMetrics._sum.refunds || 0),
    cogs: Number(aggregateMetrics._sum.cogs || 0) * conversionRate,
    shippingCost:
      Number(aggregateMetrics._sum.shippingCost || 0) * conversionRate,
    paymentFees:
      Number(aggregateMetrics._sum.paymentFees || 0) * conversionRate,
  };

  summary.netMargin =
    summary.revenue > 0 ? summary.netProfit / summary.revenue : 0;
  summary.mer =
    summary.adSpend > 0 ? summary.revenue / summary.adSpend : null;
  summary.npas =
    summary.adSpend > 0 ? summary.netProfit / summary.adSpend : null;
  summary.grossProfit =
    summary.revenue -
    summary.cogs -
    summary.shippingCost -
    summary.paymentFees;
  summary.fixedCosts = fixedCostTotal;
  summary.netProfitAfterFixed = summary.netProfit - fixedCostTotal;
  summary.netMarginAfterFixed =
    summary.revenue > 0 ? summary.netProfitAfterFixed / summary.revenue : 0;
  summary.refundRate = summary.orders > 0 ? summary.refunds / summary.orders : 0;
  summary.breakEvenRoas =
    summary.netMargin > 0 ? 1 / summary.netMargin : null;

  return {
    range,
    rangeLabel: `${formatDateKey(range.start, { timezone })} – ${formatDateKey(range.end, {
      timezone,
    })}`,
    rangeInput: {
      start: formatDateKey(range.start, { timezone }),
      end: formatDateKey(range.end, { timezone }),
    },
    summary,
    channels,
    products,
    currency: masterCurrency,
    timezone,
    fixedCostAllocations: {
      perChannel: fixedCostPerChannel,
      unassigned: fixedCostUnassigned,
    },
  };
}
export async function getNetProfitVsSpendSeries({
  storeId,
  rangeDays = DEFAULT_RANGE_DAYS,
  rangeStart,
  rangeEnd,
}) {
  if (!storeId) {
    throw new Error("storeId is required for performance timeseries");
  }

  const context = await loadStoreContext(storeId);
  const { timezone, storeCurrency, masterCurrency } = context;
  const { start, end } = resolveRange({
    rangeDays,
    rangeStart,
    rangeEnd,
    timezone,
  });
  const conversionRate = await getExchangeRate({
    base: storeCurrency,
    quote: masterCurrency,
  });

  const rows = await prisma.dailyMetric.findMany({
    where: {
      storeId,
      channel: "TOTAL",
      productSku: null,
      date: { gte: start, lte: end },
    },
    orderBy: { date: "asc" },
  });

  const map = new Map();
  rows.forEach((row) => {
    const key = formatDateKey(row.date, { timezone });
    map.set(key, {
      date: key,
      revenue: Number(row.revenue || 0) * conversionRate,
      adSpend: Number(row.adSpend || 0) * conversionRate,
      netProfit: Number(row.netProfit || 0) * conversionRate,
    });
  });

  const series = [];
  for (let i = 0; i < rangeDays; i += 1) {
    const date = shiftDays(start, i, { timezone });
    const key = formatDateKey(date, { timezone });
    series.push(
      map.get(key) ?? {
        date: key,
        revenue: 0,
        adSpend: 0,
        netProfit: 0,
      },
    );
  }

  return {
    range: { start, end },
    points: series,
    currency: masterCurrency,
    timezone,
  };
}

export async function getAdPerformanceBreakdown({
  storeId,
  rangeDays = DEFAULT_RANGE_DAYS,
  rangeStart,
  rangeEnd,
}) {
  if (!storeId) {
    throw new Error("storeId is required for ad performance report");
  }

  const context = await loadStoreContext(storeId);
  const { timezone, storeCurrency, masterCurrency, store } = context;
  const { start, end } = resolveRange({
    rangeDays,
    rangeStart,
    rangeEnd,
    timezone,
  });

  const [adSpendRows, channelMetrics] = await Promise.all([
    prisma.adSpendRecord.findMany({
      where: {
        storeId,
        date: { gte: start, lte: end },
      },
    }),
    prisma.dailyMetric.findMany({
      where: {
        storeId,
        channel: { in: ["META_ADS", "GOOGLE_ADS"] },
        productSku: null,
        date: { gte: start, lte: end },
      },
    }),
  ]);

  const conversionRate = await getExchangeRate({
    base: storeCurrency,
    quote: masterCurrency,
  });

  const providerTotals = new Map();
  for (const metric of channelMetrics) {
    const key = metric.channel;
    const totals = providerTotals.get(key) || {
      revenue: 0,
      netProfit: 0,
      adSpend: 0,
    };
    totals.revenue += Number(metric.revenue || 0);
    totals.netProfit += Number(metric.netProfit || 0);
    totals.adSpend += Number(metric.adSpend || 0);
    providerTotals.set(key, totals);
  }

  const providerRows = new Map();
  for (const record of adSpendRows) {
    const provider = record.provider;
    const key = [
      provider,
      record.campaignId ?? "campaign",
      record.adSetId ?? "adset",
      record.adId ?? "ad",
    ].join(":");

    const group = providerRows.get(key) || {
      provider,
      campaignId: record.campaignId,
      campaignName: record.campaignName,
      adSetId: record.adSetId,
      adSetName: record.adSetName,
      adId: record.adId,
      adName: record.adName,
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
    };

    group.spend += Number(record.spend || 0);
    group.impressions += Number(record.impressions || 0);
    group.clicks += Number(record.clicks || 0);
    group.conversions += Number(record.conversions || 0);
    providerRows.set(key, group);
  }

  const byProvider = new Map();
  for (const group of providerRows.values()) {
    const list = byProvider.get(group.provider) || [];
    list.push(group);
    byProvider.set(group.provider, list);
  }

  const providers = Array.from(byProvider.entries()).map(([provider, rows]) => {
    const totals = providerTotals.get(provider) || {
      revenue: 0,
      netProfit: 0,
      adSpend: 0,
    };
    const providerSpend = rows.reduce((sum, row) => sum + row.spend, 0);

    const enrichedRows = rows
      .map((row) => {
        const weight = providerSpend > 0 ? row.spend / providerSpend : 0;
        const estimatedRevenue = totals.revenue * weight * conversionRate;
        const estimatedNetProfit = totals.netProfit * weight * conversionRate;
        return {
          ...row,
          estimatedRevenue,
          estimatedNetProfit,
          mer:
            row.spend > 0
              ? (estimatedRevenue / (row.spend * conversionRate))
              : null,
          npas:
            row.spend > 0
              ? (estimatedNetProfit / (row.spend * conversionRate))
              : null,
          cpa:
            row.conversions > 0
              ? (row.spend * conversionRate) / row.conversions
              : null,
          spendConverted: row.spend * conversionRate,
        };
      })
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 25);

    return {
      provider,
      label: formatProvider(provider),
      spend: providerSpend * conversionRate,
      revenue: totals.revenue * conversionRate,
      netProfit: totals.netProfit * conversionRate,
      rows: enrichedRows,
    };
  });

  return {
    range: { start, end },
    merchantId: store?.merchantId ?? null,
    providers,
    currency: masterCurrency,
    timezone,
  };
}

function formatProvider(provider) {
  switch (provider) {
    case "META_ADS":
      return "Meta Ads";
    case "GOOGLE_ADS":
      return "Google Ads";
    default:
      return provider;
  }
}

function resolveRange({
  rangeStart,
  rangeEnd,
  rangeDays = DEFAULT_RANGE_DAYS,
  timezone = "UTC",
}) {
  const today = startOfDay(new Date(), { timezone });
  const computedEnd = rangeEnd
    ? startOfDay(rangeEnd, { timezone })
    : today;
  let computedStart = rangeStart
    ? startOfDay(rangeStart, { timezone })
    : shiftDays(computedEnd, -(rangeDays - 1), { timezone });
  if (computedStart > computedEnd) {
    const tmp = computedStart;
    computedStart = computedEnd;
    computedEnd = tmp;
  }
  const resolvedDays = Math.max(
    1,
    Math.round((computedEnd - computedStart) / DAY_MS) + 1,
  );
  return { start: computedStart, end: computedEnd, resolvedDays };
}

async function loadStoreContext(storeId) {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: { merchant: true },
  });
  if (!store) {
    throw new Error("Store not found");
  }
  const timezone = resolveTimezone({ store });
  const storeCurrency = store.currency ?? "USD";
  const masterCurrency = store.merchant?.primaryCurrency ?? storeCurrency;
  return {
    store,
    timezone,
    storeCurrency,
    masterCurrency,
  };
}
