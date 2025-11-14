import { Buffer } from "node:buffer";
import { useState } from "react";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
  useSearchParams,
} from "react-router";
import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getAccountSettings } from "../services/settings.server";
import { importSkuCostsFromCsv, seedDemoCostConfiguration } from "../services/costs.server";
import {
  buildDemoOrder,
  processShopifyOrder,
} from "../services/profit-engine.server";
import {
  requestPlanChange,
  syncSubscriptionFromShopify,
} from "../services/billing.server";
import { syncAdProvider } from "../services/sync/ad-spend.server";
import {
  syncShopifyPayments,
  syncPaypalPayments,
  syncStripePayments,
  syncKlarnaPayments,
} from "../services/sync/payment-payouts.server";
import { syncShopifyOrders } from "../services/sync/shopify-orders.server";
import {
  findTeamMemberByEmail,
  inviteTeamMember,
  updateTeamMemberRole,
  removeTeamMember,
} from "../services/team.server";
import { isPlanLimitError } from "../errors/plan-limit-error";
import {
  createFixedCost,
  deleteFixedCost,
} from "../services/fixed-costs.server";
import {
  deleteAdCredential,
  upsertAdCredential,
} from "../services/credentials.server";
import {
  createNotificationChannel,
  deleteNotificationChannel,
  sendSlackNotification,
} from "../services/notifications.server";
import { NOTIFICATION_CHANNEL_TYPES } from "../constants/notificationTypes";
import { importPaymentPayoutCsv } from "../services/imports/payment-payouts.server";
import { refreshExchangeRates } from "../services/exchange-rates.server";
import {
  createReportSchedule,
  deleteReportSchedule,
} from "../services/report-schedules.server";
import {
  formatCurrency,
  formatPercent,
  formatDateShort,
} from "../utils/formatting";
import { upsertAttributionRule } from "../services/attribution.server";
import { logAuditEvent } from "../services/audit.server";
import pkg from "@prisma/client";
import { importLogisticsRatesFromCsv } from "../services/logistics.server";
import {
  upsertLogisticsCredential,
  deleteLogisticsCredential,
} from "../services/logistics-credentials.server";
import { syncLogisticsProvider } from "../services/logistics-integrations.server";
import { importTaxRatesFromCsv } from "../services/tax-rates.server";
import { syncErpCosts } from "../services/erp-costs.server";
import { syncInventoryAndCosts } from "../services/inventory.server";
import { queueGdprRequest, processGdprRequest } from "../services/privacy.server";
import { syncAccountingProvider } from "../services/accounting-sync.server";

const TEAM_ROLE_OPTIONS = [
  { value: "OWNER", label: "Owner" },
  { value: "FINANCE", label: "Finance" },
  { value: "MARKETING", label: "Marketing" },
];

const FIXED_COST_CADENCE_OPTIONS = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "YEARLY", label: "Yearly" },
];

const FIXED_COST_ALLOCATION_OPTIONS = [
  { value: "REVENUE", label: "Revenue share" },
  { value: "ORDERS", label: "Order share" },
  { value: "CHANNEL", label: "Specific channel" },
];

const DAY_MS = 1000 * 60 * 60 * 24;

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "zh", label: "简体中文" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
];

const SUPPORTED_LANGUAGES = LANGUAGE_OPTIONS.map((option) => option.value);

const LOCALIZED_TEXT = {
  en: {
    trialSection: "Trial & overage controls",
    trialHeading: "Trial status",
    trialActive: "Trial ends {date} ({days} day{plural} left).",
    trialEligible: "Upgrade to start a {days}-day free trial.",
    trialInactive: "No trial is currently active.",
    planTrialEnds: "Trial ends {date}",
    planTrialAvailable: "{days}-day trial available",
    orderSection: "Order allowance",
    orderUsageNote:
      "Keep an eye on monthly allowances and upgrade if you need more capacity; trial perks apply at checkout.",
    usageLabelOrders: "Orders",
    daysRemainingLabel: "day{plural} remaining",
    languageSection: "Language preference",
    languageLabel: "Select the interface language",
    orderWarningDangerTitle: "Order ingestion paused",
    orderWarningWarningTitle: "Order allowance nearly reached",
    orderWarningUsage: "{count} of {limit} monthly orders processed.",
    overageDanger:
      "Order ingestion has paused because the limit was reached. Upgrade to resume syncing.",
    overageWarning: "Order usage is getting close to the configured limit.",
    auditHeading: "Audit log",
    auditEmpty: "No recent audit entries.",
    auditTime: "Time",
    auditAction: "Action",
    auditDetails: "Details",
    auditUser: "User",
    planActionHeading: "Plan actions",
    planActionDescription:
      "When a trial ends or you approach your allowance, upgrading keeps data synced without interruptions.",
    planActionButton: "Upgrade to {plan}",
    planActionTrialPrompt: "Trial ending soon? Upgrading keeps the workspace running.",
    planActionMaxPlan: "You are on the most advanced plan. Contact support for bespoke limits.",
    billingStatusMessages: {
      PENDING: {
        title: "Billing pending",
        message: "Approve the Shopify charge so Profit Pulse can continue syncing orders.",
      },
      PAST_DUE: {
        title: "Billing overdue",
        message: "Your plan is past due and ingestion may stop until the charge is settled in Shopify.",
      },
      CANCELLED: {
        title: "Subscription cancelled",
        message: "The billing cycle has been cancelled. Reinstall or reactivate the app in Shopify to restart syncing.",
      },
      FROZEN: {
        title: "Billing frozen",
        message: "Billing has been paused by Shopify. Resolve the outstanding charge to unlock data sync again.",
      },
      SUSPENDED: {
        title: "Billing suspended",
        message: "Shopify has suspended billing. Visit Shopify to resume the subscription.",
      },
      EXPIRED: {
        title: "Billing expired",
        message: "Your billing cycle expired. Renew via Shopify to keep Profit Pulse active.",
      },
    },
    billingStatusLinkLabel: "Open Shopify billing",
  },
  zh: {
    trialSection: "试用与额度监控",
    trialHeading: "试用状态",
    trialActive: "试用将于 {date} 结束，剩余 {days} 天。",
    trialEligible: "升级后可开启 {days} 天试用。",
    trialInactive: "当前尚未激活试用。",
    planTrialEnds: "试用将于 {date} 结束",
    planTrialAvailable: "可使用 {days} 天试用",
    orderSection: "订单额度",
    orderUsageNote:
      "请关注每月订单使用量，超额可升级提高配额；试用权益将在结算时生效。",
    usageLabelOrders: "订单",
    daysRemainingLabel: "天剩余",
    languageSection: "语言偏好",
    languageLabel: "选择应用语言",
    orderWarningDangerTitle: "订单同步暂停",
    orderWarningWarningTitle: "订单额度即将耗尽",
    orderWarningUsage: "已使用 {count} / {limit} 月订单额度。",
    overageDanger: "订单同步因额度触顶已暂停，请升级恢复同步。",
    overageWarning: "订单使用已接近配置的额度。",
    auditHeading: "审计日志",
    auditEmpty: "暂无审计记录。",
    auditTime: "时间",
    auditAction: "操作",
    auditDetails: "详情",
    auditUser: "用户",
    planActionHeading: "计划操作",
    planActionDescription:
      "试用结束或额度接近上限时，升级计划可以持续同步数据，避免暂停。",
    planActionButton: "升级到 {plan}",
    planActionTrialPrompt: "试用即将结束？升级后继续同步数据。",
    planActionMaxPlan: "您已在最高级计划，需自定义额度请联系支持。",
    billingStatusMessages: {
      PENDING: {
        title: "计费等待中",
        message: "请在 Shopify 中确认收费，Profit Pulse 才能继续同步订单。",
      },
      PAST_DUE: {
        title: "计费逾期",
        message: "计费状态已过期，需在 Shopify 结算后才能恢复同步。",
      },
      CANCELLED: {
        title: "订阅已取消",
        message: "订阅被取消，请在 Shopify 中重新激活应用以恢复同步。",
      },
      FROZEN: {
        title: "计费被冻结",
        message: "Shopify 已暂停计费，请先处理未结算的订单再恢复同步。",
      },
      SUSPENDED: {
        title: "计费已停用",
        message: "Shopify 暂停了订阅计费，请在 Shopify 端恢复后继续使用。",
      },
      EXPIRED: {
        title: "计费已过期",
        message: "账单已过期，请在 Shopify 中续费以维持 Profit Pulse 的运行。",
      },
    },
    billingStatusLinkLabel: "前往 Shopify 计费页",
  },
};

function getLocalizedText(lang) {
  return LOCALIZED_TEXT[lang] ?? LOCALIZED_TEXT.en;
}

const REPORT_FREQUENCY_OPTIONS = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
];

const REPORT_CHANNEL_OPTIONS = [
  { value: "EMAIL", label: "Email" },
  { value: "SLACK", label: "Slack / Teams" },
  { value: "WEBHOOK", label: "Webhook (Zapier/Make)" },
];

const FREE_PLAN_TIER = "FREE";
const { CredentialProvider, AttributionRuleType, GdprRequestType, GdprRequestStatus } = pkg;

const NOTIFICATION_TYPE_OPTIONS = [
  { value: NOTIFICATION_CHANNEL_TYPES.SLACK, label: "Slack (Webhook)" },
  { value: NOTIFICATION_CHANNEL_TYPES.TEAMS, label: "Microsoft Teams (Webhook)" },
  { value: NOTIFICATION_CHANNEL_TYPES.ZAPIER, label: "Zapier Webhook" },
  { value: NOTIFICATION_CHANNEL_TYPES.MAKE, label: "Make (Integromat) Webhook" },
];

const NOTIFICATION_TYPE_LABELS = {
  [NOTIFICATION_CHANNEL_TYPES.SLACK]: "Slack",
  [NOTIFICATION_CHANNEL_TYPES.TEAMS]: "Microsoft Teams",
  [NOTIFICATION_CHANNEL_TYPES.ZAPIER]: "Zapier",
  [NOTIFICATION_CHANNEL_TYPES.MAKE]: "Make / Integromat",
};

const ATTRIBUTION_PROVIDER_OPTIONS = [
  { value: CredentialProvider.META_ADS, label: "Meta Ads" },
  { value: CredentialProvider.GOOGLE_ADS, label: "Google Ads" },
  { value: CredentialProvider.BING_ADS, label: "Bing Ads" },
  { value: CredentialProvider.TIKTOK_ADS, label: "TikTok Ads" },
  { value: CredentialProvider.AMAZON_ADS, label: "Amazon Ads" },
  { value: CredentialProvider.SNAPCHAT_ADS, label: "Snapchat Ads" },
];
const LOGISTICS_PROVIDER_OPTIONS = [
  { value: CredentialProvider.EASYPOST_LOGISTICS, label: "EasyPost" },
  { value: CredentialProvider.SHIPSTATION_LOGISTICS, label: "ShipStation" },
];
const GDPR_STATUS_LABELS = {
  [GdprRequestStatus.PENDING]: "Pending",
  [GdprRequestStatus.PROCESSING]: "Processing",
  [GdprRequestStatus.COMPLETED]: "Completed",
  [GdprRequestStatus.FAILED]: "Failed",
};
const ATTRIBUTION_RULE_TYPES = [
  AttributionRuleType.LAST_TOUCH,
  AttributionRuleType.FIRST_TOUCH,
];
const RULE_TYPE_LABELS = {
  [AttributionRuleType.LAST_TOUCH]: {
    en: "Last-touch weight",
    zh: "末触权重",
  },
  [AttributionRuleType.FIRST_TOUCH]: {
    en: "First-touch weight",
    zh: "首触权重",
  },
};

function getProviderLabel(provider) {
  const option = ATTRIBUTION_PROVIDER_OPTIONS.find((item) => item.value === provider);
  return option?.label ?? provider;
}

function getRuleTypeLabel(ruleType, lang) {
  const labels = RULE_TYPE_LABELS[ruleType];
  if (!labels) return ruleType;
  return labels[lang] ?? labels.en;
}
const DEFAULT_ATTRIBUTION_WINDOW = 24;

const ROLE_LABELS = {
  OWNER: "Owner",
  FINANCE: "Finance",
  MARKETING: "Marketing",
};

const ROLE_PERMISSIONS = {
  "seed-costs": ["OWNER", "FINANCE"],
  "simulate-order": ["OWNER", "FINANCE", "MARKETING"],
  "sync-ads": ["OWNER", "FINANCE", "MARKETING"],
  "connect-ad-credential": ["OWNER", "FINANCE", "MARKETING"],
  "disconnect-ad-credential": ["OWNER", "FINANCE", "MARKETING"],
  "connect-slack-webhook": ["OWNER", "FINANCE", "MARKETING"],
  "delete-notification-channel": ["OWNER", "FINANCE", "MARKETING"],
  "test-slack-notification": ["OWNER", "FINANCE", "MARKETING"],
  "refresh-exchange-rates": ["OWNER", "FINANCE"],
  "import-paypal-csv": ["OWNER", "FINANCE"],
  "sync-orders": ["OWNER", "FINANCE"],
  "sync-payments": ["OWNER", "FINANCE"],
  "sync-paypal-payments": ["OWNER", "FINANCE"],
  "sync-stripe-payments": ["OWNER", "FINANCE"],
  "sync-klarna-payments": ["OWNER", "FINANCE"],
  "sync-inventory": ["OWNER", "FINANCE"],
  "import-cogs": ["OWNER", "FINANCE"],
  "invite-member": ["OWNER"],
  "update-member-role": ["OWNER"],
  "remove-member": ["OWNER"],
  "change-plan": ["OWNER"],
  "create-fixed-cost": ["OWNER", "FINANCE"],
  "delete-fixed-cost": ["OWNER", "FINANCE"],
  "create-report-schedule": ["OWNER", "FINANCE"],
  "delete-report-schedule": ["OWNER", "FINANCE"],
  "update-attribution-rules": ["OWNER", "FINANCE"],
  "import-logistics": ["OWNER", "FINANCE"],
  "import-tax-rates": ["OWNER", "FINANCE"],
  "sync-erp-costs": ["OWNER", "FINANCE"],
  "connect-logistics-credential": ["OWNER", "FINANCE"],
  "disconnect-logistics-credential": ["OWNER", "FINANCE"],
  "sync-logistics-provider": ["OWNER", "FINANCE"],
  "sync-quickbooks": ["OWNER", "FINANCE"],
  "sync-xero": ["OWNER", "FINANCE"],
  "queue-gdpr-export": ["OWNER", "FINANCE"],
  "queue-gdpr-deletion": ["OWNER"],
  "process-gdpr-request": ["OWNER"],
};

