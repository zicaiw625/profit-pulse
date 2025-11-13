/* eslint-disable react/prop-types */
import { Form, useFetcher, useLoaderData, useRouteError, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import { authenticate } from "../shopify.server";
import { ensureMerchantAndStore } from "../models/store.server";
import { getAdPerformanceBreakdown, getReportingOverview } from "../services/reports.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  formatCurrency,
  formatPercent,
  formatRatio,
  formatChannelLabel,
  formatDateShort,
} from "../utils/formatting";
 
import { translate } from "../utils/i18n";
import { TRANSLATION_KEYS } from "../constants/translations";
import { useAppUrlBuilder } from "../hooks/useAppUrlBuilder";

const DIMENSION_OPTIONS = [
  { value: "channel", labelKey: TRANSLATION_KEYS.REPORTS_DIMENSION_CHANNEL },
  { value: "product", labelKey: TRANSLATION_KEYS.REPORTS_DIMENSION_PRODUCT },
  { value: "date", labelKey: TRANSLATION_KEYS.REPORTS_DIMENSION_DATE },
  { value: "country", labelKey: TRANSLATION_KEYS.REPORTS_DIMENSION_COUNTRY },
  { value: "customer", labelKey: TRANSLATION_KEYS.REPORTS_DIMENSION_CUSTOMER },
];

const METRIC_OPTIONS = [
  { value: "revenue", labelKey: TRANSLATION_KEYS.REPORTS_METRIC_REVENUE },
  { value: "netProfit", labelKey: TRANSLATION_KEYS.REPORTS_METRIC_NET_PROFIT },
  { value: "adSpend", labelKey: TRANSLATION_KEYS.REPORTS_METRIC_AD_SPEND },
  { value: "orders", labelKey: TRANSLATION_KEYS.REPORTS_METRIC_ORDERS },
];

const DEFAULT_BUILDER_LIMIT = 50;
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const store = await ensureMerchantAndStore(session.shop, session.email);
  const url = new URL(request.url);
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  const rangeDaysParam = Number(url.searchParams.get("days"));
  const rangeArgs = {
    rangeDays: Number.isFinite(rangeDaysParam) && rangeDaysParam > 0 ? rangeDaysParam : 30,
    rangeStart: parseDateInput(startParam),
    rangeEnd: parseDateInput(endParam),
  };
  const [report, adPerformance] = await Promise.all([
    getReportingOverview({ storeId: store.id, ...rangeArgs }),
    getAdPerformanceBreakdown({ storeId: store.id, ...rangeArgs }),
  ]);
  const langParam = (new URL(request.url).searchParams.get("lang") ?? "en").toLowerCase();
  const lang = ["en", "zh"].includes(langParam) ? langParam : "en";
  return {
    report,
    adPerformance,
    lang,
    filters: {
      start: startParam ?? "",
      end: endParam ?? "",
      days: rangeArgs.rangeDays ? String(rangeArgs.rangeDays) : "",
    },
  };
};

