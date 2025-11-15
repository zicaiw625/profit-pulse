import pkg from "@prisma/client";
import prisma from "../db.server";
import { isAllowedWebhookUrl } from "./notifications.server";

const { ReportFrequency } = pkg;

export async function listReportSchedules(merchantId) {
  const where = merchantId ? { merchantId } : undefined;
  return prisma.reportSchedule.findMany({
    where,
    orderBy: [
      { frequency: "asc" },
      { createdAt: "asc" },
    ],
  });
}

export async function createReportSchedule({
  merchantId,
  frequency = ReportFrequency.DAILY,
  channel = "EMAIL",
  recipients,
  settings = {},
}) {
  if (!merchantId) {
    throw new Error("merchantId is required to create a report schedule");
  }

  const normalizedChannel = (channel ?? "EMAIL").toUpperCase();
  let normalizedRecipients = "";

  if (normalizedChannel === "EMAIL") {
    if (!recipients || !recipients.trim()) {
      throw new Error("At least one recipient is required");
    }
    normalizedRecipients = recipients
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .join(",");

    if (!normalizedRecipients) {
      throw new Error("Invalid recipient list");
    }
  } else {
    normalizedRecipients = recipients?.toString().trim() ?? "";
  }

  const sanitizedSettings = { ...(settings ?? {}) };

  if (normalizedChannel === "WEBHOOK") {
    const providedUrl = sanitizedSettings.webhookUrl ?? "";
    const normalizedWebhookUrl = providedUrl.toString().trim();

    if (!normalizedWebhookUrl) {
      throw new Error("Webhook URL is required for webhook schedules");
    }

    if (!isAllowedWebhookUrl(normalizedWebhookUrl)) {
      throw new Error(
        "Webhook URL must be HTTPS and point to an allowed Slack/Teams/Zapier/Make domain.",
      );
    }

    sanitizedSettings.webhookUrl = normalizedWebhookUrl;
  }

  return prisma.reportSchedule.create({
    data: {
      merchantId,
      frequency,
      channel: normalizedChannel,
      recipients: normalizedRecipients,
      settings: sanitizedSettings,
    },
  });
}

export async function deleteReportSchedule({ merchantId, scheduleId }) {
  if (!merchantId || !scheduleId) {
    throw new Error("merchantId and scheduleId are required to delete a report schedule");
  }
  await prisma.reportSchedule.deleteMany({
    where: {
      id: scheduleId,
      merchantId,
    },
  });
}
