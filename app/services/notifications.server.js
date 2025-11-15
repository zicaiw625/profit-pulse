import prisma from "../db.server.js";
import { NOTIFICATION_CHANNEL_TYPES } from "../constants/notificationTypes.js";
import { logger } from "../utils/logger.server.js";
import { logAuditEvent } from "./audit.server.js";

const WEBHOOK_TIMEOUT_MS = 5000;
const WEBHOOK_MAX_ATTEMPTS = 3;

const BUILTIN_EXACT_HOSTS = ["hooks.slack.com", "hooks.zapier.com", "hooks.make.com"];
const BUILTIN_SUFFIX_HOSTS = ["office.com"];

const EXACT_ALLOWED_HOSTS = new Set(BUILTIN_EXACT_HOSTS);
const WILDCARD_HOST_SUFFIXES = new Set(BUILTIN_SUFFIX_HOSTS);

function resetAllowlistToDefaults() {
  EXACT_ALLOWED_HOSTS.clear();
  BUILTIN_EXACT_HOSTS.forEach((host) => EXACT_ALLOWED_HOSTS.add(host));
  WILDCARD_HOST_SUFFIXES.clear();
  BUILTIN_SUFFIX_HOSTS.forEach((host) => WILDCARD_HOST_SUFFIXES.add(host));
}

function stripTrailingDots(value) {
  return value?.replace(/\.+$/, "") ?? "";
}

function normalizeAllowlistEntry(entry) {
  if (!entry) return null;
  let normalized = String(entry).trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.startsWith("https://") || normalized.startsWith("http://")) {
    try {
      const url = new URL(normalized);
      normalized = url.hostname.toLowerCase();
    } catch {
      normalized = normalized.replace(/^https?:\/\//, "");
    }
  }

  normalized = normalized.split("/")[0];
  normalized = normalized.split(":")[0];

  if (!normalized) return null;

  if (normalized.startsWith("*.")) {
    return { type: "suffix", value: stripTrailingDots(normalized.slice(2)) };
  }
  if (normalized.startsWith(".")) {
    return { type: "suffix", value: stripTrailingDots(normalized.slice(1)) };
  }
  if (normalized.endsWith(".*")) {
    return { type: "suffix", value: stripTrailingDots(normalized.slice(0, -2)) };
  }
  if (normalized.endsWith("*")) {
    return { type: "suffix", value: stripTrailingDots(normalized.slice(0, -1)) };
  }

  const exact = stripTrailingDots(normalized);
  if (!exact) {
    return null;
  }
  return { type: "exact", value: exact };
}

function applyAllowlistOverrides(rawEntries) {
  if (!rawEntries) return;
  const entries = Array.isArray(rawEntries)
    ? rawEntries
    : String(rawEntries)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

  for (const entry of entries) {
    const normalized = normalizeAllowlistEntry(entry);
    if (!normalized?.value) continue;
    if (normalized.type === "suffix") {
      WILDCARD_HOST_SUFFIXES.add(normalized.value);
    } else {
      EXACT_ALLOWED_HOSTS.add(normalized.value);
    }
  }
}

resetAllowlistToDefaults();
applyAllowlistOverrides(process.env.WEBHOOK_HOST_ALLOWLIST);

let auditLogger = logAuditEvent;
let notificationLogger = logger.child({ service: "notifications" });

export function setNotificationAuditLoggerForTests(logger) {
  auditLogger = typeof logger === "function" ? logger : logAuditEvent;
}

export function setNotificationLoggerForTests(testLogger) {
  notificationLogger = testLogger || logger.child({ service: "notifications", test: true });
}

export function setWebhookAllowlistForTests(entries) {
  resetAllowlistToDefaults();
  applyAllowlistOverrides(entries);
}