const INTENT_LABELS = {
  "seed-costs": "Load demo costs",
  "simulate-order": "Run sandbox order",
  "sync-ads": "Fetch ad spend",
  "connect-ad-credential": "Connect ads",
  "disconnect-ad-credential": "Disconnect ads",
  "connect-slack-webhook": "Save Slack webhook",
  "delete-notification-channel": "Remove Slack webhook",
  "test-slack-notification": "Test Slack alert",
  "refresh-exchange-rates": "Refresh FX rates",
  "import-paypal-csv": "Import PayPal payouts",
  "sync-orders": "Pull Shopify orders",
  "sync-payments": "Pull payout summary",
  "sync-paypal-payments": "Sync PayPal payouts",
  "sync-stripe-payments": "Sync Stripe payouts",
  "sync-klarna-payments": "Sync Klarna payouts",
  "import-cogs": "Import COGS CSV",
  "sync-inventory": "Sync Shopify inventory",
  "invite-member": "Invite teammate",
  "update-member-role": "Update teammate role",
  "remove-member": "Remove teammate",
  "change-plan": "Switch plan",
  "create-fixed-cost": "Add fixed cost",
  "delete-fixed-cost": "Remove fixed cost",
  "create-report-schedule": "Add report schedule",
  "delete-report-schedule": "Remove report schedule",
  "update-attribution-rules": "Update attribution rules",
  "import-logistics": "Import logistics rates",
  "import-tax-rates": "Import tax templates",
  "sync-erp-costs": "Sync ERP SKU costs",
  "connect-logistics-credential": "Connect logistics provider",
  "disconnect-logistics-credential": "Disconnect logistics provider",
  "sync-logistics-provider": "Sync logistics rates",
  "sync-quickbooks": "Sync QuickBooks",
  "sync-xero": "Sync Xero",
  "queue-gdpr-export": "Queue GDPR export",
  "queue-gdpr-deletion": "Queue GDPR deletion",
  "process-gdpr-request": "Process GDPR request",
};

function normalizeRole(role) {
  return (role ?? "OWNER").toUpperCase();
}

function formatFrequencyLabel(code) {
  const option = REPORT_FREQUENCY_OPTIONS.find((item) => item.value === code);
  return option?.label ?? code;
}

function formatChannelLabel(value) {
  const option = REPORT_CHANNEL_OPTIONS.find((item) => item.value === value);
  return option?.label ?? value ?? "—";
}

function ensureRoleForIntent(intent, role) {
  const allowed = ROLE_PERMISSIONS[intent];
  if (!allowed) return null;
  const normalized = normalizeRole(role);
  if (allowed.includes(normalized)) return null;
  const labels = allowed.map((name) => ROLE_LABELS[name] ?? name);
  return `该操作需要 ${labels.join(" 或 ")} 权限`;
}

async function resolveSessionRole({ merchantId, email }) {
  if (!merchantId || !email) {
    return "OWNER";
  }
  const member = await findTeamMemberByEmail({
    merchantId,
    email,
  });
  return member?.role ?? "OWNER";
}

export function canPerformIntent(intent, role) {
  const allowed = ROLE_PERMISSIONS[intent];
  if (!allowed) return true;
  return allowed.includes(normalizeRole(role));
}

export function permissionDescription(intent) {
  const allowed = ROLE_PERMISSIONS[intent];
  if (!allowed) return null;
  return allowed.map((name) => ROLE_LABELS[name] ?? name).join(" 或 ");
}

export const loader = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  await syncSubscriptionFromShopify({
    merchantId: store.merchantId,
    session,
    billing,
  });
  const settings = await getAccountSettings({ store });
  const currentRole = await resolveSessionRole({
    merchantId: store.merchantId,
    email: session.email,
  });
  const requestedLang =
    (new URL(request.url).searchParams.get("lang") ?? "en").toLowerCase();
  const lang = SUPPORTED_LANGUAGES.includes(requestedLang) ? requestedLang : "en";
  return { settings, storeId: store.id, currentRole, lang };
};

