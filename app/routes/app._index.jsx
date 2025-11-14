/* eslint-disable react/prop-types */
import { Form, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { getDashboardOverview } from "../services/dashboard.server";
import { formatCurrency, formatPercent, formatDateShort } from "../utils/formatting";
import { useAppUrlBuilder } from "../hooks/useAppUrlBuilder";
import { useLocale } from "../hooks/useLocale";
import { TRANSLATION_KEYS } from "../constants/translations";

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
  const { t } = useLocale();
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
  const planWarning = planStatus ? buildPlanWarning(planStatus, t) : null;
  const localizedCards = overview.summaryCards.map((card) => ({
    ...card,
    label: CARD_LABEL_MAP[card.key]
      ? t(CARD_LABEL_MAP[card.key])
      : card.label,
  }));
  const netRevenueCard = localizedCards.find(
    (card) => card.key === "netRevenue",
  );
  const revenueBasis = Number(netRevenueCard?.value ?? 0);

  return (
    <s-page
      heading={t(TRANSLATION_KEYS.DASHBOARD_HEADING)}
      subtitle={`${t(TRANSLATION_KEYS.DASHBOARD_SUBTITLE)}: ${overview.shopDomain}`}
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
      <s-section heading={t(TRANSLATION_KEYS.DASHBOARD_DATE_FILTERS)}>
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
      <s-section heading={`${t(TRANSLATION_KEYS.DASHBOARD_PERFORMANCE)} (${overview.rangeLabel})`}>
        <s-stack direction="inline" gap="base" wrap>
          {localizedCards.map((card) => (
            <MetricCard key={card.label} card={card} currency={overview.currency} />
          ))}
        </s-stack>
      </s-section>

      <s-section heading={t(TRANSLATION_KEYS.DASHBOARD_REVENUE_SECTION)}>
        <s-stack direction="block" gap="base">
          <TrendPreview
            label={t(TRANSLATION_KEYS.DASHBOARD_CARD_NET_REVENUE)}
            data={overview.timeseries.revenue}
          />
          <TrendPreview
            label={t(TRANSLATION_KEYS.DASHBOARD_CARD_AD_SPEND)}
            data={overview.timeseries.adSpend}
          />
          <TrendPreview
            label={t(TRANSLATION_KEYS.DASHBOARD_CARD_NET_PROFIT)}
            data={overview.timeseries.netProfit}
          />
        </s-stack>
      </s-section>

      <s-section heading={t(TRANSLATION_KEYS.DASHBOARD_COST_SECTION)}>
        <CostCompositionChart
          slices={overview.costBreakdown}
          revenue={revenueBasis}
          currency={overview.currency}
        />
      </s-section>

      <s-section heading={t(TRANSLATION_KEYS.DASHBOARD_TOP_PRODUCTS)}>
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

      <s-section slot="aside" heading={t(TRANSLATION_KEYS.DASHBOARD_LIVE_ALERTS)}>
        {overview.alerts.map((alert) => (
          <s-card key={alert.title} padding="base" subdued>
            <s-heading>{alert.title}</s-heading>
            <s-paragraph>{alert.message}</s-paragraph>
          </s-card>
        ))}
      </s-section>

      <s-section slot="aside" heading={t(TRANSLATION_KEYS.DASHBOARD_NEXT_ACTIONS)}>
        <s-unordered-list>
          <s-list-item>Connect Google Ads for blended ROAS</s-list-item>
          <s-list-item>Upload COGS CSV for Winter SKUs</s-list-item>
          <s-list-item>Create daily email digest</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section slot="aside" heading={t(TRANSLATION_KEYS.DASHBOARD_MULTI_STORE)}>
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

function buildPlanWarning(planStatus, translate) {
  if (!planStatus) return null;
  const orderUsage = `${formatOrderCount(planStatus.orderCount)} / ${formatOrderCount(
    planStatus.orderLimit,
  )}`;
  if (planStatus.orderStatus === "danger") {
    return {
      tone: "critical",
      title: "Order ingestion paused",
      message: translate(TRANSLATION_KEYS.DASHBOARD_PLAN_WARNING_DANGER).replace("{usage}", orderUsage),
    };
  }
  if (planStatus.orderStatus === "warning") {
    return {
      tone: "warning",
      title: "Order allowance approaching limit",
      message: translate(TRANSLATION_KEYS.DASHBOARD_PLAN_WARNING_ORDER).replace("{usage}", orderUsage),
    };
  }
  if (planStatus.planStatus && planStatus.planStatus !== "ACTIVE") {
    return {
      tone: "critical",
      title: "Billing action required",
      message: translate(TRANSLATION_KEYS.DASHBOARD_PLAN_WARNING_BILLING).replace(
        "{status}",
        planStatus.planStatus,
      ),
    };
  }
  return null;
}

function formatOrderCount(value) {
  return Number(value ?? 0).toLocaleString();
}

function CostCompositionChart({ slices, revenue, currency }) {
  const sanitized = (slices ?? []).map((slice) => ({
    ...slice,
    value: Math.max(0, Number(slice.value ?? 0)),
  }));
  const totalShare = sanitized.reduce((sum, slice) => sum + slice.value, 0);

  if (!sanitized.length || totalShare <= 0) {
    return (
      <s-card padding="base">
        <s-text variation="subdued">No cost data available for this range.</s-text>
      </s-card>
    );
  }

  const normalized = sanitized.map((slice) => ({
    ...slice,
    share: slice.value / totalShare,
    amount: revenue > 0 ? revenue * slice.value : null,
  }));

  const chartSize = 200;
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const colors = [
    "#5c6ac4",
    "#47c1bf",
    "#f49342",
    "#f37676",
    "#9c6ade",
    "#e0b457",
    "#627680",
  ];

  let offset = 0;
  const segments = normalized.map((slice, index) => {
    const length = slice.share * circumference;
    const strokeDasharray = `${length} ${circumference - length}`;
    const strokeDashoffset = circumference * 0.25 - offset;
    offset += length;
    return (
      <circle
        key={`${slice.label}-${index}`}
        cx={chartSize / 2}
        cy={chartSize / 2}
        r={radius}
        fill="transparent"
        stroke={colors[index % colors.length]}
        strokeWidth={24}
        strokeDasharray={strokeDasharray}
        strokeDashoffset={strokeDashoffset}
      />
    );
  });

  return (
    <s-card padding="base">
      <s-stack direction="inline" gap="base" wrap align="center">
        <div
          style={{
            position: "relative",
            width: `${chartSize}px`,
            height: `${chartSize}px`,
          }}
        >
          <svg
            role="img"
            viewBox={`0 0 ${chartSize} ${chartSize}`}
            width={chartSize}
            height={chartSize}
            style={{ transform: "rotate(-90deg)" }}
          >
            <circle
              cx={chartSize / 2}
              cy={chartSize / 2}
              r={radius}
              fill="transparent"
              stroke="#e3e8ee"
              strokeWidth={24}
            />
            {segments}
          </svg>
          <div
            style={{
              position: "absolute",
              inset: "0",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              textAlign: "center",
              padding: "0.75rem",
            }}
          >
            <s-text variation="subdued">Revenue basis</s-text>
            <s-heading>{formatCurrency(revenue, currency)}</s-heading>
          </div>
        </div>
        <s-stack direction="block" gap="tight" align="start">
          {normalized.map((slice, index) => (
            <s-stack
              key={`${slice.label}-legend-${index}`}
              direction="inline"
              gap="tight"
              align="center"
              wrap
            >
              <span
                aria-hidden
                style={{
                  display: "inline-block",
                  width: "0.75rem",
                  height: "0.75rem",
                  borderRadius: "999px",
                  backgroundColor: colors[index % colors.length],
                }}
              />
              <s-text strong>{slice.label}</s-text>
              <s-text variation="subdued">
                {formatPercent(slice.value)} of revenue
              </s-text>
              {slice.amount !== null && (
                <s-text variation="subdued">
                  {formatCurrency(slice.amount, currency)}
                </s-text>
              )}
            </s-stack>
          ))}
        </s-stack>
      </s-stack>
    </s-card>
  );
}

const CARD_LABEL_MAP = {
  netRevenue: TRANSLATION_KEYS.DASHBOARD_CARD_NET_REVENUE,
  adSpend: TRANSLATION_KEYS.DASHBOARD_CARD_AD_SPEND,
  netProfit: TRANSLATION_KEYS.DASHBOARD_CARD_NET_PROFIT,
  profitOnAdSpend: TRANSLATION_KEYS.DASHBOARD_CARD_POAS,
  fixedCosts: TRANSLATION_KEYS.DASHBOARD_CARD_FIXED,
  netProfitAfterFixed: TRANSLATION_KEYS.DASHBOARD_CARD_NET_AFTER_FIXED,
  refundRate: TRANSLATION_KEYS.DASHBOARD_CARD_REFUND_RATE,
  refundImpact: TRANSLATION_KEYS.DASHBOARD_CARD_REFUND_IMPACT,
};

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