export function resetWebhookAllowlistForTests() {
  resetAllowlistToDefaults();
  applyAllowlistOverrides(process.env.WEBHOOK_HOST_ALLOWLIST);
}

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
  const normalizedUrl = webhookUrl.trim();
  if (!isAllowedWebhookUrl(normalizedUrl)) {
    throw new Error(
      "Webhook URL 必须为 https 并指向经过允许的 Slack/Teams/Zapier/Make 域名或 `WEBHOOK_HOST_ALLOWLIST` 中配置的域名。",
    );
  }
  return prisma.notificationChannel.create({
    data: {
      merchantId,
      type,
      label:
        label ||
        (type === NOTIFICATION_CHANNEL_TYPES.TEAMS
          ? "Microsoft Teams"
          : type === NOTIFICATION_CHANNEL_TYPES.ZAPIER
            ? "Zapier Webhook"
            : type === NOTIFICATION_CHANNEL_TYPES.MAKE
              ? "Make Webhook"
              : "Slack"),
      config: { webhookUrl: normalizedUrl },
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
  return channel.config?.webhookUrl?.trim();
}

async function sendToChannel(channel, text, customPayload) {
  const webhookUrl = getWebhookUrlFromChannel(channel);
  if (!webhookUrl) return false;
  if (!isAllowedWebhookUrl(webhookUrl)) {
    await auditLogger({
      merchantId: channel.merchantId,
      action: "notification.webhook_blocked",
      details: `Blocked webhook for channel ${channel.id} (${channel.type}) to ${webhookUrl}`,
    });
    return false;
  }
  const payloadToSend = buildPayload(channel, text, customPayload);
  const result = await postJsonWithRetry(webhookUrl, payloadToSend);
  if (!result.ok) {
    await auditLogger({
      merchantId: channel.merchantId,
      action: "notification.webhook_failed",
      details: buildFailureDetails(channel, webhookUrl, result),
    });
  }
  return result.ok;
}

export async function sendSlackNotification({ merchantId, text, payload }) {
  if (!merchantId || (!text && !payload)) return false;
  const channels = await listNotificationChannels(merchantId);
  if (!channels.length) return false;

  const results = await Promise.all(
    channels.map((channel) => sendToChannel(channel, text, payload)),
  );
  return results.some(Boolean);
}

export function listNotificationTypeOptions() {
  return [
    { value: NOTIFICATION_CHANNEL_TYPES.SLACK, label: "Slack (Webhook)" },
    { value: NOTIFICATION_CHANNEL_TYPES.TEAMS, label: "Microsoft Teams (Webhook)" },
    { value: NOTIFICATION_CHANNEL_TYPES.ZAPIER, label: "Zapier (Webhook)" },
    { value: NOTIFICATION_CHANNEL_TYPES.MAKE, label: "Make/Integromat (Webhook)" },
  ];
}

export { NOTIFICATION_CHANNEL_TYPES };

function buildPayload(channel, text, customPayload) {
  if (customPayload) {
    return customPayload;
  }
  if (channel.type === NOTIFICATION_CHANNEL_TYPES.TEAMS) {
    return { text };
  }
  if (
    channel.type === NOTIFICATION_CHANNEL_TYPES.ZAPIER ||
    channel.type === NOTIFICATION_CHANNEL_TYPES.MAKE
  ) {
    return {
      type: "profit-pulse-event",
      message: text,
      timestamp: new Date().toISOString(),
    };
  }
  return { text };
}

export async function notifyWebhook({
  url,
  payload,
  merchantId,
  context,
}) {
  if (!url) return false;
  const normalizedUrl = url.trim();
  if (!isAllowedWebhookUrl(normalizedUrl)) {
    notificationLogger.warn("Blocked webhook URL", {
      url: normalizedUrl,
      merchantId,
      context,
    });
    if (merchantId) {
      await auditLogger({
        merchantId,
        action: "notification.webhook_blocked",
        details: `Blocked webhook dispatch to ${normalizedUrl} (${context ?? "unspecified"})`,
      });
    }
    return false;
  }
  const result = await postJsonWithRetry(normalizedUrl, payload ?? {});
  if (!result.ok) {
    notificationLogger.error("Failed to notify webhook", {
      url: normalizedUrl,
      status: result.status,
      error: result.error,
    });
  }
  return result.ok;
}

export function isAllowedWebhookUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (EXACT_ALLOWED_HOSTS.has(host)) {
    return true;
  }
  for (const suffix of WILDCARD_HOST_SUFFIXES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) {
      return true;
    }
  }
  return false;
}

function shouldRetryStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

async function postJsonWithRetry(url, payload) {
  let lastError;
  let lastStatus;
  for (let attempt = 1; attempt <= WEBHOOK_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (response.ok) {
        return { ok: true };
      }
      lastStatus = response.status;
      if (!shouldRetryStatus(response.status) || attempt === WEBHOOK_MAX_ATTEMPTS) {
        return { ok: false, status: response.status };
      }
    } catch (error) {
      lastError = error;
      if (attempt === WEBHOOK_MAX_ATTEMPTS) {
        return { ok: false, error: error?.message };
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
  return {
    ok: false,
    status: lastStatus,
    error: lastError?.message,
  };
}

function buildFailureDetails(channel, webhookUrl, result) {
  const base = `Failed webhook for channel ${channel.id} (${channel.type}) to ${webhookUrl}`;
  const statusPart = result.status ? ` (status ${result.status})` : "";
  const errorPart = result.error ? `: ${result.error}` : "";
  return `${base}${statusPart}${errorPart}`;
}
