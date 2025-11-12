import pkg from "@prisma/client";
import prisma from "../db.server";
import { getReportingOverview } from "./reports.server";
import { listReportSchedules } from "./report-schedules.server";
import { sendDigestEmail } from "./email.server";
import { notifyWebhook, sendSlackNotification } from "./notifications.server";
import { formatCurrency, formatPercent } from "../utils/formatting";
import { evaluatePerformanceAlerts } from "./alert-triggers.server";

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

  await evaluatePerformanceAlerts({
    store,
  });

  const subject = buildSubjectLine(store.shopDomain, overview, schedule);
  const body = buildDigestBody(store, overview);
  const dispatched = await deliverDigest({
    schedule,
    store,
    overview,
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

  if (!dispatched) {
    console.warn("Scheduled digest email failed for", schedule.id);
  }
}

async function deliverDigest({ schedule, store, overview, subject, body }) {
  if (schedule.channel === "SLACK") {
    return sendSlackNotification({
      merchantId: schedule.merchantId,
      text: `${subject}\n\n${body}`,
      payload: buildSlackDigestPayload(subject, overview),
    });
  }

  if (schedule.channel === "WEBHOOK") {
    const webhookUrl = schedule.settings?.webhookUrl;
    if (!webhookUrl) {
      console.warn("Webhook schedule missing URL", schedule.id);
      return false;
    }
    return notifyWebhook({
      url: webhookUrl,
      payload: buildWebhookPayload(store, overview, schedule, subject, body),
    });
  }

  return sendDigestEmail({
    recipients: schedule.recipients,
    subject,
    body,
  });
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

function buildWebhookPayload(store, overview, schedule, subject, body) {
  return {
    store: store.shopDomain,
    channel: schedule.channel,
    subject,
    body,
    period: overview.rangeLabel,
    summary: overview.summaryCards.map((card) => ({
      key: card.key,
      label: card.label,
      value: card.value,
    })),
  };
}

function buildSlackDigestPayload(subject, overview) {
  const header = {
    type: "header",
    text: {
      type: "plain_text",
      text: subject,
      emoji: true,
    },
  };

  const cardBlocks = (overview.summaryCards ?? []).slice(0, 4).map((card) => ({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${card.label}* · ${card.value?.toLocaleString?.() ?? card.value ?? "—"}`,
    },
  }));

  const timeseriesSummary = overview.timeseries?.revenue?.length
    ? [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Revenue trend: ${overview.timeseries.revenue
              .slice(-3)
              .map((point) => `${point.date}:${point.value}`)
              .join(" | ")}`,
          },
        },
      ]
    : [];

  return {
    blocks: [header, ...cardBlocks, ...timeseriesSummary],
  };
}
