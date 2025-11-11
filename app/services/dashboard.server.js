import prisma from "../db.server";
import { getFixedCostTotal } from "./fixed-costs.server";
import { checkNetProfitAlert, checkRefundSpikeAlert } from "./alerts.server";
import { getExchangeRate } from "./exchange-rates.server";
import { getMerchantPerformanceSummary } from "./merchant-performance.server";
import { startOfDay, shiftDays } from "../utils/dates.server.js";

const DEFAULT_RANGE = 14;

export async function getDashboardOverview({ store, rangeDays = DEFAULT_RANGE }) {
  if (!store?.id) {
    throw new Error("Store record is required to load dashboard overview");
  }

  const today = startOfDay(new Date());
  const rangeStart = shiftDays(today, -(rangeDays - 1));
  const previousStart = shiftDays(rangeStart, -rangeDays);

  const [currentMetrics, previousMetrics, openIssues, storeRecord] =
    await Promise.all([
      prisma.dailyMetric.findMany({
        where: { storeId: store.id, date: { gte: rangeStart } },
        orderBy: { date: "asc" },
      }),
      prisma.dailyMetric.findMany({
        where: {
          storeId: store.id,
          date: { gte: previousStart, lt: rangeStart },
        },
      }),
      prisma.reconciliationIssue.findMany({
        where: { storeId: store.id, status: "OPEN" },
        orderBy: { issueDate: "desc" },
        take: 3,
      }),
      prisma.store.findUnique({
        where: { id: store.id },
        include: { merchant: true },
      }),
    ]);

  const merchantId = storeRecord?.merchantId ?? store.merchantId;
  const storeCurrency = storeRecord?.currency ?? "USD";
  const masterCurrency =
    storeRecord?.merchant?.primaryCurrency ?? storeCurrency;
  const conversionRate = await getExchangeRate({
    base: storeCurrency,
    quote: masterCurrency,
  });
  const fixedCostTotalStore = merchantId
    ? await getFixedCostTotal({
        merchantId,
        rangeDays,
        rangeStart,
        rangeEnd: today,
      })
    : 0;
  const fixedCostTotal = fixedCostTotalStore * conversionRate;

  const summary = buildSummary(
    currentMetrics,
    previousMetrics,
    fixedCostTotal,
    conversionRate,
  );
  const netProfitAfterFixedCard = summary.find((card) => card.key === "netProfitAfterFixed");
  const refundRateCard = summary.find((card) => card.key === "refundRate");
  const timeSeries = buildTimeSeries(
    rangeStart,
    rangeDays,
    currentMetrics,
    conversionRate,
  );
  const costBreakdown = buildCostBreakdown(
    currentMetrics,
    fixedCostTotal,
    conversionRate,
  );
  const topProducts = await loadTopProducts(
    store.id,
    rangeStart,
    conversionRate,
  );
  const alerts = openIssues.map(issueToAlert);

  if (storeRecord) {
    await checkNetProfitAlert({
      store: storeRecord,
      netProfitAfterFixed:
        netProfitAfterFixedCard?.value ??
        sumField(currentMetrics, "netProfit") * conversionRate - fixedCostTotal,
    });

    if (refundRateCard) {
      await checkRefundSpikeAlert({
        store: storeRecord,
        refundRate: refundRateCard.value ?? 0,
        refundCount: sumField(currentMetrics, "refunds"),
        orderCount: sumField(currentMetrics, "orders"),
      });
    }
  }

  const merchantSummary = merchantId
    ? await getMerchantPerformanceSummary({
        merchantId,
        rangeDays,
      })
    : null;

  return {
    shopDomain: storeRecord?.shopDomain ?? store.shopDomain,
    rangeLabel: `Last ${rangeDays} days`,
    summaryCards: summary,
    timeseries: timeSeries,
    costBreakdown,
    topProducts,
    alerts,
    fixedCosts: fixedCostTotal,
    currency: masterCurrency,
    merchantSummary,
  };
}

