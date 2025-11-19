import { Form, useActionData, useLoaderData, useRouteError } from "react-router";
import { json } from "@remix-run/node";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { getAccountSettings } from "../services/settings.server";
import { importSkuCostsFromCsv, seedDemoCostConfiguration } from "../services/costs.server";
import { syncShopifyOrders } from "../services/sync/shopify-orders.server";
import { syncShopifyPayments } from "../services/sync/payment-payouts.server";
import { syncAdProvider } from "../services/sync/ad-spend.server";
import { requestPlanChange } from "../services/billing.server";
import { CredentialProvider } from "@prisma/client";

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

  try {
    switch (intent) {
      case "import-costs": {
        const file = formData.get("file");
        if (!(file instanceof File)) {
          throw new Error("CSV file is required");
        }
        const csv = await file.text();
        await importSkuCostsFromCsv({ storeId: store.id, csv, defaultCurrency: store.currency });
        return json({ success: true, message: "SKU costs updated." });
      }
      case "seed-demo-costs":
        await seedDemoCostConfiguration({ storeId: store.id, currency: store.currency });
        return json({ success: true, message: "Demo cost templates imported." });
      case "sync-shopify-orders":
        await syncShopifyOrders({ store, session, days: 30 });
        return json({ success: true, message: "Shopify orders queued for sync." });
      case "sync-shopify-payments":
        await syncShopifyPayments({ store, session });
        return json({ success: true, message: "Shopify Payments refreshed." });
      case "sync-meta-ads":
        await syncAdProvider({ store, provider: CredentialProvider.META_ADS, days: 30 });
        return json({ success: true, message: "Meta Ads sync started." });
      case "change-plan": {
        const planTier = formData.get("planTier");
        if (!planTier) {
          throw new Error("Select a plan to continue.");
        }
        await requestPlanChange({
          planTier,
          billing,
          session,
          returnUrl: new URL("/app/settings", request.url).toString(),
        });
        return json({ success: true, message: "Redirecting to Shopify billing..." });
      }
      default:
        return json({ success: false, message: "Unsupported action." }, { status: 400 });
    }
  } catch (error) {
    return json(
      {
        success: false,
        message: error.message || "Something went wrong.",
      },
      { status: 400 },
    );
  }
};

