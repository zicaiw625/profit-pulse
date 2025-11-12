import prisma from "../db.server";
import { getExchangeRate } from "./exchange-rates.server";
import { startOfDay } from "../utils/dates.server.js";

export async function getAccountingMonthlySummary({
  storeId,
  months = 6,
}) {
  if (!storeId) {
    throw new Error("storeId is required for accounting exports");
  }

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: { merchant: true },
  });
  if (!store) {
    throw new Error("Store not found");
  }

  const masterCurrency = store.merchant?.primaryCurrency ?? store.currency ?? "USD";
  const storeCurrency = store.currency ?? masterCurrency;
  const end = startOfDay(new Date());
  const start = new Date(end);
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - Math.max(months, 1) + 1);

  const metrics = await prisma.dailyMetric.findMany({
    where: {
      storeId,
      channel: "TOTAL",
      productSku: null,
      date: {
        gte: start,
        lte: end,
      },
    },
    orderBy: { date: "asc" },
  });

  const conversionRate = await getExchangeRate({
    base: storeCurrency,
    quote: masterCurrency,
  });

  const monthlyMap = new Map();
  metrics.forEach((metric) => {
    if (!metric) return;
    const key = `${metric.date.getUTCFullYear()}-${String(metric.date.getUTCMonth() + 1).padStart(2, "0")}`;
    const existing = monthlyMap.get(key) ?? {
      month: key,
      revenue: 0,
      cogs: 0,
      shippingCost: 0,
      paymentFees: 0,
      refundAmount: 0,
      adSpend: 0,
      netProfit: 0,
      orders: 0,
    };
    existing.revenue += toNumber(metric.revenue) * conversionRate;
    existing.cogs += toNumber(metric.cogs) * conversionRate;
    existing.shippingCost += toNumber(metric.shippingCost) * conversionRate;
    existing.paymentFees += toNumber(metric.paymentFees) * conversionRate;
    existing.refundAmount += toNumber(metric.refundAmount) * conversionRate;
    existing.adSpend += toNumber(metric.adSpend) * conversionRate;
    existing.netProfit += toNumber(metric.netProfit) * conversionRate;
    existing.orders += toNumber(metric.orders);
    monthlyMap.set(key, existing);
  });

  const rows = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));
  return {
    rows,
    currency: masterCurrency,
    range: { start, end },
  };
}

function toNumber(value) {
  if (value === null || value === undefined) return 0;
  const number = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(number) ? number : 0;
}
