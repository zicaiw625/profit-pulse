import pkg from "@prisma/client";
import defaultPrisma from "../db.server.js";
import {
  DEFAULT_AD_CONVERSION_MULTIPLE,
  DEFAULT_AD_SPEND_HIGH,
  DEFAULT_MIN_ORDERS_FOR_AD_CHECK,
  DEFAULT_PAYMENT_DIFF_THRESHOLD,
  DEFAULT_PAYMENT_PERCENT_THRESHOLD,
} from "../config/reconciliation.js";
import {
  startOfDay,
  shiftDays,
  formatDateKey,
  resolveTimezone,
} from "../utils/dates.server.js";
import { formatCurrency } from "../utils/formatting.js";
import { createScopedLogger } from "../utils/logger.server.js";

const { ReconciliationIssueType, IssueStatus } = pkg;
const DEFAULT_RANGE_DAYS = 14;
const reconciliationLogger = createScopedLogger({ service: "reconciliation" });

const defaultDependencies = {
  prismaClient: defaultPrisma,
};

let reconciliationDependencies = { ...defaultDependencies };

export function setReconciliationDependenciesForTests(overrides = {}) {
  reconciliationDependencies = { ...reconciliationDependencies, ...overrides };
}

export function resetReconciliationDependenciesForTests() {
  reconciliationDependencies = { ...defaultDependencies };
}

export async function getReconciliationSnapshot({
  storeId,
  rangeDays = DEFAULT_RANGE_DAYS,
}) {
  const prisma = getPrisma();
  if (!storeId) {
    throw new Error("storeId is required for reconciliation snapshot");
  }

  const timezone = await getStoreTimezone(storeId);
  const today = startOfDay(new Date(), { timezone });
  const since = shiftDays(today, -(Math.max(rangeDays, 1) - 1), { timezone });
  const issues = await prisma.reconciliationIssue.findMany({
    where: {
      storeId,
      issueDate: { gte: since },
    },
    orderBy: { issueDate: "desc" },
    take: 25,
  });

  const summary = summarizeIssues(issues);

  return {
    summary,
    issues: issues.map((issue) => ({
      id: issue.id,
      type: issue.issueType,
      channel: issue.details?.channel ?? issue.issueType,
      orderNumber: issue.details?.orderNumber ?? issue.orderId ?? "—",
      description:
        issue.details?.message ||
        issue.details?.reason ||
        formatIssueDescription(issue),
      detectedAt: issue.issueDate,
      status: issue.status,
      amountDelta: issue.amountDelta,
    })),
    timezone,
  };
}

export async function detectPaymentDiscrepancies({ storeId, timezone }) {
  const prisma = getPrisma();
  const tz = timezone ?? (await getStoreTimezone(storeId));
  const amountThreshold = DEFAULT_PAYMENT_DIFF_THRESHOLD;
  const percentThreshold = DEFAULT_PAYMENT_PERCENT_THRESHOLD;
  const payouts = await prisma.paymentPayout.findMany({
    where: { storeId },
    orderBy: { payoutDate: "desc" },
    take: 10,
  });

  const ordersByDate = await prisma.order.groupBy({
    by: ["processedAt"],
    where: {
      storeId,
      processedAt: {
        gte: shiftDays(startOfDay(new Date(), { timezone: tz }), -30, {
          timezone: tz,
        }),
      },
    },
    _sum: {
      total: true,
    },
  });

  const issues = [];

  payouts.forEach((payout) => {
    const dayOrders = ordersByDate.filter(
      (group) =>
        formatDateKey(group.processedAt, { timezone: tz }) ===
        formatDateKey(payout.payoutDate, { timezone: tz }),
    );
    const orderTotal = dayOrders.reduce(
      (sum, group) => sum + Number(group._sum.total || 0),
      0,
    );
    const netAmount = Number(payout.netAmount || 0);
    const diff = Math.abs(orderTotal - netAmount);
    const percentDiff = orderTotal > 0 ? diff / orderTotal : 0;
    if (diff > amountThreshold || percentDiff > percentThreshold) {
      issues.push({
        storeId,
        issueType: ReconciliationIssueType.SHOPIFY_VS_PAYMENT,
        issueDate: payout.payoutDate,
        amountDelta: diff,
        currency: payout.currency,
        status: IssueStatus.OPEN,
        details: {
          message: `Orders total ${formatCurrency(orderTotal)} vs payout ${formatCurrency(netAmount)} (>${percentThreshold * 100}% or ${formatCurrency(amountThreshold, payout.currency)})`,
          channel: "Shopify Payments",
          payoutId: payout.payoutId,
        },
      });
    }
  });

  await persistIssues(storeId, issues, ReconciliationIssueType.SHOPIFY_VS_PAYMENT);
  return issues;
}

