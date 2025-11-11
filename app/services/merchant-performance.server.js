import prisma from "../db.server";
import { getExchangeRate } from "./exchange-rates.server";
import { startOfDay, shiftDays } from "../utils/dates.server.js";

export async function getMerchantPerformanceSummary({
  merchantId,
  rangeDays = 30,
}) {
  if (!merchantId) {
    return null;
  }

  const merchant = await prisma.merchantAccount.findUnique({
    where: { id: merchantId },
    include: { stores: true },
  });
  if (!merchant) {
    return null;
  }

  const stores = merchant.stores ?? [];
  const masterCurrency = merchant.primaryCurrency ?? "USD";
  const rangeEnd = startOfDay(new Date());
  const rangeStart = shiftDays(
    rangeEnd,
    -(Math.max(rangeDays ?? 30, 1) - 1),
  );

  if (!stores.length) {
    return {
      currency: masterCurrency,
      range: { start: rangeStart, end: rangeEnd },
      storeCount: 0,
      summary: buildEmptySummary(),
    };
  }

  const metricsRows = await prisma.dailyMetric.groupBy({
    by: ["storeId"],
    where: {
      storeId: { in: stores.map((store) => store.id) },
      date: { gte: rangeStart, lte: rangeEnd },
    },
    _sum: {
      revenue: true,
      netProfit: true,
      adSpend: true,
      orders: true,
      refundAmount: true,
      refunds: true,
    },
  });

  const storeCurrencyById = new Map(
    stores.map((store) => [store.id, store.currency ?? masterCurrency]),
  );

  const rateCache = new Map();

  let revenue = 0;
  let netProfit = 0;
  let adSpend = 0;
  let orders = 0;
  let refundAmount = 0;
  let refunds = 0;

  for (const row of metricsRows) {
    const storeCurrency = storeCurrencyById.get(row.storeId) ?? masterCurrency;
    const rateKey = `${storeCurrency}|${masterCurrency}`;
    let conversionRate = rateCache.get(rateKey);
    if (conversionRate === undefined) {
      conversionRate = await getExchangeRate({
        base: storeCurrency,
        quote: masterCurrency,
      });
      rateCache.set(rateKey, conversionRate);
    }

    const sums = row._sum ?? {};
    revenue += toNumber(sums.revenue) * conversionRate;
    netProfit += toNumber(sums.netProfit) * conversionRate;
    adSpend += toNumber(sums.adSpend) * conversionRate;
    refundAmount += toNumber(sums.refundAmount) * conversionRate;
    orders += toNumber(sums.orders);
    refunds += toNumber(sums.refunds);
  }

  const refundRate = orders > 0 ? refunds / orders : 0;

  return {
    currency: masterCurrency,
    range: { start: rangeStart, end: rangeEnd },
    storeCount: stores.length,
    summary: {
      revenue,
      netProfit,
      adSpend,
      refundAmount,
      orders,
      refunds,
      refundRate,
    },
  };
}

function buildEmptySummary() {
  return {
    revenue: 0,
    netProfit: 0,
    adSpend: 0,
    refundAmount: 0,
    orders: 0,
    refunds: 0,
    refundRate: 0,
  };
}

function toNumber(value) {
  if (!value && value !== 0) {
    return 0;
  }
  const number = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(number) ? number : 0;
}
