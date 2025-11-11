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
  if (!recipients || !recipients.trim()) {
    throw new Error("At least one recipient is required");
  }

  const normalizedRecipients = recipients
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .join(",");

  if (!normalizedRecipients) {
    throw new Error("Invalid recipient list");
  }

  return prisma.reportSchedule.create({
    data: {
      merchantId,
      frequency,
      channel,
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
