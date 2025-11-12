import pkg from "@prisma/client";
import prisma from "../db.server";
import { sendSlackNotification } from "./notifications.server";
import { shiftDays, formatDateKey } from "../utils/dates.server.js";
import { formatCurrency } from "../utils/formatting";

const { ReconciliationIssueType, IssueStatus } = pkg;
const DEFAULT_RANGE_DAYS = 14;

export async function getReconciliationSnapshot({
  storeId,
  rangeDays = DEFAULT_RANGE_DAYS,
}) {
  if (!storeId) {
    throw new Error("storeId is required for reconciliation snapshot");
  }

  const since = shiftDays(new Date(), -(Math.max(rangeDays, 1) - 1));
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
  };
}

export async function detectPaymentDiscrepancies({ storeId }) {
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
        gte: shiftDays(new Date(), -30),
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
        formatDateKey(group.processedAt) === formatDateKey(payout.payoutDate),
    );
    const orderTotal = dayOrders.reduce(
      (sum, group) => sum + Number(group._sum.total || 0),
      0,
    );
    const netAmount = Number(payout.netAmount || 0);
    const diff = Math.abs(orderTotal - netAmount);
    if (diff > 50) {
      issues.push({
        storeId,
        issueType: ReconciliationIssueType.SHOPIFY_VS_PAYMENT,
        issueDate: payout.payoutDate,
        amountDelta: diff,
        currency: payout.currency,
        status: IssueStatus.OPEN,
        details: {
          message: `Orders total ${formatCurrency(orderTotal)} vs payout ${formatCurrency(netAmount)}`,
          channel: "Shopify Payments",
          payoutId: payout.payoutId,
        },
      });
    }
  });

  await persistIssues(storeId, issues, ReconciliationIssueType.SHOPIFY_VS_PAYMENT);
  return issues;
}

export async function detectAdConversionAnomalies({ storeId }) {
  const adSpend = await prisma.adSpendRecord.groupBy({
    by: ["provider", "date"],
    where: {
      storeId,
      date: { gte: shiftDays(new Date(), -14) },
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
      processedAt: { gte: shiftDays(new Date(), -14) },
    },
    _count: { _all: true },
  });

  const orderCountByDay = ordersByDay.reduce((map, group) => {
    map.set(formatDateKey(group.processedAt), group._count._all);
    return map;
  }, new Map());

  const issues = [];

  adSpend.forEach((row) => {
    const dateKey = formatDateKey(row.date);
    const conversions = Number(row._sum.conversions || 0);
    const orders = orderCountByDay.get(dateKey) ?? 0;
    if (conversions > orders * 1.5) {
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
    } else if (orders > 5 && conversions === 0 && Number(row._sum.spend || 0) > 200) {
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
  await detectPaymentDiscrepancies({ storeId });
  await detectAdConversionAnomalies({ storeId });
}

async function persistIssues(storeId, issues, issueType) {
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

  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { merchantId: true, shopDomain: true } });
  if (store?.merchantId) {
    await sendSlackNotification({
      merchantId: store.merchantId,
      text: formatSlackAlert(issueType, issues, store.shopDomain),
    });
  }
}

function formatSlackAlert(issueType, issues, shopDomain) {
  const title = mapTitle(issueType);
  const lines = issues.map((issue) => `• ${issue.details?.message ?? formatIssueDescription(issue)}`);
  return `⚠️ ${shopDomain ?? "Store"} ${title} detected (${issues.length} issue${issues.length > 1 ? "s" : ""}):\n${lines.join("\n")}`;
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
