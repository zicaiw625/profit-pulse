import defaultPrisma from "../db.server.js";
import { sendSlackNotification as defaultSendSlackNotification } from "./notifications.server.js";
import { startOfDay, resolveTimezone } from "../utils/dates.server.js";

let prisma = defaultPrisma;
let notifySlack = defaultSendSlackNotification;

export function setAlertsDependenciesForTests({
  prisma: prismaOverride,
  sendSlackNotification,
} = {}) {
  prisma = prismaOverride || defaultPrisma;
  notifySlack = sendSlackNotification || defaultSendSlackNotification;
}

export async function checkNetProfitAlert({ store, netProfitAfterFixed }) {
  if (!store?.merchantId || typeof netProfitAfterFixed !== "number") return;
  if (netProfitAfterFixed >= 0) {
    return;
  }

  const timezone = resolveTimezone({ store });
  const todayKey = startOfDay(new Date(), { timezone });
  if (
    store.lastNetLossAlertAt &&
    startOfDay(store.lastNetLossAlertAt, { timezone }) >= todayKey
  ) {
    return;
  }

  const text = `🚨 Net profit after fixed costs is negative for ${store.shopDomain ?? "your store"}. Please investigate ad spend, fees, or costs.`;
  const sent = await notifySlack({ merchantId: store.merchantId, text });
  if (sent) {
    await prisma.store.update({
      where: { id: store.id },
      data: { lastNetLossAlertAt: new Date() },
    });
  }
}

export async function checkRefundSpikeAlert({
  store,
  refundRate,
  refundCount,
  orderCount,
}) {
  if (!store?.merchantId) return;
  if (!orderCount || orderCount < 20) return;
  if (!refundCount || refundCount < 3) return;
  if (refundRate < 0.05) return;

  const timezone = resolveTimezone({ store });
  const todayKey = startOfDay(new Date(), { timezone });
  if (
    store.lastRefundSpikeAlertAt &&
    startOfDay(store.lastRefundSpikeAlertAt, { timezone }) >= todayKey
  ) {
    return;
  }

  const percent = formatPercent(refundRate);
  const text = `⚠️ Refund rate jumped to ${percent} (${refundCount} of ${orderCount} orders). Review recent product or fulfillment issues.`;

  const sent = await notifySlack({
    merchantId: store.merchantId,
    text,
  });

  if (sent) {
    await prisma.store.update({
      where: { id: store.id },
      data: { lastRefundSpikeAlertAt: new Date() },
    });
  }
}


function formatPercent(value) {
  return `${(Number(value ?? 0) * 100).toFixed(1)}%`;
}
