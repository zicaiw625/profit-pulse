import prisma from "../db.server.js";
import {
  resolveTimezone,
  startOfDay,
  shiftDays,
} from "../utils/dates.server.js";

const DEFAULT_RANGE_DAYS = 14;

export async function getOrderProfitTable({
  store,
  rangeStart,
  rangeEnd,
  includeRefunds = true,
  limit = 200,
}) {
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
    return {
      sku: row.sku ?? "Unknown SKU",
      title: row.title ?? row.sku ?? "Unknown SKU",
      units: Number(row._sum.quantity || 0),
      revenue,
      cogs,
      netProfit,
      margin,
    };
  });

  const sorter = buildProductSorter(sortBy);
  return entries.sort(sorter).slice(0, 100);
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
