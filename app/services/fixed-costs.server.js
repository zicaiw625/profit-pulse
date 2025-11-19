// TODO: enable when advanced fixed-cost allocation is production ready.
import prisma from "../db.server.js";
import { shiftDays } from "../utils/dates.server.js";

const CADENCE_IN_DAYS = {
  DAILY: 1,
  WEEKLY: 7,
  MONTHLY: 30,
  QUARTERLY: 90,
  YEARLY: 365,
};

export async function listFixedCosts(merchantId) {
  if (!merchantId) return [];
  const rows = await prisma.fixedCost.findMany({
    where: { merchantId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => ({
    ...row,
    amount: Number(row.amount || 0),
  }));
}

export async function createFixedCost({
  merchantId,
  label,
  amount,
  currency = "USD",
  cadence = "MONTHLY",
  allocation = "REVENUE",
  appliesTo = "ALL",
  notes,
}) {
  if (!merchantId) {
    throw new Error("merchantId is required to create a fixed cost");
  }
  if (!label) {
    throw new Error("Fixed cost label is required");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Fixed cost amount must be a positive number");
  }

  return prisma.fixedCost.create({
    data: {
      merchantId,
      label,
      amount,
      currency,
      cadence,
      allocation,
      appliesTo,
      notes: notes || null,
    },
  });
}

export async function deleteFixedCost({ merchantId, fixedCostId }) {
  if (!merchantId || !fixedCostId) {
    throw new Error("merchantId and fixedCostId are required to delete a fixed cost");
  }

  await prisma.fixedCost.deleteMany({
    where: { id: fixedCostId, merchantId },
  });
}

export async function getFixedCostTotal(options) {
  const summary = await loadFixedCostSummary(options);
  return summary.total;
}

export async function getFixedCostBreakdown({
  merchantId,
  rangeDays,
  rangeStart,
  rangeEnd,
  channelStats = {},
}) {
  if (!merchantId) {
    return { total: 0, allocations: { perChannel: {}, unassigned: 0 }, items: [] };
  }
  const summary = await loadFixedCostSummary({
    merchantId,
    rangeDays,
    rangeStart,
    rangeEnd,
  });
  const allocations = distributeFixedCosts(summary.items, channelStats);
  return {
    total: summary.total,
    allocations,
    items: summary.items,
  };
}

function isActiveDuringRange(cost, rangeStart, rangeEnd) {
  const start = cost.startedAt ?? rangeStart;
  const end = cost.endedAt ?? rangeEnd;
  return start <= rangeEnd && end >= rangeStart;
}

async function loadFixedCostSummary({ merchantId, rangeDays, rangeStart, rangeEnd }) {
  if (!merchantId) {
    return { total: 0, items: [] };
  }
  const now = rangeEnd ?? new Date();
  const start = rangeStart ?? shiftDays(now, -(Math.max(rangeDays ?? 30, 1) - 1));
  const costs = await prisma.fixedCost.findMany({
    where: {
      merchantId,
      startedAt: { lte: now },
      OR: [{ endedAt: null }, { endedAt: { gte: start } }],
    },
  });
  const days = rangeDays ?? Math.ceil((now - start) / (1000 * 60 * 60 * 24)) + 1;

  const items = [];
  let total = 0;
  for (const cost of costs) {
    if (!isActiveDuringRange(cost, start, now)) {
      continue;
    }
    const amount = Number(cost.amount || 0);
    const cadenceDays = CADENCE_IN_DAYS[cost.cadence] ?? CADENCE_IN_DAYS.MONTHLY;
    const prorated = amount * (days / cadenceDays);
    total += prorated;
    items.push({ cost, amount: prorated });
  }

  return { total, items };
}

function distributeFixedCosts(entries, channelStats = {}) {
  const perChannel = {};
  let unassigned = 0;
  const totals = Object.values(channelStats).reduce(
    (acc, stats) => {
      acc.revenue += Number(stats.revenue || 0);
      acc.orders += Number(stats.orders || 0);
      return acc;
    },
    { revenue: 0, orders: 0 },
  );

  entries.forEach((entry) => {
    const rule = (entry.cost.allocation || "REVENUE").toUpperCase();
    if (rule.startsWith("CHANNEL:")) {
      const channel = rule.split(":")[1] || "CHANNEL";
      perChannel[channel] = (perChannel[channel] ?? 0) + entry.amount;
      return;
    }

    const basis = rule === "ORDERS" ? totals.orders : totals.revenue;
    if (!basis || basis <= 0) {
      unassigned += entry.amount;
      return;
    }
    let allocated = 0;
    Object.entries(channelStats).forEach(([channel, stats]) => {
      const numerator = rule === "ORDERS" ? Number(stats.orders || 0) : Number(stats.revenue || 0);
      if (!numerator) {
        return;
      }
      const share = (entry.amount * numerator) / basis;
      if (!Number.isFinite(share) || share <= 0) {
        return;
      }
      perChannel[channel] = (perChannel[channel] ?? 0) + share;
      allocated += share;
    });
    const remainder = entry.amount - allocated;
    if (remainder > 0) {
      unassigned += remainder;
    }
  });

  return { perChannel, unassigned };
}
