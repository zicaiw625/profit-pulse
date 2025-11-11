import prisma from "../db.server";
import { getExchangeRate } from "./exchange-rates.server";
import { startOfDay, shiftDays } from "../utils/dates.server.js";

const DEFAULT_RANGE = 30;

export async function getRefundAnalytics({ storeId, rangeDays = DEFAULT_RANGE }) {
  if (!storeId) {
    throw new Error("storeId is required for refund analytics");
  }

  const end = startOfDay(new Date());
  const start = shiftDays(end, -(Math.max(rangeDays, 1) - 1));

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: { merchant: true },
  });

  if (!store) {
    throw new Error("Store not found");
  }

  const storeCurrency = store.currency ?? "USD";
  const masterCurrency = store.merchant?.primaryCurrency ?? storeCurrency;
  const storeConversionRate = await getExchangeRate({
    base: storeCurrency,
    quote: masterCurrency,
  });

  const [refundRows, metricAggregate] = await Promise.all([
    prisma.refundRecord.findMany({
      where: {
        storeId,
        processedAt: { gte: start, lte: end },
      },
      orderBy: { processedAt: "desc" },
    }),
    prisma.dailyMetric.aggregate({
      where: {
        storeId,
        channel: "TOTAL",
        productSku: null,
        date: { gte: start, lte: end },
      },
      _sum: {
        revenue: true,
        orders: true,
        refundAmount: true,
      },
    }),
  ]);

  const rateCache = await buildRateMap(refundRows, masterCurrency);

  let totalRefundAmount = 0;
  const timeseries = new Map();
  const reasonMap = new Map();
  const productMap = new Map();

  refundRows.forEach((refund) => {
    const rate = rateCache.get(refund.currency ?? storeCurrency) ?? 1;
    const convertedAmount = Number(refund.amount ?? 0) * rate;
    totalRefundAmount += convertedAmount;

    const dateKey = startOfDay(refund.processedAt).toISOString().slice(0, 10);
    const tsEntry = timeseries.get(dateKey) ?? {
      date: dateKey,
      amount: 0,
      count: 0,
    };
    tsEntry.amount += convertedAmount;
    tsEntry.count += 1;
    timeseries.set(dateKey, tsEntry);

    const reason = normalizeReason(refund.reason);
    const reasonEntry = reasonMap.get(reason) ?? { reason, amount: 0, count: 0 };
    reasonEntry.amount += convertedAmount;
    reasonEntry.count += 1;
    reasonMap.set(reason, reasonEntry);

    accumulateProductsFromRefund({
      refund,
      amount: convertedAmount,
      productMap,
    });
  });

  const totalOrders = Number(metricAggregate._sum.orders || 0);
  const refundRate = totalOrders > 0 ? refundRows.length / totalOrders : 0;

  return {
    range: { start, end },
    currency: masterCurrency,
    summary: {
      refundAmount: totalRefundAmount,
      refundCount: refundRows.length,
      refundRate,
      avgRefund: refundRows.length ? totalRefundAmount / refundRows.length : 0,
      refundShareOfRevenue:
        Number(metricAggregate._sum.revenue || 0) > 0
          ? totalRefundAmount /
            (Number(metricAggregate._sum.revenue || 0) * storeConversionRate)
          : 0,
      totalOrders,
    },
    timeseries: Array.from(timeseries.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    reasons: Array.from(reasonMap.values()).sort((a, b) => b.amount - a.amount),
    products: Array.from(productMap.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 25),
  };
}

export async function listRefundRecords({ storeId, rangeDays = DEFAULT_RANGE }) {
  const end = startOfDay(new Date());
  const start = shiftDays(end, -(Math.max(rangeDays, 1) - 1));
  return prisma.refundRecord.findMany({
    where: {
      storeId,
      processedAt: { gte: start, lte: end },
    },
    orderBy: { processedAt: "desc" },
  });
}

async function buildRateMap(refunds, masterCurrency) {
  const unique = Array.from(
    new Set(refunds.map((refund) => refund.currency || masterCurrency)),
  );
  const entries = await Promise.all(
    unique.map(async (currency) => [
      currency,
      await getExchangeRate({ base: currency, quote: masterCurrency }),
    ]),
  );
  return new Map(entries);
}

function accumulateProductsFromRefund({ refund, amount, productMap }) {
  const lineItems = Array.isArray(refund.lineItems) ? refund.lineItems : [];
  if (!lineItems.length || amount <= 0) {
    return;
  }

  const subtotal = lineItems.reduce(
    (sum, line) =>
      sum +
      toNumber(
        line.subtotal_set?.shop_money?.amount ??
          line.total_set?.shop_money?.amount ??
          line.subtotal ??
          0,
      ),
    0,
  );

  lineItems.forEach((line) => {
    const sku = line?.line_item?.sku ?? line?.line_item?.variant_id ?? "UNKNOWN";
    const title = line?.line_item?.title ?? sku;
    const quantity = Number(line?.quantity ?? 0);
    const lineAmount = toNumber(
      line.subtotal_set?.shop_money?.amount ??
        line.total_set?.shop_money?.amount ??
        line.subtotal ??
        0,
    );
    const share = subtotal > 0 ? lineAmount / subtotal : 1 / lineItems.length;
    const convertedLineAmount = amount * share;

    const existing = productMap.get(sku) ?? {
      sku,
      title,
      amount: 0,
      count: 0,
      units: 0,
    };
    existing.amount += convertedLineAmount;
    existing.count += 1;
    existing.units += quantity;
    productMap.set(sku, existing);
  });
}

function normalizeReason(reason) {
  if (!reason) return "Unspecified";
  const trimmed = String(reason).trim();
  return trimmed.length ? trimmed : "Unspecified";
}

function toNumber(value) {
  if (!value && value !== 0) return 0;
  const num = typeof value === "string" ? Number(value) : Number(value);
  return Number.isFinite(num) ? num : 0;
}
