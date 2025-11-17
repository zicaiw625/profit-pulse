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
  { value: "ltv", labelKey: TRANSLATION_KEYS.REPORTS_METRIC_LTV },
  {
    value: "repeatOrders",
    labelKey: TRANSLATION_KEYS.REPORTS_METRIC_REPEAT_ORDERS,
  },
];

const CUSTOMER_ONLY_METRICS = new Set(["ltv", "repeatOrders"]);

const DEFAULT_BUILDER_LIMIT = 50;
const SUPPORTED_LANGUAGES = ["en", "zh"];
const LANGUAGE_LABELS = {
  en: "English",
  zh: "简体中文",
};
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
  const lang = SUPPORTED_LANGUAGES.includes(langParam) ? langParam : "en";
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
  const rangeLabel =
    report.rangeLabel ??
    `${formatDateShort(report.range.start, report.timezone)} – ${formatDateShort(
      report.range.end,
      report.timezone,
    )}`;
  const baseReportsUrl = buildAppUrl(
    selectedLang ? `/app/reports?lang=${selectedLang}` : "/app/reports",
  );

  const builderFetcher = useFetcher();
  const initialStart = report.rangeInput?.start ?? "";
  const initialEnd = report.rangeInput?.end ?? "";
  const [builderValues, setBuilderValues] = useState(() => ({
    dimension: "channel",
    metrics: ["revenue", "netProfit"],
    start: initialStart,
    end: initialEnd,
    formulaLabel: "",
    formula: "",
  }));
  const buildCustomQuery = (values = builderValues, overrides = {}) => {
    const params = new URLSearchParams();
    params.set("dimension", values.dimension);
    params.set("metrics", values.metrics.join(","));
    if (values.start) params.set("start", values.start);
    if (values.end) params.set("end", values.end);
    if (values.formula) params.set("formula", values.formula);
    if (values.formulaLabel) params.set("formulaLabel", values.formulaLabel);
    params.set("limit", String(overrides.limit ?? DEFAULT_BUILDER_LIMIT));
    return params;
  };

  const buildCustomUrl = (values = builderValues, overrides = {}) => {
    const params = buildCustomQuery(values, overrides);
    return `/app/reports/custom?${params.toString()}`;
  };

  const buildCustomExportUrl = (values = builderValues, overrides = {}) => {
    const params = buildCustomQuery(values, overrides);
    return `/app/reports/export/custom?${params.toString()}`;
  };

  useEffect(() => {
    if (builderFetcher.state === "idle" && !builderFetcher.data) {
      builderFetcher.load(buildAppUrl(buildCustomUrl()));
    }
  }, [buildAppUrl, builderFetcher.state, builderFetcher.data]);

  const handleBuilderSubmit = (event) => {
    event.preventDefault();
    builderFetcher.load(buildAppUrl(buildCustomUrl()));
  };

  const [draggingItem, setDraggingItem] = useState(null);

  const parseDragData = (event) => {
    try {
      const raw = event.dataTransfer.getData("application/json");
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  };

  const allowDrop = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleDragStart = (payload) => (event) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/json", JSON.stringify(payload));
    setDraggingItem(payload);
  };

  const handleDragEnd = () => {
    setDraggingItem(null);
  };

  const addMetric = (metricKey) => {
    setBuilderValues((prev) => {
      if (prev.metrics.includes(metricKey)) {
        return prev;
      }
      return { ...prev, metrics: [...prev.metrics, metricKey] };
    });
  };

  const removeMetric = (metricKey) => {
    setBuilderValues((prev) => ({
      ...prev,
      metrics: prev.metrics.filter((metric) => metric !== metricKey),
    }));
  };

  const handleMetricInsert = (index) => (event) => {
    event.preventDefault();
    event.stopPropagation();
    const data = parseDragData(event);
    if (!data || data.type !== "metric") return;
    setBuilderValues((prev) => {
      const without = prev.metrics.filter((metric) => metric !== data.value);
      const insertIndex =
        typeof index === "number" && index >= 0 && index <= without.length
          ? index
          : without.length;
      without.splice(insertIndex, 0, data.value);
      return { ...prev, metrics: without };
    });
    setDraggingItem(null);
  };

  const handleMetricRemoveDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const data = parseDragData(event);
    if (!data || data.type !== "metric") return;
    removeMetric(data.value);
    setDraggingItem(null);
  };

  const isMetricAllowed = (metricKey, dimension) => {
    if (CUSTOMER_ONLY_METRICS.has(metricKey)) {
      return dimension === "customer";
    }
    return true;
  };

  const handleDimensionSelect = (value) => {
    setBuilderValues((prev) => ({
      ...prev,
      dimension: value,
      metrics: prev.metrics.filter((metric) => isMetricAllowed(metric, value)),
    }));
  };

  const handleDimensionDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const data = parseDragData(event);
    if (!data || data.type !== "dimension") return;
    handleDimensionSelect(data.value);
    setDraggingItem(null);
  };

  const isDraggingMetric = draggingItem?.type === "metric";
  const isDraggingDimension = draggingItem?.type === "dimension";

  const handleBuilderFieldChange = (field) => (event) => {
    setBuilderValues((prev) => ({
      ...prev,
      [field]: event.target.value,
    }));
  };

  const exportCustomCsvLink = buildAppUrl(
    buildCustomExportUrl(builderValues, { limit: 200 }),
  );
  const builderData = builderFetcher.data;
  const builderRows = builderData?.rows ?? [];
  const builderMetrics = builderData?.metrics ?? [];
  const builderDimensionLabel =
    builderData?.dimension?.label ??
    translate(TRANSLATION_KEYS.REPORTS_DIMENSION_LABEL, selectedLang);
  const builderCurrency = builderData?.currency ?? currency;
  const builderLoading =
    builderFetcher.state === "loading" || builderFetcher.state === "submitting";
  const metricsPalette = METRIC_OPTIONS.filter((metric) =>
    isMetricAllowed(metric.value, builderValues.dimension),
  );
  const availableMetrics = metricsPalette.filter(
    (metric) => !builderValues.metrics.includes(metric.value),
  );
  const selectedMetricObjects = builderValues.metrics
    .filter((metric) => isMetricAllowed(metric, builderValues.dimension))
    .map(
      (value) =>
        METRIC_OPTIONS.find((metric) => metric.value === value) ?? {
          value,
          labelKey: value,
        },
    );
  const selectedDimensionOption = DIMENSION_OPTIONS.find(
    (option) => option.value === builderValues.dimension,
  );
  const selectedDimensionLabel = selectedDimensionOption
    ? translate(selectedDimensionOption.labelKey, selectedLang)
    : builderValues.dimension;
  const dimensionDropStyles = {
    border: `1px dashed ${isDraggingDimension ? "#6366f1" : "#d1d5db"}`,
    background: isDraggingDimension ? "#eef2ff" : "#f9fafb",
    padding: "0.75rem",
    borderRadius: "0.5rem",
    minWidth: "220px",
  };
  const metricChipStyle = (active) => ({
    padding: "0.4rem 0.75rem",
    borderRadius: "999px",
    border: `1px solid ${active ? "#6366f1" : "#d1d5db"}`,
    background: active ? "#eef2ff" : "#fff",
    cursor: "grab",
    userSelect: "none",
  });
  const metricsDropZoneStyle = {
    border: `1px dashed ${isDraggingMetric ? "#6366f1" : "#d1d5db"}`,
    background: isDraggingMetric ? "#eef2ff" : "#f9fafb",
    padding: "0.75rem",
    borderRadius: "0.5rem",
    minHeight: "64px",
    flex: 1,
  };
  const availableMetricsStyle = {
    border: "1px solid #e5e7eb",
    background: "#fff",
    padding: "0.75rem",
    borderRadius: "0.5rem",
    minWidth: "220px",
    minHeight: "64px",
  };

  return (
    <s-page heading="Performance reports" subtitle={rangeLabel}>
      <s-stack direction="block" gap="base" style={{ marginBottom: "1rem" }}>
          <s-stack direction="inline" gap="tight" align="center">
            <s-text variation="subdued">
              {translate(TRANSLATION_KEYS.REPORTS_LANG_LABEL, selectedLang)}:
            </s-text>
            <select value={selectedLang} onChange={handleLanguageChange}>
              {SUPPORTED_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {LANGUAGE_LABELS[code] ?? code}
                </option>
              ))}
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
              <s-stack direction="inline" gap="base" wrap align="stretch">
                <div style={{ minWidth: "220px" }}>
                  <s-text variation="subdued">
                    {translate(TRANSLATION_KEYS.REPORTS_DIMENSION_LABEL, selectedLang)}
                  </s-text>
                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      flexWrap: "wrap",
                      marginTop: "0.5rem",
                    }}
                  >
                    {DIMENSION_OPTIONS.map((option) => {
                      const active = builderValues.dimension === option.value;
                      return (
                        <div
                          key={option.value}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              handleDimensionSelect(option.value);
                            }
                          }}
                          onClick={() => handleDimensionSelect(option.value)}
                          draggable
                          onDragStart={handleDragStart({
                            type: "dimension",
                            value: option.value,
                          })}
                          onDragEnd={handleDragEnd}
                          style={metricChipStyle(active)}
                        >
                          {translate(option.labelKey, selectedLang)}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div
                  onDragOver={allowDrop}
                  onDrop={handleDimensionDrop}
                  style={dimensionDropStyles}
                >
                  <s-text variation="subdued">Selected dimension</s-text>
                  <div style={{ marginTop: "0.5rem", fontWeight: 600 }}>
                    {selectedDimensionLabel}
                  </div>
                </div>
                <s-stack direction="inline" gap="base" align="center" wrap>
                  <label>
                    {translate(TRANSLATION_KEYS.REPORTS_DATE_RANGE_LABEL, selectedLang)}
                    <input
                      type="date"
                      name="startDate"
                      value={builderValues.start ?? ""}
                      onChange={handleBuilderFieldChange("start")}
                    />
                  </label>
                  <label>
                    <input
                      type="date"
                      name="endDate"
                      value={builderValues.end ?? ""}
                      onChange={handleBuilderFieldChange("end")}
                    />
                  </label>
                </s-stack>
              </s-stack>
              <s-stack direction="inline" gap="base" wrap align="start">
                <div
                  style={availableMetricsStyle}
                  onDragOver={allowDrop}
                  onDrop={handleMetricRemoveDrop}
                >
                  <s-text variation="subdued" style={{ display: "block", marginBottom: "0.5rem" }}>
                    {translate(TRANSLATION_KEYS.REPORTS_METRICS_LABEL, selectedLang)}
                  </s-text>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    {availableMetrics.length > 0 ? (
                      availableMetrics.map((metric) => (
                        <div
                          key={metric.value}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              addMetric(metric.value);
                            }
                          }}
                          onClick={() => addMetric(metric.value)}
                          draggable
                          onDragStart={handleDragStart({
                            type: "metric",
                            value: metric.value,
                          })}
                          onDragEnd={handleDragEnd}
                          style={metricChipStyle(false)}
                        >
                          {translate(metric.labelKey, selectedLang)}
                        </div>
                      ))
                    ) : (
                      <s-text variation="subdued">All metrics selected</s-text>
                    )}
                  </div>
                  <s-text variation="subdued" style={{ display: "block", marginTop: "0.5rem" }}>
                    Drag here to remove
                  </s-text>
                </div>
                <div
                  style={{
                    ...metricsDropZoneStyle,
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                  }}
                  onDragOver={allowDrop}
                  onDrop={handleMetricInsert(selectedMetricObjects.length)}
                >
                  {selectedMetricObjects.length === 0 ? (
                    <s-text variation="subdued">
                      Drag metrics here to build your report
                    </s-text>
                  ) : (
                    selectedMetricObjects.map((metric, index) => (
                      <div
                        key={metric.value}
                        onDragOver={allowDrop}
                        onDrop={handleMetricInsert(index)}
                      >
                        <div
                          draggable
                          onDragStart={handleDragStart({
                            type: "metric",
                            value: metric.value,
                          })}
                          onDragEnd={handleDragEnd}
                          style={{
                            ...metricChipStyle(true),
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <span>{translate(metric.labelKey, selectedLang)}</span>
                          <button
                            type="button"
                            onClick={() => removeMetric(metric.value)}
                            style={{
                              marginLeft: "0.75rem",
                              background: "transparent",
                              border: "none",
                              color: "#ef4444",
                              cursor: "pointer",
                              fontSize: "1rem",
                              lineHeight: 1,
                            }}
                            aria-label={`Remove ${metric.value}`}
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                  {selectedMetricObjects.length > 0 && (
                    <s-text variation="subdued">Drop at the end to append</s-text>
                  )}
                </div>
              </s-stack>
              <s-stack direction="block" gap="tight">
                <s-heading level="5">
                  {translate(TRANSLATION_KEYS.REPORTS_FORMULA_HEADING, selectedLang)}
                </s-heading>
                <s-text variation="subdued">
                  {translate(TRANSLATION_KEYS.REPORTS_FORMULA_HELP, selectedLang)}
                </s-text>
                <s-stack direction="inline" gap="base" wrap>
                  <label>
                    {translate(TRANSLATION_KEYS.REPORTS_FORMULA_LABEL, selectedLang)}
                    <input
                      type="text"
                      name="formulaLabel"
                      value={builderValues.formulaLabel}
                      onChange={handleBuilderFieldChange("formulaLabel")}
                      placeholder="Custom metric"
                    />
                  </label>
                  <label>
                    {translate(TRANSLATION_KEYS.REPORTS_FORMULA_EXPRESSION, selectedLang)}
                    <input
                      type="text"
                      name="formula"
                      value={builderValues.formula}
                      onChange={handleBuilderFieldChange("formula")}
                      placeholder="(revenue - adSpend) / orders"
                    />
                  </label>
                </s-stack>
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
            {builderData?.customFormula?.expression && (
              <s-text variation="subdued">
                {`${builderData.customFormula.label ?? "Custom"} = ${builderData.customFormula.expression}`}
              </s-text>
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
