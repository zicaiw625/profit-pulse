import pkg from "@prisma/client";
import prisma from "../db.server";

const { ReportFrequency } = pkg;

export async function listReportSchedules(merchantId) {
  if (!merchantId) return [];
  return prisma.reportSchedule.findMany({
    where: { merchantId },
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

  return prisma.reportSchedule.create({
    data: {
      merchantId,
      frequency,
      channel: normalizedChannel,
      recipients: normalizedRecipients,
      settings: settings ?? {},
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
