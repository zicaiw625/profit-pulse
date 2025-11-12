import prisma from "../db.server";
import { NOTIFICATION_CHANNEL_TYPES } from "../constants/notificationTypes";

export async function listNotificationChannels(merchantId, type) {
  if (!merchantId) return [];
  const where = { merchantId, isActive: true };
  if (type) {
    where.type = type;
  }
  return prisma.notificationChannel.findMany({
    where,
    orderBy: { createdAt: "asc" },
  });
}

export async function createNotificationChannel({
  merchantId,
  type = NOTIFICATION_CHANNEL_TYPES.SLACK,
  label,
  webhookUrl,
}) {
  if (!merchantId || !webhookUrl) {
    throw new Error("merchantId 和 webhook URL 为必填项");
  }
  if (!Object.values(NOTIFICATION_CHANNEL_TYPES).includes(type)) {
    throw new Error(`不支持的通知渠道类型：${type}`);
  }
  return prisma.notificationChannel.create({
    data: {
      merchantId,
      type,
      label:
        label ||
        (type === NOTIFICATION_CHANNEL_TYPES.TEAMS
          ? "Microsoft Teams"
          : "Slack"),
      config: { webhookUrl },
    },
  });
}

export async function deleteNotificationChannel({ merchantId, channelId }) {
  if (!merchantId || !channelId) {
    throw new Error("删除通知渠道需要 merchantId 和 channelId");
  }
  await prisma.notificationChannel.deleteMany({
    where: { id: channelId, merchantId },
  });
}

function getWebhookUrlFromChannel(channel) {
  return channel.config?.webhookUrl;
}

async function sendToChannel(channel, text, customPayload) {
  const webhookUrl = getWebhookUrlFromChannel(channel);
  if (!webhookUrl) return;
  try {
    const payloadToSend = buildPayload(channel, text, customPayload);
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloadToSend),
    });
  } catch (error) {
    console.error(`Failed to send ${channel.type} notification`, error);
  }
}

export async function sendSlackNotification({ merchantId, text, payload }) {
  if (!merchantId || (!text && !payload)) return false;
  const channels = await listNotificationChannels(merchantId);
  if (!channels.length) return false;

  await Promise.all(
    channels.map((channel) =>
      sendToChannel(channel, text, payload),
    ),
  );
  return true;
}

export function listNotificationTypeOptions() {
  return Object.entries(NOTIFICATION_CHANNEL_TYPES).map(([key, value]) => ({
    value,
    label:
      value === NOTIFICATION_CHANNEL_TYPES.TEAMS
        ? "Microsoft Teams (Webhook)"
        : "Slack (Webhook)",
  }));
}

export { NOTIFICATION_CHANNEL_TYPES };

function buildPayload(channel, text, customPayload) {
  if (customPayload) {
    return customPayload;
  }
  if (channel.type === NOTIFICATION_CHANNEL_TYPES.TEAMS) {
    return { text };
  }
  return { text };
}

export async function notifyWebhook({ url, payload }) {
  if (!url) return false;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    });
    return true;
  } catch (error) {
    console.error("Failed to notify webhook", error);
    return false;
  }
}