export const action = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const currentRole = await resolveSessionRole({
    merchantId: store.merchantId,
    email: session.email,
  });
  const permissionError = ensureRoleForIntent(intent, currentRole);
  if (permissionError) {
    return { message: permissionError };
  }

  if (intent === "seed-costs") {
    await seedDemoCostConfiguration({
      storeId: store.id,
      currency: store.currency,
    });
    await logAuditEvent({
      merchantId: store.merchantId,
      userEmail: session.email,
      action: "seed_demo_costs",
      details: `Seeded demo costs for ${store.shopDomain}`,
    });
    return { message: "Demo COGS & cost templates updated." };
  }

  if (intent === "simulate-order") {
    try {
      const payload = buildDemoOrder();
      await processShopifyOrder({ store, payload });
      return { message: "Demo Shopify order processed via profit engine." };
    } catch (error) {
      if (isPlanLimitError(error)) {
        return { message: error.message };
      }
      throw error;
    }
  }

  if (intent === "sync-ads") {
    const provider = formData.get("provider");
    if (!provider) {
      return { message: "Missing ad provider." };
    }
    try {
      await syncAdProvider({ store, provider });
      await logAuditEvent({
        merchantId: store.merchantId,
        userEmail: session.email,
        action: "sync_ads",
        details: `Synced ad spend for ${provider}`,
      });
      return { message: `Ad spend synced for ${provider}.` };
    } catch (error) {
      console.error(error);
      return {
        message:
          "Failed to sync ad spend. Verify credentials or try again shortly.",
      };
    }
  }

  if (intent === "connect-ad-credential") {
    const provider = formData.get("provider");
    const accountId = formData.get("accountId")?.toString().trim();
    const accountName = formData.get("accountName")?.toString().trim() || undefined;
    const accessToken = formData.get("accessToken")?.toString().trim();
    const developerToken = formData.get("developerToken")?.toString().trim();
    const loginCustomerId = formData.get("loginCustomerId")?.toString().trim();

    if (!provider || !accountId || !accessToken) {
      return { message: "请输入完整的广告账号信息与 Access Token。" };
    }
    if (provider === "GOOGLE_ADS" && !developerToken) {
      return { message: "Google Ads 需要 Developer Token。" };
    }

    const secret = {
      accessToken,
    };
    if (developerToken) {
      secret.developerToken = developerToken;
    }
    if (loginCustomerId) {
      secret.loginCustomerId = loginCustomerId;
    }

    await upsertAdCredential({
      merchantId: store.merchantId,
      storeId: store.id,
      provider,
      accountId,
      accountName,
      secret,
    });

    await logAuditEvent({
      merchantId: store.merchantId,
      userEmail: session.email,
      action: "connect_ad_credential",
      details: `Connected ${provider} account ${accountId}`,
    });

    return { message: "广告账号已连接。" };
  }

  if (intent === "disconnect-ad-credential") {
    const provider = formData.get("provider");
    if (!provider) {
      return { message: "缺少需要断开的广告平台。" };
    }

    await deleteAdCredential({
      merchantId: store.merchantId,
      storeId: store.id,
      provider,
    });

    await logAuditEvent({
      merchantId: store.merchantId,
      userEmail: session.email,
      action: "disconnect_ad_credential",
      details: `Disconnected ${provider}`,
    });

    return { message: "广告账号已断开连接。" };
  }

  if (intent === "connect-logistics-credential") {
    const provider = formData.get("provider")?.toString();
    const accountId = formData.get("accountId")?.toString().trim() || null;
    const accountName = formData.get("accountName")?.toString().trim() || null;
    const apiKey = formData.get("apiKey")?.toString().trim();
    const apiSecret = formData.get("apiSecret")?.toString().trim();
    const baseUrl = formData.get("baseUrl")?.toString().trim() || undefined;
    const carrierAccountsRaw = formData.get("carrierAccounts")?.toString() ?? "";
    const carrierAccounts = carrierAccountsRaw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    if (!provider || !apiKey) {
      return { message: "请输入物流服务 API Key。" };
    }

    const secret = {
      apiKey,
      ...(apiSecret ? { apiSecret } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(carrierAccounts.length ? { carrierAccounts } : {}),
    };

    await upsertLogisticsCredential({
      merchantId: store.merchantId,
      storeId: store.id,
      provider,
      accountId,
      accountName,
      secret,
    });

    await logAuditEvent({
      merchantId: store.merchantId,
      userEmail: session.email,
      action: "connect_logistics_credential",
      details: `Connected logistics provider ${provider}${accountId ? ` (${accountId})` : ""}`,
    });

    return { message: "物流服务已连接。" };
  }

  if (intent === "disconnect-logistics-credential") {
    const provider = formData.get("provider")?.toString();
    if (!provider) {
      return { message: "缺少需要断开的物流服务。" };
    }

    await deleteLogisticsCredential({
      merchantId: store.merchantId,
      storeId: store.id,
      provider,
    });

    await logAuditEvent({
      merchantId: store.merchantId,
      userEmail: session.email,
      action: "disconnect_logistics_credential",
      details: `Disconnected logistics provider ${provider}`,
    });

    return { message: "物流服务已断开连接。" };
  }

  if (intent === "sync-logistics-provider") {
    const provider = formData.get("provider")?.toString();
    if (!provider) {
      return { message: "请选择需要同步的物流服务。" };
    }
    try {
      const result = await syncLogisticsProvider({
        storeId: store.id,
        provider,
        defaultCurrency: store.currency ?? "USD",
      });
      await logAuditEvent({
        merchantId: store.merchantId,
        userEmail: session.email,
        action: "sync_logistics_provider",
        details: `Synced logistics provider ${provider} (${result.processed} rules)`,
      });
      return {
        message: `已同步 ${provider} 的物流费率（${result.processed} 条规则）。`,
      };
    } catch (error) {
      console.error(error);
      return {
        message: error.message ?? "同步物流费率失败，请检查凭证。",
      };
    }
  }

  if (intent === "connect-slack-webhook") {
    const label = formData.get("notificationLabel")?.toString().trim();
    const webhookUrl = formData.get("webhookUrl")?.toString().trim();
    const channelType =
      formData.get("channelType")?.toString() ??
      NOTIFICATION_CHANNEL_TYPES.SLACK;
    if (!webhookUrl) {
      return { message: "请输入有效的通知 Webhook URL。" };
    }

    await createNotificationChannel({
      merchantId: store.merchantId,
      type: channelType,
      label,
      webhookUrl,
    });
    await logAuditEvent({
      merchantId: store.merchantId,
      userEmail: session.email,
      action: "connect_notification",
      details: `Added ${channelType} notification channel${label ? ` (${label})` : ""}`,
    });

    return { message: "通知渠道已保存。" };
  }

  if (intent === "delete-notification-channel") {
    const channelId = formData.get("channelId")?.toString();
    if (!channelId) {
      return { message: "缺少需要删除的通知渠道。" };
    }
    await deleteNotificationChannel({ merchantId: store.merchantId, channelId });
    await logAuditEvent({
      merchantId: store.merchantId,
      userEmail: session.email,
      action: "delete_notification",
      details: `Removed notification channel ${channelId}`,
    });
    return { message: "通知渠道已删除。" };
  }

  if (intent === "test-slack-notification") {
    const success = await sendSlackNotification({
      merchantId: store.merchantId,
      text: `Test notification from Profit Pulse (${store.shopDomain}).`,
    });
    return {
      message: success ? "测试通知已发送。" : "未检测到可用 Slack Webhook，请先配置。",
    };
  }

  if (intent === "refresh-exchange-rates") {
    const baseCurrency = store.merchant?.primaryCurrency ?? store.currency ?? "USD";
    await refreshExchangeRates(baseCurrency);
    await logAuditEvent({
      merchantId: store.merchantId,
      userEmail: session.email,
      action: "refresh_exchange_rates",
      details: `Refreshed FX rates (${baseCurrency})`,
    });
    return { message: "汇率已刷新。" };
  }

  if (intent === "import-paypal-csv") {
    const provider =
      (formData.get("paymentProvider")?.toString().trim().toUpperCase()) ?? "PAYPAL";
    const file = formData.get("paymentCsv");
    if (!(file instanceof File)) {
      return { message: `请上传 ${provider} 结算 CSV 文件。` };
    }
    const content = Buffer.from(await file.arrayBuffer()).toString("utf-8");
    try {
      const count = await importPaymentPayoutCsv({
        storeId: store.id,
        provider,
        csv: content,
      });
      await logAuditEvent({
        merchantId: store.merchantId,
        userEmail: session.email,
        action: "import_payment_payouts",
        details: `Imported ${count} ${provider} payout rows`,
      });
      return { message: `已导入 ${count} 条 ${provider} 结算记录。` };
    } catch (error) {
      console.error(error);
      return { message: error.message ?? "无法解析结算 CSV，请检查格式。" };
    }
  }

  if (intent === "sync-orders") {
    try {
      const result = await syncShopifyOrders({ store, session, days: 7 });
      await logAuditEvent({
        merchantId: store.merchantId,
        userEmail: session.email,
        action: "sync_orders",
        details: `Synced ${result.processed} Shopify orders`,
      });
      return {
        message: `Synced ${result.processed} Shopify orders since ${result.processedAtMin.toISOString().slice(0, 10)}.`,
      };
    } catch (error) {
      if (isPlanLimitError(error)) {
        return { message: error.message };
      }
      console.error(error);
      return { message: "Failed to sync Shopify orders. Check app permissions and try again." };
    }
  }

  if (intent === "sync-payments") {
    try {
      await syncShopifyPayments({ store, session });
      await logAuditEvent({
        merchantId: store.merchantId,
        userEmail: session.email,
        action: "sync_payments",
        details: "Refreshed Shopify Payments payouts",
      });
      return { message: "Shopify Payments payouts refreshed." };
    } catch (error) {
      console.error(error);
      return {
        message: "Failed to sync Shopify Payments. Try again shortly.",
      };
    }
  }

  if (intent === "sync-paypal-payments") {
    try {
      const result = await syncPaypalPayments({ store, days: 30 });
      await logAuditEvent({
        merchantId: store.merchantId,
        userEmail: session.email,
        action: "sync_paypal_payments",
        details: `Fetched ${result.processed} PayPal payouts`,
      });
      return { message: `PayPal payouts synced (${result.processed} records).` };
    } catch (error) {
      console.error(error);
      return {
        message: error.message ?? "Failed to sync PayPal payouts. Check API credentials.",
      };
    }
  }

  if (intent === "sync-stripe-payments") {
    try {
      const result = await syncStripePayments({ store, days: 30 });
      await logAuditEvent({
        merchantId: store.merchantId,
        userEmail: session.email,
        action: "sync_stripe_payments",
        details: `Fetched ${result.processed} Stripe payouts`,
      });
      return { message: `Stripe payouts synced (${result.processed} records).` };
    } catch (error) {
      console.error(error);
      return {
        message: error.message ?? "Failed to sync Stripe payouts. Verify STRIPE_SECRET_KEY.",
      };
    }
  }

  if (intent === "sync-klarna-payments") {
    try {
      const result = await syncKlarnaPayments({ store, days: 30 });
      await logAuditEvent({
        merchantId: store.merchantId,
        userEmail: session.email,
        action: "sync_klarna_payments",
        details: `Fetched ${result.processed} Klarna payouts`,
      });
      return { message: `Klarna payouts synced (${result.processed} records).` };
    } catch (error) {
      console.error(error);
      return {
        message: error.message ?? "Failed to sync Klarna payouts. Check API credentials.",
      };
    }
  }

  if (intent === "sync-inventory") {
    try {
      const summary = await syncInventoryAndCosts({ store, session });
      await logAuditEvent({
        merchantId: store.merchantId,
        userEmail: session.email,
        action: "sync_inventory_costs",
        details: `Synced ${summary.variants} variants and ${summary.inventoryRows} inventory rows`,
      });
      return {
        message: `Inventory updated (${summary.variants} variants / ${summary.inventoryRows} rows).`,
      };
    } catch (error) {
      console.error(error);
      return {
        message: error.message ?? "Inventory sync failed. Confirm product & inventory scopes.",
      };
    }
  }

  if (intent === "import-cogs") {
    const file = formData.get("cogsFile");
    if (!(file instanceof File)) {
      return { message: "Please upload a CSV file with SKU costs." };
    }
    const content = Buffer.from(await file.arrayBuffer()).toString("utf-8");
    try {
      const imported = await importSkuCostsFromCsv({
        storeId: store.id,
        csv: content,
        defaultCurrency: store.currency,
      });
      await logAuditEvent({
        merchantId: store.merchantId,
        userEmail: session.email,
        action: "import_costs",
        details: `Imported ${imported} SKU cost rows`,
      });
      return { message: `Imported ${imported} SKU cost rows.` };
    } catch (error) {
      console.error(error);
      return {
        message: error.message ?? "Unable to import SKU costs. Please check your file.",
      };
    }
  }

  if (intent === "invite-member") {
    const email = formData.get("email");
    const role = formData.get("role") || "FINANCE";
    const name = formData.get("name") || undefined;
    if (!email) {
      return { message: "Email is required to invite a teammate." };
    }
    await inviteTeamMember({
      merchantId: store.merchantId,
      email,
      role,
      name,
    });
    await logAuditEvent({
      merchantId: store.merchantId,
      userEmail: session.email,
      action: "invite_team_member",
      details: `Invited ${email} as ${role}`,
    });
    return { message: `Invitation sent to ${email}.` };
  }

  if (intent === "update-member-role") {
    const memberId = formData.get("memberId");
    const role = formData.get("role");
    if (!memberId || !role) {
      return { message: "Member and role are required." };
    }
    await updateTeamMemberRole({ memberId, role });
    await logAuditEvent({
      merchantId: store.merchantId,
      userEmail: session.email,
      action: "update_member_role",
      details: `Updated member ${memberId} to ${role}`,
    });
    return { message: "Team member updated." };
  }

  if (intent === "remove-member") {
    const memberId = formData.get("memberId");
    if (!memberId) {
      return { message: "Member id missing." };
    }
    await removeTeamMember(memberId);
    await logAuditEvent({
      merchantId: store.merchantId,
      userEmail: session.email,
      action: "remove_team_member",
      details: `Removed member ${memberId}`,
    });
    return { message: "Team member removed." };
  }

  if (intent === "change-plan") {
    const planTier = formData.get("planTier");
    if (!planTier) {
      return { message: "Missing plan selection." };
    }
    const returnUrl = new URL("/app/settings", request.url).toString();
    try {
      await requestPlanChange({
        planTier,
        billing,
        session,
        returnUrl,
      });
      await logAuditEvent({
        merchantId: store.merchantId,
        userEmail: session.email,
        action: "change_plan",
        details: `Requested plan change to ${planTier}`,
      });
      return null;
    } catch (error) {
      console.error(error);
      return {
        message: "Unable to start billing session. Please try again.",
      };
    }
  }

  if (intent === "create-fixed-cost") {
    const label = formData.get("fixedCostLabel")?.toString().trim();
    const amountValue = Number(formData.get("fixedCostAmount"));
    const currency = formData.get("fixedCostCurrency") || store.currency || "USD";
    const cadence = formData.get("fixedCostCadence") || "MONTHLY";
    const allocationType =
      formData.get("fixedCostAllocationType")?.toString()?.toUpperCase() ?? "REVENUE";
    const allocationChannel = formData.get("fixedCostAllocationChannel")?.toString().trim();
    const notes = formData.get("fixedCostNotes")?.toString().trim();

    if (!label || !Number.isFinite(amountValue) || amountValue <= 0) {
      return { message: "请输入有效的固定成本名称与金额。" };
    }

    let allocation = allocationType;
    if (allocationType === "CHANNEL") {
      if (!allocationChannel) {
        return { message: "请输入用于分摊的渠道代码。" };
      }
      allocation = `CHANNEL:${allocationChannel.toUpperCase()}`;
    } else if (!["REVENUE", "ORDERS"].includes(allocationType)) {
      allocation = "REVENUE";
    }

    await createFixedCost({
      merchantId: store.merchantId,
      label,
      amount: amountValue,
      currency,
      cadence,
      allocation,
      appliesTo: "ALL",
      notes,
    });
    await logAuditEvent({
      merchantId: store.merchantId,
      userEmail: session.email,
      action: "create_fixed_cost",
      details: `Added fixed cost "${label}" (${amountValue} ${currency})`,
    });

    return { message: "固定成本已保存。" };
  }

  if (intent === "delete-fixed-cost") {
    const fixedCostId = formData.get("fixedCostId");
    if (!fixedCostId) {
      return { message: "缺少需要删除的固定成本。" };
    }

    await deleteFixedCost({
      merchantId: store.merchantId,
      fixedCostId: fixedCostId.toString(),
    });
    await logAuditEvent({
      merchantId: store.merchantId,
      userEmail: session.email,
      action: "delete_fixed_cost",
      details: `Removed fixed cost ${fixedCostId}`,
    });

    return { message: "固定成本已移除。" };
  }

  if (intent === "create-report-schedule") {
    const frequency = formData.get("frequency") ?? "DAILY";
    const channel = formData.get("channel") ?? "EMAIL";
    const recipients = formData.get("recipients")?.toString() ?? "";
    const subjectPrefix = formData.get("subjectPrefix")?.toString().trim();
    const webhookUrl = formData.get("webhookUrl")?.toString().trim();
    try {
      await createReportSchedule({
        merchantId: store.merchantId,
        frequency,
        channel,
        recipients,
        settings: {
          ...(subjectPrefix ? { subjectPrefix } : {}),
          ...(channel === "WEBHOOK" && webhookUrl
            ? { webhookUrl }
            : {}),
        },
      });
      await logAuditEvent({
        merchantId: store.merchantId,
        userEmail: session.email,
        action: "create_report_schedule",
        details: `Created ${frequency} ${channel} report for ${recipients}`,
      });
      return { message: "Report schedule saved." };
    } catch (error) {
      console.error(error);
      return {
        message: error.message ?? "Unable to create report schedule.",
      };
    }
  }

  if (intent === "delete-report-schedule") {
    const scheduleId = formData.get("scheduleId");
    if (!scheduleId) {
      return { message: "Missing report schedule to delete." };
    }
    await deleteReportSchedule({
      merchantId: store.merchantId,
      scheduleId: scheduleId.toString(),
    });
    await logAuditEvent({
      merchantId: store.merchantId,
      userEmail: session.email,
      action: "delete_report_schedule",
      details: `Deleted report schedule ${scheduleId}`,
    });
    return { message: "Report schedule removed." };
  }

  if (intent === "update-attribution-rules") {
    if (!store.merchantId) {
      return { message: "无法识别商户。" };
    }
    try {
      const updates = [];
      for (const option of ATTRIBUTION_PROVIDER_OPTIONS) {
        for (const ruleType of ATTRIBUTION_RULE_TYPES) {
          const weightValue = Number(
            formData.get(`weight_${option.value}_${ruleType}`),
          );
          const windowValue = Number(
            formData.get(`window_${option.value}_${ruleType}`),
          );
          const weight =
            Number.isFinite(weightValue) && weightValue > 0 ? weightValue : 1;
          const windowHours =
            Number.isFinite(windowValue) && windowValue > 0
              ? windowValue
              : DEFAULT_ATTRIBUTION_WINDOW;
          updates.push(
            upsertAttributionRule({
              merchantId: store.merchantId,
              provider: option.value,
              ruleType,
              weight,
              windowHours,
            }),
          );
        }
      }
      await Promise.all(updates);
      await logAuditEvent({
        merchantId: store.merchantId,
        userEmail: session.email,
        action: "update_attribution_rules",
        details: "Updated attribution rules for connected ad providers",
      });
      return { message: "Attribution rules updated." };
    } catch (error) {
      console.error(error);
      return {
        message: error.message ?? "Unable to update attribution rules.",
      };
    }
  }

  if (intent === "import-logistics") {
    const csvInput = await readTextField(formData.get("logisticsCsv"));
    if (!csvInput) {
      return { message: "请提供物流费用规则 CSV 内容。" };
    }
    try {
      const imported = await importLogisticsRatesFromCsv({
        storeId: store.id,
        csv: csvInput,
        defaultCurrency: store.currency || "USD",
      });
      await logAuditEvent({
        merchantId: store.merchantId,
        userEmail: session.email,
        action: "import_logistics_rules",
        details: `Imported ${imported} logistics rules`,
      });
      return { message: `导入 ${imported} 条物流规则。` };
    } catch (error) {
      console.error(error);
      return {
        message: error.message ?? "无法导入物流规则，请检查 CSV 格式。",
      };
    }
  }

  if (intent === "import-tax-rates") {
    const csvInput = await readTextField(formData.get("taxRatesCsv"));
    if (!csvInput) {
      return { message: "请提供税率模板 CSV 内容。" };
    }
    try {
      const imported = await importTaxRatesFromCsv({
        storeId: store.id,
        csv: csvInput,
      });
      await logAuditEvent({
        merchantId: store.merchantId,
        userEmail: session.email,
        action: "import_tax_rates",
        details: `Imported ${imported} tax rate rows`,
      });
      return { message: `导入 ${imported} 条税率模板。` };
    } catch (error) {
      console.error(error);
      return {
        message: error.message ?? "无法导入税率模板，请检查 CSV。",
      };
    }
  }

  if (intent === "sync-erp-costs") {
    try {
      const imported = await syncErpCosts({ storeId: store.id });
      await logAuditEvent({
        merchantId: store.merchantId,
        userEmail: session.email,
        action: "sync_erp_costs",
        details: `Synced ${imported} ERP cost rows`,
      });
      return { message: `ERP cost sync completed (${imported} rows).` };
    } catch (error) {
      console.error(error);
      return {
        message:
          error.message ?? "无法同步 ERP 成本，请检查配置或稍后重试。",
      };
    }
  }

  if (intent === "sync-quickbooks" || intent === "sync-xero") {
    const provider = intent === "sync-quickbooks" ? "QUICKBOOKS" : "XERO";
    try {
      const result = await syncAccountingProvider({ store, provider });
      await logAuditEvent({
        merchantId: store.merchantId,
        userEmail: session.email,
        action: `sync_${provider.toLowerCase()}`,
        details: `Synced ${result.count} rows to ${provider}`,
      });
      return {
        message: `${provider} sync dispatched (${result.count} rows).`,
      };
    } catch (error) {
      console.error(error);
      return {
        message: error.message ?? `Failed to sync ${provider}.` ,
      };
    }
  }

  if (intent === "queue-gdpr-export" || intent === "queue-gdpr-deletion") {
    const subjectEmail = formData.get("subjectEmail")?.toString().trim();
    if (!subjectEmail) {
      return { message: "请提供客户邮箱。" };
    }
    const type =
      intent === "queue-gdpr-export"
        ? GdprRequestType.EXPORT
        : GdprRequestType.DELETE;
    try {
      const record = await queueGdprRequest({
        merchantId: store.merchantId,
        storeId: store.id,
        type,
        subjectEmail,
        requestedBy: session.email,
      });
      await logAuditEvent({
        merchantId: store.merchantId,
        userEmail: session.email,
        action: intent,
        details: `${type} request queued for ${subjectEmail} (${record.id})`,
      });
      const summaryLabel =
        type === GdprRequestType.EXPORT
          ? `已排队导出 ${subjectEmail} 的数据。`
          : `已排队删除 ${subjectEmail} 的个人数据。`;
      return { message: summaryLabel };
    } catch (error) {
      console.error(error);
      return {
        message: error.message ?? "GDPR 请求排队失败，请稍后重试。",
      };
    }
  }

  if (intent === "process-gdpr-request") {
    const requestId = formData.get("requestId")?.toString();
    if (!requestId) {
      return { message: "请选择要处理的 GDPR 请求。" };
    }
    try {
      const processed = await processGdprRequest({
        requestId,
        merchantId: store.merchantId,
      });
      await logAuditEvent({
        merchantId: store.merchantId,
        userEmail: session.email,
        action: "process_gdpr_request",
        details: `Processed GDPR request ${requestId} (${processed.type})`,
      });
      const successMessage =
        processed.type === GdprRequestType.EXPORT
          ? "GDPR 导出已生成，点击下载查看详情。"
          : "GDPR 删除请求已处理并匿名化客户数据。";
      return { message: successMessage };
    } catch (error) {
      console.error(error);
      return {
        message: error.message ?? "处理 GDPR 请求失败，请稍后重试。",
      };
    }
  }

  return { message: "No action performed." };
};

async function readTextField(value) {
  if (!value) return "";
  if (typeof value === "string") {
    return value;
  }
  if (typeof value?.text === "function") {
    return await value.text();
  }
  return "";
}

