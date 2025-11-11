import pkg from "@prisma/client";
import prisma from "../db.server";
import { getReportingOverview } from "./reports.server";
import { listReportSchedules } from "./report-schedules.server";
import { sendDigestEmail } from "./email.server";
import { formatCurrency, formatPercent } from "../utils/formatting";

const { ReportFrequency } = pkg;

const FREQUENCY_INTERVAL_MS = {
  [ReportFrequency.DAILY]: 1000 * 60 * 60 * 24,
  [ReportFrequency.WEEKLY]: 1000 * 60 * 60 * 24 * 7,
  [ReportFrequency.MONTHLY]: 1000 * 60 * 60 * 24 * 30,
};

export async function runScheduledReports({ now = new Date() } = {}) {
  const schedules = await listReportSchedules();
  const dueSchedules = schedules.filter((schedule) => isScheduleDue(schedule, now));
  for (const schedule of dueSchedules) {
    try {
      await executeSchedule(schedule, now);
    } catch (error) {
      console.error(`Failed to execute schedule ${schedule.id}`, error);
    }
  }
}

function isScheduleDue(schedule, now) {
  if (!schedule.isActive) return false;
  if (!schedule.nextRunAt) {
    return true;
  }
  return new Date(schedule.nextRunAt) <= now;
}

async function executeSchedule(schedule, now) {
  const store = await prisma.store.findFirst({
    where: { merchantId: schedule.merchantId },
    orderBy: { installedAt: "asc" },
  });
  if (!store) {
    console.warn("No store found for report schedule", schedule.id);
    return;
  }

  const overview = await getReportingOverview({
    storeId: store.id,
    rangeDays: 30,
  });

  const subject = buildSubjectLine(store.shopDomain, overview, schedule);
  const body = buildDigestBody(store, overview);
  const success = await sendDigestEmail({
    recipients: schedule.recipients,
    subject,
    body,
  });

  const nextRunAt = computeNextRun(now, schedule.frequency);
  await prisma.reportSchedule.update({
    where: { id: schedule.id },
    data: {
      lastRunAt: now,
      nextRunAt,
    },
  });

  if (!success) {
    console.warn("Scheduled digest email failed for", schedule.id);
  }
}

function buildSubjectLine(shopDomain, overview, schedule) {
  const prefix = schedule.settings?.subjectPrefix;
  const window = overview.rangeLabel ?? "Last 30 days";
  const base = `${shopDomain} Profit Pulse ${schedule.frequency.toLowerCase()} digest (${window})`;
  return prefix ? `${prefix} ${base}` : base;
}

function buildDigestBody(store, overview) {
  const cardFor = (key) => overview.summaryCards.find((card) => card.key === key);
  const netRevenue = cardFor("netRevenue")?.value ?? 0;
  const adSpend = cardFor("adSpend")?.value ?? 0;
  const netProfit = cardFor("netProfit")?.value ?? 0;
  const profitOnAdSpend = cardFor("profitOnAdSpend")?.value ?? 0;
  const lines = [
    `Store: ${store.shopDomain}`,
    `Period: ${overview.rangeLabel}`,
    `Net revenue: ${formatCurrency(netRevenue, overview.currency)}`,
    `Ad spend: ${formatCurrency(adSpend, overview.currency)}`,
    `Net profit: ${formatCurrency(netProfit, overview.currency)}`,
    `Net profit % of ad spend: ${formatPercent(profitOnAdSpend)}`,
    "",
    "Top products:",
    ...overview.topProducts.slice(0, 3).map(
      (product) =>
        `• ${product.title} (${product.sku}) · Revenue ${formatCurrency(product.revenue, overview.currency)} · Net profit ${formatCurrency(product.netProfit, overview.currency)}`,
    ),
  ];
  return lines.join("\n");
}

function computeNextRun(basis, frequency) {
  const interval = FREQUENCY_INTERVAL_MS[frequency] ?? FREQUENCY_INTERVAL_MS[ReportFrequency.DAILY];
  return new Date(basis.getTime() + interval);
}