function buildSummary(
  currentMetrics,
  previousMetrics,
  fixedCostTotal = 0,
  conversionRate = 1,
) {
  const netRevenue = sumField(currentMetrics, "revenue") * conversionRate;
  const adSpend = sumField(currentMetrics, "adSpend") * conversionRate;
  const netProfit = sumField(currentMetrics, "netProfit") * conversionRate;
  const refundAmount = sumField(currentMetrics, "refundAmount") * conversionRate;
  const refunds = sumField(currentMetrics, "refunds");
  const prevRevenue = sumField(previousMetrics, "revenue") * conversionRate;
  const prevAdSpend = sumField(previousMetrics, "adSpend") * conversionRate;
  const prevNetProfit = sumField(previousMetrics, "netProfit") * conversionRate;
  const prevRefundAmount =
    sumField(previousMetrics, "refundAmount") * conversionRate;
  const prevRefunds = sumField(previousMetrics, "refunds");
  const profitOnAdSpend = adSpend > 0 ? netProfit / adSpend : 0;
  const prevProfitOnAdSpend =
    prevAdSpend > 0 ? prevNetProfit / prevAdSpend : 0;
  const netProfitAfterFixed = netProfit - fixedCostTotal;
  const currentOrders = sumField(currentMetrics, "orders");
  const previousOrders = sumField(previousMetrics, "orders");
  const refundRate = currentOrders > 0 ? refunds / currentOrders : 0;
  const prevRefundRate = previousOrders > 0 ? prevRefunds / previousOrders : 0;

  return [
    {
      key: "netRevenue",
      label: "Net revenue",
      value: netRevenue,
      deltaPercentage: percentChange(netRevenue, prevRevenue),
      trend: trendDirection(netRevenue, prevRevenue),
    },
    {
      key: "adSpend",
      label: "Ad spend",
      value: adSpend,
      deltaPercentage: percentChange(adSpend, prevAdSpend),
      trend: trendDirection(adSpend, prevAdSpend, false),
    },
    {
      key: "netProfit",
      label: "Net profit",
      value: netProfit,
      deltaPercentage: percentChange(netProfit, prevNetProfit),
      trend: trendDirection(netProfit, prevNetProfit),
    },
    {
      key: "profitOnAdSpend",
      label: "Net profit % of ad spend",
      value: profitOnAdSpend,
      deltaPercentage: percentChange(
        profitOnAdSpend,
        prevProfitOnAdSpend,
        true,
      ),
      trend: trendDirection(profitOnAdSpend, prevProfitOnAdSpend),
      formatter: "percentage",
    },
    {
      key: "fixedCosts",
      label: "Fixed cost burn",
      value: fixedCostTotal,
      deltaPercentage: null,
      trend: "flat",
      deltaLabel: "Fixed costs this period",
    },
    {
      key: "netProfitAfterFixed",
      label: "Net profit after fixed",
      value: netProfitAfterFixed,
      deltaPercentage: percentChange(netProfitAfterFixed, prevNetProfit),
      trend: trendDirection(netProfitAfterFixed, prevNetProfit),
    },
    {
      key: "refundRate",
      label: "Refund rate",
      value: refundRate,
      formatter: "percentage",
      deltaPercentage: percentChange(refundRate, prevRefundRate, true),
      trend: trendDirection(refundRate, prevRefundRate, false),
      deltaLabel: `${refunds} refunds`,
    },
    {
      key: "refundImpact",
      label: "Refund impact",
      value: refundAmount,
      deltaPercentage: percentChange(refundAmount, prevRefundAmount),
      trend: trendDirection(refundAmount, prevRefundAmount, false),
      deltaLabel: "Refunded revenue",
    },
  ];
}

function buildTimeSeries(rangeStart, rangeDays, metrics, conversionRate = 1) {
  const timeline = new Map();
  for (const metric of metrics) {
    const key = metric.date.toISOString().slice(0, 10);
    timeline.set(key, metric);
  }

  const series = {
    revenue: [],
    adSpend: [],
    netProfit: [],
  };

  for (let i = 0; i < rangeDays; i += 1) {
    const date = shiftDays(rangeStart, i);
    const key = date.toISOString().slice(0, 10);
    const metric = timeline.get(key);
    series.revenue.push({
      date: key,
      value: metric ? Number(metric.revenue) * conversionRate : 0,
    });
    series.adSpend.push({
      date: key,
      value: metric ? Number(metric.adSpend) * conversionRate : 0,
    });
    series.netProfit.push({
      date: key,
      value: metric ? Number(metric.netProfit) * conversionRate : 0,
    });
  }

  return series;
}

