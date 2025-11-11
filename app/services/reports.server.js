import prisma from "../db.server";
import { getFixedCostTotal } from "./fixed-costs.server";
import { getExchangeRate } from "./exchange-rates.server";
import { startOfDay, shiftDays } from "../utils/dates.server.js";

const DEFAULT_RANGE_DAYS = 30;

export async function getReportingOverview({ storeId, rangeDays = DEFAULT_RANGE_DAYS }) {
  if (!storeId) {
    throw new Error("storeId is required for reporting overview");
  }

  const range = {
    end: startOfDay(new Date()),
    start: shiftDays(startOfDay(new Date()), -rangeDays + 1),
  };

  const [channelRows, productRows, aggregateMetrics, storeRecord] = await Promise.all([
    prisma.dailyMetric.groupBy({
      by: ["channel"],
      where: {
        storeId,
        date: { gte: range.start },
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
        date: { gte: range.start },
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
      where: { storeId, date: { gte: range.start } },
      _sum: {
        revenue: true,
        netProfit: true,
        adSpend: true,
        orders: true,
        refundAmount: true,
        refunds: true,
      },
    }),
    prisma.store.findUnique({
      where: { id: storeId },
      include: { merchant: true },
    }),
  ]);

  const storeCurrency = storeRecord?.currency ?? "USD";
  const masterCurrency =
    storeRecord?.merchant?.primaryCurrency ?? storeCurrency;
  const conversionRate = await getExchangeRate({
    base: storeCurrency,
    quote: masterCurrency,
  });

  const fixedCostTotalStore = storeRecord?.merchantId
    ? await getFixedCostTotal({
        merchantId: storeRecord.merchantId,
        rangeDays,
        rangeStart: range.start,
        rangeEnd: range.end,
      })
    : 0;
  const fixedCostTotal = fixedCostTotalStore * conversionRate;

  const channels = channelRows
    .map((row) => {
      const revenue = Number(row._sum.revenue || 0) * conversionRate;
      const adSpend = Number(row._sum.adSpend || 0) * conversionRate;
      const netProfit = Number(row._sum.netProfit || 0) * conversionRate;
      const orders = Number(row._sum.orders || 0);
      const margin = revenue > 0 ? netProfit / revenue : 0;
      const mer = adSpend > 0 ? revenue / adSpend : null;
      const npas = adSpend > 0 ? netProfit / adSpend : null;
      return {
        channel: row.channel,
        revenue,
        adSpend,
        netProfit,
        orders,
        mer,
        npas,
        margin,
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
    refundAmount: Number(aggregateMetrics._sum.refundAmount || 0) * conversionRate,
    refunds: Number(aggregateMetrics._sum.refunds || 0),
  };

  summary.netMargin =
    summary.revenue > 0 ? summary.netProfit / summary.revenue : 0;
  summary.mer =
    summary.adSpend > 0 ? summary.revenue / summary.adSpend : null;
  summary.npas =
    summary.adSpend > 0 ? summary.netProfit / summary.adSpend : null;
  summary.fixedCosts = fixedCostTotal;
  summary.netProfitAfterFixed = summary.netProfit - fixedCostTotal;
  summary.netMarginAfterFixed =
    summary.revenue > 0 ? summary.netProfitAfterFixed / summary.revenue : 0;
  summary.refundRate = summary.orders > 0 ? summary.refunds / summary.orders : 0;

  return {
    range,
    summary,
    channels,
    products,
    currency: masterCurrency,
  };
}

export async function getNetProfitVsSpendSeries({ storeId, rangeDays = DEFAULT_RANGE_DAYS }) {
  if (!storeId) {
    throw new Error("storeId is required for performance timeseries");
  }

  const end = startOfDay(new Date());
  const start = shiftDays(end, -rangeDays + 1);

  const storeRecord = await prisma.store.findUnique({
    where: { id: storeId },
    include: { merchant: true },
  });
  const storeCurrency = storeRecord?.currency ?? "USD";
  const masterCurrency =
    storeRecord?.merchant?.primaryCurrency ?? storeCurrency;
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
    const key = row.date.toISOString().slice(0, 10);
    map.set(key, {
      date: key,
      revenue: Number(row.revenue || 0) * conversionRate,
      adSpend: Number(row.adSpend || 0) * conversionRate,
      netProfit: Number(row.netProfit || 0) * conversionRate,
    });
  });

  const series = [];
  for (let i = 0; i < rangeDays; i += 1) {
    const date = shiftDays(start, i);
    const key = date.toISOString().slice(0, 10);
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
  };
}

export async function getAdPerformanceBreakdown({ storeId, rangeDays = DEFAULT_RANGE_DAYS }) {
  if (!storeId) {
    throw new Error("storeId is required for ad performance report");
  }

  const end = startOfDay(new Date());
  const start = shiftDays(end, -rangeDays + 1);

  const [adSpendRows, channelMetrics, storeRecord] = await Promise.all([
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
    prisma.store.findUnique({
      where: { id: storeId },
      include: { merchant: true },
    }),
  ]);

  const storeCurrency = storeRecord?.currency ?? "USD";
  const masterCurrency =
    storeRecord?.merchant?.primaryCurrency ?? storeCurrency;
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
    merchantId: storeRecord?.merchantId ?? null,
    providers,
    currency: masterCurrency,
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
