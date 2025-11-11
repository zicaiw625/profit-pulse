import { Buffer } from "node:buffer";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
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
import { syncShopifyPayments } from "../services/sync/payment-payouts.server";
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
import { importPaypalPayoutCsv } from "../services/imports/paypal-fees.server";
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

const REPORT_FREQUENCY_OPTIONS = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
];

const REPORT_CHANNEL_OPTIONS = [
  { value: "EMAIL", label: "Email" },
];

const NOTIFICATION_TYPE_OPTIONS = [
  { value: NOTIFICATION_CHANNEL_TYPES.SLACK, label: "Slack (Webhook)" },
  { value: NOTIFICATION_CHANNEL_TYPES.TEAMS, label: "Microsoft Teams (Webhook)" },
];

const NOTIFICATION_TYPE_LABELS = {
  [NOTIFICATION_CHANNEL_TYPES.SLACK]: "Slack",
  [NOTIFICATION_CHANNEL_TYPES.TEAMS]: "Microsoft Teams",
};

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
  "import-cogs": ["OWNER", "FINANCE"],
  "invite-member": ["OWNER"],
  "update-member-role": ["OWNER"],
  "remove-member": ["OWNER"],
  "change-plan": ["OWNER"],
  "create-fixed-cost": ["OWNER", "FINANCE"],
  "delete-fixed-cost": ["OWNER", "FINANCE"],
  "create-report-schedule": ["OWNER", "FINANCE"],
  "delete-report-schedule": ["OWNER", "FINANCE"],
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
  "import-cogs": "Import COGS CSV",
  "invite-member": "Invite teammate",
  "update-member-role": "Update teammate role",
  "remove-member": "Remove teammate",
  "change-plan": "Switch plan",
  "create-fixed-cost": "Add fixed cost",
  "delete-fixed-cost": "Remove fixed cost",
  "create-report-schedule": "Add report schedule",
  "delete-report-schedule": "Remove report schedule",
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
  const store = await ensureMerchantAndStore(session.shop);
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
  return { settings, storeId: store.id, currentRole };
};