export default function SettingsPage() {
  const { settings, currentRole, lang } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedLang = (searchParams.get("lang") ?? lang ?? "en").toLowerCase();
  const localized = getLocalizedText(selectedLang);
  const handleLanguageChange = (event) => {
    const nextLang = event.target.value;
    const nextParams = new URLSearchParams(searchParams);
    if (nextLang) {
      nextParams.set("lang", nextLang);
    } else {
      nextParams.delete("lang");
    }
    setSearchParams(nextParams);
  };
  const currentIntent = navigation.formData?.get("intent");
  const isSubmitting = navigation.state === "submitting";
  const planTier = (settings.plan?.tier ?? "").toUpperCase();
  const isFreeTier = planTier === FREE_PLAN_TIER;
  const freeTierAllowances = {
    stores: settings.plan?.allowances?.stores ?? 1,
    orders: settings.plan?.allowances?.orders ?? 0,
    adAccounts: settings.plan?.allowances?.adAccounts ?? 1,
  };
  const primaryStore = settings.stores?.[0];
  const masterCurrency =
    settings.primaryCurrency || primaryStore?.merchantCurrency || primaryStore?.currency || "USD";
  const merchantSummary = settings.merchantSummary ?? null;
  const summaryTimezone =
    merchantSummary?.timezone || settings.primaryTimezone || primaryStore?.timezone || "UTC";
  const aggregateRangeLabel =
    merchantSummary?.rangeLabel ??
    (merchantSummary?.range
      ? `${formatDateShort(merchantSummary.range.start, summaryTimezone)} – ${formatDateShort(
          merchantSummary.range.end,
          summaryTimezone,
        )}`
      : "");
  const targetPlanTier = navigation.formData?.get("planTier");
  const targetProvider = navigation.formData?.get("provider");
  const pendingMemberId = navigation.formData?.get("memberId");
  const [fixedCostAllocationType, setFixedCostAllocationType] = useState("REVENUE");

  const auditLogs = settings.auditLogs ?? [];
  const accountingSync = settings.accountingSync ?? {};

  const usage = settings.planUsage;
  const orderStatus = usage?.orders?.status;
  const orderWarning =
    orderStatus === "warning" || orderStatus === "danger";
  const orderWarningTitle =
    orderStatus === "danger"
      ? localized.orderWarningDangerTitle
      : localized.orderWarningWarningTitle;
  const orderWarningTone = orderStatus === "danger" ? "critical" : "warning";
  const orderWarningMessage = usage?.orders
    ? localized.orderWarningUsage
        .replace("{count}", usage.orders.count.toLocaleString())
        .replace("{limit}", usage.orders.limit.toLocaleString())
    : "";
  const planInfo = settings.plan ?? {};
  const billingStatusKey = planInfo.status ? planInfo.status.toUpperCase() : null;
  const billingNotice =
    billingStatusKey && localized.billingStatusMessages
      ? localized.billingStatusMessages[billingStatusKey] ?? null
      : null;
  const billingActionHref =
    primaryStore?.shopDomain != null
      ? `https://${primaryStore.shopDomain}/admin/apps`
      : "/app";
  const now = new Date();
  const trialEndsAt = planInfo.trialEndsAt ? new Date(planInfo.trialEndsAt) : null;
  const trialActive = trialEndsAt ? trialEndsAt >= now : false;
  const trialDaysLeft = trialActive
    ? Math.max(1, Math.ceil((trialEndsAt - now) / DAY_MS))
    : 0;
  const pluralSuffix = trialDaysLeft === 1 ? "" : "s";
  const trialNote = trialActive
    ? localized.trialActive
        .replace("{date}", formatDateTime(trialEndsAt))
        .replace("{days}", trialDaysLeft)
        .replace("{plural}", pluralSuffix)
    : planInfo.trialDays
      ? localized.trialEligible.replace("{days}", planInfo.trialDays)
      : localized.trialInactive;
  const planTrialLabel = planInfo.trialEndsAt
    ? localized.planTrialEnds.replace("{date}", formatDateTime(trialEndsAt))
    : planInfo.trialDays
      ? localized.planTrialAvailable.replace("{days}", planInfo.trialDays)
      : null;
  const trialBadgeText = trialActive
    ? `${trialDaysLeft} ${localized.daysRemainingLabel.replace("{plural}", pluralSuffix)}`
    : null;
  const orderUsagePercent =
    usage?.orders?.limit && usage.orders.limit > 0
      ? Math.min(100, (usage.orders.count / usage.orders.limit) * 100)
      : null;
  const overageNote =
    orderStatus === "danger"
      ? localized.overageDanger
      : orderStatus === "warning"
        ? localized.overageWarning
        : null;
  const planTiers = [FREE_PLAN_TIER, "BASIC", "PRO"];
  const currentPlanIndex = planTiers.indexOf(planTier);
  const upgradeTargetTier =
    currentPlanIndex >= 0 && currentPlanIndex < planTiers.length - 1
      ? planTiers[currentPlanIndex + 1]
      : null;
  const recommendedPlanOption = upgradeTargetTier
    ? settings.planOptions?.find((option) => option.tier === upgradeTargetTier)
    : null;
  const planActionText = overageNote || localized.planActionDescription;
  const upgradeButtonLabel = recommendedPlanOption
    ? localized.planActionButton.replace("{plan}", recommendedPlanOption.name)
    : null;
  const upgradingRecommendedPlan =
    isSubmitting &&
    currentIntent === "change-plan" &&
    targetPlanTier === recommendedPlanOption?.tier;
  const shopifyData = settings.shopifyData ?? {};
  const teamMembers = settings.teamMembers ?? [];
  const integrations = settings.integrations ?? {};
  const fixedCosts = settings.fixedCosts ?? [];
  const notificationChannels = settings.notifications ?? [];
  const exchangeRates = settings.exchangeRates ?? {};
  const reportSchedules = settings.reportSchedules ?? [];
  const logisticsRules = settings.logisticsRules ?? [];
  const taxRates = settings.taxRates ?? [];
  const gdprRequests = settings.gdprRequests ?? [];
  const attributionRules = settings.attributionRules ?? [];
  const defaultCurrency = primaryStore?.currency ?? "USD";
  const syncingOrders =
    isSubmitting && currentIntent === "sync-orders";
  const syncingPayments =
    isSubmitting && currentIntent === "sync-payments";
  const syncingPaypalApi =
    isSubmitting && currentIntent === "sync-paypal-payments";
  const syncingStripeApi =
    isSubmitting && currentIntent === "sync-stripe-payments";
  const syncingKlarnaApi =
    isSubmitting && currentIntent === "sync-klarna-payments";
  const syncingInventory =
    isSubmitting && currentIntent === "sync-inventory";
  const importingCogs =
    isSubmitting && currentIntent === "import-cogs";
  const creatingFixedCost =
    isSubmitting && currentIntent === "create-fixed-cost";
  const deletingFixedCostId =
    isSubmitting && currentIntent === "delete-fixed-cost"
      ? navigation.formData?.get("fixedCostId")
      : null;
  const creatingReportSchedule =
    isSubmitting && currentIntent === "create-report-schedule";
  const deletingReportScheduleId =
    isSubmitting && currentIntent === "delete-report-schedule"
      ? navigation.formData?.get("scheduleId")
      : null;
  const importingLogistics =
    isSubmitting && currentIntent === "import-logistics";
  const importingTaxRates =
    isSubmitting && currentIntent === "import-tax-rates";
  const syncingErpCosts =
    isSubmitting && currentIntent === "sync-erp-costs";
  const connectingAdProvider =
    isSubmitting && currentIntent === "connect-ad-credential"
      ? navigation.formData?.get("provider")
      : null;
  const disconnectingAdProvider =
    isSubmitting && currentIntent === "disconnect-ad-credential"
      ? navigation.formData?.get("provider")
      : null;
  const connectingLogisticsProvider =
    isSubmitting && currentIntent === "connect-logistics-credential"
      ? navigation.formData?.get("provider")
      : null;
  const disconnectingLogisticsProvider =
    isSubmitting && currentIntent === "disconnect-logistics-credential"
      ? navigation.formData?.get("provider")
      : null;
  const syncingLogisticsProvider =
    isSubmitting && currentIntent === "sync-logistics-provider"
      ? navigation.formData?.get("provider")
      : null;
  const syncingQuickbooks =
    isSubmitting && currentIntent === "sync-quickbooks";
  const syncingXero =
    isSubmitting && currentIntent === "sync-xero";
  const deletingChannelId =
    isSubmitting && currentIntent === "delete-notification-channel"
      ? navigation.formData?.get("channelId")
      : null;
  const connectingSlack = currentIntent === "connect-slack-webhook" && isSubmitting;
  const testingSlack = currentIntent === "test-slack-notification" && isSubmitting;
  const importingPaypal = currentIntent === "import-paypal-csv" && isSubmitting;
  const updatingAttributionRules =
    currentIntent === "update-attribution-rules" && isSubmitting;
  const queueingGdprExport = currentIntent === "queue-gdpr-export" && isSubmitting;
  const queueingGdprDeletion = currentIntent === "queue-gdpr-deletion" && isSubmitting;
  const processingGdprRequestId =
    isSubmitting && currentIntent === "process-gdpr-request"
      ? navigation.formData?.get("requestId")
      : null;

  const userRoleLabel = ROLE_LABELS[normalizeRole(currentRole)] ?? "Owner";
  const permissionHint = (intent) => {
    const note = permissionDescription(intent);
    return note ? `需要 ${note} 权限` : null;
  };
  const intentAccess = {
    syncOrders: canPerformIntent("sync-orders", currentRole),
    syncAds: canPerformIntent("sync-ads", currentRole),
    disconnectAdCredential: canPerformIntent("disconnect-ad-credential", currentRole),
    connectAdCredential: canPerformIntent("connect-ad-credential", currentRole),
    importPaypalCsv: canPerformIntent("import-paypal-csv", currentRole),
    syncPayments: canPerformIntent("sync-payments", currentRole),
    syncPaypalPayments: canPerformIntent("sync-paypal-payments", currentRole),
    syncStripePayments: canPerformIntent("sync-stripe-payments", currentRole),
    syncKlarnaPayments: canPerformIntent("sync-klarna-payments", currentRole),
    syncInventory: canPerformIntent("sync-inventory", currentRole),
    deleteNotificationChannel: canPerformIntent("delete-notification-channel", currentRole),
    connectSlackWebhook: canPerformIntent("connect-slack-webhook", currentRole),
    testSlackNotification: canPerformIntent("test-slack-notification", currentRole),
    refreshExchangeRates: canPerformIntent("refresh-exchange-rates", currentRole),
    changePlan: canPerformIntent("change-plan", currentRole),
    importCogs: canPerformIntent("import-cogs", currentRole),
    seedCosts: canPerformIntent("seed-costs", currentRole),
    deleteFixedCost: canPerformIntent("delete-fixed-cost", currentRole),
    createFixedCost: canPerformIntent("create-fixed-cost", currentRole),
    updateMemberRole: canPerformIntent("update-member-role", currentRole),
    removeMember: canPerformIntent("remove-member", currentRole),
    inviteMember: canPerformIntent("invite-member", currentRole),
    simulateOrder: canPerformIntent("simulate-order", currentRole),
    createReportSchedule: canPerformIntent("create-report-schedule", currentRole),
    deleteReportSchedule: canPerformIntent("delete-report-schedule", currentRole),
    updateAttributionRules: canPerformIntent("update-attribution-rules", currentRole),
    importLogistics: canPerformIntent("import-logistics", currentRole),
    importTaxRates: canPerformIntent("import-tax-rates", currentRole),
    syncErpCosts: canPerformIntent("sync-erp-costs", currentRole),
    connectLogisticsCredential: canPerformIntent(
      "connect-logistics-credential",
      currentRole,
    ),
    disconnectLogisticsCredential: canPerformIntent(
      "disconnect-logistics-credential",
      currentRole,
    ),
    syncLogisticsProvider: canPerformIntent("sync-logistics-provider", currentRole),
    syncQuickbooks: canPerformIntent("sync-quickbooks", currentRole),
    syncXero: canPerformIntent("sync-xero", currentRole),
    queueGdprExport: canPerformIntent("queue-gdpr-export", currentRole),
    queueGdprDeletion: canPerformIntent("queue-gdpr-deletion", currentRole),
    processGdprRequest: canPerformIntent("process-gdpr-request", currentRole),
  };

  const logisticIntegrations = settings.integrations?.logistics ?? [];

  const allowedActions = Object.keys(ROLE_PERMISSIONS)
    .filter((intent) => canPerformIntent(intent, currentRole))
    .map((intent) => INTENT_LABELS[intent] ?? intent);

  return (
    <s-page heading="Account & plan settings">
      <s-stack direction="inline" gap="tight">
        <s-text variation="subdued">Session role: {userRoleLabel}</s-text>
      </s-stack>
      <s-section heading="Role permissions">
        <s-unordered-list>
          {allowedActions.map((action) => (
            <s-list-item key={action}>{action}</s-list-item>
          ))}
        </s-unordered-list>
      </s-section>
      {actionData?.message && (
        <s-banner tone="success" title={actionData.message} />
      )}
      {orderWarning && (
        <s-banner tone={orderWarningTone} title={orderWarningTitle}>
          <s-text>
            {orderWarningMessage} Upgrade your plan to avoid paused ingestion.
          </s-text>
        </s-banner>
      )}
      <s-section heading="Plan overview">
          <s-card padding="base">
            <s-stack direction="block" gap="base">
              <div>
                <s-heading>{settings.plan.name} plan</s-heading>
                <s-text variation="subdued">
                  {settings.plan.description}
                </s-text>
                <s-text variation="subdued">Workspace role: {userRoleLabel}</s-text>
              </div>
            <div>
              <s-display-text size="small">
                {formatCurrency(
                  settings.plan.price,
                  settings.plan.currency,
                )}{" "}
                <s-text variation="subdued">
                  {settings.plan.intervalLabel}
                </s-text>
              </s-display-text>
              <s-text variation="subdued">
                Status: {settings.plan.status}
                {settings.plan.trialEndsAt
                  ? ` · Trial ends ${formatDateTime(settings.plan.trialEndsAt)}`
                  : ""}
              </s-text>
              <s-text variation="subdued">
                Next billing:{" "}
                {settings.plan.nextBillingAt
                  ? formatDateTime(settings.plan.nextBillingAt)
                  : "—"}
              </s-text>
              {planTrialLabel && (
                <s-text variation="subdued">{planTrialLabel}</s-text>
              )}
            </div>
            <s-stack direction="inline" gap="base">
              <s-badge tone="success">{settings.plan.limits.stores}</s-badge>
              <s-badge tone="info">{settings.plan.limits.orders}</s-badge>
            </s-stack>
          </s-stack>
        </s-card>
      </s-section>

      <s-section heading={localized.languageSection}>
        <s-card padding="base">
          <s-stack direction="inline" gap="base" align="center">
            <s-text variation="subdued">{localized.languageLabel}</s-text>
            <select value={selectedLang} onChange={handleLanguageChange}>
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </s-stack>
        </s-card>
      </s-section>

      <s-section heading={localized.trialSection}>
        <s-card padding="base">
          <s-stack direction="block" gap="base">
            <div>
              <s-heading level="3">{localized.trialHeading}</s-heading>
              <s-text variation="subdued">{trialNote}</s-text>
              {trialActive && (
                <s-badge tone="info">
                  {trialBadgeText}
                </s-badge>
              )}
            </div>
            <div>
              <s-heading level="3">{localized.orderSection}</s-heading>
              <UsageMeter
                label={localized.usageLabelOrders}
                usage={usage.orders}
                percent={orderUsagePercent}
              />
              {overageNote && (
                <s-text variation="critical">{overageNote}</s-text>
              )}
            </div>
            <div>
              <s-heading level="3">{localized.planActionHeading}</s-heading>
              <s-text variation="subdued">{planActionText}</s-text>
              {trialActive && localized.planActionTrialPrompt && (
                <s-text variation="subdued">
                  {localized.planActionTrialPrompt}
                </s-text>
              )}
              {recommendedPlanOption ? (
                <Form method="post">
                  <input type="hidden" name="intent" value="change-plan" />
                  <input
                    type="hidden"
                    name="planTier"
                    value={recommendedPlanOption.tier}
                  />
                  <s-button
                    type="submit"
                    variant="primary"
                    disabled={!intentAccess.changePlan}
                    {...(upgradingRecommendedPlan ? { loading: true } : {})}
                  >
                    {upgradeButtonLabel}
                  </s-button>
                  {!intentAccess.changePlan && (
                    <s-text variation="subdued">
                      {permissionHint("change-plan")}
                    </s-text>
                  )}
                </Form>
              ) : (
                <s-text variation="subdued">
                  {localized.planActionMaxPlan}
                </s-text>
              )}
            </div>
            {billingNotice && (
              <s-banner tone="critical" title={billingNotice.title}>
                <s-stack direction="block" gap="tight">
                  <s-text>{billingNotice.message}</s-text>
                  <s-button variant="secondary" href={billingActionHref}>
                    {localized.billingStatusLinkLabel}
                  </s-button>
                </s-stack>
              </s-banner>
            )}
            <s-text variation="subdued">
              {localized.orderUsageNote}
            </s-text>
          </s-stack>
        </s-card>
      </s-section>

      <s-section heading="Multi-store overview">
        {merchantSummary ? (
          <>
            <s-stack direction="inline" gap="base" wrap>
              <AggregateMetricCard
                label="Net revenue"
                value={merchantSummary.summary.revenue}
                currency={merchantSummary.currency}
              />
              <AggregateMetricCard
                label="Net profit"
                value={merchantSummary.summary.netProfit}
                currency={merchantSummary.currency}
              />
              <AggregateMetricCard
                label="Ad spend"
                value={merchantSummary.summary.adSpend}
                currency={merchantSummary.currency}
              />
              <AggregateMetricCard
                label="Refund rate"
                value={merchantSummary.summary.refundRate}
                variant="percentage"
              />
            </s-stack>
            <s-text variation="subdued" style={{ marginTop: "0.75rem" }}>
              {merchantSummary.storeCount.toLocaleString()} stores ·{" "}
              {aggregateRangeLabel || "recent activity"}
            </s-text>
          </>
        ) : (
          <s-text variation="subdued">Aggregated metrics will appear once stores sync orders.</s-text>
        )}
      </s-section>

      <s-section heading="Data integrations">
        <s-stack direction="block" gap="base">
          <div>
            <s-heading level="3">Shopify data</s-heading>
            <s-card padding="base">
                <s-stack direction="block" gap="base">
                  <s-text variation="subdued">
                    Status: {integrations.shopify?.status ?? "Unknown"}
                  </s-text>
                  <s-text variation="subdued">
                    Last order synced: {shopifyData.lastOrderAt ? formatDateTime(shopifyData.lastOrderAt) : "—"}
                  </s-text>
                  <s-text variation="subdued">
                    Orders stored: {shopifyData.totalOrders?.toLocaleString?.() ?? 0}
                  </s-text>
                  <Form method="post">
                    <input type="hidden" name="intent" value="sync-orders" />
                    <s-button
                      type="submit"
                      variant="secondary"
                      disabled={!intentAccess.syncOrders}
                      {...(syncingOrders ? { loading: true } : {})}
                    >
                      Sync recent orders
                    </s-button>
                    {!intentAccess.syncOrders && (
                      <s-text variation="subdued">{permissionHint("sync-orders")}</s-text>
                    )}
                  </Form>
                </s-stack>
            </s-card>
          </div>
          <div>
            <s-heading level="3">Inventory & COGS</s-heading>
            <s-card padding="base">
              <s-stack direction="block" gap="base">
                <s-text variation="subdued">
                  Pulls Shopify variant inventory levels and unit costs to keep SKU costs aligned
                  with ERP data. Requires read_products + read_inventory scopes.
                </s-text>
                <Form method="post">
                  <input type="hidden" name="intent" value="sync-inventory" />
                  <s-button
                    type="submit"
                    variant="secondary"
                    disabled={!intentAccess.syncInventory}
                    {...(syncingInventory ? { loading: true } : {})}
                  >
                    Sync inventory & costs
                  </s-button>
                  {!intentAccess.syncInventory && (
                    <s-text variation="subdued">{permissionHint("sync-inventory")}</s-text>
                  )}
                </Form>
              </s-stack>
            </s-card>
          </div>
          <div>
          <s-heading level="3">Ad networks</s-heading>
          <s-stack direction="inline" gap="base" wrap>
            {settings.integrations.ads.map((integration) => {
              const syncLoading =
                isSubmitting &&
                currentIntent === "sync-ads" &&
                targetProvider === integration.id;
              const connectingThis = connectingAdProvider === integration.id;
              const disconnectingThis = disconnectingAdProvider === integration.id;
              const connected = integration.status === "Connected";
              return (
                <s-card key={integration.id} padding="base">
                  <s-heading>{integration.label}</s-heading>
                  <s-text variation="subdued">
                    {integration.status}
                    {integration.accountName ? ` · ${integration.accountName}` : ""}
                  </s-text>
                  {connected ? (
                    <>
                      <s-text variation="subdued">
                        Account: {integration.accountName || integration.accountId || "—"}
                      </s-text>
                      <s-text variation="subdued">
                        Last sync:{" "}
                        {integration.lastSyncedAt
                          ? formatDateTime(integration.lastSyncedAt)
                          : "Never"}
                      </s-text>
                      <s-stack direction="inline" gap="base" wrap>
                        <Form method="post">
                          <input type="hidden" name="intent" value="sync-ads" />
                          <input type="hidden" name="provider" value={integration.id} />
                          <s-button
                            type="submit"
                            variant="secondary"
                            disabled={!intentAccess.syncAds}
                            {...(syncLoading ? { loading: true } : {})}
                          >
                            Sync now
                          </s-button>
                          {!intentAccess.syncAds && (
                            <s-text variation="subdued">{permissionHint("sync-ads")}</s-text>
                          )}
                        </Form>
                        <Form method="post">
                          <input type="hidden" name="intent" value="disconnect-ad-credential" />
                          <input type="hidden" name="provider" value={integration.id} />
                          <s-button
                            type="submit"
                            variant="destructive"
                            disabled={!intentAccess.disconnectAdCredential}
                            {...(disconnectingThis ? { loading: true } : {})}
                          >
                            Disconnect
                          </s-button>
                          {!intentAccess.disconnectAdCredential && (
                            <s-text variation="subdued">{permissionHint("disconnect-ad-credential")}</s-text>
                          )}
                        </Form>
                      </s-stack>
                    </>
                  ) : (
                    <Form method="post">
                      <input type="hidden" name="intent" value="connect-ad-credential" />
                      <input type="hidden" name="provider" value={integration.id} />
                      <s-stack direction="block" gap="base">
                        {renderAdCredentialFields(integration.id)}
                        <s-button
                          type="submit"
                          variant="primary"
                          disabled={!intentAccess.connectAdCredential}
                          {...(connectingThis ? { loading: true } : {})}
                        >
                          Connect {integration.label}
                        </s-button>
                        {!intentAccess.connectAdCredential && (
                          <s-text variation="subdued">
                            {permissionHint("connect-ad-credential")}
                          </s-text>
                        )}
                      </s-stack>
                    </Form>
                  )}
                </s-card>
              );
            })}
          </s-stack>
        </div>

        <div>
          <s-heading level="3">Logistics providers</s-heading>
          <s-stack direction="inline" gap="base" wrap>
            {logisticIntegrations.map((integration) => {
              const connected = integration.status === "Connected";
              const connectingThis = connectingLogisticsProvider === integration.id;
              const disconnectingThis = disconnectingLogisticsProvider === integration.id;
              const syncingThis = syncingLogisticsProvider === integration.id;
              return (
                <s-card key={integration.id} padding="base">
                  <s-heading>{integration.label}</s-heading>
                  <s-text variation="subdued">
                    {integration.status}
                    {integration.accountName
                      ? ` · ${integration.accountName}`
                      : integration.accountId
                        ? ` · ${integration.accountId}`
                        : ""}
                  </s-text>
                  {connected ? (
                    <>
                      <s-text variation="subdued">
                        Last sync:{" "}
                        {integration.lastSyncedAt
                          ? formatDateTime(integration.lastSyncedAt)
                          : "Never"}
                      </s-text>
                      <s-stack direction="inline" gap="base" wrap>
                        <Form method="post">
                          <input type="hidden" name="intent" value="sync-logistics-provider" />
                          <input type="hidden" name="provider" value={integration.id} />
                          <s-button
                            type="submit"
                            variant="secondary"
                            disabled={!intentAccess.syncLogisticsProvider}
                            {...(syncingThis ? { loading: true } : {})}
                          >
                            Sync rates
                          </s-button>
                          {!intentAccess.syncLogisticsProvider && (
                            <s-text variation="subdued">{permissionHint("sync-logistics-provider")}</s-text>
                          )}
                        </Form>
                        <Form method="post">
                          <input type="hidden" name="intent" value="disconnect-logistics-credential" />
                          <input type="hidden" name="provider" value={integration.id} />
                          <s-button
                            type="submit"
                            variant="destructive"
                            disabled={!intentAccess.disconnectLogisticsCredential}
                            {...(disconnectingThis ? { loading: true } : {})}
                          >
                            Disconnect
                          </s-button>
                          {!intentAccess.disconnectLogisticsCredential && (
                            <s-text variation="subdued">{permissionHint("disconnect-logistics-credential")}</s-text>
                          )}
                        </Form>
                      </s-stack>
                    </>
                  ) : (
                    <Form method="post">
                      <input type="hidden" name="intent" value="connect-logistics-credential" />
                      <input type="hidden" name="provider" value={integration.id} />
                      <s-stack direction="block" gap="base">
                        {renderLogisticsCredentialFields(integration.id)}
                        <s-button
                          type="submit"
                          variant="primary"
                          disabled={!intentAccess.connectLogisticsCredential}
                          {...(connectingThis ? { loading: true } : {})}
                        >
                          Connect {integration.label}
                        </s-button>
                        {!intentAccess.connectLogisticsCredential && (
                          <s-text variation="subdued">
                            {permissionHint("connect-logistics-credential")}
                          </s-text>
                        )}
                      </s-stack>
                    </Form>
                  )}
                </s-card>
              );
            })}
          </s-stack>
        </div>

        <div>
          <s-heading level="3">Payment processors</s-heading>
            <s-stack direction="inline" gap="base" wrap>
              {settings.integrations.payments.map((integration) => {
                const isPaypal = integration.id === "PAYPAL";
                const isStripe = integration.id === "STRIPE";
                const isKlarna = integration.id === "KLARNA";
                const apiIntent = isPaypal
                  ? "sync-paypal-payments"
                  : isStripe
                    ? "sync-stripe-payments"
                    : isKlarna
                      ? "sync-klarna-payments"
                      : "sync-payments";
                const apiLoading = isPaypal
                  ? syncingPaypalApi
                  : isStripe
                    ? syncingStripeApi
                    : isKlarna
                      ? syncingKlarnaApi
                      : syncingPayments && targetProvider === integration.id;
                const apiAllowed = isPaypal
                  ? intentAccess.syncPaypalPayments
                  : isStripe
                    ? intentAccess.syncStripePayments
                    : isKlarna
                      ? intentAccess.syncKlarnaPayments
                      : intentAccess.syncPayments;

                return (
                  <s-card key={integration.id} padding="base">
                    <s-heading>{integration.label}</s-heading>
                    <s-text variation="subdued">{integration.status}</s-text>
                    <s-text variation="subdued">
                      Last sync:{" "}
                      {integration.lastSyncedAt
                        ? formatDateTime(integration.lastSyncedAt)
                        : "Never"}
                    </s-text>
                    <s-stack direction="block" gap="base">
                      <Form method="post">
                        <input type="hidden" name="intent" value={apiIntent} />
                        <input type="hidden" name="provider" value={integration.id} />
                        <s-button
                          type="submit"
                          variant="secondary"
                          disabled={!apiAllowed}
                          {...(apiLoading ? { loading: true } : {})}
                        >
                          Sync {integration.label} payouts
                        </s-button>
                        {!apiAllowed && (
                          <s-text variation="subdued">
                            {permissionHint(apiIntent)}
                          </s-text>
                        )}
                      </Form>
                      {isPaypal && (
                        <Form method="post" encType="multipart/form-data">
                          <input type="hidden" name="intent" value="import-paypal-csv" />
                          <s-stack direction="block" gap="base">
                            <label>
                              Provider
                              <select name="paymentProvider" defaultValue="PAYPAL">
                                <option value="PAYPAL">PayPal</option>
                                <option value="STRIPE">Stripe</option>
                                <option value="KLARNA">Klarna</option>
                              </select>
                            </label>
                            <label>
                              Upload CSV
                              <input type="file" name="paymentCsv" accept=".csv" />
                            </label>
                            <s-button
                              type="submit"
                              variant="secondary"
                              disabled={!intentAccess.importPaypalCsv}
                              {...(importingPaypal ? { loading: true } : {})}
                            >
                              Import payouts CSV
                            </s-button>
                            {!intentAccess.importPaypalCsv && (
                              <s-text variation="subdued">
                                {permissionHint("import-paypal-csv")}
                              </s-text>
                            )}
                          </s-stack>
                        </Form>
                      )}
                    </s-stack>
                  </s-card>
                );
              })}
          </s-stack>
        </div>
      </s-stack>
    </s-section>

      <s-section heading="Accounting sync">
        <s-stack direction="inline" gap="base" wrap>
          <s-card padding="base">
            <s-heading level="3">QuickBooks</s-heading>
            <s-text variation="subdued">
              {accountingSync.quickbooksEnabled
                ? "Push the latest accounting detail rows directly to your QuickBooks webhook."
                : "Configure QUICKBOOKS_SYNC_URL to enable QuickBooks syncing."}
            </s-text>
            <Form method="post">
              <input type="hidden" name="intent" value="sync-quickbooks" />
              <s-button
                type="submit"
                variant="secondary"
                disabled={
                  !accountingSync.quickbooksEnabled || !intentAccess.syncQuickbooks
                }
                {...(syncingQuickbooks ? { loading: true } : {})}
              >
                Sync QuickBooks
              </s-button>
              {!intentAccess.syncQuickbooks && (
                <s-text variation="subdued">{permissionHint("sync-quickbooks")}</s-text>
              )}
            </Form>
          </s-card>
          <s-card padding="base">
            <s-heading level="3">Xero</s-heading>
            <s-text variation="subdued">
              {accountingSync.xeroEnabled
                ? "Send daily accounting exports to the configured Xero endpoint."
                : "Configure XERO_SYNC_URL to enable Xero syncing."}
            </s-text>
            <Form method="post">
              <input type="hidden" name="intent" value="sync-xero" />
              <s-button
                type="submit"
                variant="secondary"
                disabled={!accountingSync.xeroEnabled || !intentAccess.syncXero}
                {...(syncingXero ? { loading: true } : {})}
              >
                Sync Xero
              </s-button>
              {!intentAccess.syncXero && (
                <s-text variation="subdued">{permissionHint("sync-xero")}</s-text>
              )}
            </Form>
          </s-card>
        </s-stack>
      </s-section>

      <s-section heading="Ad attribution rules">
        <s-stack direction="block" gap="base">
          <s-card padding="base">
            <s-heading level="3">Custom attribution multipliers</s-heading>
            <s-text variation="subdued">
              微调各广告平台在利润引擎中分配广告开销的权重与归因窗口，帮助更好反映首/末触点。
            </s-text>
            <Form method="post">
              <input type="hidden" name="intent" value="update-attribution-rules" />
              <s-stack direction="block" gap="small">
                {attributionRules.length === 0 && (
                  <s-text variation="subdued">
                    请先连接广告账号，才能设置归因权重。
                  </s-text>
                )}
                {attributionRules.map((entry) => (
                  <s-card key={entry.provider} padding="base" tone="transparent">
                    <s-heading level="4">{getProviderLabel(entry.provider)}</s-heading>
                    <s-stack direction="block" gap="tight">
                      {(entry.touches ?? []).map((touch) => (
                        <s-stack
                          key={`${entry.provider}_${touch.ruleType}`}
                          direction="inline"
                          gap="base"
                          align="baseline"
                        >
                          <s-text variation="subdued">
                            {getRuleTypeLabel(touch.ruleType, selectedLang)}
                          </s-text>
                          <label>
                            Weight
                            <input
                              type="number"
                              name={`weight_${entry.provider}_${touch.ruleType}`}
                              step="0.1"
                              min="0"
                              defaultValue={touch.weight ?? 1}
                            />
                          </label>
                          <label>
                            Attribution window (hrs)
                            <input
                              type="number"
                              name={`window_${entry.provider}_${touch.ruleType}`}
                              step="1"
                              min="1"
                              defaultValue={
                                touch.windowHours ?? DEFAULT_ATTRIBUTION_WINDOW
                              }
                            />
                          </label>
                        </s-stack>
                      ))}
                    </s-stack>
                  </s-card>
                ))}
                <s-button
                  type="submit"
                  variant="primary"
                  disabled={!intentAccess.updateAttributionRules}
                  {...(updatingAttributionRules ? { loading: true } : {})}
                >
                  Save attribution rules
                </s-button>
                {!intentAccess.updateAttributionRules && (
                  <s-text variation="subdued">
                    {permissionHint("update-attribution-rules")}
                  </s-text>
                )}
              </s-stack>
            </Form>
          </s-card>
        </s-stack>
      </s-section>
      <s-section heading="Notifications">
        <s-stack direction="block" gap="base">
          <div>
            <s-heading level="3">Team alerts</s-heading>
            <s-text variation="subdued">
              当净利润为负或发生异常时，自动推送到 Slack、Microsoft Teams 或其他 Webhook 频道。
            </s-text>
            <s-data-table>
                  <table>
                <thead>
                  <tr>
                    <th align="left">Label</th>
                    <th align="left">Type</th>
                    <th align="left">Webhook</th>
                    <th align="left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {notificationChannels.length === 0 && (
                    <tr>
                      <td colSpan="4">
                        <s-text variation="subdued">尚未配置通知渠道。</s-text>
                      </td>
                    </tr>
                  )}
                  {notificationChannels.map((channel) => (
                    <tr key={channel.id}>
                      <td>{channel.label ?? "Alert channel"}</td>
                      <td>
                        {NOTIFICATION_TYPE_LABELS[channel.type] ??
                          channel.type ??
                          "Webhook"}
                      </td>
                      <td>{channel.config?.webhookUrl?.slice(0, 40) ?? "—"}</td>
                      <td>
                        <Form method="post">
                          <input type="hidden" name="intent" value="delete-notification-channel" />
                          <input type="hidden" name="channelId" value={channel.id} />
                          <s-button
                            type="submit"
                            variant="destructive"
                            disabled={!intentAccess.deleteNotificationChannel}
                            {...(deletingChannelId === channel.id ? { loading: true } : {})}
                          >
                            Remove
                          </s-button>
                          {!intentAccess.deleteNotificationChannel && (
                            <s-text variation="subdued">
                              {permissionHint("delete-notification-channel")}
                            </s-text>
                          )}
                        </Form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </s-data-table>

            <s-card padding="base">
              <s-heading level="3">Add notification webhook</s-heading>
              <Form method="post">
                <input type="hidden" name="intent" value="connect-slack-webhook" />
                <s-stack direction="inline" gap="base" wrap>
                  <s-select
                    name="channelType"
                    label="Channel type"
                    defaultValue={NOTIFICATION_CHANNEL_TYPES.SLACK}
                    options={NOTIFICATION_TYPE_OPTIONS}
                  ></s-select>
                  <s-text-field
                    name="notificationLabel"
                    label="Label"
                    placeholder="Ops channel"
                  ></s-text-field>
                  <s-text-field
                    name="webhookUrl"
                    label="Webhook URL"
                    type="url"
                    placeholder="https://hooks.slack.com/services/..."
                    required
                  ></s-text-field>
                  <s-button
                    type="submit"
                    variant="primary"
                    disabled={!intentAccess.connectSlackWebhook}
                    {...(connectingSlack ? { loading: true } : {})}
                  >
                    Save webhook
                  </s-button>
                  {!intentAccess.connectSlackWebhook && (
                    <s-text variation="subdued">{permissionHint("connect-slack-webhook")}</s-text>
                  )}
                </s-stack>
              </Form>
              <Form method="post" style={{ marginTop: "1rem" }}>
                <input type="hidden" name="intent" value="test-slack-notification" />
                <s-button
                  type="submit"
                  variant="secondary"
                  disabled={!intentAccess.testSlackNotification}
                  {...(testingSlack ? { loading: true } : {})}
                >
                  Send test notification
                </s-button>
                {!intentAccess.testSlackNotification && (
                  <s-text variation="subdued">{permissionHint("test-slack-notification")}</s-text>
                )}
              </Form>
            </s-card>
          </div>
        </s-stack>
      </s-section>

      <s-section heading="Report schedules">
        <s-stack direction="block" gap="base">
          <s-card padding="base">
            <s-heading level="3">Automated digests</s-heading>
            <s-text variation="subdued">
              定期生成关键利润指标的电子邮件报表，提醒团队关注收入、广告投入和净利润。
            </s-text>
            <s-data-table>
              <table>
                <thead>
                  <tr>
                    <th align="left">Frequency</th>
                    <th align="left">Channel</th>
                    <th align="left">Recipients</th>
                    <th align="left">Subject prefix</th>
                    <th align="left">Created</th>
                    <th align="left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reportSchedules.length === 0 && (
                    <tr>
                      <td colSpan="6">
                        <s-text variation="subdued">
                          暂未配置定时报表。创建一个即可接收自动摘要。
                        </s-text>
                      </td>
                    </tr>
                  )}
                  {reportSchedules.map((schedule) => (
                    <tr key={schedule.id}>
                      <td>{formatFrequencyLabel(schedule.frequency)}</td>
                      <td>{formatChannelLabel(schedule.channel)}</td>
                      <td>{schedule.recipients}</td>
                      <td>{schedule.settings?.subjectPrefix ?? "—"}</td>
                      <td>{formatDateTime(schedule.createdAt)}</td>
                      <td>
                        <Form method="post">
                          <input type="hidden" name="intent" value="delete-report-schedule" />
                          <input type="hidden" name="scheduleId" value={schedule.id} />
                          <s-button
                            type="submit"
                            variant="destructive"
                            disabled={!intentAccess.deleteReportSchedule}
                            {...(deletingReportScheduleId === schedule.id ? { loading: true } : {})}
                          >
                            Delete
                          </s-button>
                          {!intentAccess.deleteReportSchedule && (
                            <s-text variation="subdued">
                              {permissionHint("delete-report-schedule")}
                            </s-text>
                          )}
                        </Form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </s-data-table>
          </s-card>

          <s-card padding="base">
            <s-heading level="3">Create report schedule</s-heading>
            <Form method="post">
              <input type="hidden" name="intent" value="create-report-schedule" />
              <s-stack direction="block" gap="base">
                <label>
                  Frequency
                  <select name="frequency" defaultValue="DAILY">
                    {REPORT_FREQUENCY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Channel
                  <select name="channel" defaultValue="EMAIL">
                    {REPORT_CHANNEL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <s-text-field
                  name="recipients"
                  label="Recipients"
                  placeholder="you@example.com, finance@example.com"
                ></s-text-field>
                <s-text-field
                  name="webhookUrl"
                  label="Webhook URL (for Webhook channel)"
                  placeholder="https://hooks.make.com/..."
                ></s-text-field>
                <s-text-field
                  name="subjectPrefix"
                  label="Subject prefix (optional)"
                  placeholder="[Profit Pulse]"
                ></s-text-field>
                <s-button
                  type="submit"
                  variant="primary"
                  disabled={!intentAccess.createReportSchedule}
                  {...(creatingReportSchedule ? { loading: true } : {})}
                >
                  Save schedule
                </s-button>
                {!intentAccess.createReportSchedule && (
                  <s-text variation="subdued">
                    {permissionHint("create-report-schedule")}
                  </s-text>
                )}
              </s-stack>
            </Form>
          </s-card>
        </s-stack>
      </s-section>

      <s-section heading="Currency & exchange rates">
        <s-card padding="base">
          <s-heading level="3">Master currency</s-heading>
          <s-text variation="subdued">
            Merchant base currency: {masterCurrency}. Store currency: {primaryStore?.currency ?? masterCurrency}.
          </s-text>
          <s-text variation="subdued">
            Last rate snapshot: {exchangeRates?.asOf ? new Date(exchangeRates.asOf).toLocaleString() : "—"}
          </s-text>
          <Form method="post">
            <input type="hidden" name="intent" value="refresh-exchange-rates" />
            <s-button
              type="submit"
              variant="secondary"
              disabled={!intentAccess.refreshExchangeRates}
            >
              Refresh exchange rates
            </s-button>
            {!intentAccess.refreshExchangeRates && (
              <s-text variation="subdued">{permissionHint("refresh-exchange-rates")}</s-text>
            )}
          </Form>
        </s-card>
      </s-section>

      <s-section heading="Privacy & compliance">
        <s-stack direction="block" gap="base">
          <s-card padding="base">
            <s-heading level="3">GDPR data subject tools</s-heading>
            <s-text variation="subdued">
              Queue exports or deletion requests for individual customers. Exports compile
              orders, refunds, and attribution data into a downloadable JSON file. Deletions anonymize
              matching orders across all connected stores.
            </s-text>
            <s-stack direction="inline" gap="base" wrap style={{ marginTop: "1rem" }}>
              <Form method="post">
                <input type="hidden" name="intent" value="queue-gdpr-export" />
                <s-stack direction="block" gap="base">
                  <s-text-field
                    name="subjectEmail"
                    type="email"
                    label="Customer email"
                    placeholder="customer@example.com"
                    required
                  ></s-text-field>
                  <s-button
                    type="submit"
                    variant="primary"
                    disabled={!intentAccess.queueGdprExport}
                    {...(queueingGdprExport ? { loading: true } : {})}
                  >
                    Queue export
                  </s-button>
                  {!intentAccess.queueGdprExport && (
                    <s-text variation="subdued">{permissionHint("queue-gdpr-export")}</s-text>
                  )}
                </s-stack>
              </Form>
              <Form method="post">
                <input type="hidden" name="intent" value="queue-gdpr-deletion" />
                <s-stack direction="block" gap="base">
                  <s-text-field
                    name="subjectEmail"
                    type="email"
                    label="Customer email"
                    placeholder="customer@example.com"
                    required
                  ></s-text-field>
                  <s-button
                    type="submit"
                    variant="secondary"
                    tone="critical"
                    disabled={!intentAccess.queueGdprDeletion}
                    {...(queueingGdprDeletion ? { loading: true } : {})}
                  >
                    Queue deletion
                  </s-button>
                  {!intentAccess.queueGdprDeletion && (
                    <s-text variation="subdued">{permissionHint("queue-gdpr-deletion")}</s-text>
                  )}
                </s-stack>
              </Form>
            </s-stack>
          </s-card>

          <s-card padding="base">
            <s-heading level="3">Recent GDPR requests</s-heading>
            {gdprRequests.length === 0 ? (
              <s-text variation="subdued">No GDPR requests have been queued yet.</s-text>
            ) : (
              <s-data-table>
                <table>
                  <thead>
                    <tr>
                      <th align="left">Type</th>
                      <th align="left">Email</th>
                      <th align="left">Status</th>
                      <th align="left">Requested at</th>
                      <th align="left">Processed at</th>
                      <th align="left">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gdprRequests.map((request) => {
                      const statusLabel =
                        GDPR_STATUS_LABELS[request.status] ?? request.status;
                      const isProcessing =
                        processingGdprRequestId && processingGdprRequestId === request.id;
                      const canProcess =
                        intentAccess.processGdprRequest &&
                        (request.status === GdprRequestStatus.PENDING ||
                          request.status === GdprRequestStatus.FAILED);
                      const canDownload =
                        request.type === GdprRequestType.EXPORT &&
                        request.status === GdprRequestStatus.COMPLETED &&
                        request.exportPayload;
                      return (
                        <tr key={request.id}>
                          <td>{request.type === GdprRequestType.EXPORT ? "Export" : "Deletion"}</td>
                          <td>{request.subjectEmail}</td>
                          <td>{statusLabel}</td>
                          <td>{formatDateTime(request.createdAt)}</td>
                          <td>
                            {request.processedAt ? formatDateTime(request.processedAt) : "—"}
                          </td>
                          <td>
                            <s-stack direction="inline" gap="tight" wrap>
                              {canProcess && (
                                <Form method="post">
                                  <input type="hidden" name="intent" value="process-gdpr-request" />
                                  <input type="hidden" name="requestId" value={request.id} />
                                  <s-button
                                    type="submit"
                                    variant="secondary"
                                    disabled={!intentAccess.processGdprRequest}
                                    {...(isProcessing ? { loading: true } : {})}
                                  >
                                    Process
                                  </s-button>
                                </Form>
                              )}
                              {canDownload && (
                                <s-link
                                  href={`/app/settings/gdpr/${request.id}`}
                                  target="_blank"
                                  tone="primary"
                                >
                                  Download export
                                </s-link>
                              )}
                              {request.notes && (
                                <s-text variation="subdued">{request.notes}</s-text>
                              )}
                              {!canProcess && !canDownload && !request.notes && (
                                <s-text variation="subdued">—</s-text>
                              )}
                            </s-stack>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </s-data-table>
            )}
          </s-card>
        </s-stack>
      </s-section>

      <s-section heading="Plans & pricing">
        <s-stack direction="inline" gap="base" wrap>
          {settings.planOptions.map((option) => {
            const isCurrent = option.tier === settings.plan.tier;
            const loadingThisPlan =
              isSubmitting &&
              currentIntent === "change-plan" &&
              targetPlanTier === option.tier;
            return (
              <s-card key={option.tier} padding="base">
                <s-stack direction="block" gap="base">
                  <div>
                    <s-heading>{option.name}</s-heading>
                    <s-text variation="subdued">{option.description}</s-text>
                  </div>
                  <div>
                    <s-display-text size="small">
                      {formatCurrency(option.price, option.currency)}{" "}
                      <s-text variation="subdued">
                        {option.intervalLabel}
                      </s-text>
                    </s-display-text>
                    <s-text variation="subdued">
                      Includes {option.allowances.stores} stores ·{" "}
                      {option.allowances.orders.toLocaleString()} orders
                    </s-text>
                    <s-text variation="subdued">
                      {option.trialDays}-day free trial
                    </s-text>
                  </div>
                  <div>
                    <s-heading level="3">What&apos;s included</s-heading>
                    <s-unordered-list>
                      {option.features.map((feature) => (
                        <s-list-item key={feature}>{feature}</s-list-item>
                      ))}
                    </s-unordered-list>
                  </div>
                  {isCurrent ? (
                    <s-badge tone="success">Current plan</s-badge>
                  ) : option.billingKey ? (
                    <Form method="post">
                      <input type="hidden" name="intent" value="change-plan" />
                      <input type="hidden" name="planTier" value={option.tier} />
                      <s-button
                        type="submit"
                        variant="primary"
                        disabled={!intentAccess.changePlan}
                        {...(loadingThisPlan ? { loading: true } : {})}
                      >
                        Switch to {option.name}
                      </s-button>
                      {!intentAccess.changePlan && (
                        <s-text variation="subdued">{permissionHint("change-plan")}</s-text>
                      )}
                    </Form>
                  ) : (
                    <s-text variation="subdued">
                      Free tier 试用仅通过 Shopify 安装自动触发。
                    </s-text>
                  )}
                </s-stack>
              </s-card>
            );
          })}
        </s-stack>
      </s-section>

      {isFreeTier && (
        <s-section heading="Free tier notes">
          <s-card tone="info" padding="base">
            <s-heading level="3">Free tier workspace</s-heading>
            <s-text variation="subdued">
              当前工作区处于免费层，含 {freeTierAllowances.stores} 店铺、{freeTierAllowances.orders.toLocaleString()} 订单、{freeTierAllowances.adAccounts} 个广告账号额度。要解锁更多店铺与更高订单限额，请升级到 Basic / Pro 计划。
            </s-text>
          </s-card>
        </s-section>
      )}

      <s-section heading="Workspace sharing">
        <s-card padding="base">
          <s-heading level="3">多店铺聚合</s-heading>
          <s-text variation="subdued">
            通过相同 Shopify 所有者邮箱安装 Profit Pulse，可将多个店铺挂在同一个工作区（安装时使用的管理员账号即是该邮箱）。
          </s-text>
          <s-unordered-list>
            {(settings.stores ?? []).map((store) => (
              <s-list-item key={store.id}>
                {store.shopDomain} · 状态 {store.status} · {store.currency}
              </s-list-item>
            ))}
            {!settings.stores?.length && (
              <s-list-item>尚无其他店铺安装。</s-list-item>
            )}
          </s-unordered-list>
        </s-card>
      </s-section>

      <s-section heading="Cost & tax automation">
        <s-stack direction="block" gap="base">
          <s-card padding="base">
            <s-heading level="3">
              Logistics templates ({logisticsRules.length})
            </s-heading>
            <s-text variation="subdued">
              Define provider → region → weight brackets to estimate fulfillment cost on every order.
            </s-text>
            {logisticsRules.length > 0 && (
              <s-unordered-list>
                {logisticsRules.slice(0, 3).map((rule) => (
                  <s-list-item key={rule.id}>
                    {rule.provider ?? "Carrier"} · {rule.country ?? "Global"}
                    {rule.region ? ` / ${rule.region}` : ""}
                    · {rule.weightMin ?? 0}–{rule.weightMax ?? "∞"} kg ·
                    {rule.flatFee ?? 0}/{rule.perKg ?? 0} {rule.currency ?? "USD"}
                  </s-list-item>
                ))}
                {logisticsRules.length > 3 && (
                  <s-list-item>
                    +{logisticsRules.length - 3} more rules
                  </s-list-item>
                )}
              </s-unordered-list>
            )}
            <Form method="post">
              <input type="hidden" name="intent" value="import-logistics" />
              <label htmlFor="logisticsCsv" style={{ display: "block", marginBottom: "0.5rem" }}>
                CSV (provider,country,region,weight_min,weight_max,flat_fee,per_kg,currency,effective_from,effective_to)
              </label>
              <textarea
                id="logisticsCsv"
                name="logisticsCsv"
                rows="4"
                style={{ width: "100%", marginBottom: "0.5rem" }}
              ></textarea>
              <s-button
                type="submit"
                variant="primary"
                disabled={!intentAccess.importLogistics}
                {...(importingLogistics ? { loading: true } : {})}
              >
                Import logistics rates
              </s-button>
              {!intentAccess.importLogistics && (
                <s-text variation="subdued">
                  {permissionHint("import-logistics")}
                </s-text>
              )}
            </Form>
          </s-card>

          <s-card padding="base">
            <s-heading level="3">
              Tax rate templates ({taxRates.length})
            </s-heading>
            <s-text variation="subdued">
              Upload per-country/state tax rates so the profit engine can flag high-tax orders.
            </s-text>
            {taxRates.length > 0 && (
              <s-unordered-list>
                {taxRates.slice(0, 3).map((rate) => (
                  <s-list-item key={rate.id}>
                    {rate.country}
                    {rate.state ? ` / ${rate.state}` : ""}
                    · {Number(rate.rate ?? 0).toFixed(2)}%
                  </s-list-item>
                ))}
                {taxRates.length > 3 && (
                  <s-list-item>+{taxRates.length - 3} more tax rows</s-list-item>
                )}
              </s-unordered-list>
            )}
            <Form method="post">
              <input type="hidden" name="intent" value="import-tax-rates" />
              <label htmlFor="taxRatesCsv" style={{ display: "block", marginBottom: "0.5rem" }}>
                CSV (country,state,rate,effective_from,effective_to)
              </label>
              <textarea
                id="taxRatesCsv"
                name="taxRatesCsv"
                rows="4"
                style={{ width: "100%", marginBottom: "0.5rem" }}
              ></textarea>
              <s-button
                type="submit"
                variant="primary"
                disabled={!intentAccess.importTaxRates}
                {...(importingTaxRates ? { loading: true } : {})}
              >
                Import tax templates
              </s-button>
              {!intentAccess.importTaxRates && (
                <s-text variation="subdued">
                  {permissionHint("import-tax-rates")}
                </s-text>
              )}
            </Form>
          </s-card>

          <s-card padding="base">
            <s-heading level="3">ERP cost sync</s-heading>
            <s-text variation="subdued">
              Pull SKU cost updates from your ERP endpoint defined in `ERP_COST_SYNC_URL`.
            </s-text>
            <Form method="post">
              <input type="hidden" name="intent" value="sync-erp-costs" />
              <s-button
                type="submit"
                variant="secondary"
                disabled={!intentAccess.syncErpCosts}
                {...(syncingErpCosts ? { loading: true } : {})}
              >
                Sync ERP SKU costs
              </s-button>
              {!intentAccess.syncErpCosts && (
                <s-text variation="subdued">
                  {permissionHint("sync-erp-costs")}
                </s-text>
              )}
            </Form>
          </s-card>
        </s-stack>
      </s-section>

      <s-section heading="Usage & limits">
        <s-data-table>
          <table>
            <thead>
              <tr>
                <th align="left">Metric</th>
                <th align="left">Usage</th>
                <th align="left">Status</th>
              </tr>
            </thead>
            <tbody>
              {renderUsageRow("Stores", usage.stores)}
              {renderUsageRow("Ad accounts", usage.adAccounts)}
              {renderUsageRow("Orders this month", usage.orders)}
            </tbody>
          </table>
        </s-data-table>
      </s-section>

      <s-section heading={localized.auditHeading}>
        {auditLogs.length === 0 ? (
          <s-text variation="subdued">{localized.auditEmpty}</s-text>
        ) : (
          <s-data-table>
            <table>
              <thead>
                <tr>
                  <th align="left">{localized.auditTime}</th>
                  <th align="left">{localized.auditAction}</th>
                  <th align="left">{localized.auditDetails}</th>
                  <th align="left">{localized.auditUser}</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td>{new Date(log.createdAt).toLocaleString()}</td>
                    <td>{log.action}</td>
                    <td>{log.details ?? "—"}</td>
                    <td>{log.userEmail ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </s-data-table>
        )}
      </s-section>

      <s-section heading="Connected stores">
        <s-data-table>
          <table>
            <thead>
              <tr>
                <th align="left">Store domain</th>
                <th align="left">Status</th>
                <th align="left">Currency</th>
                <th align="left">Timezone</th>
                <th align="left">Installed</th>
              </tr>
            </thead>
            <tbody>
              {(settings.stores ?? []).map((store) => (
                <tr key={store.id}>
                  <td>{store.shopDomain}</td>
                  <td>{store.status}</td>
                  <td>{store.currency}</td>
                  <td>{store.timezone}</td>
                  <td>
                    {store.installedAt
                      ? new Date(store.installedAt).toLocaleDateString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-data-table>

        <s-banner tone="info">
          <s-text>
            To use ProfitPulse on another store, open that store&apos;s Shopify admin
            and install the app from the Shopify App Store. Each store has its own
            subscription and settings.
          </s-text>
        </s-banner>
      </s-section>

      <s-section heading="SKU cost table (COGS)">
        <Form method="post" encType="multipart/form-data">
          <input type="hidden" name="intent" value="import-cogs" />
          <s-stack direction="inline" gap="base" wrap>
            <label>
              <strong>Upload CSV</strong>
              <input type="file" name="cogsFile" accept=".csv" />
            </label>
            <s-button
              type="submit"
              variant="secondary"
              disabled={!intentAccess.importCogs}
              {...(importingCogs ? { loading: true } : {})}
            >
              Import SKU costs
            </s-button>
            {!intentAccess.importCogs && (
              <s-text variation="subdued">{permissionHint("import-cogs")}</s-text>
            )}
          </s-stack>
        </Form>
        <s-data-table>
          <table>
            <thead>
              <tr>
                <th align="left">SKU</th>
                <th align="left">Cost</th>
                <th align="left">Effective from</th>
                <th align="left">Effective to</th>
              </tr>
            </thead>
            <tbody>
              {settings.costConfig.skuCosts.length === 0 && (
                <tr>
                  <td colSpan="4">
                    <s-text variation="subdued">
                      No SKU costs yet. Load the demo data or sync from your ERP.
                    </s-text>
                  </td>
                </tr>
              )}
              {settings.costConfig.skuCosts.map((skuCost) => (
                <tr key={`${skuCost.sku}-${skuCost.id}`}>
                  <td>{skuCost.sku}</td>
                  <td>
                    {formatCurrency(
                      skuCost.costAmount,
                      skuCost.costCurrency ?? "USD",
                    )}
                  </td>
                  <td>{formatDateTime(skuCost.effectiveFrom)}</td>
                  <td>{formatDateTime(skuCost.effectiveTo) ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-data-table>
        <Form method="post">
          <input type="hidden" name="intent" value="seed-costs" />
          <s-button
            type="submit"
            variant="secondary"
            disabled={!intentAccess.seedCosts}
            {...(isSubmitting && currentIntent === "seed-costs"
              ? { loading: true }
              : {})}
          >
            Load demo COGS
          </s-button>
          {!intentAccess.seedCosts && (
            <s-text variation="subdued">{permissionHint("seed-costs")}</s-text>
          )}
        </Form>
      </s-section>

      <s-section heading="Variable cost templates">
        <s-stack direction="block" gap="base">
          {settings.costConfig.templates.length === 0 && (
            <s-text variation="subdued">
              No cost templates yet. Load the demo set above or create one via
              the API.
            </s-text>
          )}
          {settings.costConfig.templates.map((template) => (
            <s-card key={template.id} padding="base">
              <s-heading>
                {template.name} · <code>{template.type}</code>
              </s-heading>
              <s-text variation="subdued">
                Applies to: {template.config?.appliesTo ?? "ORDER_TOTAL"}
              </s-text>
              <s-unordered-list>
                {template.lines.map((line) => (
                  <s-list-item key={line.id}>
                    {line.label}:{" "}
                    {line.percentageRate
                      ? `${(Number(line.percentageRate) * 100).toFixed(2)}%`
                      : ""}
                    {line.flatAmount
                      ? ` + ${formatCurrency(line.flatAmount)} per order`
                      : ""}
                  </s-list-item>
                ))}
              </s-unordered-list>
            </s-card>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Fixed cost allocation">
        <s-data-table>
          <table>
            <thead>
              <tr>
                <th align="left">Label</th>
                <th align="left">Cadence</th>
                <th align="left">Amount</th>
                <th align="left">Allocation</th>
                <th align="left">Notes</th>
                <th align="left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {fixedCosts.length === 0 && (
                <tr>
                  <td colSpan="6">
                    <s-text variation="subdued">
                      No fixed costs yet. Add rent, payroll, or software expenses
                      below to distribute them across performance reports.
                    </s-text>
                  </td>
                </tr>
              )}
              {fixedCosts.map((cost) => (
                <tr key={cost.id}>
                  <td>{cost.label}</td>
                  <td>{formatCadence(cost.cadence)}</td>
                  <td>{formatCurrency(cost.amount, cost.currency)}</td>
                  <td>{formatAllocationRule(cost.allocation)}</td>
                  <td>{cost.notes ?? "—"}</td>
                  <td>
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete-fixed-cost" />
                      <input type="hidden" name="fixedCostId" value={cost.id} />
                      <s-button
                        type="submit"
                        variant="destructive"
                        disabled={!intentAccess.deleteFixedCost}
                        {...(deletingFixedCostId === cost.id ? { loading: true } : {})}
                      >
                        Remove
                      </s-button>
                      {!intentAccess.deleteFixedCost && (
                        <s-text variation="subdued">{permissionHint("delete-fixed-cost")}</s-text>
                      )}
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-data-table>

        <s-card padding="base">
          <s-heading level="3">Add fixed cost</s-heading>
          <Form method="post">
            <input type="hidden" name="intent" value="create-fixed-cost" />
            <s-stack direction="inline" gap="base" wrap>
              <s-text-field
                name="fixedCostLabel"
                label="Label"
                placeholder="Rent, payroll, software..."
                required
              ></s-text-field>
              <s-text-field
                name="fixedCostAmount"
                label="Amount"
                type="number"
                min="0"
                step="0.01"
                required
              ></s-text-field>
              <label>
                Currency
                <select name="fixedCostCurrency" defaultValue={defaultCurrency}>
                  <option value="USD">USD</option>
                  <option value="CAD">CAD</option>
                  <option value="EUR">EUR</option>
                  <option value={defaultCurrency}>{defaultCurrency}</option>
                </select>
              </label>
              <label>
                Cadence
                <select name="fixedCostCadence" defaultValue="MONTHLY">
                  {FIXED_COST_CADENCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Allocation
                <select
                  name="fixedCostAllocationType"
                  value={fixedCostAllocationType}
                  onChange={(event) => setFixedCostAllocationType(event.target.value)}
                >
                  {FIXED_COST_ALLOCATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {fixedCostAllocationType === "CHANNEL" && (
                <label>
                  Channel code
                  <input
                    type="text"
                    name="fixedCostAllocationChannel"
                    placeholder="e.g. GOOGLE_ADS"
                  />
                </label>
              )}
            </s-stack>
            <s-stack direction="block" gap="base" style={{ marginTop: "1rem" }}>
              <s-text-field
                name="fixedCostNotes"
                label="Notes"
                placeholder="Optional memo for this cost"
              ></s-text-field>
              <s-button
                type="submit"
                variant="primary"
                disabled={!intentAccess.createFixedCost}
                {...(creatingFixedCost ? { loading: true } : {})}
              >
                Save fixed cost
              </s-button>
              {!intentAccess.createFixedCost && (
                <s-text variation="subdued">{permissionHint("create-fixed-cost")}</s-text>
              )}
            </s-stack>
          </Form>
        </s-card>
      </s-section>

      <s-section heading="Team members">
        <s-data-table>
          <table>
            <thead>
              <tr>
                <th align="left">Name</th>
                <th align="left">Email</th>
                <th align="left">Role</th>
                <th align="left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {teamMembers.map((member) => {
                const updating =
                  isSubmitting &&
                  pendingMemberId === member.id &&
                  currentIntent === "update-member-role";
                const removing =
                  isSubmitting &&
                  pendingMemberId === member.id &&
                  currentIntent === "remove-member";
                return (
                  <tr key={member.id}>
                    <td>{member.name ?? "—"}</td>
                    <td>{member.email}</td>
                    <td>
                      <Form method="post">
                        <input type="hidden" name="intent" value="update-member-role" />
                        <input type="hidden" name="memberId" value={member.id} />
                        <select name="role" defaultValue={member.role}>
                          {TEAM_ROLE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <s-button
                          type="submit"
                          variant="secondary"
                          disabled={!intentAccess.updateMemberRole}
                          {...(updating ? { loading: true } : {})}
                        >
                          Update
                        </s-button>
                        {!intentAccess.updateMemberRole && (
                          <s-text variation="subdued">
                            {permissionHint("update-member-role")}
                          </s-text>
                        )}
                      </Form>
                    </td>
                    <td>
                      <Form method="post">
                        <input type="hidden" name="intent" value="remove-member" />
                        <input type="hidden" name="memberId" value={member.id} />
                        <s-button
                          type="submit"
                          variant="destructive"
                          disabled={!intentAccess.removeMember}
                          {...(removing ? { loading: true } : {})}
                        >
                          Remove
                        </s-button>
                        {!intentAccess.removeMember && (
                          <s-text variation="subdued">
                            {permissionHint("remove-member")}
                          </s-text>
                        )}
                      </Form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </s-data-table>

            <s-card padding="base">
              <s-heading level="3">Invite teammate</s-heading>
              <Form method="post">
                <input type="hidden" name="intent" value="invite-member" />
                <s-stack direction="inline" gap="base" wrap>
                  <s-text-field name="email" label="Email" type="email" required></s-text-field>
                  <s-text-field name="name" label="Name"></s-text-field>
                  <label>
                    Role
                    <select name="role" defaultValue="FINANCE">
                      {TEAM_ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                  ))}
                </select>
                  </label>
                  <s-button
                    type="submit"
                    variant="primary"
                    disabled={!intentAccess.inviteMember}
                    {...(isSubmitting && currentIntent === "invite-member" ? { loading: true } : {})}
                  >
                    Send invite
                  </s-button>
                  {!intentAccess.inviteMember && (
                    <s-text variation="subdued">{permissionHint("invite-member")}</s-text>
                  )}
                </s-stack>
              </Form>
            </s-card>
          </s-section>

      <s-section slot="aside" heading="Profit engine sandbox">
        <s-paragraph>
          Use demo inputs to run the cost pipeline and populate profit
          analytics, then review the dashboard numbers.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="simulate-order" />
          <s-button
            type="submit"
            variant="primary"
            disabled={!intentAccess.simulateOrder}
            {...(isSubmitting && currentIntent === "simulate-order"
              ? { loading: true }
              : {})}
          >
            Process demo order
          </s-button>
          {!intentAccess.simulateOrder && (
            <s-text variation="subdued">{permissionHint("simulate-order")}</s-text>
          )}
        </Form>
      </s-section>
    </s-page>
  );
}

function formatDateTime(value) {
  if (!value) return undefined;
  return new Date(value).toLocaleDateString();
}

function UsageMeter({ label, usage, percent }) {
  if (!usage) return null;
  const limit = usage.limit ?? null;
  const gaugePercent =
    typeof percent === "number"
      ? percent
      : limit
        ? Math.min(100, (usage.count / limit) * 100)
        : null;
  const meterTone =
    usage.status === "danger"
      ? "#dc2626"
      : usage.status === "warning"
        ? "#f97316"
        : "#10b981";

  return (
    <div style={{ marginTop: "0.25rem" }}>
      <s-text variation="subdued">
        {label}: {usage.count.toLocaleString()}
        {limit ? ` / ${limit.toLocaleString()} allowed` : ""}
      </s-text>
      {gaugePercent !== null && (
        <div
          style={{
            marginTop: "0.35rem",
            background: "#e5e7eb",
            borderRadius: "999px",
            height: "0.4rem",
            overflow: "hidden",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: `${gaugePercent}%`,
              background: meterTone,
              height: "100%",
              borderRadius: "999px",
              transition: "width 0.3s ease",
            }}
          />
        </div>
      )}
    </div>
  );
}

function renderUsageRow(label, usage) {
  if (!usage) return null;
  const tone =
    usage.status === "danger"
      ? "critical"
      : usage.status === "warning"
        ? "warning"
        : "success";
  return (
    <tr key={label}>
      <td>{label}</td>
      <td>
        {usage.count.toLocaleString()}
        {usage.limit ? ` / ${usage.limit.toLocaleString()}` : ""}
      </td>
      <td>
        <s-badge tone={tone}>
          {usage.status === "ok"
            ? "On track"
            : usage.status === "warning"
              ? "Approaching limit"
              : "Limit reached"}
        </s-badge>
      </td>
    </tr>
  );
}

function formatCadence(code) {
  switch (code) {
    case "DAILY":
      return "Daily";
    case "WEEKLY":
      return "Weekly";
    case "QUARTERLY":
      return "Quarterly";
    case "YEARLY":
      return "Yearly";
    case "MONTHLY":
    default:
      return "Monthly";
  }
}

function formatAllocationRule(value) {
  if (!value || value === "REVENUE") {
    return "Revenue share";
  }
  if (value === "ORDERS") {
    return "Order share";
  }
  if (value.startsWith("CHANNEL:")) {
    const channel = value.split(":")[1] || "";
    return channel ? `Channel ${channel}` : "Channel allocation";
  }
  return value;
}

function renderAdCredentialFields(providerId) {
  if (providerId === "META_ADS") {
    return (
      <>
        <s-text-field
          name="accountId"
          label="Ad account ID"
          placeholder="act_123456789"
          required
        ></s-text-field>
        <s-text-field
          name="accountName"
          label="Nickname"
          placeholder="Brand main account"
        ></s-text-field>
        <s-text-field
          name="accessToken"
          label="System user access token"
          type="password"
          required
        ></s-text-field>
        <s-text variation="subdued">
          Use a Meta Marketing API system user token with ads_read + ads_management scopes.
        </s-text>
      </>
    );
  }

  if (providerId === "GOOGLE_ADS") {
    return (
      <>
        <s-text-field
          name="accountId"
          label="Customer ID"
          placeholder="123-456-7890"
          required
        ></s-text-field>
        <s-text-field
          name="accountName"
          label="Nickname"
          placeholder="Google master account"
        ></s-text-field>
        <s-text-field
          name="accessToken"
          label="OAuth access token"
          type="password"
          required
        ></s-text-field>
        <s-text-field
          name="developerToken"
          label="Developer token"
          type="password"
          required
        ></s-text-field>
        <s-text-field
          name="loginCustomerId"
          label="Login customer ID (optional)"
          placeholder="Manager account ID"
        ></s-text-field>
        <s-text variation="subdued">
          Provide a refreshable OAuth token with Google Ads API access and your developer token.
        </s-text>
      </>
    );
  }

  if (providerId === "BING_ADS") {
    return (
      <>
        <s-text-field
          name="accountId"
          label="Account ID"
          placeholder="Bing account ID"
          required
        ></s-text-field>
        <s-text-field
          name="accountName"
          label="Nickname"
          placeholder="Bing marketing"
        ></s-text-field>
        <s-text-field
          name="accessToken"
          label="Access token / API key"
          type="password"
          required
        ></s-text-field>
        <s-text variation="subdued">
          TikTok/Bing connectors are placeholders for future support; fill in provisional values for now.
        </s-text>
      </>
    );
  }

  if (providerId === "TIKTOK_ADS") {
    return (
      <>
        <s-text-field
          name="accountId"
          label="Ad account ID"
          placeholder="1234567890"
          required
        ></s-text-field>
        <s-text-field
          name="accountName"
          label="Nickname"
          placeholder="TikTok master"
        ></s-text-field>
        <s-text-field
          name="accessToken"
          label="Access token"
          type="password"
          required
        ></s-text-field>
        <s-text variation="subdued">
          TikTok connector is not active yet; this form captures the credentials we will use in the future.
        </s-text>
      </>
    );
  }

  return (
    <s-text variation="subdued">
      Enter the required credentials to connect this provider.
    </s-text>
  );
}

function renderLogisticsCredentialFields(providerId) {
  if (providerId === "EASYPOST_LOGISTICS") {
    return (
      <>
        <s-text-field
          name="accountName"
          label="Account label"
          placeholder="EasyPost account"
        ></s-text-field>
        <s-text-field
          name="accountId"
          label="Carrier account ID"
          placeholder="ca_123"
        ></s-text-field>
        <s-text-field
          name="apiKey"
          label="API key"
          placeholder="EZTK..."
          required
        ></s-text-field>
        <s-text-field
          name="carrierAccounts"
          label="Carrier accounts (comma separated)"
          placeholder="ups,usps"
        ></s-text-field>
        <s-text-field
          name="baseUrl"
          label="API base URL"
          placeholder="https://api.easypost.com"
        ></s-text-field>
      </>
    );
  }

  if (providerId === "SHIPSTATION_LOGISTICS") {
    return (
      <>
        <s-text-field
          name="accountName"
          label="Account label"
          placeholder="ShipStation connection"
        ></s-text-field>
        <s-text-field
          name="accountId"
          label="Store ID"
          placeholder="12345"
        ></s-text-field>
        <s-text-field
          name="apiKey"
          label="API key"
          required
        ></s-text-field>
        <s-text-field
          name="apiSecret"
          label="API secret"
          type="password"
          required
        ></s-text-field>
        <s-text-field
          name="baseUrl"
          label="API base URL"
          placeholder="https://ssapi.shipstation.com"
        ></s-text-field>
      </>
    );
  }

  return (
    <>
      <s-text-field name="accountName" label="Account label"></s-text-field>
      <s-text-field name="apiKey" label="API key" required></s-text-field>
    </>
  );
}

function AggregateMetricCard({
  label,
  value,
  currency = "USD",
  variant = "currency",
}) {
  let displayValue;
  if (variant === "percentage") {
    displayValue = formatPercent(value);
  } else {
    displayValue = formatCurrency(value ?? 0, currency);
  }

  return (
    <s-card padding="base">
      <s-text variation="subdued">{label}</s-text>
      <s-display-text size="small">{displayValue}</s-display-text>
    </s-card>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
