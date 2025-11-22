import { Form, redirect, useActionData, useLoaderData, useRouteError, useSearchParams } from "react-router";
import { json } from "@remix-run/node";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { getAccountSettings } from "../services/settings.server";
import { importSkuCostsFromCsv, seedDemoCostConfiguration } from "../services/costs.server";
import { MissingShopifyScopeError, syncShopifyOrders } from "../services/sync/shopify-orders.server";
import { syncShopifyPayments } from "../services/sync/payment-payouts.server";
import { syncAdProvider } from "../services/sync/ad-spend.server";
import { requestPlanChange } from "../services/billing.server";
import { CredentialProvider } from "@prisma/client";
import { useLocale } from "../hooks/useLocale";
import { getLanguageFromRequest } from "../utils/i18n";
import { useAppUrlBuilder } from "../hooks/useAppUrlBuilder";
import { formatDate, formatDateTime, formatNumber } from "../utils/formatting";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  const settings = await getAccountSettings({ store });
  return json({ settings, store });
};

export const action = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const lang = getLanguageFromRequest(request);
  const actionsCopy = (SETTINGS_COPY[lang] ?? SETTINGS_COPY.en).actions;

  try {
    switch (intent) {
      case "import-costs": {
        const file = formData.get("file");
        if (!(file instanceof File)) {
          throw new Error(actionsCopy.csvRequired);
        }
        const csv = await file.text();
        await importSkuCostsFromCsv({ storeId: store.id, csv, defaultCurrency: store.currency });
        return json({ success: true, message: actionsCopy.importSuccess });
      }
      case "seed-demo-costs":
        await seedDemoCostConfiguration({ storeId: store.id, currency: store.currency });
        return json({ success: true, message: actionsCopy.seedSuccess });
      case "sync-shopify-orders":
        await syncShopifyOrders({ store, session, days: 30, useRequestedLookback: true });
        return json({
          success: true,
          message: actionsCopy.syncOrders,
        });
      case "sync-shopify-payments":
        await syncShopifyPayments({ store, session });
        return json({ success: true, message: actionsCopy.syncPayments });
      case "sync-meta-ads":
        await syncAdProvider({ store, provider: CredentialProvider.META_ADS, days: 30 });
        return json({ success: true, message: actionsCopy.syncMetaAds });
      case "change-plan": {
        const planTier = formData.get("planTier");
        if (!planTier) {
          throw new Error(actionsCopy.selectPlan);
        }
        const confirmationUrl = await requestPlanChange({
          planTier,
          billing,
          session,
          returnUrl: new URL("/app/settings", request.url).toString(),
        });
        return redirect(confirmationUrl);
      }
      default:
        return json({ success: false, message: actionsCopy.unsupported }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof MissingShopifyScopeError) {
      return json(
        {
          success: false,
          message: actionsCopy.missingScope,
        },
        { status: 400 },
      );
    }
    return json(
      {
        success: false,
        message: error.message || actionsCopy.genericError,
      },
      { status: 400 },
    );
  }
};