export const action = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop);
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

    return { message: "广告账号已断开连接。" };
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

    return { message: "通知渠道已保存。" };
  }

  if (intent === "delete-notification-channel") {
    const channelId = formData.get("channelId")?.toString();
    if (!channelId) {
      return { message: "缺少需要删除的通知渠道。" };
    }
    await deleteNotificationChannel({ merchantId: store.merchantId, channelId });
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
    return { message: "汇率已刷新。" };
  }

  if (intent === "import-paypal-csv") {
    const file = formData.get("paypalCsv");
    if (!(file instanceof File)) {
      return { message: "请上传 PayPal CSV 文件。" };
    }
    const content = Buffer.from(await file.arrayBuffer()).toString("utf-8");
    try {
      const count = await importPaypalPayoutCsv({ storeId: store.id, csv: content });
      return { message: `已导入 ${count} 条 PayPal 结算记录。` };
    } catch (error) {
      console.error(error);
      return { message: error.message ?? "无法解析 PayPal CSV，请检查格式。" };
    }
  }

  if (intent === "sync-orders") {
    try {
      const result = await syncShopifyOrders({ store, session, days: 7 });
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
      return { message: "Shopify Payments payouts refreshed." };
    } catch (error) {
      console.error(error);
      return {
        message: "Failed to sync Shopify Payments. Try again shortly.",
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
    return { message: `Invitation sent to ${email}.` };
  }

  if (intent === "update-member-role") {
    const memberId = formData.get("memberId");
    const role = formData.get("role");
    if (!memberId || !role) {
      return { message: "Member and role are required." };
    }
    await updateTeamMemberRole({ memberId, role });
    return { message: "Team member updated." };
  }

  if (intent === "remove-member") {
    const memberId = formData.get("memberId");
    if (!memberId) {
      return { message: "Member id missing." };
    }
    await removeTeamMember(memberId);
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
    const notes = formData.get("fixedCostNotes")?.toString().trim();

    if (!label || !Number.isFinite(amountValue) || amountValue <= 0) {
      return { message: "请输入有效的固定成本名称与金额。" };
    }

    await createFixedCost({
      merchantId: store.merchantId,
      label,
      amount: amountValue,
      currency,
      cadence,
      allocation: "REVENUE",
      appliesTo: "ALL",
      notes,
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

    return { message: "固定成本已移除。" };
  }

  if (intent === "create-report-schedule") {
    const frequency = formData.get("frequency") ?? "DAILY";
    const channel = formData.get("channel") ?? "EMAIL";
    const recipients = formData.get("recipients")?.toString() ?? "";
    const subjectPrefix = formData.get("subjectPrefix")?.toString().trim();
    try {
      await createReportSchedule({
        merchantId: store.merchantId,
        frequency,
        channel,
        recipients,
        settings: subjectPrefix ? { subjectPrefix } : {},
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
    return { message: "Report schedule removed." };
  }

  return { message: "No action performed." };
};

export default function SettingsPage() {
  const { settings, currentRole } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const currentIntent = navigation.formData?.get("intent");
  const isSubmitting = navigation.state === "submitting";
  const primaryStore = settings.stores?.[0];
  const masterCurrency =
    settings.primaryCurrency || primaryStore?.merchantCurrency || primaryStore?.currency || "USD";
  const merchantSummary = settings.merchantSummary ?? null;
  const aggregateRangeLabel = merchantSummary?.range
    ? `${formatDateShort(merchantSummary.range.start)} – ${formatDateShort(
        merchantSummary.range.end,
      )}`
    : "";
  const targetPlanTier = navigation.formData?.get("planTier");
  const targetProvider = navigation.formData?.get("provider");
  const pendingMemberId = navigation.formData?.get("memberId");

  const usage = settings.planUsage;
  const orderWarning =
    usage?.orders?.status === "warning" || usage?.orders?.status === "danger";
  const shopifyData = settings.shopifyData ?? {};
  const teamMembers = settings.teamMembers ?? [];
  const integrations = settings.integrations ?? {};
  const fixedCosts = settings.fixedCosts ?? [];
  const notificationChannels = settings.notifications ?? [];
  const exchangeRates = settings.exchangeRates ?? {};
  const reportSchedules = settings.reportSchedules ?? [];
  const defaultCurrency = primaryStore?.currency ?? "USD";
  const syncingOrders =
    isSubmitting && currentIntent === "sync-orders";
  const syncingPayments =
    isSubmitting && currentIntent === "sync-payments";
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
  const connectingAdProvider =
    isSubmitting && currentIntent === "connect-ad-credential"
      ? navigation.formData?.get("provider")
      : null;
  const disconnectingAdProvider =
    isSubmitting && currentIntent === "disconnect-ad-credential"
      ? navigation.formData?.get("provider")
      : null;
  const deletingChannelId =
    isSubmitting && currentIntent === "delete-notification-channel"
      ? navigation.formData?.get("channelId")
      : null;
  const connectingSlack = currentIntent === "connect-slack-webhook" && isSubmitting;
  const testingSlack = currentIntent === "test-slack-notification" && isSubmitting;
  const importingPaypal = currentIntent === "import-paypal-csv" && isSubmitting;

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
  };

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
        <s-banner
          tone={usage.orders.status === "danger" ? "critical" : "warning"}
          title="Order allowance nearly reached"
        >
          <s-text>
            {usage.orders.count.toLocaleString()} of{" "}
            {usage.orders.limit.toLocaleString()} monthly orders processed. Upgrade
            your plan to avoid paused ingestion.
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
            </div>
            <s-stack direction="inline" gap="base">
              <s-badge tone="success">{settings.plan.limits.stores}</s-badge>
              <s-badge tone="info">{settings.plan.limits.orders}</s-badge>
            </s-stack>
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
            <s-heading level="3">Payment processors</s-heading>
            <s-stack direction="inline" gap="base" wrap>
              {settings.integrations.payments.map((integration) => {
                const syncLoading =
                  syncingPayments && targetProvider === integration.id;
                const isPaypal = integration.id === "PAYPAL";
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
                    {isPaypal ? (
                      <Form method="post" encType="multipart/form-data">
                        <input type="hidden" name="intent" value="import-paypal-csv" />
                        <s-stack direction="block" gap="base">
                          <label>
                            Upload CSV
                            <input type="file" name="paypalCsv" accept=".csv" />
                          </label>
                          <s-button
                            type="submit"
                            variant="secondary"
                            disabled={!intentAccess.importPaypalCsv}
                            {...(importingPaypal ? { loading: true } : {})}
                          >
                            Import PayPal CSV
                          </s-button>
                      {!intentAccess.importPaypalCsv && (
                        <s-text variation="subdued">
                          {permissionHint("import-paypal-csv")}
                        </s-text>
                      )}
                          </s-stack>
                        </Form>
                      ) : (
                        <Form method="post">
                          <input type="hidden" name="intent" value="sync-payments" />
                          <input type="hidden" name="provider" value={integration.id} />
                          <s-button
                            type="submit"
                            variant="secondary"
                            disabled={!intentAccess.syncPayments}
                            {...(syncLoading ? { loading: true } : {})}
                          >
                            Sync payouts
                          </s-button>
                          {!intentAccess.syncPayments && (
                            <s-text variation="subdued">{permissionHint("sync-payments")}</s-text>
                          )}
                        </Form>
                    )}
                  </s-card>
                );
              })}
            </s-stack>
          </div>
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
                  required
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
                  ) : (
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
                  )}
                </s-stack>
              </s-card>
            );
          })}
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
              {settings.stores.map((store) => (
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
        <Form method="get" action="/auth/login">
          <s-button type="submit" variant="primary">
            Connect another store
          </s-button>
        </Form>
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
                <th align="left">Notes</th>
                <th align="left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {fixedCosts.length === 0 && (
                <tr>
                  <td colSpan="5">
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

  return (
    <s-text variation="subdued">
      Enter the required credentials to connect this provider.
    </s-text>
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
