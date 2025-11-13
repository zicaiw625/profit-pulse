/* eslint-disable react/prop-types */
import { Form, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { getDashboardOverview } from "../services/dashboard.server";
import { formatCurrency, formatPercent, formatDateShort } from "../utils/formatting";
import { useAppUrlBuilder } from "../hooks/useAppUrlBuilder";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  const url = new URL(request.url);
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  const daysParam = Number(url.searchParams.get("days"));
  const overview = await getDashboardOverview({
    store,
    rangeDays: Number.isFinite(daysParam) && daysParam > 0 ? daysParam : undefined,
    rangeStart: parseDateInput(startParam),
    rangeEnd: parseDateInput(endParam),
  });
  return {
    overview,
    filters: {
      start: startParam ?? "",
      end: endParam ?? "",
      days: Number.isFinite(daysParam) && daysParam > 0 ? String(daysParam) : "",
    },
  };
};

function parseDateInput(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export default function DashboardIndex() {
  const { overview, filters } = useLoaderData();
  const [searchParams] = useSearchParams();
  const buildAppUrl = useAppUrlBuilder();
  const hostParam = searchParams.get("host");
  const shopParam = searchParams.get("shop");
  const merchantSummary = overview.merchantSummary ?? null;
  const overviewTimezone = overview.timezone ?? "UTC";
  const aggregateRangeLabel =
    merchantSummary?.rangeLabel ??
    (merchantSummary?.range
      ? `${formatDateShort(
          merchantSummary.range.start,
          merchantSummary.timezone ?? overviewTimezone,
        )} – ${formatDateShort(
          merchantSummary.range.end,
          merchantSummary.timezone ?? overviewTimezone,
        )}`
      : null);
  const planStatus = overview.planStatus ?? null;
  const planWarning = planStatus ? buildPlanWarning(planStatus) : null;

  return (
    <s-page
      heading="Profit Pulse overview"
      subtitle={`Connected store: ${overview.shopDomain}`}
    >
      {planWarning && (
        <s-section>
          <s-banner tone={planWarning.tone} title={planWarning.title}>
            <s-stack direction="block" gap="tight">
              <s-text variation="subdued">{planWarning.message}</s-text>
              <s-button variant="secondary" href={buildAppUrl("/app/settings")}>
                Manage plan
              </s-button>
            </s-stack>
          </s-banner>
        </s-section>
      )}
      <s-section heading="Date filters">
        <Form method="get">
          {hostParam && <input type="hidden" name="host" value={hostParam} />}
          {shopParam && <input type="hidden" name="shop" value={shopParam} />}
          <s-stack direction="inline" gap="base" wrap align="end">
            <label>
              Start date
              <input type="date" name="start" defaultValue={filters.start || ""} />
            </label>
            <label>
              End date
              <input type="date" name="end" defaultValue={filters.end || ""} />
            </label>
            <label>
              Quick range
              <select name="days" defaultValue={filters.days || "14"}>
                <option value="7">Last 7 days</option>
                <option value="14">Last 14 days</option>
                <option value="30">Last 30 days</option>
                <option value="60">Last 60 days</option>
              </select>
            </label>
            <s-button type="submit" variant="primary">
              Apply
            </s-button>
            <s-button
              type="button"
              variant="tertiary"
              href={buildAppUrl("/app")}
            >
              Reset
            </s-button>
          </s-stack>
        </Form>
      </s-section>
      <s-section heading={`Performance (${overview.rangeLabel})`}>
        <s-stack direction="inline" gap="base" wrap>
          {overview.summaryCards.map((card) => (
            <MetricCard key={card.label} card={card} currency={overview.currency} />
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Revenue, ad spend & profit">
        <s-stack direction="block" gap="base">
          <TrendPreview label="Revenue" data={overview.timeseries.revenue} />
          <TrendPreview label="Ad spend" data={overview.timeseries.adSpend} />
          <TrendPreview label="Net profit" data={overview.timeseries.netProfit} />
        </s-stack>
      </s-section>

      <s-section heading="Cost composition">
        <s-stack direction="inline" gap="base" wrap>
          {overview.costBreakdown.map((slice) => (
            <s-card key={slice.label} padding="base">
              <s-heading>{slice.label}</s-heading>
              <s-text variation="subdued">
                {(slice.value * 100).toFixed(1)}% of revenue
              </s-text>
            </s-card>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Top products by net profit">
        <s-data-table>
          <table>
            <thead>
              <tr>
                <th align="left">Product</th>
                <th align="right">Revenue</th>
                <th align="right">Net profit</th>
                <th align="right">Margin</th>
                <th align="right">Refund rate</th>
              </tr>
            </thead>
            <tbody>
              {overview.topProducts.map((product) => (
                <tr key={product.sku}>
                  <td>
                    <strong>{product.title}</strong>
                    <br />
                    <s-text variation="subdued">{product.sku}</s-text>
                  </td>
                  <td align="right">{formatCurrency(product.revenue, overview.currency)}</td>
                  <td align="right">{formatCurrency(product.netProfit, overview.currency)}</td>
                  <td align="right">{formatPercent(product.margin)}</td>
                  <td align="right">{formatPercent(product.refunds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-data-table>
      </s-section>

      <s-section slot="aside" heading="Live alerts">
        {overview.alerts.map((alert) => (
          <s-card key={alert.title} padding="base" subdued>
            <s-heading>{alert.title}</s-heading>
            <s-paragraph>{alert.message}</s-paragraph>
          </s-card>
        ))}
      </s-section>

      <s-section slot="aside" heading="Next actions">
        <s-unordered-list>
          <s-list-item>Connect Google Ads for blended ROAS</s-list-item>
          <s-list-item>Upload COGS CSV for Winter SKUs</s-list-item>
          <s-list-item>Create daily email digest</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading="Multi-store snapshot">
        {merchantSummary ? (
          <>
            <s-stack direction="inline" gap="base" wrap>
              <AggregateMetric
                label="Net revenue"
                value={merchantSummary.summary.revenue}
                currency={merchantSummary.currency}
              />
              <AggregateMetric
                label="Net profit"
                value={merchantSummary.summary.netProfit}
                currency={merchantSummary.currency}
              />
              <AggregateMetric
                label="Ad spend"
                value={merchantSummary.summary.adSpend}
                currency={merchantSummary.currency}
              />
              <AggregateMetric
                label="Refund rate"
                value={merchantSummary.summary.refundRate}
                variant="percentage"
              />
            </s-stack>
            <s-text variation="subdued">
              {merchantSummary.storeCount.toLocaleString()} stores ·{" "}
              {aggregateRangeLabel ?? "aggregated range"}
            </s-text>
          </>
        ) : (
          <s-text variation="subdued">
            Aggregated metrics will appear once other stores sync orders.
          </s-text>
        )}
      </s-section>
    </s-page>
  );
}

function buildPlanWarning(planStatus) {
  if (!planStatus) return null;
  const orderUsage = `${formatOrderCount(planStatus.orderCount)} / ${formatOrderCount(
    planStatus.orderLimit,
  )}`;
  if (planStatus.orderStatus === "danger") {
    return {
      tone: "critical",
      title: "Order ingestion paused",
      message: `You've used ${orderUsage} of your monthly order allowance. Upgrade or adjust usage to resume syncing.`,
    };
  }
  if (planStatus.orderStatus === "warning") {
    return {
      tone: "warning",
      title: "Order allowance approaching limit",
      message: `Current order usage is ${orderUsage}. Upgrade to avoid interrupted ingestion.`,
    };
  }
  if (planStatus.planStatus && planStatus.planStatus !== "ACTIVE") {
    return {
      tone: "critical",
      title: "Billing action required",
      message: `${planStatus.planName ?? "Profit Pulse"} billing status is ${planStatus.planStatus}. Resolve it in Shopify to keep data flowing.`,
    };
  }
  return null;
}

function formatOrderCount(value) {
  return Number(value ?? 0).toLocaleString();
}

function MetricCard({ card, currency }) {
  const trendEmoji = card.trend === "up" ? "↗︎" : "↘︎";
  const value =
    card.formatter === "percentage"
      ? formatPercent(card.value)
      : formatCurrency(card.value, currency);
  const deltaText =
    typeof card.deltaPercentage === "number"
      ? `${card.deltaPercentage}% vs. prior period`
      : card.deltaLabel ?? "—";
  const hasTrendArrow = card.trend === "up" || card.trend === "down";
  const tone =
    card.trend === "up"
      ? "success"
      : card.trend === "down"
        ? "critical"
        : "subdued";

  return (
    <s-card padding="base">
      <s-text variation="subdued">{card.label}</s-text>
      <s-display-text size="small">{value}</s-display-text>
      <s-text variation={tone}>
        {hasTrendArrow ? `${trendEmoji} ` : ""}
        {deltaText}
      </s-text>
    </s-card>
  );
}

function TrendPreview({ label, data }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-heading>{label}</s-heading>
      <s-text variation="subdued">
        {data[0].date} → {data[data.length - 1].date}
      </s-text>
      <pre style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
        {sparkline(data.map((p) => p.value))}
      </pre>
    </s-box>
  );
}

function AggregateMetric({ label, value, currency = "USD", variant = "currency" }) {
  let displayValue;
  if (variant === "percentage") {
    displayValue = formatPercent(value);
  } else {
    displayValue = formatCurrency(value, currency);
  }

  return (
    <s-card padding="base">
      <s-text variation="subdued">{label}</s-text>
      <s-display-text size="small">{displayValue}</s-display-text>
    </s-card>
  );
}

function sparkline(values) {
  const chars = "▁▂▃▄▅▆▇█";
  const min = Math.min(...values);
  const max = Math.max(...values);
  return values
    .map((value) => {
      const normalized = max === min ? 0 : (value - min) / (max - min);
      const idx = Math.round(normalized * (chars.length - 1));
      return chars[idx];
    })
    .join("");
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