export default function SettingsPage() {
  const { settings } = useLoaderData();
  const actionData = useActionData();
  const missingCostSkuCount = settings.missingCostSkuCount ?? 0;

  return (
    <s-page heading="Workspace settings" subtitle="Plans, stores, integrations, and costs">
      {actionData?.message && (
        <s-section>
          <s-banner tone={actionData.success ? "success" : "critical"} title={actionData.message} />
        </s-section>
      )}

      <s-section heading="Plan & billing">
        <PlanOverview plan={settings.plan} planOptions={settings.planOptions} />
      </s-section>

      <s-section heading="Connected stores">
        <s-data-table>
          <table>
            <thead>
              <tr>
                <th align="left">Shop domain</th>
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
                  <td>{new Date(store.installedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-data-table>
      </s-section>

      <s-section heading="Integrations">
        <IntegrationList integrations={settings.integrations} />
      </s-section>

      <div id="costs">
        {missingCostSkuCount > 0 && (
          <s-section>
            <s-banner tone="warning" title="部分 SKU 未配置成本">
              <s-text variation="subdued">
                {`已检测到 ${missingCostSkuCount} 个 SKU 没有成本配置，利润统计可能不准确。`}
              </s-text>
            </s-banner>
          </s-section>
        )}
        <s-section heading="Cost configuration">
          <CostConfiguration costConfig={settings.costConfig} primaryCurrency={settings.primaryCurrency} />
        </s-section>
      </div>

      <s-section heading="Manual sync tools">
        <SyncTools />
      </s-section>
    </s-page>
  );
}

function PlanOverview({ plan, planOptions }) {
  return (
    <s-stack direction="block" gap="base">
      <s-card padding="base">
        <s-text variation="subdued">{plan.name}</s-text>
        <s-display-text size="small">
          {plan.currency} {plan.price} / {plan.intervalLabel}
        </s-display-text>
        <s-text variation="subdued">
          Trial ends: {plan.trialEndsAt ? new Date(plan.trialEndsAt).toLocaleDateString() : "N/A"}
        </s-text>
        <s-text variation="subdued">
          Order allowance: {plan.orderLimit.toLocaleString()} · Store allowance:{" "}
          {plan.storeLimit.toLocaleString()}
        </s-text>
      </s-card>
      <Form method="post">
        <input type="hidden" name="intent" value="change-plan" />
        <label>
          Switch plan
          <select name="planTier" defaultValue={plan.tier}>
            {planOptions.map((option) => (
              <option key={option.tier} value={option.tier}>
                {option.name} · {option.currency} {option.price}/{option.intervalLabel}
              </option>
            ))}
          </select>
        </label>
        <s-button type="submit" variant="primary">
          Update plan
        </s-button>
      </Form>
    </s-stack>
  );
}

function IntegrationList({ integrations }) {
  return (
    <s-stack direction="block" gap="base">
      <IntegrationCard title="Shopify" integration={integrations.shopify} />
      <IntegrationCard title="Meta Ads" integration={integrations.ads.find((item) => item.id === "META_ADS")} />
      <IntegrationCard
        title="Shopify Payments"
        integration={integrations.payments.find((item) => item.id === "SHOPIFY_PAYMENTS")}
      />
      <IntegrationCard
        title="PayPal"
        integration={integrations.payments.find((item) => item.id === "PAYPAL")}
      />
    </s-stack>
  );
}

function IntegrationCard({ title, integration }) {
  if (!integration) {
    return (
      <s-card padding="base">
        <s-heading>{title}</s-heading>
        <s-text variation="subdued">Not connected.</s-text>
      </s-card>
    );
  }

  return (
    <s-card padding="base">
      <s-heading>{title}</s-heading>
      <s-text variation="subdued">Status: {integration.status}</s-text>
      <s-text variation="subdued">
        Last sync: {integration.lastSyncedAt ? new Date(integration.lastSyncedAt).toLocaleString() : "Never"}
      </s-text>
    </s-card>
  );
}

function CostConfiguration({ costConfig, primaryCurrency }) {
  return (
    <s-stack direction="block" gap="base">
      <Form method="post" encType="multipart/form-data">
        <input type="hidden" name="intent" value="import-costs" />
        <s-stack direction="inline" gap="base" wrap align="end">
          <label>
            Upload SKU cost CSV
            <input type="file" name="file" accept=".csv,text/csv" />
          </label>
          <s-button type="submit" variant="primary">
            Import
          </s-button>
        </s-stack>
      </Form>
      <Form method="post">
        <input type="hidden" name="intent" value="seed-demo-costs" />
        <s-button type="submit" variant="secondary">
          Seed demo costs
        </s-button>
      </Form>
      <s-data-table>
        <table>
          <thead>
            <tr>
              <th align="left">SKU</th>
              <th align="right">Cost ({primaryCurrency})</th>
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

function SyncTools() {
  return (
    <s-stack direction="inline" gap="base" wrap>
      <Form method="post">
        <input type="hidden" name="intent" value="sync-shopify-orders" />
        <s-button type="submit" variant="secondary">
          Sync Shopify orders
        </s-button>
      </Form>
      <Form method="post">
        <input type="hidden" name="intent" value="sync-shopify-payments" />
        <s-button type="submit" variant="secondary">
          Sync Shopify Payments
        </s-button>
      </Form>
      <Form method="post">
        <input type="hidden" name="intent" value="sync-meta-ads" />
        <s-button type="submit" variant="secondary">
          Sync Meta Ads
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
