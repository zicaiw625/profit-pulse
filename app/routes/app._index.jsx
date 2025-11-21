/* eslint-disable react/prop-types */
import { Form, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { getDashboardOverview } from "../services/dashboard.server";
import { formatCurrency, formatPercent } from "../utils/formatting";
import { useAppUrlBuilder, APP_PRESERVED_PARAMS } from "../hooks/useAppUrlBuilder";
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
  const { lang, t } = useLocale();
  const preservedFormParams = APP_PRESERVED_PARAMS.map((key) => {
    const value = searchParams.get(key);
    return value ? { key, value } : null;
  }).filter(Boolean);
  const planStatus = overview.planStatus ?? null;
  const missingCost = overview.missingCost ?? null;
  const pendingSync = (overview.syncState?.totalOrders ?? 0) === 0;
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
  const copy = DASHBOARD_COPY[lang] ?? DASHBOARD_COPY.en;
  const missingCostPercent = missingCost
    ? (missingCost.percent * 100).toFixed(1)
    : null;

  return (
    <s-page
      heading={t(TRANSLATION_KEYS.DASHBOARD_HEADING)}
      subtitle={`${t(TRANSLATION_KEYS.DASHBOARD_SUBTITLE)} · ${overview.shopDomain}`}
    >
      {pendingSync && (
        <s-section>
          <s-banner tone="info" title={copy.syncingTitle}>
            <s-text variation="subdued">
              {copy.syncingDescription}
            </s-text>
          </s-banner>
          <s-card padding="base">
            <s-heading>{copy.nextStepsHeading}</s-heading>
            <s-text variation="subdued">
              {copy.nextStepsDescription}
            </s-text>
            <s-stack direction="inline" gap="base" wrap style={{ marginTop: "0.75rem" }}>
              <s-button variant="primary" href={buildAppUrl("/app/onboarding")}>
                {copy.viewOnboarding}
              </s-button>
              <s-button variant="secondary" href={buildAppUrl("/app/settings#costs")}>
                {copy.uploadCosts}
              </s-button>
            </s-stack>
          </s-card>
        </s-section>
      )}
      {!pendingSync && missingCost?.orders > 0 && (
        <s-section>
          <s-banner tone="warning" title={copy.missingCostTitle}>
            <s-text variation="subdued">
              {copy.missingCostDescription(missingCostPercent)}
            </s-text>
            <s-button variant="secondary" href={buildAppUrl("/app/settings#costs")}>
              {copy.missingCostCta}
            </s-button>
          </s-banner>
        </s-section>
      )}
      <s-section heading={t(TRANSLATION_KEYS.DASHBOARD_DATE_FILTERS)}>
        <Form method="get">
          {preservedFormParams.map(({ key, value }) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
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
      {pendingSync ? (
        <DashboardPlaceholder copy={copy} />
      ) : (
        <>
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
                label={t(TRANSLATION_KEYS.DASHBOARD_CARD_NET_PROFIT)}
                data={overview.timeseries.netProfit}
              />
              <TrendPreview
                label={t(TRANSLATION_KEYS.DASHBOARD_CARD_AD_SPEND)}
                data={overview.timeseries.adSpend}
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
                    <th align="right">Units</th>
                    <th align="right">Revenue</th>
                    <th align="right">COGS</th>
                    <th align="right">Net profit</th>
                    <th align="right">Margin</th>
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
                      <td align="right">{product.units.toLocaleString()}</td>
                      <td align="right">{formatCurrency(product.revenue, overview.currency)}</td>
                      <td align="right">{formatCurrency(product.cogs ?? 0, overview.currency)}</td>
                      <td align="right">{formatCurrency(product.netProfit, overview.currency)}</td>
                      <td align="right">{formatPercent(product.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </s-data-table>
          </s-section>
        </>
      )}

      <s-section slot="aside" heading="Plan usage">
        <PlanUsageCard planStatus={planStatus} currency={overview.currency} buildAppUrl={buildAppUrl} />
      </s-section>

      <s-section slot="aside" heading="Data coverage">
        <s-card padding="base">
          <s-text variation="subdued">Reporting window</s-text>
          <s-display-text size="small">{overview.rangeLabel}</s-display-text>
          <s-text variation="subdued">
            Updated in {overview.timezone ?? "UTC"}
          </s-text>
        </s-card>
      </s-section>
    </s-page>
  );
}


function CostCompositionChart({ slices, revenue, currency }) {
  const sanitized = (slices ?? []).map((slice) => ({
    label: slice.label,
    amount: Math.max(0, Number(slice.amount ?? 0)),
    share: Math.max(0, Number(slice.share ?? 0)),
  }));
  const totalAmount = sanitized.reduce((sum, slice) => sum + slice.amount, 0);

  if (!sanitized.length || totalAmount <= 0) {
    return (
      <s-card padding="base">
        <s-text variation="subdued">No cost data available for this range.</s-text>
      </s-card>
    );
  }

  const normalized = sanitized.map((slice) => ({
    ...slice,
    share:
      slice.share != null
        ? slice.share
        : totalAmount > 0
          ? slice.amount / totalAmount
          : 0,
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
  const segments = sanitized.map((slice, index) => {
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
          {sanitized.map((slice, index) => (
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
                {formatPercent(slice.share)} of revenue
              </s-text>
              <s-text variation="subdued">
                {formatCurrency(slice.amount, currency)}
              </s-text>
            </s-stack>
          ))}
        </s-stack>
      </s-stack>
    </s-card>
  );
}

const DASHBOARD_COPY = {
  en: {
    syncingTitle: "Sync in progress",
    syncingDescription:
      "Shopify orders and Meta Ads spend are still syncing. Demo data is shown until everything finishes.",
    nextStepsHeading: "Next actions",
    nextStepsDescription:
      "Import SKU costs, connect Meta Ads, and wait for Shopify webhooks to finish to see live profit.",
    viewOnboarding: "Open onboarding",
    uploadCosts: "Upload SKU costs",
    missingCostTitle: "Some orders are missing costs",
    missingCostDescription: (percent) =>
      percent != null
        ? `About ${percent}% of orders are missing SKU costs; net profit may be overstated.`
        : "Some orders are missing SKU costs; net profit may be overstated.",
    missingCostCta: "Fill in costs",
    placeholderDescription:
      "Data is syncing. A sample chart is shown so you can explore the layout; real metrics will replace it automatically.",
  },
  zh: {
    syncingTitle: "数据同步中",
    syncingDescription:
      "Shopify 订单与 Meta Ads 花费正在同步，通常需要几分钟。当前展示示意数据，完成后会自动刷新。",
    nextStepsHeading: "下一步操作",
    nextStepsDescription:
      "导入 COGS、连接 Meta Ads，并等待 Shopify Webhook 生效即可看到真实利润。",
    viewOnboarding: "查看 Onboarding",
    uploadCosts: "上传 SKU 成本",
    missingCostTitle: "部分订单缺少成本",
    missingCostDescription: (percent) =>
      `约 ${percent ?? "0"}% 的订单缺少 SKU 成本，净利润可能被高估。`,
    missingCostCta: "去补成本",
    placeholderDescription:
      "数据正在同步，我们先展示一份示意图以便熟悉界面。完成同步后，所有指标会自动替换成真实数据。",
  },
};

const CARD_LABEL_MAP = {
  revenue: TRANSLATION_KEYS.DASHBOARD_CARD_NET_REVENUE,
  orders: TRANSLATION_KEYS.DASHBOARD_CARD_ORDERS,
  adSpend: TRANSLATION_KEYS.DASHBOARD_CARD_AD_SPEND,
  netProfit: TRANSLATION_KEYS.DASHBOARD_CARD_NET_PROFIT,
  netMargin: TRANSLATION_KEYS.DASHBOARD_CARD_NET_MARGIN,
  roas: TRANSLATION_KEYS.DASHBOARD_CARD_ROAS,
};

function MetricCard({ card, currency }) {
  const trendEmoji = card.trend === "up" ? "↗︎" : "↘︎";
  let value;
  if (card.formatter === "percentage") {
    value = formatPercent(card.value);
  } else if (card.formatter === "count") {
    value = Number(card.value ?? 0).toLocaleString();
  } else if (card.formatter === "multiple") {
    value = `${(Number(card.value ?? 0)).toFixed(2)}×`;
  } else {
    value = formatCurrency(card.value, currency);
  }
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

function PlanUsageCard({ planStatus, buildAppUrl }) {
  if (!planStatus) {
    return (
      <s-card padding="base">
        <s-text variation="subdued">No subscription detected for this store.</s-text>
      </s-card>
    );
  }
  const usage = `${formatOrderCount(planStatus.orderUsage)} / ${formatOrderCount(planStatus.orderLimit)} orders`;
  return (
    <s-card padding="base">
      <s-text variation="subdued">{planStatus.planName}</s-text>
      <s-display-text size="small">{usage}</s-display-text>
      <s-text variation="subdued">
        Status: {planStatus.planStatus ?? "UNKNOWN"}
      </s-text>
      <s-button variant="secondary" href={buildAppUrl("/app/settings")}>
        Manage plan
      </s-button>
    </s-card>
  );
}

function formatOrderCount(value) {
  return Number(value ?? 0).toLocaleString();
}

function DashboardPlaceholder({ copy }) {
  return (
    <s-section heading="Demo preview">
      <s-card padding="base">
        <s-text variation="subdued">
          {copy.placeholderDescription}
        </s-text>
        <s-stack direction="inline" gap="base" wrap style={{ marginTop: "1rem" }}>
          <s-card padding="base">
            <s-text variation="subdued">Revenue</s-text>
            <s-display-text size="small">—</s-display-text>
          </s-card>
          <s-card padding="base">
            <s-text variation="subdued">Net profit</s-text>
            <s-display-text size="small">—</s-display-text>
          </s-card>
          <s-card padding="base">
            <s-text variation="subdued">ROAS</s-text>
            <s-display-text size="small">—</s-display-text>
          </s-card>
        </s-stack>
      </s-card>
    </s-section>
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
