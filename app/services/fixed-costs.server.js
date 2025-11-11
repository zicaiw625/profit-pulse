import prisma from "../db.server";
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

export async function getFixedCostTotal({
  merchantId,
  rangeDays,
  rangeStart,
  rangeEnd,
}) {
  if (!merchantId) return 0;
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

  return costs.reduce((sum, cost) => {
    if (!isActiveDuringRange(cost, start, now)) {
      return sum;
    }
    const amount = Number(cost.amount || 0);
    const cadenceDays = CADENCE_IN_DAYS[cost.cadence] ?? CADENCE_IN_DAYS.MONTHLY;
    const prorated = amount * (days / cadenceDays);
    return sum + prorated;
  }, 0);
}

function isActiveDuringRange(cost, rangeStart, rangeEnd) {
  const start = cost.startedAt ?? rangeStart;
  const end = cost.endedAt ?? rangeEnd;
  return start <= rangeEnd && end >= rangeStart;
}
