/* eslint-disable react/prop-types */
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { getDashboardOverview } from "../services/dashboard.server";
import { formatCurrency, formatPercent, formatDateShort } from "../utils/formatting";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  const overview = await getDashboardOverview({ store });
  return { overview };
};

export default function DashboardIndex() {
  const { overview } = useLoaderData();
  const merchantSummary = overview.merchantSummary ?? null;
  const aggregateRangeLabel = merchantSummary?.range
    ? `${formatDateShort(merchantSummary.range.start)} – ${formatDateShort(
        merchantSummary.range.end,
      )}`
    : null;

  return (
    <s-page
      heading="Profit Pulse overview"
      subtitle={`Connected store: ${overview.shopDomain}`}
    >
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