function parseDateInput(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export default function ReportsPage() {
  const { report, adPerformance, lang, filters } = useLoaderData();
  const buildAppUrl = useAppUrlBuilder();
  const [searchParams, setSearchParams] = useSearchParams();
  const hostParam = searchParams.get("host");
  const shopParam = searchParams.get("shop");
  const selectedLang = (searchParams.get("lang") ?? lang ?? "en").toLowerCase();
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

  const currency = report.currency ?? "USD";
  const rangeLabel = `${formatDateShort(report.range.start)} – ${formatDateShort(
    report.range.end,
  )}`;
  const baseReportsUrl = buildAppUrl(
    selectedLang ? `/app/reports?lang=${selectedLang}` : "/app/reports",
  );

  const builderFetcher = useFetcher();
  const initialStart = report.range?.start ? new Date(report.range.start) : new Date();
  const initialEnd = report.range?.end ? new Date(report.range.end) : new Date();
  const [builderValues, setBuilderValues] = useState(() => ({
    dimension: "channel",
    metrics: ["revenue", "netProfit"],
    start: initialStart.toISOString().slice(0, 10),
    end: initialEnd.toISOString().slice(0, 10),
  }));
  const buildCustomUrl = (values = builderValues, overrides = {}) => {
    const params = new URLSearchParams();
    params.set("dimension", values.dimension);
    params.set("metrics", values.metrics.join(","));
    if (values.start) params.set("start", values.start);
    if (values.end) params.set("end", values.end);
    params.set("limit", String(overrides.limit ?? DEFAULT_BUILDER_LIMIT));
    return `/app/reports/custom?${params.toString()}`;
  };

  useEffect(() => {
    builderFetcher.load(buildCustomUrl());
  }, [builderFetcher]);

  const handleBuilderSubmit = (event) => {
    event.preventDefault();
    builderFetcher.load(buildCustomUrl());
  };

  const toggleMetric = (key) => {
    setBuilderValues((prev) => {
      const exists = prev.metrics.includes(key);
      const nextMetrics = exists
        ? prev.metrics.filter((item) => item !== key)
        : [...prev.metrics, key];
      return { ...prev, metrics: nextMetrics };
    });
  };

  const handleBuilderFieldChange = (field) => (event) => {
    setBuilderValues((prev) => ({
      ...prev,
      [field]: event.target.value,
    }));
  };

  const exportCustomCsvLink = buildCustomUrl(builderValues, { limit: 200 });
  const builderData = builderFetcher.data;
  const builderRows = builderData?.rows ?? [];
  const builderMetrics = builderData?.metrics ?? [];
  const builderDimensionLabel =
    builderData?.dimension?.label ??
    translate(TRANSLATION_KEYS.REPORTS_DIMENSION_LABEL, selectedLang);
  const builderCurrency = builderData?.currency ?? currency;
  const builderLoading =
    builderFetcher.state === "loading" || builderFetcher.state === "submitting";

  return (
    <s-page heading="Performance reports" subtitle={rangeLabel}>
      <s-stack direction="block" gap="base" style={{ marginBottom: "1rem" }}>
        <s-stack direction="inline" gap="tight" align="center">
          <s-text variation="subdued">
            {translate(TRANSLATION_KEYS.REPORTS_LANG_LABEL, selectedLang)}:
          </s-text>
          <select value={selectedLang} onChange={handleLanguageChange}>
            <option value="en">English</option>
            <option value="zh">简体中文</option>
          </select>
        </s-stack>
        <Form method="get">
          {hostParam && <input type="hidden" name="host" value={hostParam} />}
          {shopParam && <input type="hidden" name="shop" value={shopParam} />}
          {selectedLang && <input type="hidden" name="lang" value={selectedLang} />}
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
              <select name="days" defaultValue={filters.days || "30"}>
                <option value="7">Last 7 days</option>
                <option value="14">Last 14 days</option>
                <option value="30">Last 30 days</option>
                <option value="60">Last 60 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </label>
            <s-button type="submit" variant="primary">
              Apply filters
            </s-button>
            <s-button type="button" variant="tertiary" href={baseReportsUrl}>
              Reset
            </s-button>
          </s-stack>
        </Form>
      </s-stack>
      <s-section heading="Summary">
        <s-stack direction="inline" gap="base" wrap>
          <SummaryCard label="Revenue" value={report.summary.revenue} currency={currency} />
          <SummaryCard label="Net profit" value={report.summary.netProfit} currency={currency} />
          <SummaryCard label="Fixed costs" value={report.summary.fixedCosts} currency={currency} />
          <SummaryCard label="Net profit (after fixed)" value={report.summary.netProfitAfterFixed} currency={currency} />
          <SummaryCard label="Ad spend" value={report.summary.adSpend} currency={currency} />
          <SummaryCard label="Net margin" value={report.summary.netMargin} variant="percentage" />
          <SummaryCard
            label="Net margin (after fixed)"
            value={report.summary.netMarginAfterFixed}
            variant="percentage"
          />
          <SummaryCard
            label="MER"
            value={report.summary.mer ?? 0}
            variant="ratio"
            fallback="—"
          />
          <SummaryCard
            label="NPAS"
            value={report.summary.npas ?? 0}
            variant="ratio"
            fallback="—"
          />
          <SummaryCard
            label="Break-even ROAS"
            value={report.summary.breakEvenRoas ?? 0}
            variant="ratio"
            fallback="—"
          />
          <SummaryCard label="Refund amount" value={report.summary.refundAmount} currency={currency} />
          <SummaryCard label="Refund rate" value={report.summary.refundRate} variant="percentage" />
        </s-stack>
      </s-section>
      <s-section heading="Profit & Loss view">
        <s-data-table>
          <table>
            <thead>
              <tr>
                <th align="left">Line item</th>
                <th align="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {buildPnlRows(report.summary).map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td align="right">{formatCurrency(row.value, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-data-table>
      </s-section>

      <s-section heading={translate(TRANSLATION_KEYS.REPORTS_BUILDER_HEADING, selectedLang)}>
        <s-card padding="base">
          <s-heading level="4">
            {translate(TRANSLATION_KEYS.REPORTS_BUILDER_HEADING, selectedLang)}
          </s-heading>
          <s-text variation="subdued">
            {translate(TRANSLATION_KEYS.REPORTS_BUILDER_DESC, selectedLang)}
          </s-text>
          <form
            onSubmit={handleBuilderSubmit}
            style={{
              marginTop: "1rem",
            }}
          >
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base" align="center">
                <label>
                  {translate(TRANSLATION_KEYS.REPORTS_DIMENSION_LABEL, selectedLang)}
                  <select
                    value={builderValues.dimension}
                    onChange={handleBuilderFieldChange("dimension")}
                  >
                    {DIMENSION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {translate(option.labelKey, selectedLang)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {translate(TRANSLATION_KEYS.REPORTS_DATE_RANGE_LABEL, selectedLang)}
                  <input
                    type="date"
                    name="startDate"
                    value={builderValues.start}
                    onChange={handleBuilderFieldChange("start")}
                  />
                </label>
                <label>
                  <input
                    type="date"
                    name="endDate"
                    value={builderValues.end}
                    onChange={handleBuilderFieldChange("end")}
                  />
                </label>
              </s-stack>
              <s-stack direction="inline" gap="base" align="baseline">
                <s-text variation="subdued">
                  {translate(TRANSLATION_KEYS.REPORTS_METRICS_LABEL, selectedLang)}
                  :
                </s-text>
                {METRIC_OPTIONS.map((metric) => (
                  <label key={metric.value}>
                    <input
                      type="checkbox"
                      checked={builderValues.metrics.includes(metric.value)}
                      onChange={() => toggleMetric(metric.value)}
                    />
                    {translate(metric.labelKey, selectedLang)}
                  </label>
                ))}
              </s-stack>
              <s-stack direction="inline" gap="base">
                <s-button type="submit" variant="primary">
                  {translate(TRANSLATION_KEYS.REPORTS_RUN_REPORT, selectedLang)}
                </s-button>
                <s-link href={exportCustomCsvLink} target="_blank" tone="primary">
                  {translate(TRANSLATION_KEYS.REPORTS_EXPORT_CUSTOM, selectedLang)}
                </s-link>
              </s-stack>
            </s-stack>
          </form>
          <s-stack direction="block" gap="base" style={{ marginTop: "1rem" }}>
            {builderLoading && <s-text variation="subdued">Loading...</s-text>}
            {!builderLoading && builderRows.length === 0 && (
              <s-text variation="subdued">
                {translate(TRANSLATION_KEYS.REPORTS_NO_DATA, selectedLang)}
              </s-text>
            )}
            {builderRows.length > 0 && (
              <s-data-table>
                <table>
                  <thead>
                    <tr>
                      <th align="left">{builderDimensionLabel}</th>
                      {builderMetrics.map((metric) => (
                        <th key={metric.key} align="right">
                          {metric.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {builderRows.map((row, index) => (
                      <tr key={`${row.dimensionValue}-${index}`}>
                        <td>{row.dimensionValue}</td>
                        {row.metrics.map((metric) => (
                          <td key={`${row.dimensionValue}-${metric.key}`} align="right">
                            {metric.isCurrency
                              ? formatCurrency(metric.value, builderCurrency)
                              : Number(metric.value ?? 0).toLocaleString()}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </s-data-table>
            )}
          </s-stack>
        </s-card>
      </s-section>

      <s-section heading="Channel performance">
        <s-data-table>
          <table>
            <thead>
              <tr>
                <th align="left">Channel</th>
                <th align="right">Revenue</th>
                <th align="right">Ad spend</th>
                <th align="right">MER</th>
                <th align="right">NPAS</th>
                <th align="right">Break-even ROAS</th>
                <th align="right">Net profit</th>
                <th align="right">Margin</th>
                <th align="right">Orders</th>
              </tr>
            </thead>
            <tbody>
              {report.channels.map((channel) => (
                <tr key={channel.channel}>
                <td>{formatChannelLabel(channel.channel)}</td>
                  <td align="right">{formatCurrency(channel.revenue, currency, 0)}</td>
                  <td align="right">{formatCurrency(channel.adSpend, currency, 0)}</td>
                  <td align="right">{formatRatio(channel.mer)}</td>
                  <td align="right">{formatRatio(channel.npas)}</td>
                  <td align="right">{formatRatio(channel.breakEvenRoas)}</td>
                  <td align="right">{formatCurrency(channel.netProfit, currency, 0)}</td>
                  <td align="right">{formatPercent(channel.margin)}</td>
                  <td align="right">{channel.orders.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </s-data-table>
      </s-section>

      <s-section heading="Top products by revenue">
        <s-data-table>
          <table>
            <thead>
              <tr>
                <th align="left">SKU</th>
                <th align="right">Revenue</th>
                <th align="right">Net profit</th>
              <th align="right">Ad spend</th>
              <th align="right">Orders</th>
              <th align="right">Units</th>
              <th align="right">Margin</th>
              <th align="right">Refund rate</th>
            </tr>
          </thead>
          <tbody>
            {report.products.map((product) => (
              <tr key={product.sku}>
                <td>{product.sku}</td>
                <td align="right">{formatCurrency(product.revenue, currency, 0)}</td>
                <td align="right">{formatCurrency(product.netProfit, currency, 0)}</td>
                <td align="right">{formatCurrency(product.adSpend, currency, 0)}</td>
                <td align="right">{product.orders.toLocaleString()}</td>
                <td align="right">{product.units.toLocaleString()}</td>
                <td align="right">{formatPercent(product.margin)}</td>
                <td align="right">{formatPercent(product.refundRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </s-data-table>
      </s-section>

      <s-section heading="Ad performance (campaign / ad set / ad)">
        {adPerformance.providers.length === 0 && (
          <s-text variation="subdued">
            No ad spend records yet. Connect Meta or Google Ads on the Settings page to track campaign profitability.
          </s-text>
        )}
        <s-stack direction="block" gap="base">
          {adPerformance.providers.map((provider) => (
            <s-card key={provider.provider} padding="base">
                <s-heading>
                {provider.label} · Spend {formatCurrency(provider.spend, adPerformance.currency ?? currency, 0)} · Revenue {formatCurrency(provider.revenue, adPerformance.currency ?? currency, 0)} · Net profit {formatCurrency(provider.netProfit, adPerformance.currency ?? currency, 0)}
              </s-heading>
              <s-data-table>
                <table>
                  <thead>
                    <tr>
                      <th align="left">Campaign</th>
                      <th align="left">Ad set</th>
                      <th align="left">Ad</th>
                      <th align="right">Spend</th>
                      <th align="right">Impr.</th>
                      <th align="right">Clicks</th>
                      <th align="right">Conv.</th>
                      <th align="right">Est. revenue</th>
                      <th align="right">Est. net profit</th>
                      <th align="right">MER</th>
                      <th align="right">NPAS</th>
                      <th align="right">CPA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {provider.rows.map((row) => (
                      <tr key={`${row.provider}-${row.campaignId}-${row.adSetId}-${row.adId}`}>
                        <td>{row.campaignName ?? row.campaignId ?? "—"}</td>
                        <td>{row.adSetName ?? row.adSetId ?? "—"}</td>
                        <td>{row.adName ?? row.adId ?? "—"}</td>
                        <td align="right">{formatCurrency(row.spendConverted ?? row.spend, adPerformance.currency ?? currency, 0)}</td>
                        <td align="right">{row.impressions.toLocaleString()}</td>
                        <td align="right">{row.clicks.toLocaleString()}</td>
                        <td align="right">{row.conversions.toLocaleString()}</td>
                        <td align="right">{formatCurrency(row.estimatedRevenue, adPerformance.currency ?? currency, 0)}</td>
                        <td align="right">{formatCurrency(row.estimatedNetProfit, adPerformance.currency ?? currency, 0)}</td>
                        <td align="right">{formatRatio(row.mer)}</td>
                        <td align="right">{formatRatio(row.npas)}</td>
                        <td align="right">{row.cpa ? formatCurrency(row.cpa, adPerformance.currency ?? currency, 0) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </s-data-table>
            </s-card>
          ))}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Exports">
        <s-stack direction="block" gap="base">
          <Form method="get" action={buildAppUrl("/app/reports/export/channels")}>
            <s-button type="submit" variant="secondary" fullWidth>
              Download channel performance CSV
            </s-button>
          </Form>
          <Form method="get" action={buildAppUrl("/app/reports/export/products")}>
            <s-button type="submit" variant="secondary" fullWidth>
              Download product profitability CSV
            </s-button>
          </Form>
          <Form method="get" action={buildAppUrl("/app/reports/export/net-profit")}>
            <s-button type="submit" variant="secondary" fullWidth>
              Download net profit vs. spend CSV
            </s-button>
          </Form>
          <Form method="get" action={buildAppUrl("/app/reports/export/ads")}>
            <s-button type="submit" variant="secondary" fullWidth>
              Download ad performance CSV
            </s-button>
          </Form>
          <Form method="get" action={buildAppUrl("/app/reports/export/accounting")}>
            <s-button type="submit" variant="secondary" fullWidth>
              Download accounting CSV
            </s-button>
          </Form>
          <Form
            method="get"
            action={buildAppUrl("/app/reports/export/accounting-detailed")}
          >
            <s-button
              type="submit"
              variant="secondary"
              fullWidth
            >
              {translate(TRANSLATION_KEYS.REPORTS_ACCOUNTING_DOWNLOAD, selectedLang)}
            </s-button>
          </Form>
          <Form method="get" action={buildAppUrl("/app/reports/export/quickbooks")}>
            <s-button type="submit" variant="secondary" fullWidth>
              QuickBooks CSV
            </s-button>
          </Form>
          <Form method="get" action={buildAppUrl("/app/reports/export/xero")}>
            <s-button type="submit" variant="secondary" fullWidth>
              Xero CSV
            </s-button>
          </Form>
          <Form method="get" action={buildAppUrl("/app/reports/export/tax-template")}>
            <s-button
              type="submit"
              variant="secondary"
              fullWidth
            >
              {translate(TRANSLATION_KEYS.REPORTS_TAX_TEMPLATE_DOWNLOAD, selectedLang)}
            </s-button>
          </Form>
        </s-stack>
      </s-section>
      <s-section slot="aside" heading="Coming soon">
        <s-unordered-list>
          <s-list-item>Global tax templates</s-list-item>
          <s-list-item>Accounting sync to ERP</s-list-item>
          <s-list-item>Shared report dashboards</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

function SummaryCard({ label, value, variant = "currency", fallback, currency = "USD" }) {
  let displayValue;
  if (variant === "currency") {
    displayValue = formatCurrency(value, currency, 0);
  } else if (variant === "percentage") {
    displayValue = formatPercent(value);
  } else if (variant === "ratio") {
    displayValue = formatRatio(value, 2, fallback ?? "—");
  } else {
    displayValue = value?.toLocaleString?.() ?? value ?? "—";
  }

  return (
    <s-card padding="base">
      <s-text variation="subdued">{label}</s-text>
      <s-display-text size="small">{displayValue}</s-display-text>
    </s-card>
  );
}

function buildPnlRows(summary) {
  return [
    { label: "Revenue", value: summary.revenue ?? 0 },
    { label: "Cost of goods sold", value: summary.cogs ?? 0 },
    { label: "Gross profit", value: summary.grossProfit ?? summary.netProfit ?? 0 },
    { label: "Shipping cost", value: summary.shippingCost ?? 0 },
    { label: "Payment fees", value: summary.paymentFees ?? 0 },
    { label: "Advertising", value: summary.adSpend ?? 0 },
    { label: "Net profit", value: summary.netProfit ?? 0 },
    {
      label: "Net profit (after fixed)",
      value: summary.netProfitAfterFixed ?? summary.netProfit ?? 0,
    },
  ];
}

function formatChannel(channel) {
  if (!channel) return "Unknown";
  return channel.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
