import pkg from "@prisma/client";
import prisma from "../db.server.js";
import { getReportingOverview } from "./reports.server.js";
import { listReportSchedules } from "./report-schedules.server.js";
import { sendDigestEmail } from "./email.server.js";
import { notifyWebhook, sendSlackNotification } from "./notifications.server.js";
import { formatCurrency, formatPercent } from "../utils/formatting.js";
import { logger } from "../utils/logger.server.js";
import { evaluatePerformanceAlerts } from "./alert-triggers.server.js";
import { recordReportScheduleExecution } from "./metrics.server.js";

const { ReportFrequency } = pkg;

const FREQUENCY_INTERVAL_MS = {
  [ReportFrequency.DAILY]: 1000 * 60 * 60 * 24,
  [ReportFrequency.WEEKLY]: 1000 * 60 * 60 * 24 * 7,
};

function createDefaultDependencies() {
  return {
    prisma,
    getReportingOverview,
    listReportSchedules,
    sendDigestEmail,
    notifyWebhook,
    sendSlackNotification,
    evaluatePerformanceAlerts,
    recordReportScheduleExecution,
    logger: logger.child({ service: "report-schedules" }),
  };
}

let dependencies = createDefaultDependencies();

export function setReportScheduleRunnerDependenciesForTests(overrides = {}) {
  dependencies = { ...dependencies, ...overrides };
}

export function resetReportScheduleRunnerDependenciesForTests() {
  dependencies = createDefaultDependencies();
}

export async function runScheduledReports({ now = new Date() } = {}) {
  const schedules = await dependencies.listReportSchedules();
  const dueSchedules = schedules.filter((schedule) => isScheduleDue(schedule, now));
  for (const schedule of dueSchedules) {
    const startedAt = Date.now();
    try {
      const result = await executeSchedule(schedule, now);
      const status = result?.dispatched
        ? "success"
        : result?.reason ?? "delivery_failed";
      dependencies.recordReportScheduleExecution({
        scheduleId: schedule.id,
        merchantId: schedule.merchantId,
        storeId: result?.storeId,
        channel: schedule.channel,
        status,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      dependencies.logger.error("Failed to execute report schedule", {
        scheduleId: schedule.id,
        error: error?.message,
      });
      dependencies.recordReportScheduleExecution({
        scheduleId: schedule.id,
        merchantId: schedule.merchantId,
        channel: schedule.channel,
        status: "error",
        durationMs: Date.now() - startedAt,
        error,
      });
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
  const store = await dependencies.prisma.store.findFirst({
    where: { merchantId: schedule.merchantId },
    orderBy: { installedAt: "asc" },
  });
  if (!store) {
    dependencies.logger.warn("No store found for report schedule", {
      scheduleId: schedule.id,
    });
    return { dispatched: false, reason: "store_missing" };
  }

  const overview = await dependencies.getReportingOverview({
    storeId: store.id,
    rangeDays: 30,
  });

  await dependencies.evaluatePerformanceAlerts({
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
  await dependencies.prisma.reportSchedule.update({
    where: { id: schedule.id },
    data: {
      lastRunAt: now,
      nextRunAt,
    },
  });

  if (!dispatched) {
    dependencies.logger.warn("Scheduled digest delivery failed", {
      scheduleId: schedule.id,
    });
  }
  return { dispatched, storeId: store.id, reason: dispatched ? undefined : "delivery_failed" };
}

async function deliverDigest({ schedule, store, overview, subject, body }) {
  if (schedule.channel === "SLACK") {
    return dependencies.sendSlackNotification({
      merchantId: schedule.merchantId,
      text: `${subject}\n\n${body}`,
      payload: buildSlackDigestPayload(subject, overview),
    });
  }

  if (schedule.channel === "WEBHOOK") {
    const webhookUrl = schedule.settings?.webhookUrl;
    if (!webhookUrl) {
      dependencies.logger.warn("Webhook schedule missing URL", {
        scheduleId: schedule.id,
      });
      return false;
    }
    return dependencies.notifyWebhook({
      url: webhookUrl,
      payload: buildWebhookPayload(store, overview, schedule, subject, body),
      merchantId: schedule.merchantId,
      context: `report_schedule:${schedule.id}`,
    });
  }

  return dependencies.sendDigestEmail({
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
  if (frequency === ReportFrequency.MONTHLY) {
    return addMonthsPreservingDay(basis, 1);
  }
  const interval =
    FREQUENCY_INTERVAL_MS[frequency] ?? FREQUENCY_INTERVAL_MS[ReportFrequency.DAILY];
  return new Date(basis.getTime() + interval);
}

function addMonthsPreservingDay(date, months) {
  const base = new Date(date.getTime());
  const desiredDay = base.getDate();

  const next = new Date(base.getTime());
  next.setHours(base.getHours(), base.getMinutes(), base.getSeconds(), base.getMilliseconds());
  next.setDate(1);
  next.setMonth(next.getMonth() + months);

  const lastDayOfTargetMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(desiredDay, lastDayOfTargetMonth));
  return next;
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