function buildCostBreakdown(
  metrics,
  fixedCostTotal = 0,
  conversionRate = 1,
) {
  const revenue = sumField(metrics, "revenue") * conversionRate || 1;
  const cogs = sumField(metrics, "cogs") * conversionRate;
  const adSpend = sumField(metrics, "adSpend") * conversionRate;
  const shipping = sumField(metrics, "shippingCost") * conversionRate;
  const paymentFees = sumField(metrics, "paymentFees") * conversionRate;
  const refunds = sumField(metrics, "refundAmount") * conversionRate;
  const fixedCosts = fixedCostTotal;
  const slices = [
    { label: "COGS", value: cogs / revenue },
    { label: "Ad spend", value: adSpend / revenue },
    { label: "Payment fees", value: paymentFees / revenue },
    { label: "Shipping", value: shipping / revenue },
    { label: "Fixed costs", value: fixedCosts / revenue },
    { label: "Refunds", value: refunds / revenue },
  ];

  const accounted = slices.reduce((acc, slice) => acc + slice.value, 0);
  slices.push({ label: "Other", value: Math.max(0, 1 - accounted) });

  return slices;
}

async function loadTopProducts(storeId, rangeStart, conversionRate = 1) {
  const productGroups = await prisma.dailyMetric.groupBy({
    by: ["productSku"],
    where: {
      storeId,
      productSku: { not: null },
      date: { gte: rangeStart },
    },
    _sum: {
      revenue: true,
      netProfit: true,
      units: true,
      refundAmount: true,
    },
    orderBy: {
      _sum: {
        netProfit: "desc",
      },
    },
    take: 5,
  });

  return productGroups.map((group) => {
    const revenue = Number(group._sum.revenue || 0) * conversionRate;
    const netProfit = Number(group._sum.netProfit || 0) * conversionRate;
    const refundAmount = Number(group._sum.refundAmount || 0) * conversionRate;
    const margin = revenue > 0 ? netProfit / revenue : 0;
    return {
      title: group.productSku ?? "Unknown SKU",
      sku: group.productSku ?? "N/A",
      revenue,
      netProfit,
      margin,
      refunds: revenue > 0 ? refundAmount / revenue : 0,
    };
  });
}

function issueToAlert(issue) {
  let tone = "info";
  if (issue.issueType === "SHOPIFY_VS_PAYMENT") {
    tone = "warning";
  } else if (issue.issueType === "SHOPIFY_VS_ADS") {
    tone = "info";
  }
  return {
    type: tone,
    title: issue.issueType.replace(/_/g, " "),
    message: issue.details?.message ?? issueDescription(issue),
  };
}

function issueDescription(issue) {
  if (issue.orderId) {
    return `Order ${issue.orderId} delta ${formatAmount(issue.amountDelta)}`;
  }
  return `Detected ${formatAmount(issue.amountDelta)} variance`;
}

function formatAmount(value) {
  return `$${Number(value).toFixed(2)}`;
}

function sumField(metrics, field) {
  return metrics.reduce((acc, metric) => acc + Number(metric[field] || 0), 0);
}

function percentChange(current, previous, allowNaN = false) {
  if (!previous && previous !== 0) {
    return 0;
  }
  if (previous === 0) {
    return allowNaN ? 0 : current > 0 ? 100 : 0;
  }
  return Number((((current - previous) / Math.abs(previous)) * 100).toFixed(1));
}

function trendDirection(current, previous, positiveIsGood = true) {
  if (current === previous) {
    return "flat";
  }
  const isUp = current > previous;
  return positiveIsGood ? (isUp ? "up" : "down") : isUp ? "down" : "up";
}