export async function detectAdConversionAnomalies({ storeId, timezone }) {
  const prisma = getPrisma();
  const tz = timezone ?? (await getStoreTimezone(storeId));
  const conversionMultiple = DEFAULT_AD_CONVERSION_MULTIPLE;
  const spendThreshold = DEFAULT_AD_SPEND_HIGH;
  const adSpend = await prisma.adSpendRecord.groupBy({
    by: ["provider", "date"],
    where: {
      storeId,
      date: {
        gte: shiftDays(startOfDay(new Date(), { timezone: tz }), -14, {
          timezone: tz,
        }),
      },
    },
    _sum: {
      conversions: true,
      spend: true,
    },
  });

  const ordersByDay = await prisma.order.groupBy({
    by: ["processedAt"],
    where: {
      storeId,
      processedAt: {
        gte: shiftDays(startOfDay(new Date(), { timezone: tz }), -14, {
          timezone: tz,
        }),
      },
    },
    _count: { _all: true },
  });

  const orderCountByDay = ordersByDay.reduce((map, group) => {
    map.set(formatDateKey(group.processedAt, { timezone: tz }), group._count._all);
    return map;
  }, new Map());

  const issues = [];

  adSpend.forEach((row) => {
    const dateKey = formatDateKey(row.date, { timezone: tz });
    const conversions = Number(row._sum.conversions || 0);
    const orders = orderCountByDay.get(dateKey) ?? 0;
    if (conversions > orders * conversionMultiple) {
      issues.push({
        storeId,
        issueType: ReconciliationIssueType.SHOPIFY_VS_ADS,
        issueDate: row.date,
        amountDelta: conversions - orders,
        details: {
          message: `${row.provider} conversions (${conversions}) exceed Shopify orders (${orders}) on ${dateKey}`,
          channel: row.provider,
        },
      });
    } else if (
      orders > DEFAULT_MIN_ORDERS_FOR_AD_CHECK &&
      conversions === 0 &&
      Number(row._sum.spend || 0) > spendThreshold
    ) {
      issues.push({
        storeId,
        issueType: ReconciliationIssueType.SHOPIFY_VS_ADS,
        issueDate: row.date,
        amountDelta: Number(row._sum.spend || 0),
        details: {
          message: `${row.provider} spent ${formatCurrency(row._sum.spend)} with no attributed conversions`,
          channel: row.provider,
        },
      });
    }
  });

  await persistIssues(storeId, issues, ReconciliationIssueType.SHOPIFY_VS_ADS);
  return issues;
}

export async function runReconciliationChecks({ storeId }) {
  const timezone = await getStoreTimezone(storeId);
  const [paymentIssues, adIssues] = await Promise.all([
    detectPaymentDiscrepancies({ storeId, timezone }),
    detectAdConversionAnomalies({ storeId, timezone }),
  ]);
  reconciliationLogger.info("reconciliation_run", {
    storeId,
    paymentIssues: paymentIssues.length,
    adIssues: adIssues.length,
  });
}

async function persistIssues(storeId, issues, issueType) {
  const prisma = getPrisma();
  // Mark previous open issues for this type as resolved if they weren't detected again.
  await prisma.reconciliationIssue.updateMany({
    where: {
      storeId,
      issueType,
      status: IssueStatus.OPEN,
    },
    data: {
      status: IssueStatus.RESOLVED,
      resolvedAt: new Date(),
    },
  });

  if (!issues.length) {
    return;
  }

  await prisma.reconciliationIssue.createMany({
    data: issues.map((issue) => ({
      ...issue,
      storeId,
      issueType,
    })),
  });

}

async function getStoreTimezone(storeId) {
  const prisma = getPrisma();
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: { merchant: true },
  });
  if (!store) {
    return "UTC";
  }
  return resolveTimezone({ store });
}

function summarizeIssues(issues) {
  const map = {};
  issues.forEach((issue) => {
    const key = issue.issueType;
    if (!map[key]) {
      map[key] = {
        issueType: key,
        issues: 0,
        amountDelta: 0,
      };
    }
    map[key].issues += 1;
    map[key].amountDelta += Number(issue.amountDelta || 0);
  });

  return Object.values(map).map((item) => ({
    title: mapTitle(item.issueType),
    issues: item.issues,
    amountDelta: item.amountDelta,
    status: item.amountDelta > 0 ? "attention" : "warning",
  }));
}

function formatIssueDescription(issue) {
  const type = mapTitle(issue.issueType);
  const amount = formatCurrency(issue.amountDelta);
  return `${type} variance ${amount}`;
}

function mapTitle(issueType) {
  switch (issueType) {
    case ReconciliationIssueType.SHOPIFY_VS_PAYMENT:
      return "Shopify ↔ Payments";
    case ReconciliationIssueType.SHOPIFY_VS_ADS:
      return "Shopify ↔ Ads";
    default:
      return issueType?.replace(/_/g, " ") ?? "Reconciliation";
  }
}

function getPrisma() {
  return reconciliationDependencies.prismaClient;
}