export default function SettingsPage() {
  const { settings } = useLoaderData();
  const actionData = useActionData();
  const [searchParams] = useSearchParams();
  const buildAppUrl = useAppUrlBuilder();
  const missingCostSkuCount = settings.missingCostSkuCount ?? 0;
  const { lang } = useLocale();
  const defaultTimeZone = settings.primaryTimezone || settings.stores[0]?.timezone || "UTC";
  const formatCount = (value) => formatNumber(value, lang);
  const formatDateOnly = (value, timeZone) =>
    formatDate(value, { lang, timeZone: timeZone || defaultTimeZone });
  const copy = SETTINGS_COPY[lang] ?? SETTINGS_COPY.en;
  const oauthProvider = searchParams.get("oauth");
  const oauthStatus = searchParams.get("status");
  const oauthMessage = searchParams.get("message");
  const oauthNotice =
    oauthProvider === "meta-ads" && oauthStatus
      ? {
          tone: oauthStatus === "success" ? "success" : "critical",
          message:
            oauthMessage ||
            (oauthStatus === "success"
              ? copy.integrations.metaAds.oauthSuccess
              : copy.integrations.metaAds.oauthError),
        }
      : null;

  return (
    <s-page heading={copy.pageTitle} subtitle={copy.pageSubtitle}>
      {actionData?.message && (
        <s-section>
          <s-banner tone={actionData.success ? "success" : "critical"} title={actionData.message} />
        </s-section>
      )}
      {oauthNotice && (
        <s-section>
          <s-banner tone={oauthNotice.tone} title={oauthNotice.message} />
        </s-section>
      )}

      <s-section heading={copy.sections.plan}>
        <PlanOverview plan={settings.plan} planOptions={settings.planOptions} copy={copy.plan} />
      </s-section>

      <s-section heading={copy.sections.stores}>
        <s-data-table>
          <table>
            <thead>
              <tr>
                <th align="left">{copy.storesTable.shopDomain}</th>
                <th align="left">{copy.storesTable.status}</th>
                <th align="left">{copy.storesTable.currency}</th>
                <th align="left">{copy.storesTable.timezone}</th>
                <th align="left">{copy.storesTable.installed}</th>
              </tr>
            </thead>
            <tbody>
              {settings.stores.map((store) => (
                <tr key={store.id}>
                  <td>{store.shopDomain}</td>
                  <td>{store.status}</td>
                  <td>{store.currency}</td>
                  <td>{store.timezone}</td>
                  <td>{formatDateOnly(store.installedAt, store.timezone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-data-table>
      </s-section>

      <s-section heading={copy.sections.integrations}>
        <IntegrationList
          integrations={settings.integrations}
          copy={copy.integrations}
          buildAppUrl={buildAppUrl}
          lang={lang}
          timeZone={defaultTimeZone}
        />
      </s-section>

      <div id="costs">
        {missingCostSkuCount > 0 && (
          <s-section>
            <s-banner tone="warning" title={copy.missingCost.title}>
              <s-text variation="subdued">{copy.missingCost.description(missingCostSkuCount)}</s-text>
            </s-banner>
          </s-section>
        )}
        <s-section heading={copy.sections.costs}>
          <CostConfiguration
            costConfig={settings.costConfig}
            primaryCurrency={settings.primaryCurrency}
            copy={copy.costs}
          />
        </s-section>
      </div>

      <s-section heading={copy.sections.manualSync}>
        <SyncTools copy={copy.syncTools} />
      </s-section>
    </s-page>
  );
}

const SETTINGS_COPY = {
  en: {
    pageTitle: "Workspace settings",
    pageSubtitle: "Plans, stores, integrations, and costs",
    sections: {
      plan: "Plan & billing",
      stores: "Connected stores",
      integrations: "Integrations",
      costs: "Cost configuration",
      manualSync: "Manual sync tools",
    },
    missingCost: {
      title: "Some SKUs are missing costs",
      description: (count) =>
        `Detected ${count} SKUs without costs configured; profit calculations may be inaccurate.`,
    },
    plan: {
      trialEnds: "Trial ends",
      orderAllowance: "Order allowance",
      storeAllowance: "Store allowance",
      switchPlan: "Switch plan",
      updatePlan: "Update plan",
      notAvailable: "N/A",
    },
    storesTable: {
      shopDomain: "Shop domain",
      status: "Status",
      currency: "Currency",
      timezone: "Timezone",
      installed: "Installed",
    },
    integrations: {
      notConnected: "Not connected.",
      statusLabel: "Status",
      lastSyncLabel: "Last sync",
      never: "Never",
      cards: {
        shopify: "Shopify",
        metaAds: "Meta Ads",
        shopifyPayments: "Shopify Payments",
        paypal: "PayPal",
      },
      metaAds: {
        connectCta: "Connect Meta Ads",
        reconnectCta: "Reconnect Meta Ads",
        accountIdLabel: "Meta Ads account ID",
        accountIdPlaceholder: "act_123456789",
        accountNameLabel: "Account name (optional)",
        accountNamePlaceholder: "e.g. Main account",
        helperText: "Use your Meta ad account ID to authorize spend syncing.",
        accountSummary: (name, id) => (name ? `${name} (${id})` : id),
        oauthSuccess: "Meta Ads connected successfully.",
        oauthError: "Meta Ads connection failed. Please try again.",
      },
    },
    costs: {
      uploadLabel: "Upload SKU cost CSV",
      import: "Import",
      seedDemo: "Seed demo costs",
      tableHeaders: {
        sku: "SKU",
        cost: (currency) => `Cost (${currency})`,
      },
    },
    syncTools: {
      syncOrders: "Sync Shopify orders",
      syncPayments: "Sync Shopify Payments",
      syncMetaAds: "Sync Meta Ads",
    },
    actions: {
      csvRequired: "CSV file is required",
      importSuccess: "SKU costs updated.",
      seedSuccess: "Demo cost templates imported.",
      syncOrders: "Shopify orders sync started for the last 30 days. Refresh in a few minutes.",
      syncPayments: "Shopify Payments refreshed.",
      syncMetaAds: "Meta Ads sync started.",
      selectPlan: "Select a plan to continue.",
      unsupported: "Unsupported action.",
      missingScope:
        "This shop hasn't granted order permissions yet. Please uninstall the app from your store and install it again so it can request the \"read_orders\" scope.",
      genericError: "Something went wrong.",
    },
  },
  zh: {
    pageTitle: "工作区设置",
    pageSubtitle: "套餐、店铺、集成与成本",
    sections: {
      plan: "套餐与计费",
      stores: "已连接店铺",
      integrations: "集成",
      costs: "成本配置",
      manualSync: "手动同步工具",
    },
    missingCost: {
      title: "部分 SKU 未配置成本",
      description: (count) =>
        `已检测到 ${count} 个 SKU 没有成本配置，利润统计可能不准确。`,
    },
    plan: {
      trialEnds: "试用结束时间",
      orderAllowance: "订单额度",
      storeAllowance: "店铺额度",
      switchPlan: "切换套餐",
      updatePlan: "更新套餐",
      notAvailable: "暂无",
    },
    storesTable: {
      shopDomain: "店铺域名",
      status: "状态",
      currency: "货币",
      timezone: "时区",
      installed: "安装时间",
    },
    integrations: {
      notConnected: "未连接。",
      statusLabel: "状态",
      lastSyncLabel: "最近同步",
      never: "从未同步",
      cards: {
        shopify: "Shopify",
        metaAds: "Meta Ads",
        shopifyPayments: "Shopify Payments",
        paypal: "PayPal",
      },
      metaAds: {
        connectCta: "连接 Meta Ads",
        reconnectCta: "重新连接 Meta Ads",
        accountIdLabel: "Meta 广告账号 ID",
        accountIdPlaceholder: "act_123456789",
        accountNameLabel: "账号名称（可选）",
        accountNamePlaceholder: "例如 主账号",
        helperText: "填写广告账号 ID 后跳转 Meta 完成授权以同步花费。",
        accountSummary: (name, id) => (name ? `${name} (${id})` : id),
        oauthSuccess: "Meta Ads 已成功连接。",
        oauthError: "Meta Ads 连接失败，请重试。",
      },
    },
    costs: {
      uploadLabel: "上传 SKU 成本 CSV",
      import: "导入",
      seedDemo: "导入演示成本",
      tableHeaders: {
        sku: "SKU",
        cost: (currency) => `成本（${currency}）`,
      },
    },
    syncTools: {
      syncOrders: "同步 Shopify 订单",
      syncPayments: "同步 Shopify Payments",
      syncMetaAds: "同步 Meta Ads",
    },
    actions: {
      csvRequired: "需要上传 CSV 文件",
      importSuccess: "SKU 成本已更新。",
      seedSuccess: "演示成本模板已导入。",
      syncOrders: "已开始同步最近 30 天的 Shopify 订单，几分钟后刷新查看。",
      syncPayments: "Shopify Payments 已刷新。",
      syncMetaAds: "Meta Ads 同步已启动。",
      selectPlan: "请选择套餐后再继续。",
      unsupported: "不支持的操作。",
      missingScope:
        "店铺尚未授予订单权限。请先在商店卸载应用并重新安装，以便重新请求 \"read_orders\" 权限。",
      genericError: "发生错误，请稍后再试。",
    },
  },
};

function PlanOverview({ plan, planOptions, copy }) {
  return (
    <s-stack direction="block" gap="base">
      <s-card padding="base">
        <s-text variation="subdued">{plan.name}</s-text>
        <s-display-text size="small">
          {plan.currency} {plan.price} / {plan.intervalLabel}
        </s-display-text>
        <s-text variation="subdued">
          {copy.trialEnds}: {plan.trialEndsAt ? formatDateOnly(plan.trialEndsAt, defaultTimeZone) : copy.notAvailable}
        </s-text>
        <s-text variation="subdued">
          {copy.orderAllowance}: {formatCount(plan.orderLimit)} · {copy.storeAllowance}:{" "}
          {formatCount(plan.storeLimit)}
        </s-text>
      </s-card>
      <Form method="post">
        <input type="hidden" name="intent" value="change-plan" />
        <label>
          {copy.switchPlan}
          <select name="planTier" defaultValue={plan.tier}>
            {planOptions.map((option) => (
              <option key={option.tier} value={option.tier}>
                {option.name} · {option.currency} {option.price}/{option.intervalLabel}
              </option>
            ))}
          </select>
        </label>
        <s-button type="submit" variant="primary">
          {copy.updatePlan}
        </s-button>
      </Form>
    </s-stack>
  );
}

function IntegrationList({ integrations, copy, buildAppUrl, lang, timeZone }) {
  const metaIntegration = integrations.ads.find((item) => item.id === "META_ADS");
  const metaAuthPath = lang ? `/auth/meta-ads/start?lang=${lang}` : "/auth/meta-ads/start";

  return (
    <s-stack direction="block" gap="base">
      <IntegrationCard
        title={copy.cards.shopify}
        integration={integrations.shopify}
        copy={copy}
        lang={lang}
        timeZone={timeZone}
      />
      <MetaAdsIntegrationCard
        integration={metaIntegration}
        copy={copy}
        actionUrl={buildAppUrl(metaAuthPath)}
        lang={lang}
        timeZone={timeZone}
      />
      <IntegrationCard
        title={copy.cards.shopifyPayments}
        integration={integrations.payments.find((item) => item.id === "SHOPIFY_PAYMENTS")}
        copy={copy}
        lang={lang}
        timeZone={timeZone}
      />
      <IntegrationCard
        title={copy.cards.paypal}
        integration={integrations.payments.find((item) => item.id === "PAYPAL")}
        copy={copy}
        lang={lang}
        timeZone={timeZone}
      />
    </s-stack>
  );
}

function IntegrationCard({
  title,
  integration,
  copy,
  extraContent = null,
  children = null,
  lang,
  timeZone,
}) {
  const lastSync = integration?.lastSyncedAt
    ? formatDateTime(integration.lastSyncedAt, { lang, timeZone })
    : copy.never;

  return (
    <s-card padding="base">
      <s-heading>{title}</s-heading>
      {integration ? (
        <>
          <s-text variation="subdued">
            {copy.statusLabel}: {integration.status}
          </s-text>
          {extraContent}
          <s-text variation="subdued">
            {copy.lastSyncLabel}: {lastSync}
          </s-text>
        </>
      ) : (
        <s-text variation="subdued">{copy.notConnected}</s-text>
      )}
      {children}
    </s-card>
  );
}

function MetaAdsIntegrationCard({ integration, copy, actionUrl, lang, timeZone }) {
  const accountSummary =
    integration && (integration.accountName || integration.accountId)
      ? copy.metaAds.accountSummary(integration.accountName, integration.accountId)
      : null;

  return (
    <IntegrationCard
      title={copy.cards.metaAds}
      integration={integration}
      copy={copy}
      lang={lang}
      timeZone={timeZone}
      extraContent={
        accountSummary ? (
          <s-text variation="subdued">
            {accountSummary}
          </s-text>
        ) : null
      }
    >
      <MetaAdsConnectForm
        actionUrl={actionUrl}
        copy={copy.metaAds}
        defaults={{
          accountId: integration?.accountId ?? "",
          accountName: integration?.accountName ?? "",
        }}
        hasConnection={Boolean(integration)}
      />
    </IntegrationCard>
  );
}

function MetaAdsConnectForm({ actionUrl, copy, defaults, hasConnection }) {
  return (
    <Form method="post" action={actionUrl} style={{ marginTop: "0.75rem" }}>
      <s-stack direction="block" gap="base">
        <label>
          {copy.accountIdLabel}
          <input
            type="text"
            name="accountId"
            required
            defaultValue={defaults.accountId}
            placeholder={copy.accountIdPlaceholder}
          />
        </label>
        <label>
          {copy.accountNameLabel}
          <input
            type="text"
            name="accountName"
            defaultValue={defaults.accountName}
            placeholder={copy.accountNamePlaceholder}
          />
        </label>
        <s-text variation="subdued">{copy.helperText}</s-text>
        <s-button type="submit" variant="secondary">
          {hasConnection ? copy.reconnectCta : copy.connectCta}
        </s-button>
      </s-stack>
    </Form>
  );
}

function CostConfiguration({ costConfig, primaryCurrency, copy }) {
  return (
    <s-stack direction="block" gap="base">
      <Form method="post" encType="multipart/form-data">
        <input type="hidden" name="intent" value="import-costs" />
        <s-stack direction="inline" gap="base" wrap align="end">
          <label>
            {copy.uploadLabel}
            <input type="file" name="file" accept=".csv,text/csv" />
          </label>
          <s-button type="submit" variant="primary">
            {copy.import}
          </s-button>
        </s-stack>
      </Form>
      <Form method="post">
        <input type="hidden" name="intent" value="seed-demo-costs" />
        <s-button type="submit" variant="secondary">
          {copy.seedDemo}
        </s-button>
      </Form>
      <s-data-table>
        <table>
          <thead>
            <tr>
              <th align="left">{copy.tableHeaders.sku}</th>
              <th align="right">{copy.tableHeaders.cost(primaryCurrency)}</th>
            </tr>
          </thead>
          <tbody>
            {costConfig.skuCosts.map((cost) => (
              <tr key={cost.id}>
                <td>{cost.sku}</td>
                <td align="right">{Number(cost.costAmount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </s-data-table>
    </s-stack>
  );
}

function SyncTools({ copy }) {
  return (
    <s-stack direction="inline" gap="base" wrap>
      <Form method="post">
        <input type="hidden" name="intent" value="sync-shopify-orders" />
        <s-button type="submit" variant="secondary">
          {copy.syncOrders}
        </s-button>
      </Form>
      <Form method="post">
        <input type="hidden" name="intent" value="sync-shopify-payments" />
        <s-button type="submit" variant="secondary">
          {copy.syncPayments}
        </s-button>
      </Form>
      <Form method="post">
        <input type="hidden" name="intent" value="sync-meta-ads" />
        <s-button type="submit" variant="secondary">
          {copy.syncMetaAds}
        </s-button>
      </Form>
    </s-stack>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
